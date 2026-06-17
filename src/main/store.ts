import { app } from 'electron'
import { promises as fs } from 'fs'
import path from 'path'
import type { PersistedState } from '../shared/types'

const DEFAULT_STATE: PersistedState = {
  notes: '',
  notesFiles: [],
  current: 1,
  maxWorkspace: 1,
  workspaces: {
    1: { id: 1, layoutId: '1', panes: [{ id: 'p1', mode: 'terminal', dirty: false }], kept: false }
  },
  ecoMode: false,
  maxLiveBrowsers: 3,
  binds: {}, // renderer dokłada domyślne bindy (DEFAULT_BINDS) przy starcie
  vimBinds: {}, // renderer dokłada domyślne klawisze vima (DEFAULT_VIM_BINDS)
  vimMode: false,
  vimTermExit: 'esc',
  ram: {
    maxMb: 4096,
    enforce: false,
    sleepInactive: true,
    sleepAfterMin: 5,
    minFreeMb: 1024,
    minFreeEnforce: false
  },
  forceDark: false,
  autoScrollEnabled: false,
  autoScrollMin: 15,
  autoScrollMax: 30,
  sshConns: [],
  autoApproveEnabled: false,
  autoApproveMin: 5,
  autoApproveMax: 8,
  claudeEnabled: false,
  claudeProfiles: []
}

function statePath(): string {
  return path.join(app.getPath('userData'), 'state.json')
}

export async function loadState(): Promise<PersistedState> {
  try {
    const raw = await fs.readFile(statePath(), 'utf8')
    const parsed = JSON.parse(raw) as Partial<PersistedState>
    return { ...DEFAULT_STATE, ...parsed }
  } catch {
    return DEFAULT_STATE
  }
}

export async function saveState(state: PersistedState): Promise<void> {
  try {
    await fs.writeFile(statePath(), JSON.stringify(state, null, 2), 'utf8')
  } catch (err) {
    console.error('Nie udało się zapisać stanu:', err)
  }
}
