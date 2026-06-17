/// <reference lib="dom" />
// Konfigurowalny keymap vima — współdzielony przez renderer (terminal/viewer/okna)
// i preload <webview> (przeglądarka). Czysty TS + typy DOM, bez zależności od Electrona.
//
// Token klawisza:
//   'j'      — pojedynczy znak (case-sensitive: 'G' = Shift+g, ':' = Shift+;)
//   'Space'  — spacja
//   'C-d'    — z Ctrl (np. C-d, C-w)
//   'gg'     — podwójne wciśnięcie tego samego klawisza
//   ''       — wyłączony

export interface VimAction {
  id: string
  label: string
  group: string
  def: string
}

export const VIM_GROUPS = [
  'Terminal (NORMAL)',
  'Browser',
  'Windows (Ctrl-w)',
  'Viewer',
  'Explorer'
] as const

export const VIM_ACTIONS: VimAction[] = [
  // --- Terminal (NORMAL = copy-mode: ruchomy kursor jak w neovim) ---
  { id: 'term.down', label: 'Cursor down', group: 'Terminal (NORMAL)', def: 'j' },
  { id: 'term.up', label: 'Cursor up', group: 'Terminal (NORMAL)', def: 'k' },
  { id: 'term.left', label: 'Cursor left', group: 'Terminal (NORMAL)', def: 'h' },
  { id: 'term.right', label: 'Cursor right', group: 'Terminal (NORMAL)', def: 'l' },
  { id: 'term.halfDown', label: 'Half page down', group: 'Terminal (NORMAL)', def: 'C-d' },
  { id: 'term.halfUp', label: 'Half page up', group: 'Terminal (NORMAL)', def: 'C-u' },
  { id: 'term.wordNext', label: 'Next word', group: 'Terminal (NORMAL)', def: 'w' },
  { id: 'term.wordPrev', label: 'Previous word', group: 'Terminal (NORMAL)', def: 'b' },
  { id: 'term.wordEnd', label: 'Word end', group: 'Terminal (NORMAL)', def: 'e' },
  { id: 'term.lineStart', label: 'Line start', group: 'Terminal (NORMAL)', def: '0' },
  { id: 'term.lineEnd', label: 'Line end', group: 'Terminal (NORMAL)', def: '$' },
  { id: 'term.top', label: 'Go to top', group: 'Terminal (NORMAL)', def: 'gg' },
  { id: 'term.bottom', label: 'Go to bottom', group: 'Terminal (NORMAL)', def: 'G' },
  { id: 'term.visual', label: 'Visual select (char)', group: 'Terminal (NORMAL)', def: 'v' },
  { id: 'term.visualLine', label: 'Visual select (line)', group: 'Terminal (NORMAL)', def: 'V' },
  { id: 'term.yank', label: 'Yank selection / line', group: 'Terminal (NORMAL)', def: 'y' },
  { id: 'term.insert', label: 'Enter INSERT', group: 'Terminal (NORMAL)', def: 'i' },
  // --- Browser ---
  { id: 'browser.down', label: 'Scroll down', group: 'Browser', def: 'j' },
  { id: 'browser.up', label: 'Scroll up', group: 'Browser', def: 'k' },
  { id: 'browser.left', label: 'Scroll left', group: 'Browser', def: 'h' },
  { id: 'browser.right', label: 'Scroll right', group: 'Browser', def: 'l' },
  { id: 'browser.halfDown', label: 'Half page down', group: 'Browser', def: 'd' },
  { id: 'browser.halfUp', label: 'Half page up', group: 'Browser', def: 'u' },
  { id: 'browser.top', label: 'Go to top', group: 'Browser', def: 'gg' },
  { id: 'browser.bottom', label: 'Go to bottom', group: 'Browser', def: 'G' },
  { id: 'browser.hints', label: 'Link hints', group: 'Browser', def: 'f' },
  { id: 'browser.nextInput', label: 'Next input field', group: 'Browser', def: 'i' },
  { id: 'browser.back', label: 'History back', group: 'Browser', def: 'H' },
  { id: 'browser.fwd', label: 'History forward', group: 'Browser', def: 'L' },
  { id: 'browser.address', label: 'Focus address bar', group: 'Browser', def: ':' },
  // --- Windows (Ctrl-w) ---
  { id: 'win.prefix', label: 'Window prefix', group: 'Windows (Ctrl-w)', def: 'C-w' },
  { id: 'win.focusLeft', label: 'Focus pane left', group: 'Windows (Ctrl-w)', def: 'h' },
  { id: 'win.focusDown', label: 'Focus pane down', group: 'Windows (Ctrl-w)', def: 'j' },
  { id: 'win.focusUp', label: 'Focus pane up', group: 'Windows (Ctrl-w)', def: 'k' },
  { id: 'win.focusRight', label: 'Focus pane right', group: 'Windows (Ctrl-w)', def: 'l' },
  { id: 'win.cycle', label: 'Cycle next pane', group: 'Windows (Ctrl-w)', def: 'w' },
  { id: 'win.cyclePrev', label: 'Cycle previous pane', group: 'Windows (Ctrl-w)', def: 'W' },
  { id: 'win.close', label: 'Kill pane', group: 'Windows (Ctrl-w)', def: 'q' },
  { id: 'win.splitDown', label: 'Split (stacked rows)', group: 'Windows (Ctrl-w)', def: 's' },
  { id: 'win.splitRight', label: 'Split (side by side)', group: 'Windows (Ctrl-w)', def: 'v' },
  { id: 'win.only', label: 'Single pane (only)', group: 'Windows (Ctrl-w)', def: 'o' },
  // --- Viewer ---
  { id: 'viewer.down', label: 'Scroll down', group: 'Viewer', def: 'j' },
  { id: 'viewer.up', label: 'Scroll up', group: 'Viewer', def: 'k' },
  { id: 'viewer.left', label: 'Scroll left', group: 'Viewer', def: 'h' },
  { id: 'viewer.right', label: 'Scroll right', group: 'Viewer', def: 'l' },
  { id: 'viewer.halfDown', label: 'Half page down', group: 'Viewer', def: 'd' },
  { id: 'viewer.halfUp', label: 'Half page up', group: 'Viewer', def: 'u' },
  { id: 'viewer.top', label: 'Go to top', group: 'Viewer', def: 'gg' },
  { id: 'viewer.bottom', label: 'Go to bottom', group: 'Viewer', def: 'G' },
  { id: 'viewer.zoomIn', label: 'Zoom in', group: 'Viewer', def: '+' },
  { id: 'viewer.zoomOut', label: 'Zoom out', group: 'Viewer', def: '-' },
  { id: 'viewer.reset', label: 'Reset zoom', group: 'Viewer', def: '0' },
  { id: 'viewer.copy', label: 'Copy mode (select text) ⇄ view', group: 'Viewer', def: 'v' },
  { id: 'viewer.visual', label: 'Copy mode: toggle visual (h/j/k/l selects)', group: 'Viewer', def: 'V' },
  { id: 'viewer.yank', label: 'Yank selection (copy mode)', group: 'Viewer', def: 'y' },
  // --- Explorer ---
  { id: 'explorer.down', label: 'Move down', group: 'Explorer', def: 'j' },
  { id: 'explorer.up', label: 'Move up', group: 'Explorer', def: 'k' },
  { id: 'explorer.open', label: 'Open / enter folder', group: 'Explorer', def: 'l' },
  { id: 'explorer.parent', label: 'Parent folder', group: 'Explorer', def: 'h' },
  { id: 'explorer.top', label: 'Go to top', group: 'Explorer', def: 'gg' },
  { id: 'explorer.bottom', label: 'Go to bottom', group: 'Explorer', def: 'G' },
  { id: 'explorer.toViewer', label: 'Open in viewer', group: 'Explorer', def: 'o' },
  { id: 'explorer.toNotes', label: 'Send to notes', group: 'Explorer', def: 'n' },
  { id: 'explorer.delete', label: 'Delete (with confirm)', group: 'Explorer', def: 'D' },
  { id: 'explorer.newFolder', label: 'New folder', group: 'Explorer', def: 'N' },
  { id: 'explorer.newFile', label: 'New file', group: 'Explorer', def: 'F' },
  { id: 'explorer.address', label: 'Focus path bar (type location)', group: 'Explorer', def: ':' },
  { id: 'explorer.back', label: 'History back', group: 'Explorer', def: '' },
  { id: 'explorer.forward', label: 'History forward', group: 'Explorer', def: '' },
  { id: 'explorer.home', label: 'Go home (~)', group: 'Explorer', def: '' }
]

export const DEFAULT_VIM_BINDS: Record<string, string> = Object.fromEntries(
  VIM_ACTIONS.map((a) => [a.id, a.def])
)

// Akcje nawigacji oknami (bez prefiksu) — do iteracji przy rozpoznawaniu drugiego klawisza Ctrl-w.
export const WIN_MOTION_IDS = [
  'win.focusLeft',
  'win.focusDown',
  'win.focusUp',
  'win.focusRight',
  'win.cycle',
  'win.cyclePrev',
  'win.close',
  'win.splitDown',
  'win.splitRight',
  'win.only'
]

const MODS = ['Shift', 'Control', 'Alt', 'Meta', 'CapsLock', 'OS', 'ContextMenu']

// Stan ostatniego klawisza — do rozpoznania podwójnego wciśnięcia ('gg').
export interface DoubleState {
  key: string
  time: number
}

function tokenKey(token: string): string {
  return token === 'Space' ? ' ' : token
}

/** Czy zdarzenie pasuje do tokenu. Dla 'gg' wymaga drugiego wciśnięcia <500 ms (stan w `dbl`). */
export function matchVimKey(token: string, e: KeyboardEvent, dbl?: DoubleState): boolean {
  if (!token) return false
  if (token.startsWith('C-')) {
    const want = tokenKey(token.slice(2))
    return !!e.ctrlKey && !e.metaKey && !e.altKey && e.key.toLowerCase() === want.toLowerCase()
  }
  if (e.ctrlKey || e.metaKey || e.altKey) return false
  // Podwójne wciśnięcie (np. 'gg').
  if (token.length === 2 && token[0] === token[1]) {
    if (e.key !== token[0]) return false
    const now = Date.now()
    const ok = !!dbl && dbl.key === token[0] && now - dbl.time < 500
    if (dbl) {
      dbl.key = ok ? '' : token[0] // po trafieniu zerujemy, by trzeci 'g' nie liczył się od razu
      dbl.time = now
    }
    return ok
  }
  return e.key === tokenKey(token)
}

/** Czy klawisz to pierwsze wciśnięcie któregoś podwójnego tokenu (do „połknięcia" w przeglądarce/viewerze). */
export function isDoubleFirst(e: KeyboardEvent, tokens: string[]): boolean {
  if (e.ctrlKey || e.metaKey || e.altKey) return false
  return tokens.some((t) => t.length === 2 && t[0] === t[1] && t[0] === e.key)
}

/** Czytelna postać tokenu do UI. */
export function formatVimKey(token: string): string {
  if (!token) return '—'
  if (token.startsWith('C-')) return '⌃' + token.slice(2)
  if (token === 'Space') return '␣'
  return token
}

/** Buduje token ze zdarzenia (do przechwytywania w ustawieniach). Zwraca null dla samych modyfikatorów. */
export function captureVimKey(e: KeyboardEvent): string | null {
  const k = e.key
  if (MODS.includes(k)) return null
  if (e.ctrlKey) return 'C-' + (k === ' ' ? 'Space' : k.toLowerCase())
  if (k === ' ') return 'Space'
  return k // pojedyncze znaki zachowują wielkość (G, :, +, -, 0)
}
