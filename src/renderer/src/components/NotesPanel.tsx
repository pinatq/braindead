import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useStore } from '../state/store'
import type { NoteFile } from '../../../shared/types'
import { newTextVimState, textVimKeydown, type TextVimState } from '../vim/textVim'
import { FIND_EVENT, type FindDetail } from '../shortcuts/find'
import { findInTextarea } from '../lib/domFind'

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result).split(',')[1] ?? '')
    r.readAsDataURL(file)
  })
}

function nameFor(file: File): string {
  if (file.name) return file.name
  const ext = file.type.split('/')[1] || 'bin'
  return `pasted-${Date.now().toString(36)}.${ext}`
}

// Pojedynczy załącznik: miniatura (obraz) lub ikona + nazwa, z pobieraniem i usuwaniem.
function Attachment({ file, onRemove }: { file: NoteFile; onRemove: () => void }): JSX.Element {
  const isImg = file.mime.startsWith('image/')
  const [thumb, setThumb] = useState<string | null>(null)
  const [tip, setTip] = useState<{ x: number; y: number } | null>(null)

  useEffect(() => {
    if (isImg) window.api.files.readDataUrl(file.path).then(setThumb).catch(() => setThumb(null))
  }, [file.path, isImg])

  return (
    <div
      className="notes-att"
      draggable
      onDragStart={(e) => {
        setTip(null)
        e.dataTransfer.setData('application/x-vibe-file', JSON.stringify({ name: file.name, path: file.path }))
        e.dataTransfer.effectAllowed = 'copy'
      }}
    >
      <div
        className="notes-att-main"
        onMouseEnter={(e) => {
          const r = e.currentTarget.getBoundingClientRect()
          setTip({ x: r.left, y: r.bottom + 6 })
        }}
        onMouseLeave={() => setTip(null)}
      >
        {isImg && thumb ? (
          <img className="notes-att-thumb" src={thumb} alt={file.name} draggable={false} />
        ) : (
          <div className="notes-att-icon">📄</div>
        )}
        <span className="notes-att-name">{file.name}</span>
      </div>
      {/* Pełna nazwa pliku — renderowana poza notatnikiem (nie ucina jej ramka). */}
      {tip &&
        createPortal(
          <div className="floating-name" style={{ left: tip.x, top: tip.y }}>
            {file.name}
          </div>,
          document.body
        )}
      <button
        className="notes-att-btn"
        data-tip="Save to disk…"
        onClick={() => window.api.files.saveAs(file.path, file.name)}
      >
        📥
      </button>
      <button className="notes-att-btn" data-tip="Remove" onClick={onRemove}>
        ✕
      </button>
    </div>
  )
}

/** Pływające okno notatek: tekst + załączniki dowolnego typu (wklej/przeciągnij). */
export default function NotesPanel(): JSX.Element | null {
  const open = useStore((s) => s.notesOpen)
  const notes = useStore((s) => s.notes)
  const notesFiles = useStore((s) => s.notesFiles)
  const setNotes = useStore((s) => s.setNotes)
  const clearNotes = useStore((s) => s.clearNotes)
  const toggleNotes = useStore((s) => s.toggleNotes)
  const addNotesFile = useStore((s) => s.addNotesFile)
  const removeNotesFile = useStore((s) => s.removeNotesFile)
  const vimMode = useStore((s) => s.vimMode)

  const panelRef = useRef<HTMLDivElement>(null)
  const areaRef = useRef<HTMLTextAreaElement>(null)
  const vimRef = useRef<TextVimState>(newTextVimState())
  const caretRef = useRef<[number, number] | null>(null) // kursor do przywrócenia po edycji
  const [caretTick, setCaretTick] = useState(0)
  const [vimDisp, setVimDisp] = useState<'normal' | 'insert'>('insert')
  const [size, setSize] = useState<{ w: number; h: number } | null>(null)
  const [attsHeight, setAttsHeight] = useState(120)

  // Po otwarciu od razu fokus na polu tekstu — start w INSERT, żeby pisać bez klikania (Esc→NORMAL).
  useEffect(() => {
    if (!open) return
    areaRef.current?.focus()
    vimRef.current = newTextVimState()
    vimRef.current.mode = 'insert'
    setVimDisp('insert')
  }, [open])

  // Wyszukiwanie (Ctrl/⌘+F) w notatkach — zaznacza trafienie w textarea i przewija do niego.
  useEffect(() => {
    const onFind = (e: Event): void => {
      const d = (e as CustomEvent<FindDetail>).detail
      if (!d.inNotes) return
      const ta = areaRef.current
      if (!ta || d.type === 'close') return
      const backwards = d.type === 'prev'
      const from =
        d.type === 'query' ? ta.selectionStart : backwards ? ta.selectionStart : ta.selectionEnd
      findInTextarea(ta, d.query, from, backwards)
    }
    window.addEventListener(FIND_EVENT, onFind)
    return () => window.removeEventListener(FIND_EVENT, onFind)
  }, [])

  // Przywrócenie pozycji kursora po zmianie wartości/ruchu w vimie (textarea jest kontrolowany).
  useLayoutEffect(() => {
    const c = caretRef.current
    const ta = areaRef.current
    if (c && ta) {
      ta.selectionStart = c[0]
      ta.selectionEnd = c[1]
      caretRef.current = null
    }
  }, [caretTick, notes])

  // Klawiatura w polu tekstu: gdy vim ON — sterowanie przez textVim; inaczej Esc zamyka.
  const onAreaKey = (e: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    if (!vimMode) {
      if (e.key === 'Escape') {
        e.stopPropagation()
        toggleNotes()
      }
      return
    }
    const ta = e.currentTarget
    const res = textVimKeydown(e.nativeEvent, ta.value, ta.selectionStart, ta.selectionEnd, vimRef.current)
    setVimDisp(vimRef.current.mode)
    if (!res) return // INSERT — pisanie idzie normalnie
    e.preventDefault()
    e.stopPropagation()
    if (res.close) {
      toggleNotes()
      return
    }
    if (res.value !== notes) setNotes(res.value)
    caretRef.current = [res.selStart, res.selEnd]
    setCaretTick((t) => t + 1)
  }

  if (!open) return null

  // Ręczna zmiana rozmiaru okienka (uchwyt w rogu) — panel zostaje "nieprzycinający".
  const startResize = (e: React.MouseEvent): void => {
    e.preventDefault()
    const el = panelRef.current
    if (!el) return
    const startW = el.offsetWidth
    const startH = el.offsetHeight
    const sx = e.clientX
    const sy = e.clientY
    const onMove = (ev: MouseEvent): void => {
      setSize({
        w: Math.max(260, Math.min(window.innerWidth * 0.92, startW + (ev.clientX - sx))),
        h: Math.max(240, Math.min(window.innerHeight * 0.88, startH + (ev.clientY - sy)))
      })
    }
    const onUp = (): void => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  // Przeciąganie przedzielki: w górę → więcej miejsca na pliki, w dół → mniej (więcej na tekst).
  const startSplit = (e: React.MouseEvent): void => {
    e.preventDefault()
    const startY = e.clientY
    const startH = attsHeight
    const panelH = panelRef.current?.offsetHeight ?? 420
    const onMove = (ev: MouseEvent): void => {
      const max = Math.max(60, panelH - 200) // zostaw miejsce na tekst + nagłówek + akcje
      setAttsHeight(Math.max(44, Math.min(max, startH + (startY - ev.clientY))))
    }
    const onUp = (): void => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  const addFile = async (file: File): Promise<void> => {
    const b64 = await fileToBase64(file)
    const nf = await window.api.files.saveAttachment(nameFor(file), b64)
    addNotesFile(nf)
  }

  const onClear = (): void => {
    if (confirm('Clear all notes (incl. attachments)?')) clearNotes()
  }
  const onDump = async (): Promise<void> => {
    await window.api.dialog.saveNotes(notes)
  }

  const onPaste = (e: React.ClipboardEvent): void => {
    const items = e.clipboardData?.items
    if (!items) return
    for (let i = 0; i < items.length; i++) {
      const it = items[i]
      if (it.kind === 'file') {
        const f = it.getAsFile()
        if (f) {
          e.preventDefault()
          addFile(f)
        }
      }
    }
  }

  const onDrop = (e: React.DragEvent): void => {
    const files = e.dataTransfer.files
    if (files && files.length) {
      e.preventDefault()
      for (let i = 0; i < files.length; i++) addFile(files[i])
    }
  }

  return (
    <div
      className="notes-panel"
      ref={panelRef}
      style={size ? { width: size.w, height: size.h } : undefined}
      onPaste={onPaste}
      onDragOver={(e) => e.preventDefault()}
      onDrop={onDrop}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation()
          toggleNotes() // Esc zamyka notatki (w Fazie 2 vim: insert→normal, normal→zamknij)
        }
      }}
    >
      <div className="notes-head">
        <span>Notes</span>
        {vimMode && (
          <span className={'vim-mode vim-mode--' + (vimDisp === 'normal' ? 'normal' : 'insert')}>
            {vimDisp === 'normal' ? 'NORMAL' : 'INSERT'}
          </span>
        )}
        <button className="icon-btn" data-tip="Close notes" onClick={toggleNotes}>
          ✕
        </button>
      </div>
      <textarea
        ref={areaRef}
        className="notes-area"
        value={notes}
        spellCheck={false}
        placeholder="Type here… (⌘V to paste a file/screenshot, or drag files in)"
        onChange={(e) => setNotes(e.target.value)}
        onKeyDown={onAreaKey}
      />

      {notesFiles.length > 0 && (
        <>
          <div className="notes-split" onMouseDown={startSplit} title="Drag to resize" />
          <div className="notes-atts" style={{ height: attsHeight }}>
            {notesFiles.map((f, i) => (
              <Attachment key={f.path} file={f} onRemove={() => removeNotesFile(i)} />
            ))}
          </div>
        </>
      )}

      <div className="notes-actions">
        <button className="notes-btn" onClick={onClear}>
          Clear notes
        </button>
        <button className="notes-btn notes-btn--primary" onClick={onDump}>
          Download dump
        </button>
      </div>

      <div className="notes-resize" onMouseDown={startResize} title="Resize" />
    </div>
  )
}
