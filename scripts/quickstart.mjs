#!/usr/bin/env node
// [INPUT]: fresh checkout of this repository (dependencies may be missing)
// [OUTPUT]: local full-stack dev environment ready and running
// [POS]: one-command quickstart for the open-source edition; keeps the default
//        `pnpm dev` semantics and only automates the usual setup steps.
// [PREFLIGHT]: checks Node >=20, pnpm and a running Docker daemon before touching
//              anything, and on Linux warns when native build tools are missing.
// [PROTOCOL]: change this header when editing, then check AGENTS.md
//
// 用法:
//   pnpm quickstart            # 缺依赖自动安装 + 生成开发环境变量 + 启动基础设施 + 全栈 dev
//   pnpm quickstart --no-dev   # 只准备环境（安装/环境变量/基础设施），不启动 dev

import { spawnSync } from 'node:child_process'
import { existsSync, copyFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const startDev = !args.includes('--no-dev')

const fail = (message) => {
  console.error(`[quickstart] ${message}`)
  process.exit(1)
}

const run = (command, runArgs, options = {}) => {
  const result = spawnSync(command, runArgs, {
    stdio: options.stdio ?? 'inherit',
    cwd: options.cwd ?? repoRoot,
    env: process.env,
  })
  if (result.status !== 0) {
    fail(`${command} ${runArgs.join(' ')} failed with status ${result.status}`)
  }
  return result.status
}

// ---- 0. 前置检查（尽早给出可操作的提示，而不是泛化的 status 错误）----
const has = (command, checkArgs = ['--version']) =>
  spawnSync(command, checkArgs, { stdio: 'ignore', shell: process.platform === 'win32' }).status === 0

const nodeMajor = Number(process.versions.node.split('.')[0])
if (nodeMajor < 20) {
  fail(`Node.js >= 20 is required (found ${process.versions.node}). Install Node 22 LTS: https://nodejs.org/`)
}
if (!has('pnpm')) {
  fail('pnpm not found. Run `corepack enable` (ships with Node) or see https://pnpm.io/installation')
}
if (!has('docker')) {
  fail('docker not found. Install Docker Desktop (macOS/Windows) or Docker Engine (Linux): https://docs.docker.com/get-docker/')
}
if (!has('docker', ['info'])) {
  fail('Docker is installed but the daemon is not reachable. Start Docker Desktop / `sudo systemctl start docker`, then retry.')
}
if (!has('docker', ['compose', 'version'])) {
  fail('`docker compose` (v2) not available. Update Docker or install the compose plugin.')
}
if (process.platform === 'linux') {
  const missing = ['make', 'g++', 'python3'].filter((tool) => !has(tool))
  if (missing.length > 0) {
    console.warn(
      `[quickstart] warning: missing ${missing.join(', ')}. node-pty has no Linux prebuilds and compiles on install;\n` +
        '  install build tools first, e.g. `sudo apt-get install -y build-essential python3` (Debian/Ubuntu).',
    )
  }
}

// ---- 1. 依赖检查（复用 dev-ensure-deps 的 hash 判断，缺依赖或 lockfile 变化才安装）----
const ensureDepsScript = path.join(repoRoot, 'scripts/dev-ensure-deps.mjs')
if (existsSync(ensureDepsScript)) {
  run(process.execPath, [ensureDepsScript, repoRoot])
} else if (!existsSync(path.join(repoRoot, 'node_modules'))) {
  console.log('[quickstart] installing dependencies...')
  run('pnpm', ['install'])
}

// ---- 2. 开发环境变量（首次自动从 example 生成）----
const envLocal = path.join(repoRoot, '.env.development.local')
const envExample = path.join(repoRoot, '.env.development.local.example')
if (!existsSync(envLocal) && existsSync(envExample)) {
  copyFileSync(envExample, envLocal)
  console.log('[quickstart] created .env.development.local from example.')
} else {
  console.log('[quickstart] .env.development.local present (or no example), skipping.')
}

// ---- 3. 基础设施（幂等）----
if (!existsSync(path.join(repoRoot, 'deploy/docker/docker-compose.infra.yml'))) {
  fail('docker compose file not found. This script must run from the repository root.')
}
console.log('[quickstart] starting infra (postgres + object storage)...')
run('pnpm', ['dev:infra:up'])
console.log('[quickstart] infra up.')

if (!startDev) {
  console.log('[quickstart] preparation done (--no-dev). Next: `pnpm dev`.')
  process.exit(0)
}

// ---- 4. 启动全栈 dev ----
console.log('[quickstart] starting full dev stack (server + web + worker)...')
console.log('  press Ctrl+C to stop')
run('pnpm', ['dev'])
