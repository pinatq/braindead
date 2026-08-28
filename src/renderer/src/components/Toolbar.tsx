import type { JSX } from 'react'
import { useStore } from '../state/store'
import WorkspaceSwitcher from './WorkspaceSwitcher'
import TermBrowserSwitch from './TermBrowserSwitch'
import LayoutPicker from './LayoutPicker'
import RamIndicator from './RamIndicator'
import { askConfirm } from '../lib/dialogs'

/** Top toolbar, separated from the pane area by a thin line. */
export default function Toolbar(): JSX.Element {
  const toggleNotes = useStore((s) => s.toggleNotes)
  const notesOpen = useStore((s) => s.notesOpen)
  const toggleSettings = useStore((s) => s.toggleSettings)
  const killPane = useStore((s) => s.killPane)
  const killWorkspace = useStore((s) => s.killWorkspace)
  const addNotesFile = useStore((s) => s.addNotesFile)

  // Operacje nieodwracalne (ubijają PTY + kasują historię/webview) → zawsze z potwierdzeniem.
  const onKillPane = async (): Promise<void> => {
    if (await askConfirm('Kill the active pane? Its terminal/browser history will be wiped.')) killPane()
  }
  const onKillWorkspace = async (): Promise<void> => {
    if (await askConfirm('Kill this entire workspace? All its panes will be wiped.')) killWorkspace()
  }

  // Upuszczenie pliku (z eksploratora) na przycisk Notes → dodaj jako załącznik notatki.
  const onNotesDrop = async (e: React.DragEvent): Promise<void> => {
    const vf = e.dataTransfer.getData('application/x-vibe-file')
    if (!vf) return
    e.preventDefault()
    try {
      const ref = JSON.parse(vf) as { name: string; path: string }
      const f = await window.api.files.read(ref.path)
      const nf = await window.api.files.saveAttachment(f.name, f.base64)
      addNotesFile(nf)
      if (!notesOpen) toggleNotes()
    } catch {
      /* zły payload / brak pliku */
    }
  }

  return (
    // data-tauri-drag-region="deep": puste obszary toolbara ciągną okno (ukryty pasek tytułu),
    // przyciski/inputy i tak blokują drag wg skryptu Tauri.
    <div className="toolbar" data-tauri-drag-region="deep">
      <div className="toolbar-left">
        <button
          // Znacznik dla NotesPanel: klik w ten przycisk to przełączenie, nie „klik obok"
          // (bez tego zamknięcie-po-kliknięciu i toggle znosiłyby się nawzajem).
          data-notes-toggle=""
          className={'tool-btn' + (notesOpen ? ' tool-btn--on' : '')}
          onClick={toggleNotes}
          onDragOver={(e) => e.preventDefault()}
          onDrop={onNotesDrop}
          data-tip="Open/close notes (drop a file here to attach)"
        >
          📝 Notes
        </button>
        <WorkspaceSwitcher />
      </div>

      <div className="toolbar-center">
        <TermBrowserSwitch />
      </div>

      <div className="toolbar-right">
        <RamIndicator />
        <LayoutPicker />
        <div className="kill-switch">
          <button className="kill-half" data-tip="Kill active pane" onClick={onKillPane}>
            🗑 Pane
          </button>
          <button className="kill-half" data-tip="Kill this workspace" onClick={onKillWorkspace}>
            🗑 WS
          </button>
        </div>
        <button className="icon-btn settings-btn" data-tip="Settings" onClick={toggleSettings}>
          ⚙
        </button>
      </div>
    </div>
  )
}
