// RAM monitor — port of startRamMonitor in Electron's src/main/index.ts.
// Every ~3s emits `ram:stats` { appMb, freeMb, totalMb }: appMb = summed memory of this
// process tree (best-effort equivalent of app.getAppMetrics()), free/total from the OS.
use std::collections::HashMap;

use serde::Serialize;
use sysinfo::{Pid, ProcessesToUpdate, System};
use tauri::{AppHandle, Emitter};

const TICK_MS: u64 = 3000;

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct RamStats {
    app_mb: u64,
    free_mb: u64,
    total_mb: u64,
}

pub fn start(app: AppHandle) {
    std::thread::spawn(move || {
        let mut sys = System::new();
        let own = Pid::from_u32(std::process::id());
        loop {
            sys.refresh_memory();
            sys.refresh_processes(ProcessesToUpdate::All, true);
            // Sum our process tree: BFS over parent links (app + child webviews/agents).
            let mut children_of: HashMap<Pid, Vec<Pid>> = HashMap::new();
            for (pid, proc_) in sys.processes() {
                if let Some(parent) = proc_.parent() {
                    children_of.entry(parent).or_default().push(*pid);
                }
            }
            let mut app_bytes = 0u64;
            let mut stack = vec![own];
            while let Some(pid) = stack.pop() {
                if let Some(proc_) = sys.process(pid) {
                    app_bytes += proc_.memory();
                }
                if let Some(kids) = children_of.get(&pid) {
                    stack.extend(kids.iter().copied());
                }
            }
            let stats = RamStats {
                app_mb: app_bytes / 1_048_576,
                free_mb: sys.free_memory() / 1_048_576,
                total_mb: sys.total_memory() / 1_048_576,
            };
            let _ = app.emit("ram:stats", stats);
            std::thread::sleep(std::time::Duration::from_millis(TICK_MS));
        }
    });
}
