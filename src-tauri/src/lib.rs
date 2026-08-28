// Rdzeń Tauri dla BrainDead — pełny odpowiednik procesu głównego z Electrona:
// kafelkowe panele przeglądarki (multiwebview), PTY, pliki/dialogi, SSH/SFTP, agenci AI,
// monitor RAM, persystencja i motyw.
//
// DWIE ZASADY, KTÓRE ŁATWO ZŁAMAĆ PRZY EDYCJI TEGO PLIKU:
//
// 1. Zdarzenia do interfejsu idą przez `emit_to(UI, …)`, NIGDY przez `emit(…)`.
//    Panele przeglądarki to webview-dzieci tego samego okna, ładujące dowolne strony
//    z internetu. `emit` rozgłasza do wszystkich webview — czyli oddawałby stronie
//    pty:data (wyjście wszystkich terminali: klucze API, tokeny, sesje SSH).
//
// 2. Komendy dotykające okna/webview (pane_*, theme_set_dark) MUSZĄ zostać synchroniczne.
//    `#[tauri::command(async)]` przenosi je na pulę wątków, a AppKit/WebKit wymaga
//    wątku głównego. Komendy IO (pliki, ssh, agenci, store, pty_spawn) są odwrotnie:
//    muszą być `(async)`, bo inaczej blokują UI.
mod agents;
mod browser_script;
mod files;
mod pty;
mod ram;
mod ssh;

use std::path::PathBuf;

use pty::{AgentOpts, PtyManager};
use serde_json::{json, Value};
use ssh::SshManager;
use tauri::{
    menu::{Menu, PredefinedMenuItem, Submenu},
    webview::{NewWindowResponse, WebviewBuilder},
    AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, RunEvent, State, TitleBarStyle,
    WebviewUrl, WindowBuilder,
};
use tauri_plugin_opener::OpenerExt;

/// Etykieta webview interfejsu. Jedyny odbiorca zdarzeń aplikacji — patrz zasada 1 wyżej.
const UI: &str = "ui";

// UWAGA: NIE podszywamy się pod Chrome'a.
//
// Electron ustawiał sztuczny UA Chrome'a, bo sam doklejał do niego "Electron/AppName"
// i witryny się na tym wykładały. Tauri tego problemu nie ma — WKWebView przedstawia się
// jako Safari, czyli zgodnie z prawdą. Wmawianie stronom Chrome'a 126 na silniku WebKit
// sprawia, że serwują bundle i ścieżki kodu pisane pod Blinka, co potrafi je spowolnić
// albo połamać. Domyślny UA silnika jest tu właściwym wyborem.

fn pane_label(id: &str) -> String {
    format!("pane:{id}")
}

/// Identyfikator magazynu danych (cookies/localStorage) dla przestrzeni roboczej —
/// odpowiednik partycji `persist:browser-ws<N>` z Electrona. Panele w tej samej
/// przestrzeni dzielą logowania, różne przestrzenie są od siebie odcięte.
fn ws_data_store(ws: u32) -> [u8; 16] {
    let mut id = *b"braindead-ws\0\0\0\0";
    id[12..].copy_from_slice(&ws.to_le_bytes());
    id
}

// ---- Browser panes (native child webviews) — proven in Phase 0 ----

// Argumenty przychodzą płasko z invoke() — grupowanie ich w strukturę zmieniłoby
// kształt wywołania po stronie TS bez żadnego zysku.
#[allow(clippy::too_many_arguments)]
#[tauri::command]
fn add_pane(app: AppHandle, id: String, url: String, ws: u32, x: f64, y: f64, w: f64, h: f64) -> Result<(), String> {
    let label = pane_label(&id);
    if app.get_webview(&label).is_some() {
        return Ok(());
    }
    let win = app.get_window("main").ok_or("no main window")?;
    let parsed = tauri::Url::parse(&url).map_err(|e| format!("bad url: {e}"))?;
    // Events back to the React UI: navigation (address bar/history) + document title
    // (tab strip). Payload id is the FULL pane id (`{paneId}:{tabId}`), as passed here.
    let nav_app = app.clone();
    let nav_id = id.clone();
    let title_app = app.clone();
    let title_id = id.clone();
    let popup_app = app.clone();
    win.add_child(
        WebviewBuilder::new(&label, WebviewUrl::External(parsed))
            .on_navigation(move |url| {
                // Fake navigations from browser_script.rs carry page→app messages
                // (scroll-click open-tab, run-bind, vim signals). Intercept the scheme,
                // emit the matching pane:* event and cancel — the page never moves.
                if url.scheme() == "vibecoder" {
                    let cmd = url.host_str().unwrap_or("");
                    let param = |name: &str| {
                        url.query_pairs()
                            .find(|(k, _)| k == name)
                            .map(|(_, v)| v.into_owned())
                    };
                    let payload = match cmd {
                        "activate" => Some(("pane:activate", json!({ "id": nav_id, "click": param("click").as_deref() == Some("1") }))),
                        "open-tab" => Some(("pane:open-tab", json!({ "id": nav_id, "url": param("url") }))),
                        "run-bind" => Some(("pane:run-bind", json!({ "id": nav_id, "combo": param("combo") }))),
                        "focus-url" => Some(("pane:focus-url", json!({ "id": nav_id }))),
                        "win-motion" => Some(("pane:win-motion", json!({ "id": nav_id, "act": param("act") }))),
                        "win-prefix" => Some(("pane:win-prefix", json!({ "id": nav_id }))),
                        "vim-hello" => Some(("pane:vim-hello", json!({ "id": nav_id }))),
                        "media" => Some(("pane:media", json!({ "id": nav_id, "on": param("on").as_deref() == Some("1") }))),
                        // Nawigacja w SPA — dla UI nieodróżnialna od zwykłej zmiany adresu.
                        "spa-nav" => Some(("pane:navigated", json!({ "id": nav_id, "url": param("url") }))),
                        _ => None,
                    };
                    if let Some((event, body)) = payload {
                        let _ = nav_app.emit_to(UI, event, body);
                    }
                    return false;
                }
                let _ = nav_app.emit_to(UI, "pane:navigated", json!({ "id": nav_id, "url": url.to_string() }));
                true // allow all real navigations
            })
            .on_document_title_changed(move |_wv, title| {
                let _ = title_app.emit_to(UI, "pane:title", json!({ "id": title_id, "title": title }));
            })
            // target=_blank / window.open: deny the in-app window, open in the system browser.
            .on_new_window(move |url, _features| {
                let _ = popup_app.opener().open_url(url.as_str(), None::<&str>);
                NewWindowResponse::Deny
            })
            // Port of the Electron <webview> preload: scroll-click/⌘-click opens a tab,
            // app keybinds beat the page, vim-mode keys scroll/hint (browser_script.rs).
            .initialization_script(browser_script::script(&id))
            // Cookies/sesje wspólne w obrębie przestrzeni roboczej, odcięte między nimi.
            .data_store_identifier(ws_data_store(ws)),
        LogicalPosition::new(x, y),
        LogicalSize::new(w, h),
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn move_pane(app: AppHandle, id: String, x: f64, y: f64, w: f64, h: f64) -> Result<(), String> {
    let wv = app.get_webview(&pane_label(&id)).ok_or("no such pane")?;
    wv.set_position(LogicalPosition::new(x, y)).map_err(|e| e.to_string())?;
    wv.set_size(LogicalSize::new(w, h)).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn close_pane(app: AppHandle, id: String) -> Result<(), String> {
    if let Some(wv) = app.get_webview(&pane_label(&id)) {
        wv.close().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn set_pane_visible(app: AppHandle, id: String, visible: bool) -> Result<(), String> {
    let wv = app.get_webview(&pane_label(&id)).ok_or("no such pane")?;
    if visible {
        wv.show().map_err(|e| e.to_string())
    } else {
        wv.hide().map_err(|e| e.to_string())
    }
}

#[tauri::command]
fn pane_navigate(app: AppHandle, id: String, url: String) -> Result<(), String> {
    let wv = app.get_webview(&pane_label(&id)).ok_or("no such pane")?;
    let parsed = tauri::Url::parse(&url).map_err(|e| format!("bad url: {e}"))?;
    wv.navigate(parsed).map_err(|e| e.to_string())
}

#[tauri::command]
fn pane_reload(app: AppHandle, id: String) -> Result<(), String> {
    let wv = app.get_webview(&pane_label(&id)).ok_or("no such pane")?;
    wv.reload().map_err(|e| e.to_string())
}

// Fire-and-forget JS injection (history.back/forward, auto-scroll). No result is returned.
#[tauri::command]
fn pane_eval(app: AppHandle, id: String, js: String) -> Result<(), String> {
    let wv = app.get_webview(&pane_label(&id)).ok_or("no such pane")?;
    wv.eval(js).map_err(|e| e.to_string())
}

// ---- Diagnostyka renderera ----

/// Most błędów z webview na stderr procesu. Konsola WKWebView nigdzie nie trafia w buildzie
/// wydania, więc bez tego błąd renderera jest niewidoczny — a objawia się tylko tym, że okno
/// robi się czarne (React odmontowuje drzewo, spod spodu widać tło okna).
/// Uruchom aplikację z terminala, żeby to zobaczyć:
///   ./src-tauri/target/release/bundle/macos/BrainDead.app/Contents/MacOS/BrainDead
#[tauri::command]
fn log_js(level: String, msg: String) {
    eprintln!("[renderer/{level}] {msg}");
}

// ---- Terminal (native PTY + batched output) ----

#[tauri::command(async)]
fn pty_spawn(app: AppHandle, mgr: State<PtyManager>, id: String, cols: u16, rows: u16, cwd: Option<String>, agent: Option<AgentOpts>) -> Result<pty::SpawnResult, String> {
    mgr.spawn(app, id, cols, rows, cwd, agent)
}

#[tauri::command]
fn pty_write(mgr: State<PtyManager>, id: String, data: String) {
    mgr.write(&id, &data);
}

#[tauri::command]
fn pty_resize(mgr: State<PtyManager>, id: String, cols: u16, rows: u16) {
    mgr.resize(&id, cols, rows);
}

#[tauri::command]
fn pty_kill(mgr: State<PtyManager>, id: String) {
    mgr.kill(&id);
}

// ---- Persistence (port of src/main/store.ts) ----

fn default_state() -> Value {
    json!({
        "notes": "", "notesFiles": [], "current": 1, "maxWorkspace": 1,
        "workspaces": { "1": { "id": 1, "layoutId": "1", "panes": [{ "id": "p1", "mode": "terminal", "dirty": false }], "kept": false } },
        "ecoMode": false, "maxLiveBrowsers": 3, "binds": {}, "vimBinds": {},
        "vimMode": false, "vimTermExit": "esc",
        "ram": { "maxMb": 4096, "enforce": false, "sleepInactive": true, "sleepAfterMin": 5, "minFreeMb": 1024, "minFreeEnforce": false },
        "forceDark": false, "autoScrollEnabled": false, "autoScrollMin": 15, "autoScrollMax": 30,
        "sshConns": [], "autoApproveEnabled": false, "autoApproveMin": 5, "autoApproveMax": 8,
        "claudeEnabled": false, "claudeProfiles": []
    })
}

fn state_file(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    Ok(dir.join("state.json"))
}

/// Katalog danych aplikacji w wersji Electronowej (`app.getPath('userData')`, czyli
/// nazwa z package.json — "vibe-coder"). Tauri używa identyfikatora bundla, więc bez
/// migracji użytkownik po przesiadce traci przestrzenie, notatki i tokeny agentów.
fn electron_data_dir() -> Option<PathBuf> {
    let home = std::env::var_os("HOME").map(PathBuf::from);
    #[cfg(target_os = "macos")]
    return home.map(|h| h.join("Library/Application Support/vibe-coder"));
    #[cfg(target_os = "windows")]
    return std::env::var_os("APPDATA").map(|a| PathBuf::from(a).join("vibe-coder"));
    #[cfg(all(unix, not(target_os = "macos")))]
    return home.map(|h| h.join(".config/vibe-coder"));
}

fn copy_tree(from: &std::path::Path, to: &std::path::Path) -> std::io::Result<()> {
    std::fs::create_dir_all(to)?;
    for entry in std::fs::read_dir(from)? {
        let entry = entry?;
        let (src, dst) = (entry.path(), to.join(entry.file_name()));
        if entry.file_type()?.is_dir() {
            copy_tree(&src, &dst)?;
        } else {
            std::fs::copy(&src, &dst)?;
        }
    }
    Ok(())
}

/// Jednorazowa migracja z instalacji Electronowej. Odpala się tylko wtedy, gdy po stronie
/// Tauri nie ma jeszcze state.json — czyli nigdy nie nadpisze świeższych danych.
/// Partycji przeglądarki nie da się przenieść (format Chromium ≠ WebKit) — logowania
/// w panelach trzeba odtworzyć ręcznie.
fn migrate_from_electron(app: &AppHandle) {
    let Ok(target) = state_file(app) else { return };
    if target.exists() {
        return;
    }
    let Some(old) = electron_data_dir() else { return };
    if !old.join("state.json").is_file() {
        return;
    }
    let Some(dir) = target.parent() else { return };
    if std::fs::create_dir_all(dir).is_err() {
        return;
    }
    let _ = std::fs::copy(old.join("state.json"), &target);
    // notes-files = załączniki notatek; claude/ i agents/ = izolowane configi z tokenami.
    for sub in ["notes-files", "claude", "agents"] {
        let src = old.join(sub);
        if src.is_dir() {
            let _ = copy_tree(&src, &dir.join(sub));
        }
    }
    println!("[migracja] przeniesiono stan z {}", old.display());
}

#[tauri::command(async)]
fn store_load(app: AppHandle) -> Result<Value, String> {
    let mut state = default_state();
    if let Ok(path) = state_file(&app) {
        if let Ok(raw) = std::fs::read_to_string(&path) {
            if let Ok(Value::Object(parsed)) = serde_json::from_str::<Value>(&raw) {
                if let Value::Object(base) = &mut state {
                    for (k, v) in parsed {
                        base.insert(k, v); // shallow merge over defaults, like store.ts
                    }
                }
            }
        }
    }
    Ok(state)
}

#[tauri::command(async)]
fn store_save(app: AppHandle, state: Value) -> Result<(), String> {
    let path = state_file(&app)?;
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    let body = serde_json::to_string_pretty(&state).map_err(|e| e.to_string())?;
    std::fs::write(&path, body).map_err(|e| e.to_string())
}

// ---- Theme (port of nativeTheme.themeSource = on ? 'dark' : 'system') ----

#[tauri::command]
fn theme_set_dark(app: AppHandle, on: bool) {
    if let Some(win) = app.get_window("main") {
        // None = follow the system theme, like Electron's 'system'.
        let _ = win.set_theme(if on { Some(tauri::Theme::Dark) } else { None });
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(PtyManager::default())
        .manage(SshManager::default())
        .setup(|app| {
            // macOS window mirroring Electron's titleBarStyle 'hiddenInset' + transparent bg
            // (rounded-corner support); #0e0f13 is the app bg, used as the fallback color.
            let win = WindowBuilder::new(app, "main")
                .title("BrainDead")
                .inner_size(1280.0, 800.0)
                .min_inner_size(800.0, 500.0)
                .transparent(true)
                .title_bar_style(TitleBarStyle::Overlay)
                .hidden_title(true)
                .background_color(tauri::utils::config::Color(14, 15, 19, 255))
                .build()?;
            win.add_child(
                // transparent => the window bg shows through where the UI is translucent
                // (gated behind the `macos-private-api` feature on macOS — enabled in Cargo.toml).
                // auto_resize => the UI webview follows window resizes (was stuck at 1280x800).
                WebviewBuilder::new("ui", WebviewUrl::App("index.html".into()))
                    .transparent(true)
                    // Tauri domyślnie przechwytuje upuszczenie pliku z systemu i zamienia je
                    // na własne zdarzenie — DOM nigdy nie dostaje `drop`, więc przeciąganie
                    // plików do notatek nie działało. Wyłączamy, żeby działało HTML5 DnD.
                    .disable_drag_drop_handler()
                    .auto_resize(),
                LogicalPosition::new(0.0, 0.0),
                LogicalSize::new(1280.0, 800.0),
            )?;
            migrate_from_electron(app.handle());
            ram::start(app.handle().clone());

            // Native Edit menu: without one, macOS WKWebView gets no ⌘C/⌘V/⌘X/⌘A
            // (Tauri ships no default menu, unlike Electron). `Menu::default` is avoided
            // on purpose — its Window submenu binds ⌘W to close_window, which would
            // shadow the app's tab.close keybind.
            let app_menu = Submenu::with_items(
                app,
                "vibe-coder",
                true,
                &[
                    &PredefinedMenuItem::about(app, None, None)?,
                    &PredefinedMenuItem::separator(app)?,
                    &PredefinedMenuItem::services(app, None)?,
                    &PredefinedMenuItem::separator(app)?,
                    &PredefinedMenuItem::hide(app, None)?,
                    &PredefinedMenuItem::hide_others(app, None)?,
                    &PredefinedMenuItem::show_all(app, None)?,
                    &PredefinedMenuItem::separator(app)?,
                    &PredefinedMenuItem::quit(app, None)?,
                ],
            )?;
            let edit_menu = Submenu::with_items(
                app,
                "Edit",
                true,
                &[
                    &PredefinedMenuItem::undo(app, None)?,
                    &PredefinedMenuItem::redo(app, None)?,
                    &PredefinedMenuItem::separator(app)?,
                    &PredefinedMenuItem::cut(app, None)?,
                    &PredefinedMenuItem::copy(app, None)?,
                    &PredefinedMenuItem::paste(app, None)?,
                    &PredefinedMenuItem::select_all(app, None)?,
                ],
            )?;
            app.set_menu(Menu::with_items(app, &[&app_menu, &edit_menu])?)?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            add_pane, move_pane, close_pane,
            set_pane_visible, pane_navigate, pane_reload, pane_eval,
            pty_spawn, pty_write, pty_resize, pty_kill,
            store_load, store_save, theme_set_dark, log_js,
            files::dialog_save_notes, files::file_open, files::file_read, files::file_read_dir,
            files::file_delete, files::file_mkdir, files::file_create, files::file_save,
            files::notes_save_attachment, files::file_read_data_url, files::file_save_as,
            files::dialog_open_dir, files::dialog_confirm, files::dialog_message,
            ssh::ssh_connect, ssh::ssh_disconnect, ssh::ssh_read_dir, ssh::ssh_read_file,
            ssh::ssh_write_file, ssh::ssh_mkdir, ssh::ssh_create, ssh::ssh_delete,
            agents::agent_status, agents::agent_install, agents::agent_ssh_sync
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            // Electron's before-quit / window-all-closed: no orphaned shells or ssh sessions.
            if matches!(event, RunEvent::ExitRequested { .. } | RunEvent::Exit) {
                app.state::<PtyManager>().kill_all();
                app.state::<SshManager>().disconnect_all();
            }
            // Klik w ikonę w docku przy schowanym oknie — odpowiednik app.on('activate').
            // ponytail: tylko przywracamy istniejące okno; pełne zachowanie Electrona
            // (aplikacja żyje bez okien) wymagałoby prevent_exit i odtwarzania okna,
            // a i tak `window-all-closed` w Electronie ubija wszystkie shelle.
            #[cfg(target_os = "macos")]
            if let RunEvent::Reopen { .. } = event {
                if let Some(win) = app.get_window("main") {
                    let _ = win.unminimize();
                    let _ = win.show();
                    let _ = win.set_focus();
                }
            }
        });
}
