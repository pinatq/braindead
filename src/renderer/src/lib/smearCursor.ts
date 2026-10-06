// Kursor w stylu Neovide: blok, który PŁYNIE do nowej pozycji, rozciągając się po drodze
// (Neovide nazywa to „cursor smear"). xterm rysuje własny kursor natychmiast, więc jego
// chowamy i rysujemy swój — jeden div nad warstwą tekstu.
//
// Kosztem wydajności się nie przejmujemy o tyle, że pętla animacji chodzi WYŁĄCZNIE wtedy,
// gdy kursor faktycznie się przemieszcza. Terminal, w którym nic się nie dzieje, nie budzi
// przeglądarki ani razu.
//
// Blok widać dokładnie wtedy, kiedy xterm narysowałby swój kursor. Nie widać go, gdy program
// schował kursor (ESC[?25l — tak robią Claude Code i Codex, które rysują własny w polu
// wpisywania) ani gdy kursor zjechał poza widok po przewinięciu historii. Wcześniej blok
// wisiał wtedy tam, gdzie TUI zostawiło prawdziwy kursor: kilka kolumn obok albo na środku
// ekranu, i nie ruszał się przy przewijaniu.
import type { Terminal } from '@xterm/xterm'

/// Czas dojazdu do celu w milisekundach. Neovide domyślnie animuje ~60 ms — przy dłuższym
/// czasie kursor wlecze się za pisaniem i przeszkadza, zamiast wyglądać.
const CZAS_MS = 55
/** Poniżej tylu pikseli różnicy uznajemy, że dojechał — i zatrzymujemy pętlę. */
const PRZYCIAGANIE = 0.75

interface Komorka {
  w: number
  h: number
  offX: number
  offY: number
}

/** Widoczność kursora (DECTCEM) nie ma publicznego API; renderer WebGL też czyta ją stąd. */
interface CoreService {
  isCursorHidden: boolean
  isCursorInitialized: boolean
}

export function installSmearCursor(term: Terminal, host: HTMLElement): () => void {
  const el = document.createElement('div')
  el.className = 'smear-cursor'
  el.hidden = true // pierwsza klatka postawi go od razu na miejscu, bez smugi
  host.appendChild(el)

  // xterm ma rysować kursor „przezroczysto" — widoczny zostaje tylko nasz blok.
  const poprzedniaTheme = term.options.theme
  term.options.theme = { ...poprzedniaTheme, cursor: '#00000000', cursorAccent: '#00000000' }

  // ponytail: pole wewnętrzne. Gdy inna wersja xterma go nie ma, kursor jest zawsze widoczny.
  const core = (term as unknown as { _core?: { coreService?: CoreService } })._core?.coreService

  let x = 0
  let y = 0
  let viewport = term.buffer.active.viewportY
  let bufor = term.buffer.active.type
  let klatka = 0
  let zywy = true
  let ostatniaKlatka = 0

  /**
   * Rozmiar komórki i przesunięcie warstwy tekstu względem hosta — liczone z DOM-u przy każdej
   * klatce. Zapamiętany pomiar rozjeżdżał się po zmianie rozmiaru panelu i kursor stawał kilka
   * kolumn obok tekstu.
   */
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

  /** Gdzie xterm narysowałby kursor; null = teraz by go nie rysował. */
  const cel = (k: Komorka): { x: number; y: number } | null => {
    if (core && (core.isCursorHidden || !core.isCursorInitialized)) return null
    const b = term.buffer.active
    // cursorY liczy się od ostatniego ekranu, a nie od tego, co widać po przewinięciu.
    const wiersz = b.baseY + b.cursorY - b.viewportY
    if (wiersz < 0 || wiersz >= term.rows) return null
    // cursorX === cols (czeka na zawinięcie wiersza) xterm rysuje w ostatniej kolumnie.
    return { x: k.offX + Math.min(b.cursorX, term.cols - 1) * k.w, y: k.offY + wiersz * k.h }
  }

  const rysuj = (k: Komorka, smugaX: number, smugaY: number): void => {
    // Blok rozciągnięty od bieżącej pozycji do celu — to jest cała „smuga".
    const left = Math.min(x, smugaX)
    const top = Math.min(y, smugaY)
    const w = Math.abs(smugaX - x) + k.w
    const h = Math.abs(smugaY - y) + k.h
    el.style.transform = `translate(${left}px, ${top}px)`
    el.style.width = `${w}px`
    el.style.height = `${h}px`
  }

  const krok = (teraz: number): void => {
    klatka = 0
    if (!zywy) return
    const b = term.buffer.active
    const przewiniecie = b.viewportY - viewport
    const zmianaBufora = b.type !== bufor
    viewport = b.viewportY
    bufor = b.type
    const k = zmierz()
    const t = k && cel(k)
    if (!k || !t) {
      el.hidden = true
      return
    }
    if (el.hidden || zmianaBufora || Math.abs(przewiniecie) >= term.rows) {
      // Pojawienie się albo skok o cały ekran — stajemy od razu, bez smugi przez pół ekranu.
      el.hidden = false
      x = t.x
      y = t.y
    } else {
      // Przewinięcie przesuwa tekst, a z nim punkt, z którego blok płynie.
      y -= przewiniecie * k.h
    }
    // Krok zależny od czasu, nie od liczby klatek: na 120 Hz kursor nie może dojeżdżać
    // dwa razy szybciej niż na 60 Hz.
    const dt = ostatniaKlatka ? Math.min(64, teraz - ostatniaKlatka) : 16
    ostatniaKlatka = teraz
    const a = Math.min(1, dt / CZAS_MS)
    const dx = t.x - x
    const dy = t.y - y
    if (Math.abs(dx) < PRZYCIAGANIE && Math.abs(dy) < PRZYCIAGANIE) {
      x = t.x
      y = t.y
      ostatniaKlatka = 0
      rysuj(k, x, y) // dojechał — blok wraca do rozmiaru jednej komórki
      return
    }
    x += dx * a
    y += dy * a
    rysuj(k, t.x, t.y)
    klatka = requestAnimationFrame(krok)
  }

  const obudz = (): void => {
    if (!zywy || klatka) return
    ostatniaKlatka = 0
    klatka = requestAnimationFrame(krok)
  }

  // onRender przychodzi też po przewinięciu i po każdym zapisie (wiersz kursora jest wtedy
  // odświeżany), więc łapie również ESC[?25l/h.
  const offCursor = term.onCursorMove(obudz)
  const offRender = term.onRender(obudz)
  // Po zmianie rozmiaru tekst się przelewa — stara pozycja w px nic nie znaczy, więc skok.
  const offResize = term.onResize(() => {
    el.hidden = true
    obudz()
  })

  const onFocus = (): void => el.classList.remove('smear-cursor--blur')
  const onBlur = (): void => el.classList.add('smear-cursor--blur')
  term.textarea?.addEventListener('focus', onFocus)
  term.textarea?.addEventListener('blur', onBlur)
  if (document.activeElement !== term.textarea) el.classList.add('smear-cursor--blur')

  obudz()

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
