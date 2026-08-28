// Local files + native dialogs — port of Electron's src/main/files.ts and dialog.ts (saveNotes).
// Dialogs go through rfd. Every command here is #[tauri::command(async)] — bez tego Tauri v2
// wykonuje komendy synchroniczne na wątku GŁÓWNYM i każdy dialog/odczyt zamraża całe okno.
// rfd sam przerzuca natywny dialog z powrotem na main thread (run_on_main), więc to bezpieczne.
// Shapes mirror src/shared/types.ts exactly: LoadedFile / DirListing / NoteFile.
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

use base64::Engine;
use serde::Serialize;
use serde_json::{json, Value};
use tauri::{AppHandle, Manager};

// Same static map as files.ts; mime_guess only as a fallback for extensions Electron
// would have reported as application/octet-stream.
const MIME: &[(&str, &str)] = &[
    ("png", "image/png"), ("jpg", "image/jpeg"), ("jpeg", "image/jpeg"), ("gif", "image/gif"),
    ("webp", "image/webp"), ("bmp", "image/bmp"), ("svg", "image/svg+xml"), ("avif", "image/avif"),
    ("pdf", "application/pdf"), ("txt", "text/plain"), ("md", "text/markdown"), ("json", "application/json"),
    ("csv", "text/csv"), ("html", "text/html"),
    ("docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"),
];

pub fn mime_of(name: &str) -> String {
    let ext = name.rsplit('.').next().unwrap_or("").to_lowercase();
    if let Some((_, m)) = MIME.iter().find(|(e, _)| *e == ext) {
        return m.to_string();
    }
    mime_guess::from_path(name)
        .first()
        .map(|m| m.to_string())
        .unwrap_or_else(|| "application/octet-stream".into())
}

// files.ts VIEWER_FILTERS.
const VIEWER_FILTERS: &[(&str, &[&str])] = &[
    ("All supported", &["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg", "pdf", "txt", "md", "markdown", "json", "log", "csv", "js", "ts", "tsx", "jsx", "css", "html", "docx"]),
    ("Images", &["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg"]),
    ("PDF", &["pdf"]),
    ("Documents", &["docx"]),
    ("Text", &["txt", "md", "markdown", "json", "log", "csv"]),
    ("All files", &["*"]),
];

#[derive(Serialize)]
pub struct LoadedFile {
    pub name: String,
    pub ext: String,
    pub base64: String,
    pub path: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DirEntry {
    pub name: String,
    pub is_dir: bool,
    pub path: String,
}

#[derive(Serialize)]
pub struct DirListing {
    pub path: String,
    pub parent: Option<String>,
    pub entries: Vec<DirEntry>,
}

#[derive(Serialize)]
pub struct NoteFile {
    pub name: String,
    pub path: String,
    pub mime: String,
}

fn home() -> PathBuf {
    std::env::var_os("HOME").map(PathBuf::from).unwrap_or_else(|| PathBuf::from("/"))
}

// Expands ~ / ~/... to the home dir (files.ts expandHome).
pub fn expand_home(p: &str) -> PathBuf {
    if p == "~" {
        return home();
    }
    if let Some(rest) = p.strip_prefix("~/").or_else(|| p.strip_prefix("~\\")) {
        return home().join(rest);
    }
    PathBuf::from(p)
}

fn ext_of(name: &str) -> String {
    Path::new(name)
        .extension()
        .map(|e| e.to_string_lossy().to_lowercase())
        .unwrap_or_default()
}

pub fn read_file(file_path: &str) -> Result<LoadedFile, String> {
    let buf = std::fs::read(file_path).map_err(|e| e.to_string())?;
    let name = Path::new(file_path)
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default();
    Ok(LoadedFile {
        ext: ext_of(&name),
        name,
        base64: base64::engine::general_purpose::STANDARD.encode(buf),
        path: file_path.to_string(),
    })
}

// Shared by the local and SSH listings (both sorted folders-first, alphabetical).
pub fn sort_entries(entries: &mut [DirEntry]) {
    entries.sort_by(|a, b| {
        if a.is_dir != b.is_dir {
            if a.is_dir { std::cmp::Ordering::Less } else { std::cmp::Ordering::Greater }
        } else {
            natural_cmp(&a.name, &b.name)
        }
    });
}

/// Porównanie „naturalne": ciągi cyfr traktuje jak liczby, więc plik2 < plik10
/// (odpowiednik localeCompare(..., { numeric: true }) z Electrona).
pub fn natural_cmp(a: &str, b: &str) -> std::cmp::Ordering {
    let (mut x, mut y) = (a.chars().peekable(), b.chars().peekable());
    loop {
        match (x.peek().copied(), y.peek().copied()) {
            (None, None) => return std::cmp::Ordering::Equal,
            (None, Some(_)) => return std::cmp::Ordering::Less,
            (Some(_), None) => return std::cmp::Ordering::Greater,
            (Some(ca), Some(cb)) => {
                if ca.is_ascii_digit() && cb.is_ascii_digit() {
                    let na: String = std::iter::from_fn(|| x.next_if(char::is_ascii_digit)).collect();
                    let nb: String = std::iter::from_fn(|| y.next_if(char::is_ascii_digit)).collect();
                    // Porównanie bez wiodących zer; przy remisie krótszy zapis wygrywa.
                    let (ta, tb) = (na.trim_start_matches('0'), nb.trim_start_matches('0'));
                    match ta.len().cmp(&tb.len()).then_with(|| ta.cmp(tb)).then_with(|| na.len().cmp(&nb.len())) {
                        std::cmp::Ordering::Equal => {}
                        ord => return ord,
                    }
                } else {
                    let (la, lb) = (ca.to_lowercase().next().unwrap_or(ca), cb.to_lowercase().next().unwrap_or(cb));
                    if la != lb {
                        return la.cmp(&lb);
                    }
                    x.next();
                    y.next();
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::natural_cmp;
    use std::cmp::Ordering::*;

    #[test]
    fn sortuje_liczby_naturalnie() {
        assert_eq!(natural_cmp("plik2", "plik10"), Less);
        assert_eq!(natural_cmp("plik10", "plik2"), Greater);
        assert_eq!(natural_cmp("a", "B"), Less);          // bez rozroznienia wielkosci
        assert_eq!(natural_cmp("v1.9", "v1.10"), Less);
        assert_eq!(natural_cmp("007", "7"), Greater);     // remis liczbowy -> dluzszy zapis dalej
        assert_eq!(natural_cmp("plik", "plik"), Equal);
        assert_eq!(natural_cmp("plik", "plik1"), Less);
    }
}

// ---- Okna dialogowe zastępujące confirm()/alert() ----
//
// wry NIE implementuje WKUIDelegate.runJavaScriptConfirmPanel ani ...AlertPanel, więc
// w WKWebView `confirm()` zwraca od razu `false`, a `alert()` nic nie robi — bez okienka
// i bez błędu. Efekt: WSZYSTKO za potwierdzeniem było martwe (ubicie panelu i przestrzeni,
// kasowanie plików w eksploratorze, czyszczenie notatek, instalacja agenta), a komunikaty
// o błędach nigdy się nie pokazywały. Robimy więc dialogi natywnie, przez rfd (już w zależnościach).

#[tauri::command(async)]
pub fn dialog_confirm(title: String, message: String) -> bool {
    rfd::MessageDialog::new()
        .set_title(&title)
        .set_description(&message)
        .set_buttons(rfd::MessageButtons::OkCancel)
        .set_level(rfd::MessageLevel::Warning)
        .show()
        == rfd::MessageDialogResult::Ok
}

#[tauri::command(async)]
pub fn dialog_message(title: String, message: String) {
    rfd::MessageDialog::new()
        .set_title(&title)
        .set_description(&message)
        .set_buttons(rfd::MessageButtons::Ok)
        .set_level(rfd::MessageLevel::Error)
        .show();
}

// ---- Commands ----

// dialog.ts saveNotes: notes-<ISO-ts>.txt with ':'/'T' -> '-'.
#[tauri::command(async)]
pub fn dialog_save_notes(content: String) -> Value {
    let ts = iso_stamp();
    let mut dlg = rfd::FileDialog::new();
    dlg = dlg
        .set_title("Save notes dump")
        .set_file_name(format!("notes-{ts}.txt"))
        .add_filter("Text", &["txt"])
        .add_filter("Markdown", &["md"]);
    match dlg.save_file() {
        None => json!({ "saved": false }),
        Some(path) => match std::fs::write(&path, content) {
            Ok(()) => json!({ "saved": true, "path": path.to_string_lossy() }),
            Err(_) => json!({ "saved": false }),
        },
    }
}

#[tauri::command(async)]
pub fn file_open() -> Result<Option<LoadedFile>, String> {
    let mut dlg = rfd::FileDialog::new();
    dlg = dlg.set_title("Open file");
    for (name, exts) in VIEWER_FILTERS {
        dlg = dlg.add_filter(*name, exts);
    }
    match dlg.pick_file() {
        None => Ok(None),
        Some(path) => read_file(&path.to_string_lossy()).map(Some),
    }
}

#[tauri::command(async)]
pub fn file_read(file_path: String) -> Result<LoadedFile, String> {
    read_file(&file_path)
}

#[tauri::command(async)]
pub fn file_read_dir(dir_path: String) -> Result<DirListing, String> {
    // Empty path = home dir (explorer root), like files.ts readDir.
    let abs = if dir_path.trim().is_empty() {
        home()
    } else {
        expand_home(dir_path.trim())
    };
    let mut entries = Vec::new();
    for item in std::fs::read_dir(&abs).map_err(|e| e.to_string())? {
        let item = item.map_err(|e| e.to_string())?;
        let path = item.path();
        entries.push(DirEntry {
            name: item.file_name().to_string_lossy().into_owned(),
            is_dir: path.is_dir(),
            path: path.to_string_lossy().into_owned(),
        });
    }
    sort_entries(&mut entries);
    let parent = abs.parent().map(|p| p.to_string_lossy().into_owned());
    Ok(DirListing { path: abs.to_string_lossy().into_owned(), parent, entries })
}

#[tauri::command(async)]
pub fn file_delete(path: String) -> Value {
    let p = Path::new(&path);
    let res = if p.is_dir() { std::fs::remove_dir_all(p) } else { std::fs::remove_file(p) };
    match res {
        Ok(()) => json!({ "ok": true }),
        Err(e) => json!({ "ok": false, "error": e.to_string() }),
    }
}

#[tauri::command(async)]
pub fn file_mkdir(dir: String, name: String) -> Value {
    let target = expand_home(&dir).join(&name);
    match std::fs::create_dir(&target) {
        Ok(()) => json!({ "ok": true, "path": target.to_string_lossy() }),
        Err(e) => json!({ "ok": false, "error": e.to_string() }),
    }
}

#[tauri::command(async)]
pub fn file_create(dir: String, name: String) -> Value {
    let target = expand_home(&dir).join(&name);
    // create_new = Node's 'wx' flag: fails instead of overwriting an existing file.
    match std::fs::OpenOptions::new().write(true).create_new(true).open(&target) {
        Ok(_) => json!({ "ok": true, "path": target.to_string_lossy() }),
        Err(e) => json!({ "ok": false, "error": e.to_string() }),
    }
}

#[tauri::command(async)]
pub fn file_save(file_path: String, content: String) -> Value {
    json!({ "ok": std::fs::write(&file_path, content).is_ok() })
}

// files.ts saveAttachment: stored under app data dir (Electron userData) / notes-files,
// name prefixed with a base36 timestamp+random so attachments never collide.
#[tauri::command(async)]
pub fn notes_save_attachment(app: AppHandle, name: String, base64: String) -> Result<NoteFile, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?.join("notes-files");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let safe = sanitize_name(if name.is_empty() { "file" } else { &name });
    let stamp = format!("{}-{}", base36(now_millis()), base36(next_rand()));
    let file = dir.join(format!("{stamp}-{safe}"));
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(&base64)
        .map_err(|e| e.to_string())?;
    std::fs::write(&file, bytes).map_err(|e| e.to_string())?;
    let display = if name.is_empty() { safe } else { name };
    let mime = mime_of(&display);
    Ok(NoteFile { name: display, path: file.to_string_lossy().into_owned(), mime })
}

#[tauri::command(async)]
pub fn file_read_data_url(file_path: String) -> Result<String, String> {
    let buf = std::fs::read(&file_path).map_err(|e| e.to_string())?;
    Ok(format!(
        "data:{};base64,{}",
        mime_of(&file_path),
        base64::engine::general_purpose::STANDARD.encode(buf)
    ))
}

// files.ts saveAs: save dialog (Finder) + copy the file to the chosen location.
#[tauri::command(async)]
pub fn file_save_as(src_path: String, suggested_name: String) -> Result<Value, String> {
    let dlg = rfd::FileDialog::new()
        .set_title("Save to disk")
        .set_file_name(&suggested_name);
    match dlg.save_file() {
        None => Ok(json!({ "saved": false })),
        Some(dest) => {
            std::fs::copy(&src_path, &dest).map_err(|e| e.to_string())?;
            Ok(json!({ "saved": true, "path": dest.to_string_lossy() }))
        }
    }
}

#[tauri::command(async)]
pub fn dialog_open_dir() -> Option<String> {
    rfd::FileDialog::new()
        .set_title("Choose project folder")
        .pick_folder()
        .map(|p| p.to_string_lossy().into_owned())
}

// ---- helpers ----

// [^\w.\-]+ -> '_' (JS \w = [A-Za-z0-9_]).
fn sanitize_name(name: &str) -> String {
    name.chars()
        .map(|c| if c.is_ascii_alphanumeric() || matches!(c, '_' | '.' | '-') { c } else { '_' })
        .collect()
}

fn now_millis() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

// Cheap unique-ish suffix (Date.now().toString(36) + Math.random() in Electron).
static RAND_SEQ: AtomicU64 = AtomicU64::new(0);
fn next_rand() -> u64 {
    let nanos = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.subsec_nanos() as u64).unwrap_or(0);
    nanos ^ (u64::from(std::process::id()) << 20) ^ RAND_SEQ.fetch_add(1, Ordering::Relaxed)
}

fn base36(mut n: u64) -> String {
    const DIGITS: &[u8] = b"0123456789abcdefghijklmnopqrstuvwxyz";
    if n == 0 {
        return "0".into();
    }
    let mut out = Vec::new();
    while n > 0 {
        out.push(DIGITS[(n % 36) as usize]);
        n /= 36;
    }
    out.reverse();
    String::from_utf8(out).unwrap()
}

// UTC "YYYY-MM-DD-HH-MM-SS" (new Date().toISOString().slice(0,19).replace(/[:T]/g,'-')).
fn iso_stamp() -> String {
    let secs = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
    let days = (secs / 86400) as i64;
    let tod = secs % 86400;
    let (y, m, d) = civil_from_days(days);
    format!("{y:04}-{m:02}-{d:02}-{:02}-{:02}-{:02}", tod / 3600, (tod % 3600) / 60, tod % 60)
}

// Howard Hinnant's civil_from_days (days since 1970-01-01 -> y/m/d).
fn civil_from_days(z: i64) -> (i64, u32, u32) {
    let z = z + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = (z - era * 146_097) as u64;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146_096) / 365;
    let y = yoe as i64 + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    (if m <= 2 { y + 1 } else { y }, m, d)
}
