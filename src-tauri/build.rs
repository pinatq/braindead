// Generuje rustową tablicę AGENT_TOOLS z ../src/shared/agents.json — tego samego pliku,
// który czyta frontend. Bez tego rejestr narzędzi żyłby w dwóch kopiach i rozjechałby się
// przy pierwszej zmianie (tak właśnie było przed migracją).
use std::fmt::Write as _;

fn main() {
    generuj_rejestr_agentow();
    tauri_build::build()
}

fn generuj_rejestr_agentow() {
    const SRC: &str = "../src/shared/agents.json";
    println!("cargo:rerun-if-changed={SRC}");

    let raw = std::fs::read_to_string(SRC).expect("brak src/shared/agents.json");
    let tools: serde_json::Value = serde_json::from_str(&raw).expect("agents.json to nie poprawny JSON");
    let tools = tools.as_array().expect("agents.json musi być tablicą");

    let opt = |v: Option<&serde_json::Value>| match v.and_then(|x| x.as_str()) {
        Some(s) => format!("Some({s:?})"),
        None => "None".to_string(),
    };

    let mut out = String::from("// WYGENEROWANE przez build.rs z src/shared/agents.json — nie edytuj ręcznie.\n");
    let _ = writeln!(out, "pub const AGENT_TOOLS: &[AgentTool] = &[");
    for t in tools {
        let s = |k: &str| t.get(k).and_then(|x| x.as_str()).unwrap_or_default().to_string();
        let install_sh = opt(t.get("install").and_then(|i| i.get("sh")));
        let _ = writeln!(
            out,
            "    AgentTool {{ id: {:?}, name: {:?}, cmd: {:?}, config_env: {}, api_key_env: {}, install_sh: {} }},",
            s("id"), s("name"), s("cmd"),
            opt(t.get("configEnv")), opt(t.get("apiKeyEnv")), install_sh,
        );
    }
    out.push_str("];\n");

    let dir = std::env::var("OUT_DIR").expect("brak OUT_DIR");
    std::fs::write(std::path::Path::new(&dir).join("agent_tools.rs"), out).expect("zapis agent_tools.rs");
}
