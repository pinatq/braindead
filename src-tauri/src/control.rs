// Kanał sterowania aplikacją Z ZEWNĄTRZ.
//
// Dwie drogi, bo dwa różne scenariusze:
//
//  1. GNIAZDO UNIKSOWE (ten plik) — działa z DOWOLNEGO procesu na tej maszynie: z Neovide,
//     z osobnego iTerma, ze skryptu w launchd. Neovide to samodzielna aplikacja GUI, jej
//     Neovim nie działa w naszym PTY, więc sekwencje sterujące w strumieniu terminala go
//     nie dotyczą — potrzebny jest prawdziwy endpoint.
//
//  2. SEKWENCJA OSC 7717 (pty.rs) — dla programów działających WEWNĄTRZ panelu terminala,
//     w tym po drugiej stronie ssh, gdzie gniazdo na naszym dysku jest nieosiągalne.
//
// Protokół: jedna linia na komendę, `czasownik<TAB>argument`. Prościej niż JSON, a i tak
// nadaje się do wpisania ręcznie przez `nc -U`.
use std::io::{BufRead, BufReader};
use std::path::PathBuf;

use tauri::{AppHandle, Emitter, Manager};

/// Ścieżka gniazda. W katalogu danych aplikacji, żeby nie zaśmiecać /tmp i mieć uprawnienia usera.
pub fn socket_path(app: &AppHandle) -> Option<PathBuf> {
    app.path().app_data_dir().ok().map(|d| d.join("braindead.sock"))
}

#[cfg(unix)]
pub fn start(app: AppHandle) {
    use std::os::unix::net::UnixListener;

    let Some(path) = socket_path(&app) else { return };
    if let Some(dir) = path.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    // Gniazdo po poprzednim uruchomieniu (albo po crashu) blokuje bind — usuwamy.
    let _ = std::fs::remove_file(&path);

    let listener = match UnixListener::bind(&path) {
        Ok(l) => l,
        Err(e) => {
            eprintln!("[control] nie udalo sie otworzyc gniazda {}: {e}", path.display());
            return;
        }
    };
    println!("[control] gniazdo sterowania: {}", path.display());

    std::thread::spawn(move || {
        for stream in listener.incoming() {
            let Ok(stream) = stream else { continue };
            let app = app.clone();
            std::thread::spawn(move || {
                let reader = BufReader::new(stream);
                for line in reader.lines().map_while(Result::ok) {
                    let (czasownik, arg) = match line.split_once('\t') {
                        Some((c, a)) => (c.trim().to_string(), a.trim().to_string()),
                        None => (line.trim().to_string(), String::new()),
                    };
                    if czasownik.is_empty() {
                        continue;
                    }
                    let _ = app.emit_to(
                        "ui",
                        "app:command",
                        serde_json::json!({ "source": "socket", "verb": czasownik, "arg": arg }),
                    );
                }
            });
        }
    });
}

/// Windows nie ma gniazd uniksowych — tam zostaje kanał OSC z wnętrza terminala.
#[cfg(not(unix))]
pub fn start(_app: AppHandle) {}

pub fn cleanup(app: &AppHandle) {
    if let Some(p) = socket_path(app) {
        let _ = std::fs::remove_file(p);
    }
}
