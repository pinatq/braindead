// Run: node scripts/markdown-viewer-check.mjs (Chrome; optional CHROME_BIN override).
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { spawnSync } from 'node:child_process'
import { build } from 'esbuild'

const root = fileURLToPath(new URL('../', import.meta.url))
const output = mkdtempSync(join(tmpdir(), 'braindead-markdown-'))
const sample = `# BrainDead — podgląd Markdown

Czytelny **tekst**, *wyróżnienia* i \`kod w zdaniu\`.

## Lista zadań
- Otwórz plik Markdown
- Kliknij **Preview**
  - Wróć do źródła przyciskiem **Source**

> Zmiana widoku zachowuje niezapisany tekst.

| Widok | Zastosowanie |
| --- | --- |
| Source | Edycja pliku |
| Preview | Czytanie dokumentu |

\`\`\`rust
fn main() {
    println!("Zażółć gęślą jaźń 🦀");
}
\`\`\`

[Dokumentacja](https://example.com/)
`

await build({
  stdin: {
    resolveDir: root, loader: 'jsx', contents: `
import React from 'react'
import { createRoot } from 'react-dom/client'
import ViewerPane from './src/renderer/src/components/ViewerPane'
import { useStore } from './src/renderer/src/state/store'
import './src/renderer/src/styles/theme.css'

const sample = ${JSON.stringify(sample)}
let source = sample, name = 'README.MD', saved = null
const file = () => ({name, path: '/test/' + name, base64: btoa(String.fromCharCode(...new TextEncoder().encode(source)))})
window.api = {
  files: {read: async () => file(), save: async (path, text) => { saved = {path, text, remote: false}; return {ok: true} }},
  ssh: {readFile: async () => file(), writeFile: async (conn, path, text) => { saved = {path, text, remote: conn}; return {ok: true} }}
}
useStore.setState({activePaneId: 'test', vimMode: false})
const root = createRoot(document.getElementById('root'))
const show = (remoteConn) => root.render(<ViewerPane paneId="test" filePath={'/test/' + name} remoteConn={remoteConn} />)
const check = (condition, message) => { if (!condition) throw new Error(message) }
const wait = async (fn) => {
  for (let n = 0; n < 400; n++) { if (fn()) return; await new Promise((r) => setTimeout(r, 10)) }
  throw new Error('Timed out: ' + fn)
}
const button = (label) => [...document.querySelectorAll('button')].find((b) => b.textContent === label)
const preview = async () => { button('Preview').click(); await wait(() => document.querySelector('.viewer-markdown')) }
const key = (key) => window.dispatchEvent(new KeyboardEvent('keydown', {key, bubbles: true, cancelable: true}))

async function run() {
  show()
  await wait(() => document.querySelector('textarea'))
  const textarea = document.querySelector('textarea')
  const draft = sample + '\\nNiezapisana zmiana.\\n' + '\\nDalszy akapit.\\n'.repeat(70) +
    '\\n<script>window.INJECTED = true</script>\\n<img src=x onerror="window.INJECTED=true">\\n[unsafe](javascript:alert%281%29)'
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(textarea, draft)
  textarea.dispatchEvent(new Event('input', {bubbles: true}))
  await preview()
  const article = document.querySelector('.viewer-markdown')
  check(article.querySelector('h1')?.textContent === 'BrainDead — podgląd Markdown', 'heading')
  check(article.querySelector('strong') && article.querySelector('em') && article.querySelector('ul ul'), 'inline and nested lists')
  check(article.querySelector('table tbody tr') && article.querySelector('pre code') && article.querySelector('blockquote'), 'tables/code/quotes')
  check(article.textContent.includes('Niezapisana zmiana.'), 'preview must use the current draft')
  check(!article.querySelector('script, img, [onerror], a[href^="javascript:"]') && !window.INJECTED, 'untrusted Markdown must remain inert')
  check(article.querySelector('a').target === '_blank' && article.querySelector('a').rel.includes('noopener'), 'links must preserve the app')
  check(saved === null, 'toggling must not save automatically')
  document.querySelector('[data-tip="Save"]').click()
  await wait(() => saved)
  check(saved.text === draft && !saved.remote, 'save must write Markdown, never rendered HTML')
  button('Source').click()
  await wait(() => document.querySelector('textarea'))
  check(document.querySelector('textarea').value === draft, 'round trip must preserve every character')
  await preview()
  useStore.setState({vimMode: true})
  await wait(() => document.querySelector('.viewer-mode'))
  const scroller = document.querySelector('.viewer-markdown-scroll')
  scroller.scrollTop = 0
  key('j')
  check(scroller.scrollTop > 0, 'vim scrolling')
  key('v')
  await wait(() => document.querySelector('.viewer-markdown').isContentEditable)
  const input = new InputEvent('beforeinput', {inputType: 'insertText', data: 'x', bubbles: true, cancelable: true})
  document.querySelector('.viewer-markdown').dispatchEvent(input)
  check(input.defaultPrevented, 'copy mode must not edit the preview')
  key('Escape')
  await wait(() => !document.querySelector('.viewer-markdown').isContentEditable)
  window.dispatchEvent(new CustomEvent('vibe-find', {detail: {type: 'query', paneId: 'test', query: 'podgląd', inNotes: false}}))
  check(CSS.highlights.get('vibe-find')?.size > 0, 'find in rendered text')

  name = 'plain.txt'; source = 'plain text'; show()
  await wait(() => document.querySelector('textarea')?.value === source)
  check(!button('Preview'), 'plain text must not get a Markdown toggle')
  name = 'REMOTE.markdown'; source = '# Remote'; saved = null; show('ssh-test')
  await wait(() => document.querySelector('textarea')?.value === source)
  await preview()
  document.querySelector('[data-tip="Save"]').click()
  await wait(() => saved)
  check(saved.remote === 'ssh-test' && saved.text === source, 'remote Markdown must save through SFTP')

  name = 'README.md'; source = sample; useStore.setState({vimMode: false}); show()
  await wait(() => document.querySelector('textarea')?.value === source)
  await preview()
  document.getElementById('result').dataset.result = 'passed'
  document.getElementById('result').textContent = 'PASS — draft, formatting, save, find, vim, safety, SFTP'
}
run().catch((e) => { document.getElementById('result').dataset.result = 'failed'; document.getElementById('result').textContent = e.stack })
`
  },
  outfile: join(output, 'check.js'), bundle: true, jsx: 'automatic',
  define: {'process.env.NODE_ENV': '"production"'}, loader: {'.woff2': 'dataurl'},
  plugins: [{name: 'unused-document-formats', setup(b) {
    b.onResolve({filter: /^(\.\/PdfView|docx-preview)$/}, (args) => ({path: args.path, namespace: 'unused'}))
    b.onLoad({filter: /.*/, namespace: 'unused'}, () => ({contents: 'export default () => null; export const renderAsync = async () => {}'}))
  }}]
})
writeFileSync(join(output, 'index.html'), `<!doctype html><meta charset="utf-8">
<link rel="stylesheet" href="check.css"><style>body{background:#0e0f13}#root{height:calc(100% - 28px)}#result{margin:0;padding:6px;color:#86efac;font:12px monospace}</style>
<div id="root"></div><pre id="result">Running…</pre><script src="check.js"></script>`)
const chrome = process.env.CHROME_BIN || (process.platform === 'darwin'
  ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : 'google-chrome')
const result = spawnSync(chrome, [
  '--headless', '--disable-background-networking', '--disable-extensions', '--no-first-run',
  '--no-default-browser-check', '--user-data-dir=' + join(output, 'profile'),
  '--window-size=1000,1000', '--virtual-time-budget=10000',
  '--screenshot=' + join(output, 'preview.png'), '--dump-dom', pathToFileURL(join(output, 'index.html')).href
], {encoding: 'utf8', timeout: 30000, maxBuffer: 5_000_000})
assert.equal(result.status, 0, result.error?.message || result.stderr)
assert.match(result.stdout, /data-result="passed"/, result.stdout.slice(-5000))
console.log('Markdown viewer check passed. Screenshot: ' + join(output, 'preview.png'))
