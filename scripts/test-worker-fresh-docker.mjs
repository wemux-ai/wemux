import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

const rootDir = process.cwd()
const args = process.argv.slice(2)

const readArg = (name, fallback = '') => {
  const index = args.indexOf(name)
  if (index === -1) {
    return fallback
  }

  return args[index + 1] || fallback
}

const hasFlag = (name) => args.includes(name)

const image = readArg('--image', 'node:22-bookworm-slim')
const channel = readArg('--channel', 'production')
const outputRoot = path.resolve(readArg('--output-dir', path.join(rootDir, '.artifacts', 'worker-fresh-docker')))
const skipBuild = hasFlag('--skip-build')

const packageName = channel === 'preview' ? 'wemux-worker-preview' : 'wemux-worker'
const packageOutputDir = path.join(rootDir, '.artifacts', 'worker-npm-fresh-docker')
const packageRoot = path.join(packageOutputDir, packageName)

const sanitizePathPart = (value) => value.replace(/[^a-zA-Z0-9._-]+/g, '-')

const run = (command, commandArgs, options = {}) => {
  const result = spawnSync(command, commandArgs, {
    cwd: options.cwd ?? rootDir,
    encoding: 'utf8',
    stdio: options.stdio ?? 'pipe',
    env: options.env ?? process.env,
  })

  if (result.status !== 0) {
    const detail = [result.stdout, result.stderr, result.error?.message].filter(Boolean).join('\n').trim()
    throw new Error(detail || `${command} ${commandArgs.join(' ')} failed`)
  }

  return result
}

const assertDockerAvailable = () => {
  run('docker', ['version', '--format', '{{.Server.Version}}'], { stdio: 'pipe' })
}

const buildWorkerPackage = () => {
  if (skipBuild) {
    if (!existsSync(packageRoot)) {
      throw new Error(`Expected packaged worker at ${packageRoot} when --skip-build is used.`)
    }
    return
  }

  run('node', ['scripts/build-worker-runtime.mjs', '--release'], { stdio: 'inherit' })
  run('node', ['scripts/package-worker-npm.mjs', '--channel', channel, '--output-dir', packageOutputDir], { stdio: 'inherit' })
}

const packWorkerTarball = () => {
  const packed = run('npm', ['pack'], {
    cwd: packageRoot,
    stdio: 'pipe',
  })
  const filename = packed.stdout.trim().split('\n').filter(Boolean).at(-1)
  if (!filename) {
    throw new Error('npm pack did not return a package filename.')
  }

  return path.join(packageRoot, filename)
}

const ensureDir = (targetPath) => {
  mkdirSync(targetPath, { recursive: true })
}

const main = async () => {
  assertDockerAvailable()
  buildWorkerPackage()
  const tarballPath = packWorkerTarball()
  const reportDir = path.join(outputRoot, `${sanitizePathPart(image)}-${Date.now()}`)
  const bootstrapOutputPath = path.join(reportDir, 'bootstrap.json')
  const doctorOutputPath = path.join(reportDir, 'doctor.json')
  const gitVersionPath = path.join(reportDir, 'git-version.txt')
  ensureDir(reportDir)
  const packageSpec = JSON.stringify(`/work/${path.basename(tarballPath)}`)
  const workerBinary = JSON.stringify(packageName)

  const containerCommand = [
    'set -euo pipefail',
    'export WEMUX_WORKER_HOME=/tmp/wemux-worker-home',
    `npx -y --package ${packageSpec} ${workerBinary} bootstrap --target base --json > /out/bootstrap.json`,
    `npx -y --package ${packageSpec} ${workerBinary} doctor > /out/doctor.json`,
    'git --version > /out/git-version.txt',
  ].join('\n')

  run('docker', [
    'run',
    '--rm',
    '-v', `${packageRoot}:/work`,
    '-v', `${reportDir}:/out`,
    image,
    'bash',
    '-lc',
    containerCommand,
  ], {
    stdio: 'inherit',
  })

  const bootstrapReport = JSON.parse(readFileSync(bootstrapOutputPath, 'utf8'))
  const doctorReport = JSON.parse(readFileSync(doctorOutputPath, 'utf8'))
  const gitVersion = readFileSync(gitVersionPath, 'utf8').trim()
  const opencodeRuntimeCheck = Array.isArray(doctorReport?.items)
    ? doctorReport.items.find((item) => item?.id === 'opencode')
    : null

  if (!bootstrapReport.ok) {
    throw new Error(`Bootstrap report failed: ${bootstrapReport.message || 'unknown error'}`)
  }

  if (doctorReport?.checks?.git !== true) {
    throw new Error('Doctor report did not confirm Git availability after bootstrap.')
  }

  if (doctorReport?.checks?.opencodeAvailable !== true || !opencodeRuntimeCheck?.ok) {
    throw new Error('Doctor report did not confirm an executable OpenCode runtime after bootstrap.')
  }

  const summary = {
    image,
    channel,
    gitVersion,
    opencodeRuntimeDetail: opencodeRuntimeCheck?.detail ?? '',
    bootstrapMessage: bootstrapReport.message,
    reportDir,
  }

  writeFileSync(path.join(reportDir, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`, 'utf8')
  console.log(JSON.stringify(summary, null, 2))
}

main().catch((error) => {
  console.error(`[worker:fresh-docker] ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
})
