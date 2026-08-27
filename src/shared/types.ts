// Współdzielone typy między procesem main, preload i rendererem.

import type { AgentToolId } from './agents'

export type PaneMode = 'terminal' | 'browser' | 'viewer' | 'explorer' | 'claude'

export interface PersistedPane {
  id: string
  mode: PaneMode
  url?: string
  dirty: boolean
  title?: string // własny tytuł panelu (chip)
  filePath?: string // plik otwarty w viewerze (np. z eksploratora)
  claudeProfile?: string // wybrane konto agenta (id profilu) dla tego panelu
  claudeCwd?: string // folder projektu, w którym startuje agent (lokalny lub zdalny, gdy agentSsh)
  agentSsh?: string // id połączenia SSH — gdy ustawione, agent działa na zdalnej maszynie
}

// Profil konta agenta AI (zakładka „Agents"). Każdy ma własny, izolowany folder konfiguracji
// (CLAUDE_CONFIG_DIR / CODEX_HOME / XDG_CONFIG_HOME zależnie od narzędzia) w userData, więc konta
// się nie gryzą. `tool` = które CLI (patrz shared/agents.ts). Pole `kind` zostało po starej wersji
// Claude — czytane tylko przy migracji (→ `auth`).
export interface AgentProfile {
  id: string
  name: string
  tool: AgentToolId
  auth: 'login' | 'api' // login = OAuth/login przez CLI; api = klucz w zmiennej apiKeyEnv narzędzia
  apiKey?: string // tylko dla auth === 'api' (trzymany lokalnie, jak hasło SSH)
  dir?: string // stały LOKALNY folder projektu; gdy pusty — panel pyta przy starcie lokalnym
  sshDir?: string // stała ZDALNA ścieżka, w której agent startuje po SSH (gdy pusta → ~)
  kind?: 'login' | 'api' // legacy (stare profile Claude) — tylko do migracji
}

// Stan CLI agenta (czy dana komenda jest na PATH użytkownika).
export interface ClaudeCliStatus {
  installed: boolean
  path?: string
}

// Wpis katalogu (eksplorator plików).
export interface DirEntry {
  name: string
  isDir: boolean
  path: string
}
export interface DirListing {
  path: string
  parent: string | null
  entries: DirEntry[]
}

export interface PersistedWorkspace {
  id: number
  layoutId: string
  panes: PersistedPane[]
  kept: boolean
  name?: string // własna nazwa przestrzeni
}

// Załącznik w notatkach (dowolny plik). Trzymany w userData; tu tylko referencja.
export interface NoteFile {
  name: string
  path: string
  mime: string
}

// Ustawienia RAM (best-effort — progi i mitygacje, nie twardy limit).
export interface RamSettings {
  maxMb: number // docelowy limit RAM aplikacji
  enforce: boolean // przy przekroczeniu: usypiaj karty + blokuj nowe przeglądarki
  sleepInactive: boolean // usypiaj nieaktywne karty po czasie
  sleepAfterMin: number // po ilu minutach bezczynności
  minFreeMb: number // minimalny wolny RAM systemu
  minFreeEnforce: boolean // blokuj nowe przeglądarki gdy wolny RAM poniżej progu
}

// Bieżące zużycie pamięci (z procesu głównego).
export interface RamStats {
  appMb: number // suma working set wszystkich procesów aplikacji
  freeMb: number // wolny RAM systemu
  totalMb: number // całkowity RAM systemu
}

export interface PersistedState {
  notes: string
  notesFiles: NoteFile[]
  current: number
  maxWorkspace: number
  workspaces: Record<number, PersistedWorkspace>
  ecoMode: boolean
  maxLiveBrowsers: number
  binds: Record<string, string> // actionId -> skrót ('' = brak)
  vimBinds: Record<string, string> // vimActionId -> klawisz vima ('' = wyłączony)
  vimMode: boolean
  vimTermExit: 'esc' | 'double-esc' // jak wyjść z INSERT do NORMAL w terminalu
  ram: RamSettings
  forceDark: boolean // wymuszaj prefers-color-scheme: dark na stronach
  autoScrollEnabled: boolean // główny włącznik auto-scrolla (aktywuje binda)
  autoScrollMin: number // dolna granica losowego odstępu (sekundy)
  autoScrollMax: number // górna granica losowego odstępu (sekundy)
  sshConns: SshConnConfig[] // zapisane połączenia SSH (zakładka SSH)
  autoApproveEnabled: boolean // główny włącznik auto-approve (aktywuje binda)
  autoApproveMin: number // dolna granica losowego odstępu między Enterami (sekundy)
  autoApproveMax: number // górna granica losowego odstępu między Enterami (sekundy)
  claudeEnabled: boolean // czy pokazać 5. tryb (Agents) w pasku trybów
  claudeProfiles: AgentProfile[] // zapisane konta agentów AI (zakładka „Agents")
}

export interface PtyEnsureOpts {
  cols: number
  rows: number
  cwd?: string
  // Gdy ustawione: sesja startuje jako agent AI — izolowany config-dir per profil + auto-odpalenie
  // komendy narzędzia; apiKey trafia do env (apiKeyEnv narzędzia) gdy profil typu „api".
  // `ssh` (komenda połączenia) → agent uruchamiany na zdalnej maszynie zamiast lokalnie.
  agent?: { profileId: string; toolId: string; apiKey?: string; ssh?: { command: string } }
}

export interface PtyDataEvent {
  id: string
  data: string
}

export interface PtyExitEvent {
  id: string
  exitCode: number
}

// Nazwy kanałów IPC w jednym miejscu — chroni przed literówkami.
export const IPC = {
  ptyEnsure: 'pty:ensure',
  ptyInput: 'pty:input',
  ptyResize: 'pty:resize',
  ptyKill: 'pty:kill',
  ptyData: 'pty:data',
  ptyExit: 'pty:exit',
  storeLoad: 'store:load',
  storeSave: 'store:save',
  dialogSaveNotes: 'dialog:saveNotes',
  dialogOpenFile: 'dialog:openFile',
  fileRead: 'file:read',
  fileSave: 'file:save',
  readDir: 'file:readDir',
  deletePath: 'file:delete',
  makeDir: 'file:mkdir',
  makeFile: 'file:create',
  sshConnect: 'ssh:connect',
  sshDisconnect: 'ssh:disconnect',
  sshReadDir: 'ssh:readDir',
  sshReadFile: 'ssh:readFile',
  sshWriteFile: 'ssh:writeFile',
  sshMakeDir: 'ssh:mkdir',
  sshMakeFile: 'ssh:create',
  sshDelete: 'ssh:delete',
  saveAttachment: 'notes:saveAttachment',
  readDataUrl: 'file:readDataUrl',
  dialogSaveAs: 'dialog:saveAs',
  dialogOpenDir: 'dialog:openDir',
  agentStatus: 'agent:status',
  agentInstall: 'agent:install',
  agentSshSync: 'agent:sshSync',
  agentSshProgress: 'agent:sshProgress',
  ramStats: 'ram:stats',
  setDark: 'theme:setDark'
} as const

// Polecenie połączenia SSH przekazywane do main. `command` w stylu powłoki:
//   ssh user@host -p 2222   |   ssh vps   (alias z ~/.ssh/config)
// `password` opcjonalne (gdy brak — próbujemy klucza z ~/.ssh/config lub agenta SSH).
export interface SshConfig {
  command: string
  password?: string
}

// Zapisane połączenie SSH (zakładka SSH w ustawieniach; trzymane w persiście — userData, lokalnie).
export interface SshConnConfig {
  id: string
  name: string
  command: string
  password?: string
}

// Wynik nawiązania połączenia SSH.
export interface SshResult {
  ok: boolean
  id?: string
  home?: string
  label?: string
  error?: string
}

// Plik wczytany do viewera (zwracany przez main jako base64).
export interface LoadedFile {
  name: string
  ext: string
  base64: string
  path: string
}
