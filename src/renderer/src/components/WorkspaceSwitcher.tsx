import { useEffect, useRef, useState } from 'react'
import { useStore } from '../state/store'

/**
 * Przełącznik przestrzeni roboczych: ◀ N ▶ + nazwa.
 * Klik w numer (lub bind workspace.goto) → pole wpisania celu; Enter przenosi.
 * Po prawej od ▶ edytowalna nazwa przestrzeni (klik → input, Enter/blur zapis).
 */
export default function WorkspaceSwitcher(): JSX.Element {
  const current = useStore((s) => s.current)
  const next = useStore((s) => s.nextWorkspace)
  const prev = useStore((s) => s.prevWorkspace)
  const goto = useStore((s) => s.gotoWorkspace)
  const gotoOpen = useStore((s) => s.gotoOpen)
  const setGotoOpen = useStore((s) => s.setGotoOpen)
  const name = useStore((s) => s.workspaces[s.current]?.name)
  const setWorkspaceName = useStore((s) => s.setWorkspaceName)

  const [gotoVal, setGotoVal] = useState('')
  const gotoRef = useRef<HTMLInputElement>(null)

  const [editingName, setEditingName] = useState(false)
  const [nameDraft, setNameDraft] = useState(name ?? '')
  const nameRef = useRef<HTMLInputElement>(null)

  // Otwarcie pola skoku (z klika lub binda) ustawia fokus i czyści wartość.
  useEffect(() => {
    if (gotoOpen) {
      setGotoVal('')
      gotoRef.current?.focus()
    }
  }, [gotoOpen])

  useEffect(() => {
    if (editingName) {
      setNameDraft(name ?? '')
      nameRef.current?.focus()
      nameRef.current?.select()
    }
  }, [editingName, name])

  const commitGoto = (): void => {
    const n = parseInt(gotoVal, 10)
    if (Number.isFinite(n) && n >= 1) goto(n)
    setGotoOpen(false)
  }

  const commitName = (): void => {
    setWorkspaceName(current, nameDraft)
    setEditingName(false)
  }

  return (
    <div className="ws-switcher">
      <button
        className="icon-btn"
        onClick={prev}
        disabled={current <= 1}
        data-tip="Previous workspace"
      >
        ◀
      </button>

      {gotoOpen ? (
        <input
          ref={gotoRef}
          className="ws-goto"
          type="number"
          min={1}
          value={gotoVal}
          placeholder={String(current)}
          onChange={(e) => setGotoVal(e.target.value)}
          onBlur={commitGoto}
          onKeyDown={(e) => {
            e.stopPropagation()
            if (e.key === 'Enter') commitGoto()
            else if (e.key === 'Escape') setGotoOpen(false)
          }}
        />
      ) : (
        <button
          className="ws-number"
          onClick={() => setGotoOpen(true)}
          data-tip="Click to jump to workspace"
        >
          {current}
        </button>
      )}

      <button className="icon-btn" onClick={next} data-tip="Next / new workspace">
        ▶
      </button>

      {editingName ? (
        <input
          ref={nameRef}
          className="ws-name ws-name--edit"
          value={nameDraft}
          placeholder="name…"
          onChange={(e) => setNameDraft(e.target.value)}
          onBlur={commitName}
          onKeyDown={(e) => {
            e.stopPropagation()
            if (e.key === 'Enter') commitName()
            else if (e.key === 'Escape') setEditingName(false)
          }}
        />
      ) : (
        <button
          className={'ws-name' + (name ? '' : ' ws-name--empty')}
          onClick={() => setEditingName(true)}
          data-tip="Rename workspace"
        >
          {name || 'name…'}
        </button>
      )}
    </div>
  )
}
