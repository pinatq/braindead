// Vim-lite dla <textarea> (notatki, później też tekst w viewerze). Operuje na stringu + pozycji
// kursora. NORMAL/INSERT/VISUAL, ruch h/j/k/l/w/b/e/0/$/^/gg/G, edycja i/a/A/I/o/O/x/dd/D/yy/p/P,
// visual (v) + y/d. Zwraca nową wartość + zakres zaznaczenia; null = przepuść (pisanie w INSERT).

export interface TextVimState {
  mode: 'normal' | 'insert'
  visual: boolean
  anchor: number // początek zaznaczenia (visual)
  vcaret: number // aktywny koniec zaznaczenia (visual)
  register: string
  registerLine: boolean // czy rejestr to całe linie (yy/dd)
  pending: '' | 'g' | 'd' | 'y' // oczekiwanie na drugi klawisz (gg/dd/yy)
}

export const newTextVimState = (): TextVimState => ({
  mode: 'normal',
  visual: false,
  anchor: 0,
  vcaret: 0,
  register: '',
  registerLine: false,
  pending: ''
})

export interface VimEdit {
  value: string
  selStart: number
  selEnd: number
  close: boolean // Esc w NORMAL → zamknij panel
}

const lineStart = (v: string, p: number): number => v.lastIndexOf('\n', p - 1) + 1
const lineEnd = (v: string, p: number): number => {
  const i = v.indexOf('\n', p)
  return i < 0 ? v.length : i
}
const isW = (c: string): boolean => /\w/.test(c)

function nextWord(v: string, p: number): number {
  let i = p
  while (i < v.length && isW(v[i])) i++
  while (i < v.length && !isW(v[i])) i++
  return i
}
function prevWord(v: string, p: number): number {
  let i = p - 1
  while (i > 0 && !isW(v[i])) i--
  while (i > 0 && isW(v[i - 1])) i--
  return Math.max(0, i)
}
function endWord(v: string, p: number): number {
  let i = p + 1
  while (i < v.length && !isW(v[i])) i++
  while (i < v.length - 1 && isW(v[i + 1])) i++
  return Math.min(v.length, i)
}
function firstNonSpace(v: string, p: number): number {
  let i = lineStart(v, p)
  while (i < v.length && v[i] !== '\n' && /\s/.test(v[i])) i++
  return i
}

/** Główny handler. e — natywne zdarzenie; value/selStart/selEnd — bieżący stan textarea. */
export function textVimKeydown(
  e: KeyboardEvent,
  value: string,
  selStart: number,
  selEnd: number,
  st: TextVimState
): VimEdit | null {
  // Modyfikatory zostawiamy systemowi (kopiowanie, skróty programu).
  if (e.metaKey || e.ctrlKey || e.altKey) return null

  const collapse = (c: number): VimEdit => ({ value, selStart: c, selEnd: c, close: false })

  if (st.mode === 'insert') {
    if (e.key === 'Escape') {
      st.mode = 'normal'
      st.pending = ''
      return collapse(Math.max(lineStart(value, selStart), selStart - 1))
    }
    return null // pisanie idzie normalnie do textarea
  }

  const k = e.key
  let caret = selStart

  // --- oczekiwanie na drugi klawisz (gg / dd / yy) ---
  if (st.pending === 'g') {
    st.pending = ''
    if (k === 'g') return collapse(0)
    return collapse(caret)
  }
  if (st.pending === 'd' || st.pending === 'y') {
    const op = st.pending
    st.pending = ''
    if ((op === 'd' && k === 'd') || (op === 'y' && k === 'y')) {
      const ls = lineStart(value, caret)
      const le = lineEnd(value, caret)
      const withNl = le < value.length ? le + 1 : le
      st.register = value.slice(ls, withNl) || value.slice(ls, le)
      st.registerLine = true
      if (op === 'y') return collapse(ls)
      const nv = value.slice(0, ls) + value.slice(withNl)
      return { value: nv, selStart: Math.min(ls, nv.length), selEnd: Math.min(ls, nv.length), close: false }
    }
    return collapse(caret)
  }

  // --- VISUAL ---
  if (st.visual) {
    const moveV = (c: number): VimEdit => {
      st.vcaret = c
      const a = Math.min(st.anchor, st.vcaret)
      const b = Math.max(st.anchor, st.vcaret)
      return { value, selStart: a, selEnd: b, close: false }
    }
    switch (k) {
      case 'Escape':
        st.visual = false
        return collapse(st.vcaret)
      case 'h':
      case 'ArrowLeft':
        return moveV(Math.max(0, st.vcaret - 1))
      case 'l':
      case 'ArrowRight':
        return moveV(Math.min(value.length, st.vcaret + 1))
      case 'j':
      case 'ArrowDown': {
        const ls = lineStart(value, st.vcaret)
        const le = lineEnd(value, st.vcaret)
        if (le >= value.length) return moveV(st.vcaret)
        const nls = le + 1
        return moveV(Math.min(nls + (st.vcaret - ls), lineEnd(value, nls)))
      }
      case 'k':
      case 'ArrowUp': {
        const ls = lineStart(value, st.vcaret)
        if (ls === 0) return moveV(st.vcaret)
        const pls = lineStart(value, ls - 1)
        return moveV(Math.min(pls + (st.vcaret - ls), ls - 1))
      }
      case '0':
        return moveV(lineStart(value, st.vcaret))
      case '$':
        return moveV(lineEnd(value, st.vcaret))
      case 'w':
        return moveV(nextWord(value, st.vcaret))
      case 'b':
        return moveV(prevWord(value, st.vcaret))
      case 'e':
        return moveV(endWord(value, st.vcaret))
      case 'G':
        return moveV(value.length)
      case 'y':
      case 'd': {
        const a = Math.min(st.anchor, st.vcaret)
        const b = Math.max(st.anchor, st.vcaret)
        st.register = value.slice(a, b)
        st.registerLine = false
        st.visual = false
        navigator.clipboard?.writeText(st.register).catch(() => {})
        if (k === 'y') return collapse(a)
        const nv = value.slice(0, a) + value.slice(b)
        return { value: nv, selStart: a, selEnd: a, close: false }
      }
      default:
        return collapse(st.vcaret) // połykamy resztę klawiszy w visual
    }
  }

  // --- NORMAL ---
  switch (k) {
    case 'Escape':
      return { value, selStart: caret, selEnd: caret, close: true } // zamknij panel
    case 'h':
    case 'ArrowLeft':
      return collapse(Math.max(lineStart(value, caret), caret - 1))
    case 'l':
    case 'ArrowRight':
      return collapse(Math.min(lineEnd(value, caret), caret + 1))
    case 'j':
    case 'ArrowDown': {
      const ls = lineStart(value, caret)
      const le = lineEnd(value, caret)
      if (le >= value.length) return collapse(caret)
      const nls = le + 1
      return collapse(Math.min(nls + (caret - ls), lineEnd(value, nls)))
    }
    case 'k':
    case 'ArrowUp': {
      const ls = lineStart(value, caret)
      if (ls === 0) return collapse(caret)
      const pls = lineStart(value, ls - 1)
      return collapse(Math.min(pls + (caret - ls), ls - 1))
    }
    case '0':
      return collapse(lineStart(value, caret))
    case '^':
      return collapse(firstNonSpace(value, caret))
    case '$':
      return collapse(lineEnd(value, caret))
    case 'w':
      return collapse(nextWord(value, caret))
    case 'b':
      return collapse(prevWord(value, caret))
    case 'e':
      return collapse(endWord(value, caret))
    case 'G':
      return collapse(value.length)
    case 'g':
      st.pending = 'g'
      return collapse(caret)
    case 'd':
      st.pending = 'd'
      return collapse(caret)
    case 'y':
      st.pending = 'y'
      return collapse(caret)
    case 'i':
      st.mode = 'insert'
      return collapse(caret)
    case 'a':
      st.mode = 'insert'
      return collapse(Math.min(value.length, caret + 1))
    case 'I':
      st.mode = 'insert'
      return collapse(firstNonSpace(value, caret))
    case 'A':
      st.mode = 'insert'
      return collapse(lineEnd(value, caret))
    case 'o': {
      st.mode = 'insert'
      const le = lineEnd(value, caret)
      const nv = value.slice(0, le) + '\n' + value.slice(le)
      return { value: nv, selStart: le + 1, selEnd: le + 1, close: false }
    }
    case 'O': {
      st.mode = 'insert'
      const ls = lineStart(value, caret)
      const nv = value.slice(0, ls) + '\n' + value.slice(ls)
      return { value: nv, selStart: ls, selEnd: ls, close: false }
    }
    case 'x': {
      if (caret >= value.length || value[caret] === '\n') return collapse(caret)
      st.register = value[caret]
      st.registerLine = false
      const nv = value.slice(0, caret) + value.slice(caret + 1)
      return { value: nv, selStart: caret, selEnd: caret, close: false }
    }
    case 'D': {
      const le = lineEnd(value, caret)
      st.register = value.slice(caret, le)
      st.registerLine = false
      const nv = value.slice(0, caret) + value.slice(le)
      return { value: nv, selStart: caret, selEnd: caret, close: false }
    }
    case 'p':
    case 'P': {
      if (!st.register) return collapse(caret)
      if (st.registerLine) {
        const at = k === 'p' ? lineEnd(value, caret) + 1 : lineStart(value, caret)
        const ins = st.register.endsWith('\n') ? st.register : st.register + '\n'
        const pos = Math.min(at, value.length)
        const nv = value.slice(0, pos) + ins + value.slice(pos)
        return { value: nv, selStart: pos, selEnd: pos, close: false }
      }
      const at = k === 'p' ? Math.min(value.length, caret + 1) : caret
      const nv = value.slice(0, at) + st.register + value.slice(at)
      return { value: nv, selStart: at + st.register.length - 1, selEnd: at + st.register.length - 1, close: false }
    }
    case 'v':
      st.visual = true
      st.anchor = caret
      st.vcaret = caret
      return { value, selStart: caret, selEnd: Math.min(value.length, caret + 1), close: false }
    default:
      return collapse(caret) // reszta klawiszy w NORMAL: połykamy (ochrona przed pisaniem)
  }
}
