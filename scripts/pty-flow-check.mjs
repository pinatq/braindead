// Run: node scripts/pty-flow-check.mjs (uses the project's existing TypeScript compiler).
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

const listeners = new Map()
const calls = []
let ready
const dataReady = new Promise((resolve) => { ready = resolve })
const window = {}
const source = readFileSync(new URL('../src/renderer/src/tauri-bridge.ts', import.meta.url), 'utf8')
runInNewContext(ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }
}).outputText, {
  exports: {}, window, Uint8Array, atob,
  require: (name) => {
    if (name === '@tauri-apps/api/core') return {
      invoke: async (command, args) => { calls.push({ command, ...args }) }
    }
    if (name === '@tauri-apps/api/event') return {
      listen: (event, cb) => {
        listeners.set(event, cb)
        return event === 'pty:data' ? dataReady : Promise.resolve(() => {})
      }
    }
    throw new Error(`Unexpected import: ${name}`)
  }
})

const { pty } = window.api
const acks = () => calls.filter((c) => c.command === 'pty_ack')
const emit = (id, generation, bytes, end) => listeners.get('pty:data')({
  payload: [id, generation, Buffer.from(bytes).toString('base64'), end]
})

const spawning = pty.ensure('one', { cols: 80, rows: 24 })
await Promise.resolve()
assert.equal(calls.length, 0, 'spawn must wait for the output listener')
ready(() => {})
await spawning
assert.equal(calls[0].command, 'pty_spawn')

const frames = []
const off = pty.onData('one', (e) => frames.push(e))
const second = []
const offSecond = pty.onData('two', (e) => second.push(e))
// Raw bytes, split UTF-8 and split alternate-screen escapes must pass through untouched.
const bytes = Buffer.from('\x1b[?1049hzażółć 🦀\x1b[?1049l')
for (let i = 0; i < bytes.length; i++) emit('one', 7, bytes.subarray(i, i + 1), i + 1)
assert.equal(acks().length, 0, 'receiving data is not the same as parsing it')
assert.equal(second.length, 0, 'output belongs to exactly one terminal')
assert.deepEqual(Buffer.concat(frames.map((e) => Buffer.from(e.data))), bytes)
frames[0].acknowledge()
frames[0].acknowledge()
assert.equal(acks().length, 1, 'duplicate callbacks cannot release credit twice')
assert.deepEqual(acks()[0], { command: 'pty_ack', id: 'one', generation: 7, end: 1 })

emit('two', 8, [0, 255], 2)
second[0].acknowledge()
assert.equal(acks().at(-1).id, 'two', 'another terminal can make independent progress')
const beforeReplay = acks().length
emit('one', 7, bytes, null)
frames.at(-1).acknowledge()
assert.equal(acks().length, beforeReplay, 'history replay must not acknowledge live output')

off() // xterm.dispose() may abandon all remaining write callbacks
assert.equal(acks().filter((c) => c.id === 'one').length, bytes.length)
const afterDetach = acks().length
frames.forEach((e) => e.acknowledge())
assert.equal(acks().length, afterDetach, 'late callbacks after unmount are harmless')
emit('one', 7, [10], bytes.length + 1)
assert.equal(acks().length, afterDetach + 1, 'a session without a view must keep running')

const remounted = []
const offNew = pty.onData('one', (e) => remounted.push(e))
off() // a stale cleanup must not detach the new subscription
emit('one', 9, [65], 1)
assert.equal(remounted.length, 1)
assert.equal(acks().length, afterDetach + 1)
remounted[0].acknowledge()
assert.equal(acks().at(-1).generation, 9, 'ACK identifies the new process, not just its pane')
offNew()
offSecond()
console.log('PTY flow check passed: parsing ACKs, byte integrity, replay, unmount and remount.')
