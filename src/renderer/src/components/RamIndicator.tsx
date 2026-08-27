import { useEffect, useRef } from 'react'
import type { JSX } from 'react'
import { useStore, isRamOver } from '../state/store'
import RamControls from './RamControls'

// Dokładny podpis zużycia: pod 1 GB w megabajtach („453M"), powyżej w GB z dwoma miejscami.
export function formatMb(mb: number): string {
  return mb >= 1024 ? `${(mb / 1024).toFixed(2)}G` : `${Math.round(mb)}M`
}

/**
 * Wskaźnik RAM na pasku (między switchem trybu a Layout). Po przekroczeniu progu
 * pokazuje czerwoną kropkę + „buy more ram", a klik otwiera okienko z ustawieniami RAM.
 */
export default function RamIndicator(): JSX.Element {
  const ram = useStore((s) => s.ram)
  const stats = useStore((s) => s.ramStats)
  const open = useStore((s) => s.ramPanelOpen)
  const setOpen = useStore((s) => s.setRamPanelOpen)
  const wrapRef = useRef<HTMLDivElement>(null)

  const over = isRamOver(ram, stats)

  // Zamknięcie po kliknięciu poza okienkiem (np. gdy otwierasz Layout) lub Esc.
  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent): void => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [open, setOpen])

  return (
    <div className="ram-indicator" ref={wrapRef}>
      {over ? (
        <button className="ram-buy" data-tip="Memory limit reached" onClick={() => setOpen(!open)}>
          <span className="ram-dot" />
          buy more ram
        </button>
      ) : (
        <button className="ram-mini" data-tip="Memory usage" onClick={() => setOpen(!open)}>
          {stats ? formatMb(stats.appMb) : '—'}
        </button>
      )}

      {open && (
        <div className="ram-panel">
          <div className="ram-panel-head">
            <span>Memory</span>
            <button className="icon-btn" data-tip="Close" onClick={() => setOpen(false)}>
              ✕
            </button>
          </div>
          <div className="ram-panel-body">
            <RamControls />
          </div>
        </div>
      )}
    </div>
  )
}
