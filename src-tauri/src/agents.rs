// Agent CLI status/install/ssh-sync — port of Electron's src/main/agents.ts plus the
// AGENT_TOOLS registry from src/shared/agents.ts (ids, commands, env var names).
use std::io::Read;
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::sync::mpsc;
use std::time::{Duration, Instant};

use serde::Serialize;
use serde_json::json;
use tauri::{AppHandle, Emitter, Manager};

use crate::ssh::parse_command;

// Registry mirror of shared/agents.ts. config_env isolates the tool's config dir per
// profile; api_key_env carries the key for "api" profiles; install_sh is the posix installer.
pub struct AgentTool {
    pub id: &'static str,
    pub name: &'static str,
    pub cmd: &'static str,
    pub config_env: Option<&'static str>,
    pub api_key_env: Option<&'static str>,
    pub install_sh: Option<&'static str>,
}

pub const AGENT_TOOLS: &[AgentTool] = &[
    AgentTool { id: "claude", name: "Claude Code", cmd: "claude", config_env: Some("CLAUDE_CONFIG_DIR"), api_key_env: Some("ANTHROPIC_API_KEY"), install_sh: Some("curl -fsSL https://claude.ai/install.sh | bash") },
    AgentTool { id: "gemini", name: "Gemini CLI", cmd: "gemini", config_env: None, api_key_env: Some("GEMINI_API_KEY"), install_sh: Some("npm install -g @google/gemini-cli") },
    AgentTool { id: "codex", name: "Codex CLI", cmd: "codex", config_env: Some("CODEX_HOME"), api_key_env: Some("OPENAI_API_KEY"), install_sh: Some("npm install -g @openai/codex") },
    AgentTool { id: "aider", name: "Aider", cmd: "aider", config_env: None, api_key_env: Some("OPENAI_API_KEY"), install_sh: Some("python3 -m pip install -U aider-chat") },
    AgentTool { id: "goose", name: "Goose", cmd: "goose", config_env: None, api_key_env: None, install_sh: Some("curl -fsSL https://github.com/block/goose/releases/download/stable/download_cli.sh | CONFIGURE=false bash") },
    AgentTool { id: "opencode", name: "opencode", cmd: "opencode", config_env: None, api_key_env: None, install_sh: Some("curl -fsSL https://opencode.ai/install | bash") },
    // KIMI_CODE_HOME izoluje config per profil; klucz API nie jest czytany z env (config.toml),
    // dlatego api_key_env = None (patrz komentarz w shared/agents.ts).
    AgentTool { id: "kimi", name: "Kimi CLI", cmd: "kimi", config_env: Some("KIMI_CODE_HOME"), api_key_env: None, install_sh: Some("curl -fsSL https://code.kimi.com/kimi-code/install.sh | bash") },
];

pub fn agent_tool(id: &str) -> Option<&'static AgentTool> {
    AGENT_TOOLS.iter().find(|t| t.id == id)
}

// Local, isolated config dir of a profile (same as PtyManager::spawn uses for agent mode).
pub fn local_agent_dir(app: &AppHandle, tool_id: &str, profile_id: &str) -> PathBuf {
    let base = app.path().app_data_dir().unwrap_or_else(|_| PathBuf::from("."));
    base.join(if tool_id == "claude" { "claude" } else { "agents" }).join(profile_id)
}

// Remote config dir (relative to $HOME on the server) — one per profile.
pub fn remote_agent_dir(profile_id: &str) -> String {
    format!(".braindead-agents/{profile_id}")
}

// PATH on the remote host: freshly installed CLIs live in ~/.local/bin (claude) or
// ~/.npm-global/bin (npm), and a command over ssh doesn't read the user's rc — so we add
// those paths on every probe (agents.ts REMOTE_PATH).
const REMOTE_PATH: &str = "export PATH=\"$HOME/.local/bin:$HOME/bin:$HOME/.npm-global/bin:$PATH\"";

struct RunOut {
    code: i32,
    out: String,
    err: String,
}

// execFile with a timeout. stdout/stderr are pumped on threads so a chatty child
// (npm install logs) can't deadlock on a full pipe while we poll.
fn run(file: &str, args: &[String], timeout: Duration) -> RunOut {
    let spawn = Command::new(file)
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn();
    let mut child = match spawn {
        Ok(c) => c,
        Err(e) => return RunOut { code: 1, out: String::new(), err: e.to_string() },
    };
    let (tx, rx) = mpsc::channel();
    let mut streams: Vec<Box<dyn Read + Send>> = Vec::new();
    if let Some(s) = child.stdout.take() {
        streams.push(Box::new(s));
    }
    if let Some(s) = child.stderr.take() {
        streams.push(Box::new(s));
    }
    for (idx, mut stream) in streams.into_iter().enumerate() {
        let tx = tx.clone();
        std::thread::spawn(move || {
            let mut buf = Vec::new();
            let _ = stream.read_to_end(&mut buf);
            let _ = tx.send((idx, buf));
        });
    }
    let deadline = Instant::now() + timeout;
    let code = loop {
        match child.try_wait() {
            Ok(Some(st)) => break st.code().unwrap_or(1),
            Ok(None) if Instant::now() < deadline => std::thread::sleep(Duration::from_millis(25)),
            Ok(None) => {
                let _ = child.kill();
                let _ = child.wait();
                break 1;
            }
            Err(_) => break 1,
        }
    };
    let mut bufs = [Vec::new(), Vec::new()];
    for _ in 0..2 {
        if let Ok((idx, b)) = rx.recv_timeout(Duration::from_millis(500)) {
            bufs[idx] = b;
        }
    }
    let [out, err] = bufs;
    RunOut {
        code,
        out: String::from_utf8_lossy(&out).into_owned(),
        err: String::from_utf8_lossy(&err).into_owned(),
    }
}

fn shell() -> String {
    crate::pty::login_shell()
}

// Detection/installation go through an INTERACTIVE LOGIN shell (-lic) — same PATH the agent
// panel sees when it runs the CLI (user rc usually adds ~/.local/bin, brew, npm-global etc.;
// -l matters for GUI launches, where the app itself has a minimal PATH).
fn run_in_shell(cmd: &str, timeout: Duration) -> RunOut {
    run(&shell(), &["-lic".into(), cmd.into()], timeout)
}

#[derive(Serialize)]
pub struct ClaudeCliStatus {
    pub installed: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
}

#[tauri::command]
pub fn agent_status(cmd: String) -> ClaudeCliStatus {
    if cmd.is_empty() {
        return ClaudeCliStatus { installed: false, path: None };
    }
    let r = run_in_shell(&format!("command -v {cmd}"), Duration::from_secs(8));
    let path = r.out.lines().next().map(str::trim).filter(|s| !s.is_empty()).map(str::to_owned);
    ClaudeCliStatus { installed: r.code == 0 && path.is_some(), path }
}

#[tauri::command]
pub fn agent_install(tool_id: String) -> serde_json::Value {
    let tool = agent_tool(&tool_id);
    let cmd = tool.and_then(|t| t.install_sh);
    let (tool, cmd) = match (tool, cmd) {
        (Some(t), Some(c)) => (t, c),
        _ => {
            return json!({ "ok": false, "output": format!("No automatic installer for {tool_id} — install it manually, then reload.") })
        }
    };
    let r = run_in_shell(cmd, Duration::from_secs(240));
    let output = format!("{}\n{}", r.out, r.err).trim().to_string();
    let ok = agent_status(tool.cmd.to_string()).installed;
    json!({ "ok": ok, "output": output })
}

fn last_line(s: &str) -> &str {
    s.trim().lines().last().map(str::trim).unwrap_or("")
}

/// Prepares a remote host to run the agent: 1) install the CLI remotely if missing,
/// 2) scp the local isolated config (token/login) over — no re-login. WARNING: sends the
/// token to the remote machine; the UI confirms before calling (agents.ts).
/// Auth for scp/ssh via key/agent (same as the explorer).
#[tauri::command]
pub fn agent_ssh_sync(app: AppHandle, command: String, tool_id: String, profile_id: String) -> serde_json::Value {
    let say = |stage: String| {
        let _ = app.emit("agent:sshProgress", json!({ "profileId": profile_id, "stage": stage }));
    };
    let t = match parse_command(&command) {
        Ok(t) => t,
        Err(e) => return json!({ "ok": false, "output": e }),
    };
    let tool = agent_tool(&tool_id);
    let name = tool.map(|t| t.name).unwrap_or(&tool_id);
    let local = local_agent_dir(&app, &tool_id, &profile_id);
    let remote = remote_agent_dir(&profile_id);
    let target = format!("{}@{}", t.username, t.host);
    let mut id_args: Vec<String> = Vec::new();
    if let Some(idf) = &t.identity_file {
        id_args = vec!["-i".into(), idf.clone()];
    }
    let common: Vec<String> = ["-o".into(), "StrictHostKeyChecking=accept-new".into(), "-o".into(), "ConnectTimeout=15".into()].into_iter().collect();
    let ssh = |cmd: String, secs: u64| -> RunOut {
        let mut args = vec!["-p".into(), t.port.to_string()];
        args.extend(id_args.iter().cloned());
        args.extend(common.iter().cloned());
        args.push(target.clone());
        args.push(cmd);
        run("ssh", &args, Duration::from_secs(secs))
    };
    let mut log = String::new();

    // 0) target dir on the remote + is the CLI already there (decides the status text).
    say(format!("Connecting to {}…", t.host));
    let mk = ssh(format!("mkdir -p {remote}"), 60);
    if mk.code != 0 {
        let out = format!("{}\n{}", mk.out, mk.err).trim().to_string();
        return json!({ "ok": false, "output": if out.is_empty() { "ssh failed (auth/host?)".to_string() } else { out } });
    }

    let mut present = true;
    if let Some(tool) = tool {
        let probe = ssh(format!("{REMOTE_PATH}; command -v {} >/dev/null 2>&1 && echo yes || echo no", tool.cmd), 30);
        present = last_line(&probe.out) == "yes";
    }

    // 1) install the CLI remotely if missing (and we know an installer).
    if let Some(tool) = tool {
        if !present {
            if let Some(install) = tool.install_sh {
                say(format!("Installing {name} on {}… (may take a minute)", t.host));
                log += &format!("installing {name} on remote…\n");
                let ins = ssh(format!("{REMOTE_PATH}; {install}"), 300);
                log += &format!("{}\n", (ins.out + &ins.err).trim());
                let re = ssh(format!("{REMOTE_PATH}; command -v {} >/dev/null 2>&1 && echo yes || echo no", tool.cmd), 30);
                present = last_line(&re.out) == "yes";
                if present {
                    log += &format!("✓ {name} installed\n");
                } else {
                    log += &format!("⚠ {name} still not found after install — check the log above\n");
                }
            } else {
                log += &format!("{name} not on remote and no auto-installer — install it on the server.\n");
            }
        } else {
            log += &format!("✓ {name} present on remote\n");
        }
    }

    // 2) transfer the local session/tokens (if a local config exists) — no fresh /login.
    if local.is_dir() {
        say(format!("Transferring tokens to {}…", t.host));
        let mut args = vec!["-r".into(), "-P".into(), t.port.to_string()];
        args.extend(id_args.iter().cloned());
        args.extend(common.iter().cloned());
        args.push(format!("{}/.", local.to_string_lossy()));
        args.push(format!("{target}:{remote}/"));
        let cp = run("scp", &args, Duration::from_secs(180));
        if cp.code == 0 {
            log += "✓ tokens transferred\n";
        } else {
            log += &format!("token transfer failed:\n{}{}\n", cp.out, cp.err);
        }
    } else {
        say(format!("Ready — log in with /login on {}", t.host));
        log += "no local session to copy (you may need to /login on the remote)\n";
    }

    say("Done".into());
    json!({ "ok": true, "output": log.trim() })
}
