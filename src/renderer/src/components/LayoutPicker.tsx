import { useEffect, useRef, useState } from 'react'
import { useStore } from '../state/store'
import { LAYOUT_GROUPS, type LayoutPreset } from '../layouts/presets'

function Thumb({
  preset,
  active,
  highlighted,
  onPick
}: {
  preset: LayoutPreset
  active: boolean
  highlighted: boolean
  onPick: () => void
}): JSX.Element {
  return (
    <button
      className={
        'layout-thumb' +
        (active ? ' layout-thumb--active' : '') +
        (highlighted ? ' layout-thumb--hi' : '')
      }
      title={preset.id}
      onClick={onPick}
    >
      <div
        className="thumb-grid"
        style={{
          gridTemplateColumns: preset.cols,
          gridTemplateRows: preset.rows,
          gridTemplateAreas: preset.areas.map((r) => `"${r}"`).join(' ')
        }}
      >
        {preset.slots.map((s) => (
          <span key={s} className="thumb-cell" style={{ gridArea: s }} />
        ))}
      </div>
    </button>
  )
}

/**
 * Picker układów w stylu TradingView (wiersze grupowane wg liczby paneli).
 * Klawiatura (gdy otwarty): h/l (lub ←/→) w wierszu, j/k (lub ↓/↑) między wierszami,
 * Enter wybiera, Esc zamyka. Po otwarciu popover dostaje fokus.
 */
export default function LayoutPicker(): JSX.Element {
  const open = useStore((s) => s.layoutPickerOpen)
  const setOpen = useStore((s) => s.setLayoutPickerOpen)
  const setLayout = useStore((s) => s.setLayout)
  const currentLayout = useStore((s) => s.workspaces[s.current]?.layoutId)
  const wrapRef = useRef<HTMLDivElement>(null)
  const popRef = useRef<HTMLDivElement>(null)
  const [hi, setHi] = useState({ g: 0, i: 0 }) // podświetlona miniatura (wiersz/kolumna)

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent): void => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open, setOpen])

  // Po otwarciu: ustaw podświetlenie na bieżącym layoucie i przejmij fokus na popover.
  useEffect(() => {
    if (!open) return
    let g = 0
    let i = 0
    LAYOUT_GROUPS.forEach((grp, gi) => {
      const ix = grp.findIndex((p) => p.id === currentLayout)
      if (ix >= 0) {
        g = gi
        i = ix
      }
    })
    setHi({ g, i })
    popRef.current?.focus()
  }, [open, currentLayout])

  const onKeyDown = (e: React.KeyboardEvent): void => {
    const k = e.key
    if (k === 'Escape') {
      setOpen(false)
      return
    }
    if (k === 'Enter') {
      const p = LAYOUT_GROUPS[hi.g]?.[hi.i]
      if (p) {
        setLayout(p.id)
        setOpen(false)
      }
      e.preventDefault()
      return
    }
    let { g, i } = hi
    if (k === 'h' || k === 'ArrowLeft') i = Math.max(0, i - 1)
    else if (k === 'l' || k === 'ArrowRight') i = Math.min(LAYOUT_GROUPS[g].length - 1, i + 1)
    else if (k === 'k' || k === 'ArrowUp') g = Math.max(0, g - 1)
    else if (k === 'j' || k === 'ArrowDown') g = Math.min(LAYOUT_GROUPS.length - 1, g + 1)
    else return
    i = Math.min(i, LAYOUT_GROUPS[g].length - 1) // przytnij kolumnę do nowego wiersza
    setHi({ g, i })
    e.preventDefault()
  }

  return (
    <div className="layout-picker" ref={wrapRef}>
      <button
        className={'tool-btn' + (open ? ' tool-btn--on' : '')}
        data-tip="Pane layout"
        onClick={() => setOpen(!open)}
      >
        ▦ Layout
      </button>
      {open && (
        <div className="layout-popover" ref={popRef} tabIndex={-1} onKeyDown={onKeyDown}>
          {LAYOUT_GROUPS.map((group, gi) => (
            <div className="layout-row" key={gi}>
              <span className="layout-row-num">{gi + 1}</span>
              <div className="layout-row-thumbs">
                {group.map((p, ii) => (
                  <Thumb
                    key={p.id}
                    preset={p}
                    active={p.id === currentLayout}
                    highlighted={gi === hi.g && ii === hi.i}
                    onPick={() => {
                      setLayout(p.id)
                      setOpen(false)
                    }}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
