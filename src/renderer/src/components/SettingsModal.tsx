import { useEffect, useMemo, useState } from 'react'
import { useStore } from '../state/store'
import {
  BIND_ACTIONS,
  comboFromEvent,
  formatCombo,
  isModifierKey,
  setCapturing
} from '../shortcuts/binds'
import { VIM_ACTIONS, captureVimKey, formatVimKey } from '../../../shared/vimKeys'
import type { ClaudeCliStatus } from '../../../shared/types'
import { AGENT_TOOLS, agentTool, type AgentToolId } from '../../../shared/agents'
import RamControls from './RamControls'

type Tab = 'shortcuts' | 'vim' | 'browser' | 'autopilot' | 'agents' | 'ssh' | 'ram'

// Jeden wiersz skrótu: etykieta akcji + przycisk z bieżącym skrótem (klik = nasłuch klawiszy).
function BindRow({
  label,
  combo,
  onSet
}: {
  label: string
  combo: string
  onSet: (c: string) => void
}): JSX.Element {
  const [cap, setCap] = useState(false)

  useEffect(() => {
    if (!cap) return
    setCapturing(true) // globalny handler skrótów ma odpuścić na czas nasłuchu
    const onKey = (e: KeyboardEvent): void => {
      e.preventDefault()
      e.stopPropagation()
      if (e.key === 'Escape') {
        setCap(false)
        return
      }
      if (e.key === 'Backspace' || e.key === 'Delete') {
        onSet('')
        setCap(false)
        return
      }
      if (isModifierKey(e.key)) return // czekamy na właściwy klawisz
      onSet(comboFromEvent(e))
      setCap(false)
    }
    // capture=true, żeby ubiec globalny handler skrótów i sam terminal.
    window.addEventListener('keydown', onKey, true)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      setCapturing(false)
    }
  }, [cap, onSet])

  return (
    <div className="bind-row">
      <span className="bind-label">{label}</span>
      <div className="bind-keys">
        <button
          className={'bind-key' + (cap ? ' bind-key--cap' : '')}
          onClick={() => setCap((c) => !c)}
        >
          {cap ? 'Press keys…' : formatCombo(combo)}
        </button>
        {combo && !cap && (
          <button className="bind-clear" data-tip="Clear" onClick={() => onSet('')}>
            ✕
          </button>
        )}
      </div>
    </div>
  )
}

// Jeden wiersz klawisza vima: etykieta + przycisk z bieżącym klawiszem (klik = nasłuch).
function VimKeyRow({
  label,
  value,
  onSet
}: {
  label: string
  value: string
  onSet: (k: string) => void
}): JSX.Element {
  const [cap, setCap] = useState(false)

  useEffect(() => {
    if (!cap) return
    setCapturing(true) // globalny handler vima/skrótów ma odpuścić na czas nasłuchu
    const onKey = (e: KeyboardEvent): void => {
      e.preventDefault()
      e.stopPropagation()
      if (e.key === 'Escape') {
        setCap(false)
        return
      }
      if (e.key === 'Backspace' || e.key === 'Delete') {
        onSet('')
        setCap(false)
        return
      }
      const tok = captureVimKey(e)
      if (tok === null) return // sam modyfikator — czekamy na właściwy klawisz
      onSet(tok)
      setCap(false)
    }
    window.addEventListener('keydown', onKey, true)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      setCapturing(false)
    }
  }, [cap, onSet])

  return (
    <div className="bind-row">
      <span className="bind-label">{label}</span>
      <div className="bind-keys">
        <button
          className={'bind-key' + (cap ? ' bind-key--cap' : '')}
          onClick={() => setCap((c) => !c)}
        >
          {cap ? 'Press a key…' : formatVimKey(value)}
        </button>
        {value && !cap && (
          <button className="bind-clear" data-tip="Clear" onClick={() => onSet('')}>
            ✕
          </button>
        )}
      </div>
    </div>
  )
}

// Rozwijana grupa skrótów (nagłówek ze strzałką).
function BindGroup({
  title,
  children,
  defaultOpen = true
}: {
  title: string
  children: React.ReactNode
  defaultOpen?: boolean
}): JSX.Element {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="bind-group">
      <button className="bind-group-head" onClick={() => setOpen((o) => !o)}>
        <span className={'bind-chev' + (open ? ' bind-chev--open' : '')}>▸</span>
        {title}
      </button>
      {open && <div className="bind-group-body">{children}</div>}
    </div>
  )
}

// Zakładka SSH — zapisane połączenia (komenda + opcjonalne hasło). Z eksploratora: przycisk SSH.
function SshSettings(): JSX.Element {
  const conns = useStore((s) => s.sshConns)
  const add = useStore((s) => s.addSshConn)
  const update = useStore((s) => s.updateSshConn)
  const remove = useStore((s) => s.removeSshConn)
  return (
    <div className="ssh-settings">
      <p className="setting-sub">
        Saved SSH connections — the explorer&apos;s <strong>SSH</strong> button connects to one. Just
        type the command you normally use: <code>ssh vps</code>, <code>ssh user@host -p 2222</code>, …
        Auth uses your key from <code>~/.ssh/config</code> or the SSH agent. Stored locally in app data.
      </p>
      {conns.map((c) => (
        <div className="ssh-row" key={c.id}>
          <input
            className="ssh-input ssh-name"
            value={c.name}
            placeholder="name"
            onChange={(e) => update(c.id, { name: e.target.value })}
          />
          <input
            className="ssh-input ssh-cmd"
            value={c.command}
            placeholder="ssh vps"
            spellCheck={false}
            onChange={(e) => update(c.id, { command: e.target.value })}
          />
          <button className="icon-btn" data-tip="Remove" onClick={() => remove(c.id)}>
            🗑
          </button>
        </div>
      ))}
      <button
        className="notes-btn"
        onClick={() => add({ id: 'c' + Date.now().toString(36), name: 'new connection', command: '' })}
      >
        + Add connection
      </button>
    </div>
  )
}

// Zakładka „Agents" — checkbox włączający 5. tryb + lista kont (góra: nazwa→CLI→auth→folder) oraz
// sekcja instalacji/statusu wszystkich CLI (dół). Każde konto ma własny, izolowany folder configu.
function AgentSettings(): JSX.Element {
  const enabled = useStore((s) => s.claudeEnabled)
  const setEnabled = useStore((s) => s.setClaudeEnabled)
  const profiles = useStore((s) => s.claudeProfiles)
  const add = useStore((s) => s.addClaudeProfile)
  const update = useStore((s) => s.updateClaudeProfile)
  const remove = useStore((s) => s.removeClaudeProfile)
  const openSettingsTab = useStore((s) => s.openSettingsTab)
  const [cliMap, setCliMap] = useState<Record<string, ClaudeCliStatus>>({})
  const [installing, setInstalling] = useState<string | null>(null)
  const [installLog, setInstallLog] = useState('')

  // Wykryj wszystkie CLI raz przy otwarciu zakładki.
  useEffect(() => {
    let live = true
    Promise.all(
      AGENT_TOOLS.map((t) =>
        window.api.agents
          .status(t.cmd)
          .then((s) => [t.id, s] as const)
          .catch(() => [t.id, { installed: false }] as const)
      )
    ).then((pairs) => {
      if (live) setCliMap(Object.fromEntries(pairs))
    })
    return () => {
      live = false
    }
  }, [])

  const install = async (toolId: string): Promise<void> => {
    const tool = agentTool(toolId)
    if (!tool) return
    if (!tool.install) {
      setInstallLog(`No automatic installer for ${tool.name} — install it manually, then reopen this tab.`)
      return
    }
    if (!confirm(`Install ${tool.name} now? This downloads & runs the official installer.`)) return
    setInstalling(toolId)
    setInstallLog(`Installing ${tool.name}… this can take a minute.`)
    try {
      const r = await window.api.agents.install(toolId)
      setInstallLog(r.output || (r.ok ? 'Installed.' : 'Install finished.'))
      const st = await window.api.agents.status(tool.cmd)
      setCliMap((m) => ({ ...m, [toolId]: st }))
    } catch (e) {
      setInstallLog('Install failed: ' + (e instanceof Error ? e.message : String(e)))
    } finally {
      setInstalling(null)
    }
  }

  return (
    <div className="ssh-settings">
      <label className="setting-row setting-row--toggle">
        <span>
          <b>Show Agents in the pane switcher</b>
          <span className="setting-sub">
            Adds the 🤖 mode icon next to terminal/browser/viewer/explorer. The shortcut{' '}
            <i>Active pane → Claude Code</i> (Shortcuts → Pane mode) works even with this off.
          </span>
        </span>
        <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
      </label>

      <p className="setting-sub">
        Accounts — pick one when you open an agent pane. Each account is isolated in its own config
        folder in app data, so several accounts/tools run side by side without clashing. Stored
        locally; nothing leaves your machine.
      </p>

      {profiles.map((c) => {
        const tool = agentTool(c.tool)
        return (
          <div className="ssh-row" key={c.id}>
            <input
              className="ssh-input ssh-name"
              value={c.name}
              placeholder="name"
              onChange={(e) => update(c.id, { name: e.target.value })}
            />
            <select
              className="setting-select"
              value={c.tool}
              onChange={(e) => update(c.id, { tool: e.target.value as AgentToolId })}
            >
              {AGENT_TOOLS.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
            <select
              className="setting-select"
              value={c.auth}
              onChange={(e) => update(c.id, { auth: e.target.value as 'login' | 'api' })}
            >
              <option value="login">login</option>
              <option value="api">API key</option>
            </select>
            {c.auth === 'api' && (
              <input
                className="ssh-input ssh-cmd"
                type="password"
                value={c.apiKey ?? ''}
                placeholder={tool?.apiKeyEnv ?? 'API key'}
                spellCheck={false}
                onChange={(e) => update(c.id, { apiKey: e.target.value })}
              />
            )}
            {/* Stały folder konta: ustawiony → nazwa + „×" (czyści → znów pyta); brak → „Set folder". */}
            {c.dir ? (
              <span className="claude-dir" title={c.dir}>
                📁 {c.dir.replace(/[\\/]+$/, '').split(/[\\/]/).pop()}
                <button
                  className="claude-dir-x"
                  data-tip="Clear — ask for a folder each time"
                  onClick={() => update(c.id, { dir: undefined })}
                >
                  ×
                </button>
              </span>
            ) : (
              <button
                className="icon-btn claude-dir-set"
                data-tip="Set a fixed LOCAL project folder for this account"
                onClick={async () => {
                  const d = await window.api.files.chooseDir()
                  if (d) update(c.id, { dir: d })
                }}
              >
                📁 local
              </button>
            )}
            <input
              className="ssh-input claude-sshdir"
              value={c.sshDir ?? ''}
              placeholder="🌐 ssh path (~/proj)"
              spellCheck={false}
              data-tip="Fixed remote folder when this account runs over SSH"
              onChange={(e) => update(c.id, { sshDir: e.target.value })}
            />
            <button className="icon-btn" data-tip="Remove" onClick={() => remove(c.id)}>
              🗑
            </button>
          </div>
        )
      })}
      <button
        className="notes-btn"
        onClick={() =>
          add({ id: 'cc' + Date.now().toString(36), name: 'new account', tool: 'claude', auth: 'login' })
        }
      >
        ＋ Add account
      </button>

      <div className="bind-toolbar" style={{ marginTop: 10 }}>
        <span className="bind-hint">Bind „Active pane → Claude Code" in Shortcuts → Pane mode.</span>
        <button className="notes-btn" onClick={() => openSettingsTab('shortcuts')}>
          Edit shortcuts →
        </button>
      </div>

      {/* Dół: status + instalacja wszystkich CLI (też Claude). */}
      <h4 className="agent-tools-h">CLI tools</h4>
      <p className="setting-sub">
        Each pane runs the tool&apos;s command — it must be on your PATH. Install the ones you use.
      </p>
      {AGENT_TOOLS.map((t) => {
        const st = cliMap[t.id]
        return (
          <div className="ssh-row agent-tool-row" key={t.id}>
            <span className="agent-tool-name">
              <b>{t.name}</b> <code>{t.cmd}</code>
            </span>
            <span className="setting-sub agent-tool-note">{t.authNote}</span>
            {st?.installed ? (
              <span className="claude-cli-ok" title={st.path}>
                ✓ installed
              </span>
            ) : t.install ? (
              <button className="notes-btn" disabled={installing !== null} onClick={() => install(t.id)}>
                {installing === t.id ? 'Installing…' : 'Install'}
              </button>
            ) : (
              <span className="setting-sub">install manually</span>
            )}
          </div>
        )
      })}
      {installLog && <pre className="claude-cli-log">{installLog}</pre>}
    </div>
  )
}

/** Settings window, centered over the app. */
export default function SettingsModal(): JSX.Element | null {
  const open = useStore((s) => s.settingsOpen)
  const setOpen = useStore((s) => s.setSettingsOpen)
  const binds = useStore((s) => s.binds)
  const setBind = useStore((s) => s.setBind)
  const resetBinds = useStore((s) => s.resetBinds)
  const vimMode = useStore((s) => s.vimMode)
  const setVimMode = useStore((s) => s.setVimMode)
  const vimTermExit = useStore((s) => s.vimTermExit)
  const setVimTermExit = useStore((s) => s.setVimTermExit)
  const vimBinds = useStore((s) => s.vimBinds)
  const setVimBind = useStore((s) => s.setVimBind)
  const resetVimBinds = useStore((s) => s.resetVimBinds)
  const forceDark = useStore((s) => s.forceDark)
  const setForceDark = useStore((s) => s.setForceDark)
  const autoScrollEnabled = useStore((s) => s.autoScrollEnabled)
  const setAutoScrollEnabled = useStore((s) => s.setAutoScrollEnabled)
  const autoScrollMin = useStore((s) => s.autoScrollMin)
  const setAutoScrollMin = useStore((s) => s.setAutoScrollMin)
  const autoScrollMax = useStore((s) => s.autoScrollMax)
  const setAutoScrollMax = useStore((s) => s.setAutoScrollMax)
  const autoApproveEnabled = useStore((s) => s.autoApproveEnabled)
  const setAutoApproveEnabled = useStore((s) => s.setAutoApproveEnabled)
  const autoApproveMin = useStore((s) => s.autoApproveMin)
  const setAutoApproveMin = useStore((s) => s.setAutoApproveMin)
  const autoApproveMax = useStore((s) => s.autoApproveMax)
  const setAutoApproveMax = useStore((s) => s.setAutoApproveMax)
  const [tab, setTab] = useState<Tab>('shortcuts')
  const settingsTab = useStore((s) => s.settingsTab)
  const clearSettingsTab = useStore((s) => s.clearSettingsTab)

  // Otwarcie na konkretnej zakładce (np. z eksploratora: „Configure in Settings → SSH").
  useEffect(() => {
    if (open && settingsTab) {
      setTab(settingsTab as Tab)
      clearSettingsTab()
    }
  }, [open, settingsTab, clearSettingsTab])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, setOpen])

  // Akcje pogrupowane wg pola group (kolejność zachowana z BIND_ACTIONS).
  const groups = useMemo(() => {
    const map = new Map<string, typeof BIND_ACTIONS>()
    for (const a of BIND_ACTIONS) {
      const arr = map.get(a.group) ?? []
      arr.push(a)
      map.set(a.group, arr)
    }
    return [...map.entries()]
  }, [])

  // Akcje vima pogrupowane (Terminal / Browser / Windows / Viewer) — render z VIM_ACTIONS.
  const vimGroups = useMemo(() => {
    const map = new Map<string, typeof VIM_ACTIONS>()
    for (const a of VIM_ACTIONS) {
      const arr = map.get(a.group) ?? []
      arr.push(a)
      map.set(a.group, arr)
    }
    return [...map.entries()]
  }, [])

  if (!open) return null

  return (
    <div className="modal-overlay" onMouseDown={() => setOpen(false)}>
      <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <span>Settings</span>
          <button className="icon-btn" data-tip="Close" onClick={() => setOpen(false)}>
            ✕
          </button>
        </div>

        <div className="modal-tabs">
          <button
            className={'modal-tab' + (tab === 'shortcuts' ? ' modal-tab--on' : '')}
            onClick={() => setTab('shortcuts')}
          >
            Shortcuts
          </button>
          <button
            className={'modal-tab' + (tab === 'vim' ? ' modal-tab--on' : '')}
            onClick={() => setTab('vim')}
          >
            Vim
          </button>
          <button
            className={'modal-tab' + (tab === 'browser' ? ' modal-tab--on' : '')}
            onClick={() => setTab('browser')}
          >
            Browser
          </button>
          <button
            className={'modal-tab' + (tab === 'autopilot' ? ' modal-tab--on' : '')}
            onClick={() => setTab('autopilot')}
          >
            Autopilot
          </button>
          <button
            className={'modal-tab' + (tab === 'agents' ? ' modal-tab--on' : '')}
            onClick={() => setTab('agents')}
          >
            Agents
          </button>
          <button
            className={'modal-tab' + (tab === 'ssh' ? ' modal-tab--on' : '')}
            onClick={() => setTab('ssh')}
          >
            SSH
          </button>
          <button
            className={'modal-tab' + (tab === 'ram' ? ' modal-tab--on' : '')}
            onClick={() => setTab('ram')}
          >
            RAM
          </button>
        </div>

        <div className="modal-body">
          {tab === 'shortcuts' && (
            <>
              <div className="bind-toolbar">
                <span className="bind-hint">Click a shortcut, then press keys. ⌫ clears · Esc cancels.</span>
                <button className="notes-btn" onClick={resetBinds}>
                  Reset to defaults
                </button>
              </div>

              <p className="setting-sub" style={{ marginTop: 2 }}>
                <b>Find</b> (default <kbd>⌘F</kbd>, group <i>Find</i>) searches text in the focused pane —
                terminal, viewer (PDF/docx/text), notes, browser and explorer. Enter / ⇧Enter cycle
                matches, Esc closes. <b>Auto-approve</b> lives in the <i>Autopilot</i> tab.
              </p>

              {groups.map(([group, actions]) => (
                <BindGroup key={group} title={group}>
                  {actions.map((a) => (
                    <BindRow
                      key={a.id}
                      label={a.label}
                      combo={binds[a.id] ?? ''}
                      onSet={(c) => setBind(a.id, c)}
                    />
                  ))}
                </BindGroup>
              ))}
            </>
          )}

          {tab === 'vim' && (
            <>
              <label className="setting-row setting-row--toggle">
                <span>
                  <b>Vim mode</b>
                  <span className="setting-sub">Keyboard-first navigation in terminals and browser.</span>
                </span>
                <input
                  type="checkbox"
                  checked={vimMode}
                  onChange={(e) => setVimMode(e.target.checked)}
                />
              </label>

              <div className="setting-row">
                <span>
                  <b>Leave INSERT → NORMAL with</b>
                  <span className="setting-sub">
                    Pick how the terminal exits typing mode — avoids clashing with Esc in Neovim
                    &amp; other programs.
                  </span>
                </span>
                <select
                  className="setting-select"
                  value={vimTermExit}
                  onChange={(e) => setVimTermExit(e.target.value as 'esc' | 'double-esc')}
                >
                  <option value="esc">Single Esc</option>
                  <option value="double-esc">Double Esc (single goes to program)</option>
                </select>
              </div>

              <p className="setting-sub" style={{ marginTop: 4 }}>
                Every key below is remappable in <b>Vim keys (movement)</b> further down. Defaults:
              </p>
              <div className="vim-help">
                <div className="vim-help-col">
                  <h4>Terminal (copy-mode)</h4>
                  <p>Esc → <b>NORMAL</b>: a cursor you move like vim.</p>
                  <ul>
                    <li><kbd>h</kbd><kbd>j</kbd><kbd>k</kbd><kbd>l</kbd> move · <kbd>w</kbd>/<kbd>b</kbd>/<kbd>e</kbd> word · <kbd>0</kbd>/<kbd>$</kbd> line</li>
                    <li><kbd>gg</kbd>/<kbd>G</kbd> ends · <kbd>Ctrl+d</kbd>/<kbd>u</kbd> half page</li>
                    <li><kbd>v</kbd>/<kbd>V</kbd> select · <kbd>y</kbd> copy · <kbd>i</kbd> → <b>INSERT</b></li>
                  </ul>
                  <p className="setting-sub">Typing is blocked in NORMAL — protects the shell.</p>
                </div>
                <div className="vim-help-col">
                  <h4>Browser</h4>
                  <ul>
                    <li><kbd>:</kbd> address bar · <kbd>f</kbd> link hints</li>
                    <li><kbd>H</kbd>/<kbd>L</kbd> back/forward · <kbd>gg</kbd>/<kbd>G</kbd> top/bottom</li>
                    <li><kbd>h</kbd><kbd>j</kbd><kbd>k</kbd><kbd>l</kbd> scroll · <kbd>d</kbd>/<kbd>u</kbd> half page</li>
                    <li><kbd>i</kbd> next field · <kbd>Esc</kbd> leave field</li>
                  </ul>
                </div>
                <div className="vim-help-col">
                  <h4>Windows (<kbd>Ctrl+w</kbd>)</h4>
                  <ul>
                    <li><kbd>Ctrl+w</kbd> then <kbd>h</kbd><kbd>j</kbd><kbd>k</kbd><kbd>l</kbd> — focus pane by direction</li>
                    <li><kbd>w</kbd>/<kbd>W</kbd> cycle · <kbd>q</kbd> kill pane</li>
                    <li><kbd>s</kbd>/<kbd>v</kbd> split · <kbd>o</kbd> single</li>
                  </ul>
                  <p className="setting-sub">Works in terminal, browser and viewer panes.</p>
                </div>
                <div className="vim-help-col">
                  <h4>Viewer</h4>
                  <ul>
                    <li><kbd>h</kbd><kbd>j</kbd><kbd>k</kbd><kbd>l</kbd> scroll · <kbd>d</kbd>/<kbd>u</kbd> half · <kbd>gg</kbd>/<kbd>G</kbd> ends</li>
                    <li><kbd>+</kbd>/<kbd>-</kbd>/<kbd>0</kbd> zoom (image · PDF · docx)</li>
                    <li><kbd>v</kbd> copy-mode: caret on, <kbd>h</kbd><kbd>j</kbd><kbd>k</kbd><kbd>l</kbd> moves · <kbd>v</kbd> again selects · <kbd>y</kbd> yank · <kbd>Esc</kbd> exit</li>
                  </ul>
                  <p className="setting-sub">PDF renders via pdf.js (real, selectable text). Mouse still works everywhere.</p>
                </div>
                <div className="vim-help-col">
                  <h4>Explorer</h4>
                  <ul>
                    <li><kbd>j</kbd>/<kbd>k</kbd> move · <kbd>l</kbd>/<kbd>Enter</kbd> open · <kbd>h</kbd> parent · <kbd>gg</kbd>/<kbd>G</kbd> ends</li>
                    <li><kbd>N</kbd>/<kbd>F</kbd> new folder/file · <kbd>D</kbd> delete · right-click = menu</li>
                    <li><strong>SSH</strong> button → browse &amp; edit remote files over SFTP</li>
                  </ul>
                  <p className="setting-sub">Arrows, double-click &amp; Shortcuts tab work too.</p>
                </div>
              </div>
              <div className="bind-toolbar" style={{ marginTop: 12 }}>
                <span className="bind-hint">
                  Every shortcut — panes, tabs, modes, notes, layout — is remappable.
                </span>
                <button className="notes-btn" onClick={() => setTab('shortcuts')}>
                  Edit shortcuts →
                </button>
              </div>

              <div className="bind-toolbar" style={{ marginTop: 14 }}>
                <span className="bind-hint">
                  <b>Vim keys (movement)</b> — expand a group and click a key to remap. ⌫ clears ·
                  Esc cancels.
                </span>
                <button className="notes-btn" onClick={resetVimBinds}>
                  Reset vim keys
                </button>
              </div>
              {vimGroups.map(([group, actions]) => (
                <BindGroup key={group} title={group} defaultOpen={false}>
                  {actions.map((a) => (
                    <VimKeyRow
                      key={a.id}
                      label={a.label}
                      value={vimBinds[a.id] ?? ''}
                      onSet={(k) => setVimBind(a.id, k)}
                    />
                  ))}
                </BindGroup>
              ))}
            </>
          )}

          {tab === 'browser' && (
            <>
              <label className="setting-row setting-row--toggle">
                <span>
                  <b>Force dark mode on web pages</b>
                  <span className="setting-sub">
                    Asks sites for their dark theme (prefers-color-scheme: dark). Best-effort —
                    pages without a dark theme stay light.
                  </span>
                </span>
                <input
                  type="checkbox"
                  checked={forceDark}
                  onChange={(e) => setForceDark(e.target.checked)}
                />
              </label>

              <label className="setting-row setting-row--toggle">
                <span>
                  <b>Auto-scroll (reels/shorts)</b>
                  <span className="setting-sub">
                    Enables the <i>Toggle auto-scroll</i> shortcut. Bind a key in Shortcuts, then
                    toggle it on a browser pane (TikTok / Reels / Shorts) — it gets a red border and
                    auto-presses ↓ on its own.
                  </span>
                </span>
                <input
                  type="checkbox"
                  checked={autoScrollEnabled}
                  onChange={(e) => setAutoScrollEnabled(e.target.checked)}
                />
              </label>

              <div className="setting-row">
                <span>
                  <b>Random interval (seconds)</b>
                  <span className="setting-sub">
                    Each ↓ press waits a random time between min and max — feels less robotic.
                  </span>
                </span>
                <span className="setting-range">
                  <input
                    type="number"
                    min={1}
                    value={autoScrollMin}
                    disabled={!autoScrollEnabled}
                    onChange={(e) => setAutoScrollMin(Number(e.target.value))}
                  />
                  <span>–</span>
                  <input
                    type="number"
                    min={1}
                    value={autoScrollMax}
                    disabled={!autoScrollEnabled}
                    onChange={(e) => setAutoScrollMax(Number(e.target.value))}
                  />
                </span>
              </div>
            </>
          )}

          {tab === 'autopilot' && (
            <>
              <p className="setting-sub">
                <b>Autopilot</b> — let the app press keys for you so you don&apos;t have to babysit
                prompts. 🧠💤
              </p>

              <label className="setting-row setting-row--toggle">
                <span>
                  <b>Auto-approve (Enter on a loop)</b>
                  <span className="setting-sub">
                    Enables the <i>Toggle auto-approve</i> shortcut. Bind a key in Shortcuts →
                    Auto-approve, then toggle it on a terminal — it gets a green border and
                    auto-presses <kbd>Enter</kbd> on its own (handy for confirming &quot;approve?&quot;
                    prompts, e.g. Claude Code). Toggle the key again to stop. Works on several
                    terminals at once.
                  </span>
                </span>
                <input
                  type="checkbox"
                  checked={autoApproveEnabled}
                  onChange={(e) => setAutoApproveEnabled(e.target.checked)}
                />
              </label>

              <div className="setting-row">
                <span>
                  <b>Random interval (seconds)</b>
                  <span className="setting-sub">
                    Each <kbd>Enter</kbd> waits a random time between min and max — feels less robotic.
                  </span>
                </span>
                <span className="setting-range">
                  <input
                    type="number"
                    min={1}
                    value={autoApproveMin}
                    disabled={!autoApproveEnabled}
                    onChange={(e) => setAutoApproveMin(Number(e.target.value))}
                  />
                  <span>–</span>
                  <input
                    type="number"
                    min={1}
                    value={autoApproveMax}
                    disabled={!autoApproveEnabled}
                    onChange={(e) => setAutoApproveMax(Number(e.target.value))}
                  />
                </span>
              </div>

              <div className="bind-toolbar" style={{ marginTop: 8 }}>
                <span className="bind-hint">
                  Set the <b>Toggle auto-approve</b> key in Shortcuts → Auto-approve.
                </span>
                <button className="notes-btn" onClick={() => setTab('shortcuts')}>
                  Edit shortcuts →
                </button>
              </div>
            </>
          )}

          {tab === 'agents' && <AgentSettings />}
          {tab === 'ssh' && <SshSettings />}
          {tab === 'ram' && <RamControls />}
        </div>

        <div className="modal-foot">Go to Jesus Christ — He&apos;s The Only Way</div>
      </div>
    </div>
  )
}
