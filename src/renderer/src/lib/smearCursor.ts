// Kursor w stylu Neovide: blok, który PŁYNIE do nowej pozycji, rozciągając się po drodze
// (Neovide nazywa to „cursor smear"). xterm rysuje własny kursor natychmiast, więc jego
// chowamy i rysujemy swój — jeden div nad warstwą tekstu.
//
// Kosztem wydajności się nie przejmujemy o tyle, że pętla animacji chodzi WYŁĄCZNIE wtedy,
// gdy kursor faktycznie się przemieszcza. Terminal, w którym nic się nie dzieje, nie budzi
// przeglądarki ani razu.
import type { Terminal } from '@xterm/xterm'

/** Jak szybko blok dogania cel (0..1 na klatkę). Wyżej = sztywniej, niżej = bardziej leniwie. */
const DOGANIANIE = 0.32
/** Poniżej tylu pikseli różnicy uznajemy, że dojechał — i zatrzymujemy pętlę. */
const PRZYCIAGANIE = 0.6

interface Komorka {
  w: number
  h: number
  offX: number
  offY: number
}

export function installSmearCursor(term: Terminal, host: HTMLElement): () => void {
  const el = document.createElement('div')
  el.className = 'smear-cursor'
  host.appendChild(el)

  // xterm ma rysować kursor „przezroczysto" — widoczny zostaje tylko nasz blok.
  const poprzedniaTheme = term.options.theme
  term.options.theme = { ...poprzedniaTheme, cursor: '#00000000', cursorAccent: '#00000000' }

  let komorka: Komorka | null = null
  let x = 0
  let y = 0
  let klatka = 0
  let zywy = true

  /** Rozmiar komórki i przesunięcie warstwy tekstu względem hosta — liczone z DOM-u. */
  const zmierz = (): Komorka | null => {
    const screen = term.element?.querySelector('.xterm-screen') as HTMLElement | null
    if (!screen || !term.cols || !term.rows) return null
    const r = screen.getBoundingClientRect()
    const h = host.getBoundingClientRect()
    if (r.width <= 0 || r.height <= 0) return null
    return {
      w: r.width / term.cols,
      h: r.height / term.rows,
      offX: r.left - h.left,
      offY: r.top - h.top
    }
  }

  const cel = (): { x: number; y: number } | null => {
    if (!komorka) komorka = zmierz()
    if (!komorka) return null
    const b = term.buffer.active
    return { x: komorka.offX + b.cursorX * komorka.w, y: komorka.offY + b.cursorY * komorka.h }
  }

  const rysuj = (smugaX: number, smugaY: number): void => {
    if (!komorka) return
    // Blok rozciągnięty od bieżącej pozycji do celu — to jest cała „smuga".
    const left = Math.min(x, smugaX)
    const top = Math.min(y, smugaY)
    const w = Math.abs(smugaX - x) + komorka.w
    const h = Math.abs(smugaY - y) + komorka.h
    el.style.transform = `translate(${left}px, ${top}px)`
    el.style.width = `${w}px`
    el.style.height = `${h}px`
  }

  const krok = (): void => {
    klatka = 0
    if (!zywy) return
    const t = cel()
    if (!t) return
    const dx = t.x - x
    const dy = t.y - y
    if (Math.abs(dx) < PRZYCIAGANIE && Math.abs(dy) < PRZYCIAGANIE) {
      x = t.x
      y = t.y
      rysuj(x, y) // dojechał — blok wraca do rozmiaru jednej komórki
      return
    }
    x += dx * DOGANIANIE
    y += dy * DOGANIANIE
    rysuj(t.x, t.y)
    klatka = requestAnimationFrame(krok)
  }

  const obudz = (): void => {
    if (!zywy || klatka) return
    klatka = requestAnimationFrame(krok)
  }

  // Skok bez animacji — przy pierwszym pokazaniu i po zmianie rozmiaru.
  const przeskocz = (): void => {
    komorka = zmierz()
    const t = cel()
    if (!t) return
    x = t.x
    y = t.y
    rysuj(x, y)
  }

  const offCursor = term.onCursorMove(obudz)
  const offRender = term.onRender(obudz)
  const offResize = term.onResize(() => {
    komorka = null
    przeskocz()
  })

  const onFocus = (): void => el.classList.remove('smear-cursor--blur')
  const onBlur = (): void => el.classList.add('smear-cursor--blur')
  term.textarea?.addEventListener('focus', onFocus)
  term.textarea?.addEventListener('blur', onBlur)
  if (document.activeElement !== term.textarea) el.classList.add('smear-cursor--blur')

  przeskocz()

  return () => {
    zywy = false
    if (klatka) cancelAnimationFrame(klatka)
    offCursor.dispose()
    offRender.dispose()
    offResize.dispose()
    term.textarea?.removeEventListener('focus', onFocus)
    term.textarea?.removeEventListener('blur', onBlur)
    term.options.theme = poprzedniaTheme
    el.remove()
  }
}
