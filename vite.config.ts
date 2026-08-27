import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [react()],
  // Match the Electron renderer's "@" alias (-> src/renderer/src).
  resolve: { alias: { "@": fileURLToPath(new URL("./src/renderer/src", import.meta.url)) } },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,

  build: {
    // Aplikacja chodzi wyłącznie w WKWebView (macOS) / WebView2 (Windows) / WebKitGTK
    // (Linux) — nie ma po co transpilować do ES2015 ani dokładać polyfilli dla przeglądarek,
    // których ten kod nigdy nie zobaczy.
    target: ["es2022", "safari16", "chrome110"],
    // pdf.js i docx-preview są ładowane leniwie i z natury przekraczają domyślny próg —
    // ostrzeżenie o rozmiarze chunka byłoby tu tylko szumem.
    chunkSizeWarningLimit: 1800,
  },
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    // 1430 (not Tauri's default 1420) to avoid colliding with other local dev servers.
    port: 1430,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1431,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
}));
