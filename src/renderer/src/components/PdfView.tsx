import '../lib/pdfPolyfill' // MUSI być przed importami pdfjs (dodaje brakujące Promise.try itd.)
import { useEffect, useRef, useState } from 'react'
import * as pdfjs from 'pdfjs-dist'
import type { PDFDocumentLoadingTask, PDFDocumentProxy } from 'pdfjs-dist'
// Import modułu workera na GŁÓWNYM wątku — ustawia `globalThis.pdfjsWorker`, więc pdf.js parsuje
// bez osobnego Workera (LoopbackPort). Eliminuje problemy z modułowym/blob-workerem pod file:// i CSP.
import 'pdfjs-dist/build/pdf.worker.min.mjs'

interface Props {
  buf: ArrayBuffer
  zoom: number // mnożnik zoomu — składany w SKALĘ renderu (ostry tekst), nie CSS zoom
  scrollRef: React.RefObject<HTMLDivElement> // kontener scrolla (vimowy scroll w ViewerPane)
  innerRef: React.RefObject<HTMLDivElement> // wewnętrzna treść (zaznaczanie/karetka w trybie copy)
}

/** Renderuje PDF przez pdf.js: każda strona = canvas (obraz) + warstwa tekstu (do zaznaczania/kopiowania). */
export default function PdfView({ buf, zoom, scrollRef, innerRef }: Props): JSX.Element {
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [stage, setStage] = useState('starting…')
  const [pages, setPages] = useState(0)
  const taskRef = useRef<PDFDocumentLoadingTask | null>(null)
  const docRef = useRef<PDFDocumentProxy | null>(null)
  const renderTokenRef = useRef(0) // anuluje render w locie (re-fit / zoom / odmontowanie)
  const baseRef = useRef(1) // skala dopasowana do szerokości panelu (zoom = 1)
  const zoomRef = useRef(zoom)
  const debTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  zoomRef.current = zoom

  // Skala dopasowana do szerokości panelu (z zapasem na padding + pasek przewijania, by nie było
  // poziomego scrolla po pojawieniu się pionowego).
  const computeBase = (baseWidth: number): number => {
    const avail = (scrollRef.current?.clientWidth ?? 800) - 40
    return Math.min(3, Math.max(0.3, avail / baseWidth))
  }

  // Efektywna skala renderu = dopasowanie * zoom (ucięta, by canvas nie urósł do absurdu).
  const effScale = (): number => Math.min(4, Math.max(0.25, baseRef.current * zoomRef.current))

  const renderAll = async (scale: number): Promise<void> => {
    const doc = docRef.current
    const inner = innerRef.current
    if (!doc || !inner) return
    const token = ++renderTokenRef.current
    inner.innerHTML = ''
    // Warstwa tekstu skaluje font wg --total-scale-factor (patrz .textLayer w theme.css).
    inner.style.setProperty('--scale-factor', String(scale))
    inner.style.setProperty('--total-scale-factor', String(scale))
    const dpr = window.devicePixelRatio || 1

    for (let n = 1; n <= doc.numPages; n++) {
      if (token !== renderTokenRef.current) return
      setStage(`rendering page ${n}/${doc.numPages}…`)
      const page = await doc.getPage(n)
      if (token !== renderTokenRef.current) return
      const vp = page.getViewport({ scale })
      const w = Math.floor(vp.width)
      const h = Math.floor(vp.height)

      const pageEl = document.createElement('div')
      pageEl.className = 'pdf-page'
      pageEl.style.width = `${w}px`
      pageEl.style.height = `${h}px`

      const canvas = document.createElement('canvas')
      canvas.className = 'pdf-canvas'
      canvas.contentEditable = 'false' // wyspa nieedytowalna — karetka trybu copy ją pomija
      canvas.width = Math.floor(w * dpr)
      canvas.height = Math.floor(h * dpr)
      canvas.style.width = `${w}px`
      canvas.style.height = `${h}px`
      pageEl.appendChild(canvas)

      const tl = document.createElement('div')
      tl.className = 'textLayer'
      pageEl.appendChild(tl)

      inner.appendChild(pageEl)

      const ctx = canvas.getContext('2d')
      if (!ctx) continue
      // transform=skala DPR: canvas ma backing w·dpr×h·dpr (ostrość), więc rysunek trzeba przeskalować,
      // inaczej pdf.js rysuje stronę w 1× i ląduje w lewym-górnym 1/4 (a warstwa tekstu się rozjeżdża).
      await page.render({
        canvas,
        canvasContext: ctx,
        viewport: vp,
        transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined
      }).promise
      if (token !== renderTokenRef.current) return

      if (n === 1) setStatus('ready') // pokaż dokument od razu po pierwszej stronie
      setPages(n)
      try {
        const textContent = await page.getTextContent()
        if (token !== renderTokenRef.current) return
        const textLayer = new pdfjs.TextLayer({ textContentSource: textContent, container: tl, viewport: vp })
        await textLayer.render()
      } catch (e) {
        console.warn('[pdf] text layer failed on page', n, e)
      }
      page.cleanup()
    }
    if (token === renderTokenRef.current) {
      setStatus('ready')
      setStage('done')
    }
  }

  // Przerenderowanie z debounce (zoom / zmiana szerokości) — ostry tekst przy każdej skali.
  const scheduleRender = (): void => {
    if (debTimer.current) clearTimeout(debTimer.current)
    debTimer.current = setTimeout(() => renderAll(effScale()), 90)
  }

  // Wczytanie dokumentu (raz na bufor) + pierwszy render dopasowany do szerokości.
  useEffect(() => {
    let cancelled = false
    setStatus('loading')
    setStage('opening document…')
    setPages(0)
    if (innerRef.current) innerRef.current.innerHTML = ''
    ;(async () => {
      try {
        // Uint8Array(kopia): pdf.js odpina przekazany bufor — oryginał (content.buf) zostaje cały.
        const task = pdfjs.getDocument({ data: new Uint8Array(buf.slice(0)) })
        taskRef.current = task
        const doc = await task.promise
        if (cancelled) {
          task.destroy().catch(() => {})
          return
        }
        docRef.current = doc
        setStage(`document opened — ${doc.numPages} page(s)`)
        const first = await doc.getPage(1)
        baseRef.current = computeBase(first.getViewport({ scale: 1 }).width)
        await renderAll(effScale())
      } catch (e) {
        if (!cancelled) {
          console.error('[pdf] failed:', e)
          setStage('error: ' + (e instanceof Error ? e.message : String(e)))
          setStatus('error')
        }
      }
    })()
    return () => {
      cancelled = true
      renderTokenRef.current++
      if (debTimer.current) clearTimeout(debTimer.current)
      taskRef.current?.destroy().catch(() => {})
      taskRef.current = null
      docRef.current = null
    }
  }, [buf])

  // Zoom: przerenderuj w wyższej/niższej skali (ostro). Pomijamy pierwszy przebieg (render z wczytania).
  const firstZoom = useRef(true)
  useEffect(() => {
    if (firstZoom.current) {
      firstZoom.current = false
      return
    }
    if (docRef.current) scheduleRender()
  }, [zoom])

  // Auto-dopasowanie szerokości: gdy zmienia się rozmiar panelu, przelicz skalę i przerenderuj.
  useEffect(() => {
    const sc = scrollRef.current
    if (!sc) return
    let t: ReturnType<typeof setTimeout> | null = null
    const ro = new ResizeObserver(() => {
      if (t) clearTimeout(t)
      t = setTimeout(async () => {
        const doc = docRef.current
        if (!doc) return
        const first = await doc.getPage(1)
        const base = computeBase(first.getViewport({ scale: 1 }).width)
        if (Math.abs(base - baseRef.current) > 0.02) {
          baseRef.current = base
          renderAll(effScale())
        }
      }, 160)
    })
    ro.observe(sc)
    return () => {
      if (t) clearTimeout(t)
      ro.disconnect()
    }
  }, [scrollRef])

  return (
    <div className="viewer-pdf" ref={scrollRef}>
      <div className="viewer-pdf-inner" ref={innerRef} />
      {status === 'loading' && <div className="viewer-pdf-msg">PDF — {stage}</div>}
      {status === 'error' && <div className="viewer-pdf-msg viewer-pdf-msg--err">PDF — {stage}</div>}
      {status === 'ready' && pages === 0 && <div className="viewer-pdf-msg">Empty document.</div>}
    </div>
  )
}
