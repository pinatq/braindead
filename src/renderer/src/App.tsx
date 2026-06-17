import { useEffect } from 'react'
import { shallow } from 'zustand/shallow'
import { useStore } from './state/store'
import { useShortcuts } from './shortcuts/useShortcuts'
import Toolbar from './components/Toolbar'
import PaneGrid from './components/PaneGrid'
import NotesPanel from './components/NotesPanel'
import SettingsModal from './components/SettingsModal'
import VimStatusline from './components/VimStatusline'
import FindBar from './components/FindBar'

export default function App(): JSX.Element {
  const initFromPersisted = useStore((s) => s.initFromPersisted)
  const setRamStats = useStore((s) => s.setRamStats)
  const forceDark = useStore((s) => s.forceDark)
  const current = useStore((s) => s.current)
  // Wszystkie zamontowane przestrzenie trzymamy w DOM (bieżąca widoczna, reszta ukryta),
  // by przeglądarki nie przeładowywały się po przełączeniu workspace.
  const mountedIds = useStore(
    (s) =>
      Object.values(s.workspaces)
        .filter((w) => w.mounted)
        .map((w) => w.id),
    shallow
  )

  // Wczytanie zapisanego stanu (notatki, układy, przestrzenie) przy starcie.
  useEffect(() => {
    window.api.store.load().then(initFromPersisted)
  }, [initFromPersisted])

  // Statystyki RAM pushowane z procesu głównego (do wskaźnika i mitygacji).
  useEffect(() => window.api.ram.onStats(setRamStats), [setRamStats])

  // Wymuszanie dark trybu na stronach (nativeTheme w mainie) — synchronizujemy po zmianie/wczytaniu.
  useEffect(() => {
    window.api.theme.setForceDark(forceDark)
  }, [forceDark])

  // Globalne skróty klawiszowe (panele, MRU, przestrzenie).
  useShortcuts()

  return (
    <div className="app">
      <Toolbar />
      <div className="workspace-area">
        {mountedIds.map((id) => (
          <PaneGrid key={id} workspaceId={id} visible={id === current} />
        ))}
      </div>
      <VimStatusline />
      <FindBar />
      <NotesPanel />
      <SettingsModal />
    </div>
  )
}
