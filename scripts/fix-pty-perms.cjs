// Po instalacji nadaje bit wykonywalności helperowi node-pty (macOS/Linux).
// Bez tego prebuild bywa instalowany jako 0644 i spawn kończy się błędem
// "posix_spawnp failed". Na Windowsie helper nie istnieje — błędy ignorujemy.
const fs = require('fs')
const path = require('path')

const base = path.join(__dirname, '..', 'node_modules', 'node-pty')
const targets = []

const prebuilds = path.join(base, 'prebuilds')
try {
  for (const dir of fs.readdirSync(prebuilds)) {
    targets.push(path.join(prebuilds, dir, 'spawn-helper'))
  }
} catch {
  /* brak katalogu prebuilds */
}
targets.push(path.join(base, 'build', 'Release', 'spawn-helper'))

for (const file of targets) {
  try {
    if (fs.existsSync(file)) {
      fs.chmodSync(file, 0o755)
      console.log('fix-pty-perms: chmod +x', path.relative(process.cwd(), file))
    }
  } catch {
    /* ignorujemy */
  }
}
