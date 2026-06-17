import { useStore } from '../state/store'
import { FIND_FOCUS_EVENT } from './find'
import type { PaneMode } from '../../../shared/types'

// Komendy kart przeglądarki obsługuje aktywny BrowserPane (nasłuchuje tego eventu).
export type PaneCmd = 'tab.new' | 'tab.close' | 'tab.next' | 'tab.prev'
export const PANE_CMD_EVENT = 'vibe-pane-cmd'
function dispatchPaneCmd(cmd: PaneCmd): void {
  window.dispatchEvent(new CustomEvent(PANE_CMD_EVENT, { detail: cmd }))
}

// Komendy eksploratora obsługuje aktywny ExplorerPane (back/forward/home/focusPath).
export const EXPLORER_CMD_EVENT = 'vibe-explorer-cmd'
function dispatchExplorerCmd(cmd: string): void {
  window.dispatchEvent(new CustomEvent(EXPLORER_CMD_EVENT, { detail: cmd }))
}

/** Indeks aktywnego panelu w bieżącej przestrzeni (0 gdy brak). */
export function currentIndex(): number {
  const s = useStore.getState()
  const ws = s.workspaces[s.current]
  if (!ws) return 0
  const i = ws.panes.findIndex((p) => p.id === s.activePaneId)
  return i < 0 ? 0 : i
}

export function focusPaneIndex(i: number): void {
  const s = useStore.getState()
  const ws = s.workspaces[s.current]
  const pane = ws?.panes[i]
  if (pane) s.setActivePane(pane.id)
}

// ===================== Nawigacja oknami (Ctrl-w) =====================

let winTimer: ReturnType<typeof setTimeout> | null = null

/** Uzbraja prefiks Ctrl-w (do statusline) z bezpiecznym timeoutem, gdyby drugi klawisz nie padł. */
export function armWinPending(): void {
  useStore.getState().setWinPending(true)
  if (winTimer) clearTimeout(winTimer)
  winTimer = setTimeout(() => useStore.getState().setWinPending(false), 2200)
}

export function clearWinPending(): void {
  if (winTimer) {
    clearTimeout(winTimer)
    winTimer = null
  }
  useStore.getState().setWinPending(false)
}

/** Przeskok fokusu do panelu w danym kierunku — z geometrii widocznej siatki (DOM rects). */
export function focusPaneDirection(dir: 'left' | 'down' | 'up' | 'right'): void {
  const s = useStore.getState()
  const vis = Array.from(document.querySelectorAll<HTMLElement>('.pane[data-pane-id]'))
    .map((el) => ({ id: el.dataset.paneId as string, r: el.getBoundingClientRect() }))
    .filter((p) => p.r.width > 1 && p.r.height > 1) // ukryte workspace mają rect 0
  const cur = vis.find((p) => p.id === s.activePaneId)
  if (!cur) return
  const cx = cur.r.left + cur.r.width / 2
  const cy = cur.r.top + cur.r.height / 2
  let best: { id: string; score: number } | null = null
  for (const p of vis) {
    if (p.id === cur.id) continue
    const dx = p.r.left + p.r.width / 2 - cx
    const dy = p.r.top + p.r.height / 2 - cy
    let primary: number
    let cross: number
    if (dir === 'left') {
      if (dx >= -1) continue
      primary = -dx
      cross = Math.abs(dy)
    } else if (dir === 'right') {
      if (dx <= 1) continue
      primary = dx
      cross = Math.abs(dy)
    } else if (dir === 'up') {
      if (dy >= -1) continue
      primary = -dy
      cross = Math.abs(dx)
    } else {
      if (dy <= 1) continue
      primary = dy
      cross = Math.abs(dx)
    }
    const score = primary + cross * 2 // preferuj panele leżące w linii kierunku
    if (!best || score < best.score) best = { id: p.id, score }
  }
  if (best) s.setActivePane(best.id)
}

/** Wykonuje akcję nawigacji oknami (drugi klawisz po Ctrl-w). */
export function runWindowMotion(actionId: string): void {
  clearWinPending()
  const s = useStore.getState()
  switch (actionId) {
    case 'win.focusLeft':
      return focusPaneDirection('left')
    case 'win.focusDown':
      return focusPaneDirection('down')
    case 'win.focusUp':
      return focusPaneDirection('up')
    case 'win.focusRight':
      return focusPaneDirection('right')
    case 'win.cycle': {
      const ws = s.workspaces[s.current]
      const n = ws?.panes.length ?? 0
      if (n > 1) focusPaneIndex((currentIndex() + 1) % n)
      return
    }
    case 'win.cyclePrev': {
      const ws = s.workspaces[s.current]
      const n = ws?.panes.length ?? 0
      if (n > 1) focusPaneIndex((currentIndex() - 1 + n) % n)
      return
    }
    case 'win.close':
      if (confirm('Kill the active pane? Its terminal/browser history will be wiped.')) s.killPane()
      return
    case 'win.splitDown':
      return s.setLayout('2-rows')
    case 'win.splitRight':
      return s.setLayout('2-cols')
    case 'win.only':
      return s.setLayout('1')
  }
}

// Cykl trybu aktywnego panelu: terminal → browser → viewer → explorer → (claude). Claude wchodzi
// do cyklu tylko gdy włączony w ustawieniach (checkbox) — by cykl nie wpadał w ukryty tryb.
export function cyclePaneMode(): void {
  const s = useStore.getState()
  const ws = s.workspaces[s.current]
  const active = ws?.panes.find((p) => p.id === s.activePaneId)
  if (!active) return
  const order: PaneMode[] = ['terminal', 'browser', 'viewer', 'explorer']
  if (s.claudeEnabled) order.push('claude')
  const i = order.indexOf(active.mode)
  s.setActivePaneMode(order[(i + 1) % order.length])
}

// Skok do ostatnio używanego panelu (z historii MRU); fallback: następny po kolei.
export function focusMruPrevious(): void {
  const s = useStore.getState()
  const ws = s.workspaces[s.current]
  if (!ws) return
  const ids = new Set(ws.panes.map((p) => p.id))
  const prev = s.paneHistory.find((pid) => pid !== s.activePaneId && ids.has(pid))
  if (prev) {
    s.setActivePane(prev)
    return
  }
  const n = ws.panes.length
  if (n > 1) s.setActivePane(ws.panes[(currentIndex() + 1) % n].id)
}

/**
 * Wykonuje akcję przypisaną do binda. Wołane z klawiatury (useShortcuts) oraz z kombinacji
 * przekazanych przez przeglądarkę (BrowserPane → ipc 'run-bind'). MRU tutaj robi prosty skok
 * (pełna logika tap/hold jest w useShortcuts, gdzie mamy keydown+keyup).
 */
export function runBind(actionId: string): void {
  const s = useStore.getState()

  if (actionId === 'pane.mru') return focusMruPrevious()
  if (actionId === 'pane.autoscroll') {
    // Bind działa tylko gdy włączony główny przełącznik i aktywny panel to przeglądarka.
    if (!s.autoScrollEnabled) return
    const ws = s.workspaces[s.current]
    const active = ws?.panes.find((p) => p.id === s.activePaneId)
    if (active?.mode === 'browser' && s.activePaneId) s.toggleAutoScroll(s.activePaneId)
    return
  }
  if (actionId === 'workspace.prev') return s.prevWorkspace()
  if (actionId === 'workspace.next') return s.nextWorkspace()
  if (actionId === 'workspace.goto') return s.setGotoOpen(true)
  if (actionId === 'ui.notes') return s.toggleNotes()
  if (actionId === 'ui.layout') return s.setLayoutPickerOpen(true)
  if (actionId === 'ui.settings') return s.setSettingsOpen(true)
  if (actionId === 'ui.find') {
    s.setFindOpen(true)
    // sygnał do FindBar: przejmij fokus i zaznacz tekst (działa też gdy pasek już otwarty)
    window.dispatchEvent(new Event(FIND_FOCUS_EVENT))
    return
  }
  if (actionId === 'pane.autoApprove') {
    // Działa tylko gdy włączony główny przełącznik (Autopilot) i aktywny panel to terminal.
    if (!s.autoApproveEnabled) return
    const ws = s.workspaces[s.current]
    const active = ws?.panes.find((p) => p.id === s.activePaneId)
    if (active?.mode === 'terminal' && s.activePaneId) s.toggleAutoApprove(s.activePaneId)
    return
  }

  if (actionId === 'mode.terminal') return s.setActivePaneMode('terminal')
  if (actionId === 'mode.browser') return s.setActivePaneMode('browser')
  if (actionId === 'mode.viewer') return s.setActivePaneMode('viewer')
  if (actionId === 'mode.claude') return s.setActivePaneMode('claude') // działa też bez checkboxa
  if (actionId === 'mode.cycle') return cyclePaneMode()

  if (actionId === 'pane.next' || actionId === 'pane.prev') {
    const ws = s.workspaces[s.current]
    const n = ws?.panes.length ?? 0
    if (n > 1) focusPaneIndex((currentIndex() + (actionId === 'pane.next' ? 1 : n - 1)) % n)
    return
  }

  if (actionId.startsWith('explorer.')) {
    // Działa tylko gdy aktywny panel to eksplorator; wykonuje go aktywny ExplorerPane.
    const ws = s.workspaces[s.current]
    const active = ws?.panes.find((p) => p.id === s.activePaneId)
    if (active?.mode === 'explorer') dispatchExplorerCmd(actionId.slice('explorer.'.length))
    return
  }

  if (actionId.startsWith('tab.')) {
    // Karty obsługuje aktywny BrowserPane; jeśli aktywny panel nie jest przeglądarką — no-op.
    const ws = s.workspaces[s.current]
    const active = ws?.panes.find((p) => p.id === s.activePaneId)
    if (active?.mode === 'browser') dispatchPaneCmd(actionId as PaneCmd)
    return
  }

  if (actionId.startsWith('pane.')) {
    const idx = Number(actionId.slice(5)) - 1
    if (Number.isFinite(idx)) focusPaneIndex(idx)
  }
}
