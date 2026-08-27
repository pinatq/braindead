import { useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";

// Phase 2 de-risk: a real terminal over the native PTY core. On mount it spawns a shell,
// streams batched output in, and auto-runs a flood command so the Rust side can print the
// emits/s-vs-bytes/s ratio (the batching / kernel_task proof). Note the full useEffect cleanup
// (dispose + kill + unlisten + observer) — exactly the lifecycle the Electron renderer audit
// flagged as leaky.
const ID = "t1";
const b64ToBytes = (b: string) => Uint8Array.from(atob(b), (c) => c.charCodeAt(0));

function App() {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const term = new Terminal({
      fontFamily: "ui-monospace, SFMono-Regular, monospace",
      fontSize: 13,
      scrollback: 2000,
      theme: { background: "#0e0f13", foreground: "#d6d6d6" },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(ref.current!);
    fit.fit();

    let unlisten: (() => void) | undefined;
    let disposed = false;
    (async () => {
      unlisten = await listen<[string, string]>("pty:data", (e) => {
        const [id, data] = e.payload;
        if (id === ID && !disposed) term.write(b64ToBytes(data));
      });
      await invoke("pty_spawn", { id: ID, cols: term.cols, rows: term.rows });
      // Flood test: bounded burst of output to demonstrate output coalescing.
      setTimeout(() => invoke("pty_write", { id: ID, data: "ls -laR /usr 2>/dev/null | head -n 200000\n" }), 1000);
    })();

    const onData = term.onData((d) => invoke("pty_write", { id: ID, data: d }));
    const ro = new ResizeObserver(() => {
      fit.fit();
      invoke("pty_resize", { id: ID, cols: term.cols, rows: term.rows });
    });
    ro.observe(ref.current!);

    return () => {
      disposed = true;
      unlisten?.();
      onData.dispose();
      ro.disconnect();
      term.dispose();
      invoke("pty_kill", { id: ID });
    };
  }, []);

  return <div ref={ref} style={{ position: "absolute", inset: 0, padding: 6, background: "#0e0f13" }} />;
}

export default App;
