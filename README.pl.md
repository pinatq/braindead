# BrainDead

> 🇵🇱 To jest **polskie tłumaczenie** README (kopia). Wersja źródłowa (angielska): [README.md](README.md).

Desktopowy, **kafelkowy multiplexer** w stylu TradingView: w jednym oknie układasz obok siebie
**terminale systemowe**, **przeglądarki**, **viewer plików** (PDF / obrazy / docx / tekst), **eksplorator
plików** (lokalny i przez SSH/SFTP) oraz **agentów AI z linii poleceń** (Claude Code, Gemini, Codex,
Aider, Kimi Code, Goose, opencode, Amazon Q). Całość jest klawiaturocentryczna — z opcjonalnym, w pełni
remapowalnym **trybem vim** — i ma numerowane przestrzenie robocze, notatki, globalne wyszukiwanie
(⌘F), „Autopilota" oraz monitor RAM z trybem oszczędnym.

Zbudowane na **Electron 31 + React 18 + TypeScript + zustand** (terminale: node-pty + xterm.js,
przeglądarka: `<webview>`, PDF: pdf.js).

> Status: **alpha** — rdzeń działa, dochodzą szlify.

---

## 📺 Wideo

[![BrainDead — przewodnik](https://img.youtube.com/vi/1sJv4KSYNzM/maxresdefault.jpg)](https://youtu.be/1sJv4KSYNzM)

▶ **[Zobacz przewodnik na YouTube](https://youtu.be/1sJv4KSYNzM)**

---

## ⬇️ Pobieranie

Kliknij swoją platformę i zainstaluj jak każdą inną aplikację.

| Platforma | Pobierz | Instalacja |
|---|---|---|
| **macOS — Apple Silicon** (M1/M2/M3/M4) | [BrainDead-0.0.2-arm64.dmg](https://github.com/pinatq/braindead/releases/latest/download/BrainDead-0.0.2-arm64.dmg) | otwórz `.dmg`, przeciągnij **BrainDead.app** do **Aplikacji** |
| **macOS — Intel** (x86_64) | [BrainDead-0.0.2-x64.dmg](https://github.com/pinatq/braindead/releases/latest/download/BrainDead-0.0.2-x64.dmg) | otwórz `.dmg`, przeciągnij **BrainDead.app** do **Aplikacji** |
| **Windows 10/11** (x64) | [BrainDead-0.0.2-x64.exe](https://github.com/pinatq/braindead/releases/latest/download/BrainDead-0.0.2-x64.exe) | uruchom instalator, wybierz folder, dalej → dalej |
| **Linux — AppImage** (każda dystrybucja) | [BrainDead-0.0.2-x86_64.AppImage](https://github.com/pinatq/braindead/releases/latest/download/BrainDead-0.0.2-x86_64.AppImage) | `chmod +x BrainDead-*.AppImage && ./BrainDead-*.AppImage` |

### Linux — przez menedżer pakietów

```bash
# Arch / Manjaro
sudo pacman -U BrainDead-0.0.2-x64.pacman

# Ubuntu / Debian / Pop!_OS
sudo apt install ./BrainDead-0.0.2-amd64.deb      # albo:  sudo dpkg -i BrainDead-0.0.2-amd64.deb

# Fedora / RHEL / openSUSE
sudo dnf install ./BrainDead-0.0.2-x86_64.rpm     # albo:  sudo rpm -i BrainDead-0.0.2-x86_64.rpm
```

> **Uwaga macOS** — build **nie jest** podpisany Developer ID (tylko podpis ad-hoc). Przy pierwszym
> uruchomieniu Gatekeeper może marudzić; albo **prawy klik → Otwórz**, albo:
> ```bash
> xattr -dr com.apple.quarantine /Applications/BrainDead.app
> ```
>
> Wszystkie instalatory powstają z `npm run package` (patrz [Skrypty i build](#skrypty-i-build));
> dokładne nazwy plików lądują w `release/`.

> **BSD** — binarki nie ma i nie będzie: Electron nie wydaje oficjalnych buildów dla FreeBSD/OpenBSD,
> więc nie ma z czego uczciwie zrobić paczki. Na FreeBSD możesz uruchomić projekt ze źródeł w oparciu
> o port `devel/electron*` — zainstaluj port i Node, potem `npm install && npm run build` i odpal
> systemowym Electronem (`electron .` w repo, bo `npm start` próbowałby pobrać niedostępną binarkę
> upstreamu). To teren nieprzetestowany.

### Aktualizacje

> ⚠️ **Brak auto-update — autor jest za biedny, żeby go ogarnąć 😅.** Nie ma updatera w aplikacji; żeby
> zaktualizować, pobierasz nowy build i instalujesz ręcznie.

Prawdziwy auto-updater wymaga podpisanych buildów i hostingu wydań — czyli Apple Developer ID ($99/rok)
i miejsca na pliki — a autora na to teraz nie stać (te buildy są ad-hoc, a macOS i tak auto-aktualizuje
tylko aplikacje podpisane Developer ID). Żeby zaktualizować, pobierz nowy build i zainstaluj go na
starym — Twoje dane zostają (siedzą w systemowym folderze danych aplikacji, nie w samej aplikacji):

- **macOS** — otwórz nowy `.dmg`, przeciągnij **BrainDead.app** do Aplikacji, zastąp stary.
- **Windows** — uruchom nowy instalator; podmienia istniejącą instalację w miejscu.
- **Linux** — przeinstaluj pakiet (`sudo pacman -U …` / `sudo apt install ./…deb` / `sudo dnf install
  ./…rpm`), albo po prostu podmień plik `.AppImage`.

Notatki, układy, przestrzenie, skróty, połączenia SSH i konta agentów przeżywają aktualizację — nic z
tego nie jest trzymane wewnątrz aplikacji.

---

## Spis treści
- [Uruchomienie ze źródeł](#uruchomienie-ze-źródeł)
- [Górny pasek](#górny-pasek)
- [Panele i tryby](#panele-i-tryby)
  - [Terminal](#1-terminal-_)
  - [Przeglądarka](#2-przeglądarka-)
  - [Viewer plików](#3-viewer-plików-)
  - [Eksplorator plików](#4-eksplorator-plików-)
  - [Agent AI](#5-agent-ai-)
- [Układy paneli](#układy-paneli)
- [Przestrzenie robocze](#przestrzenie-robocze)
- [Notatki](#notatki)
- [Wyszukiwanie ⌘F](#wyszukiwanie-f)
- [Autopilot — auto-scroll i auto-approve](#autopilot--auto-scroll-i-auto-approve)
- [Tryb vim](#tryb-vim)
- [Skróty klawiszowe](#skróty-klawiszowe)
- [Agenci AI — szczegóły](#agenci-ai--szczegóły)
- [SSH / SFTP](#ssh--sftp)
- [RAM i tryb oszczędny](#ram-i-tryb-oszczędny)
- [Ustawienia — wszystkie zakładki](#ustawienia--wszystkie-zakładki)
- [Dane i prywatność](#dane-i-prywatność)
- [Architektura kodu (data sheet)](#architektura-kodu-data-sheet)
- [Skrypty i build](#skrypty-i-build)
- [Znane ograniczenia](#znane-ograniczenia)

---

## Uruchomienie ze źródeł

Wymagania: **Node.js 18+** i npm; macOS / Windows / Linux.

```bash
npm install        # zależności + rebuild node-pty + naprawa uprawnień spawn-helper (postinstall)
npm run dev        # tryb deweloperski z hot-reloadem
npm run build      # bundle produkcyjne do out/
npm run package    # instalka (dmg / nsis / AppImage / deb / rpm / pacman) do release/
```

Jeśli `node-pty` zgłosi `posix_spawnp failed` (zdarza się w Electronie na macOS):
```bash
node scripts/fix-pty-perms.cjs
```

---

## Górny pasek

Cienki pasek na górze, oddzielony linią od obszaru paneli. Od lewej:

| Element | Co robi |
|---|---|
| **📝 Notes** | Otwiera/zamyka panel notatek. Można **upuścić plik z eksploratora na ten przycisk** → doda się jako załącznik. |
| **◀ N ▶** | Przełącznik przestrzeni roboczych (numerowanych). Klik w numer → skok do dowolnej. |
| **>\_ 🌐 📄 📁 (🤖)** | **Przełącznik trybu aktywnego panelu**: terminal / przeglądarka / viewer / eksplorator / agent AI. Ikona 🤖 pojawia się tylko, gdy włączysz agentów w ustawieniach. |
| **wskaźnik RAM** | Bieżące zużycie pamięci; klik otwiera panel RAM. Zmienia kolor po przekroczeniu progów. |
| **picker układów** | Wybór siatki paneli w stylu TradingView. |
| **🗑 Pane / 🗑 WS** | Ubij aktywny panel / całą przestrzeń (zawsze z potwierdzeniem). |
| **⚙** | Ustawienia. |

Aktywny panel ma **niebieską ramkę**. Najechanie na elementy paska pokazuje dymki podpowiedzi.

---

## Panele i tryby

Każdy kafelek (panel) może działać w jednym z pięciu trybów. Tryb zmieniasz przyciskiem na pasku,
skrótem, albo cyklem (terminal → przeglądarka → viewer → eksplorator → agent).

**Ważne:** terminal **nie ginie** przy zmianie trybu — proces żyje w tle (proces główny trzyma PTY i
bufor historii), więc po powrocie do terminala masz całą historię. Dziewiczy terminal (bez żadnej
historii) jest zwalniany przy opuszczeniu, żeby nie marnować zasobów.

Każdy panel — niezależnie od trybu — ma dwie kontrolki, które nie wchodzą w drogę, dopóki nie najedziesz
na panel:

- **Zoom (⤢)**, prawy górny róg. Rozciąga panel na **całą siatkę paneli** (zoom jak w tmuxie); górny
  pasek, statusline i panel notatek zostają na miejscu, a pozostałe panele zostają zamontowane i działają
  dalej pod spodem. W zoomie przycisk zmienia się w **⤡** i jest podświetlony. Przywracasz kolejnym
  klikiem, bindem `pane.zoomExit` albo przejściem na inny panel **z klawiatury** (⌘1–⌘9, `Ctrl+Tab`,
  `Ctrl-w h/j/k/l`) — zoomowany panel zasłania resztę, więc kliknięciem ich nie wybierzesz. Zoom zdejmuje
  też zmiana układu i przełączenie przestrzeni. To stan runtime: nie zapisuje się do `state.json` i znika
  po restarcie. Oba bindy — `pane.zoom` i `pane.zoomExit` — są **bez domyślnego klawisza**; przypisujesz
  je w ustawieniach → Skróty.
- **Nazwa panelu (✎)**, lewy górny róg. Klik pozwala nazwać panel (nazwa zapisuje się z przestrzenią).
  W nienazwanym panelu chip jest niewidoczny, dopóki nie najedziesz na panel.

### 1. Terminal (`>_`)
- Prawdziwy terminal systemowy (node-pty + xterm.js), Twoja domyślna powłoka.
- Pełny scrollback trzymany w pamięci (do ~200 kB na sesję — element trybu oszczędnego).
- W trybie vim działa **copy-mode** (patrz [Tryb vim](#tryb-vim)): ruchomy kursor, zaznaczanie i yank
  jak w neovim.
- Współpracuje z [Find ⌘F](#wyszukiwanie-f) (skan bufora) oraz [Auto-approve](#autopilot--auto-scroll-i-auto-approve).

### 2. Przeglądarka (`🌐`)
Mini-przeglądarka oparta o `<webview>`:
- **Zakładki**, pasek adresu, **wstecz / dalej / odśwież**.
- **Usypianie nieaktywnych kart** — zwalnia RAM (limit żywych kart w ustawieniach).
- **Wymuszanie dark mode** na stronach (`prefers-color-scheme: dark`, best-effort).
- **Auto-scroll** dla reels/shorts — strona sama przewija się w dół w losowym odstępie (patrz Autopilot).
- W trybie vim: scrollowanie `hjkl`, half-page, `gg`/`G`, **link hints (`f`)**, skok do pól (`i`),
  historia (`H`/`L`), focus paska adresu (`:`) — wszystko remapowalne.
- **Cookies i sesje zapisują się, wspólne per przestrzeń robocza** — wszystkie przeglądarki/karty w
  **tym samym workspace** dzielą jedną trwałą sesję (logowania, cookies, cache); **każdy inny workspace**
  ma swoją osobną. Możesz więc być zalogowany inaczej na tej samej stronie w różnych przestrzeniach.
- Domyślny adres startowy: DuckDuckGo.

### 3. Viewer plików (`📄`)
Podgląd plików otwartych z eksploratora (lokalnie lub przez SFTP):
- **Obrazy** — zoom / pan.
- **PDF przez pdf.js** — ostry zoom, dopasowanie do szerokości, **zaznaczalny tekst** (warstwa tekstowa).
- **.docx** (docx-preview).
- **Tekst / Markdown** — z **edycją i zapisem** (zapis lokalnie lub przez SFTP na zdalny host).
- **Tryb copy** (PDF/docx): karetka jak w vimie — `v` włącza kursor, `v` zaznacza, `y` kopiuje;
  w trybie vim sterowanie `hjkl`, zoom `+`/`-`/`0`.
- Find ⌘F działa też tu (PDF/docx/tekst).

### 4. Eksplorator plików (`📁`)
Przeglądarka katalogów — **lokalna oraz zdalna przez SSH/SFTP**:
- Nawigacja po folderach, **podpowiedzi ścieżek**, pasek ścieżki (wpisanie lokalizacji).
- **Otwieranie plików w viewerze**, **„send to notes"** (dołącz plik do notatek).
- **Nowy folder / nowy plik / usuwanie** (usuwanie zawsze z potwierdzeniem) — także menu pod prawym
  przyciskiem myszy.
- Historia: wstecz / dalej / home (`~`).
- Wybór hosta SSH: gdy masz zapisane połączenia, eksplorator chodzi po **zdalnym** systemie plików.
- Pełna nawigacja vim: `j/k` ruch, `l` wejście, `h` w górę, `gg/G`, `o` (otwórz w viewerze),
  `n` (do notatek), `D` (usuń), `N` (nowy folder), `F` (nowy plik), `:` (pasek ścieżki).

### 5. Agent AI (`🤖`)
Piąty tryb: uruchamia w panelu **dowolne terminalowe CLI AI** — Claude Code, Gemini CLI, Codex CLI,
Aider, Kimi Code, Goose, opencode, Amazon Q. Wiele kont, **każde w pełni izolowane** (osobny folder konfiguracji),
więc różne konta działają równolegle w różnych panelach i nie gryzą się ze sobą. Może działać lokalnie
**albo na zdalnym serwerze przez SSH**. Pełen opis: [Agenci AI](#agenci-ai--szczegóły).

---

## Układy paneli

Picker układów (na pasku) daje **presety od 1 aż do 16 paneli** w stylu TradingView (pojedynczy,
kolumny, rzędy, siatki; zbalansowane siatki 7–16 są generowane automatycznie). Zmiana układu:
- **dokłada** brakujące panele (świeże terminale),
- **usuwa** nadmiarowe panele — a usuwane panele zwalniają swoje procesy (to świadoma akcja).

W trybie vim układy zmieniasz też prefiksem `Ctrl-w` (`s` = rzędy, `v` = kolumny, `o` = jeden panel).

---

## Przestrzenie robocze

Numerowane, niezależne zestawy paneli (`◀ N ▶`):
- **Lazy-load** — przestrzeń powstaje przy pierwszym wejściu.
- **Sprzątanie** — przy opuszczeniu **nietknięta** przestrzeń jest zwalniana (procesy + reset); używana
  zostaje zamontowana w tle (strony przeglądarki nie ładują się od nowa po powrocie).
- **Własne nazwy** przestrzeni.
- Skoki: poprzednia / następna / „skok do numeru" (wpisujesz numer).
- MRU (ostatnio używany panel) liczone w obrębie przestrzeni.

---

## Notatki

Panel notatek (📝 Notes):
- Swobodne pisanie (zapisywane na bieżąco).
- **Załączniki** — wklej lub przeciągnij dowolny plik / zrzut ekranu; z eksploratora „send to notes"
  albo upuść plik na przycisk Notes.
- **Wyczyść** (czyści tekst i załączniki) oraz **Pobierz dump** (eksport zawartości).
- Find ⌘F działa też w notatkach.

---

## Wyszukiwanie (⌘F)

Globalny pasek wyszukiwania (domyślnie **⌘F / Ctrl+F**, remapowalny) działa **w każdym panelu z
tekstem**, dobierając mechanizm do trybu:
- **terminal** — skan bufora xterm i zaznaczenie trafienia,
- **viewer** (PDF / docx / tekst) — podświetlenie przez CSS Custom Highlight API,
- **notatki** — wyszukiwanie w polu tekstowym,
- **przeglądarka** — natywne `findInPage` `<webview>`,
- **eksplorator** — filtr/skok po wpisach.

---

## Autopilot — auto-scroll i auto-approve

Dwie automatyzacje, każda z **głównym włącznikiem** (master checkbox) i **losowym odstępem od–do
sekund** — losowość zmniejsza „mechaniczność". Włączasz je per panel (na aktywnym), gdy główny
przełącznik jest aktywny.

### Auto-scroll (przeglądarka)
- Strona z reels/shorts sama przewija się w dół co losowy odstęp (np. 15–30 s).
- Włącznik główny + zakres w ustawieniach (zakładka **Browser**); na aktywnym panelu-przeglądarce
  włączasz go bindem `pane.autoscroll`. Aktywny panel ma **czerwoną ramkę**.

### Auto-approve (terminal)
- Na terminalu co losowy odstęp (np. 5–8 s) program sam wciska **Enter** — np. do zatwierdzania
  promptów „approve?" w narzędziach CLI.
- Włącznik główny + zakres w ustawieniach (zakładka **Autopilot**); na aktywnym terminalu włączasz go
  bindem `pane.autoApprove`. Aktywny terminal ma **zieloną ramkę** i plakietkę „AUTO ↵".
- Auto-approve dotyczy tylko terminala — gaśnie, gdy panel przestaje nim być.

> Stany „który panel jedzie" są **runtime** (nie zapisują się na dysk) — po restarcie auto-pilot jest
> wyłączony, dopóki znów go nie włączysz.

---

## Tryb vim

Opcjonalny, włączany w ustawieniach. **Cały keymap jest remapowalny** (zakładka **Vim**). Klawisze
zapisuje się jako tokeny: pojedynczy znak (`j`, wielkość ma znaczenie: `G` = Shift+g), `Space`,
`C-d` (z Ctrl), `gg` (podwójne wciśnięcie <500 ms), `''` (wyłączone).

**Nawigacja oknami — prefiks `Ctrl-w`** (jak w tmux/vim): `h/j/k/l` fokus w kierunku, `w`/`W` cykl,
`q` ubij panel, `s` split w rzędy, `v` split w kolumny, `o` jeden panel. Stan oczekiwania na drugi
klawisz widać na statusline.

Domyślne keymapy (wszystkie do zmiany):

| Kontekst | Klawisze (domyślne) |
|---|---|
| **Terminal (NORMAL/copy-mode)** | `h j k l`, `C-d`/`C-u` (half page), `w/b/e` (słowa), `0`/`$`, `gg`/`G`, `v` (visual), `V` (visual line), `y` (yank), `i` (INSERT) |
| **Przeglądarka** | `h j k l`, `d`/`u`, `gg`/`G`, `f` (link hints), `i` (pola), `H`/`L` (historia), `:` (adres) |
| **Okna (Ctrl-w)** | `h j k l`, `w`/`W`, `q`, `s`, `v`, `o` |
| **Viewer** | `h j k l`, `d`/`u`, `gg`/`G`, `+`/`-`/`0` (zoom), `v` (copy mode), `V` (visual), `y` (yank) |
| **Eksplorator** | `j`/`k`, `l` (wejdź), `h` (w górę), `gg`/`G`, `o` (viewer), `n` (notatki), `D` (usuń), `N` (folder), `F` (plik), `:` (ścieżka) |

Wyjście z INSERT do NORMAL w terminalu: do wyboru **`Esc`** lub **podwójny `Esc`** (ustawienia → Vim).
Statusline na dole pokazuje tryb (INSERT/NORMAL) aktywnego terminala i stan prefiksu `Ctrl-w`.

**Programy pełnoekranowe (nvim, htop, lazygit, less).** W momencie, gdy program przełącza terminal na
*alternate screen*, tryb vim odpuszcza: panel wychodzi z NORMAL, a wszystkie klawisze lecą prosto do
programu — `hjkl`, `Esc`, `i`, `y` nie są przechwytywane. Stan śledzi proces główny bezpośrednio ze
strumienia PTY (DECSET `?1049h/l`, `?1047`, `?47`) i jest nadrzędny wobec typu bufora xterma, więc
zostaje poprawny po przemontowaniu panelu (zmiana trybu panelu, przestrzeni, restart okna) — czyli
dokładnie tam, gdzie stare sprawdzanie po buforze się myliło i aplikacja głuchła na własne bindy. Po
powrocie do panelu z działającym programem BrainDead szarpie rozmiarem, żeby program się przerysował.
Po wyjściu z programu NORMAL i copy-mode wracają.

---

## Skróty klawiszowe

Globalne, **konfigurowalne** skróty (ustawienia → **Shortcuts**). Bind to kombinacja
`Meta+Control+Alt+Shift+KEY`; pusty = brak. Pełna lista akcji:

| Grupa | Akcje | Domyślnie |
|---|---|---|
| **Panes** | Focus panelu 1–16; **Switch panes** (tap = ostatni, hold = cykl) MRU; następny/poprzedni wg indeksu; **fullscreen panelu** (`pane.zoom`) / **wyjście z fullscreena** (`pane.zoomExit`) | ⌘1–⌘9, ⌘0 (10), MRU = `Ctrl+Tab`; obie akcje fullscreena startują bez klawisza |
| **Pane mode** | Aktywny panel → Terminal / Browser / Viewer / **Claude/Agent**; cykl trybów | puste (cykl/tryby do ustawienia) |
| **Browser tabs** | Nowa / zamknij / następna / poprzednia karta; **toggle auto-scroll** | ⌘T, ⌘W, ⌘⇧], ⌘⇧[ |
| **Panels** | Toggle notatek; picker układów; ustawienia | puste |
| **Find** | Find w panelu | ⌘F |
| **Auto-approve** | Toggle auto-approve (terminal) | puste |
| **Workspaces** | Poprzednia / następna / skok do numeru | puste |
| **Explorer** | Wstecz / dalej / home / focus ścieżki / nowy folder / nowy plik | puste |

> Akcje kontekstowe (karty, eksplorator, auto-scroll, auto-approve) działają tylko, gdy aktywny panel
> jest w odpowiednim trybie — inaczej są no-op. `mode.claude` działa **nawet bez** włączonego checkboxa
> agentów (sam skrót przełącza panel w tryb agenta).

---

## Agenci AI — szczegóły

5. tryb panelu, włączany w **Ustawienia → Agents** (checkbox „pokaż agentów w pasku trybów"; sam skrót
`mode.claude` działa niezależnie od checkboxa).

**Obsługiwane CLI** (rejestr [src/shared/agents.ts](src/shared/agents.ts)):

| Narzędzie | Komenda | Izolacja configu | Klucz API (tryb „api") | Auto-instalacja |
|---|---|---|---|---|
| Claude Code | `claude` | `CLAUDE_CONFIG_DIR` | `ANTHROPIC_API_KEY` | `curl …claude.ai/install.sh \| bash` |
| Gemini CLI | `gemini` | `XDG_CONFIG_HOME` | `GEMINI_API_KEY` | `npm i -g @google/gemini-cli` |
| Codex CLI | `codex` | `CODEX_HOME` | `OPENAI_API_KEY` | `npm i -g @openai/codex` |
| Kimi Code | `kimi` | `XDG_CONFIG_HOME` | `MOONSHOT_API_KEY` | `curl …code.kimi.com/install.sh \| bash` |
| Aider | `aider` | (klucz API) | `OPENAI_API_KEY` | `pip install -U aider-chat` |
| Goose | `goose` | `XDG_CONFIG_HOME` | — | ręcznie |
| opencode | `opencode` | `XDG_CONFIG_HOME` | — | ręcznie |
| Amazon Q | `q` | — | — | ręcznie |

(Antigravity / Cursor / Windsurf są celowo poza listą — to IDE, nie CLI.)

Kimi Code autoryzujesz przez `/login` (OAuth w przeglądarce) albo `MOONSHOT_API_KEY`; na Windowsie
instalator to `irm https://code.kimi.com/install.ps1 | iex`.

> **Izolacja configu przy SSH** — skopiowany token podchwytują na zdalnym hoście tylko narzędzia z własną
> zmienną katalogu configu (`CLAUDE_CONFIG_DIR`, `CODEX_HOME`). Te oparte o XDG — Gemini, Kimi Code,
> Goose, opencode — używają na serwerze domyślnej lokalizacji configu, więc logujesz się tam raz.

**Konta (profile):** w ustawieniach dodajesz konta; każdy wiersz = nazwa → wybór narzędzia → sposób
autoryzacji (**login** OAuth przez CLI **albo** klucz **API**) → opcjonalny **stały folder lokalny**
(📁) i opcjonalna **stała ścieżka zdalna** (🌐 dla SSH). Klucze API trzymane są lokalnie (jak hasło SSH).
Na dole zakładki jest sekcja **CLI tools**: status każdego narzędzia (zainstalowane → wyblakłe
„✓ installed", inaczej przycisk **Install CLI**).

**Izolacja:** każde konto dostaje własny folder configu w `userData` (`claude/<id>` dla Claude,
`agents/<id>` dla reszty), ustawiany przez zmienną narzędzia (`CLAUDE_CONFIG_DIR`/`CODEX_HOME`/
`XDG_CONFIG_HOME`). Dzięki temu OAuth/tokeny różnych kont się nie mieszają.

**Uruchomienie (panel agenta):**
1. U góry **przełącznik celu**: `💻 Local` albo lista zapisanych **VPS** (SSH). Wybierasz cel.
2. Klikasz **konto** — startuje wybrane CLI w wybranym folderze.
   - **Local**: jeśli konto ma stały folder, leci od razu; inaczej pyta o folder (natywny dialog).
   - **SSH**: konto + jego config (token) **kopiują się na wybrany host**, więc nie logujesz się od
     nowa; jeśli na zdalnym **brak CLI — instaluje je**; jeśli brak ścieżki — startuje w **home (`~`)**.
3. Picker chodzi **vimem** (`j/k`/strzałki podświetlają, `Enter`/`l` wybiera, `h`/`Esc` zamyka listę).

**Statusy SSH na żywo** w panelu: `Connecting…` → `Installing <CLI> on <host>…` (gdy brak CLI) →
`Transferring tokens to <host>…` (przenoszenie sesji) → `Done`. Operacja kopiowania tokenu na zdalny
host jest **zawsze za potwierdzeniem** (`confirm()`).

Po starcie agenta panel to zwykły terminal (xterm) z osobnym kluczem PTY (`claude:<paneId>:<profileId>`),
więc nie koliduje z normalnym terminalem na tym samym panelu. Przycisk **⟳** w nagłówku zmienia
konto/lokalizację.

---

## SSH / SFTP

Zapisane połączenia SSH (**Ustawienia → SSH**) służą dwóm rzeczom: **eksploratorowi** (zdalny system
plików + edycja plików w viewerze przez SFTP) oraz **agentom AI** (zdalne uruchamianie CLI).

- Połączenie = **nazwa + komenda** (np. `ssh vps` albo `ssh user@host -p 2222`) + opcjonalne **hasło**.
- **Autoryzacja kluczem** działa przez `~/.ssh/config` lub agenta SSH (jak w zwykłym `ssh`); alias
  hosta z `~/.ssh/config` jest respektowany.
- **Aktywne połączenia żyją tylko w pamięci procesu głównego** — nie są zapisywane na dysk. Zapisywana
  jest jedynie konfiguracja (nazwa + komenda + ewentualne hasło).
- Dla agentów: `scp` przenosi izolowany folder konta na zdalny host (token), a `command -v` sprawdza i
  w razie potrzeby instaluje CLI na zdalnym. Ścieżki (`~/.local/bin` itd.) są dokładane do PATH, więc
  świeżo zainstalowane CLI jest od razu widoczne.

---

## RAM i tryb oszczędny

Monitor pamięci (wskaźnik na pasku + panel RAM) i **tryb oszczędny 🥔**:
- Pokazuje zużycie aplikacji, wolny i całkowity RAM systemu.
- **Limity i mitygacje** (best-effort, nie twardy limit):
  - docelowy limit RAM aplikacji; po przekroczeniu (gdy „enforce") — usypianie kart + **blokada
    uruchamiania nowych przeglądarek**,
  - **usypianie nieaktywnych kart** po N minutach bezczynności,
  - minimalny wolny RAM systemu; poniżej progu — blokada nowych przeglądarek.
- Limit liczby równocześnie „żywych" przeglądarek (1–6).
- Wskaźnik zmienia kolor przy przekroczeniu; próba odpalenia przeglądarki ponad limit otwiera panel RAM.

---

## Ustawienia — wszystkie zakładki

Modal ustawień (⚙). Zakładki:

1. **Shortcuts** — przechwytywanie i edycja globalnych skrótów (per akcja), reset do domyślnych.
2. **Vim** — włącznik trybu vim; wybór wyjścia z INSERT (`Esc` / podwójny `Esc`); remap całego keymapu
   pogrupowany (Terminal / Browser / Windows / Viewer / Explorer); reset.
3. **Browser** — limit żywych kart, wymuszanie dark mode, **auto-scroll** (główny włącznik + zakres
   sekund od–do).
4. **Autopilot** — **auto-approve** (główny włącznik + zakres sekund od–do między Enterami).
5. **Agents** — włącznik 5. trybu; lista kont (nazwa / narzędzie / login lub API / folder lokalny /
   ścieżka zdalna); sekcja **CLI tools** ze statusem i przyciskiem Install dla każdego narzędzia.
6. **SSH** — zapisane połączenia (nazwa + komenda + opcjonalne hasło), dodawanie/edycja/usuwanie.
7. **RAM** — wszystkie progi i mitygacje opisane wyżej.

Dowolną zakładkę można otworzyć kontekstowo (np. z panelu agenta link „Manage accounts" prowadzi do
**Agents**, a „configure in Settings → SSH" do **SSH**).

---

## Dane i prywatność

Żadne dane użytkownika nie są trzymane w repozytorium. Wszystko ląduje w systemowym katalogu danych
aplikacji (`app.getPath('userData')`):

- **`state.json`** — notatki, układy, przestrzenie, adresy przeglądarek, skróty i keymap vima, ustawienia
  RAM/Autopilot, zapisane połączenia SSH (nazwa + komenda + ewentualne hasło), profile agentów (w tym
  klucze API);
- **załączniki notatek** (kopie plików);
- **`claude/<id>` i `agents/<id>`** — izolowane configi/tokeny kont agentów;
- **partycje przeglądarki per przestrzeń `persist:browser-ws<N>`** — cookies, cache, historia osadzonej
  przeglądarki, osobne dla każdej przestrzeni roboczej.

Dzięki temu spakowanie repo nie ujawnia notatek, plików, tokenów ani historii przeglądania. Repo zawiera
tylko kod oraz zasoby ikony: `build/icon-source.png` (grafika źródłowa) i `build/icon.png` (wygenerowane
logo, odtwarzalne komendą `python3 scripts/make-icon.py`). Operacje nieodwracalne (ubicie panelu/przestrzeni, usuwanie plików,
wysłanie tokenu na zdalny host) są **zawsze za potwierdzeniem**.

---

## Architektura kodu (data sheet)

```
src/
  main/        proces główny (Node/Electron)
    index.ts       okno, rejestracja handlerów IPC
    pty.ts         PtyManager — procesy PTY (node-pty), bufor historii, śledzenie alternate screen per
                   sesja (`pty:alt` — to trzyma tryb vim z dala od nvima), sesje agentów (lokalne + SSH)
    files.ts       operacje na plikach, dialogi (open file / open dir), zapisy
    ssh.ts         parsowanie komendy ssh (host/user/port/klucz, ~/.ssh/config), SFTP
    agents.ts      status/instalacja CLI agentów; agentSshSync (kopia configu + zdalna instalacja)
    store.ts       persystencja stanu (state.json) + wartości domyślne
    dialog.ts      natywne dialogi
  preload/
    index.ts       bezpieczny most IPC → window.api (typ Api)
    webview.ts     preload osadzanej przeglądarki (vim, link hints, scroll, run-bind)
  renderer/        UI React
    App.tsx, main.tsx
    components/    PaneGrid, TerminalPane, BrowserPane, ViewerPane (+PdfView), ExplorerPane,
                   AgentPane, NotesPanel, SettingsModal, Toolbar, TermBrowserSwitch,
                   WorkspaceSwitcher, LayoutPicker, FindBar, RamIndicator/RamControls, VimStatusline
    state/store.ts zustand: cały stan UI + akcje + debounce-persist
    shortcuts/     binds.ts (akcje+domyślne), dispatch.ts (wykonanie), useShortcuts.ts (nasłuch), find.ts
    vim/textVim.ts logika copy-mode/karetki w tekście
    layouts/presets.ts  presety układów 1–16
    lib/           domFind.ts (Highlight API), pdfPolyfill.ts
    styles/theme.css
  shared/        wspólne dla main/preload/renderer
    types.ts       typy + nazwy kanałów IPC (obiekt IPC)
    agents.ts      rejestr narzędzi AI (AGENT_TOOLS)
    vimKeys.ts     definicje akcji vima + matchVimKey/captureVimKey
scripts/
  fix-pty-perms.cjs   naprawa uprawnień spawn-helper node-pty
  smoke.cjs           smoke test (liczniki uchwytów/listenerów)
  alt-check.js        self-check śledzenia alternate screen (lustro main/pty.ts)
  make-icon.py        build/icon-source.png → build/icon.png (squircle macOS)
  stamp-downloaded.py ustawia macOS-owy „downloaded date" na aplikacji / instalatorach
build/
  icon-source.png     źródłowa grafika ikony
  icon.png            wygenerowana ikona aplikacji (squircle, 1024 px)
```

Komunikacja renderer ↔ main wyłącznie przez **IPC** (kanały zebrane w `IPC` w
[types.ts](src/shared/types.ts)) i bezpieczny most `window.api` z preloada. Stan UI trzyma zustand i
zapisuje go z debounce do `state.json`.

---

## Skrypty i build

| Komenda | Działanie |
|---|---|
| `npm run dev` | tryb deweloperski (electron-vite, hot-reload) |
| `npm run build` | bundle produkcyjne do `out/` |
| `npm run package` | `build` + electron-builder → instalka w `release/` |
| `npm run preview` / `start` | podgląd zbudowanej aplikacji |
| `npm run rebuild` | przebudowa natywnego `node-pty` |
| `node scripts/fix-pty-perms.cjs` | naprawa uprawnień spawn-helper (gdy `posix_spawnp failed`) |
| `node scripts/smoke.cjs` | smoke test procesu głównego |
| `node scripts/alt-check.js` | self-check logiki alternate screen, na której stoi tryb vim (asercje, na końcu `alt-check OK`) |
| `python3 scripts/make-icon.py` | regeneruje `build/icon.png` z `build/icon-source.png` (płótno 1024 px, korpus 824 px); wymaga Pillow |
| `python3 scripts/stamp-downloaded.py <ścieżka…>` | ustawia macOS-owy „downloaded date" (`kMDItemDownloadedDate`) na aplikacji/instalatorach; tylko macOS |

`npm run package` buduje domyślnie pod bieżący system. Cross-build: `electron-builder --win`
(na macOS/Linux wymaga wine) oraz `electron-builder --linux` (na macOS wymaga Dockera, albo odpal na
Linuksie). Targety są w [electron-builder.yml](electron-builder.yml).

---

## Znane ograniczenia

- Po **restarcie aplikacji** terminale startują na czysto (procesy PTY nie przeżywają zamknięcia) —
  odtwarzany jest układ, przestrzenie, adresy przeglądarek, notatki i konfiguracja paneli agentów.
- **Połączenia SSH** są aktywne tylko w trakcie sesji (żyją w pamięci procesu głównego); zapisywana jest
  jedynie ich konfiguracja.
- **Zmniejszenie układu** (mniej paneli) zamyka procesy usuwanych paneli.
- Stany Autopilota (które panele jadą) są runtime — nie przeżywają restartu.
- Auto-instalacja zdalnych CLI dla narzędzi npm-owych (Gemini/Codex) wymaga `npm`/`node` na serwerze;
  **Claude Code i Kimi Code instalują się przez `curl`** (Aider wymaga `python3`/`pip`). Goose, opencode
  i Amazon Q nie mają auto-instalatora — wrzucasz je na serwer sam.
- Ekran programu pełnoekranowego (alternate screen) nie wchodzi do ~200 kB scrollbacku — po powrocie do
  panelu program przerysowuje się sam i nie ma dla niego historii przewijania.
</content>
