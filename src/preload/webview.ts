/// <reference lib="dom" />
import { ipcRenderer } from 'electron'
import { matchVimKey, isDoubleFirst, WIN_MOTION_IDS } from '../shared/vimKeys'

// Preload wstrzykiwany do każdej strony w <webview>. Działa w kontekście gościa.
// Mostek do hosta (panelu), bo zdarzenia z gościa nie docierają do okna-hosta.
const send = (channel: string, ...args: unknown[]): void => {
  try {
    ipcRenderer.sendToHost(channel, ...args)
  } catch {
    /* brak hosta — ignorujemy */
  }
}

// Klik / focus w treści => aktywuj panel (niebieska ramka).
const activate = (): void => send('pane-activate')
window.addEventListener('mousedown', activate, true)
window.addEventListener('focus', activate, true)

// Znajduje najbliższy link nadrzędny dla klikniętego elementu.
function hrefFrom(target: EventTarget | null): string | null {
  let el = target as HTMLElement | null
  while (el && el.tagName !== 'A') el = el.parentElement
  const href = el && (el as HTMLAnchorElement).href
  return href || null
}

// Środkowy klik (scroll-click) lub klik z Cmd/Ctrl na linku => nowa zakładka.
window.addEventListener(
  'auxclick',
  (e) => {
    if (e.button !== 1) return
    const href = hrefFrom(e.target)
    if (href) {
      e.preventDefault()
      send('open-tab', href)
    }
  },
  true
)
window.addEventListener(
  'click',
  (e) => {
    if (!(e.metaKey || e.ctrlKey)) return
    const href = hrefFrom(e.target)
    if (href) {
      e.preventDefault()
      send('open-tab', href)
    }
  },
  true
)

// ===================== Skróty programu (priorytet nad stroną) =====================
// Host przekazuje listę "zarezerwowanych" kombinacji (bindy panelu/kart). Gdy taka
// kombinacja padnie w przeglądarce, oddajemy ją hostowi zamiast stronie/wimowi.
let reservedCombos = new Set<string>()
ipcRenderer.on('reserved-combos', (_e, combos: string[]) => {
  reservedCombos = new Set(Array.isArray(combos) ? combos : [])
})

const MODS = ['Shift', 'Control', 'Alt', 'Meta', 'CapsLock', 'OS', 'ContextMenu']
function comboOf(e: KeyboardEvent): string {
  let key = e.key
  if (MODS.includes(key)) return ''
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

// ===================== Vim mode (Vimium-lite) =====================
let vimEnabled = false
ipcRenderer.on('vim-mode', (_e, on: boolean) => {
  vimEnabled = !!on
  if (!vimEnabled) clearHints()
})

// Konfigurowalny keymap vima (host przysyła podzbiór Browser+Windows).
let vimBinds: Record<string, string> = {}
ipcRenderer.on('vim-binds', (_e, map: Record<string, string>) => {
  vimBinds = map && typeof map === 'object' ? map : {}
})
// Zgłoś się do hosta po wczytaniu — host odeśle aktualny stan (vim + zarezerwowane bindy).
send('vim-hello')

const HINT_CHARS = 'sadfjklewcmpgh'

function isEditable(el: Element | null): boolean {
  if (!el) return false
  const tag = el.tagName
  return (
    tag === 'INPUT' ||
    tag === 'TEXTAREA' ||
    tag === 'SELECT' ||
    (el as HTMLElement).isContentEditable === true
  )
}

// ---- Link hints ('f') ----
let hintLayer: HTMLDivElement | null = null
let hintMap: { label: string; el: HTMLElement; tag: HTMLElement }[] = []
let hintTyped = ''

function genLabels(n: number): string[] {
  const c = HINT_CHARS.split('')
  if (n <= c.length) return c.slice(0, n)
  const out: string[] = []
  for (const a of c) for (const b of c) if (out.length < n) out.push(a + b)
  return out
}

function clearHints(): void {
  hintLayer?.remove()
  hintLayer = null
  hintMap = []
  hintTyped = ''
}

function showHints(): void {
  clearHints()
  const sel =
    'a[href], button, input:not([type=hidden]), textarea, select, [role="button"], [role="link"], [onclick]'
  const W = window.innerWidth
  const H = window.innerHeight
  const els = Array.from(document.querySelectorAll<HTMLElement>(sel)).filter((el) => {
    const r = el.getBoundingClientRect()
    return r.width > 0 && r.height > 0 && r.bottom > 0 && r.right > 0 && r.top < H && r.left < W
  })
  if (!els.length) return
  const labels = genLabels(els.length)
  const layer = document.createElement('div')
  layer.setAttribute('style', 'position:fixed;inset:0;z-index:2147483646;pointer-events:none')
  els.forEach((el, i) => {
    const r = el.getBoundingClientRect()
    const tag = document.createElement('span')
    tag.textContent = labels[i].toUpperCase()
    tag.setAttribute(
      'style',
      `position:fixed;left:${Math.max(0, r.left)}px;top:${Math.max(0, r.top)}px;` +
        'background:#facc15;color:#111;font:700 11px/1.4 system-ui,sans-serif;' +
        'padding:1px 4px;border-radius:4px;box-shadow:0 1px 4px rgba(0,0,0,.5)'
    )
    layer.appendChild(tag)
    hintMap.push({ label: labels[i], el, tag })
  })
  document.body.appendChild(layer)
  hintLayer = layer
}

function activateHint(el: HTMLElement): void {
  if (isEditable(el)) el.focus()
  else el.click()
}

function onHintKey(e: KeyboardEvent): boolean {
  if (e.key === 'Escape') {
    clearHints()
    return true
  }
  if (e.key === 'Backspace') {
    hintTyped = hintTyped.slice(0, -1)
  } else if (/^[a-z]$/i.test(e.key)) {
    hintTyped += e.key.toLowerCase()
  } else {
    return true
  }
  const matches = hintMap.filter((h) => h.label.startsWith(hintTyped))
  if (matches.length === 0) {
    clearHints()
  } else if (matches.length === 1 && matches[0].label === hintTyped) {
    const el = matches[0].el
    clearHints()
    activateHint(el)
  } else {
    // podświetl pasujące, ukryj resztę
    hintMap.forEach((h) => {
      h.tag.style.opacity = h.label.startsWith(hintTyped) ? '1' : '0.25'
    })
  }
  return true
}

// Kolejne pole formularza przy każdym 'i' (cykl po wszystkich widocznych inputach/textarea).
let inputIdx = -1
function visibleInputs(): HTMLElement[] {
  const sel = 'input:not([type=hidden]):not([type=button]):not([type=submit]):not([type=checkbox]):not([type=radio]), textarea'
  const W = window.innerWidth
  const H = window.innerHeight
  return Array.from(document.querySelectorAll<HTMLElement>(sel)).filter((el) => {
    const r = el.getBoundingClientRect()
    return r.width > 0 && r.height > 0 && r.bottom > 0 && r.right > 0 && r.top < H && r.left < W
  })
}
function focusNextInput(): void {
  const els = visibleInputs()
  if (!els.length) return
  inputIdx = (inputIdx + 1) % els.length
  const el = els[inputIdx]
  el.focus()
  el.scrollIntoView({ block: 'center' })
}

let winPending = false // czeka na drugi klawisz Ctrl-w
let winTimer: ReturnType<typeof setTimeout> | null = null
const dblState = { key: '', time: 0 } // do podwójnego 'gg'

window.addEventListener(
  'keydown',
  (e) => {
    // Bindy programu (panele/karty) z modyfikatorem mają priorytet nad stroną — oddaj je hostowi.
    if (e.metaKey || e.ctrlKey || e.altKey) {
      const combo = comboOf(e)
      if (combo && reservedCombos.has(combo)) {
        e.preventDefault()
        e.stopPropagation()
        send('run-bind', combo)
        return
      }
    }
    if (!vimEnabled) return
    // Aktywne link-hints przejmują klawisze.
    if (hintLayer) {
      if (onHintKey(e)) {
        e.preventDefault()
        e.stopPropagation()
      }
      return
    }

    const vb = vimBinds

    // Prefiks Ctrl-w: drugi klawisz = nawigacja oknami (forward do hosta).
    if (winPending) {
      winPending = false
      if (winTimer) clearTimeout(winTimer)
      const act = WIN_MOTION_IDS.find((id) => matchVimKey(vb[id], e))
      if (act) send('vim-window', act)
      e.preventDefault()
      e.stopPropagation()
      return
    }
    if (matchVimKey(vb['win.prefix'], e)) {
      winPending = true
      if (winTimer) clearTimeout(winTimer)
      winTimer = setTimeout(() => (winPending = false), 2200)
      send('vim-window-prefix')
      e.preventDefault()
      e.stopPropagation()
      return
    }

    // Pisanie w polach — nie przeszkadzamy (Esc wychodzi z pola).
    if (isEditable(document.activeElement)) {
      if (e.key === 'Escape') (document.activeElement as HTMLElement).blur()
      return
    }
    // Pozostałe kombinacje z modyfikatorem zostawiamy stronie (Ctrl-w już obsłużony).
    if (e.metaKey || e.ctrlKey || e.altKey) return

    const half = window.innerHeight / 2
    let handled = true
    if (matchVimKey(vb['browser.hints'], e, dblState)) showHints()
    else if (matchVimKey(vb['browser.nextInput'], e, dblState)) focusNextInput()
    else if (matchVimKey(vb['browser.address'], e, dblState)) send('focus-url')
    else if (matchVimKey(vb['browser.back'], e, dblState)) send('vim-history', -1)
    else if (matchVimKey(vb['browser.fwd'], e, dblState)) send('vim-history', 1)
    else if (matchVimKey(vb['browser.down'], e, dblState)) window.scrollBy({ top: 60 })
    else if (matchVimKey(vb['browser.up'], e, dblState)) window.scrollBy({ top: -60 })
    else if (matchVimKey(vb['browser.left'], e, dblState)) window.scrollBy({ left: -60 })
    else if (matchVimKey(vb['browser.right'], e, dblState)) window.scrollBy({ left: 60 })
    else if (matchVimKey(vb['browser.halfDown'], e, dblState)) window.scrollBy({ top: half })
    else if (matchVimKey(vb['browser.halfUp'], e, dblState)) window.scrollBy({ top: -half })
    else if (matchVimKey(vb['browser.top'], e, dblState)) window.scrollTo({ top: 0 })
    else if (matchVimKey(vb['browser.bottom'], e, dblState))
      window.scrollTo({ top: document.body.scrollHeight })
    else if (e.key === 'Escape') clearHints()
    else if (isDoubleFirst(e, [vb['browser.top']])) {
      /* pierwsze 'g' z 'gg' — połykamy, czekając na drugie */
    } else handled = false

    if (handled) {
      e.preventDefault()
      e.stopPropagation()
    }
  },
  true
)
