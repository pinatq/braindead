// Native PTY core — the kernel_task/CPU fix. Replaces Electron's node-pty + per-chunk IPC.
//
// The key difference vs the Electron app (src/main/pty.ts:114-126, which did
// `proc.onData(d => sender.send('pty:data', d))` — one IPC message per chunk): here a reader
// thread fills a coalescing buffer and a flush thread drains it on an ~8ms cadence. That caps
// emits at ~125/s per terminal no matter how fast the shell floods output, instead of
// hundreds-to-thousands of IPC round-trips/sec. Output bytes are sent base64 so arbitrary
// (non-UTF8 / mid-sequence) terminal bytes survive the JSON event boundary intact.
//
// Ported from pty.ts: per-session scrollback ring buffer (replayed on re-attach), alternate
// screen tracking (pty:alt), real exit codes and agent mode (isolated config dir per profile
// + auto-run of the tool command, optionally wrapped in ssh for remote agents).
//
// Dwie rzeczy różnią się od pierwszej wersji portu:
//  * emit_to("ui", …) zamiast app.emit(…) — zdarzenie idzie WYŁĄCZNIE do webview interfejsu.
//    app.emit rozgłasza do wszystkich webview, czyli także do stron otwartych w panelach
//    przeglądarki: strona dostawała wyjście wszystkich terminali i kosztowało to serializację
//    razy liczba paneli.
//  * wątek flushujący śpi na Condvarze zamiast budzić się co 8 ms w kółko. Przy 16 panelach
//    to było 2000 przebudzeń na sekundę na pusto; teraz bezczynny terminal kosztuje zero.
use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::{Arc, Condvar, Mutex, MutexGuard, PoisonError};
use std::time::Duration;

use base64::Engine;
use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use serde::Deserialize;
use tauri::{AppHandle, Emitter};

use crate::agents::{agent_tool, local_agent_dir};

const FLUSH_MS: u64 = 8;
/// Etykieta webview interfejsu — jedyny odbiorca zdarzeń pty:*.
const UI: &str = "ui";
/// Ile ostatnich bajtów trzymamy, żeby sekwencja alt-screen rozcięta między chunkami
/// dała się złożyć (najdłuższa to 8 bajtów: ESC [ ? 1 0 4 9 h).
const SEQ_TAIL: usize = 16;

/// Zatrucie mutexa nie może zabić terminala — przejmujemy dane i lecimy dalej.
fn lock<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(PoisonError::into_inner)
}

/// Czy strumień właśnie wszedł (true) albo wyszedł (false) z ekranu alternatywnego.
/// Port pty.ts: DECSET 1049 / 1047 / 47, liczy się OSTATNIA sekwencja w porcji danych.
fn alt_from_chunk(scan: &[u8]) -> Option<bool> {
    const SEQS: [(&[u8], bool); 6] = [
        (b"\x1b[?1049h", true), (b"\x1b[?1049l", false),
        (b"\x1b[?1047h", true), (b"\x1b[?1047l", false),
        (b"\x1b[?47h", true),   (b"\x1b[?47l", false),
    ];
    SEQS.iter()
        .filter_map(|(seq, on)| rfind(scan, seq).map(|at| (at, *on)))
        .max_by_key(|(at, _)| *at)
        .map(|(_, on)| on)
}

fn rfind(hay: &[u8], needle: &[u8]) -> Option<usize> {
    if needle.is_empty() || hay.len() < needle.len() {
        return None;
    }
    (0..=hay.len() - needle.len()).rev().find(|&i| &hay[i..i + needle.len()] == needle)
}

/// Bufor scalający wyjście PTY + sygnał dla wątku flushującego.
#[derive(Default)]
struct Outbox {
    data: Vec<u8>,
    alive: bool,
}
// Scrollback kept in memory per session (pty.ts MAX_BUFFER), replayed when ensure hits a
// live session so a background terminal restores after the view remounts.
const MAX_SCROLLBACK: usize = 128 * 1024;

/// Login shell of the current user. The PASSWD DATABASE is authoritative (like Terminal.app/
/// iTerm): `$SHELL` is merely inherited from whatever launched us and is often WRONG — e.g.
/// here it points to /bin/bash while the account shell is /bin/zsh, which spawned macOS's
/// stock bash 3.2 (banner "The default interactive shell is now zsh." + prompt `bash-3.2$`
/// instead of `user@host`). Spawning with `-l` (login) loads /etc/zprofile (path_helper →
/// Homebrew on PATH) + the user's profile files, so the terminal looks and behaves normal.
pub fn login_shell() -> String {
    #[cfg(unix)]
    unsafe {
        let pw = libc::getpwuid(libc::getuid());
        if !pw.is_null() && !(*pw).pw_shell.is_null() {
            if let Ok(s) = std::ffi::CStr::from_ptr((*pw).pw_shell).to_str() {
                if !s.is_empty() && std::path::Path::new(s).exists() {
                    return s.to_string();
                }
            }
        }
    }
    if let Ok(s) = std::env::var("SHELL") {
        if !s.is_empty() && std::path::Path::new(&s).exists() {
            return s;
        }
    }
    if std::path::Path::new("/bin/zsh").exists() { "/bin/zsh".into() } else { "/bin/bash".into() }
}

// PtyEnsureOpts.agent from src/shared/types.ts (camelCase on the wire).
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentOpts {
    pub profile_id: String,
    pub tool_id: String,
    pub api_key: Option<String>,
    pub ssh: Option<AgentSsh>,
}

#[derive(Deserialize)]
pub struct AgentSsh {
    pub command: String,
}

struct Session {
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    child: Arc<Mutex<Box<dyn Child + Send + Sync>>>,
    alive: Arc<AtomicBool>,
    /// Czy w sesji chodzi program pełnoekranowy (nvim/htop). Renderer bierze to
    /// z odpowiedzi pty_spawn i ze zdarzeń pty:alt — bufor xterma bywa niewiarygodny.
    alt: Arc<AtomicBool>,
    scrollback: Arc<Mutex<Vec<u8>>>,
    /// Ostatni znany rozmiar — potrzebny, by po remoncie widoku szturchnąć TUI do przerysowania.
    cols: u16,
    rows: u16,
}

/// Odpowiedź pty_spawn — kształt jak `{ existed, alt }` z Electronowego ensure().
#[derive(serde::Serialize)]
pub struct SpawnResult {
    pub existed: bool,
    pub alt: bool,
}

#[derive(Default)]
pub struct PtyManager {
    sessions: Arc<Mutex<HashMap<String, Session>>>,
}

impl PtyManager {
    /// Tworzy sesję, jeśli jej nie ma. Gdy już istnieje: odtwarza scrollback jako zwykłe
    /// zdarzenie pty:data i zwraca `existed: true` wraz z bieżącym stanem alt-screena.
    pub fn spawn(&self, app: AppHandle, id: String, cols: u16, rows: u16, cwd: Option<String>, agent: Option<AgentOpts>) -> Result<SpawnResult, String> {
        {
            let mut map = lock(&self.sessions);
            if let Some(s) = map.get_mut(&id) {
                let alt = s.alt.load(Ordering::Relaxed);
                // Port pty.ts:77 — remont widoku nad działającym TUI. Program pełnoekranowy
                // nie przerysuje się sam, więc zwężamy o wiersz i wracamy (SIGWINCH nie jest
                // kolejkowany, więc powrót musi iść osobnym tickiem). Warunek na zgodność
                // rozmiaru odsiewa panele, których renderer jeszcze nie zmierzył i przysyła 80x24.
                if alt && cols == s.cols && rows == s.rows && rows > 1 {
                    let _ = s.master.resize(PtySize { rows: rows - 1, cols, pixel_width: 0, pixel_height: 0 });
                    let sessions = self.sessions.clone();
                    let (nid, ncols, nrows) = (id.clone(), cols, rows);
                    std::thread::spawn(move || {
                        std::thread::sleep(Duration::from_millis(50));
                        if let Some(s) = lock(&sessions).get(&nid) {
                            let _ = s.master.resize(PtySize { rows: nrows, cols: ncols, pixel_width: 0, pixel_height: 0 });
                        }
                    });
                }
                let buf = lock(&s.scrollback).clone();
                if !buf.is_empty() {
                    let _ = app.emit_to(UI, "pty:data", (id.clone(), b64(buf)));
                }
                return Ok(SpawnResult { existed: true, alt });
            }
        }

        let pair = native_pty_system()
            .openpty(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 })
            .map_err(|e| e.to_string())?;

        let shell = login_shell();
        let mut cmd = build_command(&app, &shell, cwd.as_deref(), agent)?;
        cmd.env("TERM", "xterm-256color");
        cmd.env("COLORTERM", "truecolor"); // parytet z Electronem: dziedziczył go z env aplikacji
        let child = pair.slave.spawn_command(cmd).map_err(|e| e.to_string())?;
        drop(pair.slave); // parent doesn't need the slave fd

        let mut reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
        let writer = pair.master.take_writer().map_err(|e| e.to_string())?;

        let alive = Arc::new(AtomicBool::new(true));
        let alt = Arc::new(AtomicBool::new(false));
        let scrollback = Arc::new(Mutex::new(Vec::<u8>::new()));
        let child = Arc::new(Mutex::new(child));
        let exit_code = Arc::new(AtomicU32::new(0));
        // (bufor wyjścia, budzik dla wątku flushującego)
        let outbox = Arc::new((Mutex::new(Outbox { data: Vec::new(), alive: true }), Condvar::new()));

        // ── Wątek czytający: blokuje się na PTY, dopisuje do bufora i scrollbacku,
        //    po drodze śledzi wejście/wyjście z ekranu alternatywnego.
        {
            let (outbox, scrollback, alive, alt) = (outbox.clone(), scrollback.clone(), alive.clone(), alt.clone());
            let (sessions, child, exit_code) = (self.sessions.clone(), child.clone(), exit_code.clone());
            let (app, id) = (app.clone(), id.clone());
            std::thread::spawn(move || {
                let mut chunk = [0u8; 8192];
                let mut tail: Vec<u8> = Vec::with_capacity(SEQ_TAIL + 8192);
                loop {
                    let n = match reader.read(&mut chunk) {
                        Ok(0) | Err(_) => break,
                        Ok(n) => n,
                    };
                    let data = &chunk[..n];

                    // Alt-screen: skanujemy ogon + nową porcję, żeby nie zgubić sekwencji
                    // rozciętej między odczytami.
                    tail.extend_from_slice(data);
                    if let Some(on) = alt_from_chunk(&tail) {
                        if alt.swap(on, Ordering::Relaxed) != on {
                            let _ = app.emit_to(UI, "pty:alt", serde_json::json!({ "id": id, "alt": on }));
                        }
                    }
                    if tail.len() > SEQ_TAIL {
                        tail.drain(..tail.len() - SEQ_TAIL);
                    }

                    {
                        let mut sb = lock(&scrollback);
                        sb.extend_from_slice(data);
                        let excess = sb.len().saturating_sub(MAX_SCROLLBACK);
                        if excess > 0 {
                            sb.drain(..excess);
                        }
                    }
                    let (buf, cv) = &*outbox;
                    lock(buf).data.extend_from_slice(data);
                    cv.notify_one();
                }
                // EOF = proces skończył. Zbieramy prawdziwy kod wyjścia (Electron: proc.onExit).
                if let Ok(status) = lock(&child).wait() {
                    exit_code.store(status.exit_code(), Ordering::Relaxed);
                }
                alive.store(false, Ordering::Relaxed);
                // Sesja zamknięta w alt-screenie zostawiłaby renderer z altRef=true na zawsze.
                if alt.swap(false, Ordering::Relaxed) {
                    let _ = app.emit_to(UI, "pty:alt", serde_json::json!({ "id": id, "alt": false }));
                }
                lock(&sessions).remove(&id);
                let (buf, cv) = &*outbox;
                lock(buf).alive = false;
                cv.notify_one();
            });
        }

        // ── Wątek flushujący: czeka na Condvarze (bezczynny terminal = zero przebudzeń),
        //    po emisji śpi FLUSH_MS jako okno scalania — dzięki temu pierwszy bajt leci
        //    natychmiast (echo klawisza), a zalew wyjścia i tak jest ograniczony do ~125 emisji/s.
        {
            let (outbox, app, fid, exit_code) = (outbox.clone(), app.clone(), id.clone(), exit_code.clone());
            std::thread::spawn(move || {
                let (buf, cv) = &*outbox;
                loop {
                    let out = {
                        let mut g = lock(buf);
                        while g.data.is_empty() && g.alive {
                            g = cv.wait(g).unwrap_or_else(PoisonError::into_inner);
                        }
                        if g.data.is_empty() && !g.alive {
                            break;
                        }
                        std::mem::take(&mut g.data)
                    };
                    let _ = app.emit_to(UI, "pty:data", (fid.clone(), b64(out)));
                    std::thread::sleep(Duration::from_millis(FLUSH_MS));
                }
                let _ = app.emit_to(UI, "pty:exit", serde_json::json!({
                    "id": fid, "exitCode": exit_code.load(Ordering::Relaxed)
                }));
            });
        }

        lock(&self.sessions).insert(id, Session { master: pair.master, writer, child, alive, alt, scrollback, cols, rows });
        Ok(SpawnResult { existed: false, alt: false })
    }

    pub fn write(&self, id: &str, data: &str) {
        if let Some(s) = lock(&self.sessions).get_mut(id) {
            let _ = s.writer.write_all(data.as_bytes());
            let _ = s.writer.flush();
        }
    }

    pub fn resize(&self, id: &str, cols: u16, rows: u16) {
        if let Some(s) = lock(&self.sessions).get_mut(id) {
            let _ = s.master.resize(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 });
            s.cols = cols;
            s.rows = rows;
        }
    }

    pub fn kill(&self, id: &str) {
        if let Some(s) = lock(&self.sessions).remove(id) {
            s.alive.store(false, Ordering::Relaxed);
            let _ = lock(&s.child).kill(); // drop mastera/writera i tak zamyka pty -> SIGHUP
        }
    }

    pub fn kill_all(&self) {
        let ids: Vec<String> = lock(&self.sessions).keys().cloned().collect();
        for id in ids {
            self.kill(&id);
        }
    }
}

fn b64(bytes: Vec<u8>) -> String {
    base64::engine::general_purpose::STANDARD.encode(bytes)
}

// Builds the process to spawn: plain shell, or an agent session (pty.ts ensure's agent branch).
fn build_command(app: &AppHandle, shell: &str, cwd: Option<&str>, agent: Option<AgentOpts>) -> Result<CommandBuilder, String> {
    let mut spawn_cwd = cwd
        .map(std::path::PathBuf::from)
        .filter(|p| p.is_dir())
        .or_else(dirs_home);
    let mut cmd = match agent {
        // Zwykły terminal: login shell (-l) jak w Terminal.app — ładuje /etc/zprofile
        // (path_helper) i profil usera, więc prompt to `user@host`, a PATH ma Homebrew.
        None => {
            let mut c = CommandBuilder::new(shell);
            c.arg("-l");
            c
        }
        Some(ag) => {
            let tool = agent_tool(&ag.tool_id);
            let tool_cmd = tool.map(|t| t.cmd).unwrap_or(&ag.tool_id);
            if let Some(ssh) = &ag.ssh {
                // REMOTE: run the CLI on the server through ssh. The config is already synced
                // (agent_ssh_sync), so we point at the remote CLAUDE_CONFIG_DIR etc. — no fresh
                // /login. We spawn ssh directly (no local shell) and let the REMOTE shell parse
                // remoteCmd (pty.ts agent+ssh branch).
                let toks: Vec<&str> = ssh.command.split_whitespace().collect();
                let file = toks.first().copied().unwrap_or("ssh");
                let remote_dir = format!("$HOME/{}", crate::agents::remote_agent_dir(&ag.profile_id));
                let cfg = tool.and_then(|t| t.config_env).map(|e| format!("{e}=\"{remote_dir}\" ")).unwrap_or_default();
                let key = match (tool.and_then(|t| t.api_key_env), &ag.api_key) {
                    (Some(e), Some(k)) => format!("{e}=\"{k}\" "),
                    _ => String::new(),
                };
                let path_fix = "export PATH=\"$HOME/.local/bin:$HOME/bin:$HOME/.npm-global/bin:$PATH\"";
                let remote_cmd = format!("{path_fix}; {}; {cfg}{key}{tool_cmd}; exec $SHELL", remote_cd(cwd));
                let mut c = CommandBuilder::new(file);
                for arg in &toks[1..] {
                    c.arg(*arg);
                }
                c.arg("-t");
                c.arg(remote_cmd);
                spawn_cwd = dirs_home(); // ssh runs locally; the remote path goes in remoteCmd
                c
            } else {
                // LOCAL: every account gets its own config dir (token/settings) — accounts in
                // different panes don't touch each other. Claude in 'claude/', the rest in
                // 'agents/' (same as agents.rs local_agent_dir).
                let dir = local_agent_dir(app, &ag.tool_id, &ag.profile_id);
                let _ = std::fs::create_dir_all(&dir);
                let mut c = CommandBuilder::new(shell);
                if let Some(env_name) = tool.and_then(|t| t.config_env) {
                    c.env(env_name, &dir);
                }
                c.env("XDG_CONFIG_HOME", &dir); // best-effort isolation for XDG-based tools
                if let (Some(env_name), Some(key)) = (tool.and_then(|t| t.api_key_env), &ag.api_key) {
                    c.env(env_name, key);
                }
                // Auto-run the tool; on exit stay in the shell (with the isolated env) for /login.
                // -l: login shell — profil usera (PATH z .zprofile/.bash_profile) dostępny,
                // bo świeżo zainstalowane CLI siedzi poza domyślnym PATH aplikacji GUI.
                c.arg("-lic");
                c.arg(format!("{tool_cmd}; exec {shell} -l"));
                c
            }
        }
    };
    if let Some(d) = spawn_cwd {
        cmd.cwd(d);
    }
    Ok(cmd)
}

// Safe `cd` for the remote shell: no path -> home; we expand `~` onto $HOME by hand because
// tilde doesn't expand inside quotes (pty.ts remoteCd).
fn remote_cd(cwd: Option<&str>) -> String {
    let t = cwd.map(str::trim).unwrap_or("");
    if t.is_empty() || t == "~" || t == "~/" {
        return "cd \"$HOME\"".into();
    }
    if let Some(rest) = t.strip_prefix("~/") {
        return format!("cd \"$HOME/{rest}\"");
    }
    format!("cd \"{t}\"")
}

fn dirs_home() -> Option<std::path::PathBuf> {
    std::env::var_os("HOME").map(std::path::PathBuf::from)
}
