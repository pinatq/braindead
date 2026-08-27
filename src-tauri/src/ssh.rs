// SSH/SFTP connections for the explorer and viewer — port of Electron's src/main/ssh.ts
// (ssh2 npm lib -> ssh2 crate). Connections live only in this process's memory (passwords
// are never written to disk) — you reconnect after a restart.
use std::collections::HashMap;
use std::io::{Read, Write};
use std::net::{TcpStream, ToSocketAddrs};
use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::Duration;

use base64::Engine;
use serde::Serialize;
use serde_json::{json, Value};
use ssh2::Session;
use tauri::State;

use crate::files::{sort_entries, DirEntry, DirListing, LoadedFile};

const CONNECT_TIMEOUT: Duration = Duration::from_secs(15); // readyTimeout in ssh.ts

struct Conn {
    sess: Session,
}

#[derive(Default)]
pub struct SshManager {
    conns: Mutex<HashMap<String, Conn>>,
}

static SEQ: AtomicU64 = AtomicU64::new(0);

#[derive(Serialize)]
pub struct SshResult {
    pub ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub home: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

impl SshResult {
    fn err(msg: impl Into<String>) -> Self {
        SshResult { ok: false, id: None, home: None, label: None, error: Some(msg.into()) }
    }
}

pub struct SshTarget {
    pub host: String,
    pub port: u16,
    pub username: String,
    pub identity_file: Option<String>,
}

fn current_username() -> String {
    std::env::var("USER").unwrap_or_else(|_| "user".into())
}

fn expand_home(p: &str) -> String {
    crate::files::expand_home(p).to_string_lossy().into_owned()
}

// Pulls HostName/User/Port/IdentityFile for a Host alias out of ~/.ssh/config (ssh.ts fromSshConfig).
fn from_ssh_config(alias: &str) -> (Option<String>, Option<String>, Option<u16>, Option<String>) {
    let mut host = None;
    let mut user = None;
    let mut port = None;
    let mut identity = None;
    let text = match std::fs::read_to_string(expand_home("~/.ssh/config")) {
        Ok(t) => t,
        Err(_) => return (host, user, port, identity),
    };
    let mut in_block = false;
    for raw in text.lines() {
        let line = raw.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        let mut parts = line.splitn(2, char::is_whitespace);
        let key = parts.next().unwrap_or("").to_lowercase();
        let val = parts.next().map(str::trim).unwrap_or("");
        if val.is_empty() {
            continue;
        }
        if key == "host" {
            in_block = val.split_whitespace().any(|h| h == alias);
            continue;
        }
        if !in_block {
            continue;
        }
        match key.as_str() {
            "hostname" => host = Some(val.to_string()),
            "user" => user = Some(val.to_string()),
            "port" => port = val.parse().ok(),
            "identityfile" => identity = Some(expand_home(val)),
            _ => {}
        }
    }
    (host, user, port, identity)
}

// Parses "ssh [user@]host [-p port] [alias]" -> connection target (with ~/.ssh/config fallback).
// Same algorithm as ssh.ts parseCommand; also used by agents.rs for scp/ssh sync.
pub fn parse_command(command: &str) -> Result<SshTarget, String> {
    let trimmed = command.trim();
    let stripped = if trimmed.to_lowercase().starts_with("ssh ") {
        trimmed[4..].trim_start()
    } else if trimmed.eq_ignore_ascii_case("ssh") {
        ""
    } else {
        trimmed
    };
    let toks: Vec<&str> = stripped.split_whitespace().collect();
    let mut user = String::new();
    let mut host = String::new();
    let mut port: u16 = 0;
    let mut i = 0;
    while i < toks.len() {
        let t = toks[i];
        if t == "-p" && i + 1 < toks.len() {
            i += 1;
            port = toks[i].parse().unwrap_or(0);
        } else if let Some(rest) = t.strip_prefix("-p") {
            port = rest.parse().unwrap_or(0);
        } else if t.starts_with('-') {
            i += 1; // skip the value of an unknown flag
        } else if host.is_empty() {
            if let Some((u, h)) = t.split_once('@') {
                user = u.to_string();
                host = h.to_string();
            } else {
                host = t.to_string();
            }
        }
        i += 1;
    }
    let (cfg_host, cfg_user, cfg_port, cfg_id) = from_ssh_config(&host);
    Ok(SshTarget {
        host: cfg_host.unwrap_or(host),
        username: if user.is_empty() { cfg_user.unwrap_or_else(current_username) } else { user },
        port: if port != 0 { port } else { cfg_port.unwrap_or(22) },
        identity_file: cfg_id,
    })
}

fn connect(target: &SshTarget, password: Option<&str>) -> Result<Session, String> {
    let addr = (target.host.as_str(), target.port)
        .to_socket_addrs()
        .map_err(|e| e.to_string())?
        .next()
        .ok_or_else(|| "could not resolve host".to_string())?;
    let stream = TcpStream::connect_timeout(&addr, CONNECT_TIMEOUT).map_err(|e| e.to_string())?;
    // Keep a second handle on the same fd so we can restore blocking mode after connect
    // (ssh2's Session has set_tcp_stream but no getter).
    let stream_ctl = stream.try_clone().map_err(|e| e.to_string())?;
    let mut sess = Session::new().map_err(|e| e.to_string())?;
    sess.set_tcp_stream(stream);
    sess.handshake().map_err(|e| e.to_string())?;

    let authed = if let Some(pw) = password {
        sess.userauth_password(&target.username, pw).map_err(|e| e.to_string())?;
        sess.authenticated()
    } else if let Some(id_file) = &target.identity_file {
        match sess.userauth_pubkey_file(&target.username, None, Path::new(id_file), None) {
            Ok(()) => sess.authenticated(),
            Err(_) => try_agent(&sess, &target.username),
        }
    } else {
        try_agent(&sess, &target.username)
    };
    if !authed {
        return Err("authentication failed".into());
    }
    // Back to plain blocking mode for the long-lived SFTP session.
    let _ = stream_ctl.set_read_timeout(None);
    let _ = stream_ctl.set_write_timeout(None);
    Ok(sess)
}

// Auth via keys held by the local ssh-agent (SSH_AUTH_SOCK), like ssh.ts's conf.agent fallback.
fn try_agent(sess: &Session, username: &str) -> bool {
    if std::env::var_os("SSH_AUTH_SOCK").is_none() {
        return false;
    }
    let mut agent = match sess.agent() {
        Ok(a) => a,
        Err(_) => return false,
    };
    if agent.connect().is_err() || agent.list_identities().is_err() {
        return false;
    }
    for id in agent.identities().unwrap_or_default() {
        if agent.userauth(username, &id).is_ok() && sess.authenticated() {
            return true;
        }
    }
    false
}

fn get_conn<'m>(map: &'m HashMap<String, Conn>, id: &str) -> Result<&'m Conn, String> {
    map.get(id).ok_or_else(|| "SSH not connected (reconnect)".to_string())
}

// ssh.ts realpath(): "" / "~" -> ".", "~/x" -> "x" (relative to the remote home).
fn remote_target(p: &str) -> &str {
    if p.is_empty() || p == "~" {
        "."
    } else if let Some(rest) = p.strip_prefix("~/") {
        if rest.is_empty() { "." } else { rest }
    } else {
        p
    }
}

fn remote_parent(abs: &str) -> Option<String> {
    Path::new(abs).parent().and_then(|p| {
        let s = p.to_string_lossy();
        if s.is_empty() || s == abs { None } else { Some(s.into_owned()) }
    })
}

// ---- Commands ----

#[tauri::command]
pub fn ssh_connect(mgr: State<SshManager>, cfg: Value) -> SshResult {
    let command = cfg.get("command").and_then(Value::as_str).unwrap_or("");
    let password = cfg.get("password").and_then(Value::as_str);
    let target = match parse_command(command) {
        Ok(t) => t,
        Err(e) => return SshResult::err(e),
    };
    if target.host.is_empty() {
        return SshResult::err("No host in command");
    }
    let sess = match connect(&target, password) {
        Ok(s) => s,
        Err(e) => return SshResult::err(e),
    };
    let sftp = match sess.sftp() {
        Ok(s) => s,
        Err(e) => return SshResult::err(e.to_string()),
    };
    let home = sftp.realpath(Path::new(".")).ok().and_then(|p| p.to_str().map(str::to_owned));
    let id = format!("ssh{}", SEQ.fetch_add(1, Ordering::Relaxed) + 1);
    let label = format!("{}@{}", target.username, target.host);
    mgr.conns.lock().unwrap().insert(id.clone(), Conn { sess });
    SshResult { ok: true, id: Some(id), home, label: Some(label), error: None }
}

#[tauri::command]
pub fn ssh_disconnect(mgr: State<SshManager>, id: String) {
    mgr.conns.lock().unwrap().remove(&id); // dropping the session closes the channel
}

impl SshManager {
    pub fn disconnect_all(&self) {
        self.conns.lock().unwrap().clear();
    }
}

#[tauri::command]
pub fn ssh_read_dir(mgr: State<SshManager>, id: String, path: String) -> Result<DirListing, String> {
    let map = mgr.conns.lock().unwrap();
    let c = get_conn(&map, &id)?;
    let sftp = c.sess.sftp().map_err(|e| e.to_string())?;
    let abs = sftp
        .realpath(Path::new(remote_target(&path)))
        .map_err(|e| e.to_string())?;
    let abs = abs.to_string_lossy().into_owned();
    let mut entries = Vec::new();
    for (p, stat) in sftp.readdir(Path::new(&abs)).map_err(|e| e.to_string())? {
        let name = p.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
        if name == "." || name == ".." {
            continue;
        }
        entries.push(DirEntry {
            path: format!("{}/{}", abs.trim_end_matches('/'), name),
            is_dir: stat.is_dir(),
            name,
        });
    }
    sort_entries(&mut entries);
    Ok(DirListing { parent: remote_parent(&abs), path: abs, entries })
}

#[tauri::command]
pub fn ssh_read_file(mgr: State<SshManager>, id: String, path: String) -> Result<LoadedFile, String> {
    let map = mgr.conns.lock().unwrap();
    let c = get_conn(&map, &id)?;
    let sftp = c.sess.sftp().map_err(|e| e.to_string())?;
    let mut f = sftp.open(Path::new(&path)).map_err(|e| e.to_string())?;
    let mut buf = Vec::new();
    f.read_to_end(&mut buf).map_err(|e| e.to_string())?;
    let name = Path::new(&path)
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default();
    Ok(LoadedFile {
        ext: name.rsplit('.').next().unwrap_or("").to_lowercase(),
        name,
        base64: base64::engine::general_purpose::STANDARD.encode(buf),
        path,
    })
}

#[tauri::command]
pub fn ssh_write_file(mgr: State<SshManager>, id: String, path: String, content: String) -> Value {
    let res = (|| -> Result<(), String> {
        let map = mgr.conns.lock().unwrap();
        let c = get_conn(&map, &id)?;
        let sftp = c.sess.sftp().map_err(|e| e.to_string())?;
        let mut f = sftp.create(Path::new(&path)).map_err(|e| e.to_string())?;
        f.write_all(content.as_bytes()).map_err(|e| e.to_string())
    })();
    match res {
        Ok(()) => json!({ "ok": true }),
        Err(e) => json!({ "ok": false, "error": e }),
    }
}

#[tauri::command]
pub fn ssh_mkdir(mgr: State<SshManager>, id: String, dir: String, name: String) -> Value {
    let target = join_remote(&dir, &name);
    let res = (|| -> Result<(), String> {
        let map = mgr.conns.lock().unwrap();
        let c = get_conn(&map, &id)?;
        let sftp = c.sess.sftp().map_err(|e| e.to_string())?;
        sftp.mkdir(Path::new(&target), 0o755).map_err(|e| e.to_string())
    })();
    match res {
        Ok(()) => json!({ "ok": true, "path": target }),
        Err(e) => json!({ "ok": false, "error": e }),
    }
}

#[tauri::command]
pub fn ssh_create(mgr: State<SshManager>, id: String, dir: String, name: String) -> Value {
    let target = join_remote(&dir, &name);
    let res = (|| -> Result<(), String> {
        let map = mgr.conns.lock().unwrap();
        let c = get_conn(&map, &id)?;
        let sftp = c.sess.sftp().map_err(|e| e.to_string())?;
        // EXCLUSIVE = O_CREAT|O_EXCL = Node's 'wx': fail instead of overwriting.
        let f = sftp.open_mode(
            Path::new(&target),
            ssh2::OpenFlags::EXCLUSIVE | ssh2::OpenFlags::WRITE,
            0o644,
            ssh2::OpenType::File,
        );
        f.map(|_| ()).map_err(|e| e.to_string())
    })();
    match res {
        Ok(()) => json!({ "ok": true, "path": target }),
        Err(e) => json!({ "ok": false, "error": e }),
    }
}

// Removes a remote file (unlink) or an EMPTY dir (rmdir) — like ssh.ts sshDelete.
#[tauri::command]
pub fn ssh_delete(mgr: State<SshManager>, id: String, path: String) -> Value {
    let res = (|| -> Result<(), String> {
        let map = mgr.conns.lock().unwrap();
        let c = get_conn(&map, &id)?;
        let sftp = c.sess.sftp().map_err(|e| e.to_string())?;
        let stat = sftp.stat(Path::new(&path)).map_err(|e| e.to_string())?;
        if stat.is_dir() {
            sftp.rmdir(Path::new(&path)).map_err(|e| e.to_string())
        } else {
            sftp.unlink(Path::new(&path)).map_err(|e| e.to_string())
        }
    })();
    match res {
        Ok(()) => json!({ "ok": true }),
        Err(e) => json!({ "ok": false, "error": e }),
    }
}

fn join_remote(dir: &str, name: &str) -> String {
    format!("{}/{}", dir.trim_end_matches('/'), name)
}
