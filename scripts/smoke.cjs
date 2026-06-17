// Szybki smoke-test: uruchamia zbudowaną aplikację, po chwili ją zamyka i liczy
// niebezpieczne komunikaty (crash node-pty, błędy NAPI, nieobsłużone wyjątki, leak listenerów).
const { spawn } = require('child_process')
const electron = require('electron') // w kontekście node zwraca ścieżkę do binarki

const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE // w tym sandboxie wymusza tryb node — psuje Electron

const child = spawn(electron, ['out/main/index.js', '--no-sandbox'], {
  env,
  stdio: ['ignore', 'pipe', 'pipe']
})

let out = ''
const collect = (d) => {
  out += d.toString()
}
child.stdout.on('data', collect)
child.stderr.on('data', collect)

const count = (re) => (out.match(re) || []).length
const report = (label) => {
  console.log(
    `${label} posix=${count(/posix_spawnp failed/g)}  napi=${count(/napi|Object has been destroyed/gi)}  ` +
      `uncaught=${count(/uncaughtException|Unhandled/g)}  handler=${count(/No handler registered/g)}  ` +
      `maxlisten=${count(/MaxListenersExceededWarning/g)}`
  )
}

setTimeout(() => {
  report('running:')
  child.kill('SIGTERM')
  setTimeout(() => {
    report('after quit:')
    process.exit(0)
  }, 1500)
}, 6000)
