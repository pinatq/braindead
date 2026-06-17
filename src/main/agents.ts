import { execFile } from 'child_process'
import { existsSync } from 'fs'
import os from 'os'
import path from 'path'
import { app } from 'electron'
import { agentTool } from '../shared/agents'
import { parseCommand } from './ssh'
import type { ClaudeCliStatus } from '../shared/types'

// Zdalny folder configu agenta (względem $HOME na serwerze) — jeden na profil.
export function remoteAgentDir(profileId: string): string {
  return `.braindead-agents/${profileId}`
}

// Lokalny, izolowany folder configu danego profilu (ten sam co PtyManager.ensure).
function localAgentDir(toolId: string, profileId: string): string {
  return path.join(app.getPath('userData'), toolId === 'claude' ? 'claude' : 'agents', profileId)
}

function run(file: string, args: string[], timeoutMs: number): Promise<{ code: number; out: string; err: string }> {
  return new Promise((resolve) => {
    execFile(file, args, { timeout: timeoutMs }, (e, stdout, stderr) =>
      resolve({ code: e ? ((e as { code?: number }).code ?? 1) : 0, out: String(stdout), err: String(stderr) })
    )
  })
}

const SHELL = process.env.SHELL || (os.platform() === 'win32' ? 'powershell.exe' : '/bin/bash')

// Detekcję i instalację robimy przez powłokę INTERAKTYWNĄ (-ic) — tak samo jak panel agenta
// uruchamia CLI, więc widzimy ten sam PATH (rc usera zwykle dodaje ~/.local/bin, brew, npm-global itp.).
function runInShell(cmd: string, timeoutMs: number): Promise<{ code: number; out: string; err: string }> {
  return new Promise((resolve) => {
    if (os.platform() === 'win32') {
      execFile(
        'powershell.exe',
        ['-NoProfile', '-Command', cmd],
        { timeout: timeoutMs, windowsHide: true },
        (e, stdout, stderr) => resolve({ code: e ? 1 : 0, out: String(stdout), err: String(stderr) })
      )
      return
    }
    execFile(SHELL, ['-ic', cmd], { timeout: timeoutMs }, (e, stdout, stderr) =>
      resolve({
        code: e && typeof (e as { code?: number }).code === 'number' ? (e as { code: number }).code : e ? 1 : 0,
        out: String(stdout),
        err: String(stderr)
      })
    )
  })
}

/** Czy dana komenda CLI (np. `claude`, `gemini`) jest na PATH użytkownika (+ ścieżka). */
export async function agentStatus(cmd: string): Promise<ClaudeCliStatus> {
  if (!cmd) return { installed: false }
  const probe = os.platform() === 'win32' ? `(Get-Command ${cmd}).Source` : `command -v ${cmd}`
  const r = await runInShell(probe, 8000)
  const path = r.out.trim().split('\n')[0]?.trim()
  return { installed: r.code === 0 && !!path, path: path || undefined }
}

/** Instaluje CLI danego narzędzia (komenda z rejestru AGENT_TOOLS). Zwraca log + status po instalacji. */
export async function agentInstall(toolId: string): Promise<{ ok: boolean; output: string }> {
  const tool = agentTool(toolId)
  const cmd = os.platform() === 'win32' ? tool?.install?.ps : tool?.install?.sh
  if (!tool || !cmd) {
    return { ok: false, output: `No automatic installer for ${toolId} — install it manually, then reload.` }
  }
  const r = await runInShell(cmd, 240000)
  const output = (r.out + '\n' + r.err).trim()
  const ok = (await agentStatus(tool.cmd)).installed
  return { ok, output }
}

/**
 * Przygotowuje zdalny host do uruchomienia agenta:
 *  1) kopiuje lokalny, izolowany config konta (token/login) przez scp — jeśli istnieje lokalnie,
 *  2) jeśli na zdalnym brak danego CLI, a znamy instalator — instaluje je na zdalnym.
 * Dzięki temu nie logujesz się od nowa. UWAGA: wysyła token/login na zdalną maszynę — UI pyta o
 * zgodę (confirm) przed wywołaniem. Auth scp/ssh przez klucz/agenta (jak eksplorator).
 */
// PATH na zdalnym hoście: świeżo zainstalowane CLI siedzi w ~/.local/bin (claude) lub ~/.npm-global/bin
// (npm), a komenda przez ssh nie czyta rc usera — dlatego sami dokładamy te ścieżki przy każdym probe.
const REMOTE_PATH = 'export PATH="$HOME/.local/bin:$HOME/bin:$HOME/.npm-global/bin:$PATH"'

// Ostatnia niepusta linia outputu (banner/MOTD z ssh potrafi zaśmiecić początek).
function lastLine(s: string): string {
  const lines = s.trim().split('\n')
  return (lines[lines.length - 1] || '').trim()
}

export async function agentSshSync(
  command: string,
  toolId: string,
  profileId: string,
  onProgress?: (stage: string) => void
): Promise<{ ok: boolean; output: string }> {
  if (os.platform() === 'win32') {
    return { ok: false, output: 'SSH setup is not supported on Windows yet — log in on the remote.' }
  }
  const t = parseCommand(command)
  const tool = agentTool(toolId)
  const name = tool?.name ?? toolId
  const local = localAgentDir(toolId, profileId)
  const remote = remoteAgentDir(profileId)
  const target = `${t.username}@${t.host}`
  const idArgs = t.identityFile ? ['-i', t.identityFile] : []
  const common = ['-o', 'StrictHostKeyChecking=accept-new', '-o', 'ConnectTimeout=15']
  const ssh = (cmd: string, ms: number): ReturnType<typeof run> =>
    run('ssh', ['-p', String(t.port), ...idArgs, ...common, target, cmd], ms)
  const say = (s: string): void => onProgress?.(s)
  let log = ''

  // 0) folder docelowy na zdalnym + sprawdzenie, czy CLI już tam jest (decyduje o treści statusu).
  say(`Connecting to ${t.host}…`)
  const mk = await ssh(`mkdir -p ${remote}`, 60000)
  if (mk.code !== 0) return { ok: false, output: (mk.out + '\n' + mk.err).trim() || 'ssh failed (auth/host?)' }

  let present = true
  if (tool?.cmd) {
    const probe = await ssh(`${REMOTE_PATH}; command -v ${tool.cmd} >/dev/null 2>&1 && echo yes || echo no`, 30000)
    present = lastLine(probe.out) === 'yes'
  }

  // 1) instalacja CLI na zdalnym, gdy go brak (a znamy instalator). Status: „Installing …".
  if (tool?.cmd && !present) {
    if (tool.install?.sh) {
      say(`Installing ${name} on ${t.host}… (may take a minute)`)
      log += `installing ${name} on remote…\n`
      const ins = await ssh(`${REMOTE_PATH}; ${tool.install.sh}`, 300000)
      log += (ins.out + ins.err).trim() + '\n'
      const re = await ssh(`${REMOTE_PATH}; command -v ${tool.cmd} >/dev/null 2>&1 && echo yes || echo no`, 30000)
      present = lastLine(re.out) === 'yes'
      log += present ? `✓ ${name} installed\n` : `⚠ ${name} still not found after install — check the log above\n`
    } else {
      log += `${name} not on remote and no auto-installer — install it on the server.\n`
    }
  } else if (tool?.cmd) {
    log += `✓ ${name} present on remote\n`
  }

  // 2) przeniesienie lokalnej sesji/tokenów (jeśli istnieje lokalny config) — bez ponownego /login.
  if (existsSync(local)) {
    say(`Transferring tokens to ${t.host}…`)
    const cp = await run(
      'scp',
      ['-r', '-P', String(t.port), ...idArgs, ...common, `${local}/.`, `${target}:${remote}/`],
      180000
    )
    log += cp.code === 0 ? '✓ tokens transferred\n' : 'token transfer failed:\n' + (cp.out + cp.err) + '\n'
  } else {
    say(`Ready — log in with /login on ${t.host}`)
    log += 'no local session to copy (you may need to /login on the remote)\n'
  }

  say('Done')
  return { ok: true, output: log.trim() }
}
