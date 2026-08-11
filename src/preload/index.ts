import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  IPC,
  type PersistedState,
  type PtyEnsureOpts,
  type PtyDataEvent,
  type PtyExitEvent,
  type PtyAltEvent,
  type LoadedFile,
  type NoteFile,
  type RamStats,
  type DirListing,
  type SshConfig,
  type SshResult,
  type ClaudeCliStatus
} from '../shared/types'

// Ścieżka (file://) do preloadu <webview> — wstrzykiwanego do każdej strony,
// by klik w treść aktywował panel. Liczona względem out/preload.
const webviewPreloadUrl = pathToFileURL(path.join(__dirname, 'webview.js')).toString()

// Pojedynczy nasłuch pty:data / pty:exit z rozsyłaniem do callbacków — unika
// MaxListenersExceededWarning przy wielu terminalach (do 16 paneli).
const dataCbs = new Set<(e: PtyDataEvent) => void>()
const exitCbs = new Set<(e: PtyExitEvent) => void>()
const altCbs = new Set<(e: PtyAltEvent) => void>()
ipcRenderer.on(IPC.ptyData, (_e: IpcRendererEvent, p: PtyDataEvent) => dataCbs.forEach((cb) => cb(p)))
ipcRenderer.on(IPC.ptyExit, (_e: IpcRendererEvent, p: PtyExitEvent) => exitCbs.forEach((cb) => cb(p)))
ipcRenderer.on(IPC.ptyAlt, (_e: IpcRendererEvent, p: PtyAltEvent) => altCbs.forEach((cb) => cb(p)))

// Statystyki RAM (push z mainu co kilka sekund) — ten sam wzorzec fan-out.
const ramCbs = new Set<(s: RamStats) => void>()
ipcRenderer.on(IPC.ramStats, (_e: IpcRendererEvent, s: RamStats) => ramCbs.forEach((cb) => cb(s)))

const api = {
  pty: {
    ensure: (id: string, opts: PtyEnsureOpts): Promise<{ existed: boolean; alt: boolean }> =>
      ipcRenderer.invoke(IPC.ptyEnsure, id, opts),
    input: (id: string, data: string): void => ipcRenderer.send(IPC.ptyInput, id, data),
    resize: (id: string, cols: number, rows: number): void =>
      ipcRenderer.send(IPC.ptyResize, id, cols, rows),
    kill: (id: string): void => ipcRenderer.send(IPC.ptyKill, id),
    onData: (cb: (e: PtyDataEvent) => void): (() => void) => {
      dataCbs.add(cb)
      return () => dataCbs.delete(cb)
    },
    onExit: (cb: (e: PtyExitEvent) => void): (() => void) => {
      exitCbs.add(cb)
      return () => exitCbs.delete(cb)
    },
    // Wejście/wyjście programu pełnoekranowego (nvim, htop) — vim mode ma wtedy odpuścić klawisze.
    onAlt: (cb: (e: PtyAltEvent) => void): (() => void) => {
      altCbs.add(cb)
      return () => altCbs.delete(cb)
    }
  },
  store: {
    load: (): Promise<PersistedState> => ipcRenderer.invoke(IPC.storeLoad),
    save: (state: PersistedState): Promise<void> => ipcRenderer.invoke(IPC.storeSave, state)
  },
  dialog: {
    saveNotes: (content: string): Promise<{ saved: boolean; path?: string }> =>
      ipcRenderer.invoke(IPC.dialogSaveNotes, content)
  },
  files: {
    open: (): Promise<LoadedFile | null> => ipcRenderer.invoke(IPC.dialogOpenFile),
    read: (filePath: string): Promise<LoadedFile> => ipcRenderer.invoke(IPC.fileRead, filePath),
    readDir: (dirPath: string): Promise<DirListing> => ipcRenderer.invoke(IPC.readDir, dirPath),
    deletePath: (p: string): Promise<{ ok: boolean; error?: string }> =>
      ipcRenderer.invoke(IPC.deletePath, p),
    makeDir: (dir: string, name: string): Promise<{ ok: boolean; path?: string; error?: string }> =>
      ipcRenderer.invoke(IPC.makeDir, dir, name),
    makeFile: (dir: string, name: string): Promise<{ ok: boolean; path?: string; error?: string }> =>
      ipcRenderer.invoke(IPC.makeFile, dir, name),
    save: (filePath: string, content: string): Promise<{ ok: boolean }> =>
      ipcRenderer.invoke(IPC.fileSave, filePath, content),
    saveAttachment: (name: string, base64: string): Promise<NoteFile> =>
      ipcRenderer.invoke(IPC.saveAttachment, name, base64),
    readDataUrl: (filePath: string): Promise<string> =>
      ipcRenderer.invoke(IPC.readDataUrl, filePath),
    saveAs: (srcPath: string, suggestedName: string): Promise<{ saved: boolean; path?: string }> =>
      ipcRenderer.invoke(IPC.dialogSaveAs, srcPath, suggestedName),
    chooseDir: (): Promise<string | null> => ipcRenderer.invoke(IPC.dialogOpenDir)
  },
  ssh: {
    connect: (cfg: SshConfig): Promise<SshResult> => ipcRenderer.invoke(IPC.sshConnect, cfg),
    disconnect: (id: string): Promise<void> => ipcRenderer.invoke(IPC.sshDisconnect, id),
    readDir: (id: string, p: string): Promise<DirListing> => ipcRenderer.invoke(IPC.sshReadDir, id, p),
    readFile: (id: string, p: string): Promise<LoadedFile> => ipcRenderer.invoke(IPC.sshReadFile, id, p),
    writeFile: (id: string, p: string, content: string): Promise<{ ok: boolean; error?: string }> =>
      ipcRenderer.invoke(IPC.sshWriteFile, id, p, content),
    makeDir: (id: string, dir: string, name: string): Promise<{ ok: boolean; path?: string; error?: string }> =>
      ipcRenderer.invoke(IPC.sshMakeDir, id, dir, name),
    makeFile: (id: string, dir: string, name: string): Promise<{ ok: boolean; path?: string; error?: string }> =>
      ipcRenderer.invoke(IPC.sshMakeFile, id, dir, name),
    delete: (id: string, p: string): Promise<{ ok: boolean; error?: string }> =>
      ipcRenderer.invoke(IPC.sshDelete, id, p)
  },
  agents: {
    status: (cmd: string): Promise<ClaudeCliStatus> => ipcRenderer.invoke(IPC.agentStatus, cmd),
    install: (toolId: string): Promise<{ ok: boolean; output: string }> =>
      ipcRenderer.invoke(IPC.agentInstall, toolId),
    sshSync: (command: string, toolId: string, profileId: string): Promise<{ ok: boolean; output: string }> =>
      ipcRenderer.invoke(IPC.agentSshSync, command, toolId, profileId),
    // Nasłuch etapów konfiguracji SSH (łączenie / instalacja / przenoszenie tokenów) — panel pokazuje status.
    onSshProgress: (cb: (e: { profileId: string; stage: string }) => void): (() => void) => {
      const fn = (_e: IpcRendererEvent, p: { profileId: string; stage: string }): void => cb(p)
      ipcRenderer.on(IPC.agentSshProgress, fn)
      return () => ipcRenderer.removeListener(IPC.agentSshProgress, fn)
    }
  },
  ram: {
    onStats: (cb: (s: RamStats) => void): (() => void) => {
      ramCbs.add(cb)
      return () => ramCbs.delete(cb)
    }
  },
  theme: {
    setForceDark: (on: boolean): void => ipcRenderer.send(IPC.setDark, on)
  },
  webviewPreloadUrl
}

contextBridge.exposeInMainWorld('api', api)

export type Api = typeof api
