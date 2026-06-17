import { useStore } from '../state/store'

/**
 * Przełącznik trybu AKTYWNEGO panelu: terminal (>_) / przeglądarka (🌐) / viewer (📄).
 * Cykl trybów jest pod skrótem `mode.cycle` (Ustawienia → Shortcuts). Terminal z historią
 * chowa się, ale działa dalej w tle; dziewiczy jest ubijany.
 */
export default function TermBrowserSwitch(): JSX.Element {
  const setMode = useStore((s) => s.setActivePaneMode)
  const activePaneId = useStore((s) => s.activePaneId)
  const claudeEnabled = useStore((s) => s.claudeEnabled)
  const mode = useStore((s) => {
    const w = s.workspaces[s.current]
    return w?.panes.find((p) => p.id === s.activePaneId)?.mode
  })

  return (
    <div className="tb-switch">
      <button
        className={'tb-half' + (mode === 'terminal' ? ' tb-half--on' : '')}
        disabled={!activePaneId}
        onClick={() => setMode('terminal')}
        data-tip="Terminal (CLI) — command line in the active pane"
      >
        {'>_'}
      </button>
      <button
        className={'tb-half' + (mode === 'browser' ? ' tb-half--on' : '')}
        disabled={!activePaneId}
        onClick={() => setMode('browser')}
        data-tip="Browser — web pages in the active pane"
      >
        🌐
      </button>
      <button
        className={'tb-half' + (mode === 'viewer' ? ' tb-half--on' : '')}
        disabled={!activePaneId}
        onClick={() => setMode('viewer')}
        data-tip="File viewer — image / PDF / text / docx in the active pane"
      >
        📄
      </button>
      <button
        className={'tb-half' + (mode === 'explorer' ? ' tb-half--on' : '')}
        disabled={!activePaneId}
        onClick={() => setMode('explorer')}
        data-tip="File explorer — browse folders, open files into the viewer"
      >
        📁
      </button>
      {claudeEnabled && (
        <button
          className={'tb-half' + (mode === 'claude' ? ' tb-half--on' : '')}
          disabled={!activePaneId}
          onClick={() => setMode('claude')}
          data-tip="AI agent — Claude / Gemini / Codex / Aider / … in this pane (multi-account, isolated)"
        >
          🤖
        </button>
      )}
    </div>
  )
}
