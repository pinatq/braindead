// Run: node scripts/terminal-render-check.mjs (Chrome; optional CHROME_BIN override).
// Renders the real TerminalPane over a fake PTY and checks what long agent sessions broke:
// glyphs after WebGL atlas page merges, emoji widths and the smear cursor.
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { spawn } from 'node:child_process'
import { build } from 'esbuild'

const root = fileURLToPath(new URL('../', import.meta.url))
const output = mkdtempSync(join(tmpdir(), 'braindead-terminal-'))

await build({
  stdin: {
    resolveDir: root, loader: 'jsx', contents: `
import React from 'react'
import { createRoot } from 'react-dom/client'
import { Terminal } from '@xterm/xterm'
import TerminalPane from './src/renderer/src/components/TerminalPane'
import { useStore } from './src/renderer/src/state/store'
import './src/renderer/src/styles/theme.css'

// Which atlas canvas really sits in which GPU texture — a mismatch is a garbled glyph.
const uploaded = new WeakMap(), mergedPages = new Set()
const gl = WebGL2RenderingContext.prototype
const { activeTexture, bindTexture, texImage2D } = gl
gl.activeTexture = function (unit) { this.unit = unit; return activeTexture.call(this, unit) }
gl.bindTexture = function (target, tex) { (this.bound ??= new Map()).set(this.unit, tex); return bindTexture.call(this, target, tex) }
gl.texImage2D = function (...a) {
  const canvas = a.at(-1)
  if (canvas instanceof HTMLCanvasElement) {
    uploaded.set(this.bound?.get(this.unit), canvas)
    if (canvas.width > 512) mergedPages.add(canvas)
  }
  return texImage2D.apply(this, a)
}

let term, feed
const open = Terminal.prototype.open
Terminal.prototype.open = function (el) { term = this; return open.call(this, el) }
window.api = {
  pty: {
    onData: (id, cb) => {
      feed = (s) => new Promise((r) => cb({ id, data: new TextEncoder().encode(s), acknowledge: r }))
      return () => {}
    },
    onAlt: () => () => {},
    ensure: async () => ({ existed: false, alt: false }),
    input: () => {},
    resize: () => {}
  },
  store: { save: async () => {} }
}
useStore.setState({ activePaneId: 'test', vimMode: false, smearCursor: true })
createRoot(document.getElementById('root')).render(<TerminalPane paneId="test" />)

const check = (condition, message) => { if (!condition) throw new Error(message) }
const wait = async (fn) => {
  for (let n = 0; n < 400; n++) { if (fn()) return; await new Promise((r) => setTimeout(r, 10)) }
  throw new Error('Timed out: ' + fn)
}
const frames = (n) => new Promise((r) => { const f = () => (--n ? requestAnimationFrame(f) : r()); requestAnimationFrame(f) })
// The smear animates on animation frames; wait for their clock (virtual time can skip timers).
const settle = () => new Promise((r) => {
  const t0 = performance.now()
  const f = (t) => (t - t0 > 600 ? r() : requestAnimationFrame(f))
  requestAnimationFrame(f)
})

async function run() {
  await wait(() => term && feed && document.querySelector('.smear-cursor'))
  const glyphs = term._core._renderService._renderer.value._glyphRenderer?.value
  check(glyphs, 'WebGL renderer must be active')

  await feed('\\x1b[H✅x')
  check(term.buffer.active.cursorX === 3, 'emoji must take 2 columns, like in Claude Code and Codex')

  // Every line in a new colour = new glyphs; enough of them makes the atlas merge its pages.
  const text = 'Zazolc gesla jazn: THE QUICK BROWN FOX 0123456789 {}[]<>'
  const color = (c) => '\\x1b[38;2;' + (128 + (c & 127)) + ';' + (128 + ((c >> 7) & 127)) + ';255m'
  const screen = (pick) => {
    let s = '\\x1b[H'
    for (let i = 0; i < term.rows - 1; i++) s += color(pick(i)) + text + '\\x1b[0m\\x1b[K\\r\\n'
    return s
  }
  let c = 0
  for (let round = 0; round < 400 && mergedPages.size < 3; round++) {
    await feed(screen(() => c++))
    await frames(2)
    document.getElementById('result').textContent = 'Running… atlas round ' + round + ', merged pages ' + mergedPages.size
  }
  check(mergedPages.size >= 3, 'atlas pages must have merged')
  const total = c
  await feed(screen((i) => Math.floor((i * total) / (term.rows - 1)))) // glyphs from every page
  await frames(4)
  const stale = glyphs._atlas.pages.flatMap((p, i) => uploaded.get(glyphs._atlasTextures[i].texture) === p.canvas ? [] : [i])
  check(!stale.length, 'stale GPU atlas textures (garbled letters) in slots ' + stale)

  term.focus()
  term._core.coreService.isCursorInitialized = true // as after clicking into the terminal
  const smear = document.querySelector('.smear-cursor')
  const at = () => {
    if (smear.hidden) return 'hidden'
    const s = term.element.querySelector('.xterm-screen').getBoundingClientRect()
    const r = smear.getBoundingClientRect()
    return Math.round((r.left - s.left) / (s.width / term.cols)) + ',' + Math.round((r.top - s.top) / (s.height / term.rows))
  }
  const cursor = () => { const b = term.buffer.active; return b.cursorX + ',' + (b.baseY + b.cursorY - b.viewportY) }
  // Cursor 10 rows above the bottom, like an agent's input box above its status lines.
  await feed('\\x1b[2J\\x1b[H' + 'line\\r\\n'.repeat(120) + 'user@host ~ % echo hi\\x1b[10A')
  await settle()
  check(at() === cursor(), 'smear must sit on the cursor: ' + at() + ' vs ' + cursor())
  term.scrollLines(-5)
  await settle()
  check(at() === cursor(), 'smear must move with scrolled text: ' + at() + ' vs ' + cursor())
  term.scrollLines(-30)
  await settle()
  check(at() === 'hidden', 'smear must hide when the cursor is scrolled out of view: ' + at())
  term.scrollToBottom()
  await feed('\\x1b[?25l')
  await settle()
  check(at() === 'hidden', 'smear must hide while the program hides the cursor: ' + at())
  await feed('\\x1b[?25h')
  await settle()
  check(at() === cursor(), 'smear must return with the cursor: ' + at() + ' vs ' + cursor())

  document.getElementById('result').dataset.result = 'passed'
  document.getElementById('result').textContent = 'PASS — atlas merges (' + mergedPages.size + '), emoji width, smear cursor'
}
run().catch((e) => { document.getElementById('result').dataset.result = 'failed'; document.getElementById('result').textContent = e.stack })
`
  },
  outfile: join(output, 'check.js'), bundle: true, jsx: 'automatic',
  define: {'process.env.NODE_ENV': '"production"'}, loader: {'.woff2': 'dataurl'}, logLevel: 'error'
})
writeFileSync(join(output, 'index.html'), `<!doctype html><meta charset="utf-8">
<link rel="stylesheet" href="check.css"><style>body{background:#0e0f13}#root{height:calc(100% - 28px)}#result{margin:0;padding:6px;color:#86efac;font:12px monospace}</style>
<div id="root"></div><pre id="result">Running…</pre><script src="check.js"></script>`)
const chrome = process.env.CHROME_BIN || (process.platform === 'darwin'
  ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : 'google-chrome')
// Real time over DevTools, not --virtual-time-budget: virtual time skips ahead between animation
// frames, and xterm and the smear cursor both render on animation frames.
const browser = spawn(chrome, [
  '--headless', '--remote-debugging-port=0', '--disable-background-networking', '--disable-extensions',
  '--no-first-run', '--no-default-browser-check', '--user-data-dir=' + join(output, 'profile'),
  '--enable-unsafe-swiftshader', '--window-size=1000,1000', '--force-device-scale-factor=2',
  pathToFileURL(join(output, 'index.html')).href
])
const timer = setTimeout(() => { browser.kill(); throw new Error('Timed out after 120 s') }, 120000)
try {
  const port = await new Promise((resolve, reject) => {
    browser.stderr.on('data', (d) => { const m = /ws:\/\/[^:]+:(\d+)\//.exec(d); if (m) resolve(m[1]) })
    browser.on('exit', (code) => reject(new Error('Chrome exited: ' + code)))
  })
  const [page] = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).filter((t) => t.type === 'page')
  const ws = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((r) => ws.addEventListener('open', r))
  const replies = new Map()
  ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); replies.get(m.id)?.(m.result) })
  const send = (method, params) => new Promise((r) => {
    replies.set(replies.size + 1, r)
    ws.send(JSON.stringify({ id: replies.size, method, params }))
  })
  const { result } = await send('Runtime.evaluate', { awaitPromise: true, returnByValue: true, expression: `
    new Promise((r) => { const f = () => { const el = document.getElementById('result')
      el?.dataset.result ? r(el.dataset.result + ': ' + el.textContent) : setTimeout(f, 100) }; f() })` })
  const { data } = await send('Page.captureScreenshot', {})
  writeFileSync(join(output, 'preview.png'), Buffer.from(data, 'base64'))
  assert.match(result.value, /^passed/, result.value)
  console.log('Terminal render check passed. Screenshot: ' + join(output, 'preview.png'))
} finally {
  clearTimeout(timer)
  browser.kill()
}
