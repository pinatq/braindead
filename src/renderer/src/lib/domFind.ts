// Wyszukiwanie tekstu w treści DOM (viewer pdf/docx) bez modyfikacji drzewa — przez
// CSS Custom Highlight API (Chromium 126 / Electron 31 wspiera). Działa nawet przy
// `user-select: none` (w przeciwieństwie do zwykłego zaznaczenia), więc podświetlenie
// trafień jest widoczne także w trybie VIEW viewera.

/* eslint-disable @typescript-eslint/no-explicit-any */

interface HighlightRegistry {
  set: (name: string, hl: unknown) => void
  delete: (name: string) => void
}

const HL: (new (...ranges: Range[]) => unknown) | undefined = (globalThis as any).Highlight
const registry: HighlightRegistry | undefined = (CSS as any).highlights
const SUPPORTED = typeof HL === 'function' && !!registry

export interface DomFinder {
  /** Zbiera trafienia w korzeniu, podświetla i pokazuje pierwsze. Zwraca liczbę trafień. */
  search: (query: string) => number
  next: () => void
  prev: () => void
  clear: () => void
}

export function createDomFinder(getRoot: () => HTMLElement | null): DomFinder {
  let ranges: Range[] = []
  let idx = -1

  const paint = (): void => {
    if (!SUPPORTED || !registry || !HL) return
    registry.set('vibe-find', new HL(...ranges))
    const cur = ranges[idx]
    registry.set('vibe-find-current', cur ? new HL(cur.cloneRange()) : new HL())
  }

  const collect = (q: string): void => {
    ranges = []
    idx = -1
    const root = getRoot()
    if (!root || !q) return
    const ql = q.toLowerCase()
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
    let n = walker.nextNode()
    while (n) {
      const text = n.textContent ?? ''
      const lower = text.toLowerCase()
      let i = lower.indexOf(ql)
      while (i !== -1) {
        const r = document.createRange()
        r.setStart(n, i)
        r.setEnd(n, i + q.length)
        ranges.push(r)
        i = lower.indexOf(ql, i + q.length)
      }
      n = walker.nextNode()
    }
  }

  const reveal = (): void => {
    const r = ranges[idx]
    if (r) {
      const el = (r.startContainer.nodeType === 1 ? r.startContainer : r.startContainer.parentElement) as
        | HTMLElement
        | null
      el?.scrollIntoView({ block: 'center', inline: 'nearest' })
    }
    paint()
  }

  return {
    search(q) {
      collect(q)
      idx = ranges.length ? 0 : -1
      reveal()
      return ranges.length
    },
    next() {
      if (!ranges.length) return
      idx = (idx + 1) % ranges.length
      reveal()
    },
    prev() {
      if (!ranges.length) return
      idx = (idx - 1 + ranges.length) % ranges.length
      reveal()
    },
    clear() {
      ranges = []
      idx = -1
      if (SUPPORTED && registry) {
        registry.delete('vibe-find')
        registry.delete('vibe-find-current')
      }
    }
  }
}

// Przewija textarea tak, by trafienie pod danym indeksem było mniej więcej na środku.
function scrollTextareaTo(ta: HTMLTextAreaElement, index: number): void {
  const before = ta.value.slice(0, index)
  const line = before.split('\n').length - 1
  const style = getComputedStyle(ta)
  const lh = parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.4 || 16
  ta.scrollTop = Math.max(0, line * lh - ta.clientHeight / 2)
}

/**
 * Szuka frazy w textarea (notatki / viewer tekstowy). Ustawia zaznaczenie na trafieniu i przewija
 * do niego (bez przejmowania fokusu — pasek find zachowuje fokus dla pisania na żywo). Zawija się.
 * Zwraca true, gdy znaleziono.
 */
export function findInTextarea(
  ta: HTMLTextAreaElement,
  query: string,
  from: number,
  backwards: boolean
): boolean {
  if (!query) return false
  const hay = ta.value.toLowerCase()
  const q = query.toLowerCase()
  let i = backwards ? hay.lastIndexOf(q, Math.max(0, from - 1)) : hay.indexOf(q, from)
  if (i === -1) i = backwards ? hay.lastIndexOf(q) : hay.indexOf(q) // zawijanie
  if (i === -1) return false
  ta.setSelectionRange(i, i + query.length)
  scrollTextareaTo(ta, i)
  return true
}
