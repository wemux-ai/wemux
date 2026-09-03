import { existsSync, mkdirSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import process from 'node:process'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const sourceDir = path.join(repoRoot, 'apps/meeting-runtime/native')
const buildDir = path.join(sourceDir, 'build')
mkdirSync(buildDir, { recursive: true })
const cmakeConfigureArgs = ['-S', sourceDir, '-B', buildDir, '-DCMAKE_BUILD_TYPE=Release']
if (process.platform === 'darwin') cmakeConfigureArgs.push('-DCMAKE_OSX_ARCHITECTURES=arm64;x86_64')

const run = (args) => {
  const result = spawnSync('cmake', args, { cwd: repoRoot, stdio: 'inherit' })
  if (result.error) throw result.error
  if (result.status !== 0) process.exit(result.status ?? 1)
}

run(cmakeConfigureArgs)
run(['--build', buildDir, '--config', 'Release', '--parallel'])
