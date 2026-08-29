import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const appDir = process.argv[2] || '/app'
process.chdir(appDir)

const markerPath = path.join('node_modules', '.vibemux-deps-hash')
const currentHash = createHash('sha256')

for (const file of ['package.json', 'pnpm-lock.yaml']) {
  currentHash.update(readFileSync(file))
}

const hash = currentHash.digest('hex')
const installedHash = existsSync(markerPath) ? readFileSync(markerPath, 'utf8') : ''
const needsInstall = !existsSync('node_modules')
  || hash !== installedHash
  || !existsSync(path.join('node_modules', 'i18next'))

if (!needsInstall) {
  console.log('[dev-ensure-deps] dependencies are up to date, skipping install.')
  process.exit(0)
}

console.log('[dev-ensure-deps] dependencies missing or lockfile changed, running pnpm install...')
const result = spawnSync('pnpm', ['install', '--frozen-lockfile', '--prefer-offline'], {
  env: {
    ...process.env,
    CI: 'true',
  },
  stdio: 'inherit',
})

if (result.status !== 0) {
  process.exit(result.status ?? 1)
}

mkdirSync('node_modules', { recursive: true })
writeFileSync(markerPath, hash)
