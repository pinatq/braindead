// Definicje akcji-skrótów, domyślne bindy i pomocnicze konwersje klawiszy.
// Bind = znormalizowany ciąg "Meta+Control+Alt+Shift+KEY" (pusty = brak skrótu).

export interface BindAction {
  id: string
  label: string
  group: string
}

// Kolejność = kolejność wyświetlania w ustawieniach.
export const BIND_ACTIONS: BindAction[] = [
  ...Array.from({ length: 16 }, (_, i) => ({
    id: `pane.${i + 1}`,
    label: `Focus pane ${i + 1}`,
    group: 'Panes'
  })),
  { id: 'pane.mru', label: 'Switch panes (tap = last used, hold = cycle)', group: 'Panes' },
  { id: 'pane.next', label: 'Next pane (by index)', group: 'Panes' },
  { id: 'pane.prev', label: 'Previous pane (by index)', group: 'Panes' },
  { id: 'pane.zoom', label: 'Fullscreen active pane (inside the app)', group: 'Panes' },
  { id: 'pane.zoomExit', label: 'Exit pane fullscreen', group: 'Panes' },
  { id: 'mode.terminal', label: 'Active pane → Terminal', group: 'Pane mode' },
  { id: 'mode.browser', label: 'Active pane → Browser', group: 'Pane mode' },
  { id: 'mode.viewer', label: 'Active pane → Viewer', group: 'Pane mode' },
  { id: 'mode.cycle', label: 'Cycle pane mode (CLI → browser → viewer)', group: 'Pane mode' },
  { id: 'mode.claude', label: 'Active pane → Claude Code', group: 'Pane mode' },
  { id: 'tab.new', label: 'New browser tab', group: 'Browser tabs' },
  { id: 'tab.close', label: 'Close browser tab', group: 'Browser tabs' },
  { id: 'tab.next', label: 'Next browser tab', group: 'Browser tabs' },
  { id: 'tab.prev', label: 'Previous browser tab', group: 'Browser tabs' },
  { id: 'pane.autoscroll', label: 'Toggle auto-scroll (reels/shorts)', group: 'Browser tabs' },
  { id: 'ui.notes', label: 'Toggle notes', group: 'Panels' },
  { id: 'ui.layout', label: 'Open layout picker', group: 'Panels' },
  { id: 'ui.settings', label: 'Open settings', group: 'Panels' },
  { id: 'ui.find', label: 'Find in pane (terminal · viewer · notes · browser · explorer)', group: 'Find' },
  { id: 'pane.autoApprove', label: 'Toggle auto-approve (Enter every N sec in terminal)', group: 'Auto-approve' },
  { id: 'workspace.prev', label: 'Previous workspace', group: 'Workspaces' },
  { id: 'workspace.next', label: 'Next workspace', group: 'Workspaces' },
  { id: 'workspace.goto', label: 'Jump to workspace (type number)', group: 'Workspaces' },
  { id: 'explorer.back', label: 'Explorer: back', group: 'Explorer' },
  { id: 'explorer.forward', label: 'Explorer: forward', group: 'Explorer' },
  { id: 'explorer.home', label: 'Explorer: home (~)', group: 'Explorer' },
  { id: 'explorer.focusPath', label: 'Explorer: focus path bar', group: 'Explorer' },
  { id: 'explorer.newFolder', label: 'Explorer: new folder', group: 'Explorer' },
  { id: 'explorer.newFile', label: 'Explorer: new file', group: 'Explorer' }
]

// Domyślne: ⌘1–9 → panele 1–9, ⌘0 → panel 10, sloty 11–16 puste,
// MRU = Ctrl+Tab, karty ⌘T/⌘W/⌘⇧]/⌘⇧[, reszta pusta (do edycji przez usera).
export const DEFAULT_BINDS: Record<string, string> = {
  'pane.1': 'Meta+1',
  'pane.2': 'Meta+2',
  'pane.3': 'Meta+3',
  'pane.4': 'Meta+4',
  'pane.5': 'Meta+5',
  'pane.6': 'Meta+6',
  'pane.7': 'Meta+7',
  'pane.8': 'Meta+8',
  'pane.9': 'Meta+9',
  'pane.10': 'Meta+0',
  'pane.11': '',
  'pane.12': '',
  'pane.13': '',
  'pane.14': '',
  'pane.15': '',
  'pane.16': '',
  'pane.mru': 'Control+Tab',
  'pane.next': '',
  'pane.prev': '',
  'pane.zoom': '', // celowo bez domyślnego klawisza — użytkownik przypisuje sam
  'pane.zoomExit': '',
  'mode.terminal': '',
  'mode.browser': '',
  'mode.viewer': '',
  'mode.cycle': '',
  'mode.claude': '',
  'tab.new': 'Meta+T',
  'tab.close': 'Meta+W',
  'tab.next': 'Meta+Shift+]',
  'tab.prev': 'Meta+Shift+[',
  'pane.autoscroll': '',
  'ui.notes': '',
  'ui.layout': '',
  'ui.settings': '',
  'ui.find': 'Meta+F',
  'pane.autoApprove': '',
  'workspace.prev': '',
  'workspace.next': '',
  'workspace.goto': '',
  'explorer.back': '',
  'explorer.forward': '',
  'explorer.home': '',
  'explorer.focusPath': '',
  'explorer.newFolder': '',
  'explorer.newFile': ''
}

/** Znajduje id akcji przypisanej do danej kombinacji (lub null). */
export function actionForCombo(binds: Record<string, string>, combo: string): string | null {
  if (!combo) return null
  return Object.keys(binds).find((k) => binds[k] === combo) ?? null
}

// Flaga: ustawienia właśnie przechwytują skrót — globalny handler ma wtedy odpuścić,
// inaczej wciśnięcie np. ⌘1 przy rebindzie przełączyłoby panel pod modalem.
let capturing = false
export const setCapturing = (v: boolean): void => {
  capturing = v
}
export const isCapturing = (): boolean => capturing

const MOD_KEYS = ['Shift', 'Control', 'Alt', 'Meta', 'CapsLock', 'OS', 'ContextMenu']

export function isModifierKey(key: string): boolean {
  return MOD_KEYS.includes(key)
}

/** Buduje kanoniczny ciąg skrótu ze zdarzenia. Zwraca '' gdy to tylko modyfikatory. */
export function comboFromEvent(e: KeyboardEvent): string {
  let key = e.key
  if (isModifierKey(key)) return ''
  if (key === ' ') key = 'Space'
  else if (key.length === 1) key = key.toUpperCase()

  const parts: string[] = []
  if (e.metaKey) parts.push('Meta')
  if (e.ctrlKey) parts.push('Control')
  if (e.altKey) parts.push('Alt')
  if (e.shiftKey) parts.push('Shift')
  parts.push(key)
  return parts.join('+')
}

export interface Mods {
  meta: boolean
  ctrl: boolean
  alt: boolean
  shift: boolean
}

/** Wyciąga zestaw wymaganych modyfikatorów z ciągu skrótu. */
export function modsOf(combo: string): Mods {
  const parts = combo.split('+')
  return {
    meta: parts.includes('Meta'),
    ctrl: parts.includes('Control'),
    alt: parts.includes('Alt'),
    shift: parts.includes('Shift')
  }
}

const SYMBOLS: Record<string, string> = {
  Meta: '⌘',
  Control: '⌃',
  Alt: '⌥',
  Shift: '⇧',
  Tab: '⇥',
  Enter: '↵',
  Escape: 'Esc',
  Backspace: '⌫',
  Delete: '⌦',
  ArrowLeft: '←',
  ArrowRight: '→',
  ArrowUp: '↑',
  ArrowDown: '↓',
  Space: 'Space'
}

/** Czytelna postać skrótu do wyświetlenia (symbole ⌘⌃⌥⇧). */
export function formatCombo(combo: string): string {
  if (!combo) return '—'
  return combo
    .split('+')
    .map((p) => SYMBOLS[p] ?? p)
    .join('')
}
