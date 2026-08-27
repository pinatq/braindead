import { useCallback, useEffect, useMemo, useRef, useState, type JSX } from 'react'
import { useStore, isRamOver, uiOverlayOpen } from '../state/store'
import { actionForCombo } from '../shortcuts/binds'
import { PANE_CMD_EVENT, runBind, runWindowMotion, armWinPending, type PaneCmd } from '../shortcuts/dispatch'
import { FIND_EVENT, type FindDetail } from '../shortcuts/find'

const NEW_TAB_URL = 'https://duckduckgo.com'

// PORT TAURI (natywne webview WKWebView zamiast Electronowego <webview>). Ekwiwalent preloadu
// <webview> z master działa jako initialization_script wstrzykiwany do każdego natywnego
// widoku (src-tauri/src/browser_script.rs) — obsługuje: środkowy klik/⌘-klik w link → nowa
// karta, klik w treść → aktywacja panelu, bindy programu z priorytetem nad stroną, klawisze
// vima (scroll/hinty/okna) oraz ':' → pasek adresu. Find-in-page z master (natywne findInPage)
// portujemy przez `window.find()` wstrzykiwanym pane_eval. Znane ograniczenia portu:
// - historia wstecz/dalej liczona ręcznie (WKWebView nie zdradza canGoBack/canGoForward);
//   wstrzyknięty skrypt raportuje też nawigacje SPA, żeby pasek adresu nie został w tyle.

interface Props {
  paneId: string
  url: string
}

// Skrypt auto-scrolla wstrzykiwany do strony: znajduje najbliższy przewijalny kontener pod
// środkiem ekranu i przewija go o ~wysokość okna. Dla reels/shorts (scroll-snap) to przeskakuje
// do następnego klipu; dla zwykłych stron po prostu przewija o ekran. Bezpośredni scroll działa
// tam, gdzie syntetyczna strzałka nie ruszała snap-kontenerów.
const AUTOSCROLL_JS = `(() => {
  try {
    const h = window.innerHeight;
    const canScroll = (n) => n && n.scrollHeight > n.clientHeight + 4 &&
      /(auto|scroll)/.test(getComputedStyle(n).overflowY);
    let el = document.elementFromPoint(window.innerWidth / 2, h / 2);
    while (el && !canScroll(el)) el = el.parentElement;
    const target = el || document.scrollingElement || document.documentElement;
    target.scrollBy(0, Math.round(h * 0.92));
  } catch (e) { /* strona jeszcze nie gotowa */ }
})()`

interface Tab {
  id: string
  url: string // bieżący adres (do paska i persistencji)
  title: string
  canBack: boolean
  canFwd: boolean
  asleep: boolean // uśpiona: natywny webview zamknięty, by zwolnić RAM (czas trzymamy w refach)
}

// Historia karty liczona ręcznie (WKWebView przez Tauri nie zdradza canGoBack/canGoForward):
// stos adresów + indeks. Skok wstecz/naprzód tylko przesuwa indeks, nowa strona dopisuje.
interface TabHistory {
  stack: string[]
  idx: number
}

let tabSeq = 0
const genTabId = (): string => 't' + Date.now().toString(36) + (tabSeq++).toString(36)

function newTab(url: string): Tab {
  return { id: genTabId(), url, title: '', canBack: false, canFwd: false, asleep: false }
}

function normalizeUrl(input: string): string {
  const v = input.trim()
  if (!v) return 'about:blank'
  if (/^https?:\/\//i.test(v) || /^about:/i.test(v)) return v
  if (/^[\w-]+(\.[\w-]+)+/.test(v)) return 'https://' + v
  return 'https://duckduckgo.com/?q=' + encodeURIComponent(v)
}

// --- Pojedyncza karta = jeden natywny webview (child webview `pane:{fullId}` nad oknem "ui").
// Placeholder-div rezerwuje prostokąt w layoucie; natywny widok pozycjonujemy na jego
// współrzędne okna (add przy montowaniu, move przy zmianie, close przy odmontowaniu).
function NativeBrowserView({
  fullId,
  url,
  ws,
  active
}: {
  fullId: string
  url: string // adres startowy (przy add); późniejsze nawigacje idą przez panes.navigate
  ws: number // przestrzeń robocza = magazyn cookies (odpowiednik partycji persist:)
  active: boolean // widoczna karta: aktywna, w bieżącym workspace, bez overlaya i zoomu obcego panelu
}): JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  const activeRef = useRef(active)
  const startUrlRef = useRef(url) // celowo raz — zmiany url nie przeładowują widoku
  activeRef.current = active

  useEffect(() => {
    const el = ref.current
    if (!el) return
    let dead = false
    let added = false
    let last = { x: 0, y: 0, w: 0, h: 0 }

    // Widoczność: tylko aktywna karta; prostokąt 0x0 = grid schowany (display:none) = ukryj.
    const applyVis = (): void => {
      const r = el.getBoundingClientRect()
      window.api.panes.setVisible(fullId, activeRef.current && r.width > 0 && r.height > 0)
    }

    const sync = (): void => {
      if (dead) return
      const r = el.getBoundingClientRect()
      const ok = r.width > 0 && r.height > 0
      if (ok && !added) {
        added = true
        last = { x: r.x, y: r.y, w: r.width, h: r.height }
        void window.api.panes.add(fullId, startUrlRef.current, ws, r.x, r.y, r.width, r.height).then(() => {
          // Po dodaniu dosynchronizuj (pozycja/widoczność mogły się zmienić w międzyczasie).
          if (dead) window.api.panes.close(fullId) // odmontowano w trakcie dodawania
          else sync()
        })
      } else if (
        ok &&
        added &&
        (r.x !== last.x || r.y !== last.y || r.width !== last.w || r.height !== last.h)
      ) {
        last = { x: r.x, y: r.y, w: r.width, h: r.height }
        void window.api.panes.move(fullId, r.x, r.y, r.width, r.height)
      }
      applyVis()
    }

    sync()
    const ro = new ResizeObserver(sync)
    ro.observe(el)
    window.addEventListener('resize', sync)
    return () => {
      dead = true
      ro.disconnect()
      window.removeEventListener('resize', sync)
      window.api.panes.close(fullId)
    }
  }, [fullId, ws])

  // Przełączenie karty / workspace / otwarcie overlaya — odśwież widoczność natywnego widoku.
  useEffect(() => {
    const r = ref.current?.getBoundingClientRect()
    const ok = !!r && r.width > 0 && r.height > 0
    window.api.panes.setVisible(fullId, active && ok)
  }, [fullId, active])

  // Bez display:none dla nieaktywnych: placeholder trzyma prostokąt, dzięki czemu karty
  // w tle też mają natywny widok (ładują się) — są tylko schowane po stronie natywnej.
  return <div ref={ref} className="browser-view" />
}

/** Mini-przeglądarka w panelu: zakładki + pasek adresu + nawigacja. */
export default function BrowserPane({ paneId, url }: Props): JSX.Element {
  const init = normalizeUrl(url)
  const histRef = useRef<Record<string, TabHistory>>({})
  const [tabs, setTabs] = useState<Tab[]>(() => {
    const t = newTab(init)
    histRef.current[t.id] = { stack: [t.url], idx: 0 }
    return [t]
  })
  const [activeTabId, setActiveTabId] = useState(() => tabs[0].id)
  const [address, setAddress] = useState(url)

  const urlRef = useRef<HTMLInputElement>(null)
  const tabsRef = useRef(tabs)
  const activeRef = useRef(activeTabId)
  const lastActiveRef = useRef<Record<string, number>>({}) // ts ostatniego użycia karty
  const playingRef = useRef<Record<string, boolean>>({}) // czy w karcie gra film/audio
  tabsRef.current = tabs
  activeRef.current = activeTabId

  const setPaneUrl = useStore((s) => s.setPaneUrl)
  const setActivePane = useStore((s) => s.setActivePane)
  const autoScroll = useStore((s) => s.autoScrollIds.includes(paneId))
  const autoScrollEnabled = useStore((s) => s.autoScrollEnabled)
  const autoScrollMin = useStore((s) => s.autoScrollMin)
  const autoScrollMax = useStore((s) => s.autoScrollMax)
  const vimMode = useStore((s) => s.vimMode)
  const vimBinds = useStore((s) => s.vimBinds)
  const binds = useStore((s) => s.binds)
  // Bindy programu przekazywane wstrzykniętemu skryptowi jako MAPA combo→true — mają
  // priorytet nad stroną (port: reserved-combos z master; skrypt oddaje taką kombinację
  // hostowi, nie stronie).
  const reserved = useMemo(
    () => Object.fromEntries(Object.values(binds).filter(Boolean).map((c) => [c, true])),
    [binds]
  )

  // Workspace panelu (jak w starej wersji) — natywne widoki chowamy, gdy to nie bieżąca
  // przestrzeń (grid i tak ma display:none, więc prostokąt 0x0 też to załatwia).
  const wsId = useStore((s) => {
    for (const w of Object.values(s.workspaces)) if (w.panes.some((p) => p.id === paneId)) return w.id
    return s.current
  })
  const wsVisible = useStore((s) => s.current === wsId)
  // Overlay interfejsu (ustawienia, notatki, find…) leży POD natywnym webview, więc na
  // czas jego trwania chowamy strony. To samo przy zoomie: panel rozciągnięty na siatkę
  // leżałby pod natywnymi widokami paneli zostawionych pod spodem.
  const overlay = useStore(uiOverlayOpen)
  const coveredByZoom = useStore((s) => s.zoomPaneId !== null && s.zoomPaneId !== paneId)
  const paneVisible = wsVisible && !overlay && !coveredByZoom

  const activeTab = tabs.find((t) => t.id === activeTabId)

  // Po przełączeniu zakładki pokaż jej adres w pasku.
  useEffect(() => {
    const t = tabsRef.current.find((x) => x.id === activeTabId)
    if (t) setAddress(t.url)
  }, [activeTabId])

  // Aktywacja karty: odśwież znacznik czasu użycia i obudź ją.
  useEffect(() => {
    lastActiveRef.current[activeTabId] = Date.now()
    setTabs((prev) => prev.map((t) => (t.id === activeTabId && t.asleep ? { ...t, asleep: false } : t)))
  }, [activeTabId])

  // Zdarzenia natywnych webview: nawigacja (adres + historia) i tytuł (pasek zakładek).
  // Pełne id to `${paneId}:${tabId}` — dopasowujemy po prefiksie panelu.
  useEffect(() => {
    const prefix = paneId + ':'
    const offNav = window.api.panes.onNavigated(({ id, url: navUrl }) => {
      if (!id.startsWith(prefix)) return
      const tabId = id.slice(prefix.length)
      let h = histRef.current[tabId]
      if (!h) {
        h = { stack: [], idx: -1 }
        histRef.current[tabId] = h
      }
      if (h.stack[h.idx] === navUrl) {
        // przeładowanie bieżącej strony — stos bez zmian
      } else if (h.idx > 0 && h.stack[h.idx - 1] === navUrl) {
        h.idx -= 1 // skok wstecz (history.back)
      } else if (h.idx < h.stack.length - 1 && h.stack[h.idx + 1] === navUrl) {
        h.idx += 1 // skok w przód (history.forward)
      } else {
        h.stack = [...h.stack.slice(0, h.idx + 1), navUrl] // nowa strona ucina "przód"
        h.idx = h.stack.length - 1
      }
      const canBack = h.idx > 0
      const canFwd = h.idx < h.stack.length - 1
      setTabs((prev) => prev.map((t) => (t.id === tabId ? { ...t, url: navUrl, canBack, canFwd } : t)))
      if (tabId === activeRef.current) {
        setAddress(navUrl)
        setPaneUrl(paneId, navUrl)
      }
    })
    // Odtwarzanie mediów w karcie (skrypt wstrzyknięty do strony) — trzyma ją obudzoną.
    const offMedia = window.api.panes.onMedia(({ id, on }) => {
      if (!id.startsWith(prefix)) return
      const tabId = id.slice(prefix.length)
      playingRef.current[tabId] = on
      if (on) lastActiveRef.current[tabId] = Date.now()
    })
    const offTitle = window.api.panes.onTitle(({ id, title }) => {
      if (!id.startsWith(prefix)) return
      const tabId = id.slice(prefix.length)
      setTabs((prev) => prev.map((t) => (t.id === tabId ? { ...t, title } : t)))
    })
    return () => {
      offNav()
      offTitle()
      offMedia()
    }
  }, [paneId, setPaneUrl])

  // Budzenie karty (klik w szary ekran lub w zakładkę): remount doda natywny widok od t.url.
  const wakeTab = useCallback((id: string) => {
    lastActiveRef.current[id] = Date.now()
    setTabs((prev) => prev.map((t) => (t.id === id && t.asleep ? { ...t, asleep: false } : t)))
  }, [])

  // Auto-usypianie przeglądarek (tylko ten panel) — karta nieużywana przez N min usypia
  // (szary ekran, natywny webview zamknięty = RAM zwolniony). Wyjątek: karta używana właśnie
  // teraz (aktywna w aktywnym panelu). Uwaga: grania mediów nie wykrywamy (port Tauri).
  useEffect(() => {
    const id = setInterval(() => {
      const st = useStore.getState()
      const over = isRamOver(st.ram, st.ramStats)
      if (!st.ram.sleepInactive && !over) return
      const now = Date.now()
      const cutoff = over ? now : now - st.ram.sleepAfterMin * 60000
      const isActivePane = st.activePaneId === paneId
      if (isActivePane) lastActiveRef.current[activeRef.current] = now // używana właśnie teraz
      setTabs((prev) => {
        let changed = false
        const next = prev.map((t) => {
          // Grająca karta liczy się jak używana (port media-started-playing z Electrona).
          const inUse = (isActivePane && t.id === activeRef.current) || playingRef.current[t.id]
          if (inUse || t.asleep) return t
          const la = lastActiveRef.current[t.id]
          if (la === undefined) {
            lastActiveRef.current[t.id] = now // pierwszy raz widziana — od teraz liczymy
            return t
          }
          if (la < cutoff) {
            changed = true
            // Po obudzeniu natywna historia zaczyna się od zera (świeży webview).
            histRef.current[t.id] = { stack: [t.url], idx: 0 }
            playingRef.current[t.id] = false
            return { ...t, asleep: true, canBack: false, canFwd: false }
          }
          return t
        })
        return changed ? next : prev
      })
    }, 10000)
    return () => clearInterval(id)
  }, [paneId])

  // Auto-scroll (pod bekę): przewijamy aktywną kartę, więc reels/shorts
  // (TikTok/Instagram/YouTube Shorts) same lecą dalej. Każdy odstęp losowany z zakresu min–max
  // (bardziej naturalnie niż stały takt). Trzyma też kartę obudzoną.
  useEffect(() => {
    if (!autoScroll || !autoScrollEnabled) return
    let timer: ReturnType<typeof setTimeout>
    const press = (): void => {
      // Bezpośrednie przewinięcie kontenera (snap reels/shorts) — pewniejsze niż syntetyczny klawisz.
      window.api.panes.eval(paneId + ':' + activeRef.current, AUTOSCROLL_JS)
      lastActiveRef.current[activeRef.current] = Date.now() // nie usypiaj jadącej karty
      schedule()
    }
    const schedule = (): void => {
      const min = Math.max(1, autoScrollMin)
      const max = Math.max(min, autoScrollMax)
      const delay = (min + Math.random() * (max - min)) * 1000
      timer = setTimeout(press, delay)
    }
    schedule()
    return () => clearTimeout(timer)
  }, [autoScroll, autoScrollEnabled, autoScrollMin, autoScrollMax, paneId])

  const onOpenTab = useCallback((rawUrl: string) => {
    // Egzekwowanie RAM: nie otwieramy nowej karty po przekroczeniu progu.
    const st = useStore.getState()
    if (isRamOver(st.ram, st.ramStats)) {
      st.setRamPanelOpen(true)
      return
    }
    const t = newTab(normalizeUrl(rawUrl))
    histRef.current[t.id] = { stack: [t.url], idx: 0 }
    setTabs((prev) => [...prev, t])
    setActiveTabId(t.id)
  }, [])

  const closeTab = useCallback((id: string) => {
    const cur = tabsRef.current
    if (cur.length <= 1) return
    const idx = cur.findIndex((t) => t.id === id)
    const next = cur.filter((t) => t.id !== id)
    // Odmontowanie NativeBrowserView zamknie natywny widok; sprzątamy jego ślady w refach.
    delete histRef.current[id]
    delete lastActiveRef.current[id]
    delete playingRef.current[id]
    if (id === activeRef.current) setActiveTabId(next[Math.min(idx, next.length - 1)].id)
    setTabs(next)
  }, [])

  const cycleTab = useCallback((dir: number) => {
    const cur = tabsRef.current
    if (cur.length <= 1) return
    const idx = cur.findIndex((t) => t.id === activeRef.current)
    setActiveTabId(cur[(idx + dir + cur.length) % cur.length].id)
  }, [])

  // Komendy kart (z bindów: ⌘T/⌘W/⌘⇧]/⌘⇧[) — reagujemy tylko gdy to AKTYWNY panel.
  useEffect(() => {
    const onCmd = (e: Event): void => {
      if (useStore.getState().activePaneId !== paneId) return
      const cmd = (e as CustomEvent).detail as PaneCmd
      if (cmd === 'tab.new') onOpenTab(NEW_TAB_URL)
      else if (cmd === 'tab.close') closeTab(activeRef.current)
      else if (cmd === 'tab.next') cycleTab(1)
      else if (cmd === 'tab.prev') cycleTab(-1)
    }
    window.addEventListener(PANE_CMD_EVENT, onCmd)
    return () => window.removeEventListener(PANE_CMD_EVENT, onCmd)
  }, [paneId, onOpenTab, closeTab, cycleTab])

  // Stan vima + bindy → wstrzyknięte skrypty natywnych webview (port: wv.send('vim-mode',
  // 'vim-binds', 'reserved-combos') z master). Stan pchamy pane_eval do każdej nieuśpionej
  // karty (window.__vimState — skrypt czyta go leniwie przy każdym evencie), a po zmianie
  // strony skrypt sam pyta (vim-hello) i dosyłamy stan tylko do pytającej karty.
  const vimState = useMemo(
    () => ({ vim: vimMode, binds: vimBinds, reserved }),
    [vimMode, vimBinds, reserved]
  )
  const vimStateRef = useRef(vimState)
  vimStateRef.current = vimState
  const awakeTabs = tabs.filter((t) => !t.asleep).map((t) => t.id).join(' ')
  useEffect(() => {
    const js = 'window.__vimState = ' + JSON.stringify(vimState)
    for (const t of tabsRef.current) {
      if (!t.asleep) window.api.panes.eval(paneId + ':' + t.id, js)
    }
    // awakeTabs: dosyłamy stan też do świeżo obudzonych/otwartych kart.
  }, [vimState, awakeTabs, paneId])
  useEffect(() => {
    return window.api.panes.onVimHello(({ id }) => {
      if (!id.startsWith(paneId + ':')) return
      window.api.panes.eval(id, 'window.__vimState = ' + JSON.stringify(vimStateRef.current))
    })
  }, [paneId])

  // Zdarzenia ze skryptu natywnego webview (port ipc-message z master) — tylko własne karty
  // (pełne id to `${paneId}:${tabId}`, filtr po prefiksie panelu).
  useEffect(() => {
    const prefix = paneId + ':'
    const mine = (id: string): boolean => id.startsWith(prefix)
    const offOpen = window.api.panes.onOpenTab(({ id, url }) => {
      if (mine(id)) onOpenTab(url)
    })
    const offBind = window.api.panes.onRunBind(({ id, combo }) => {
      if (!mine(id)) return
      const a = actionForCombo(useStore.getState().binds, combo)
      if (a) runBind(a)
    })
    const offAct = window.api.panes.onActivate(({ id }) => {
      if (mine(id)) setActivePane(paneId)
    })
    const offUrl = window.api.panes.onFocusUrl(({ id }) => {
      if (!mine(id)) return
      const el = urlRef.current
      if (el) {
        el.focus()
        el.select()
      }
    })
    const offWin = window.api.panes.onWinMotion(({ id, act }) => {
      if (mine(id)) runWindowMotion(act)
    })
    const offPrefix = window.api.panes.onWinPrefix(({ id }) => {
      if (mine(id)) armWinPending()
    })
    return () => {
      offOpen()
      offBind()
      offAct()
      offUrl()
      offWin()
      offPrefix()
    }
  }, [paneId, onOpenTab, setActivePane])

  // Wyszukiwanie (Ctrl/⌘+F) na stronie — port natywnego findInPage z master przez window.find
  // (pane_eval do aktywnej karty). query = nowe szukanie (start od góry); next/prev = kolejne
  // trafienie do przodu/wstecz; close = wyczyść zaznaczenie.
  useEffect(() => {
    const onFind = (e: Event): void => {
      const d = (e as CustomEvent<FindDetail>).detail
      if (d.inNotes || d.paneId !== paneId) return
      const full = paneId + ':' + activeRef.current
      if (d.type === 'close') {
        window.api.panes.eval(full, 'window.getSelection()?.removeAllRanges()')
        return
      }
      if (!d.query) return
      const q = JSON.stringify(d.query)
      if (d.type === 'query') {
        window.api.panes.eval(
          full,
          `(() => { const s = window.getSelection(); s && s.removeAllRanges(); window.find(${q}) })()`
        )
      } else {
        window.api.panes.eval(full, `window.find(${q}, false, ${d.type === 'prev'})`)
      }
    }
    window.addEventListener(FIND_EVENT, onFind)
    return () => window.removeEventListener(FIND_EVENT, onFind)
  }, [paneId])

  const go = (): void => {
    const target = normalizeUrl(address)
    window.api.panes.navigate(paneId + ':' + activeTabId, target)
  }

  return (
    <div className="browser-pane">
      {tabs.length > 1 && (
        <div className="browser-tabs">
          {tabs.map((t) => (
            <div
              key={t.id}
              className={'browser-tab' + (t.id === activeTabId ? ' browser-tab--active' : '')}
              onMouseDown={() => setActiveTabId(t.id)}
              title={t.url}
            >
              <span className="browser-tab-title">
                {(t.asleep ? '💤 ' : '') + (t.title || t.url || 'New tab')}
              </span>
              <button
                className="browser-tab-close"
                data-tip="Close tab"
                onMouseDown={(e) => {
                  e.stopPropagation()
                  closeTab(t.id)
                }}
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="browser-bar" onClick={(e) => e.stopPropagation()}>
        <button
          data-tip="Back"
          disabled={!activeTab?.canBack}
          onClick={() => window.api.panes.eval(paneId + ':' + activeTabId, 'history.back()')}
        >
          ‹
        </button>
        <button
          data-tip="Forward"
          disabled={!activeTab?.canFwd}
          onClick={() => window.api.panes.eval(paneId + ':' + activeTabId, 'history.forward()')}
        >
          ›
        </button>
        <button data-tip="Reload page" onClick={() => window.api.panes.reload(paneId + ':' + activeTabId)}>
          ⟳
        </button>
        <input
          ref={urlRef}
          className="browser-url"
          value={address}
          spellCheck={false}
          onChange={(e) => setAddress(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') go()
            else if (e.key === 'Escape') e.currentTarget.blur() // odblokuj bindy programu
          }}
          placeholder="Enter address or search…"
        />
        <button data-tip="Go to address" onClick={go}>
          →
        </button>
      </div>

      <div className="browser-views">
        {/* Natywny widok unosi się tylko nad tym obszarem — pasek zakładek/adresu zostaje
            klikalny, a onMouseDown na ramce panelu (PaneGrid) dalej aktywuje panel. */}
        {/* Uśpiona karta: natywny webview zamknięty (RAM zwolniony); aktywna pokazuje szary ekran. */}
        {tabs.map((t) =>
          t.asleep ? (
            <div
              key={t.id}
              className="tab-sleeping"
              style={{ display: t.id === activeTabId ? undefined : 'none' }}
              onClick={() => wakeTab(t.id)}
            >
              <div className="tab-sleeping-inner">
                💤
                <div>Sleeping to save RAM</div>
                <span>click to reload</span>
              </div>
            </div>
          ) : (
            <NativeBrowserView
              key={t.id}
              fullId={paneId + ':' + t.id}
              url={t.url}
              ws={wsId}
              active={t.id === activeTabId && paneVisible}
            />
          )
        )}
      </div>
    </div>
  )
}
