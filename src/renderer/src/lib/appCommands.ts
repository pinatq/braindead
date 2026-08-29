// Komendy przychodzące spoza interfejsu: z gniazda uniksowego (Neovide, dowolny skrypt)
// albo z sekwencji OSC 7717 wypisanej przez program w panelu terminala (także przez ssh).
// Obie drogi lądują tutaj jako to samo zdarzenie — patrz src-tauri/src/control.rs.
import { useStore } from '../state/store'

/** Panel, w którym otworzymy plik. Kolejność: istniejący viewer → inny panel → dołóż panel. */
function panelDlaPliku(zrodloPtyId?: string): string | null {
  const st = useStore.getState()
  const ws = st.workspaces[st.current]
  if (!ws) return null

  // Panel, z którego przyszła komenda (jeśli z terminala) — jego nie zabieramy.
  const zrodlo = zrodloPtyId ? ws.panes.find((p) => p.ptyId === zrodloPtyId)?.id : undefined

  // 1. Otwarty już viewer — najlepszy cel, nic nie tracimy.
  const viewer = ws.panes.find((p) => p.mode === 'viewer' && p.id !== zrodlo)
  if (viewer) return viewer.id

  // 2. Panel, w którym NIC nie pracuje: nie źródło komendy i nie ten, w którym siedzisz.
  //    Jedynego panelu nie zabieramy NIGDY — komenda z Neovide nie ma panelu źródłowego,
  //    a activePaneId bywa puste tuż po starcie, więc bez tego warunku plik podmieniłby
  //    terminal z Neovimem zamiast otworzyć się obok.
  if (ws.panes.length > 1) {
    const wolny = ws.panes.find((p) => p.id !== zrodlo && p.id !== st.activePaneId)
    if (wolny) return wolny.id
  }

  // 3. Nie ma gdzie — dokładamy panel do układu. O to chodziło w „dodatkowym okienku":
  //    panel z Neovimem zostaje, plik ląduje obok.
  const nastepny: Record<number, string> = { 1: '2-cols', 2: '3-cols', 3: '4-grid', 4: '5-1L-4R', 5: '6-grid' }
  const cel = nastepny[ws.panes.length]
  if (!cel) return null
  st.setLayout(cel)
  const po = useStore.getState().workspaces[useStore.getState().current]
  const stare = new Set(ws.panes.map((p) => p.id))
  return po?.panes.find((p) => !stare.has(p.id))?.id ?? null
}

function otworzPlik(sciezka: string, zrodloPtyId?: string): void {
  const p = sciezka.trim()
  if (!p) return
  const target = panelDlaPliku(zrodloPtyId)
  if (!target) return
  const st = useStore.getState()
  st.openFileInPane(target, p)
  st.setActivePane(target)
}

/** Czeka, aż panel dostanie swoje PTY (terminal montuje się asynchronicznie). */
function poczekajNaPty(paneId: string, ms = 4000): Promise<string | null> {
  return new Promise((resolve) => {
    const start = Date.now()
    const tick = (): void => {
      const st = useStore.getState()
      const pty = st.workspaces[st.current]?.panes.find((p) => p.id === paneId)?.ptyId
      if (pty) return resolve(pty)
      if (Date.now() - start > ms) return resolve(null)
      setTimeout(tick, 60)
    }
    tick()
  })
}

/**
 * Numer przestrzeni dla `run`. NIGDY nie zwraca bieżącej — o to chodzi w „osobnej karcie":
 * komenda ma wylądować obok tego, nad czym pracujesz, a nie pod tym samym numerem.
 */
function wolnaPrzestrzen(): number {
  const st = useStore.getState()
  for (let n = 1; n <= 16; n++) {
    if (n === st.current) continue
    const w = st.workspaces[n]
    // Wolna = nie istnieje albo ma jeden dziewiczy terminal.
    if (!w) return n
    if (w.panes.length === 1 && w.panes[0].mode === 'terminal' && !w.panes[0].dirty) return n
  }
  // Wszystkie zajęte — bierzemy pierwszą inną niż bieżąca.
  return st.current === 1 ? 2 : 1
}

async function odpalWNowejPrzestrzeni(komenda: string): Promise<void> {
  const cmd = komenda.trim()
  if (!cmd) return
  const st = useStore.getState()
  st.gotoWorkspace(wolnaPrzestrzen())
  const po = useStore.getState()
  const pane = po.workspaces[po.current]?.panes[0]
  if (!pane) return
  po.setActivePane(pane.id)
  const ptyId = await poczekajNaPty(pane.id)
  if (!ptyId) return
  useStore.getState().markPaneDirty(pane.id)
  window.api.pty.input(ptyId, cmd + '\n')
}

/** Podpina obsługę komend. Zwraca funkcję odpinającą. */
export function installAppCommands(): () => void {
  return window.api.onAppCommand(({ verb, arg, pane }) => {
    if (verb === 'open') otworzPlik(arg, pane)
    else if (verb === 'run') void odpalWNowejPrzestrzeni(arg)
  })
}
