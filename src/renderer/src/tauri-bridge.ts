// Tauri-backed reimplementation of the Electron preload's `window.api`
// (was src/preload/index.ts). Identical shape, so the ported renderer needs ZERO changes:
//   ipcRenderer.invoke  -> invoke()
//   ipcRenderer.send    -> invoke() (fire-and-forget)
//   ipcRenderer.on      -> event.listen() with the same fan-out (one listener -> many subs)
// Importing this module assigns window.api synchronously, before <App/> mounts.
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'

// Błędy komend paneli BYŁY połykane przez puste .catch(() => {}). Wyciszało to prawdziwą
// przyczynę martwej przeglądarki: jeśli add_pane rzuci, w interfejsie nie widać nic —
// placeholder stoi, natywnego widoku nie ma, żadnego śladu. Teraz każdy taki błąd ląduje
// na stderr procesu (komenda log_js), więc widać go po uruchomieniu z terminala.
const paneErr = (co: string) => (e: unknown): void => {
  void invoke('log_js', { level: 'pane-error', msg: `${co}: ${String(e)}` }).catch(() => {})
}
import type {
  PersistedState,
  PtyEnsureOpts,
  PtyDataEvent,
  PtyExitEvent,
  PtyAltEvent,
  LoadedFile,
  NoteFile,
  RamStats,
  DirListing,
  SshConfig,
  SshResult,
  ClaudeCliStatus
} from '../../shared/types'

// Fan-out subscriber sets (avoid MaxListeners-style duplication across up to 16 panes).
const dataCbs = new Set<(e: PtyDataEvent) => void>()
const exitCbs = new Set<(e: PtyExitEvent) => void>()
// Wejście/wyjście programu pełnoekranowego (nvim/htop) — vim mode ma wtedy odpuścić klawisze.
const altCbs = new Set<(e: PtyAltEvent) => void>()
const ramCbs = new Set<(s: RamStats) => void>()
const sshProgCbs = new Set<(e: { profileId: string; stage: string }) => void>()
const paneMediaCbs = new Set<(e: { id: string; on: boolean }) => void>()
// Komendy z zewnątrz: gniazdo uniksowe (Neovide, skrypty) i OSC 7717 z panelu terminala.
interface AppCommand { source: string; verb: string; arg: string; pane?: string }
const appCmdCbs = new Set<(e: AppCommand) => void>()
void listen<AppCommand>('app:command', (e) => appCmdCbs.forEach((cb) => cb(e.payload)))
// Native browser-pane events (multiwebview). id = full native id `${paneId}:${tabId}`.
const paneNavCbs = new Set<(e: { id: string; url: string }) => void>()
const paneTitleCbs = new Set<(e: { id: string; title: string }) => void>()
// Events emitted BY the injected browser script (port of the Electron webview preload).
const paneOpenTabCbs = new Set<(e: { id: string; url: string }) => void>()
const paneRunBindCbs = new Set<(e: { id: string; combo: string }) => void>()
const paneActivateCbs = new Set<(e: { id: string; click: boolean }) => void>()
const paneFocusUrlCbs = new Set<(e: { id: string }) => void>()
const paneWinMotionCbs = new Set<(e: { id: string; act: string }) => void>()
const paneWinPrefixCbs = new Set<(e: { id: string }) => void>()
const paneVimHelloCbs = new Set<(e: { id: string }) => void>()

// PTY output arrives base64 (raw bytes survive the JSON event boundary). A per-terminal
// streaming UTF-8 decoder reassembles multibyte sequences split across 8ms flush batches.
const decoders = new Map<string, TextDecoder>()
const b64ToBytes = (b: string): Uint8Array => Uint8Array.from(atob(b), (c) => c.charCodeAt(0))

void listen<[string, string]>('pty:data', (e) => {
  const [id, b64] = e.payload
  let dec = decoders.get(id)
  if (!dec) {
    dec = new TextDecoder('utf-8')
    decoders.set(id, dec)
  }
  const data = dec.decode(b64ToBytes(b64), { stream: true })
  if (data) dataCbs.forEach((cb) => cb({ id, data }))
})
void listen<PtyExitEvent>('pty:exit', (e) => {
  decoders.delete(e.payload.id)
  exitCbs.forEach((cb) => cb(e.payload))
})
void listen<PtyAltEvent>('pty:alt', (e) => altCbs.forEach((cb) => cb(e.payload)))
void listen<RamStats>('ram:stats', (e) => ramCbs.forEach((cb) => cb(e.payload)))
void listen<{ profileId: string; stage: string }>('agent:sshProgress', (e) =>
  sshProgCbs.forEach((cb) => cb(e.payload))
)
void listen<{ id: string; url: string }>('pane:navigated', (e) =>
  paneNavCbs.forEach((cb) => cb(e.payload))
)
void listen<{ id: string; title: string }>('pane:title', (e) =>
  paneTitleCbs.forEach((cb) => cb(e.payload))
)
// Zdarzenia ze skryptu wstrzykiwanego do natywnych webview (port preloadu webview z master).
void listen<{ id: string; on: boolean }>('pane:media', (e) =>
  paneMediaCbs.forEach((cb) => cb(e.payload))
)
void listen<{ id: string; url: string }>('pane:open-tab', (e) =>
  paneOpenTabCbs.forEach((cb) => cb(e.payload))
)
void listen<{ id: string; combo: string }>('pane:run-bind', (e) =>
  paneRunBindCbs.forEach((cb) => cb(e.payload))
)
void listen<{ id: string; click: boolean }>('pane:activate', (e) =>
  paneActivateCbs.forEach((cb) => cb(e.payload))
)
void listen<{ id: string }>('pane:focus-url', (e) => paneFocusUrlCbs.forEach((cb) => cb(e.payload)))
void listen<{ id: string; act: string }>('pane:win-motion', (e) =>
  paneWinMotionCbs.forEach((cb) => cb(e.payload))
)
void listen<{ id: string }>('pane:win-prefix', (e) =>
  paneWinPrefixCbs.forEach((cb) => cb(e.payload))
)
void listen<{ id: string }>('pane:vim-hello', (e) =>
  paneVimHelloCbs.forEach((cb) => cb(e.payload))
)

const api = {
  pty: {
    // Zwraca `{ existed, alt }` — `alt` mówi, czy w żywej sesji chodzi program
    // pełnoekranowy. Przy re-attachu backend odtwarza scrollback zwykłym zdarzeniem
    // pty:data (nasłuch stoi od załadowania modułu, więc nic nie ginie).
    ensure: (id: string, opts: PtyEnsureOpts): Promise<{ existed: boolean; alt: boolean }> =>
      invoke('pty_spawn', {
        id,
        cols: opts.cols,
        rows: opts.rows,
        cwd: opts.cwd ?? null,
        agent: opts.agent ?? null
      }),
    input: (id: string, data: string): void => {
      void invoke('pty_write', { id, data })
    },
    resize: (id: string, cols: number, rows: number): void => {
      void invoke('pty_resize', { id, cols, rows })
    },
    kill: (id: string): void => {
      void invoke('pty_kill', { id })
    },
    onData: (cb: (e: PtyDataEvent) => void): (() => void) => {
      dataCbs.add(cb)
      return () => void dataCbs.delete(cb)
    },
    onExit: (cb: (e: PtyExitEvent) => void): (() => void) => {
      exitCbs.add(cb)
      return () => void exitCbs.delete(cb)
    },
    onAlt: (cb: (e: PtyAltEvent) => void): (() => void) => {
      altCbs.add(cb)
      return () => void altCbs.delete(cb)
    }
  },
  store: {
    load: (): Promise<PersistedState> => invoke('store_load'),
    save: (state: PersistedState): Promise<void> => invoke('store_save', { state })
  },
  dialog: {
    saveNotes: (content: string): Promise<{ saved: boolean; path?: string }> =>
      invoke('dialog_save_notes', { content }),
    // Zamienniki confirm()/alert(). W WKWebView te dwie funkcje są martwe — wry nie
    // implementuje WKUIDelegate dla okienek JS, więc confirm() zwraca od razu false,
    // a alert() nie robi nic. Robimy je natywnie po stronie Rusta.
    confirm: (title: string, message: string): Promise<boolean> =>
      invoke('dialog_confirm', { title, message }),
    message: (title: string, message: string): Promise<void> =>
      invoke('dialog_message', { title, message })
  },
  files: {
    open: (): Promise<LoadedFile | null> => invoke('file_open'),
    read: (filePath: string): Promise<LoadedFile> => invoke('file_read', { filePath }),
    readDir: (dirPath: string): Promise<DirListing> => invoke('file_read_dir', { dirPath }),
    deletePath: (p: string): Promise<{ ok: boolean; error?: string }> => invoke('file_delete', { path: p }),
    makeDir: (dir: string, name: string): Promise<{ ok: boolean; path?: string; error?: string }> =>
      invoke('file_mkdir', { dir, name }),
    makeFile: (dir: string, name: string): Promise<{ ok: boolean; path?: string; error?: string }> =>
      invoke('file_create', { dir, name }),
    save: (filePath: string, content: string): Promise<{ ok: boolean }> =>
      invoke('file_save', { filePath, content }),
    saveAttachment: (name: string, base64: string): Promise<NoteFile> =>
      invoke('notes_save_attachment', { name, base64 }),
    readDataUrl: (filePath: string): Promise<string> => invoke('file_read_data_url', { filePath }),
    saveAs: (srcPath: string, suggestedName: string): Promise<{ saved: boolean; path?: string }> =>
      invoke('file_save_as', { srcPath, suggestedName }),
    chooseDir: (): Promise<string | null> => invoke('dialog_open_dir')
  },
  ssh: {
    connect: (cfg: SshConfig): Promise<SshResult> => invoke('ssh_connect', { cfg }),
    disconnect: (id: string): Promise<void> => invoke('ssh_disconnect', { id }),
    readDir: (id: string, p: string): Promise<DirListing> => invoke('ssh_read_dir', { id, path: p }),
    readFile: (id: string, p: string): Promise<LoadedFile> => invoke('ssh_read_file', { id, path: p }),
    writeFile: (id: string, p: string, content: string): Promise<{ ok: boolean; error?: string }> =>
      invoke('ssh_write_file', { id, path: p, content }),
    makeDir: (id: string, dir: string, name: string): Promise<{ ok: boolean; path?: string; error?: string }> =>
      invoke('ssh_mkdir', { id, dir, name }),
    makeFile: (id: string, dir: string, name: string): Promise<{ ok: boolean; path?: string; error?: string }> =>
      invoke('ssh_create', { id, dir, name }),
    delete: (id: string, p: string): Promise<{ ok: boolean; error?: string }> =>
      invoke('ssh_delete', { id, path: p })
  },
  agents: {
    status: (cmd: string): Promise<ClaudeCliStatus> => invoke('agent_status', { cmd }),
    install: (toolId: string): Promise<{ ok: boolean; output: string }> =>
      invoke('agent_install', { toolId }),
    sshSync: (command: string, toolId: string, profileId: string): Promise<{ ok: boolean; output: string }> =>
      invoke('agent_ssh_sync', { command, toolId, profileId }),
    onSshProgress: (cb: (e: { profileId: string; stage: string }) => void): (() => void) => {
      sshProgCbs.add(cb)
      return () => void sshProgCbs.delete(cb)
    }
  },
  ram: {
    onStats: (cb: (s: RamStats) => void): (() => void) => {
      ramCbs.add(cb)
      return () => void ramCbs.delete(cb)
    }
  },
  // Sterowanie aplikacją spoza interfejsu — patrz src-tauri/src/control.rs.
  onAppCommand: (cb: (e: AppCommand) => void): (() => void) => {
    appCmdCbs.add(cb)
    return () => void appCmdCbs.delete(cb)
  },
  theme: {
    setForceDark: (on: boolean): void => {
      void invoke('theme_set_dark', { on })
    }
  },
  // Native browser panes: child webviews labeled `pane:{id}` floating over the ui webview.
  // Rects are CSS px in window coordinates (getBoundingClientRect of the placeholder div).
  // Fire-and-forget wrappers swallow "no such pane" races (view closed mid-call); add/move
  // stay awaitable so callers can sequence follow-up moves/visibility after creation.
  panes: {
    // `ws` = numer przestrzeni roboczej: panele w tej samej przestrzeni dzielą
    // cookies/logowania, różne przestrzenie mają osobne (partycje persist: z Electrona).
    add: (id: string, url: string, ws: number, x: number, y: number, w: number, h: number): Promise<void> =>
      invoke<void>('add_pane', { id, url, ws, x, y, w, h }).catch(paneErr(`add_pane ${id} ${url}`)),
    move: (id: string, x: number, y: number, w: number, h: number): Promise<void> =>
      invoke<void>('move_pane', { id, x, y, w, h }).catch(paneErr(`move_pane ${id}`)),
    close: (id: string): void => {
      void invoke('close_pane', { id }).catch(paneErr('close_pane'))
    },
    setVisible: (id: string, visible: boolean): void => {
      void invoke('set_pane_visible', { id, visible }).catch(paneErr('set_pane_visible'))
    },
    navigate: (id: string, url: string): void => {
      void invoke('pane_navigate', { id, url }).catch(paneErr('pane_navigate'))
    },
    reload: (id: string): void => {
      void invoke('pane_reload', { id }).catch(paneErr('pane_reload'))
    },
    eval: (id: string, js: string): void => {
      void invoke('pane_eval', { id, js }).catch(paneErr('pane_eval'))
    },
    onNavigated: (cb: (e: { id: string; url: string }) => void): (() => void) => {
      paneNavCbs.add(cb)
      return () => void paneNavCbs.delete(cb)
    },
    onTitle: (cb: (e: { id: string; title: string }) => void): (() => void) => {
      paneTitleCbs.add(cb)
      return () => void paneTitleCbs.delete(cb)
    },
    onOpenTab: (cb: (e: { id: string; url: string }) => void): (() => void) => {
      paneOpenTabCbs.add(cb)
      return () => void paneOpenTabCbs.delete(cb)
    },
    onRunBind: (cb: (e: { id: string; combo: string }) => void): (() => void) => {
      paneRunBindCbs.add(cb)
      return () => void paneRunBindCbs.delete(cb)
    },
    onActivate: (cb: (e: { id: string; click: boolean }) => void): (() => void) => {
      paneActivateCbs.add(cb)
      return () => void paneActivateCbs.delete(cb)
    },
    onFocusUrl: (cb: (e: { id: string }) => void): (() => void) => {
      paneFocusUrlCbs.add(cb)
      return () => void paneFocusUrlCbs.delete(cb)
    },
    onWinMotion: (cb: (e: { id: string; act: string }) => void): (() => void) => {
      paneWinMotionCbs.add(cb)
      return () => void paneWinMotionCbs.delete(cb)
    },
    onWinPrefix: (cb: (e: { id: string }) => void): (() => void) => {
      paneWinPrefixCbs.add(cb)
      return () => void paneWinPrefixCbs.delete(cb)
    },
    onVimHello: (cb: (e: { id: string }) => void): (() => void) => {
      paneVimHelloCbs.add(cb)
      return () => void paneVimHelloCbs.delete(cb)
    },
    // Karta, w której gra film/audio, nie może zostać uśpiona przez eco mode.
    onMedia: (cb: (e: { id: string; on: boolean }) => void): (() => void) => {
      paneMediaCbs.add(cb)
      return () => void paneMediaCbs.delete(cb)
    }
  }
}

declare global {
  interface Window {
    api: typeof api
  }
}

window.api = api

export {}
