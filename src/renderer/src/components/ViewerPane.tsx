import { useCallback, useEffect, useRef, useState } from 'react'
import { renderAsync } from 'docx-preview'
import { useStore } from '../state/store'
import { matchVimKey, isDoubleFirst, WIN_MOTION_IDS, type DoubleState } from '../../../shared/vimKeys'
import { armWinPending, clearWinPending, runWindowMotion } from '../shortcuts/dispatch'
import { FIND_EVENT, type FindDetail } from '../shortcuts/find'
import { createDomFinder, findInTextarea, type DomFinder } from '../lib/domFind'
import PdfView from './PdfView'

interface Props {
  paneId: string
  filePath?: string // plik do automatycznego wczytania (np. z eksploratora)
  remoteConn?: string // id połączenia SSH — gdy ustawione, czytamy/zapisujemy przez SFTP
}

const IMAGE_EXTS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'avif']

type Content =
  | { kind: 'image'; name: string; url: string }
  | { kind: 'pdf'; name: string; buf: ArrayBuffer }
  | { kind: 'docx'; name: string; buf: ArrayBuffer }
  | { kind: 'text'; name: string; text: string; path?: string }

function b64ToBuf(b64: string): ArrayBuffer {
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return bytes.buffer
}

function extOf(name: string): string {
  return name.split('.').pop()?.toLowerCase() ?? ''
}

// Wizualnie pierwszy węzeł tekstowy (najwyżej, a przy równej wysokości najbardziej w lewo).
// W PDF spany warstwy tekstu są absolutnie pozycjonowane i NIE w kolejności czytania, więc
// kolejność DOM nie wystarcza — wybieramy po geometrii, by karetka startowała na górze kartki.
function topLeftTextNode(root: HTMLElement): Text | null {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  const range = document.createRange()
  let best: Text | null = null
  let bestTop = Infinity
  let bestLeft = Infinity
  let scanned = 0
  let n = walker.nextNode()
  while (n && scanned < 600) {
    if (n.textContent?.trim()) {
      range.selectNodeContents(n)
      const r = range.getBoundingClientRect()
      if (r.height > 0 && r.width > 0) {
        if (r.top < bestTop - 3 || (Math.abs(r.top - bestTop) <= 3 && r.left < bestLeft)) {
          bestTop = r.top
          bestLeft = r.left
          best = n as Text
        }
        scanned++
      }
    }
    n = walker.nextNode()
  }
  return best
}

// Ustawia zwinięte zaznaczenie (karetkę) na początku wizualnie pierwszego tekstu.
function caretToStart(el: HTMLElement): void {
  const sel = window.getSelection()
  if (!sel) return
  const tn = topLeftTextNode(el)
  sel.removeAllRanges()
  const r = document.createRange()
  if (tn) r.setStart(tn, 0)
  else r.selectNodeContents(el)
  r.collapse(true)
  sel.addRange(r)
}

/** Panel-viewer: obraz (zoom/pan), PDF, .docx (podgląd), tekst/MD (edycja). */
export default function ViewerPane({ paneId, filePath, remoteConn }: Props): JSX.Element {
  const [content, setContent] = useState<Content | null>(null)
  const [text, setText] = useState('')
  const [dragOver, setDragOver] = useState(false)
  // Tryb kopiowania (pdf/docx): w „view" klawisze scrollują/zoomują, w „copy" treść jest zaznaczalna
  // myszką i `y` kopiuje zaznaczenie do schowka. Włączany tylko w vim mode (poza nim treść jest
  // normalnie zaznaczalna i tryb nie ma znaczenia).
  const [copyMode, setCopyMode] = useState(false)
  const [visual, setVisual] = useState(false) // w trybie copy: czy h/j/k/l zaznacza (vimowy visual)
  const [flash, setFlash] = useState('') // krótki komunikat „✓ Copied"
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const urlRef = useRef<string | null>(null) // do zwalniania blob URL
  const docxRef = useRef<HTMLDivElement>(null) // wewnętrzna treść docx (skalowana zoomem)
  const docxScrollRef = useRef<HTMLDivElement>(null) // zewnętrzny kontener scrolla (bez zoomu)
  const textRef = useRef<HTMLTextAreaElement>(null) // do scrolla i wykrycia trybu edycji
  const pdfScrollRef = useRef<HTMLDivElement>(null) // kontener scrolla PDF (pdf.js)
  const pdfInnerRef = useRef<HTMLDivElement>(null) // wewnętrzna treść PDF (contentEditable w trybie copy)
  const paneRef = useRef<HTMLDivElement>(null) // korzeń panelu (kotwica dla własnej karetki)
  const caretRef = useRef<HTMLDivElement>(null) // własna, dobrze widoczna karetka trybu copy
  const contentRef = useRef<Content | null>(null)
  const copyModeRef = useRef(false)
  const visualRef = useRef(false)
  const winPendingRef = useRef(false)
  const winTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const dblRef = useRef<DoubleState>({ key: '', time: 0 })
  // Finder DOM (pdf/docx) — korzeń wybierany w locie wg rodzaju treści.
  const finderRef = useRef<DomFinder>(
    createDomFinder(() => {
      const k = contentRef.current?.kind
      return k === 'docx' ? docxRef.current : k === 'pdf' ? pdfInnerRef.current : null
    })
  )
  copyModeRef.current = copyMode
  visualRef.current = visual

  const vimMode = useStore((s) => s.vimMode)
  const notesOpen = useStore((s) => s.notesOpen)
  const activeId = useStore((s) => s.activePaneId)

  const showFlash = useCallback((msg: string) => {
    setFlash(msg)
    if (flashTimer.current) clearTimeout(flashTimer.current)
    flashTimer.current = setTimeout(() => setFlash(''), 1200)
  }, [])

  // Zoom/pan obrazu
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const dragRef = useRef<{ x: number; y: number; px: number; py: number } | null>(null)
  contentRef.current = content

  const revoke = (): void => {
    if (urlRef.current) {
      URL.revokeObjectURL(urlRef.current)
      urlRef.current = null
    }
  }

  const ingest = useCallback((name: string, buf: ArrayBuffer, path?: string) => {
    const ext = extOf(name)
    revoke()
    setZoom(1)
    setPan({ x: 0, y: 0 })
    setCopyMode(false)
    setVisual(false)
    if (IMAGE_EXTS.includes(ext)) {
      const url = URL.createObjectURL(new Blob([buf]))
      urlRef.current = url
      setContent({ kind: 'image', name, url })
    } else if (ext === 'pdf') {
      setContent({ kind: 'pdf', name, buf })
    } else if (ext === 'docx') {
      setContent({ kind: 'docx', name, buf })
    } else {
      const t = new TextDecoder().decode(buf)
      setText(t)
      setContent({ kind: 'text', name, text: t, path })
    }
  }, [])

  const ingestFile = useCallback(
    (file: File) => {
      const path = (file as File & { path?: string }).path
      file.arrayBuffer().then((buf) => ingest(file.name, buf, path))
    },
    [ingest]
  )

  // Otwórz z eksploratora
  const openDialog = useCallback(async () => {
    const f = await window.api.files.open()
    if (f) ingest(f.name, b64ToBuf(f.base64), f.path)
  }, [ingest])

  // Render .docx do diva
  useEffect(() => {
    if (content?.kind === 'docx' && docxRef.current) {
      docxRef.current.innerHTML = ''
      renderAsync(new Blob([content.buf]), docxRef.current, undefined, {
        className: 'docx',
        inWrapper: true
      }).catch(() => {
        if (docxRef.current) docxRef.current.textContent = 'Cannot render this .docx file.'
      })
    }
  }, [content])

  // Wklejanie (Cmd/Ctrl+V) — tylko gdy ten panel jest aktywny.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent): void => {
      if (useStore.getState().activePaneId !== paneId) return
      const items = e.clipboardData?.items
      if (!items) return
      for (let i = 0; i < items.length; i++) {
        const it = items[i]
        if (it.kind === 'file') {
          const f = it.getAsFile()
          if (f) {
            e.preventDefault()
            ingestFile(f)
            return
          }
        }
      }
    }
    document.addEventListener('paste', onPaste)
    return () => document.removeEventListener('paste', onPaste)
  }, [paneId, ingestFile])

  useEffect(
    () => () => {
      revoke()
      if (flashTimer.current) clearTimeout(flashTimer.current)
      finderRef.current.clear()
    },
    []
  )

  // Wyszukiwanie (Ctrl/⌘+F): pdf/docx → CSS Highlight (widoczne też w trybie VIEW), tekst → textarea.
  useEffect(() => {
    const onFind = (e: Event): void => {
      const d = (e as CustomEvent<FindDetail>).detail
      if (d.inNotes || d.paneId !== paneId) return
      const k = contentRef.current?.kind
      if (d.type === 'close') {
        finderRef.current.clear()
        return
      }
      if (k === 'text') {
        const ta = textRef.current
        if (!ta) return
        const backwards = d.type === 'prev'
        const from =
          d.type === 'query' ? ta.selectionStart : backwards ? ta.selectionStart : ta.selectionEnd
        findInTextarea(ta, d.query, from, backwards)
        return
      }
      if (k === 'pdf' || k === 'docx') {
        if (d.type === 'query') finderRef.current.search(d.query)
        else if (d.type === 'next') finderRef.current.next()
        else finderRef.current.prev()
      }
    }
    window.addEventListener(FIND_EVENT, onFind)
    return () => window.removeEventListener(FIND_EVENT, onFind)
  }, [paneId])

  // Zmiana treści (nowy plik) — czyścimy podświetlenia wyszukiwania poprzedniego dokumentu.
  useEffect(() => {
    finderRef.current.clear()
  }, [content])

  // Tryb COPY: treść (docx lub wewn. PDF) robimy contentEditable → prawdziwa migająca karetka na
  // pierwszej literce, strzałki/Shift+strzałki/⌘A/h-j-k-l i mysz. Canvasy PDF są `contenteditable=false`
  // + `user-select:none`, więc karetka je pomija, a zaznaczenie nie łapie „pustych stron". Faktyczną
  // edycję blokuje osobny `beforeinput` (niżej).
  useEffect(() => {
    const el = content?.kind === 'docx' ? docxRef.current : content?.kind === 'pdf' ? pdfInnerRef.current : null
    if (!el) return
    if (copyMode) {
      el.setAttribute('contenteditable', 'true')
      el.spellcheck = false
      el.focus()
      caretToStart(el)
    } else {
      el.removeAttribute('contenteditable')
      if (el.contains(document.activeElement)) el.blur()
      window.getSelection()?.removeAllRanges()
    }
  }, [copyMode, content])

  // Zoom PDF kółkiem z Ctrl/⌘ (oraz gestem pinch na trackpadzie — wysyła ctrl+wheel).
  useEffect(() => {
    const sc = pdfScrollRef.current
    if (content?.kind !== 'pdf' || !sc) return
    const onWheel = (e: WheelEvent): void => {
      if (!e.ctrlKey && !e.metaKey) return // bez modyfikatora = zwykły scroll
      e.preventDefault()
      setZoom((z) => Math.min(8, Math.max(0.2, z * (e.deltaY < 0 ? 1.1 : 0.91))))
    }
    sc.addEventListener('wheel', onWheel, { passive: false })
    return () => sc.removeEventListener('wheel', onWheel)
  }, [content])

  // Własna karetka: rysujemy gruby pasek w miejscu fokusu zaznaczenia (natywna karetka nad
  // absolutnie pozycjonowaną warstwą tekstu PDF bywała niewidoczna / w złym miejscu).
  const positionCaret = useCallback((): void => {
    const caret = caretRef.current
    const pane = paneRef.current
    if (!caret || !pane) return
    const sel = window.getSelection()
    if (!copyModeRef.current || !sel || sel.rangeCount === 0) {
      caret.style.display = 'none'
      return
    }
    const range = sel.getRangeAt(0).cloneRange()
    range.collapse(false) // do punktu fokusu (koniec zaznaczenia)
    const rect = range.getClientRects()[0] ?? range.getBoundingClientRect()
    if (!rect || (rect.height === 0 && rect.top === 0 && rect.left === 0)) {
      caret.style.display = 'none'
      return
    }
    const pr = pane.getBoundingClientRect()
    caret.style.display = 'block'
    caret.style.left = `${rect.left - pr.left}px`
    caret.style.top = `${rect.top - pr.top}px`
    caret.style.height = `${Math.max(rect.height, 15)}px`
  }, [])

  useEffect(() => {
    if (!copyMode) {
      if (caretRef.current) caretRef.current.style.display = 'none'
      return
    }
    const reposition = (): void => positionCaret()
    document.addEventListener('selectionchange', reposition)
    const sc =
      content?.kind === 'pdf' ? pdfScrollRef.current : content?.kind === 'docx' ? docxScrollRef.current : null
    sc?.addEventListener('scroll', reposition, { passive: true })
    window.addEventListener('resize', reposition)
    const raf = requestAnimationFrame(reposition)
    return () => {
      cancelAnimationFrame(raf)
      document.removeEventListener('selectionchange', reposition)
      sc?.removeEventListener('scroll', reposition)
      window.removeEventListener('resize', reposition)
    }
  }, [copyMode, content, positionCaret])

  // Wyjście z trybu COPY, gdy panel przestaje być aktywny lub otwierają się notatki — inaczej
  // contentEditable viewera „trzymałby" fokus/edycję i nie dało się wkleić do notatek.
  useEffect(() => {
    if (copyMode && (notesOpen || activeId !== paneId)) {
      setCopyMode(false)
      setVisual(false)
    }
  }, [notesOpen, activeId, paneId, copyMode])

  // Blokada faktycznej edycji w trybie COPY — TYLKO wewnątrz treści tego viewera (docx/PDF).
  // Dzięki zawężeniu do elementu nie blokuje wklejania/pisania nigdzie indziej (np. w notatkach).
  useEffect(() => {
    const block = (e: Event): void => {
      if (!copyModeRef.current) return
      const el = contentRef.current?.kind === 'docx' ? docxRef.current : pdfInnerRef.current
      if (el && e.target instanceof Node && el.contains(e.target)) e.preventDefault()
    }
    window.addEventListener('beforeinput', block, true)
    return () => window.removeEventListener('beforeinput', block, true)
  }, [paneId])

  // Plik podany z zewnątrz (eksplorator) — wczytaj do viewera (lokalnie albo zdalnie przez SFTP).
  useEffect(() => {
    if (!filePath) return
    const read = remoteConn
      ? window.api.ssh.readFile(remoteConn, filePath)
      : window.api.files.read(filePath)
    read.then((f) => ingest(f.name, b64ToBuf(f.base64), f.path)).catch(() => {})
  }, [filePath, remoteConn, ingest])

  // Vim w viewerze: scroll/zoom wg konfigurowalnej keymapy + prefiks Ctrl-w (nawigacja oknami).
  // Aktywny tylko gdy to aktywny panel, vim ON i nie edytujemy textarey (textarea = INSERT).
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      // Pisanie w pasku wyszukiwania nie może być przejęte przez handler viewera (capture).
      if ((e.target as HTMLElement | null)?.closest?.('.find-bar')) return
      const s = useStore.getState()
      if (!s.vimMode || s.activePaneId !== paneId) return
      const vb = s.vimBinds

      // Ctrl+d / Ctrl+u — pół strony (działa też w trybie COPY, gdzie j/k rusza karetką, nie scrolluje).
      if (e.ctrlKey && !e.metaKey && !e.altKey && (e.key === 'd' || e.key === 'u')) {
        const k = contentRef.current?.kind
        const tgt =
          k === 'pdf'
            ? pdfScrollRef.current
            : k === 'docx'
              ? docxScrollRef.current
              : k === 'text'
                ? textRef.current
                : null
        const dir = e.key === 'd' ? 0.5 : -0.5
        if (tgt) tgt.scrollTop += dir * tgt.clientHeight
        else if (k === 'image') setPan((p) => ({ ...p, y: p.y - dir * window.innerHeight }))
        e.preventDefault()
        e.stopPropagation()
        return
      }

      // Tryb COPY (pdf/docx): treść jest contentEditable → mamy prawdziwą karetkę.
      // Obsługujemy tu y/Esc/V/ruch ZANIM zadziała ogólny bail na polach edytowalnych.
      const cc = contentRef.current
      if (copyModeRef.current && (cc?.kind === 'pdf' || cc?.kind === 'docx')) {
        const d2 = dblRef.current
        const sel = window.getSelection() as
          | (Selection & { modify?: (alter: string, direction: string, granularity: string) => void })
          | null
        if (matchVimKey(vb['viewer.yank'], e, d2)) {
          const txt = sel?.toString() ?? ''
          if (txt) {
            navigator.clipboard.writeText(txt).catch(() => {})
            showFlash('✓ Copied')
          } else showFlash('No selection — press V then h/j/k/l to select')
          setVisual(false) // y kończy zaznaczanie (jak w vimie)
          e.preventDefault()
          e.stopPropagation()
          return
        }
        if (e.key === 'Escape') {
          setCopyMode(false)
          setVisual(false)
          showFlash('VIEW mode')
          e.preventDefault()
          e.stopPropagation()
          return
        }
        // v (lub V) w trybie copy — przełącza zaznaczanie: ruch karetki ⇄ visual.
        // Przy włączeniu visual „kotwiczymy" w bieżącym kursorze. Wyjście z copy = Esc.
        if (matchVimKey(vb['viewer.copy'], e, d2) || matchVimKey(vb['viewer.visual'], e, d2)) {
          const next = !visualRef.current
          if (next && sel?.focusNode) sel.collapse(sel.focusNode, sel.focusOffset)
          setVisual(next)
          showFlash(next ? 'VISUAL — h/j/k/l selects · y yanks · Esc exits' : 'COPY — h/j/k/l moves caret · v selects')
          e.preventDefault()
          e.stopPropagation()
          return
        }
        // Ruch h/j/k/l: w visualu rozszerza zaznaczenie, inaczej przesuwa karetkę.
        // Strzałki / Shift+strzałki / ⌘A obsługuje natywnie przeglądarka.
        if (sel && typeof sel.modify === 'function' && !e.ctrlKey && !e.metaKey && !e.altKey) {
          const alter = visualRef.current || e.shiftKey ? 'extend' : 'move'
          let dir: string | null = null
          let gran = 'character'
          if (matchVimKey(vb['viewer.left'], e)) dir = 'left'
          else if (matchVimKey(vb['viewer.right'], e)) dir = 'right'
          else if (matchVimKey(vb['viewer.up'], e)) {
            dir = 'backward'
            gran = 'line'
          } else if (matchVimKey(vb['viewer.down'], e)) {
            dir = 'forward'
            gran = 'line'
          }
          if (dir) {
            sel.modify(alter, dir, gran)
            // Utrzymaj karetkę w polu widzenia (pozwala „zjechać" na kolejną stronę PDF).
            const fn = sel.focusNode
            const elt = (fn?.nodeType === 1 ? fn : fn?.parentElement) as HTMLElement | null
            elt?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
            e.preventDefault()
            e.stopPropagation()
            return
          }
        }
        return // pozostałe klawisze (strzałki itp.) — natywna obsługa karetki
      }

      // Jakiekolwiek pole tekstowe ma fokus (nasz textarea, notatki, pasek adresu) → nie ruszamy:
      // ten nasłuch jest globalny (capture), więc inaczej kradłby klawisze np. vimowi w notatkach.
      const ae = document.activeElement as HTMLElement | null
      if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.isContentEditable)) {
        if (ae === textRef.current && e.key === 'Escape') textRef.current?.blur()
        return
      }
      // Prefiks Ctrl-w: drugi klawisz = nawigacja oknami.
      if (winPendingRef.current) {
        winPendingRef.current = false
        if (winTimerRef.current) clearTimeout(winTimerRef.current)
        const act = WIN_MOTION_IDS.find((id) => matchVimKey(vb[id], e))
        clearWinPending()
        if (act) runWindowMotion(act)
        e.preventDefault()
        e.stopPropagation()
        return
      }
      if (matchVimKey(vb['win.prefix'], e)) {
        winPendingRef.current = true
        armWinPending()
        if (winTimerRef.current) clearTimeout(winTimerRef.current)
        winTimerRef.current = setTimeout(() => (winPendingRef.current = false), 2200)
        e.preventDefault()
        e.stopPropagation()
        return
      }
      if (e.metaKey || e.altKey || e.ctrlKey) return

      const c = contentRef.current
      const dbl = dblRef.current
      const target =
        c?.kind === 'text'
          ? textRef.current
          : c?.kind === 'docx'
            ? docxScrollRef.current
            : c?.kind === 'pdf'
              ? pdfScrollRef.current
              : null
      const pageH = target ? target.clientHeight : window.innerHeight
      const scrollByAmt = (dy: number): void => {
        if (c?.kind === 'image') return setPan((p) => ({ ...p, y: p.y - dy }))
        if (target) target.scrollTop += dy
      }
      const toEnd = (bottom: boolean): void => {
        if (c?.kind === 'image') return setPan((p) => ({ ...p, y: bottom ? -4000 : 4000 }))
        if (target) target.scrollTop = bottom ? target.scrollHeight : 0
      }
      const scrollByX = (dx: number): void => {
        if (c?.kind === 'image') return setPan((p) => ({ ...p, x: p.x - dx }))
        if (target) target.scrollLeft += dx
      }

      // Wejście w tryb COPY (pdf/docx). Pierwsze v = karetka + ruch (bez zaznaczania); kolejne v
      // przełącza zaznaczanie (visual). Dalszą obsługę robi blok „copy ON" na górze handlera.
      if ((c?.kind === 'pdf' || c?.kind === 'docx') && matchVimKey(vb['viewer.copy'], e, dbl)) {
        setCopyMode(true)
        setVisual(false)
        showFlash('COPY — caret on · h/j/k/l moves · press v again to select · y yank · Esc exit')
        e.preventDefault()
        e.stopPropagation()
        return
      }

      let handled = true
      if (matchVimKey(vb['viewer.halfDown'], e, dbl)) scrollByAmt(pageH / 2)
      else if (matchVimKey(vb['viewer.halfUp'], e, dbl)) scrollByAmt(-pageH / 2)
      else if (matchVimKey(vb['viewer.down'], e, dbl)) scrollByAmt(60)
      else if (matchVimKey(vb['viewer.up'], e, dbl)) scrollByAmt(-60)
      else if (matchVimKey(vb['viewer.left'], e, dbl)) scrollByX(-60)
      else if (matchVimKey(vb['viewer.right'], e, dbl)) scrollByX(60)
      else if (matchVimKey(vb['viewer.top'], e, dbl)) toEnd(false)
      else if (matchVimKey(vb['viewer.bottom'], e, dbl)) toEnd(true)
      else if (matchVimKey(vb['viewer.zoomIn'], e, dbl)) setZoom((z) => Math.min(8, z * 1.12))
      else if (matchVimKey(vb['viewer.zoomOut'], e, dbl)) setZoom((z) => Math.max(0.2, z * 0.89))
      else if (matchVimKey(vb['viewer.reset'], e, dbl)) {
        setZoom(1)
        setPan({ x: 0, y: 0 })
      } else if (isDoubleFirst(e, [vb['viewer.top']])) {
        /* pierwsze 'g' z 'gg' — połykamy */
      } else handled = false

      if (handled) {
        e.preventDefault()
        e.stopPropagation()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [paneId])

  // Drag & drop (plik z systemu lub obraz przeciągnięty z Notes)
  const onDrop = (e: React.DragEvent): void => {
    e.preventDefault()
    setDragOver(false)
    const dt = e.dataTransfer
    // Plik przeciągnięty z Notes (referencja {name, path}).
    const vf = dt.getData('application/x-vibe-file')
    if (vf) {
      try {
        const ref = JSON.parse(vf) as { name: string; path: string }
        window.api.files.read(ref.path).then((f) => ingest(f.name, b64ToBuf(f.base64), f.path))
      } catch {
        /* zły payload */
      }
      return
    }
    if (dt.files && dt.files[0]) {
      ingestFile(dt.files[0])
    }
  }

  const onImgWheel = (e: React.WheelEvent): void => {
    e.preventDefault()
    setZoom((z) => Math.min(8, Math.max(0.2, z * (e.deltaY < 0 ? 1.12 : 0.89))))
  }
  const onImgDown = (e: React.MouseEvent): void => {
    dragRef.current = { x: e.clientX, y: e.clientY, px: pan.x, py: pan.y }
  }
  const onImgMove = (e: React.MouseEvent): void => {
    const d = dragRef.current
    if (!d) return
    setPan({ x: d.px + (e.clientX - d.x), y: d.py + (e.clientY - d.y) })
  }
  const endDrag = (): void => {
    dragRef.current = null
  }

  const saveText = async (): Promise<void> => {
    if (content?.kind !== 'text' || !content.path) return
    const r = remoteConn
      ? await window.api.ssh.writeFile(remoteConn, content.path, text)
      : await window.api.files.save(content.path, text)
    if ('ok' in r && !r.ok) {
      showFlash('Save failed' + (('error' in r && r.error) ? ': ' + r.error : ''))
    } else {
      showFlash('✓ Saved')
    }
  }

  return (
    <div
      ref={paneRef}
      className={
        'viewer-pane' +
        (dragOver ? ' viewer-pane--drop' : '') +
        (vimMode && !copyMode ? ' viewer-pane--noselect' : '') +
        (copyMode ? ' viewer-pane--copy' : '')
      }
      onDragOver={(e) => {
        e.preventDefault()
        setDragOver(true)
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={onDrop}
    >
      {!content && (
        <div className="viewer-empty">
          <div className="viewer-upload-icon">⬆</div>
          <p>Drop a file here, paste (⌘V), or</p>
          <button className="notes-btn notes-btn--primary" onClick={openDialog}>
            Open from explorer
          </button>
          <p className="viewer-hint">Images · PDF · text/markdown · .docx</p>
        </div>
      )}

      {content && (
        <div className="viewer-head">
          <span className="viewer-name" title={content.name}>
            {content.name}
          </span>
          {vimMode && (content.kind === 'pdf' || content.kind === 'docx') && (
            <span
              className={'viewer-mode' + (copyMode ? ' viewer-mode--copy' : '')}
              data-tip={
                copyMode
                  ? 'h/j/k/l selects · V move-only · y yank · Esc view'
                  : 'Press copy-mode key (v) to select text'
              }
            >
              {copyMode ? (visual ? 'VISUAL' : 'COPY') : 'VIEW'}
            </span>
          )}
          {content.kind === 'text' && content.path && (
            <button className="icon-btn" data-tip="Save" onClick={saveText}>
              💾
            </button>
          )}
          <button className="icon-btn" data-tip="Open another file" onClick={openDialog}>
            📁
          </button>
        </div>
      )}

      {content?.kind === 'image' && (
        <div
          className="viewer-image-wrap"
          onWheel={onImgWheel}
          onMouseDown={onImgDown}
          onMouseMove={onImgMove}
          onMouseUp={endDrag}
          onMouseLeave={endDrag}
          onDoubleClick={() => {
            setZoom(1)
            setPan({ x: 0, y: 0 })
          }}
        >
          <img
            className="viewer-image"
            src={content.url}
            alt={content.name}
            draggable={false}
            style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }}
          />
        </div>
      )}

      {content?.kind === 'pdf' && (
        <PdfView buf={content.buf} zoom={zoom} scrollRef={pdfScrollRef} innerRef={pdfInnerRef} />
      )}

      {copyMode && <div className="viewer-caret" ref={caretRef} />}
      {flash && <div className="viewer-flash">{flash}</div>}

      {content?.kind === 'docx' && (
        // Zoom na WEWNĘTRZNEJ treści (CSS `zoom` skaluje layout), scroll na zewnętrznym
        // kontenerze — inaczej skalowanie kontenera scrolla psuło dojazd do krawędzi.
        <div className="viewer-docx" ref={docxScrollRef}>
          <div className="viewer-docx-inner" ref={docxRef} style={{ zoom }} />
        </div>
      )}

      {content?.kind === 'text' && (
        <textarea
          ref={textRef}
          className="viewer-text"
          value={text}
          spellCheck={false}
          onChange={(e) => setText(e.target.value)}
        />
      )}
    </div>
  )
}
