import './lib/env-bridge.mjs'
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import path from 'node:path'

const rootDir = process.cwd()
const args = process.argv.slice(2)

const readArg = (name, fallback = '') => {
  const index = args.indexOf(name)
  return index === -1 ? fallback : args[index + 1] || fallback
}

const channel = readArg('--channel', 'preview')
const rootPackageJson = JSON.parse(readFileSync(path.join(rootDir, 'package.json'), 'utf8'))
const rootVersion = rootPackageJson.version?.trim() || '0.0.0'
const explicitPackageVersion = readArg('--package-version', '')
const commitSha = (
  process.env.RAILWAY_GIT_COMMIT_SHA
  || process.env.GITHUB_SHA
  || process.env.VERCEL_GIT_COMMIT_SHA
  || ''
).trim()
const shortSha = commitSha.slice(0, 8)
const packageVersion = explicitPackageVersion || (
  channel === 'preview' && shortSha
    ? `${rootVersion}-preview.${shortSha}`
    : rootVersion
)
const disableNpmUpdateCheck = readArg(
  '--disable-update-check',
  explicitPackageVersion || shortSha ? '0' : '1',
)
const packageName = channel === 'preview' ? 'wemux-worker-preview' : 'wemux-worker'
const tempOutputDir = path.join(rootDir, '.artifacts', `worker-${channel}-installer-build`)
const packageRoot = path.join(tempOutputDir, packageName)
const installerOutputDir = path.resolve(
  readArg('--output-dir', process.env.VIBEMUX_WORKER_INSTALLER_OUTDIR?.trim() || path.join(rootDir, 'dist-server', 'worker-installer')),
)

const runCommand = (command, commandArgs, cwd = rootDir, env = process.env) => {
  const result = spawnSync(command, commandArgs, {
    cwd,
    stdio: 'inherit',
    env,
  })
  if (result.status !== 0) {
    process.exit(result.status ?? 1)
  }
}

rmSync(installerOutputDir, { recursive: true, force: true })
mkdirSync(installerOutputDir, { recursive: true })

runCommand('node', ['scripts/build-worker-runtime.mjs', '--release'])
runCommand('node', ['scripts/build-worker-console.mjs', '--release'])
runCommand('node', [
  'scripts/package-worker-npm.mjs',
  '--channel', channel,
  '--package-version', packageVersion,
  '--disable-update-check', disableNpmUpdateCheck,
  '--output-dir', tempOutputDir,
])

// The installer must not need npm on the target machine. Resolve production
// dependencies while building, then ship the complete package tree.
// 复用仓库锁文件，保证随包发布的生产依赖与仓库实际构建/测试版本一致。
cpSync(path.join(rootDir, 'pnpm-lock.yaml'), path.join(packageRoot, 'pnpm-lock.yaml'))
runCommand('pnpm', ['install', '--prod', '--no-frozen-lockfile', '--node-linker=hoisted'], packageRoot, process.env)

// 剔除 opencode 全平台二进制变体，保持 worker 安装包体积可控。
// 单一 tarball 服务所有平台，而 CI 构建机只会装上自己平台的变体——其余平台下载者白背 ~300MB 死重；
// 运行时解析优先系统 PATH，runtime-bootstrap 的 autoInstall 策略可按目标机现场拉取正确二进制。
// 保留轻量 JS wrapper（opencode-ai）与 @opencode-ai/sdk。
const nodeModulesDir = path.join(packageRoot, 'node_modules')
const pruneOpencodePlatformBinaries = () => {
  if (!existsSync(nodeModulesDir)) return []
  const platformBinaryPattern = /^opencode-(darwin|linux|windows)-(x64|arm64)/
  const pruned = []
  for (const entry of readdirSync(nodeModulesDir)) {
    if (platformBinaryPattern.test(entry)) {
      rmSync(path.join(nodeModulesDir, entry), { recursive: true, force: true })
      pruned.push(entry)
    }
  }
  return pruned
}
const prunedBinaries = pruneOpencodePlatformBinaries()
if (prunedBinaries.length > 0) {
  process.stdout.write(`[worker-installer] 已剔除 opencode 平台二进制: ${prunedBinaries.join(', ')}\n`)
}

// 剔除生产无用的 sourcemap 与 SDK TS 源码目录（实测包内 4397 个 .map 共 47MB）。
// 生产 bundle 已 minify，.map 仅供调试；src/ 目录仅为开发用，exports 均指向 esm/lib。
const pruneProductionJunk = () => {
  let mapCount = 0
  let mapBytes = 0
  const removeMapFiles = (dir) => {
    for (const entry of readdirSync(dir)) {
      const fullPath = path.join(dir, entry)
      const stat = existsSync(fullPath) ? statSync(fullPath) : null
      if (stat?.isDirectory()) {
        removeMapFiles(fullPath)
      } else if (entry.endsWith('.map')) {
        mapCount += 1
        mapBytes += stat?.size || 0
        rmSync(fullPath, { force: true })
      }
    }
  }
  removeMapFiles(packageRoot)
  for (const srcDir of [
    path.join(nodeModulesDir, '@mistralai', 'mistralai', 'src'),
    path.join(nodeModulesDir, 'openai', 'src'),
    path.join(nodeModulesDir, '@google', 'genai', 'src'),
  ]) {
    if (existsSync(srcDir)) rmSync(srcDir, { recursive: true, force: true })
  }
  return { mapCount, mapBytes }
}
const junkStats = pruneProductionJunk()
if (junkStats.mapCount > 0) {
  process.stdout.write(`[worker-installer] 已剔除生产无用文件: ${junkStats.mapCount} 个 sourcemap（${(junkStats.mapBytes / 1048576).toFixed(1)}MB）+ TS 源码目录\n`)
}
const packedFileName = `${packageName}-${packageVersion}.tgz`
const archivePath = path.join(installerOutputDir, 'package.tgz')
const archive = spawnSync('tar', ['-czhf', archivePath, '-C', tempOutputDir, packageName], {
  encoding: 'utf8',
  env: process.env,
})
if (archive.status !== 0) {
  process.stderr.write(archive.stderr || '')
  process.exit(archive.status ?? 1)
}

writeFileSync(path.join(installerOutputDir, 'manifest.json'), `${JSON.stringify({
  packageName,
  packageVersion,
  binName: packageName,
  fileName: packedFileName,
  builtAt: new Date().toISOString(),
  commitSha: commitSha || undefined,
  disableNpmUpdateCheck: disableNpmUpdateCheck === '1' || disableNpmUpdateCheck === 'true',
}, null, 2)}\n`)
