import { spawn, IPty } from 'node-pty'
import os from 'os'
import path from 'path'
import { mkdirSync } from 'fs'
import { app, WebContents } from 'electron'
import { agentTool } from '../shared/agents'

interface Session {
  proc: IPty
  buffer: string
  cols: number
  rows: number
}

const SHELL =
  process.env.SHELL || (os.platform() === 'win32' ? 'powershell.exe' : '/bin/bash')

// Buduje bezpieczne `cd` dla zdalnej powłoki: brak ścieżki → home; tyldę rozwijamy ręcznie na $HOME,
// bo w cudzysłowach `~` się nie rozwija (a bez cudzysłowów ścieżki ze spacjami by się rozjechały).
function remoteCd(cwd?: string): string {
  const t = (cwd || '').trim()
  if (!t || t === '~' || t === '~/') return 'cd "$HOME"'
  if (t.startsWith('~/')) return `cd "$HOME/${t.slice(2)}"`
  return `cd "${t}"`
}

// Limit historii (scrollback) trzymanej w pamięci na sesję — element trybu oszczędnego.
const MAX_BUFFER = 200_000

/**
 * Zarządza prawdziwymi procesami PTY w procesie main.
 * Każda sesja ma stabilne `id` (= id panelu) i bufor historii, dzięki któremu
 * terminal działający w tle można odtworzyć po ponownym zamontowaniu widoku.
 */
export class PtyManager {
  private sessions = new Map<string, Session>()
  private getSender: () => WebContents | null

  constructor(getSender: () => WebContents | null) {
    this.getSender = getSender
  }

  has(id: string): boolean {
    return this.sessions.has(id)
  }

  /**
   * Tworzy sesję jeśli nie istnieje. Zwraca zgromadzony bufor do odtworzenia.
   * `opts.agent` → sesja agenta AI: izolowany folder configu per profil (configEnv narzędzia +
   * XDG_CONFIG_HOME), opcjonalny klucz API w env, auto-odpalenie komendy narzędzia w `cwd`.
   */
  ensure(
    id: string,
    cols: number,
    rows: number,
    cwd?: string,
    opts?: { agent?: { profileId: string; toolId: string; apiKey?: string; ssh?: { command: string } } }
  ): string {
    let s = this.sessions.get(id)
    if (!s) {
      const env: Record<string, string> = { ...(process.env as Record<string, string>) }
      let file = SHELL
      let args: string[] = []
      let spawnCwd = cwd || os.homedir()
      const ag = opts?.agent
      if (ag) {
        const tool = agentTool(ag.toolId)
        const cmd = tool?.cmd ?? ag.toolId
        if (ag.ssh) {
          // ZDALNIE: odpalamy CLI na serwerze przez ssh. Config już zsynchronizowany (agentSshSync),
          // więc wskazujemy zdalny CLAUDE_CONFIG_DIR (itd.) — bez ponownego /login. Spawnujemy ssh
          // bezpośrednio (bez powłoki) → brak piekła cudzysłowów; zdalny shell parsuje `remoteCmd`.
          const toks = ag.ssh.command.trim().split(/\s+/)
          file = toks[0] || 'ssh'
          const rest = toks.slice(1)
          const remoteDir = `$HOME/.braindead-agents/${ag.profileId}`
          const cfg = tool?.configEnv ? `${tool.configEnv}="${remoteDir}" ` : ''
          const key = tool?.apiKeyEnv && ag.apiKey ? `${tool.apiKeyEnv}="${ag.apiKey}" ` : ''
          // PATH: świeżo zainstalowane CLI siedzi w ~/.local/bin (claude) lub ~/.npm-global/bin (npm) —
          // a komenda przez ssh nie czyta rc usera, więc dokładamy te ścieżki ręcznie. Eksport idzie do
          // env, które `exec $SHELL` dziedziczy, więc i fallbackowa powłoka po wyjściu ma poprawny PATH.
          const pathFix = 'export PATH="$HOME/.local/bin:$HOME/bin:$HOME/.npm-global/bin:$PATH"'
          // Brak ścieżki → home; `~`/`~/x` rozwijamy ręcznie na $HOME (w cudzysłowach tylda się nie rozwija).
          const remoteCmd = `${pathFix}; ${remoteCd(cwd)}; ${cfg}${key}${cmd}; exec $SHELL`
          args = [...rest, '-t', remoteCmd]
          spawnCwd = os.homedir() // ssh działa lokalnie; zdalna ścieżka idzie w remoteCmd
        } else {
          // LOKALNIE: każde konto ma własny folder konfiguracji (token/ustawienia) — różne konta w
          // różnych panelach NIE ingerują ze sobą. Claude w 'claude/' (wstecznie), reszta w 'agents/'.
          const base = ag.toolId === 'claude' ? 'claude' : 'agents'
          const dir = path.join(app.getPath('userData'), base, ag.profileId)
          try {
            mkdirSync(dir, { recursive: true })
          } catch {
            /* katalog mógł już istnieć */
          }
          if (tool?.configEnv) env[tool.configEnv] = dir
          env.XDG_CONFIG_HOME = dir // best-effort izolacja dla narzędzi opartych o XDG
          if (tool?.apiKeyEnv && ag.apiKey) env[tool.apiKeyEnv] = ag.apiKey
          // Auto-odpal komendę; po wyjściu zostań w powłoce (z izolowanym env), by można było /login.
          if (os.platform() !== 'win32') args = ['-ic', `${cmd}; exec ${SHELL}`]
        }
      }
      const proc = spawn(file, args, {
        name: 'xterm-256color',
        cols: cols || 80,
        rows: rows || 24,
        cwd: spawnCwd,
        env
      })
      s = { proc, buffer: '', cols, rows }
      this.sessions.set(id, s)

      proc.onData((data) => {
        const sess = this.sessions.get(id)
        if (!sess) return
        sess.buffer += data
        if (sess.buffer.length > MAX_BUFFER) {
          sess.buffer = sess.buffer.slice(sess.buffer.length - MAX_BUFFER)
        }
        try {
          this.getSender()?.send('pty:data', { id, data })
        } catch {
          /* okno zniszczone podczas zamykania */
        }
      })

      proc.onExit(({ exitCode }) => {
        this.sessions.delete(id)
        try {
          this.getSender()?.send('pty:exit', { id, exitCode })
        } catch {
          /* okno zniszczone podczas zamykania */
        }
      })
    }
    return s.buffer
  }

  write(id: string, data: string): void {
    const s = this.sessions.get(id)
    if (!s) return
    try {
      s.proc.write(data)
    } catch {
      /* proces mógł już zniknąć (np. podczas zamykania) */
    }
  }

  resize(id: string, cols: number, rows: number): void {
    const s = this.sessions.get(id)
    if (!s) return
    s.cols = cols
    s.rows = rows
    try {
      s.proc.resize(cols, rows)
    } catch {
      /* ignorujemy chwilowe błędy resize podczas montowania */
    }
  }

  kill(id: string): void {
    const s = this.sessions.get(id)
    if (!s) return
    this.sessions.delete(id)
    try {
      s.proc.kill()
    } catch {
      /* proces mógł już zniknąć */
    }
  }

  killAll(): void {
    for (const id of [...this.sessions.keys()]) this.kill(id)
  }
}
