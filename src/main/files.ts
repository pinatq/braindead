import { dialog, BrowserWindow, app } from 'electron'
import { promises as fs } from 'fs'
import path from 'path'
import os from 'os'
import type { DirListing, LoadedFile, NoteFile } from '../shared/types'

const MIME: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
  webp: 'image/webp', bmp: 'image/bmp', svg: 'image/svg+xml', avif: 'image/avif',
  pdf: 'application/pdf', txt: 'text/plain', md: 'text/markdown', json: 'application/json',
  csv: 'text/csv', html: 'text/html', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
}
function mimeOf(name: string): string {
  return MIME[name.split('.').pop()?.toLowerCase() ?? ''] ?? 'application/octet-stream'
}

const VIEWER_FILTERS = [
  { name: 'All supported', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'pdf', 'txt', 'md', 'markdown', 'json', 'log', 'csv', 'js', 'ts', 'tsx', 'jsx', 'css', 'html', 'docx'] },
  { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg'] },
  { name: 'PDF', extensions: ['pdf'] },
  { name: 'Documents', extensions: ['docx'] },
  { name: 'Text', extensions: ['txt', 'md', 'markdown', 'json', 'log', 'csv'] },
  { name: 'All files', extensions: ['*'] }
]

/** Otwiera dialog wyboru pliku i wczytuje go (base64). */
export async function openFile(win: BrowserWindow | null): Promise<LoadedFile | null> {
  const res = await dialog.showOpenDialog(win ?? undefined!, {
    title: 'Open file',
    properties: ['openFile'],
    filters: VIEWER_FILTERS
  })
  if (res.canceled || !res.filePaths[0]) return null
  return readFile(res.filePaths[0])
}

// Rozwija ~ / ~/... do katalogu domowego.
function expandHome(p: string): string {
  if (p === '~') return os.homedir()
  if (p.startsWith('~/') || p.startsWith('~\\')) return path.join(os.homedir(), p.slice(2))
  return p
}

/** Listuje katalog (eksplorator). Pusta ścieżka = katalog domowy. Foldery przed plikami, alfabetycznie. */
export async function readDir(dirPath: string): Promise<DirListing> {
  const abs = dirPath && dirPath.trim() ? path.resolve(expandHome(dirPath.trim())) : os.homedir()
  const items = await fs.readdir(abs, { withFileTypes: true })
  const entries = items
    .map((d) => ({ name: d.name, isDir: d.isDirectory(), path: path.join(abs, d.name) }))
    .sort((a, b) =>
      a.isDir !== b.isDir ? (a.isDir ? -1 : 1) : a.name.localeCompare(b.name, undefined, { numeric: true })
    )
  const parent = path.dirname(abs)
  return { path: abs, parent: parent === abs ? null : parent, entries }
}

/** Wczytuje plik z dysku jako base64 (do viewera). */
export async function readFile(filePath: string): Promise<LoadedFile> {
  const buf = await fs.readFile(filePath)
  return {
    name: path.basename(filePath),
    ext: path.extname(filePath).toLowerCase().replace('.', ''),
    base64: buf.toString('base64'),
    path: filePath
  }
}

/** Usuwa plik lub katalog (rekurencyjnie). Akcja niszcząca — renderer pyta przez confirm(). */
export async function deletePath(p: string): Promise<{ ok: boolean; error?: string }> {
  try {
    await fs.rm(p, { recursive: true, force: false })
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

/** Tworzy katalog w danym folderze (eksplorator). Zwraca ścieżkę nowego katalogu. */
export async function makeDir(dir: string, name: string): Promise<{ ok: boolean; path?: string; error?: string }> {
  try {
    const target = path.join(path.resolve(expandHome(dir)), name)
    await fs.mkdir(target, { recursive: false })
    return { ok: true, path: target }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

/** Tworzy pusty plik w danym folderze (eksplorator). Nie nadpisuje istniejącego (flag 'wx'). */
export async function makeFile(dir: string, name: string): Promise<{ ok: boolean; path?: string; error?: string }> {
  try {
    const target = path.join(path.resolve(expandHome(dir)), name)
    await fs.writeFile(target, '', { flag: 'wx' })
    return { ok: true, path: target }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

/** Zapisuje tekst do istniejącej ścieżki (edycja text/markdown w viewerze). */
export async function saveFile(filePath: string, content: string): Promise<{ ok: boolean }> {
  try {
    await fs.writeFile(filePath, content, 'utf8')
    return { ok: true }
  } catch {
    return { ok: false }
  }
}

/** Zapisuje załącznik notatki (dowolny plik) do katalogu danych aplikacji. */
export async function saveAttachment(name: string, base64: string): Promise<NoteFile> {
  const dir = path.join(app.getPath('userData'), 'notes-files')
  await fs.mkdir(dir, { recursive: true })
  const safe = (name || 'file').replace(/[^\w.\-]+/g, '_')
  const file = path.join(dir, `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}-${safe}`)
  await fs.writeFile(file, Buffer.from(base64, 'base64'))
  return { name: name || safe, path: file, mime: mimeOf(name) }
}

/** Wczytuje plik jako data URL (do podglądu miniatur obrazów). */
export async function readDataUrl(filePath: string): Promise<string> {
  const buf = await fs.readFile(filePath)
  return `data:${mimeOf(filePath)};base64,${buf.toString('base64')}`
}

/** Dialog wyboru folderu (panel Claude Code wskazuje katalog projektu). Zwraca ścieżkę albo null. */
export async function chooseDir(win: BrowserWindow | null): Promise<string | null> {
  const res = await dialog.showOpenDialog(win ?? undefined!, {
    title: 'Choose project folder',
    properties: ['openDirectory', 'createDirectory']
  })
  if (res.canceled || !res.filePaths[0]) return null
  return res.filePaths[0]
}

/** „Pobierz na dysk" — dialog zapisu (Finder) + kopia pliku do wybranej lokalizacji. */
export async function saveAs(
  win: BrowserWindow | null,
  srcPath: string,
  suggestedName: string
): Promise<{ saved: boolean; path?: string }> {
  const res = await dialog.showSaveDialog(win ?? undefined!, {
    title: 'Save to disk',
    defaultPath: suggestedName
  })
  if (res.canceled || !res.filePath) return { saved: false }
  await fs.copyFile(srcPath, res.filePath)
  return { saved: true, path: res.filePath }
}
