// Połączenia SSH/SFTP do eksploratora i viewera. Połączenia żyją tylko w pamięci tego procesu
// (NIE zapisujemy haseł na dysk) — po restarcie trzeba połączyć się ponownie.
import { Client, type ConnectConfig } from 'ssh2'
import type { FileEntryWithStats, SFTPWrapper, Stats } from 'ssh2'
import { posix } from 'path'
import { readFileSync } from 'fs'
import os from 'os'
import type { DirListing, LoadedFile, SshConfig, SshResult } from '../shared/types'

interface Conn {
  client: Client
  sftp: SFTPWrapper
  label: string
}

const conns = new Map<string, Conn>()
let seq = 0

const S_IFMT = 0o170000
const S_IFDIR = 0o040000

function isDir(attrs: Stats): boolean {
  if (typeof attrs.isDirectory === 'function') return attrs.isDirectory()
  return (attrs.mode & S_IFMT) === S_IFDIR
}

function get(id: string): Conn {
  const c = conns.get(id)
  if (!c) throw new Error('SSH not connected (reconnect)')
  return c
}

function extOf(name: string): string {
  return name.split('.').pop()?.toLowerCase() ?? ''
}

function expandHome(p: string): string {
  if (p === '~') return os.homedir()
  if (p.startsWith('~/')) return posix.join(os.homedir(), p.slice(2))
  return p
}

interface SshTarget {
  host: string
  port: number
  username: string
  identityFile?: string
}

// Wyciąga z ~/.ssh/config ustawienia dla danego aliasu Host (HostName/User/Port/IdentityFile).
function fromSshConfig(alias: string): Partial<SshTarget> {
  try {
    const text = readFileSync(posix.join(os.homedir(), '.ssh', 'config'), 'utf8')
    const out: Partial<SshTarget> = {}
    let inBlock = false
    for (const raw of text.split('\n')) {
      const line = raw.trim()
      if (!line || line.startsWith('#')) continue
      const m = line.match(/^(\S+)\s+(.+)$/)
      if (!m) continue
      const key = m[1].toLowerCase()
      const val = m[2].trim()
      if (key === 'host') {
        inBlock = val.split(/\s+/).includes(alias)
        continue
      }
      if (!inBlock) continue
      if (key === 'hostname') out.host = val
      else if (key === 'user') out.username = val
      else if (key === 'port') out.port = Number(val) || undefined
      else if (key === 'identityfile') out.identityFile = expandHome(val)
    }
    return out
  } catch {
    return {}
  }
}

// Parsuje polecenie "ssh [user@]host [-p port] [alias]" → cel połączenia (z dociągnięciem ~/.ssh/config).
export function parseCommand(command: string): SshTarget {
  const toks = command.trim().replace(/^ssh\s+/i, '').split(/\s+/).filter(Boolean)
  let user = ''
  let host = ''
  let port = 0
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i]
    if (t === '-p' && toks[i + 1]) {
      port = Number(toks[++i]) || 0
    } else if (t.startsWith('-p')) {
      port = Number(t.slice(2)) || 0
    } else if (t.startsWith('-')) {
      i++ // pomiń wartość nieznanej flagi
    } else if (!host) {
      if (t.includes('@')) {
        const [u, h] = t.split('@')
        user = u
        host = h
      } else {
        host = t
      }
    }
  }
  // Spróbuj dociągnąć z ~/.ssh/config (alias lub uzupełnienie usera/portu/klucza).
  const cfg = fromSshConfig(host)
  return {
    host: cfg.host || host,
    username: user || cfg.username || os.userInfo().username,
    port: port || cfg.port || 22,
    identityFile: cfg.identityFile
  }
}

/** Nawiązuje połączenie SSH (parsuje polecenie) + otwiera SFTP. Zwraca id połączenia i katalog domowy. */
export async function sshConnect(cfg: SshConfig): Promise<SshResult> {
  let target: SshTarget
  try {
    target = parseCommand(cfg.command || '')
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
  if (!target.host) return { ok: false, error: 'No host in command' }

  const conf: ConnectConfig = {
    host: target.host,
    port: target.port,
    username: target.username,
    readyTimeout: 15000
  }
  if (cfg.password) conf.password = cfg.password
  else if (target.identityFile) {
    try {
      conf.privateKey = readFileSync(target.identityFile)
    } catch {
      /* brak/niedostępny klucz — spróbujemy agenta niżej */
    }
  }
  if (!conf.password && !conf.privateKey && process.env.SSH_AUTH_SOCK) {
    conf.agent = process.env.SSH_AUTH_SOCK // klucze z agenta SSH
  }

  return new Promise((resolve) => {
    const client = new Client()
    let settled = false
    const done = (r: SshResult): void => {
      if (settled) return
      settled = true
      resolve(r)
    }
    client.on('ready', () => {
      client.sftp((err, sftp) => {
        if (err) {
          client.end()
          return done({ ok: false, error: err.message })
        }
        sftp.realpath('.', (e, home) => {
          const id = 'ssh' + ++seq
          const label = `${target.username}@${target.host}`
          conns.set(id, { client, sftp, label })
          done({ ok: true, id, home: e ? '/' : home, label })
        })
      })
    })
    client.on('error', (e) => done({ ok: false, error: e.message }))
    client.connect(conf)
  })
}

export function sshDisconnect(id: string): void {
  const c = conns.get(id)
  if (c) {
    try {
      c.client.end()
    } catch {
      /* już zamknięte */
    }
    conns.delete(id)
  }
}

export function sshDisconnectAll(): void {
  for (const id of [...conns.keys()]) sshDisconnect(id)
}

function realpath(c: Conn, p: string): Promise<string> {
  const target = !p || p === '~' ? '.' : p.startsWith('~/') ? p.slice(2) : p
  return new Promise((resolve, reject) =>
    c.sftp.realpath(target || '.', (e, abs) => (e ? reject(e) : resolve(abs)))
  )
}

/** Listuje zdalny katalog (foldery przed plikami, alfabetycznie) — kształt jak lokalny DirListing. */
export async function sshReadDir(id: string, dirPath: string): Promise<DirListing> {
  const c = get(id)
  const abs = await realpath(c, dirPath)
  const list = await new Promise<FileEntryWithStats[]>((resolve, reject) =>
    c.sftp.readdir(abs, (e, l) => (e ? reject(e) : resolve(l)))
  )
  const entries = list
    .map((en) => ({ name: en.filename, isDir: isDir(en.attrs), path: posix.join(abs, en.filename) }))
    .sort((a, b) =>
      a.isDir !== b.isDir ? (a.isDir ? -1 : 1) : a.name.localeCompare(b.name, undefined, { numeric: true })
    )
  const parent = posix.dirname(abs)
  return { path: abs, parent: parent === abs ? null : parent, entries }
}

/** Wczytuje zdalny plik jako base64 (do viewera). */
export async function sshReadFile(id: string, filePath: string): Promise<LoadedFile> {
  const c = get(id)
  const buf = await new Promise<Buffer>((resolve, reject) =>
    c.sftp.readFile(filePath, (e, d) => (e ? reject(e) : resolve(d as Buffer)))
  )
  return { name: posix.basename(filePath), ext: extOf(filePath), base64: buf.toString('base64'), path: filePath }
}

/** Zapisuje tekst do zdalnego pliku (edycja text/markdown w viewerze). */
export async function sshWriteFile(id: string, filePath: string, content: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const c = get(id)
    await new Promise<void>((resolve, reject) =>
      c.sftp.writeFile(filePath, content, { encoding: 'utf8' }, (e) => (e ? reject(e) : resolve()))
    )
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

export async function sshMakeDir(id: string, dir: string, name: string): Promise<{ ok: boolean; path?: string; error?: string }> {
  try {
    const c = get(id)
    const target = posix.join(dir, name)
    await new Promise<void>((resolve, reject) => c.sftp.mkdir(target, (e) => (e ? reject(e) : resolve())))
    return { ok: true, path: target }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

export async function sshMakeFile(id: string, dir: string, name: string): Promise<{ ok: boolean; path?: string; error?: string }> {
  try {
    const c = get(id)
    const target = posix.join(dir, name)
    await new Promise<void>((resolve, reject) =>
      c.sftp.writeFile(target, '', { flag: 'wx' }, (e) => (e ? reject(e) : resolve()))
    )
    return { ok: true, path: target }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

/** Usuwa zdalny plik (unlink) lub PUSTY katalog (rmdir). Niszczące — renderer pyta przez confirm(). */
export async function sshDelete(id: string, p: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const c = get(id)
    const st = await new Promise<Stats>((resolve, reject) => c.sftp.stat(p, (e, s) => (e ? reject(e) : resolve(s))))
    await new Promise<void>((resolve, reject) => {
      const cb = (e: Error | null | undefined): void => (e ? reject(e) : resolve())
      if (isDir(st)) c.sftp.rmdir(p, cb)
      else c.sftp.unlink(p, cb)
    })
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}
