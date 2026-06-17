import { app, shell, BrowserWindow, ipcMain, nativeImage, nativeTheme } from 'electron'
import path from 'path'
import os from 'os'
import { PtyManager } from './pty'
import { loadState, saveState } from './store'
import { saveNotes } from './dialog'
import {
  openFile,
  readFile,
  saveFile,
  saveAttachment,
  readDataUrl,
  saveAs,
  chooseDir,
  readDir,
  deletePath,
  makeDir,
  makeFile
} from './files'
import {
  sshConnect,
  sshDisconnect,
  sshDisconnectAll,
  sshReadDir,
  sshReadFile,
  sshWriteFile,
  sshMakeDir,
  sshMakeFile,
  sshDelete
} from './ssh'
import { agentStatus, agentInstall, agentSshSync } from './agents'
import { IPC, type PersistedState, type PtyEnsureOpts, type RamStats, type SshConfig } from '../shared/types'

let mainWindow: BrowserWindow | null = null
let ramTimer: ReturnType<typeof setInterval> | null = null

// Sieć bezpieczeństwa: błąd z natywnego node-pty (np. przy gwałtownym zamykaniu
// wielu terminali) nie powinien ubijać całego procesu — logujemy i idziemy dalej.
process.on('uncaughtException', (err) => {
  console.error('uncaughtException:', err)
})

const pty = new PtyManager(() => {
  const wc = mainWindow?.webContents
  return wc && !wc.isDestroyed() ? wc : null
})

// Ikona aplikacji (logo). W dev plik istnieje w build/; w paczce ikonę nadaje
// electron-builder, więc pusty obraz po prostu ignorujemy.
const appIcon = nativeImage.createFromPath(path.join(app.getAppPath(), 'build', 'icon.png'))

function createWindow(): void {
  mainWindow = new BrowserWindow({
    title: 'BrainDead',
    width: 1280,
    height: 800,
    minWidth: 800,
    minHeight: 500,
    show: false,
    backgroundColor: '#0e0f13',
    icon: appIcon.isEmpty() ? undefined : appIcon,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true, // potrzebne dla paneli przeglądarki (<webview>)
      plugins: true, // wbudowany podgląd PDF (PDFium) w viewerze
      backgroundThrottling: false // bez dławienia — inaczej zasoby stron (ikony/logo) nie ładują się w tle
    }
  })

  mainWindow.on('ready-to-show', () => mainWindow?.show())

  // Linki z target=_blank otwieramy w domyślnej przeglądarce systemowej.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))
  }
}

// Monitoring RAM: co ~3 s wysyłamy do renderera zużycie pamięci aplikacji oraz
// wolny/całkowity RAM systemu (best-effort — do wskaźnika i mitygacji).
function startRamMonitor(): void {
  if (ramTimer) clearInterval(ramTimer)
  const tick = (): void => {
    const wc = mainWindow?.webContents
    if (!wc || wc.isDestroyed()) return
    let appKb = 0
    try {
      for (const m of app.getAppMetrics()) appKb += m.memory.workingSetSize // w KB
    } catch {
      /* metryki chwilowo niedostępne */
    }
    const stats: RamStats = {
      appMb: Math.round(appKb / 1024),
      freeMb: Math.round(os.freemem() / 1048576),
      totalMb: Math.round(os.totalmem() / 1048576)
    }
    try {
      wc.send(IPC.ramStats, stats)
    } catch {
      /* okno zamknięte */
    }
  }
  ramTimer = setInterval(tick, 3000)
  tick()
}

function registerIpc(): void {
  // --- PTY ---
  ipcMain.handle(IPC.ptyEnsure, (e, id: string, opts: PtyEnsureOpts) => {
    const buffer = pty.ensure(id, opts.cols, opts.rows, opts.cwd, { agent: opts.agent })
    // Odtworzenie historii tylko do okna, które o nią poprosiło.
    if (buffer) e.sender.send(IPC.ptyData, { id, data: buffer })
    return { existed: buffer.length > 0 }
  })
  ipcMain.on(IPC.ptyInput, (_e, id: string, data: string) => pty.write(id, data))
  ipcMain.on(IPC.ptyResize, (_e, id: string, cols: number, rows: number) =>
    pty.resize(id, cols, rows)
  )
  ipcMain.on(IPC.ptyKill, (_e, id: string) => pty.kill(id))

  // --- Persistencja ---
  ipcMain.handle(IPC.storeLoad, () => loadState())
  ipcMain.handle(IPC.storeSave, (_e, state: PersistedState) => saveState(state))

  // --- Dialog zapisu notatek ---
  ipcMain.handle(IPC.dialogSaveNotes, (_e, content: string) =>
    saveNotes(mainWindow, content)
  )

  // --- Pliki (viewer / notatki) ---
  ipcMain.handle(IPC.dialogOpenFile, () => openFile(mainWindow))
  ipcMain.handle(IPC.fileRead, (_e, filePath: string) => readFile(filePath))
  ipcMain.handle(IPC.readDir, (_e, dirPath: string) => readDir(dirPath))
  ipcMain.handle(IPC.deletePath, (_e, p: string) => deletePath(p))
  ipcMain.handle(IPC.makeDir, (_e, dir: string, name: string) => makeDir(dir, name))
  ipcMain.handle(IPC.makeFile, (_e, dir: string, name: string) => makeFile(dir, name))

  // --- SSH / SFTP (eksplorator + viewer; połączenia tylko w pamięci main) ---
  ipcMain.handle(IPC.sshConnect, (_e, cfg: SshConfig) => sshConnect(cfg))
  ipcMain.handle(IPC.sshDisconnect, (_e, id: string) => sshDisconnect(id))
  ipcMain.handle(IPC.sshReadDir, (_e, id: string, p: string) => sshReadDir(id, p))
  ipcMain.handle(IPC.sshReadFile, (_e, id: string, p: string) => sshReadFile(id, p))
  ipcMain.handle(IPC.sshWriteFile, (_e, id: string, p: string, content: string) =>
    sshWriteFile(id, p, content)
  )
  ipcMain.handle(IPC.sshMakeDir, (_e, id: string, dir: string, name: string) => sshMakeDir(id, dir, name))
  ipcMain.handle(IPC.sshMakeFile, (_e, id: string, dir: string, name: string) => sshMakeFile(id, dir, name))
  ipcMain.handle(IPC.sshDelete, (_e, id: string, p: string) => sshDelete(id, p))
  ipcMain.handle(IPC.fileSave, (_e, filePath: string, content: string) =>
    saveFile(filePath, content)
  )
  ipcMain.handle(IPC.saveAttachment, (_e, name: string, base64: string) =>
    saveAttachment(name, base64)
  )
  ipcMain.handle(IPC.readDataUrl, (_e, filePath: string) => readDataUrl(filePath))
  ipcMain.handle(IPC.dialogSaveAs, (_e, srcPath: string, suggestedName: string) =>
    saveAs(mainWindow, srcPath, suggestedName)
  )
  ipcMain.handle(IPC.dialogOpenDir, () => chooseDir(mainWindow))

  // --- Agent CLI (status + instalacja danego narzędzia) ---
  ipcMain.handle(IPC.agentStatus, (_e, cmd: string) => agentStatus(cmd))
  ipcMain.handle(IPC.agentInstall, (_e, toolId: string) => agentInstall(toolId))
  ipcMain.handle(IPC.agentSshSync, (e, command: string, toolId: string, profileId: string) =>
    // Etapy (łączenie / instalacja / przenoszenie tokenów) lecą na żywo do panelu, by pokazać status.
    agentSshSync(command, toolId, profileId, (stage) =>
      e.sender.send(IPC.agentSshProgress, { profileId, stage })
    )
  )

  // --- Motyw: wymuszanie dark na stronach (prefers-color-scheme, best-effort) ---
  ipcMain.on(IPC.setDark, (_e, on: boolean) => {
    nativeTheme.themeSource = on ? 'dark' : 'system'
  })
}

app.whenReady().then(() => {
  // Ikona w docku (macOS, tryb dev — w paczce ikonę nadaje builder).
  if (process.platform === 'darwin' && !appIcon.isEmpty()) app.dock?.setIcon(appIcon)

  registerIpc()
  createWindow()
  startRamMonitor()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (ramTimer) clearInterval(ramTimer)
  pty.killAll()
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  if (ramTimer) clearInterval(ramTimer)
  pty.killAll()
  sshDisconnectAll()
})
