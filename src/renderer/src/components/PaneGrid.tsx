import { useEffect, useRef, useState } from 'react'
import { useStore } from '../state/store'
import { getPreset } from '../layouts/presets'
import TerminalPane from './TerminalPane'
import BrowserPane from './BrowserPane'
import ViewerPane from './ViewerPane'
import ExplorerPane from './ExplorerPane'
import AgentPane from './AgentPane'

interface Props {
  workspaceId: number
  visible: boolean
}

/**
 * Chip z tytułem panelu w lewym górnym rogu. Klik otwiera inline edycję
 * (Enter/blur zapis, Esc anuluje). Pusty tytuł = ledwo widoczny (✎ na hover).
 */
function PaneTitle({ paneId, title }: { paneId: string; title?: string }): JSX.Element {
  const setPaneTitle = useStore((s) => s.setPaneTitle)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(title ?? '')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (editing) {
      setDraft(title ?? '')
      inputRef.current?.focus()
      inputRef.current?.select()
    }
  }, [editing, title])

  const commit = (): void => {
    setPaneTitle(paneId, draft)
    setEditing(false)
  }

  if (editing) {
    return (
      <input
        ref={inputRef}
        className="pane-title pane-title--edit"
        value={draft}
        placeholder="title…"
        onMouseDown={(e) => e.stopPropagation()}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          e.stopPropagation()
          if (e.key === 'Enter') commit()
          else if (e.key === 'Escape') setEditing(false)
        }}
      />
    )
  }

  return (
    <button
      className={'pane-title' + (title ? '' : ' pane-title--empty')}
      title="Rename pane"
      onMouseDown={(e) => e.stopPropagation()}
      onClick={() => setEditing(true)}
    >
      {title || '✎'}
    </button>
  )
}

/**
 * Renderuje panele danej przestrzeni w siatce wg presetu. Wszystkie zamontowane
 * przestrzenie zostają w DOM — niewidoczne mają display:none (dzięki temu przeglądarki
 * nie przeładowują się po przełączeniu workspace). Aktywny panel dostaje niebieską ramkę.
 */
export default function PaneGrid({ workspaceId, visible }: Props): JSX.Element {
  const workspace = useStore((s) => s.workspaces[workspaceId])
  const activePaneId = useStore((s) => s.activePaneId)
  const autoScrollIds = useStore((s) => s.autoScrollIds)
  const autoApproveIds = useStore((s) => s.autoApproveIds)
  const setActivePane = useStore((s) => s.setActivePane)
  const zoomPaneId = useStore((s) => s.zoomPaneId)
  const toggleZoomPane = useStore((s) => s.toggleZoomPane)

  if (!workspace) return <div className="pane-grid" style={{ display: 'none' }} />

  const preset = getPreset(workspace.layoutId)

  return (
    <div
      className="pane-grid"
      style={{
        display: visible ? 'grid' : 'none',
        gridTemplateColumns: preset.cols,
        gridTemplateRows: preset.rows,
        gridTemplateAreas: preset.areas.map((r) => `"${r}"`).join(' ')
      }}
    >
      {workspace.panes.map((pane, i) => {
        const area = preset.slots[i]
        if (!area) return null
        const active = pane.id === activePaneId
        const autoScrolling = autoScrollIds.includes(pane.id)
        const autoApprove = autoApproveIds.includes(pane.id)
        const zoomed = pane.id === zoomPaneId
        return (
          <div
            key={pane.id}
            data-pane-id={pane.id}
            className={
              'pane' +
              (active ? ' pane--active' : '') +
              (autoScrolling ? ' pane--autoscroll' : '') +
              (autoApprove ? ' pane--autoapprove' : '') +
              (zoomed ? ' pane--zoom' : '')
            }
            // Zoom = rozciągnięcie na wszystkie tory siatki. (Nie position:absolute — element
            // gridu z grid-area ma za blok odniesienia własną komórkę, więc nic by to nie dało.)
            style={{ gridArea: zoomed ? '1 / 1 / -1 / -1' : area }}
            onMouseDown={() => setActivePane(pane.id)}
          >
            <PaneTitle paneId={pane.id} title={pane.title} />
            {/* Fullscreen panelu w granicach aplikacji (zoom jak w tmuxie) — nie rusza okna OS. */}
            <button
              className={'pane-zoom' + (zoomed ? ' pane-zoom--on' : '')}
              data-tip={zoomed ? 'Restore pane size' : 'Fullscreen pane (inside the app)'}
              // Bez tego klik zabiera fokus terminalowi (przycisk dostaje fokus DOM), a pisanie
              // przestaje działać do czasu przełączenia panelu.
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => toggleZoomPane(pane.id)}
            >
              {zoomed ? '⤡' : '⤢'}
            </button>
            {autoApprove && <span className="pane-autoapprove-badge">AUTO ↵</span>}
            {pane.mode === 'terminal' && <TerminalPane paneId={pane.id} />}
            {pane.mode === 'browser' && (
              <BrowserPane paneId={pane.id} url={pane.url ?? 'about:blank'} />
            )}
            {pane.mode === 'viewer' && (
              <ViewerPane paneId={pane.id} filePath={pane.filePath} remoteConn={pane.remoteConn} />
            )}
            {pane.mode === 'explorer' && <ExplorerPane paneId={pane.id} />}
            {pane.mode === 'claude' && <AgentPane paneId={pane.id} />}
          </div>
        )
      })}
    </div>
  )
}
