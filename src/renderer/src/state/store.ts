import { create } from 'zustand'
import { getPreset } from '../layouts/presets'
import { DEFAULT_BINDS } from '../shortcuts/binds'
import { DEFAULT_VIM_BINDS } from '../../../shared/vimKeys'
import type {
  PaneMode,
  PersistedState,
  PersistedWorkspace,
  NoteFile,
  RamSettings,
  RamStats,
  SshConnConfig,
  AgentProfile
} from '../../../shared/types'
import type { AgentToolId } from '../../../shared/agents'

// Domyślne ustawienia RAM (zgodne z DEFAULT_STATE w mainie).
const DEFAULT_RAM: RamSettings = {
  maxMb: 4096,
  enforce: false,
  sleepInactive: true,
  sleepAfterMin: 5,
  minFreeMb: 1024,
  minFreeEnforce: false
}

/** Czy przekroczono progi RAM (włączony enforce) — sterują wskaźnikiem i blokadami. */
export function isRamOver(ram: RamSettings, stats: RamStats | null): boolean {
  if (!stats) return false
  if (ram.enforce && stats.appMb > ram.maxMb) return true
  if (ram.minFreeEnforce && stats.freeMb < ram.minFreeMb) return true
  return false
}

export interface Pane {
  id: string
  mode: PaneMode
  ptyId?: string // żywy proces PTY (jeśli terminal kiedykolwiek wystartował)
  dirty: boolean // ma jakąkolwiek historię (wejście lub output) — chroni przed ubiciem
  url?: string
  title?: string // własny tytuł panelu (chip w rogu)
  filePath?: string // plik do pokazania w viewerze (np. otwarty z eksploratora)
  remoteConn?: string // id połączenia SSH — gdy ustawione, viewer czyta/zapisuje plik przez SFTP
  claudeProfile?: string // wybrane konto agenta (id profilu) dla tego panelu
  claudeCwd?: string // folder projektu (lokalny lub zdalny, gdy agentSsh)
  agentSsh?: string // id połączenia SSH — gdy ustawione, agent działa zdalnie
}

export interface Workspace {
  id: number
  layoutId: string
  panes: Pane[]
  mounted: boolean
  kept: boolean // true gdy coś w niej zrobiono -> nie kasujemy przy wyjściu
  name?: string // własna nazwa przestrzeni
}

interface State {
  workspaces: Record<number, Workspace>
  current: number
  maxWorkspace: number
  activePaneId: string | null
  paneHistory: string[] // panele wg ostatniego użycia (MRU), najnowszy z przodu
  notesOpen: boolean
  notes: string
  notesFiles: NoteFile[]
  layoutPickerOpen: boolean
  settingsOpen: boolean
  ecoMode: boolean
  maxLiveBrowsers: number
  binds: Record<string, string>
  vimBinds: Record<string, string> // konfigurowalny keymap vima (vimActionId -> klawisz)
  winPending: boolean // czeka na drugi klawisz prefiksu Ctrl-w (do statusline)
  activeVimMode: 'insert' | 'normal' // tryb aktywnego terminala (do statusline)
  vimMode: boolean
  vimTermExit: 'esc' | 'double-esc' // jak wyjść z INSERT do NORMAL w terminalu
  forceDark: boolean // wymuszaj dark (prefers-color-scheme) na stronach
  gotoOpen: boolean // czy pokazać pole "skok do workspace" w przełączniku
  autoScrollEnabled: boolean // główny włącznik auto-scrolla (gate na binda)
  autoScrollMin: number // dolna granica losowego odstępu (sekundy)
  autoScrollMax: number // górna granica losowego odstępu (sekundy)
  autoScrollIds: string[] // panele z włączonym auto-scrollem (runtime, bez persistencji)
  ram: RamSettings
  ramStats: RamStats | null
  ramPanelOpen: boolean
  sshConns: SshConnConfig[] // zapisane połączenia SSH (zakładka SSH)
  settingsTab: string | null // gdy ustawione, SettingsModal otwiera się na tej zakładce
  findOpen: boolean // czy pokazać pasek wyszukiwania (Ctrl/⌘+F) nad aktywnym panelem
  autoApproveEnabled: boolean // główny włącznik auto-approve (gate na binda)
  autoApproveMin: number // dolna granica losowego odstępu między Enterami (sekundy)
  autoApproveMax: number // górna granica losowego odstępu między Enterami (sekundy)
  autoApproveIds: string[] // terminale z włączonym auto-approve (runtime, bez persistencji)
  zoomPaneId: string | null // panel rozciągnięty na całą przestrzeń (runtime, bez persistencji)
  claudeEnabled: boolean // czy pokazać 5. tryb (Agents) w pasku trybów
  claudeProfiles: AgentProfile[] // zapisane konta agentów AI (zakładka „Agents")

  initFromPersisted: (s: PersistedState) => void
  setFindOpen: (v: boolean) => void
  setAutoApproveEnabled: (v: boolean) => void
  setAutoApproveMin: (n: number) => void
  setAutoApproveMax: (n: number) => void
  toggleAutoApprove: (paneId: string) => void
  setClaudeEnabled: (v: boolean) => void
  addClaudeProfile: (p: AgentProfile) => void
  updateClaudeProfile: (id: string, patch: Partial<AgentProfile>) => void
  removeClaudeProfile: (id: string) => void
  setPaneClaude: (paneId: string, profileId: string, cwd: string, sshConnId?: string) => void
  addSshConn: (c: SshConnConfig) => void
  updateSshConn: (id: string, patch: Partial<SshConnConfig>) => void
  removeSshConn: (id: string) => void
  openSettingsTab: (tab: string) => void
  clearSettingsTab: () => void
  gotoWorkspace: (n: number) => void
  nextWorkspace: () => void
  prevWorkspace: () => void
  setVimTermExit: (v: 'esc' | 'double-esc') => void
  setForceDark: (v: boolean) => void
  setGotoOpen: (open: boolean) => void
  setAutoScrollEnabled: (v: boolean) => void
  setAutoScrollMin: (n: number) => void
  setAutoScrollMax: (n: number) => void
  toggleAutoScroll: (paneId: string) => void
  setPaneTitle: (paneId: string, title: string) => void
  setWorkspaceName: (id: number, name: string) => void
  killWorkspace: () => void
  killPane: (id?: string) => void
  setActivePane: (id: string) => void
  setLayout: (layoutId: string) => void
  setActivePaneMode: (mode: PaneMode) => void
  openFileInPane: (paneId: string, filePath: string, remoteConn?: string) => void
  markPaneDirty: (paneId: string) => void
  setPanePty: (paneId: string, ptyId: string) => void
  setPaneUrl: (paneId: string, url: string) => void
  toggleNotes: () => void
  setLayoutPickerOpen: (open: boolean) => void
  toggleSettings: () => void
  setSettingsOpen: (open: boolean) => void
  setNotes: (text: string) => void
  clearNotes: () => void
  addNotesFile: (file: NoteFile) => void
  removeNotesFile: (index: number) => void
  setEcoMode: (v: boolean) => void
  setMaxLiveBrowsers: (n: number) => void
  setBind: (actionId: string, combo: string) => void
  resetBinds: () => void
  setVimMode: (v: boolean) => void
  setVimBind: (actionId: string, key: string) => void
  resetVimBinds: () => void
  setWinPending: (v: boolean) => void
  setActiveVimMode: (m: 'insert' | 'normal') => void
  toggleZoomPane: (paneId: string) => void
  setRam: (patch: Partial<RamSettings>) => void
  setRamStats: (s: RamStats) => void
  setRamPanelOpen: (open: boolean) => void
}

let seq = 0
const genId = (): string => 'p' + Date.now().toString(36) + (seq++).toString(36)

const DEFAULT_URL = 'https://duckduckgo.com'

function freshPane(mode: PaneMode = 'terminal'): Pane {
  return { id: genId(), mode, dirty: false }
}

function freshWorkspace(id: number): Workspace {
  return { id, layoutId: '1', panes: [freshPane()], mounted: false, kept: false }
}

const kill = (id?: string): void => {
  if (id) window.api.pty.kill(id)
}

// Debounce zapisu stanu na dysk.
let saveTimer: ReturnType<typeof setTimeout> | null = null
function schedulePersist(get: () => State): void {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    const s = get()
    const workspaces: Record<number, PersistedWorkspace> = {}
    for (const [k, w] of Object.entries(s.workspaces)) {
      workspaces[Number(k)] = {
        id: w.id,
        layoutId: w.layoutId,
        kept: w.kept,
        name: w.name,
        panes: w.panes.map((p) => ({
          id: p.id,
          mode: p.mode,
          url: p.url,
          title: p.title,
          filePath: p.filePath,
          claudeProfile: p.claudeProfile,
          claudeCwd: p.claudeCwd,
          agentSsh: p.agentSsh,
          dirty: p.dirty
        }))
      }
    }
    const payload: PersistedState = {
      notes: s.notes,
      notesFiles: s.notesFiles,
      current: s.current,
      maxWorkspace: s.maxWorkspace,
      workspaces,
      ecoMode: s.ecoMode,
      maxLiveBrowsers: s.maxLiveBrowsers,
      binds: s.binds,
      vimBinds: s.vimBinds,
      vimMode: s.vimMode,
      vimTermExit: s.vimTermExit,
      ram: s.ram,
      forceDark: s.forceDark,
      autoScrollEnabled: s.autoScrollEnabled,
      autoScrollMin: s.autoScrollMin,
      autoScrollMax: s.autoScrollMax,
      sshConns: s.sshConns,
      autoApproveEnabled: s.autoApproveEnabled,
      autoApproveMin: s.autoApproveMin,
      autoApproveMax: s.autoApproveMax,
      claudeEnabled: s.claudeEnabled,
      claudeProfiles: s.claudeProfiles
    }
    window.api.store.save(payload)
  }, 400)
}

export const useStore = create<State>((set, get) => ({
  workspaces: { 1: { ...freshWorkspace(1), mounted: true } },
  current: 1,
  maxWorkspace: 1,
  activePaneId: null,
  paneHistory: [],
  notesOpen: false,
  notes: '',
  notesFiles: [],
  layoutPickerOpen: false,
  settingsOpen: false,
  ecoMode: false,
  maxLiveBrowsers: 3,
  binds: { ...DEFAULT_BINDS },
  vimBinds: { ...DEFAULT_VIM_BINDS },
  winPending: false,
  activeVimMode: 'insert',
  vimMode: false,
  vimTermExit: 'esc',
  forceDark: false,
  gotoOpen: false,
  autoScrollEnabled: false,
  autoScrollMin: 15,
  autoScrollMax: 30,
  autoScrollIds: [],
  ram: { ...DEFAULT_RAM },
  ramStats: null,
  ramPanelOpen: false,
  sshConns: [],
  settingsTab: null,
  findOpen: false,
  autoApproveEnabled: false,
  autoApproveMin: 5,
  autoApproveMax: 8,
  autoApproveIds: [],
  zoomPaneId: null,
  claudeEnabled: false,
  claudeProfiles: [],

  setFindOpen: (v) => set({ findOpen: v }),
  // Główny włącznik: gdy gasimy, zatrzymujemy też wszystkie jadące terminale.
  setAutoApproveEnabled: (v) => {
    set((s) => ({ autoApproveEnabled: v, autoApproveIds: v ? s.autoApproveIds : [] }))
    schedulePersist(get)
  },
  setAutoApproveMin: (n) => {
    set((s) => {
      const min = Math.max(1, Math.round(n) || 1)
      return { autoApproveMin: min, autoApproveMax: Math.max(min, s.autoApproveMax) }
    })
    schedulePersist(get)
  },
  setAutoApproveMax: (n) => {
    set((s) => {
      const max = Math.max(1, Math.round(n) || 1)
      return { autoApproveMax: max, autoApproveMin: Math.min(max, s.autoApproveMin) }
    })
    schedulePersist(get)
  },
  // Włącz/wyłącz auto-approve na terminalu (Enter co losowy odstęp). Runtime — nie zapisujemy.
  toggleAutoApprove: (paneId) =>
    set((s) => ({
      autoApproveIds: s.autoApproveIds.includes(paneId)
        ? s.autoApproveIds.filter((id) => id !== paneId)
        : [...s.autoApproveIds, paneId]
    })),

  // --- Claude Code (5. tryb panelu) ---
  setClaudeEnabled: (v) => {
    set({ claudeEnabled: v })
    schedulePersist(get)
  },
  addClaudeProfile: (p) => {
    set((s) => ({ claudeProfiles: [...s.claudeProfiles, p] }))
    schedulePersist(get)
  },
  updateClaudeProfile: (id, patch) => {
    set((s) => ({
      claudeProfiles: s.claudeProfiles.map((c) => (c.id === id ? { ...c, ...patch } : c))
    }))
    schedulePersist(get)
  },
  removeClaudeProfile: (id) => {
    set((s) => ({ claudeProfiles: s.claudeProfiles.filter((c) => c.id !== id) }))
    schedulePersist(get)
  },
  // Ustawia konto + folder projektu (+ opcjonalne połączenie SSH) dla panelu agenta.
  setPaneClaude: (paneId, profileId, cwd, sshConnId) => {
    const { current, workspaces } = get()
    const w = workspaces[current]
    if (!w) return
    const panes = w.panes.map((p) =>
      p.id === paneId
        ? { ...p, claudeProfile: profileId, claudeCwd: cwd, agentSsh: sshConnId || undefined }
        : p
    )
    set({ workspaces: { ...workspaces, [current]: { ...w, panes, kept: true } } })
    schedulePersist(get)
  },

  initFromPersisted: (s) => {
    const workspaces: Record<number, Workspace> = {}
    for (const [k, w] of Object.entries(s.workspaces)) {
      const id = Number(k)
      workspaces[id] = {
        id,
        layoutId: w.layoutId,
        kept: w.kept,
        mounted: id === s.current,
        name: w.name,
        // Terminale startują na czysto po restarcie (procesy PTY nie przeżywają zamknięcia).
        panes: w.panes.map((p) => ({
          id: p.id,
          mode: p.mode,
          url: p.url,
          title: p.title,
          filePath: p.filePath,
          claudeProfile: p.claudeProfile,
          claudeCwd: p.claudeCwd,
          agentSsh: p.agentSsh,
          dirty: false
        }))
      }
    }
    if (!workspaces[s.current]) workspaces[s.current] = { ...freshWorkspace(s.current), mounted: true }
    const first = workspaces[s.current].panes[0]
    set({
      workspaces,
      current: s.current,
      maxWorkspace: Math.max(s.maxWorkspace, s.current),
      notes: s.notes,
      notesFiles: s.notesFiles ?? [],
      ecoMode: s.ecoMode,
      maxLiveBrowsers: s.maxLiveBrowsers ?? 3,
      // Domyślne bindy + zapisane nadpisania usera (puste = świadomie wyczyszczone).
      binds: { ...DEFAULT_BINDS, ...(s.binds ?? {}) },
      vimBinds: { ...DEFAULT_VIM_BINDS, ...(s.vimBinds ?? {}) },
      vimMode: s.vimMode ?? false,
      vimTermExit: s.vimTermExit === 'double-esc' ? 'double-esc' : 'esc', // 'click' (usunięte) -> 'esc'
      forceDark: s.forceDark ?? false,
      autoScrollEnabled: s.autoScrollEnabled ?? false,
      autoScrollMin: s.autoScrollMin ?? 15,
      autoScrollMax: s.autoScrollMax ?? 30,
      sshConns: s.sshConns ?? [],
      autoApproveEnabled: s.autoApproveEnabled ?? false,
      autoApproveMin: s.autoApproveMin ?? 5,
      autoApproveMax: s.autoApproveMax ?? 8,
      claudeEnabled: s.claudeEnabled ?? false,
      // Migracja: stare profile Claude (kind:'login'|'api', bez tool) → tool:'claude', auth z kind.
      claudeProfiles: (s.claudeProfiles ?? []).map((p) => ({
        ...p,
        tool: (p.tool ?? 'claude') as AgentToolId,
        auth: p.auth ?? p.kind ?? 'login'
      })),
      ram: { ...DEFAULT_RAM, ...(s.ram ?? {}) },
      activePaneId: first ? first.id : null,
      paneHistory: first ? [first.id] : []
    })
  },

  gotoWorkspace: (n) => {
    const target = Math.max(1, n)
    const { current, workspaces } = get()
    if (target === current) return

    const next = { ...workspaces }

    // Sprzątanie opuszczanej przestrzeni: tylko gdy całkowicie nietknięta.
    const leaving = next[current]
    if (leaving) {
      const used = leaving.kept || leaving.panes.some((p) => p.dirty)
      if (used) {
        // Używana przestrzeń ZOSTAJE zamontowana (ukryta) — inaczej webview by się
        // odmontował i strony ładowałyby się od nowa po powrocie.
        next[current] = { ...leaving, mounted: true }
      } else {
        // Zwalniamy zasoby i resetujemy do świeżej, pustej przestrzeni.
        leaving.panes.forEach((p) => kill(p.ptyId))
        next[current] = { ...freshWorkspace(current), mounted: false }
      }
    }

    // Tworzymy docelową przestrzeń jeśli nie istnieje (lazy).
    const targetWs = next[target] ?? freshWorkspace(target)
    next[target] = { ...targetWs, mounted: true }

    const first = next[target].panes[0]
    set({
      workspaces: next,
      current: target,
      maxWorkspace: Math.max(get().maxWorkspace, target),
      activePaneId: first ? first.id : null,
      paneHistory: first ? [first.id] : [], // MRU liczone w obrębie przestrzeni
      // Zoom zdejmujemy przy zmianie przestrzeni — inaczej po powrocie panel z zoomem
      // przykrywałby siatkę, a fokus siedziałby w panelu schowanym pod spodem.
      zoomPaneId: null
    })
    schedulePersist(get)
  },

  nextWorkspace: () => get().gotoWorkspace(get().current + 1),
  prevWorkspace: () => get().gotoWorkspace(get().current - 1),

  setVimTermExit: (v) => {
    set({ vimTermExit: v })
    schedulePersist(get)
  },
  setForceDark: (v) => {
    set({ forceDark: v })
    schedulePersist(get)
  },
  setGotoOpen: (open) => set({ gotoOpen: open }),

  addSshConn: (c) => {
    set((s) => ({ sshConns: [...s.sshConns, c] }))
    schedulePersist(get)
  },
  updateSshConn: (id, patch) => {
    set((s) => ({ sshConns: s.sshConns.map((c) => (c.id === id ? { ...c, ...patch } : c)) }))
    schedulePersist(get)
  },
  removeSshConn: (id) => {
    set((s) => ({ sshConns: s.sshConns.filter((c) => c.id !== id) }))
    schedulePersist(get)
  },
  openSettingsTab: (tab) => set({ settingsOpen: true, settingsTab: tab }),
  clearSettingsTab: () => set({ settingsTab: null }),

  // Główny włącznik: gdy gasimy, zatrzymujemy też wszystkie jadące panele.
  setAutoScrollEnabled: (v) => {
    set((s) => ({ autoScrollEnabled: v, autoScrollIds: v ? s.autoScrollIds : [] }))
    schedulePersist(get)
  },
  setAutoScrollMin: (n) => {
    set((s) => {
      const min = Math.max(1, Math.round(n) || 1)
      return { autoScrollMin: min, autoScrollMax: Math.max(min, s.autoScrollMax) }
    })
    schedulePersist(get)
  },
  setAutoScrollMax: (n) => {
    set((s) => {
      const max = Math.max(1, Math.round(n) || 1)
      return { autoScrollMax: max, autoScrollMin: Math.min(max, s.autoScrollMin) }
    })
    schedulePersist(get)
  },
  // Włącz/wyłącz auto-scroll na panelu (reels/shorts same lecą w dół). Runtime — nie zapisujemy.
  toggleAutoScroll: (paneId) =>
    set((s) => ({
      autoScrollIds: s.autoScrollIds.includes(paneId)
        ? s.autoScrollIds.filter((id) => id !== paneId)
        : [...s.autoScrollIds, paneId]
    })),

  setPaneTitle: (paneId, title) => {
    const { current, workspaces } = get()
    const w = workspaces[current]
    if (!w) return
    const trimmed = title.trim()
    const panes = w.panes.map((p) =>
      p.id === paneId ? { ...p, title: trimmed || undefined } : p
    )
    set({ workspaces: { ...workspaces, [current]: { ...w, panes, kept: true } } })
    schedulePersist(get)
  },

  setWorkspaceName: (id, name) => {
    const { workspaces } = get()
    const w = workspaces[id]
    if (!w) return
    const trimmed = name.trim()
    set({
      workspaces: { ...workspaces, [id]: { ...w, name: trimmed || undefined, kept: true } }
    })
    schedulePersist(get)
  },

  // Ubija CAŁĄ bieżącą przestrzeń: wszystkie PTY + podmiana na świeżą (czysta pamięć).
  killWorkspace: () => {
    const { current, workspaces } = get()
    const w = workspaces[current]
    const deadIds = w ? new Set(w.panes.map((p) => p.id)) : new Set<string>()
    if (w) w.panes.forEach((p) => kill(p.ptyId))
    const fresh = { ...freshWorkspace(current), mounted: true }
    const first = fresh.panes[0]
    set((s) => ({
      workspaces: { ...workspaces, [current]: fresh },
      activePaneId: first ? first.id : null,
      paneHistory: first ? [first.id] : [],
      autoScrollIds: s.autoScrollIds.filter((id) => !deadIds.has(id)),
      autoApproveIds: s.autoApproveIds.filter((id) => !deadIds.has(id)),
      zoomPaneId: s.zoomPaneId && deadIds.has(s.zoomPaneId) ? null : s.zoomPaneId
    }))
    schedulePersist(get)
  },

  // Ubija pojedynczy panel (domyślnie aktywny): PTY + podmiana na świeży w tym samym miejscu.
  // Nowe id wymusza remount = czysta historia/url/tytuł.
  killPane: (id) => {
    const { current, workspaces, activePaneId } = get()
    const target = id ?? activePaneId
    const w = workspaces[current]
    if (!w || !target) return
    const idx = w.panes.findIndex((p) => p.id === target)
    if (idx < 0) return
    kill(w.panes[idx].ptyId)
    const replacement = freshPane()
    const panes = w.panes.map((p, i) => (i === idx ? replacement : p))
    set((s) => ({
      workspaces: { ...workspaces, [current]: { ...w, panes } },
      activePaneId: replacement.id,
      paneHistory: [replacement.id, ...s.paneHistory.filter((p) => p !== target)].slice(0, 32),
      autoScrollIds: s.autoScrollIds.filter((id) => id !== target),
      autoApproveIds: s.autoApproveIds.filter((id) => id !== target),
      zoomPaneId: s.zoomPaneId === target ? null : s.zoomPaneId
    }))
    schedulePersist(get)
  },

  setActivePane: (id) =>
    set((s) => {
      if (s.activePaneId === id) return {}
      // Aktualizacja historii MRU: najnowszy z przodu, bez duplikatów.
      const paneHistory = [id, ...s.paneHistory.filter((p) => p !== id)].slice(0, 32)
      // Przejście na inny panel zdejmuje zoom (jak w tmuxie) — bez tego fokus lądowałby
      // w panelu ukrytym pod rozciągniętym.
      return { activePaneId: id, paneHistory, zoomPaneId: s.zoomPaneId === id ? id : null }
    }),

  setLayout: (layoutId) => {
    const preset = getPreset(layoutId)
    const { current, workspaces, activePaneId } = get()
    const w = workspaces[current]
    if (!w) return
    const panes = [...w.panes]

    if (preset.paneCount > panes.length) {
      while (panes.length < preset.paneCount) panes.push(freshPane())
    } else if (preset.paneCount < panes.length) {
      // Usuwane panele zwalniają swoje procesy (świadoma akcja użytkownika).
      const removed = panes.splice(preset.paneCount)
      removed.forEach((p) => kill(p.ptyId))
    }

    const stillActive = panes.some((p) => p.id === activePaneId)
    set({
      workspaces: { ...workspaces, [current]: { ...w, layoutId, panes } },
      activePaneId: stillActive ? activePaneId : panes[0]?.id ?? null,
      // Bez tego nowy układ byłby całkowicie przykryty przez panel trzymający zoom.
      zoomPaneId: null
    })
    schedulePersist(get)
  },

  setActivePaneMode: (mode) => {
    const { current, workspaces, activePaneId, ram, ramStats } = get()
    const w = workspaces[current]
    if (!w || !activePaneId) return
    // Egzekwowanie RAM: nie pozwalamy odpalić nowej przeglądarki po przekroczeniu progu.
    const cur = w.panes.find((p) => p.id === activePaneId)
    if (mode === 'browser' && cur?.mode !== 'browser' && isRamOver(ram, ramStats)) {
      set({ ramPanelOpen: true })
      return
    }
    const panes = w.panes.map((p) => {
      if (p.id !== activePaneId || p.mode === mode) return p
      // Opuszczamy terminal: dziewiczy (bez historii) ubijamy, z historią zostawiamy w tle.
      if (p.mode === 'terminal' && mode !== 'terminal') {
        if (!p.dirty) kill(p.ptyId)
        return {
          ...p,
          mode,
          ptyId: p.dirty ? p.ptyId : undefined,
          url: mode === 'browser' ? p.url ?? DEFAULT_URL : p.url
        }
      }
      // -> terminal (PaneGrid ponownie zamontuje xterm; ensure odtworzy/utworzy PTY).
      return { ...p, mode }
    })
    // Auto-approve dotyczy tylko terminala — gaśnie, gdy panel przestaje nim być.
    set((s) => ({
      workspaces: { ...workspaces, [current]: { ...w, panes } },
      autoApproveIds:
        mode !== 'terminal' ? s.autoApproveIds.filter((id) => id !== activePaneId) : s.autoApproveIds
    }))
    schedulePersist(get)
  },

  // Otwórz plik w danym panelu: przełącz go w viewer i ustaw ścieżkę (z eksploratora).
  // remoteConn (id SSH) → viewer wczyta/zapisze plik przez SFTP zamiast lokalnie.
  openFileInPane: (paneId, filePath, remoteConn) => {
    const { current, workspaces } = get()
    const w = workspaces[current]
    if (!w) return
    const panes = w.panes.map((p) =>
      p.id === paneId ? { ...p, mode: 'viewer' as PaneMode, filePath, remoteConn } : p
    )
    set({ workspaces: { ...workspaces, [current]: { ...w, panes, kept: true } } })
    schedulePersist(get)
  },

  markPaneDirty: (paneId) => {
    const { current, workspaces } = get()
    const w = workspaces[current]
    if (!w) return
    const pane = w.panes.find((p) => p.id === paneId)
    if (!pane || pane.dirty) return
    const panes = w.panes.map((p) => (p.id === paneId ? { ...p, dirty: true } : p))
    set({ workspaces: { ...workspaces, [current]: { ...w, panes, kept: true } } })
    schedulePersist(get)
  },

  setPanePty: (paneId, ptyId) => {
    const { current, workspaces } = get()
    const w = workspaces[current]
    if (!w) return
    const panes = w.panes.map((p) => (p.id === paneId ? { ...p, ptyId } : p))
    set({ workspaces: { ...workspaces, [current]: { ...w, panes } } })
  },

  setPaneUrl: (paneId, url) => {
    const { current, workspaces } = get()
    const w = workspaces[current]
    if (!w) return
    const panes = w.panes.map((p) => (p.id === paneId ? { ...p, url } : p))
    set({ workspaces: { ...workspaces, [current]: { ...w, panes, kept: true } } })
    schedulePersist(get)
  },

  toggleNotes: () => set((s) => ({ notesOpen: !s.notesOpen })),
  setLayoutPickerOpen: (open) => set({ layoutPickerOpen: open }),
  toggleSettings: () => set((s) => ({ settingsOpen: !s.settingsOpen })),
  setSettingsOpen: (open) => set({ settingsOpen: open }),

  setNotes: (text) => {
    set({ notes: text })
    schedulePersist(get)
  },
  clearNotes: () => {
    set({ notes: '', notesFiles: [] })
    schedulePersist(get)
  },

  addNotesFile: (file) => {
    set((s) => ({ notesFiles: [...s.notesFiles, file] }))
    schedulePersist(get)
  },
  removeNotesFile: (index) => {
    set((s) => ({ notesFiles: s.notesFiles.filter((_, i) => i !== index) }))
    schedulePersist(get)
  },

  setEcoMode: (v) => {
    set({ ecoMode: v })
    schedulePersist(get)
  },

  setMaxLiveBrowsers: (n) => {
    set({ maxLiveBrowsers: Math.max(1, Math.min(6, Math.round(n) || 1)) })
    schedulePersist(get)
  },

  setBind: (actionId, combo) => {
    set((s) => ({ binds: { ...s.binds, [actionId]: combo } }))
    schedulePersist(get)
  },
  resetBinds: () => {
    set({ binds: { ...DEFAULT_BINDS } })
    schedulePersist(get)
  },

  setVimMode: (v) => {
    set({ vimMode: v })
    schedulePersist(get)
  },

  setVimBind: (actionId, key) => {
    set((s) => ({ vimBinds: { ...s.vimBinds, [actionId]: key } }))
    schedulePersist(get)
  },
  resetVimBinds: () => {
    set({ vimBinds: { ...DEFAULT_VIM_BINDS } })
    schedulePersist(get)
  },
  setWinPending: (v) => set({ winPending: v }),
  setActiveVimMode: (m) => set({ activeVimMode: m }),
  toggleZoomPane: (paneId) =>
    set((s) => ({ zoomPaneId: s.zoomPaneId === paneId ? null : paneId })),

  setRam: (patch) => {
    set((s) => ({ ram: { ...s.ram, ...patch } }))
    schedulePersist(get)
  },
  setRamStats: (s) => set({ ramStats: s }),
  setRamPanelOpen: (open) => set({ ramPanelOpen: open })
}))
