import { useEffect, useRef, useState } from 'react'
import { useStore } from '../state/store'
import { dispatchFind, FIND_FOCUS_EVENT, type FindType } from '../shortcuts/find'

/**
 * Globalny pasek wyszukiwania (Ctrl/⌘+F → bind `ui.find`). Pojawia się nad aktywnym panelem
 * i rozsyła zdarzenia find do panelu, który ma fokus (lub do notatek, gdy otwarte). Sam panel
 * wie, jak szukać w swojej treści — patrz [[find.ts]]. Enter = następne, Shift+Enter = poprzednie,
 * Esc = zamknij. Kluczowe: zatrzymujemy propagację, żeby globalne skróty/vim nie łapały pisania.
 */
export default function FindBar(): JSX.Element | null {
  const open = useStore((s) => s.findOpen)
  const setOpen = useStore((s) => s.setFindOpen)
  const inputRef = useRef<HTMLInputElement>(null)
  const [query, setQuery] = useState('')

  // Cel wyszukiwania liczymy w chwili akcji: notatki mają priorytet, inaczej aktywny panel.
  const targetDetail = (type: FindType, q: string): void => {
    const s = useStore.getState()
    dispatchFind({ type, query: q, paneId: s.activePaneId, inNotes: s.notesOpen })
  }

  // Po otwarciu (lub ponownym ⌘F) przejmij fokus i zaznacz dotychczasowy tekst.
  useEffect(() => {
    const focus = (): void => {
      const el = inputRef.current
      if (el) {
        el.focus()
        el.select()
      }
    }
    if (open) focus()
    window.addEventListener(FIND_FOCUS_EVENT, focus)
    return () => window.removeEventListener(FIND_FOCUS_EVENT, focus)
  }, [open])

  const close = (): void => {
    targetDetail('close', '')
    setOpen(false)
  }

  if (!open) return null

  return (
    <div className="find-bar" onMouseDown={(e) => e.stopPropagation()}>
      <span className="find-ico">🔍</span>
      <input
        ref={inputRef}
        className="find-input"
        value={query}
        spellCheck={false}
        placeholder="Find in pane…"
        onChange={(e) => {
          const q = e.target.value
          setQuery(q)
          targetDetail('query', q)
        }}
        onKeyDown={(e) => {
          // Nie pozwalamy, by globalne skróty / handlery paneli przejęły klawisze paska.
          e.stopPropagation()
          if (e.key === 'Enter') {
            e.preventDefault()
            targetDetail(e.shiftKey ? 'prev' : 'next', query)
          } else if (e.key === 'Escape') {
            e.preventDefault()
            close()
          }
        }}
      />
      <button className="find-btn" data-tip="Previous (⇧↵)" onMouseDown={(e) => e.preventDefault()} onClick={() => targetDetail('prev', query)}>
        ↑
      </button>
      <button className="find-btn" data-tip="Next (↵)" onMouseDown={(e) => e.preventDefault()} onClick={() => targetDetail('next', query)}>
        ↓
      </button>
      <button className="find-btn find-close" data-tip="Close (Esc)" onClick={close}>
        ✕
      </button>
    </div>
  )
}
