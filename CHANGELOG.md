# Historia zmian

## 0.1.3 — 2026-09-28

### Terminale i agenci AI

- Dodano kontrolę przepływu wyjścia PTY: kolejka Rusta i dane oczekujące na
  przetworzenie przez xterm mają wspólny limit 256 KiB na sesję. Po zapełnieniu
  odczyt czeka na odbiorcę, bez odrzucania bajtów i sekwencji terminalowych.
- Potwierdzenia uwzględniają zamknięcie widoku, ponowne otwarcie terminala
  i odtwarzanie historii, aby działająca sesja nie została zablokowana.
- Zapis klawiszy i dużych wklejeń odbywa się w osobnym wątku, z zachowaniem
  kolejności. Oczekiwanie na koniec procesu nie blokuje jego zamknięcia.
- Dodano renderer WebGL w xterm z powrotem do DOM, gdy WebGL jest niedostępny
  lub traci kontekst. Animowany kursor i obsługa trybu vim pozostają dostępne.

Limit dotyczy oczekującego wyjścia terminala, nie całej pamięci aplikacji ani
procesów agentów. Nie wykonano pomiaru RAM ani opóźnienia wielu klientów Claude Code.

### Podgląd Markdown

- Pliki `.md` i `.markdown` mają przełącznik **Preview / Source**: nagłówki,
  listy, tabele, cytaty, linki i bloki kodu można oglądać jako sformatowany dokument.
- Podgląd pokazuje także niezapisane zmiany; powrót do źródła i zapis lokalny
  lub przez SFTP zachowują oryginalny tekst Markdown.
- Treść dopasowuje się do szerokości panelu, również po powiększeniu na cały
  obszar aplikacji i po przywróceniu poprzedniego rozmiaru.
- W podglądzie działają wyszukiwanie oraz przewijanie, zaznaczanie i kopiowanie
  w trybie vim. Surowy HTML jest wyłączony, a niebezpieczne adresy są filtrowane.
- Linki internetowe otwierają się w przeglądarce systemowej.

### Sprawdzenie wydania

- 13 testów Rust, w tym zachowanie kolejności i limitu danych PTY.
- Test mostka PTY: potwierdzenia, historia i cykl zamykania/otwierania widoku.
- Test podglądu w Chrome: formatowanie, niezapisany tekst, zapis, wyszukiwanie,
  vim i bezpieczeństwo treści; ścieżka SFTP sprawdzana na atrapach API.
- Sprawdzenie typów TypeScript i kompilacja produkcyjna.

Wydania macOS mają podpis ad-hoc, bez notaryzacji Apple.
