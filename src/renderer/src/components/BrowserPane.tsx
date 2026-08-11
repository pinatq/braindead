import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useStore, isRamOver } from '../state/store'
import { actionForCombo } from '../shortcuts/binds'
import { PANE_CMD_EVENT, runBind, runWindowMotion, armWinPending, type PaneCmd } from '../shortcuts/dispatch'
import { FIND_EVENT, type FindDetail } from '../shortcuts/find'

const NEW_TAB_URL = 'https://duckduckgo.com'

// Normalny UA Chrome — bez tego Electron dodaje "Electron/AppName", przez co część witryn
// (np. YouTube/Google) serwuje połamane zasoby (ikony/czcionki się nie ładują).
const CHROME_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'

interface Props {
  paneId: string
  url: string
}

// Minimalny interfejs Electronowego <webview>, którego używamy.
interface WebviewEl extends HTMLElement {
  src: string
  loadURL: (url: string) => void
  goBack: () => void
  goForward: () => void
  reload: () => void
  stop: () => void
  getURL: () => string
  getTitle: () => string
  canGoBack: () => boolean
  canGoForward: () => boolean
  send: (channel: string, ...args: unknown[]) => void
  sendInputEvent: (event: { type: string; keyCode?: string; modifiers?: string[] }) => void
  executeJavaScript: (code: string) => Promise<unknown>
  findInPage: (text: string, options?: { forward?: boolean; findNext?: boolean }) => number
  stopFindInPage: (action: 'clearSelection' | 'keepSelection' | 'activateSelection') => void
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
  initialUrl: string // ustawiane raz (atrybut src webview) — nie zmieniamy, by nie przeładowywać
  url: string // bieżący adres (do paska i persistencji)
  title: string
  canBack: boolean
  canFwd: boolean
  asleep: boolean // uśpiona: webview odmontowany, by zwolnić RAM (czas/granie trzymamy w refach)
}

let tabSeq = 0
const genTabId = (): string => 't' + Date.now().toString(36) + (tabSeq++).toString(36)

function newTab(url: string): Tab {
  return { id: genTabId(), initialUrl: url, url, title: '', canBack: false, canFwd: false, asleep: false }
}

function normalizeUrl(input: string): string {
  const v = input.trim()
  if (!v) return 'about:blank'
  if (/^https?:\/\//i.test(v) || /^about:/i.test(v)) return v
  if (/^[\w-]+(\.[\w-]+)+/.test(v)) return 'https://' + v
  return 'https://duckduckgo.com/?q=' + encodeURIComponent(v)
}

// --- Pojedyncza zakładka (jeden <webview>) ---
function BrowserTab({
  tab,
  active,
  vimMode,
  vimBinds,
  reserved,
  partition,
  register,
  onNavigate,
  onActivate,
  onOpenTab,
  onFocusAddress,
  onRunBind,
  onMedia
}: {
  tab: Tab
  active: boolean
  vimMode: boolean
  vimBinds: Record<string, string>
  reserved: string[]
  partition: string // partycja sesji (persist:…) — wspólna w obrębie jednej przestrzeni roboczej
  register: (id: string, el: WebviewEl | null) => void
  onNavigate: (id: string, url: string, canBack: boolean, canFwd: boolean, title: string) => void
  onActivate: () => void
  onOpenTab: (url: string) => void
  onFocusAddress: () => void
  onRunBind: (combo: string) => void
  onMedia: (id: string, playing: boolean) => void
}): JSX.Element {
  const ref = useRef<WebviewEl | null>(null)
  const vimRef = useRef(vimMode)
  const vimBindsRef = useRef(vimBinds)
  const reservedRef = useRef(reserved)
  vimRef.current = vimMode
  vimBindsRef.current = vimBinds
  reservedRef.current = reserved

  useEffect(() => {
    const wv = ref.current
    if (!wv) return
    register(tab.id, wv)
    const onNav = (): void =>
      onNavigate(tab.id, wv.getURL(), wv.canGoBack(), wv.canGoForward(), wv.getTitle())
    const pushState = (): void => {
      try {
        wv.send('vim-mode', vimRef.current)
        wv.send('vim-binds', vimBindsRef.current) // konfigurowalny keymap vima
        wv.send('reserved-combos', reservedRef.current) // bindy programu mają priorytet nad stroną
      } catch {
        /* webview jeszcze nie gotowy */
      }
    }
    // Typ zdarzenia ipc-message webview (Electron) — DOM zna tylko Event, stąd cast niżej.
    const onIpc = (e: Event & { channel: string; args: unknown[] }): void => {
      if (e.channel === 'pane-activate') onActivate()
      else if (e.channel === 'open-tab' && e.args?.[0]) onOpenTab(String(e.args[0]))
      else if (e.channel === 'focus-url') onFocusAddress() // ':' → domyślny pasek adresu
      else if (e.channel === 'run-bind' && e.args?.[0]) onRunBind(String(e.args[0]))
      else if (e.channel === 'vim-history') {
        if (Number(e.args?.[0]) < 0) wv.goBack()
        else wv.goForward()
      }
      // Prefiks Ctrl-w z przeglądarki — pokaż w statusline; drugi klawisz wykona ruch okna.
      else if (e.channel === 'vim-window-prefix') armWinPending()
      else if (e.channel === 'vim-window' && e.args?.[0]) runWindowMotion(String(e.args[0]))
      // Preload się zgłosił po załadowaniu — odeślij aktualny stan.
      else if (e.channel === 'vim-hello') pushState()
    }
    // Po załadowaniu strony przekaż aktualny stan do preloadu webview.
    const onReady = (): void => pushState()
    // Odtwarzanie mediów (film/audio) trzyma kartę "aktywną" — nie usypiamy jej.
    const onPlay = (): void => onMedia(tab.id, true)
    const onPause = (): void => onMedia(tab.id, false)
    wv.addEventListener('did-navigate', onNav)
    wv.addEventListener('did-navigate-in-page', onNav)
    wv.addEventListener('page-title-updated', onNav)
    wv.addEventListener('ipc-message', onIpc as EventListener)
    wv.addEventListener('focus', onActivate)
    wv.addEventListener('dom-ready', onReady)
    wv.addEventListener('media-started-playing', onPlay)
    wv.addEventListener('media-paused', onPause)
    return () => {
      wv.removeEventListener('did-navigate', onNav)
      wv.removeEventListener('did-navigate-in-page', onNav)
      wv.removeEventListener('page-title-updated', onNav)
      wv.removeEventListener('ipc-message', onIpc as EventListener)
      wv.removeEventListener('focus', onActivate)
      wv.removeEventListener('dom-ready', onReady)
      wv.removeEventListener('media-started-playing', onPlay)
      wv.removeEventListener('media-paused', onPause)
      onMedia(tab.id, false) // odmontowana karta nie gra
      register(tab.id, null)
    }
  }, [tab.id, register, onNavigate, onActivate, onOpenTab, onFocusAddress, onRunBind, onMedia])

  // Zmiana stanu (Vim mode / keymap / lista bindów) w locie — wyślij do działającego webview.
  useEffect(() => {
    try {
      ref.current?.send('vim-mode', vimMode)
      ref.current?.send('vim-binds', vimBinds)
      ref.current?.send('reserved-combos', reserved)
    } catch {
      /* nieistotne */
    }
  }, [vimMode, vimBinds, reserved])

  return (
    <webview
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ref={ref as any}
      className="browser-view"
      style={{ display: active ? undefined : 'none' }}
      src={tab.initialUrl}
      allowpopups="true"
      partition={partition}
      preload={window.api.webviewPreloadUrl}
      useragent={CHROME_UA}
    />
  )
}

/** Mini-przeglądarka w panelu: zakładki + pasek adresu + nawigacja. */
export default function BrowserPane({ paneId, url }: Props): JSX.Element {
  const init = normalizeUrl(url)
  const [tabs, setTabs] = useState<Tab[]>(() => [newTab(init)])
  const [activeTabId, setActiveTabId] = useState(() => tabs[0].id)
  const [address, setAddress] = useState(url)

  const refs = useRef<Record<string, WebviewEl | null>>({})
  const urlRef = useRef<HTMLInputElement>(null)
  const tabsRef = useRef(tabs)
  const activeRef = useRef(activeTabId)
  const lastActiveRef = useRef<Record<string, number>>({}) // ts ostatniego użycia karty
  const playingRef = useRef<Record<string, boolean>>({}) // czy w karcie gra film/audio
  tabsRef.current = tabs
  activeRef.current = activeTabId

  const setPaneUrl = useStore((s) => s.setPaneUrl)
  const setActivePane = useStore((s) => s.setActivePane)
  const vimMode = useStore((s) => s.vimMode)
  const vimBinds = useStore((s) => s.vimBinds)
  const activePaneId = useStore((s) => s.activePaneId)
  const autoScroll = useStore((s) => s.autoScrollIds.includes(paneId))
  const autoScrollEnabled = useStore((s) => s.autoScrollEnabled)
  const autoScrollMin = useStore((s) => s.autoScrollMin)
  const autoScrollMax = useStore((s) => s.autoScrollMax)
  const binds = useStore((s) => s.binds)
  // Niepuste kombinacje = "zarezerwowane" dla programu — przeglądarka ma je oddać hostowi.
  const reserved = useMemo(() => Object.values(binds).filter(Boolean), [binds])

  // Partycja sesji per PRZESTRZEŃ ROBOCZA: wszystkie przeglądarki/karty w tym samym workspace
  // dzielą cookies/logowania (persist: = zapis na dysk), a kolejne workspace mają własne, osobne.
  const wsId = useStore((s) => {
    for (const w of Object.values(s.workspaces)) if (w.panes.some((p) => p.id === paneId)) return w.id
    return s.current
  })
  const partition = 'persist:browser-ws' + wsId

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

  // Budzenie karty (klik w szary ekran lub w zakładkę).
  const wakeTab = useCallback((id: string) => {
    lastActiveRef.current[id] = Date.now()
    setTabs((prev) => prev.map((t) => (t.id === id && t.asleep ? { ...t, asleep: false } : t)))
  }, [])

  // Zmiana stanu odtwarzania mediów w karcie.
  const onMedia = useCallback((id: string, playing: boolean) => {
    playingRef.current[id] = playing
    if (playing) lastActiveRef.current[id] = Date.now()
  }, [])

  // Auto-usypianie przeglądarek (tylko ten panel) — karta nieużywana przez N min usypia
  // (szary ekran, webview odmontowany = RAM zwolniony). Wyjątki: karta używana właśnie teraz
  // (aktywna w aktywnym panelu) oraz karta, w której gra film/audio.
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
          const inUse = isActivePane && t.id === activeRef.current
          if (inUse || t.asleep) return t
          if (playingRef.current[t.id]) {
            lastActiveRef.current[t.id] = now // gra film — trzymamy aktywną
            return t
          }
          const la = lastActiveRef.current[t.id]
          if (la === undefined) {
            lastActiveRef.current[t.id] = now // pierwszy raz widziana — od teraz liczymy
            return t
          }
          if (la < cutoff) {
            changed = true
            return { ...t, asleep: true, initialUrl: t.url } // remount obudzi z bieżącego adresu
          }
          return t
        })
        return changed ? next : prev
      })
    }, 10000)
    return () => clearInterval(id)
  }, [paneId])

  // Auto-scroll (pod bekę): "wciskamy strzałkę w dół" w aktywnej karcie, więc reels/shorts
  // (TikTok/Instagram/YouTube Shorts) same lecą dalej. Każdy odstęp losowany z zakresu min–max
  // (bardziej naturalnie niż stały takt). Trzyma też kartę obudzoną.
  useEffect(() => {
    if (!autoScroll || !autoScrollEnabled) return
    let timer: ReturnType<typeof setTimeout>
    const press = (): void => {
      const wv = refs.current[activeRef.current]
      if (wv) {
        // Bezpośrednie przewinięcie kontenera (snap reels/shorts) — pewniejsze niż syntetyczny klawisz.
        wv.executeJavaScript(AUTOSCROLL_JS).catch(() => {})
        lastActiveRef.current[activeRef.current] = Date.now() // nie usypiaj jadącej karty
      }
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
  }, [autoScroll, autoScrollEnabled, autoScrollMin, autoScrollMax])

  // Gdy panel staje się aktywny — przejmij fokus do webview (klawisze vim/scroll trafią tu,
  // nie do poprzedniego terminala/panelu).
  useEffect(() => {
    if (activePaneId === paneId) refs.current[activeTabId]?.focus()
  }, [activePaneId, paneId, activeTabId])

  const register = useCallback((id: string, el: WebviewEl | null) => {
    refs.current[id] = el
  }, [])

  const onActivate = useCallback(() => setActivePane(paneId), [paneId, setActivePane])

  // ':' z przeglądarki → aktywuj domyślny pasek adresu panelu.
  const onFocusAddress = useCallback(() => {
    const el = urlRef.current
    if (el) {
      el.focus()
      el.select()
    }
  }, [])

  // Kombinacja przekazana z przeglądarki (zarezerwowany bind) → wykonaj akcję programu.
  const onRunBind = useCallback((combo: string) => {
    const a = actionForCombo(useStore.getState().binds, combo)
    if (a) runBind(a)
  }, [])

  const onNavigate = useCallback(
    (id: string, curUrl: string, canBack: boolean, canFwd: boolean, title: string) => {
      setTabs((prev) =>
        prev.map((t) => (t.id === id ? { ...t, url: curUrl, canBack, canFwd, title } : t))
      )
      if (id === activeRef.current) {
        setAddress(curUrl)
        setPaneUrl(paneId, curUrl)
      }
    },
    [paneId, setPaneUrl]
  )

  const onOpenTab = useCallback((rawUrl: string) => {
    // Egzekwowanie RAM: nie otwieramy nowej karty po przekroczeniu progu.
    const st = useStore.getState()
    if (isRamOver(st.ram, st.ramStats)) {
      st.setRamPanelOpen(true)
      return
    }
    const t = newTab(normalizeUrl(rawUrl))
    setTabs((prev) => [...prev, t])
    setActiveTabId(t.id)
  }, [])

  const closeTab = useCallback((id: string) => {
    const cur = tabsRef.current
    if (cur.length <= 1) return
    const idx = cur.findIndex((t) => t.id === id)
    const next = cur.filter((t) => t.id !== id)
    delete refs.current[id]
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

  // Wyszukiwanie (Ctrl/⌘+F) na stronie — natywny findInPage aktywnego <webview>.
  useEffect(() => {
    const onFind = (e: Event): void => {
      const d = (e as CustomEvent<FindDetail>).detail
      if (d.inNotes || d.paneId !== paneId) return
      const wv = refs.current[activeRef.current]
      if (!wv) return
      if (d.type === 'close' || !d.query) {
        wv.stopFindInPage('clearSelection')
        return
      }
      // query = nowe szukanie; next/prev = kolejne trafienie do przodu/wstecz.
      wv.findInPage(d.query, { findNext: d.type !== 'query', forward: d.type !== 'prev' })
    }
    window.addEventListener(FIND_EVENT, onFind)
    return () => window.removeEventListener(FIND_EVENT, onFind)
  }, [paneId])

  const go = (): void => {
    const target = normalizeUrl(address)
    refs.current[activeTabId]?.loadURL(target)
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
        <button data-tip="Back" disabled={!activeTab?.canBack} onClick={() => refs.current[activeTabId]?.goBack()}>
          ‹
        </button>
        <button data-tip="Forward" disabled={!activeTab?.canFwd} onClick={() => refs.current[activeTabId]?.goForward()}>
          ›
        </button>
        <button data-tip="Reload page" onClick={() => refs.current[activeTabId]?.reload()}>
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
            else if (e.key === 'Escape') refs.current[activeTabId]?.focus() // wróć do strony
          }}
          placeholder="Enter address or search…"
        />
        <button data-tip="Go to address" onClick={go}>
          →
        </button>
      </div>

      <div className="browser-views">
        {/* Uśpiona karta: webview odmontowany (RAM zwolniony); aktywna pokazuje szary ekran. */}
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
            <BrowserTab
              key={t.id}
              tab={t}
              active={t.id === activeTabId}
              vimMode={vimMode}
              vimBinds={vimBinds}
              reserved={reserved}
              partition={partition}
              register={register}
              onNavigate={onNavigate}
              onActivate={onActivate}
              onOpenTab={onOpenTab}
              onFocusAddress={onFocusAddress}
              onRunBind={onRunBind}
              onMedia={onMedia}
            />
          )
        )}
      </div>
    </div>
  )
}
