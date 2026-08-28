// Most diagnostyczny renderer -> stderr procesu.
//
// W buildzie wydania konsola WKWebView nigdzie nie trafia, więc błąd w rendererze jest
// całkowicie niewidoczny: React bez error boundary odmontowuje całe drzewo, #root robi się
// pusty, a że okno jest przezroczyste — widać samo ciemne tło. Stąd objaw „aplikacja robi
// się ciemna". Tutaj przechwytujemy wszystko i przepychamy do Rusta, gdzie leci na stderr.
import { invoke } from '@tauri-apps/api/core'

function send(level: string, msg: string): void {
  void invoke('log_js', { level, msg }).catch(() => {})
}

/** Skraca i spłaszcza dowolną wartość do jednej linii logu. */
export function describe(v: unknown): string {
  if (v instanceof Error) return `${v.name}: ${v.message}\n${v.stack ?? ''}`
  if (typeof v === 'string') return v
  try {
    return JSON.stringify(v)
  } catch {
    return String(v)
  }
}

export function reportCrash(where: string, err: unknown): void {
  send('error', `${where}: ${describe(err)}`)
}

export function installCrashReporting(): void {
  window.addEventListener('error', (e) => {
    send('error', `${e.message} @ ${e.filename}:${e.lineno}:${e.colno}\n${e.error?.stack ?? ''}`)
  })
  window.addEventListener('unhandledrejection', (e) => {
    send('unhandled-rejection', describe(e.reason))
  })
  // console.error zostaje działający — tylko dokładamy kopię do logu procesu.
  const orig = console.error.bind(console)
  console.error = (...args: unknown[]): void => {
    orig(...args)
    send('console', args.map(describe).join(' '))
  }
  send('info', 'renderer wystartował')
}
