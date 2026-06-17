import { useEffect, useRef, useState } from 'react'
import { useStore } from '../state/store'
import { agentTool } from '../../../shared/agents'
import { matchVimKey } from '../../../shared/vimKeys'
import type { AgentProfile } from '../../../shared/types'
import TerminalPane from './TerminalPane'

interface Props {
  paneId: string
}

/**
 * Panel agenta AI (5. tryb). U góry przycisk SSH: wybierasz cel (Local albo zapisany VPS). Potem
 * klikasz konto (dowolne narzędzie) — przy SSH jego config (token) kopiuje się na zdalny host i tam
 * odpala agenta (instalując CLI, jeśli brak), więc nie logujesz się od nowa. Pod spodem to terminal
 * ([[TerminalPane]]) z osobnym kluczem PTY. Ekrany wyboru chodzą vimem (j/k/l/h) i strzałkami.
 */
export default function AgentPane({ paneId }: Props): JSX.Element {
  const pane = useStore((s) => s.workspaces[s.current]?.panes.find((p) => p.id === paneId))
  const profiles = useStore((s) => s.claudeProfiles)
  const sshConns = useStore((s) => s.sshConns)
  const setPaneClaude = useStore((s) => s.setPaneClaude)
  const openSettingsTab = useStore((s) => s.openSettingsTab)
  const setActivePane = useStore((s) => s.setActivePane)
  const activePaneId = useStore((s) => s.activePaneId)

  const [target, setTarget] = useState<string>('local') // 'local' albo id połączenia SSH
  const [sshOpen, setSshOpen] = useState(false)
  const [hi, setHi] = useState(0)
  const [busy, setBusy] = useState('')
  const boxRef = useRef<HTMLDivElement>(null)
  const busyProfile = useRef<string>('') // profil aktualnie konfigurowany po SSH (filtr statusów)

  // Żywe statusy etapów SSH (łączenie / instalacja CLI / przenoszenie tokenów) z procesu main.
  useEffect(() => {
    return window.api.agents.onSshProgress(({ profileId: pid, stage }) => {
      if (pid === busyProfile.current) setBusy(stage)
    })
  }, [])

  const profileId = pane?.claudeProfile || null
  const cwd = pane?.claudeCwd || null
  const profile = profileId ? profiles.find((p) => p.id === profileId) : null
  const sshConn = pane?.agentSsh ? sshConns.find((c) => c.id === pane.agentSsh) : null
  const ready = !!profile && !!cwd && (!pane?.agentSsh || !!sshConn)
  const toolName = (t?: string): string => agentTool(t ?? '')?.name ?? t ?? 'Agent'
  const targetConn = target === 'local' ? null : sshConns.find((c) => c.id === target)

  useEffect(() => {
    if (activePaneId === paneId && !ready) boxRef.current?.focus()
  }, [activePaneId, paneId, ready])

  // Uruchom konto na wybranym celu (Local albo SSH). Przy SSH: kopia configu + ewentualna instalacja.
  const runAccount = async (p: AgentProfile): Promise<void> => {
    if (target !== 'local' && targetConn) {
      const remotePath = p.sshDir?.trim() || '~'
      const ok = confirm(
        `Set up "${p.name}" (${toolName(p.tool)}) on ${targetConn.name}?\n` +
          `Copies your local login/token to the remote and installs the CLI there if missing.`
      )
      if (ok) {
        busyProfile.current = p.id
        setBusy(`Preparing ${targetConn.name}…`)
        const r = await window.api.agents.sshSync(targetConn.command, p.tool, p.id)
        busyProfile.current = ''
        setBusy('')
        if (!r.ok) {
          alert('SSH setup failed:\n' + r.output)
          return
        }
        if (r.output) console.log('[agent ssh setup]\n' + r.output)
      }
      setPaneClaude(paneId, p.id, remotePath, targetConn.id)
      return
    }
    // Local
    if (p.dir) {
      setPaneClaude(paneId, p.id, p.dir)
      return
    }
    const d = await window.api.files.chooseDir()
    if (d) setPaneClaude(paneId, p.id, d)
  }

  const changeAccount = (): void => {
    if (profileId) window.api.pty.kill('claude:' + paneId + ':' + profileId)
    setTarget('local')
    setSshOpen(false)
    setHi(0)
    setPaneClaude(paneId, '', '')
  }

  // Vim/klawiatura na ekranie wyboru: gdy otwarta lista SSH — nawigujemy nią, inaczej kontami.
  const onKey = (e: React.KeyboardEvent): void => {
    if (ready) return
    const st = useStore.getState()
    const vb = st.vimBinds
    const vimOn = st.vimMode
    const ev = e.nativeEvent
    const k = e.key
    const sIs = (id: string): boolean => vimOn && matchVimKey(vb[id], ev)
    const len = sshOpen ? 1 + sshConns.length : profiles.length
    if (k === 'ArrowDown' || sIs('explorer.down')) setHi((h) => Math.min(Math.max(len - 1, 0), h + 1))
    else if (k === 'ArrowUp' || sIs('explorer.up')) setHi((h) => Math.max(0, h - 1))
    else if (k === 'Enter' || k === 'ArrowRight' || sIs('explorer.open')) {
      if (sshOpen) selectTarget(hi)
      else if (profiles[hi]) runAccount(profiles[hi])
    } else if (k === 'Escape' || k === 'ArrowLeft' || sIs('explorer.parent')) {
      if (sshOpen) setSshOpen(false)
    } else return
    e.preventDefault()
  }

  // Wybór celu z listy [Local, ...VPS].
  const selectTarget = (idx: number): void => {
    if (idx === 0) setTarget('local')
    else {
      const c = sshConns[idx - 1]
      if (c) setTarget(c.id)
    }
    setSshOpen(false)
    setHi(0)
  }

  if (ready && profile) {
    return (
      <div className="claude-pane">
        <div className="claude-head">
          <span className="claude-acct">
            🤖 {toolName(profile.tool)} · {profile.name}
          </span>
          <span className="claude-loc">{sshConn ? '⦿ ' + sshConn.name : 'local'}</span>
          <span className="claude-cwd" title={cwd ?? ''}>
            {cwd}
          </span>
          <button className="icon-btn" data-tip="Change account / location" onClick={changeAccount}>
            ⟳
          </button>
        </div>
        <div className="claude-term">
          <TerminalPane
            key={(profileId ?? '') + '|' + (pane?.agentSsh ?? '') + '|' + cwd}
            paneId={paneId}
            ptyKey={'claude:' + paneId + ':' + profileId}
            agent={{
              profileId: profileId as string,
              toolId: profile.tool,
              apiKey: profile.auth === 'api' ? profile.apiKey : undefined,
              cwd: cwd as string,
              ssh: sshConn ? { command: sshConn.command } : undefined
            }}
          />
        </div>
      </div>
    )
  }

  return (
    <div
      className="claude-pane claude-setup"
      ref={boxRef}
      tabIndex={0}
      onKeyDown={onKey}
      onMouseDown={() => setActivePane(paneId)}
    >
      <div className="claude-setup-card">
        <div className="claude-logo">🤖</div>
        <h3>AI agent</h3>

        {/* Cel uruchomienia: Local / VPS (lista zapisanych połączeń SSH). */}
        <div className="agent-target">
          <button
            className={'agent-ssh-btn' + (target !== 'local' ? ' agent-ssh-btn--on' : '')}
            onClick={() => {
              setSshOpen((v) => !v)
              setHi(0)
            }}
          >
            {target === 'local' ? '💻 Local' : '⦿ ' + (targetConn?.name ?? 'SSH')} ▾
          </button>
          {sshOpen && (
            <div className="agent-ssh-menu">
              <button
                className={'agent-ssh-item' + (hi === 0 ? ' agent-ssh-item--hi' : '')}
                onMouseEnter={() => setHi(0)}
                onClick={() => selectTarget(0)}
              >
                💻 Local
              </button>
              {sshConns.length === 0 ? (
                <button className="agent-ssh-item" onClick={() => openSettingsTab('ssh')}>
                  No VPS — configure in Settings → SSH
                </button>
              ) : (
                sshConns.map((c, i) => (
                  <button
                    key={c.id}
                    className={'agent-ssh-item' + (hi === i + 1 ? ' agent-ssh-item--hi' : '')}
                    onMouseEnter={() => setHi(i + 1)}
                    onClick={() => selectTarget(i + 1)}
                    title={c.command}
                  >
                    ⦿ {c.name}
                  </button>
                ))
              )}
            </div>
          )}
        </div>

        {busy && <p className="claude-sub">{busy}</p>}

        {profiles.length === 0 ? (
          <>
            <p className="claude-sub">No accounts yet.</p>
            <button className="notes-btn notes-btn--primary" onClick={() => openSettingsTab('agents')}>
              Add an account in Settings → Agents
            </button>
          </>
        ) : (
          <>
            <p className="claude-sub">
              Pick an account{target !== 'local' ? ` — runs on ${targetConn?.name}` : ''}
            </p>
            <div className="claude-acct-list">
              {profiles.map((p, i) => (
                <button
                  key={p.id}
                  className={'claude-acct-btn' + (!sshOpen && i === hi ? ' claude-acct-btn--hi' : '')}
                  onMouseEnter={() => !sshOpen && setHi(i)}
                  onClick={() => runAccount(p)}
                >
                  <span className="claude-acct-name">{p.name}</span>
                  <span className="claude-acct-kind">
                    {toolName(p.tool)}
                    {target !== 'local'
                      ? p.sshDir
                        ? ' · 🌐 ' + p.sshDir
                        : ' · 🌐 ~'
                      : p.dir
                        ? ' · 📁'
                        : p.auth === 'api'
                          ? ' · API'
                          : ' · login'}
                  </span>
                </button>
              ))}
            </div>
            <button className="claude-cfg" onClick={() => openSettingsTab('agents')}>
              ⚙ Manage accounts
            </button>
          </>
        )}
      </div>
    </div>
  )
}
