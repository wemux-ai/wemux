import { chmodSync, cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const retryRmSync = (target, opts, retries = 8) => {
  for (let i = 0; i < retries; i++) {
    try {
      rmSync(target, opts)
      return
    } catch (err) {
      if (err?.code === 'EBUSY' && i < retries - 1) {
        const delay = 500 * (i + 1)
        console.warn(`[retryRmSync] EBUSY on ${target}, retrying in ${delay}ms (${i + 1}/${retries})...`)
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, delay)
        continue
      }
      throw err
    }
  }
}

const rootDir = process.cwd()
const args = process.argv.slice(2)

const readArg = (name, fallback = '') => {
  const index = args.indexOf(name)
  if (index === -1) {
    return fallback
  }

  return args[index + 1] || fallback
}

const channel = readArg('--channel', 'production')
const outputDir = path.resolve(readArg('--output-dir', path.join(rootDir, '.artifacts', 'worker-npm')))
const packageVersion = readArg('--package-version', '')
const disableNpmUpdateCheck = ['1', 'true', 'on'].includes(readArg('--disable-update-check', '').trim().toLowerCase())
// 可选覆盖：用于一次性迁移包（如旧 vibemux-* 包名承载新代码），默认跟随 channel
const packageName = readArg('--package-name', channel === 'preview' ? 'wemux-worker-preview' : 'wemux-worker')
const binName = packageName
const nodeWrapperBinName = `${binName}-node-wrapper`
const defaultCloudUrl = channel === 'preview' ? 'https://wemux.xyz' : 'https://wemux.ai'
const defaultLocalServerPort = channel === 'preview' ? 48123 : 48100
const rootPackageJson = JSON.parse(readFileSync(path.join(rootDir, 'package.json'), 'utf8'))
const finalVersion = packageVersion || rootPackageJson.version
const packageRoot = path.join(outputDir, packageName)

const workerPackageJson = {
  name: packageName,
  version: finalVersion,
  private: false,
  type: 'module',
  packageManager: rootPackageJson.packageManager,
  bin: {
    vbx: './bin/vbx.mjs',
    vibemux: './bin/vibemux.mjs',
    wemux: './bin/wemux.mjs',
    [binName]: './bin/cli.mjs',
    [nodeWrapperBinName]: './bin/node-wrapper.mjs',
  },
  files: ['bin', 'dist-worker', 'runtime'],
  engines: {
    node: '>=22',
  },
  dependencies: {
    '@mariozechner/pi-coding-agent': rootPackageJson.dependencies['@mariozechner/pi-coding-agent'],
    '@modelcontextprotocol/sdk': rootPackageJson.dependencies['@modelcontextprotocol/sdk'],
    '@opencode-ai/sdk': rootPackageJson.dependencies['@opencode-ai/sdk'],
    'opencode-ai': rootPackageJson.dependencies['opencode-ai'],
    dotenv: rootPackageJson.devDependencies.dotenv,
    'simple-git': rootPackageJson.dependencies['simple-git'],
    ws: rootPackageJson.dependencies.ws,
  },
}

try {
  retryRmSync(outputDir, { recursive: true, force: true })
} catch (err) {
  if (err?.code === 'EBUSY') {
    console.warn(`[package-worker-npm] Could not clean ${outputDir} (EBUSY), proceeding with overwrite`)
  } else {
    throw err
  }
}
mkdirSync(path.join(packageRoot, 'bin'), { recursive: true })
mkdirSync(path.join(packageRoot, 'runtime'), { recursive: true })

writeFileSync(path.join(packageRoot, 'package.json'), `${JSON.stringify(workerPackageJson, null, 2)}\n`)
writeFileSync(
  path.join(packageRoot, 'runtime', 'worker-release.json'),
  `${JSON.stringify({
    channel,
    defaultCloudUrl,
    defaultLocalServerPort,
    disableNpmUpdateCheck,
  }, null, 2)}\n`,
)

const buildCliLauncher = (cliName, { selfRepair = false } = {}) => {
  const entryImport = "await import(pathToFileURL(path.join(appRoot, 'dist-worker', 'apps', 'worker', 'src', 'index.js')).href)"
  const lines = [
    '#!/usr/bin/env node',
    "import path from 'node:path'",
    "import { fileURLToPath, pathToFileURL } from 'node:url'",
    '',
    'const scriptDir = path.dirname(fileURLToPath(import.meta.url))',
    "const appRoot = path.resolve(scriptDir, '..')",
    `process.env.WEMUX_CLI_NAME = ${JSON.stringify(cliName)}`,
    'process.env.WEMUX_RUNTIME_ROOT = appRoot',
  ]
  if (!selfRepair) {
    lines.push('', entryImport)
    return lines.join('\n') + '\n'
  }
  // 服务入口（bin/cli.mjs）：加载失败时走 bin/self-repair.mjs 自修复（见 2026-08-23 故障复盘）。
  // 依赖损坏导致的 ERR_MODULE_NOT_FOUND 会在此被拦截：写崩溃标记 + 从控制面重拉完整包替换；
  // 其它错误原样抛出，不掩盖真实 bug。
  lines.push(
    "import { handleEntryLoadFailure } from './self-repair.mjs'",
    '',
    'try {',
    `  ${entryImport}`,
    '} catch (error) {',
    `  await handleEntryLoadFailure({ error, appRoot, cliName: ${JSON.stringify(cliName)} })`,
    '  throw error',
    '}',
  )
  return lines.join('\n') + '\n'
}

writeFileSync(
  path.join(packageRoot, 'bin', 'cli.mjs'),
  buildCliLauncher(binName, { selfRepair: true }),
)
writeFileSync(
  path.join(packageRoot, 'bin', 'vbx.mjs'),
  buildCliLauncher('vbx'),
)
writeFileSync(
  path.join(packageRoot, 'bin', 'vibemux.mjs'),
  buildCliLauncher('vibemux'),
)
writeFileSync(
  path.join(packageRoot, 'bin', 'wemux.mjs'),
  buildCliLauncher('wemux'),
)

writeFileSync(
  path.join(packageRoot, 'bin', 'node-wrapper.mjs'),
  [
    '#!/usr/bin/env node',
    "import fs from 'node:fs'",
    "import path from 'node:path'",
    "import { fileURLToPath, pathToFileURL } from 'node:url'",
    '',
    `const binName = ${JSON.stringify(binName)}`,
    'const scriptDir = path.dirname(fileURLToPath(import.meta.url))',
    "const appRoot = path.resolve(scriptDir, '..')",
    'function resolveInstallPrefix() {',
    "  const packageDir = appRoot",
    "  const nodeModulesDir = path.dirname(packageDir)",
    "  const libDir = path.dirname(nodeModulesDir)",
    "  if (path.basename(nodeModulesDir).toLowerCase() !== 'node_modules') return path.resolve(appRoot, '..')",
    "  if (path.basename(libDir).toLowerCase() === 'lib') return path.dirname(libDir)",
    '  return path.dirname(nodeModulesDir)',
    '}',
    'const installPrefix = resolveInstallPrefix()',
    'function resolveWorkerBin() {',
    "  if (process.platform === 'win32') {",
    '    const candidates = [',
    "      path.join(installPrefix, `${binName}.cmd`),",
    "      path.join(installPrefix, 'bin', `${binName}.cmd`),",
    '    ]',
    '    for (const c of candidates) { if (fs.existsSync(c)) return c }',
    '    return candidates[0]',
    '  }',
    "  return path.join(installPrefix, 'bin', binName)",
    '}',
    'const workerBin = resolveWorkerBin()',
    "process.env.WEMUX_RUNTIME_ROOT = appRoot",
    "process.env.WEMUX_WORKER_INSTALL_PREFIX = process.env.WEMUX_WORKER_INSTALL_PREFIX || installPrefix",
    'process.env.WEMUX_WORKER_EXECUTABLE_PATH = workerBin',
    "await import(pathToFileURL(path.join(appRoot, 'dist-worker', 'apps', 'worker', 'src', 'index.js')).href)",
  ].join('\n') + '\n',
)
// bin/ 目录在仓库内的唯一来源是本脚本与 worker-bin-self-repair.mjs；
// self-repair 必须随包分发，cli.mjs 的加载失败钩子才能工作。
cpSync(
  path.join(rootDir, 'scripts', 'worker-bin-self-repair.mjs'),
  path.join(packageRoot, 'bin', 'self-repair.mjs'),
)

// 自包含包会被安装器 tar 直出并原样落盘，bin 入口必须带可执行位：
// 安装器的 -x 校验和 mac/linux 直接 spawn 都依赖它（npm 安装会自动加位，tar 直出不会）。
for (const binFile of ['cli.mjs', 'vbx.mjs', 'vibemux.mjs', 'wemux.mjs', 'node-wrapper.mjs', 'self-repair.mjs']) {
  chmodSync(path.join(packageRoot, 'bin', binFile), 0o755)
}

cpSync(path.join(rootDir, 'dist-worker'), path.join(packageRoot, 'dist-worker'), { recursive: true })
