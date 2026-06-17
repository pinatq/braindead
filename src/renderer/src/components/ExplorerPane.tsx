import { useCallback, useEffect, useRef, useState } from 'react'
import { useStore } from '../state/store'
import type { DirEntry, DirListing } from '../../../shared/types'
import { matchVimKey, WIN_MOTION_IDS, type DoubleState } from '../../../shared/vimKeys'
import {
  armWinPending,
  clearWinPending,
  runWindowMotion,
  EXPLORER_CMD_EVENT
} from '../shortcuts/dispatch'
import { FIND_EVENT, type FindDetail } from '../shortcuts/find'

interface Props {
  paneId: string
}

type Conn = { id: string; label: string }

/**
 * Eksplorator plików (4. tryb panelu) — lokalny LUB zdalny (SSH/SFTP). Pasek: ◀ ▶ ⌂ + ścieżka +
 * SSH. Lista folderów/plików; vim: j/k ruch, l/Enter wejdź/otwórz, h/Backspace wyżej, gg/G skraj,
 * o→viewer, n→notes, D usuń, N/F nowy folder/plik. Prawy klik = menu (też „nowy" na pustym miejscu).
 */
export default function ExplorerPane({ paneId }: Props): JSX.Element {
  const setActivePane = useStore((s) => s.setActivePane)
  const openFileInPane = useStore((s) => s.openFileInPane)
  const addNotesFile = useStore((s) => s.addNotesFile)

  const [listing, setListing] = useState<DirListing | null>(null)
  const [sel, setSel] = useState(0)
  const [pathText, setPathText] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [sugg, setSugg] = useState<DirEntry[]>([])
  const [menu, setMenu] = useState<{ x: number; y: number; entry: DirEntry | null } | null>(null)
  const [conn, setConn] = useState<Conn | null>(null)
  const [connecting, setConnecting] = useState(false)
  const [sshOpen, setSshOpen] = useState(false) // rozwinięta lista zapisanych połączeń SSH
  const [creating, setCreating] = useState<null | 'dir' | 'file'>(null)
  const [newName, setNewName] = useState('')
  const [dots, setDots] = useState(1) // animacja „connecting…"

  const boxRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const pathRef = useRef<HTMLInputElement>(null)
  const hist = useRef<{ stack: string[]; idx: number }>({ stack: [], idx: -1 })
  const dblRef = useRef<DoubleState>({ key: '', time: 0 })
  const winPendingRef = useRef(false)
  const winTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const suggTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const listingRef = useRef<DirListing | null>(null)
  const selRef = useRef(0)
  const connRef = useRef<Conn | null>(null)
  const newNameRef = useRef<HTMLInputElement>(null)
  const creatingRef = useRef<null | 'dir' | 'file'>(null)
  const activePaneId = useStore((s) => s.activePaneId)
  const sshConns = useStore((s) => s.sshConns)
  listingRef.current = listing
  selRef.current = sel
  connRef.current = conn
  creatingRef.current = creating

  // Fokus na inline-input przy rozpoczęciu tworzenia folderu/pliku.
  useEffect(() => {
    if (creating) newNameRef.current?.focus()
  }, [creating])

  // Animacja kropek „connecting." → ".." → "..." podczas łączenia SSH.
  useEffect(() => {
    if (!connecting) return
    setDots(1)
    const t = setInterval(() => setDots((d) => (d % 3) + 1), 350)
    return () => clearInterval(t)
  }, [connecting])

  // Operacje na plikach — lokalnie albo przez SFTP (gdy podłączeni do SSH). Czytają connRef,
  // więc callbacki niżej mogą być stabilne (puste deps).
  const fsReadDir = (p: string): Promise<DirListing> => {
    const c = connRef.current
    return c ? window.api.ssh.readDir(c.id, p) : window.api.files.readDir(p)
  }
  const fsRead = (p: string): ReturnType<typeof window.api.files.read> => {
    const c = connRef.current
    return c ? window.api.ssh.readFile(c.id, p) : window.api.files.read(p)
  }

  const load = useCallback(async (p: string, push = true): Promise<void> => {
    try {
      const l = await fsReadDir(p)
      setListing(l)
      setPathText(l.path)
      setSel(0)
      setErr(null)
      setSugg([])
      if (push) {
        const h = hist.current
        h.stack = h.stack.slice(0, h.idx + 1)
        h.stack.push(l.path)
        h.idx = h.stack.length - 1
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    }
  }, [])

  useEffect(() => {
    load('') // start: katalog domowy
  }, [load])

  useEffect(() => {
    if (activePaneId === paneId) boxRef.current?.focus()
  }, [activePaneId, paneId])

  useEffect(() => {
    listRef.current?.querySelector('.explorer-row--sel')?.scrollIntoView({ block: 'nearest' })
  }, [sel, listing])

  // Zamknij menu kontekstowe / dropdown SSH klikiem gdziekolwiek.
  useEffect(() => {
    if (!menu && !sshOpen) return
    const close = (): void => {
      setMenu(null)
      setSshOpen(false)
    }
    window.addEventListener('mousedown', close)
    return () => window.removeEventListener('mousedown', close)
  }, [menu, sshOpen])

  // Podpowiedzi katalogów podczas pisania ścieżki (debounce) — działa też zdalnie.
  const updateSugg = useCallback((txt: string): void => {
    if (suggTimer.current) clearTimeout(suggTimer.current)
    suggTimer.current = setTimeout(async () => {
      const slash = Math.max(txt.lastIndexOf('/'), txt.lastIndexOf('\\'))
      const dir = slash >= 0 ? txt.slice(0, slash + 1) : txt
      const base = (slash >= 0 ? txt.slice(slash + 1) : '').toLowerCase()
      try {
        const l = await fsReadDir(dir || '~')
        setSugg(
          l.entries.filter((e) => e.isDir && e.name.toLowerCase().startsWith(base)).slice(0, 8)
        )
      } catch {
        setSugg([])
      }
    }, 140)
  }, [])

  const openEntry = useCallback(
    (e: DirEntry): void => {
      if (e.isDir) load(e.path)
      else openFileInPane(paneId, e.path, connRef.current?.id)
    },
    [load, openFileInPane, paneId]
  )

  // „Open in viewer" → wrzuca plik do INNEGO panelu-viewera (jeśli jest otwarty), inaczej w swój.
  const openInViewer = useCallback(
    (e: DirEntry): void => {
      if (e.isDir) return
      const st = useStore.getState()
      const ws = st.workspaces[st.current]
      const target = ws?.panes.find((p) => p.id !== paneId && p.mode === 'viewer')
      openFileInPane(target?.id ?? paneId, e.path, connRef.current?.id)
    },
    [openFileInPane, paneId]
  )

  const sendToNotes = useCallback(
    async (e: DirEntry): Promise<void> => {
      if (e.isDir) return
      const f = await fsRead(e.path)
      const nf = await window.api.files.saveAttachment(f.name, f.base64)
      addNotesFile(nf)
      if (!useStore.getState().notesOpen) useStore.getState().toggleNotes()
    },
    [addNotesFile]
  )

  const del = useCallback(
    async (e: DirEntry): Promise<void> => {
      const what = e.isDir ? 'folder' : 'file'
      if (!confirm(`Delete this ${what}?\n${e.path}`)) return
      const c = connRef.current
      const r = c ? await window.api.ssh.delete(c.id, e.path) : await window.api.files.deletePath(e.path)
      if (!r.ok) {
        alert('Delete failed: ' + (r.error ?? 'unknown'))
        return
      }
      const l = listingRef.current
      if (l) load(l.path, false)
    },
    [load]
  )

  // Rozpoczyna tworzenie folderu/pliku — pokazuje inline input (window.prompt NIE działa w Electronie).
  const createEntry = useCallback((kind: 'dir' | 'file'): void => {
    setMenu(null)
    setNewName('')
    setCreating(kind)
  }, [])

  // Zatwierdza tworzenie wpisaną nazwą (Enter) — lokalnie albo zdalnie przez SFTP.
  const commitCreate = useCallback(async (): Promise<void> => {
    const l = listingRef.current
    const kind = creatingRef.current
    const name = newNameRef.current?.value.trim()
    if (!l || !kind || !name) {
      setCreating(null)
      return
    }
    const c = connRef.current
    const r =
      kind === 'dir'
        ? c
          ? await window.api.ssh.makeDir(c.id, l.path, name)
          : await window.api.files.makeDir(l.path, name)
        : c
          ? await window.api.ssh.makeFile(c.id, l.path, name)
          : await window.api.files.makeFile(l.path, name)
    setCreating(null)
    if (!r.ok) {
      alert((kind === 'dir' ? 'Create folder failed: ' : 'Create file failed: ') + (r.error ?? 'unknown'))
      return
    }
    load(l.path, false)
  }, [load])

  const goParent = useCallback((): void => {
    const l = listingRef.current
    if (l?.parent) load(l.parent)
  }, [load])

  const back = useCallback((): void => {
    const h = hist.current
    if (h.idx > 0) {
      h.idx--
      load(h.stack[h.idx], false)
    }
  }, [load])
  const fwd = useCallback((): void => {
    const h = hist.current
    if (h.idx < h.stack.length - 1) {
      h.idx++
      load(h.stack[h.idx], false)
    }
  }, [load])

  // --- SSH --- łączy z zapisanego połączenia (zakładka SSH w ustawieniach). Tylko komenda
  // (auth = klucz z ~/.ssh/config lub agent SSH).
  const connectTo = useCallback(
    async (c: { command: string; name: string }): Promise<void> => {
      setSshOpen(false)
      setErr(null)
      setConnecting(true) // pasek adresu pokaże „connecting…"
      const res = await window.api.ssh.connect({ command: c.command })
      setConnecting(false)
      if (!res.ok || !res.id) {
        setErr('SSH: ' + (res.error ?? 'connection failed'))
        return
      }
      hist.current = { stack: [], idx: -1 }
      const next = { id: res.id, label: res.label ?? c.name }
      connRef.current = next // synchronicznie, by readDir poszedł od razu przez SFTP
      setConn(next)
      load(res.home ?? '') // od razu pokaż katalog domowy zdalnego serwera
    },
    [load]
  )

  const disconnect = useCallback((): void => {
    const c = connRef.current
    if (c) window.api.ssh.disconnect(c.id)
    connRef.current = null
    setConn(null)
    hist.current = { stack: [], idx: -1 }
    load('') // wróć do lokalnego katalogu domowego
  }, [load])

  // Globalne skróty eksploratora (Ustawienia → Shortcuts) — działają też bez vim mode.
  useEffect(() => {
    const onCmd = (e: Event): void => {
      if (useStore.getState().activePaneId !== paneId) return
      const cmd = (e as CustomEvent).detail as string
      if (cmd === 'back') back()
      else if (cmd === 'forward') fwd()
      else if (cmd === 'home') load('')
      else if (cmd === 'newFolder') createEntry('dir')
      else if (cmd === 'newFile') createEntry('file')
      else if (cmd === 'focusPath') {
        pathRef.current?.focus()
        pathRef.current?.select()
      }
    }
    window.addEventListener(EXPLORER_CMD_EVENT, onCmd)
    return () => window.removeEventListener(EXPLORER_CMD_EVENT, onCmd)
  }, [paneId, back, fwd, load, createEntry])

  // Wyszukiwanie (Ctrl/⌘+F) w eksploratorze — skok do wpisu, którego nazwa zawiera frazę.
  const findRef = useRef<{ matches: number[]; idx: number }>({ matches: [], idx: -1 })
  useEffect(() => {
    const onFind = (e: Event): void => {
      const d = (e as CustomEvent<FindDetail>).detail
      if (d.inNotes || d.paneId !== paneId) return
      if (d.type === 'close') return
      const entries = listingRef.current?.entries ?? []
      const f = findRef.current
      if (d.type === 'query') {
        const q = d.query.toLowerCase()
        f.matches = q ? entries.map((e, i) => (e.name.toLowerCase().includes(q) ? i : -1)).filter((i) => i >= 0) : []
        f.idx = f.matches.length ? 0 : -1
      } else if (f.matches.length) {
        f.idx =
          d.type === 'next'
            ? (f.idx + 1) % f.matches.length
            : (f.idx - 1 + f.matches.length) % f.matches.length
      }
      if (f.idx >= 0) setSel(f.matches[f.idx])
    }
    window.addEventListener(FIND_EVENT, onFind)
    return () => window.removeEventListener(FIND_EVENT, onFind)
  }, [paneId])

  const onKey = (e: React.KeyboardEvent): void => {
    if (document.activeElement === pathRef.current) return // pisanie ścieżki — nie przejmujemy
    const st = useStore.getState()
    const vb = st.vimBinds
    const vimOn = st.vimMode
    const l = listingRef.current
    const n = l?.entries.length ?? 0
    const ev = e.nativeEvent

    // Ctrl-w: nawigacja oknami.
    if (winPendingRef.current) {
      winPendingRef.current = false
      if (winTimerRef.current) clearTimeout(winTimerRef.current)
      const act = WIN_MOTION_IDS.find((id) => matchVimKey(vb[id], ev))
      clearWinPending()
      if (act) runWindowMotion(act)
      e.preventDefault()
      return
    }
    if (vimOn && matchVimKey(vb['win.prefix'], ev)) {
      winPendingRef.current = true
      armWinPending()
      if (winTimerRef.current) clearTimeout(winTimerRef.current)
      winTimerRef.current = setTimeout(() => (winPendingRef.current = false), 2200)
      e.preventDefault()
      return
    }
    if (e.metaKey || e.ctrlKey || e.altKey) return

    const k = e.key
    const s = (id: string): boolean => vimOn && matchVimKey(vb[id], ev, dblRef.current)
    const cur = (): DirEntry | undefined => l?.entries[selRef.current]
    const down = k === 'ArrowDown' || s(`explorer.down`)
    const up = k === 'ArrowUp' || s(`explorer.up`)
    const open = k === 'Enter' || k === 'ArrowRight' || s(`explorer.open`)
    const parent = k === 'Backspace' || k === 'ArrowLeft' || s(`explorer.parent`)
    const top = k === 'Home' || s(`explorer.top`)
    const bottom = k === 'End' || s(`explorer.bottom`)

    if (down) setSel((s) => Math.min(n - 1, s + 1))
    else if (up) setSel((s) => Math.max(0, s - 1))
    else if (top) setSel(0)
    else if (bottom) setSel(Math.max(0, n - 1))
    else if (parent) goParent()
    else if (open) {
      const c = cur()
      if (c) openEntry(c)
    } else if (s(`explorer.toViewer`)) {
      const c = cur()
      if (c) openInViewer(c)
    } else if (s(`explorer.toNotes`)) {
      const c = cur()
      if (c) sendToNotes(c)
    } else if (s(`explorer.delete`)) {
      const c = cur()
      if (c) del(c)
    } else if (s(`explorer.newFolder`)) createEntry('dir')
    else if (s(`explorer.newFile`)) createEntry('file')
    else if (s(`explorer.address`)) {
      pathRef.current?.focus()
      pathRef.current?.select()
    } else if (s(`explorer.back`)) back()
    else if (s(`explorer.forward`)) fwd()
    else if (s(`explorer.home`)) load('')
    else return
    e.preventDefault()
  }

  const onRowDrag = (e: React.DragEvent, entry: DirEntry): void => {
    // Format zgodny z viewerem i przyciskiem Notes — przeciągnij plik tam. (Tylko lokalne pliki.)
    if (connRef.current) return
    e.dataTransfer.setData('application/x-vibe-file', JSON.stringify({ name: entry.name, path: entry.path }))
    e.dataTransfer.effectAllowed = 'copy'
  }

  return (
    <div
      className="explorer-pane"
      ref={boxRef}
      tabIndex={0}
      onKeyDown={onKey}
      onMouseDown={() => setActivePane(paneId)}
    >
      <div className="explorer-bar">
        <button data-tip="Back" disabled={hist.current.idx <= 0} onClick={back}>
          ‹
        </button>
        <button
          data-tip="Forward"
          disabled={hist.current.idx >= hist.current.stack.length - 1}
          onClick={fwd}
        >
          ›
        </button>
        <button data-tip="Home (~)" onClick={() => load('')}>
          ⌂
        </button>
        <div className="explorer-pathwrap">
          <input
            ref={pathRef}
            className={'explorer-path' + (connecting ? ' explorer-path--connecting' : '')}
            value={connecting ? 'connecting' + '.'.repeat(dots) : pathText}
            readOnly={connecting}
            spellCheck={false}
            placeholder={conn ? `${conn.label}:/path` : '~/path/to/folder'}
            onChange={(e) => {
              setPathText(e.target.value)
              updateSugg(e.target.value)
            }}
            onFocus={(e) => updateSugg(e.target.value)}
            onBlur={() => setTimeout(() => setSugg([]), 120)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                if (sugg[0] && pathText && !pathText.endsWith('/')) load(sugg[0].path)
                else load(pathText)
              } else if (e.key === 'Tab') {
                e.preventDefault()
                if (sugg[0]) setPathText(sugg[0].path)
              } else if (e.key === 'Escape') boxRef.current?.focus()
            }}
          />
          {sugg.length > 0 && (
            <div className="explorer-sugg">
              {sugg.map((s) => (
                <div
                  key={s.path}
                  className="explorer-sugg-row"
                  onMouseDown={(e) => {
                    e.preventDefault()
                    load(s.path)
                  }}
                >
                  📁 {s.name}
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="explorer-sshwrap" onMouseDown={(e) => e.stopPropagation()}>
          {conn ? (
            <button className="explorer-ssh explorer-ssh--on" data-tip={`Disconnect ${conn.label}`} onClick={disconnect}>
              ⦿ {conn.label}
            </button>
          ) : (
            <button
              className="explorer-ssh"
              data-tip="Connect over SSH"
              disabled={connecting}
              onClick={() => {
                // Jedno zapisane połączenie → łączymy od razu; więcej → lista; brak → podpowiedź.
                if (sshConns.length === 1) connectTo(sshConns[0])
                else setSshOpen((v) => !v)
              }}
            >
              {connecting ? '…' : 'SSH'}
            </button>
          )}
          {sshOpen && !conn && (
            <div className="explorer-ssh-menu">
              {sshConns.length === 0 ? (
                <div className="explorer-ssh-empty">No SSH connections — configure in Settings → SSH.</div>
              ) : (
                sshConns.map((c) => (
                  <button key={c.id} onClick={() => connectTo(c)} title={c.command}>
                    ⦿ {c.name}
                  </button>
                ))
              )}
              <button
                className="explorer-ssh-cfg"
                onClick={() => {
                  setSshOpen(false)
                  useStore.getState().openSettingsTab('ssh')
                }}
              >
                ⚙ Configure in Settings → SSH
              </button>
            </div>
          )}
        </div>
      </div>

      <div
        className="explorer-list"
        ref={listRef}
        onContextMenu={(ev) => {
          // Prawy klik na pustym obszarze → menu „nowy folder/plik" w bieżącym katalogu.
          if ((ev.target as HTMLElement).closest('.explorer-row')) return
          ev.preventDefault()
          setMenu({ x: ev.clientX, y: ev.clientY, entry: null })
        }}
      >
        {err && <div className="explorer-msg explorer-msg--err">⚠ {err}</div>}
        {!err && listing && listing.entries.length === 0 && (
          <div className="explorer-msg">(empty folder — right-click to create)</div>
        )}
        {!err && !listing && <div className="explorer-msg">Loading…</div>}

        {creating && (
          <div className="explorer-row explorer-row--new">
            <span className="explorer-ico">{creating === 'dir' ? '📁' : '📄'}</span>
            <input
              ref={newNameRef}
              className="explorer-newname"
              value={newName}
              spellCheck={false}
              placeholder={creating === 'dir' ? 'new folder name…' : 'new file name…'}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitCreate()
                else if (e.key === 'Escape') {
                  setCreating(null)
                  boxRef.current?.focus()
                }
              }}
              onBlur={() => setCreating(null)}
            />
          </div>
        )}

        {listing?.parent && (
          <div className="explorer-row explorer-row--up" onClick={goParent}>
            <span className="explorer-ico">📁</span>
            <span className="explorer-name">..</span>
          </div>
        )}
        {listing?.entries.map((e, i) => (
          <div
            key={e.path}
            className={'explorer-row' + (i === sel ? ' explorer-row--sel' : '')}
            draggable={!conn}
            onDragStart={(ev) => onRowDrag(ev, e)}
            onMouseDown={() => setSel(i)}
            onDoubleClick={() => openEntry(e)}
            onContextMenu={(ev) => {
              ev.preventDefault()
              ev.stopPropagation()
              setSel(i)
              setMenu({ x: ev.clientX, y: ev.clientY, entry: e })
            }}
          >
            <span className="explorer-ico">{e.isDir ? '📁' : '📄'}</span>
            <span className="explorer-name">{e.name}</span>
          </div>
        ))}
      </div>

      {menu && (
        // stopPropagation na mousedown: bez tego globalny listener zamykał menu PRZED kliknięciem
        // (mousedown → setMenu(null) → przycisk znika → onClick nie pada). Każda akcja zamyka menu.
        <div
          className="explorer-menu"
          style={{ left: menu.x, top: menu.y }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          {menu.entry && (
            <>
              <button onClick={() => { openEntry(menu.entry!); setMenu(null) }}>
                {menu.entry.isDir ? 'Open folder' : 'Open'}
              </button>
              {!menu.entry.isDir && (
                <button onClick={() => { openInViewer(menu.entry!); setMenu(null) }}>
                  Open in viewer
                </button>
              )}
              {!menu.entry.isDir && !conn && (
                <button onClick={() => { sendToNotes(menu.entry!); setMenu(null) }}>Send to notes</button>
              )}
            </>
          )}
          <button onClick={() => createEntry('dir')}>New folder</button>
          <button onClick={() => createEntry('file')}>New file</button>
          {menu.entry && (
            <button className="explorer-menu-del" onClick={() => { del(menu.entry!); setMenu(null) }}>
              Delete
            </button>
          )}
        </div>
      )}
    </div>
  )
}
