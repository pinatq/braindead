// Potwierdzenia i komunikaty aplikacji.
//
// NIE używamy window.confirm/alert: w WKWebView (Tauri) są martwe — wry nie implementuje
// WKUIDelegate dla okienek JS, więc confirm() zwraca natychmiast `false`, a alert() nic nie
// robi. Skutkowało to tym, że każda akcja za potwierdzeniem po cichu nie działała: ubicie
// panelu i przestrzeni, kasowanie plików, czyszczenie notatek, instalacja agenta.
//
// ponytail: natywne okienko systemu (rfd po stronie Rusta) zamiast własnego modala w React —
// zero nowych zależności i działa też wtedy, gdy nad interfejsem leży natywny panel przeglądarki.

/** Pytanie tak/nie. Zwraca true, gdy użytkownik potwierdził. */
export function askConfirm(message: string, title = 'BrainDead'): Promise<boolean> {
  return window.api.dialog.confirm(title, message)
}

/** Komunikat (zwykle błąd) — odpowiednik alert(). */
export function showMessage(message: string, title = 'BrainDead'): Promise<void> {
  return window.api.dialog.message(title, message)
}
