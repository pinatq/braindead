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
  alt: boolean // program pełnoekranowy (nvim/htop) trzyma alternate screen
}

// Sekwencje wejścia/wyjścia alternate screen (DECSET 1049/1047/47). Śledzimy je tutaj, bo bufor
// jest przycinany (MAX_BUFFER) i po replayu xterm w rendererze nie wiedziałby, że działa nvim —
// a wtedy vim mode zaczynałby zjadać klawisze (Esc, litery) należące do programu.
const ALT_SEQ = /\x1b\[\?(?:1049|1047|47)[hl]/g

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

  /** Czy w sesji działa program pełnoekranowy (alternate screen). */
  isAlt(id: string): boolean {
    return this.sessions.get(id)?.alt ?? false
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
    if (s) {
      // Remont widoku, sesja żyje. Gdy działa program pełnoekranowy, wymuś przerysowanie:
      // zwężamy o wiersz i wracamy. Warunek `cols === s.cols` odsiewa panele, których renderer
      // nie zdążył zmierzyć (ukryta przestrzeń ma host o zerowym rozmiarze i przysyła domyślne
      // 80x24) — bez tego ściskalibyśmy działający program do 80x24. Powrót idzie osobnym tickiem,
      // bo SIGWINCH nie jest kolejkowany: dwa ioctl-e pod rząd program może zobaczyć jako jeden.
      if (s.alt && cols === s.cols && rows === s.rows && rows > 1) {
        const sess = s
        try {
          sess.proc.resize(cols, rows - 1)
          setTimeout(() => {
            try {
              if (this.sessions.get(id) === sess) sess.proc.resize(cols, rows)
            } catch {
              /* proces mógł zniknąć */
            }
          }, 50)
        } catch {
          /* proces mógł zniknąć */
        }
      }
      // Stan alternate screen renderer bierze z `alt` w odpowiedzi ensure() i ze zdarzeń 'pty:alt',
      // więc bufor odtwarzamy bez żadnych doklejek (wstrzyknięte '?1049h' przełączyłoby xterm na
      // ekran alternatywny jeszcze przed replayem i historia panelu wylądowałaby w koszu).
      return s.buffer
    }

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
    s = { proc, buffer: '', cols, rows, alt: false }
    this.sessions.set(id, s)

    proc.onData((data) => {
      const sess = this.sessions.get(id)
      if (!sess) return
      sess.buffer += data
      // Stan alternate screen z ogona bufora: nowy chunk + 16 znaków zakładki na sekwencję
      // rozciętą między chunkami. ponytail: zakładka nie łapie sekwencji dłuższych niż 16 B —
      // DECSET 1049 ma maks. 8 B, zapas 2x wystarczy.
      const tail = sess.buffer.slice(-(data.length + 16))
      const seqs = tail.match(ALT_SEQ)
      if (seqs) {
        const alt = seqs[seqs.length - 1].endsWith('h')
        if (alt !== sess.alt) {
          sess.alt = alt
          // Renderer musi wiedzieć, że działa program pełnoekranowy (nvim/htop) — inaczej vim
          // mode zjadałby jego klawisze. Bufor xterma bywa niewiarygodny po replayu, więc
          // stan z PTY jest nadrzędny.
          try {
            this.getSender()?.send('pty:alt', { id, alt })
          } catch {
            /* okno zniszczone podczas zamykania */
          }
        }
      }
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
      const dying = this.sessions.get(id)
      this.sessions.delete(id)
      try {
        // Sesja padła w trakcie programu pełnoekranowego (zerwane ssh, kill) — bez tego panel
        // zostałby z altRef=true na zawsze i vim mode już by w nim nie wstał.
        if (dying?.alt) this.getSender()?.send('pty:alt', { id, alt: false })
        this.getSender()?.send('pty:exit', { id, exitCode })
      } catch {
        /* okno zniszczone podczas zamykania */
      }
    })
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
