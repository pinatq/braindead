// Protokół globalnego wyszukiwania (Ctrl/⌘+F). FindBar rozsyła zdarzenia, a aktywny panel
// (lub notatki) je obsługuje po swojemu: terminal szuka w buforze xterm, viewer pdf/docx przez
// CSS Highlight API, txt/notatki w textarea, przeglądarka przez findInPage, eksplorator skacze
// do pasującego wpisu. Dzięki temu „find" działa wszędzie tam, gdzie jest tekst.

export const FIND_EVENT = 'vibe-find'
export const FIND_FOCUS_EVENT = 'vibe-find-focus' // sygnał: pasek ma przejąć fokus (też gdy już otwarty)

export type FindType = 'query' | 'next' | 'prev' | 'close'

export interface FindDetail {
  type: FindType
  query: string
  paneId: string | null // docelowy panel (aktywny) — null gdy brak
  inNotes: boolean // true → szukamy w panelu notatek (ma priorytet, gdy otwarte)
}

export function dispatchFind(detail: FindDetail): void {
  window.dispatchEvent(new CustomEvent<FindDetail>(FIND_EVENT, { detail }))
}
