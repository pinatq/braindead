import { dialog, BrowserWindow } from 'electron'
import { promises as fs } from 'fs'

/** Zapisuje dump notatek do pliku wybranego przez użytkownika. */
export async function saveNotes(
  win: BrowserWindow | null,
  content: string
): Promise<{ saved: boolean; path?: string }> {
  const ts = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')
  const result = await dialog.showSaveDialog(win ?? undefined!, {
    title: 'Save notes dump',
    defaultPath: `notes-${ts}.txt`,
    filters: [
      { name: 'Text', extensions: ['txt'] },
      { name: 'Markdown', extensions: ['md'] }
    ]
  })
  if (result.canceled || !result.filePath) return { saved: false }
  await fs.writeFile(result.filePath, content, 'utf8')
  return { saved: true, path: result.filePath }
}
