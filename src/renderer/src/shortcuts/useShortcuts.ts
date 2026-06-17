import { useEffect, useRef } from 'react'
import { useStore } from '../state/store'
import { actionForCombo, comboFromEvent, isCapturing, modsOf, type Mods } from './binds'
import { currentIndex, focusMruPrevious, focusPaneIndex, runBind } from './dispatch'

// Stan jednej "sesji" MRU (przełączania paneli przyciskiem typu Ctrl+Tab).
interface MruSession {
  active: boolean
  presses: number // ile razy wciśnięto klawisz (bez puszczenia modyfikatora)
  anchorIdx: number // indeks panelu, od którego startujemy cykl
  mods: Mods
}

// Czy wszystkie wymagane modyfikatory są nadal wciśnięte (po zdarzeniu keyup).
function modsStillHeld(m: Mods, e: KeyboardEvent): boolean {
  if (m.meta && !e.metaKey) return false
  if (m.ctrl && !e.ctrlKey) return false
  if (m.alt && !e.altKey) return false
  if (m.shift && !e.shiftKey) return false
  return true
}

/** Globalna obsługa skrótów klawiszowych (panele, MRU, przestrzenie, karty, panele UI). */
export function useShortcuts(): void {
  const mru = useRef<MruSession>({ active: false, presses: 0, anchorIdx: 0, mods: {} as Mods })

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      if (isCapturing()) return // ustawienia przechwytują skrót — nie wykonujemy akcji
      const combo = comboFromEvent(e)
      if (!combo) return
      const actionId = actionForCombo(useStore.getState().binds, combo)
      if (!actionId) return
      e.preventDefault()
      e.stopPropagation()

      // MRU: pełna logika tap (ostatnio używany) vs hold (cykl po indeksach).
      if (actionId === 'pane.mru') {
        const m = mru.current
        m.presses += 1
        if (!m.active) {
          m.active = true
          m.anchorIdx = currentIndex()
          m.mods = modsOf(combo)
        } else {
          const ws = useStore.getState().workspaces[useStore.getState().current]
          const n = ws?.panes.length ?? 0
          if (n > 0) focusPaneIndex((m.anchorIdx + (m.presses - 1)) % n)
        }
        return
      }

      runBind(actionId)
    }

    const onKeyUp = (e: KeyboardEvent): void => {
      const m = mru.current
      if (!m.active) return
      if (modsStillHeld(m.mods, e)) return // modyfikator nadal trzymany — sesja trwa
      if (m.presses === 1) focusMruPrevious() // szybki tap → ostatnio używany panel
      m.active = false
      m.presses = 0
    }

    const onBlur = (): void => {
      mru.current.active = false
      mru.current.presses = 0
    }

    window.addEventListener('keydown', onKeyDown, true)
    window.addEventListener('keyup', onKeyUp, true)
    window.addEventListener('blur', onBlur)
    return () => {
      window.removeEventListener('keydown', onKeyDown, true)
      window.removeEventListener('keyup', onKeyUp, true)
      window.removeEventListener('blur', onBlur)
    }
  }, [])
}
