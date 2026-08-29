# BrainDead

A desktop **tiling multiplexer** in the spirit of TradingView: in one window you arrange, side by side,
**system terminals**, **web browsers**, a **file viewer** (PDF / images / docx / text), a **file
explorer** (local and over SSH/SFTP), and **command-line AI agents** (Claude Code, Gemini, Codex, Aider,
Kimi Code, Goose, opencode, Amazon Q). It is keyboard-centric — with an optional, fully remappable **vim mode** —
and ships with numbered workspaces, notes, global find (⌘F), an "Autopilot", and a RAM monitor with an
eco mode.

Built on **Tauri 2 + Rust + React 19 + TypeScript + zustand** (terminals: native Rust PTY +
xterm.js; browser: the system's native webview; PDF: pdf.js).

> Status: **alpha** — the core is solid; polish is ongoing.

---

## 📺 Video

[![BrainDead — walkthrough](https://img.youtube.com/vi/1sJv4KSYNzM/maxresdefault.jpg)](https://youtu.be/1sJv4KSYNzM)

▶ **[Watch the walkthrough on YouTube](https://youtu.be/1sJv4KSYNzM)**

---

## ⬇️ Download

Click your platform, then install as usual.

| Platform | Download | Install |
|---|---|---|
| **macOS — Apple Silicon** (M1/M2/M3/M4) | [BrainDead_0.1.0_aarch64.dmg](https://github.com/pinatq/braindead/releases/latest/download/BrainDead_0.1.0_aarch64.dmg) | open the `.dmg`, drag **BrainDead.app** to **Applications** |
| **macOS — Intel** (x86_64) | [BrainDead_0.1.0_x64.dmg](https://github.com/pinatq/braindead/releases/latest/download/BrainDead_0.1.0_x64.dmg) | open the `.dmg`, drag **BrainDead.app** to **Applications** |
| **Windows 10/11** (x64) | [BrainDead_0.1.0_x64-setup.exe](https://github.com/pinatq/braindead/releases/latest/download/BrainDead_0.1.0_x64-setup.exe) | run the installer, pick a folder, next → next |
| **Linux — AppImage** (any distro) | [BrainDead_0.1.0_amd64.AppImage](https://github.com/pinatq/braindead/releases/latest/download/BrainDead_0.1.0_amd64.AppImage) | `chmod +x BrainDead_*.AppImage && ./BrainDead_*.AppImage` |

### Linux — via your package manager

```bash
# Ubuntu / Debian / Pop!_OS
sudo apt install ./BrainDead_0.1.0_amd64.deb      # or:  sudo dpkg -i BrainDead_0.1.0_amd64.deb

# Fedora / RHEL / openSUSE
sudo dnf install ./BrainDead-0.1.0-1.x86_64.rpm   # or:  sudo rpm -i BrainDead-0.1.0-1.x86_64.rpm
```

> **macOS note** — the build is **not** signed with a Developer ID (ad-hoc signature only). On first
> launch Gatekeeper may complain; either **right-click → Open**, or run:
> ```bash
> xattr -dr com.apple.quarantine /Applications/BrainDead.app
> ```
>
> All installers are produced by `npm run package` (see [Scripts & build](#scripts--build)); the exact
> file names land in `release/`.

> **BSD** — there is no binary, and there won't be one: Electron ships no official FreeBSD/OpenBSD
> builds, so there is nothing honest to package. On FreeBSD you can still run it from source against the
> `devel/electron*` port — install the port plus Node, then `npm install && npm run build` and start it
> with the system Electron (`electron .` from the repo, since `npm start` would fetch the unavailable
> upstream binary). Consider it untested territory.

### Updating

> ⚠️ **No auto-update — the author is too broke for it 😅.** There's no in-app updater; to update you
> download the new build and install it by hand.

A real auto-updater needs code-signed builds and a release host — i.e. an Apple Developer ID ($99/yr) and
somewhere to host the files — which the author can't be bothered / can't afford right now (these builds
are ad-hoc, and macOS only auto-updates Developer-ID-signed apps anyway). To update, grab the new build
and install it over the old one — your data is kept (it lives in the OS app-data folder, not in the app):

- **macOS** — open the new `.dmg`, drag **BrainDead.app** to Applications, replace the old one.
- **Windows** — run the new installer; it upgrades the existing install in place.
- **Linux** — reinstall the package (`sudo apt install ./…deb` / `sudo dnf install
  ./…rpm`), or just replace the `.AppImage` file.

Your notes, layouts, workspaces, shortcuts, SSH connections and agent accounts survive an update — none
of that is stored inside the app bundle.

---

## Table of contents
- [Run from source](#run-from-source)
- [The top bar](#the-top-bar)
- [Panes and modes](#panes-and-modes)
  - [Terminal](#1-terminal-_)
  - [Browser](#2-browser-)
  - [File viewer](#3-file-viewer-)
  - [File explorer](#4-file-explorer-)
  - [AI agent](#5-ai-agent-)
- [Layouts](#layouts)
- [Workspaces](#workspaces)
- [Notes](#notes)
- [Find (⌘F)](#find-f)
- [Autopilot — auto-scroll & auto-approve](#autopilot--auto-scroll--auto-approve)
- [Vim mode](#vim-mode)
- [Keyboard shortcuts](#keyboard-shortcuts)
- [AI agents — in depth](#ai-agents--in-depth)
- [SSH / SFTP](#ssh--sftp)
- [RAM & eco mode](#ram--eco-mode)
- [Settings — every tab](#settings--every-tab)
- [Data & privacy](#data--privacy)
- [Code architecture (data sheet)](#code-architecture-data-sheet)
- [Scripts & build](#scripts--build)
- [Known limitations](#known-limitations)

---

## Run from source

Requirements: **Node.js 18+**, **Rust** (stable, via [rustup](https://rustup.rs)); macOS / Windows / Linux.
On Linux also: `libwebkit2gtk-4.1-dev`, `librsvg2-dev`, `patchelf`, `libssl-dev`, `pkg-config`.

```bash
npm install              # frontend deps (no native rebuild — the PTY is Rust)
npm run tauri dev        # development mode with hot reload
npm run tauri build      # installer (dmg / nsis / AppImage / deb / rpm) into src-tauri/target/release/bundle/
```

The first Rust build takes a few minutes (release uses fat LTO); later ones are incremental.

---

## The top bar

A thin bar at the top, separated from the pane area by a hairline. Left to right:

| Element | What it does |
|---|---|
| **📝 Notes** | Opens/closes the notes panel. You can **drop a file from the explorer onto this button** → it is attached to the notes. |
| **◀ N ▶** | Workspace switcher (numbered). Click the number to jump to any workspace. |
| **>\_ 🌐 📄 📁 (🤖)** | **Mode switch for the active pane**: terminal / browser / viewer / explorer / AI agent. The 🤖 icon appears only when you enable agents in settings. |
| **RAM indicator** | Live memory usage; click to open the RAM panel. Changes color once thresholds are crossed. |
| **layout picker** | Pane grid presets, TradingView-style. |
| **🗑 Pane / 🗑 WS** | Kill the active pane / the whole workspace (always behind a confirmation). |
| **⚙** | Settings. |

The active pane has a **blue border**. Hovering over bar elements shows tooltips.

---

## Panes and modes

Each tile (pane) runs in one of five modes. Switch with the bar button, a shortcut, or by cycling
(terminal → browser → viewer → explorer → agent).

**Important:** a terminal **does not die** when you switch modes — the process keeps running in the
background (the main process holds the PTY and a history buffer), so when you come back to the terminal
you keep the full scrollback. A pristine terminal (no history at all) is released when you leave it, so
nothing is wasted.

Every pane — whatever mode it is in — carries two controls that stay out of your way until you point at
the pane:

- **Zoom (⤢)**, top-right corner. Blows the pane up over the **whole pane grid**, tmux-zoom style; the
  top bar, statusline and notes panel stay where they are, and the other panes stay mounted and keep
  running underneath. While zoomed the button turns into **⤡** and is highlighted. Restore it by
  clicking again, by the `pane.zoomExit` bind, or by moving to another pane **with the keyboard**
  (⌘1–⌘9, `Ctrl+Tab`, `Ctrl-w h/j/k/l`) — the zoomed pane covers the rest, so they can't be clicked.
  Changing the layout or switching workspaces also drops the zoom. It is runtime state: never saved to
  `state.json`, gone after a restart. Both binds — `pane.zoom` and `pane.zoomExit` — ship **without a
  default key**; assign them in settings → Shortcuts.
- **Pane name (✎)**, top-left corner. Click it to name the pane (the name is saved with the workspace).
  On an unnamed pane the chip is invisible until you hover the pane.

### 1. Terminal (`>_`)
- A real system terminal (native Rust PTY + xterm.js), your default shell.
- Full scrollback kept in memory (up to ~200 kB per session — part of eco mode).
- In vim mode it offers a **copy-mode** (see [Vim mode](#vim-mode)): a movable cursor, selection and yank
  just like neovim.
- Works with [Find ⌘F](#find-f) (buffer scan) and [Auto-approve](#autopilot--auto-scroll--auto-approve).

### 2. Browser (`🌐`)
A mini browser based on `<webview>`:
- **Tabs**, address bar, **back / forward / reload**.
- **Sleeping inactive tabs** — frees RAM (the live-tab cap lives in settings).
- **Force dark mode** on pages (`prefers-color-scheme: dark`, best-effort).
- **Auto-scroll** for reels/shorts — the page scrolls itself down at a random interval (see Autopilot).
- In vim mode: scroll `hjkl`, half-page, `gg`/`G`, **link hints (`f`)**, jump to inputs (`i`), history
  (`H`/`L`), focus the address bar (`:`) — all remappable.
- **Cookies & sessions persist, shared per workspace** — every browser/tab inside the **same workspace**
  shares one persistent session (logins, cookies, cache); each **other workspace** gets its own separate
  session. So you can be logged into the same site differently across workspaces.
- Default start page: DuckDuckGo.

### 3. File viewer (`📄`)
Previews files opened from the explorer (locally or over SFTP):
- **Images** — zoom / pan.
- **PDF via pdf.js** — crisp zoom, fit-to-width, **selectable text** (text layer).
- **.docx** (docx-preview).
- **Text / Markdown** — with **editing and saving** (writes locally, or over SFTP to a remote host).
- **Copy mode** (PDF/docx): a vim-like caret — `v` shows the cursor, `v` selects, `y` copies; in vim
  mode you steer with `hjkl`, zoom `+`/`-`/`0`.
- Find ⌘F works here too (PDF/docx/text).

### 4. File explorer (`📁`)
A directory browser — **local and remote over SSH/SFTP**:
- Folder navigation, **path autocomplete**, a path bar (type a location).
- **Open files in the viewer**, **"send to notes"** (attach a file to your notes).
- **New folder / new file / delete** (delete always behind a confirmation) — also via right-click menu.
- History: back / forward / home (`~`).
- SSH host selection: when you have saved connections, the explorer browses the **remote** filesystem.
- Full vim navigation: `j/k` move, `l` enter, `h` up, `gg/G`, `o` (open in viewer), `n` (to notes),
  `D` (delete), `N` (new folder), `F` (new file), `:` (path bar).

### 5. AI agent (`🤖`)
The fifth mode: runs **any terminal AI CLI** in the pane — Claude Code, Gemini CLI, Codex CLI, Aider,
Kimi Code, Goose, opencode, Amazon Q. Multiple accounts, **each fully isolated** (its own config folder), so
different accounts run in different panes at once without clashing. It can run locally **or on a remote
server over SSH**. Full details: [AI agents](#ai-agents--in-depth).

---

## Layouts

The layout picker (on the bar) offers **presets from 1 up to 16 panes** in TradingView style (single,
columns, rows, grids; balanced 7–16-pane grids are generated automatically). Changing the layout:
- **adds** missing panes (fresh terminals),
- **removes** surplus panes — and removed panes release their processes (a deliberate action).

In vim mode you also reshape layouts with the `Ctrl-w` prefix (`s` = rows, `v` = columns, `o` = single pane).

---

## Workspaces

Numbered, independent sets of panes (`◀ N ▶`):
- **Lazy-loaded** — a workspace is created the first time you enter it.
- **Cleanup** — when you leave, an **untouched** workspace is released (processes + reset); a used one
  stays mounted in the background (browser pages don't reload when you return).
- **Custom names** per workspace.
- Jumps: previous / next / "go to number" (type the number).
- MRU (most-recently-used pane) is tracked per workspace.

---

## Notes

The notes panel (📝 Notes):
- Free-form writing (saved continuously).
- **Attachments** — paste or drag any file / screenshot; from the explorer use "send to notes", or drop
  a file onto the Notes button.
- **Clear** (wipes text and attachments) and **Download dump** (export the contents).
- Find ⌘F works in notes too.

---

## Find (⌘F)

A global find bar (default **⌘F / Ctrl+F**, remappable) works **in every pane that has text**, picking
the mechanism per mode:
- **terminal** — scans the xterm buffer and selects the hit,
- **viewer** (PDF / docx / text) — highlights via the CSS Custom Highlight API,
- **notes** — searches the text field,
- **browser** — the `<webview>`'s native `findInPage`,
- **explorer** — filters/jumps across entries.

---

## Autopilot — auto-scroll & auto-approve

Two automations, each with a **master switch** and a **random interval (min–max seconds)** — the
randomness makes them feel less mechanical. You toggle them per pane (on the active one) while the master
switch is on.

### Auto-scroll (browser)
- A reels/shorts page scrolls itself down every random interval (e.g. 15–30 s).
- Master switch + range live in settings (the **Browser** tab); on the active browser pane you toggle it
  with the `pane.autoscroll` bind. The active pane gets a **red border**.

### Auto-approve (terminal)
- On a terminal, every random interval (e.g. 5–8 s) the app presses **Enter** by itself — handy for
  confirming "approve?" prompts in CLI tools.
- Master switch + range live in settings (the **Autopilot** tab); on the active terminal you toggle it
  with the `pane.autoApprove` bind. The active terminal gets a **green border** and an "AUTO ↵" badge.
- Auto-approve applies only to terminals — it stops the moment a pane stops being one.

> The "which pane is running" state is **runtime** (not saved to disk) — after a restart Autopilot is off
> until you turn it back on.

---

## Vim mode

Optional, toggled in settings. **The entire keymap is remappable** (the **Vim** tab). Keys are stored as
tokens: a single character (`j`; case matters: `G` = Shift+g), `Space`, `C-d` (with Ctrl), `gg` (a
double-press within 500 ms), `''` (disabled).

**Window navigation — the `Ctrl-w` prefix** (like tmux/vim): `h/j/k/l` focus in a direction, `w`/`W`
cycle, `q` kill the pane, `s` split into rows, `v` split into columns, `o` single pane. The pending state
(waiting for the second key) shows on the statusline.

Default keymaps (all changeable):

| Context | Keys (defaults) |
|---|---|
| **Terminal (NORMAL/copy-mode)** | `h j k l`, `C-d`/`C-u` (half page), `w/b/e` (words), `0`/`$`, `gg`/`G`, `v` (visual), `V` (visual line), `y` (yank), `i` (INSERT) |
| **Browser** | `h j k l`, `d`/`u`, `gg`/`G`, `f` (link hints), `i` (inputs), `H`/`L` (history), `:` (address) |
| **Windows (Ctrl-w)** | `h j k l`, `w`/`W`, `q`, `s`, `v`, `o` |
| **Viewer** | `h j k l`, `d`/`u`, `gg`/`G`, `+`/`-`/`0` (zoom), `v` (copy mode), `V` (visual), `y` (yank) |
| **Explorer** | `j`/`k`, `l` (enter), `h` (up), `gg`/`G`, `o` (viewer), `n` (notes), `D` (delete), `N` (folder), `F` (file), `:` (path) |

Leaving INSERT for NORMAL in a terminal: choose **`Esc`** or **double `Esc`** (settings → Vim). The
statusline at the bottom shows the active terminal's mode (INSERT/NORMAL) and the `Ctrl-w` prefix state.

**Fullscreen programs (nvim, htop, lazygit, less).** The moment a program switches the terminal to the
*alternate screen*, vim mode steps aside: the pane drops out of NORMAL and every keystroke goes straight
to the program — `hjkl`, `Esc`, `i`, `y` are never swallowed. That state is tracked in the main process
straight from the PTY stream (DECSET `?1049h/l`, `?1047`, `?47`) and outranks xterm's own buffer type, so
it stays correct after the pane is remounted (switching pane modes, workspaces, restarting the window) —
which is exactly the case where the old buffer-type check got it wrong and the app went deaf to its own
binds. Come back to a pane whose program is still running and BrainDead nudges a resize so the program
redraws itself. When the program exits, NORMAL and copy-mode come back.

---

## Keyboard shortcuts

Global, **configurable** shortcuts (settings → **Shortcuts**). A bind is a combo
`Meta+Control+Alt+Shift+KEY`; empty = none. The full list of actions:

| Group | Actions | Defaults |
|---|---|---|
| **Panes** | Focus pane 1–16; **Switch panes** (tap = last, hold = cycle) MRU; next/previous by index; **fullscreen pane** (`pane.zoom`) / **exit pane fullscreen** (`pane.zoomExit`) | ⌘1–⌘9, ⌘0 (10), MRU = `Ctrl+Tab`; both fullscreen actions start unbound |
| **Pane mode** | Active pane → Terminal / Browser / Viewer / **Claude/Agent**; cycle modes | empty (modes/cycle up to you) |
| **Browser tabs** | New / close / next / previous tab; **toggle auto-scroll** | ⌘T, ⌘W, ⌘⇧], ⌘⇧[ |
| **Panels** | Toggle notes; layout picker; settings | empty |
| **Find** | Find in pane | ⌘F |
| **Auto-approve** | Toggle auto-approve (terminal) | empty |
| **Workspaces** | Previous / next / go to number | empty |
| **Explorer** | Back / forward / home / focus path / new folder / new file | empty |

> Context actions (tabs, explorer, auto-scroll, auto-approve) fire only when the active pane is in the
> right mode — otherwise they are no-ops. `mode.claude` works **even without** the agents checkbox enabled
> (the shortcut alone flips the pane into agent mode).

---

## AI agents — in depth

The fifth pane mode, enabled in **Settings → Agents** (a checkbox "show agents in the mode switch"; the
`mode.claude` shortcut works regardless of the checkbox).

**Supported CLIs** (registry: [src/shared/agents.ts](src/shared/agents.ts)):

| Tool | Command | Config isolation | API key (mode "api") | Auto-install |
|---|---|---|---|---|
| Claude Code | `claude` | `CLAUDE_CONFIG_DIR` | `ANTHROPIC_API_KEY` | `curl …claude.ai/install.sh \| bash` |
| Gemini CLI | `gemini` | `XDG_CONFIG_HOME` | `GEMINI_API_KEY` | `npm i -g @google/gemini-cli` |
| Codex CLI | `codex` | `CODEX_HOME` | `OPENAI_API_KEY` | `npm i -g @openai/codex` |
| Kimi Code | `kimi` | `XDG_CONFIG_HOME` | `MOONSHOT_API_KEY` | `curl …code.kimi.com/install.sh \| bash` |
| Aider | `aider` | (API key) | `OPENAI_API_KEY` | `pip install -U aider-chat` |
| Goose | `goose` | `XDG_CONFIG_HOME` | — | manual |
| opencode | `opencode` | `XDG_CONFIG_HOME` | — | manual |
| Amazon Q | `q` | — | — | manual |

(Antigravity / Cursor / Windsurf are deliberately excluded — they are IDEs, not CLIs.)

Kimi Code authenticates with `/login` (OAuth in the browser) or `MOONSHOT_API_KEY`; on Windows the
installer is `irm https://code.kimi.com/install.ps1 | iex`.

> **Config isolation over SSH** — a copied token is only picked up on the remote host by the tools with a
> dedicated config-dir variable (`CLAUDE_CONFIG_DIR`, `CODEX_HOME`). The XDG-based ones — Gemini, Kimi
> Code, Goose, opencode — fall back to their default config location on the server, so you log in there
> once.

**Accounts (profiles):** in settings you add accounts; each row is name → tool → auth (**login** OAuth
via the CLI **or** an **API** key) → optional **fixed local folder** (📁) and optional **fixed remote
path** (🌐 for SSH). API keys are stored locally (like the SSH password). At the bottom of the tab is a
**CLI tools** section: status per tool (installed → a faded "✓ installed", otherwise an **Install CLI**
button).

**Isolation:** each account gets its own config folder under `userData` (`claude/<id>` for Claude,
`agents/<id>` for the rest), set via the tool's variable (`CLAUDE_CONFIG_DIR`/`CODEX_HOME`/
`XDG_CONFIG_HOME`). That keeps OAuth/tokens of different accounts from mixing.

**Launching (the agent pane):**
1. At the top, a **target selector**: `💻 Local` or a list of your saved **VPS** hosts (SSH). Pick a target.
2. Click an **account** — the chosen CLI starts in the chosen folder.
   - **Local**: if the account has a fixed folder it starts right away; otherwise it asks for a folder
     (native dialog).
   - **SSH**: the account and its config (token) are **copied to the chosen host**, so you don't log in
     again; if the **CLI is missing on the remote it gets installed**; if no path is set it starts in
     **home (`~`)**.
3. The picker is fully **vim-navigable** (`j/k`/arrows highlight, `Enter`/`l` selects, `h`/`Esc` closes
   the list).

**Live SSH status** in the pane: `Connecting…` → `Installing <CLI> on <host>…` (when the CLI is missing)
→ `Transferring tokens to <host>…` → `Done`. Copying a token to a remote host is **always behind a
confirmation** (`confirm()`).

Once the agent starts, the pane is a regular terminal (xterm) with its own PTY key
(`claude:<paneId>:<profileId>`), so it never collides with a normal terminal on the same pane. The **⟳**
button in the header changes the account/location.

---

## SSH / SFTP

Saved SSH connections (**Settings → SSH**) serve two purposes: the **explorer** (remote filesystem +
editing files in the viewer over SFTP) and **AI agents** (running CLIs remotely).

- A connection = **name + command** (e.g. `ssh vps` or `ssh user@host -p 2222`) + an optional **password**.
- **Key auth** works via `~/.ssh/config` or the SSH agent (just like plain `ssh`); a host alias from
  `~/.ssh/config` is respected.
- **Active connections live only in the main process's memory** — they are never written to disk. Only the
  configuration (name + command + optional password) is saved.
- For agents: `scp` copies the account's isolated config folder to the remote host (the token), and
  `command -v` checks for and, if needed, installs the CLI on the remote. The PATH gets `~/.local/bin`
  and friends prepended, so a freshly installed CLI is found immediately.

---

## RAM & eco mode

A memory monitor (bar indicator + RAM panel) and an **eco mode 🥔**:
- Shows app usage, free and total system RAM.
- **Thresholds and mitigations** (best-effort, not a hard cap):
  - a target app RAM cap; once crossed (with "enforce") — sleep tabs + **block launching new browsers**,
  - **sleep inactive tabs** after N idle minutes,
  - a minimum free system RAM; below the threshold — block new browsers.
- A cap on simultaneously "live" browsers (1–6).
- The indicator changes color when crossed; trying to launch a browser over the cap opens the RAM panel.

---

## Settings — every tab

The settings modal (⚙). Tabs:

1. **Shortcuts** — capture and edit global shortcuts (per action), reset to defaults.
2. **Vim** — vim-mode toggle; INSERT-exit choice (`Esc` / double `Esc`); remap the whole keymap, grouped
   (Terminal / Browser / Windows / Viewer / Explorer); reset.
3. **Browser** — live-tab cap, force dark mode, **auto-scroll** (master switch + min–max seconds).
4. **Autopilot** — **auto-approve** (master switch + min–max seconds between Enters).
5. **Agents** — the fifth-mode toggle; the accounts list (name / tool / login or API / local folder /
   remote path); a **CLI tools** section with status and an Install button per tool.
6. **SSH** — saved connections (name + command + optional password), add/edit/remove.
7. **RAM** — all the thresholds and mitigations described above.

Any tab can be opened contextually (e.g. the agent pane's "Manage accounts" link jumps to **Agents**, and
"configure in Settings → SSH" to **SSH**).

---

## Data & privacy

No user data is kept in the repository. Everything lands in the OS application-data folder
(macOS: `~/Library/Application Support/com.vibecoder.app`, Linux: `~/.config/com.vibecoder.app`,
Windows: `%APPDATA%\com.vibecoder.app`):

- **`state.json`** — notes, layouts, workspaces, browser addresses, shortcuts and the vim keymap,
  RAM/Autopilot settings, saved SSH connections (name + command + optional password), agent profiles
  (including API keys);
- **notes attachments** (file copies);
- **`claude/<id>` and `agents/<id>`** — isolated configs/tokens of agent accounts;
- **per-workspace browser data stores** — cookies, cache and history of the embedded browser,
  separate for each workspace (the equivalent of the Electron build's `persist:browser-ws<N>` partitions).

**Coming from the Electron build.** On first launch the app makes a one-time copy of `state.json`,
the notes attachments and the `claude/` and `agents/` folders from the old location (`…/vibe-coder`) —
only when nothing exists on the new side, so it can never overwrite fresher data. Browser cookies do
not carry over (Chromium format ≠ WebKit); you have to sign in again inside the panes.

**Pages in browser panes cannot reach the app.** Tauri permissions are attached to the UI webview
alone (`capabilities/ui.json` uses the `webviews` key, not `windows`), and internal events — terminal
output included — are addressed to it rather than broadcast. A capability scoped to the whole window
would let any visited page listen to `pty:data`.

So packaging the repo never leaks notes, files, tokens or browsing history. Irreversible actions (killing a pane/workspace, deleting files, uploading
a token to a remote host) are **always behind a confirmation**.

### Neovide-style cursor

The terminal cursor glides to its new position and stretches on the way (Neovide calls it
"cursor smear"). On by default, toggle in **Settings → Vim**.

The animation runs **only** while the cursor is moving — an idle terminal never wakes the
browser up.

---

## Driving it from outside (Neovim, Neovide, scripts)

BrainDead listens for commands, so other programs can open files in it and run things.
Put [`scripts/braindead`](scripts/braindead) somewhere on your `PATH`:

```bash
sudo ln -sf "$PWD/scripts/braindead" /usr/local/bin/braindead
```

| Command | What it does |
|---|---|
| `braindead open <file>` | opens the file in a viewer pane — if the layout has no spare pane it **adds one**, and the pane you are working in is left alone |
| `braindead run <command>` | switches to a **new workspace** and runs the command in a terminal there |

Two routes, picked automatically:

- a **unix socket** in the app data directory — reachable from **any** process on the machine:
  Neovide, a separate terminal, a script. This is the route that makes Neovide work, since its
  Neovim does not run inside a BrainDead pane;
- an **`OSC 7717` escape sequence** written to the terminal — for when the socket isn't reachable,
  which in practice means the far side of an `ssh` session. The stream goes through a terminal
  pane anyway, and the app reads it.

Without the helper, straight from a shell in a pane:

```bash
printf '\033]7717;open;/path/to/file.pdf\007'
```

### Konfiguracja Neovima

Rozmawiamy z aplikacją **bezpośrednio z Lua** przez gniazdo (`vim.uv`), bez wołania czegokolwiek
z `PATH`. To istotne: Neovide odpalone z Docka dostaje okrojony `PATH` i droga przez zewnętrzny
program potrafi po cichu nie zadziałać.

Wrzuć plik jako `~/.config/nvim/lua/config/braindead.lua`, a w `init.lua` **dodaj wywołanie** —
sam plik w `lua/` się nie ładuje:

```lua
require("config.braindead")
```

```lua
-- ~/.config/nvim/lua/config/braindead.lua
local uv = vim.uv or vim.loop
local M = {}

local KANDYDACI = {
  "~/Library/Application Support/com.vibecoder.app/braindead.sock",
  "~/.local/share/com.vibecoder.app/braindead.sock",
}

function M.gniazdo()
  for _, p in ipairs(KANDYDACI) do
    local s = vim.fn.expand(p)
    if vim.fn.getftype(s) == "socket" then return s end
  end
end

--- Zwraca false, gdy BrainDead nie działa — wtedy NIE przejmujemy akcji.
function M.send(verb, arg)
  local s = M.gniazdo()
  if not s then return false end
  local pipe = uv.new_pipe(false)
  pipe:connect(s, function(err)
    if err then pipe:close() return end
    pipe:write(verb .. "\t" .. (arg or "") .. "\n", function() pipe:close() end)
  end)
  return true
end

function M.open(p) return M.send("open", vim.fn.fnamemodify(p, ":p")) end
function M.run(c) return c ~= "" and M.send("run", c) end

-- PDF-y, .docx i obrazki otwieraj w BrainDeadzie zamiast w Preview.
-- BufReadCmd przejmuje wczytanie, więc binarka nie ląduje w buforze.
vim.api.nvim_create_autocmd("BufReadCmd", {
  group = vim.api.nvim_create_augroup("BrainDeadOpen", { clear = true }),
  pattern = { "*.pdf", "*.docx", "*.png", "*.jpg", "*.jpeg", "*.gif", "*.webp", "*.svg" },
  callback = function(ev)
    -- KRYTYCZNE: BufReadCmd zostawia bufor PUSTY. Jeśli masz auto-save na BufLeave/FocusLost,
    -- zapisze on ten pusty bufor NA PLIK i go wyzeruje. Te trzy linie muszą być pierwsze.
    vim.bo[ev.buf].buftype = "nofile"
    vim.bo[ev.buf].modifiable = false
    vim.bo[ev.buf].swapfile = false
    if not M.open(ev.file) then return false end -- aplikacja nie działa: Neovim robi swoje
    vim.schedule(function() pcall(vim.api.nvim_buf_delete, ev.buf, { force = true }) end)
    return true
  end,
})

-- Zamiast splita z terminalem — nowa przestrzeń w BrainDeadzie.
vim.keymap.set("n", "<leader>br", function() M.run(vim.fn.input("Komenda: ")) end)
vim.keymap.set("n", "<leader>bo", function() M.open(vim.fn.expand("%:p")) end)

return M
```

Do tego komenda `:BrainDead run npm test` i `:BrainDead open ~/plik.pdf` — pełna wersja modułu
jest w repo pod [`scripts/braindead.lua`](scripts/braindead.lua).

---

## Code architecture (data sheet)

```
src-tauri/       main process (Rust)
  src/lib.rs       window, menu, browser panes (native webviews), persistence, theme,
                   migration of state from an older Electron install
  src/pty.rs       PtyManager — native PTY, condvar-driven output coalescing, scrollback,
                   alternate-screen tracking (`pty:alt` — what keeps vim mode off nvim's back),
                   agent sessions (local + SSH)
  src/files.rs     file operations, native dialogs (rfd), natural sort
  src/ssh.rs       parse the ssh command (host/user/port/key, ~/.ssh/config), SFTP
  src/agents.rs    agent CLI status/install; agent_ssh_sync (config copy + remote install)
  src/ram.rs       memory monitor (sysinfo)
  src/browser_script.rs  script injected into pages (vim, link hints, scroll, run-bind, media)
  build.rs         generates the Rust agent registry from src/shared/agents.json
  capabilities/ui.json   permissions for the UI webview ONLY (see Data & privacy)
src/
  renderer/src/tauri-bridge.ts   invoke/listen bridge → window.api (same shape as the Electron preload)
  renderer/        React UI
    App.tsx, main.tsx
    components/    PaneGrid, TerminalPane, BrowserPane, ViewerPane (+PdfView), ExplorerPane,
                   AgentPane, NotesPanel, SettingsModal, Toolbar, TermBrowserSwitch,
                   WorkspaceSwitcher, LayoutPicker, FindBar, RamIndicator/RamControls, VimStatusline
    state/store.ts zustand: all UI state + actions + debounced persist
    shortcuts/     binds.ts (actions+defaults), dispatch.ts (execution), useShortcuts.ts (listener), find.ts
    vim/textVim.ts copy-mode / text caret logic
    layouts/presets.ts  layout presets 1–16
    lib/           domFind.ts (Highlight API), pdfPolyfill.ts
    styles/theme.css
  shared/        shared by Rust and the renderer
    types.ts       types + event/command names (the IPC object)
    agents.json    THE single source for the AI tool registry (read by TS and by build.rs)
    vimKeys.ts     vim action defs + matchVimKey/captureVimKey
```

Self-checks live next to the code they guard: `cargo test` runs the alternate-screen tracking
assertions (`src/pty.rs`) and the natural-sort assertions (`src/files.rs`).


Renderer ↔ main talk only over **IPC** (channels collected in `IPC` in
[types.ts](src/shared/types.ts)) and the safe `window.api` bridge from preload. zustand holds the UI state
and persists it to `state.json` with debounce.

---

## Scripts & build

| Command | What it does |
|---|---|
| `npm run tauri dev` | development mode (Vite + Rust, hot reload) |
| `npm run build` | frontend bundle into `dist/` (`tsc` + Vite) |
| `npm run tauri build` | full installer into `src-tauri/target/release/bundle/` |
| `npx tsc --noEmit` | type-check the frontend |
| `cargo test --manifest-path src-tauri/Cargo.toml` | self-checks: alternate-screen tracking (what vim mode rides on) and natural sort |
| `npx tauri icon <png>` | regenerates every icon size from one source PNG |

Tauri cannot cross-compile the webview, so each OS builds on its own machine —
[.github/workflows/release.yml](.github/workflows/release.yml) does exactly that on a tag push.
Targets are configured in [src-tauri/tauri.conf.json](src-tauri/tauri.conf.json).

---

## Known limitations

- After an **app restart** terminals start fresh (PTY processes don't survive a shutdown) — the layout,
  workspaces, browser addresses, notes and agent-pane configuration are restored.
- **SSH connections** are live only during the session (they live in the main process's memory); only
  their configuration is saved.
- **Shrinking a layout** (fewer panes) closes the removed panes' processes.
- Autopilot state (which panes are running) is runtime — it does not survive a restart.
- Remote auto-install of npm-based CLIs (Gemini/Codex) needs `npm`/`node` on the server; **Claude Code and
  Kimi Code install via `curl`** (Aider needs `python3`/`pip`). Goose, opencode and Amazon Q have no
  auto-installer at all — put them on the server yourself.
- A fullscreen program's screen (the alternate screen) is not part of the ~200 kB scrollback — coming back
  to the pane makes the program redraw, and there is no scrollback history for it.
</content>
