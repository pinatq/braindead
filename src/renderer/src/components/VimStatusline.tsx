import { useStore } from '../state/store'

/**
 * Pasek statusu w stylu vima (na dole) — widoczny tylko przy włączonym vim mode.
 * Pokazuje tryb aktywnego panelu (NORMAL/INSERT/BROWSER/VIEWER), przestrzeń, tytuł panelu,
 * layout, znacznik AUTO oraz podpowiedź prefiksu Ctrl-w.
 */
export default function VimStatusline(): JSX.Element | null {
  const vimMode = useStore((s) => s.vimMode)
  const current = useStore((s) => s.current)
  const wsName = useStore((s) => s.workspaces[s.current]?.name)
  const layoutId = useStore((s) => s.workspaces[s.current]?.layoutId)
  const activeVimMode = useStore((s) => s.activeVimMode)
  const winPending = useStore((s) => s.winPending)
  const pane = useStore((s) => s.workspaces[s.current]?.panes.find((p) => p.id === s.activePaneId))
  const autoScrolling = useStore((s) =>
    s.activePaneId ? s.autoScrollIds.includes(s.activePaneId) : false
  )

  if (!vimMode) return null

  let modeLabel = '—'
  let modeCls = 'normal'
  if (pane?.mode === 'terminal') {
    modeLabel = activeVimMode === 'normal' ? 'NORMAL' : 'INSERT'
    modeCls = activeVimMode === 'normal' ? 'normal' : 'insert'
  } else if (pane?.mode === 'browser') {
    modeLabel = 'BROWSER'
    modeCls = 'browser'
  } else if (pane?.mode === 'viewer') {
    modeLabel = 'VIEWER'
    modeCls = 'viewer'
  }

  return (
    <div className="vim-statusline">
      <span className={'vim-mode vim-mode--' + modeCls}>{modeLabel}</span>
      <span className="vim-seg">
        WS {current}
        {wsName ? ': ' + wsName : ''}
      </span>
      {pane?.title && <span className="vim-seg">{pane.title}</span>}
      {layoutId && <span className="vim-seg vim-seg--dim">▦ {layoutId}</span>}
      {autoScrolling && <span className="vim-seg vim-seg--auto">● AUTO</span>}
      <span className="vim-spacer" />
      {winPending ? (
        <span className="vim-status-hint">^W → h j k l · w/W cycle · q kill · s/v/o split</span>
      ) : (
        <span className="vim-status-hint vim-status-hint--dim">
          : address · f hints · Ctrl-w windows
        </span>
      )}
    </div>
  )
}
