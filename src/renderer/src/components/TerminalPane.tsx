import { useEffect, useRef, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import '@xterm/xterm/css/xterm.css'
import { useStore } from '../state/store'
import { matchVimKey, isDoubleFirst, WIN_MOTION_IDS, type DoubleState } from '../../../shared/vimKeys'
import { armWinPending, clearWinPending, runWindowMotion } from '../shortcuts/dispatch'
import { FIND_EVENT, type FindDetail } from '../shortcuts/find'

interface Props {
  paneId: string
  // Klucz sesji PTY (domyślnie = paneId). Panel agenta używa osobnego klucza, by nie kolidować
  // z ewentualnym terminalem tego panelu i pozwolić na różne konta w różnych panelach.
  ptyKey?: string
  // Gdy ustawione: sesja startuje jako agent AI (izolowany config-dir + auto-odpalenie komendy).
  // `ssh` → agent uruchamiany na zdalnej maszynie (komenda połączenia SSH).
  agent?: { profileId: string; toolId: string; apiKey?: string; cwd?: string; ssh?: { command: string } }
}

type VimMode = 'insert' | 'normal'

/**
 * Pojedynczy terminal (xterm.js). Proces PTY żyje w procesie main pod kluczem `paneId`.
 * Przy montażu odtwarzamy historię z bufora (terminal mógł działać w tle), a wejście
 * użytkownika oznacza panel jako "dirty" (chroniony przed ubiciem).
 *
 * Vim mode (opcjonalny): Esc przełącza NORMAL<->INSERT (też przewinięcie myszą w górę lub
 * zaznaczenie tekstu => NORMAL). W NORMAL j/k/g/G/Ctrl+u/d przewijają, a litery NIE trafiają do
 * shella. `i`/`a`/`o`/Enter (lub Esc) wraca do INSERT. W pełnoekranowych TUI (alt-screen: vim,
 * htop) tryb się nie włącza — klawisze lecą prosto do programu.
 */
export default function TerminalPane({ paneId, ptyKey, agent }: Props): JSX.Element {
  // Kanał PTY: dla zwykłego terminala = paneId; dla agenta osobny klucz (przekazany z AgentPane).
  const ptyId = ptyKey ?? paneId
  const hostRef = useRef<HTMLDivElement>(null)
  const ecoMode = useStore((s) => s.ecoMode)
  const vimMode = useStore((s) => s.vimMode)
  const vimTermExit = useStore((s) => s.vimTermExit)
  const vimBinds = useStore((s) => s.vimBinds)
  const activePaneId = useStore((s) => s.activePaneId)
  const markPaneDirty = useStore((s) => s.markPaneDirty)
  const setPanePty = useStore((s) => s.setPanePty)
  const autoApprove = useStore((s) => s.autoApproveIds.includes(paneId))
  const autoApproveEnabled = useStore((s) => s.autoApproveEnabled)
  const autoApproveMin = useStore((s) => s.autoApproveMin)
  const autoApproveMax = useStore((s) => s.autoApproveMax)

  const [mode, setMode] = useState<VimMode>('insert')
  const vimRef = useRef(vimMode)
  const vimTermExitRef = useRef(vimTermExit)
  const vimBindsRef = useRef(vimBinds)
  const lastEscRef = useRef(0) // znacznik ostatniego Esc (dla trybu double-esc)
  const dblRef = useRef<DoubleState>({ key: '', time: 0 }) // do podwójnego 'gg'
  const winPendingRef = useRef(false) // czeka na drugi klawisz Ctrl-w
  const winTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const modeRef = useRef<VimMode>('insert')
  const termRef = useRef<Terminal | null>(null)
  // Stan alternate screen prosto z PTY (nvim/htop). Bufor xterma po replayu bywa niewiarygodny,
  // a wtedy vim mode zjadałby klawisze programu — dlatego to źródło jest nadrzędne.
  const altRef = useRef(false)
  // Copy-mode (NORMAL): ruchomy kursor nad buforem xterm + zaznaczanie.
  const copyRef = useRef({
    cy: 0, // wiersz w buforze (absolutny, ze scrollbackiem)
    cx: 0, // kolumna
    vmode: 'none' as 'none' | 'char' | 'line',
    ay: 0, // kotwica zaznaczenia
    ax: 0,
    ready: false
  })
  vimRef.current = vimMode
  vimTermExitRef.current = vimTermExit
  vimBindsRef.current = vimBinds

  const setVim = (m: VimMode): void => {
    modeRef.current = m
    setMode(m)
    // Fokus przejmujemy tylko w aktywnym panelu. Zdarzenie 'pty:alt' leci do wszystkich paneli,
    // więc bez tego panel w tle (zostawiony w NORMAL) kradłby klawiaturę, gdy jego program
    // wchodzi w tryb pełnoekranowy.
    if (useStore.getState().activePaneId === paneId) termRef.current?.focus()
    if (m === 'insert') {
      termRef.current?.clearSelection()
      copyRef.current.ready = false // przy następnym NORMAL kursor ustawi się od nowa
      termRef.current?.scrollToBottom()
    }
    // Tryb aktywnego terminala zasila statusline.
    if (useStore.getState().activePaneId === paneId) useStore.getState().setActiveVimMode(m)
  }

  useEffect(() => {
    const host = hostRef.current
    if (!host) return

    const term = new Terminal({
      // Menlo dla tekstu; "Symbols Nerd Font Mono" jako fallback daje ikony (LazyVim itp.).
      fontFamily: 'Menlo, "DejaVu Sans Mono", "Symbols Nerd Font Mono", Consolas, monospace',
      fontSize: 13,
      cursorBlink: true,
      scrollback: ecoMode ? 500 : 2000,
      allowProposedApi: true,
      theme: {
        background: '#0e0f13',
        foreground: '#d6d9df',
        cursor: '#3b82f6',
        selectionBackground: '#264f78'
      }
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.loadAddon(new WebLinksAddon())
    term.open(host)
    termRef.current = term

    const isAlt = (): boolean => altRef.current || term.buffer.active.type === 'alternate'
    const toInsert = (): void => setVim('insert') // setVim sam przewija na dół i ustawia fokus

    // --- Copy-mode (kursor po buforze + zaznaczanie) ---
    const abuf = (): import('@xterm/xterm').IBuffer => term.buffer.active
    const lineText = (y: number): string => abuf().getLine(y)?.translateToString(true) ?? ''
    const lineLen = (y: number): number => lineText(y).replace(/\s+$/, '').length
    const clampCol = (): void => {
      const c = copyRef.current
      c.cx = Math.max(0, Math.min(c.cx, lineLen(c.cy)))
    }
    const follow = (): void => {
      const c = copyRef.current
      const vy = abuf().viewportY
      if (c.cy < vy) term.scrollToLine(c.cy)
      else if (c.cy > vy + term.rows - 1) term.scrollToLine(c.cy - term.rows + 1)
    }
    const renderCursor = (): void => {
      const c = copyRef.current
      if (c.vmode === 'line') term.selectLines(Math.min(c.ay, c.cy), Math.max(c.ay, c.cy))
      else if (c.vmode === 'char' && c.ay === c.cy) {
        const a = Math.min(c.ax, c.cx)
        term.select(a, c.cy, Math.abs(c.cx - c.ax) + 1)
      } else if (c.vmode === 'char') {
        // zaznaczenie znakowe przez wiele linii → padamy na liniowe (API xterma jest per-wiersz)
        term.selectLines(Math.min(c.ay, c.cy), Math.max(c.ay, c.cy))
      } else {
        term.select(c.cx, c.cy, 1) // kursor = podświetlona 1 komórka
      }
      follow()
    }
    const initCursor = (): void => {
      const b = abuf()
      const c = copyRef.current
      c.cy = b.baseY + b.cursorY // start tam, gdzie jest kursor terminala (prompt)
      c.cx = b.cursorX
      c.vmode = 'none'
      c.ready = true
      clampCol()
      renderCursor()
    }
    const isWord = (ch: string): boolean => /\w/.test(ch)
    const wordNext = (): void => {
      const c = copyRef.current
      const t = lineText(c.cy)
      let i = c.cx
      while (i < t.length && isWord(t[i])) i++
      while (i < t.length && !isWord(t[i])) i++
      if (i >= lineLen(c.cy) && c.cy < abuf().length - 1) {
        c.cy++
        c.cx = 0
      } else c.cx = i
    }
    const wordPrev = (): void => {
      const c = copyRef.current
      if (c.cx === 0 && c.cy > 0) {
        c.cy--
        c.cx = lineLen(c.cy)
        return
      }
      const t = lineText(c.cy)
      let i = c.cx - 1
      while (i > 0 && !isWord(t[i])) i--
      while (i > 0 && isWord(t[i - 1])) i--
      c.cx = Math.max(0, i)
    }
    const wordEnd = (): void => {
      const c = copyRef.current
      const t = lineText(c.cy)
      let i = c.cx + 1
      while (i < t.length && !isWord(t[i])) i++
      while (i < t.length - 1 && isWord(t[i + 1])) i++
      c.cx = Math.min(lineLen(c.cy), i)
    }

    // Klawiatura w trybie NORMAL: nawigacja zamiast wejścia do PTY.
    term.attachCustomKeyEventHandler((e: KeyboardEvent): boolean => {
      if (e.type !== 'keydown') return true
      if (!vimRef.current || isAlt()) return true

      // Wyjście INSERT->NORMAL zależne od ustawienia (konflikt z Esc w Neovim itp.).
      if (e.key === 'Escape' && !e.metaKey && !e.ctrlKey && !e.altKey) {
        // W NORMAL: Esc najpierw zdejmuje zaznaczenie (visual), dopiero potem wraca do INSERT.
        if (modeRef.current === 'normal') {
          e.preventDefault()
          if (copyRef.current.ready && copyRef.current.vmode !== 'none') {
            copyRef.current.vmode = 'none'
            renderCursor()
          } else {
            setVim('insert')
          }
          return false
        }
        // INSERT -> NORMAL: podwójny Esc (pierwszy leci do programu) albo pojedynczy.
        if (vimTermExitRef.current === 'double-esc') {
          const now = Date.now()
          if (now - lastEscRef.current < 400) {
            lastEscRef.current = 0
            e.preventDefault()
            setVim('normal')
            return false
          }
          lastEscRef.current = now
          return true // pierwszy Esc leci do PTY (program dostaje swój Escape)
        }
        e.preventDefault() // 'esc': bez tego znak trafiłby przez textarea xterma do PTY
        setVim('normal')
        return false
      }
      // W INSERT piszemy normalnie (przepuszczamy wszystko do PTY).
      if (modeRef.current !== 'normal') return true

      const vb = vimBindsRef.current
      const dbl = dblRef.current
      const half = Math.max(1, Math.floor(term.rows / 2))

      // Prefiks Ctrl-w: czekamy na drugi klawisz (nawigacja oknami).
      if (winPendingRef.current) {
        const act = WIN_MOTION_IDS.find((id) => matchVimKey(vb[id], e))
        winPendingRef.current = false
        if (winTimerRef.current) clearTimeout(winTimerRef.current)
        clearWinPending()
        if (act) runWindowMotion(act)
        e.preventDefault()
        return false
      }
      if (matchVimKey(vb['win.prefix'], e)) {
        winPendingRef.current = true
        armWinPending()
        if (winTimerRef.current) clearTimeout(winTimerRef.current)
        winTimerRef.current = setTimeout(() => (winPendingRef.current = false), 2200)
        e.preventDefault()
        return false
      }

      // ⌘/⌥-skróty przepuszczamy (kopiowanie, bindy programu). Zmapowane C-* łapiemy niżej.
      if (e.metaKey || e.altKey) return true

      // Copy-mode: leniwa inicjalizacja kursora przy wejściu w NORMAL.
      if (!copyRef.current.ready) initCursor()
      const c = copyRef.current
      const act = (fn: () => void): boolean => {
        fn()
        renderCursor()
        e.preventDefault()
        return false
      }

      // Yank: zaznaczenie (lub bieżąca linia, gdy brak zaznaczenia) → schowek.
      if (matchVimKey(vb['term.yank'], e, dbl)) {
        const text = c.vmode === 'none' ? lineText(c.cy) : term.getSelection()
        if (text) navigator.clipboard?.writeText(text).catch(() => {})
        c.vmode = 'none'
        return act(() => {})
      }
      // Zaznaczanie (toggle).
      if (matchVimKey(vb['term.visual'], e, dbl))
        return act(() => {
          if (c.vmode === 'char') c.vmode = 'none'
          else {
            c.vmode = 'char'
            c.ay = c.cy
            c.ax = c.cx
          }
        })
      if (matchVimKey(vb['term.visualLine'], e, dbl))
        return act(() => {
          if (c.vmode === 'line') c.vmode = 'none'
          else {
            c.vmode = 'line'
            c.ay = c.cy
            c.ax = c.cx
          }
        })
      // Ruch kursora (viewport sam podąża).
      if (matchVimKey(vb['term.down'], e, dbl))
        return act(() => {
          c.cy = Math.min(abuf().length - 1, c.cy + 1)
          clampCol()
        })
      if (matchVimKey(vb['term.up'], e, dbl))
        return act(() => {
          c.cy = Math.max(0, c.cy - 1)
          clampCol()
        })
      if (matchVimKey(vb['term.left'], e, dbl)) return act(() => (c.cx = Math.max(0, c.cx - 1)))
      if (matchVimKey(vb['term.right'], e, dbl))
        return act(() => (c.cx = Math.min(lineLen(c.cy), c.cx + 1)))
      if (matchVimKey(vb['term.halfDown'], e, dbl))
        return act(() => {
          c.cy = Math.min(abuf().length - 1, c.cy + half)
          clampCol()
        })
      if (matchVimKey(vb['term.halfUp'], e, dbl))
        return act(() => {
          c.cy = Math.max(0, c.cy - half)
          clampCol()
        })
      if (matchVimKey(vb['term.wordNext'], e, dbl)) return act(wordNext)
      if (matchVimKey(vb['term.wordPrev'], e, dbl)) return act(wordPrev)
      if (matchVimKey(vb['term.wordEnd'], e, dbl)) return act(wordEnd)
      if (matchVimKey(vb['term.lineStart'], e, dbl)) return act(() => (c.cx = 0))
      if (matchVimKey(vb['term.lineEnd'], e, dbl)) return act(() => (c.cx = lineLen(c.cy)))
      if (matchVimKey(vb['term.top'], e, dbl))
        return act(() => {
          c.cy = 0
          c.cx = 0
        })
      if (matchVimKey(vb['term.bottom'], e, dbl))
        return act(() => {
          c.cy = abuf().length - 1
          clampCol()
        })
      // Wejście w INSERT (bez renderCursor — setVim czyści zaznaczenie).
      if (matchVimKey(vb['term.insert'], e, dbl) || e.key === 'a' || e.key === 'o' || e.key === 'Enter') {
        toInsert()
        e.preventDefault()
        return false
      }

      // Niezmapowane kombinacje z Ctrl (np. Ctrl+C kopiowanie) przepuszczamy do PTY.
      if (e.ctrlKey) return true
      // Pierwsze wciśnięcie podwójnego tokenu ('g' z 'gg') — połykamy, czekając na drugie.
      if (isDoubleFirst(e, [vb['term.top']])) {
        e.preventDefault()
        return false
      }
      // Reszta klawiszy w NORMAL: blokujemy (ochrona shella przed przypadkowym pisaniem).
      e.preventDefault()
      return false
    })

    const doFit = (): void => {
      // Ukryty workspace ma rozmiar 0 — nie dopasowujemy (inaczej PTY zwęziłoby się do 1x1).
      if (!host.clientWidth || !host.clientHeight) return
      try {
        fit.fit()
        window.api.pty.resize(ptyId, term.cols, term.rows)
      } catch {
        /* kontener może mieć chwilowo rozmiar 0 */
      }
    }
    doFit()

    // Subskrybujemy dane PTY ZANIM wywołamy ensure — main odsyła pełny bufor (replay)
    // dopiero po naszej subskrypcji, więc nie zgubimy historii.
    const offData = window.api.pty.onData(({ id, data }) => {
      if (id === ptyId) term.write(data)
    })
    const offAlt = window.api.pty.onAlt(({ id, alt }) => {
      if (id !== ptyId) return
      altRef.current = alt
      // Program pełnoekranowy przejmuje klawiaturę — wychodzimy z NORMAL, by go nie blokować.
      if (alt && modeRef.current === 'normal') setVim('insert')
    })

    setPanePty(paneId, ptyId)
    window.api.pty.ensure(ptyId, {
      cols: term.cols,
      rows: term.rows,
      cwd: agent?.cwd,
      agent: agent
        ? { profileId: agent.profileId, toolId: agent.toolId, apiKey: agent.apiKey, ssh: agent.ssh }
        : undefined
    })
      // Sesja mogła już działać w nvimie (remount). Ustawiamy tylko „włączone" — wyłączenie
      // przyjdzie zdarzeniem, więc odpowiedź ensure nie nadpisze świeższego stanu.
      .then((r) => {
        if (r.alt) altRef.current = true
      })
      .catch(() => {})

    const onInput = term.onData((data) => {
      window.api.pty.input(ptyId, data)
      markPaneDirty(paneId)
    })

    // Przewinięcie myszą w górę => NORMAL (oglądasz historię, nie piszesz).
    const onWheel = (e: WheelEvent): void => {
      if (vimRef.current && !isAlt() && e.deltaY < 0 && modeRef.current === 'insert') setVim('normal')
    }
    host.addEventListener('wheel', onWheel, { passive: true })

    // Zaznaczenie tekstu => NORMAL (chroni przed wpisaniem do shella).
    const onSel = term.onSelectionChange(() => {
      if (vimRef.current && !isAlt() && term.hasSelection() && modeRef.current === 'insert')
        setVim('normal')
    })

    const ro = new ResizeObserver(() => doFit())
    ro.observe(host)

    return () => {
      // Tylko czyścimy widok — NIE killujemy PTY (może działać w tle).
      offData()
      offAlt()
      onInput.dispose()
      onSel.dispose()
      host.removeEventListener('wheel', onWheel)
      ro.disconnect()
      term.dispose()
      termRef.current = null
    }
  }, [paneId, ecoMode, markPaneDirty, setPanePty])

  // Gdy ten panel staje się aktywny (np. po skrócie ⌘N), przejmij fokus klawiatury —
  // inaczej pisanie trafiałoby wciąż do poprzedniego terminala.
  useEffect(() => {
    if (activePaneId === paneId) {
      termRef.current?.focus()
      useStore.getState().setActiveVimMode(modeRef.current)
    }
  }, [activePaneId, paneId])

  // Auto-approve: gdy włączony główny przełącznik i ten terminal jest na liście, co losowy odstęp
  // (min–max sek) wysyłamy Enter do PTY — auto-zatwierdza prompty typu „approve? [y/N]". Działa też
  // w tle (PTY żyje niezależnie od fokusu). Klucz PTY = paneId (setPanePty(paneId, paneId) niżej).
  useEffect(() => {
    if (!autoApprove || !autoApproveEnabled) return
    let timer: ReturnType<typeof setTimeout>
    const press = (): void => {
      window.api.pty.input(ptyId, '\r')
      schedule()
    }
    const schedule = (): void => {
      const min = Math.max(1, autoApproveMin)
      const max = Math.max(min, autoApproveMax)
      const delay = (min + Math.random() * (max - min)) * 1000
      timer = setTimeout(press, delay)
    }
    schedule()
    return () => clearTimeout(timer)
  }, [autoApprove, autoApproveEnabled, autoApproveMin, autoApproveMax, paneId])

  // Wyszukiwanie (Ctrl/⌘+F) w buforze xterm: zbieramy trafienia, zaznaczamy i przewijamy. Brak
  // dodatkowego addona — skanujemy linie bufora i używamy term.select + scrollToLine.
  useEffect(() => {
    const find = { matches: [] as { y: number; x: number }[], idx: -1, q: '' }
    const collect = (q: string): void => {
      find.matches = []
      find.idx = -1
      find.q = q
      const t = termRef.current
      if (!t || !q) return
      const buf = t.buffer.active
      const ql = q.toLowerCase()
      for (let y = 0; y < buf.length; y++) {
        const line = buf.getLine(y)?.translateToString(true) ?? ''
        const lower = line.toLowerCase()
        let i = lower.indexOf(ql)
        while (i !== -1) {
          find.matches.push({ y, x: i })
          i = lower.indexOf(ql, i + ql.length)
        }
      }
    }
    const show = (): void => {
      const t = termRef.current
      const m = find.matches[find.idx]
      if (!t || !m) return
      t.select(m.x, m.y, find.q.length)
      t.scrollToLine(Math.max(0, m.y - Math.floor(t.rows / 2)))
    }
    const onFind = (e: Event): void => {
      const d = (e as CustomEvent<FindDetail>).detail
      if (d.inNotes || d.paneId !== paneId) return
      const t = termRef.current
      if (!t) return
      if (d.type === 'close') {
        t.clearSelection()
        return
      }
      if (d.type === 'query') {
        collect(d.query)
        find.idx = find.matches.length ? 0 : -1
        show()
      } else if (find.matches.length) {
        find.idx =
          d.type === 'next'
            ? (find.idx + 1) % find.matches.length
            : (find.idx - 1 + find.matches.length) % find.matches.length
        show()
      }
    }
    window.addEventListener(FIND_EVENT, onFind)
    return () => window.removeEventListener(FIND_EVENT, onFind)
  }, [paneId])

  return (
    <div className="terminal-wrap">
      <div className="terminal-host" ref={hostRef} />
      {vimMode && (
        <button
          className={'vim-badge vim-badge--' + mode}
          onClick={() => setVim(mode === 'normal' ? 'insert' : 'normal')}
          title="Vim mode — click to toggle (i = insert)"
        >
          {mode === 'normal' ? 'NORMAL' : 'INSERT'}
        </button>
      )}
    </div>
  )
}
