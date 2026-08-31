import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import os from 'node:os'
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
const outputRoot = path.resolve(readArg('--output-dir', path.join(rootDir, '.artifacts', 'worker-live-llm-docker')))
const skipBuild = hasFlag('--skip-build')
const packageOutputDir = path.join(rootDir, '.artifacts', 'worker-npm-live-docker')
const packageName = 'wemux-worker'
const packageRoot = path.join(packageOutputDir, packageName)
const homeDir = os.homedir()

const codexConfigPath = path.join(homeDir, '.codex', 'config.toml')
const codexAuthPath = path.join(homeDir, '.codex', 'auth.json')
const claudeSettingsJsonPath = path.join(homeDir, '.claude', 'settings.json')

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

const ensureDir = (targetPath) => {
  mkdirSync(targetPath, { recursive: true })
}

const sanitizePathPart = (value) => value.replace(/[^a-zA-Z0-9._-]+/g, '-')

const assertDockerAvailable = () => {
  run('docker', ['version', '--format', '{{.Server.Version}}'])
}

const requireFile = (targetPath, label) => {
  if (!existsSync(targetPath)) {
    throw new Error(`Missing ${label}: ${targetPath}`)
  }
}

const buildWorkerPackage = () => {
  if (skipBuild) {
    if (!existsSync(packageRoot)) {
      throw new Error(`Expected packaged worker at ${packageRoot} when --skip-build is used.`)
    }
    return
  }

  run('node', ['scripts/build-worker-runtime.mjs', '--release'], { stdio: 'inherit' })
  run('node', ['scripts/package-worker-npm.mjs', '--channel', 'production', '--output-dir', packageOutputDir], { stdio: 'inherit' })
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

const writeWorkerConfigFixture = (targetPath) => {
  const source = {
    cloudUrl: 'http://127.0.0.1:8989',
    machineId: 'docker-live-test',
    machineName: 'Docker Live Test',
    agentSettings: {
      OpenCode: {
        defaultModel: '',
        agent: '',
        permissionPolicy: '',
      },
      Codex: {
        defaultModel: 'gpt-5.4',
        sandbox: 'workspace-write',
        approval: 'never',
        reasoningEffort: 'medium',
        reasoningSummary: 'auto',
      },
      ClaudeCode: {
        defaultModel: 'sonnet',
        permissionMode: 'bypassPermissions',
        planMode: false,
      },
      Pi: {
        defaultModel: '',
        agentDir: '',
      },
    },
    workspaceRoot: '/tmp/wemux-workspace',
    maxConcurrency: 1,
    labels: [],
    capabilities: ['code-execution'],
    localServerPort: 48100,
    mcpServers: [],
    opencodeConfigContent: '',
    codexConfigContent: readFileSync(codexConfigPath, 'utf8'),
    codexAuthContent: readFileSync(codexAuthPath, 'utf8'),
    claudeCodeConfigContent: readFileSync(claudeSettingsJsonPath, 'utf8'),
    piAgentDir: '/tmp/wemux-pi-agent',
    defaultModel: '',
    projectBindings: [],
  }

  writeFileSync(targetPath, `${JSON.stringify(source, null, 2)}\n`, 'utf8')
}

const main = async () => {
  assertDockerAvailable()
  requireFile(codexConfigPath, 'Codex config')
  requireFile(codexAuthPath, 'Codex auth')
  requireFile(claudeSettingsJsonPath, 'Claude settings')

  buildWorkerPackage()
  const tarballPath = packWorkerTarball()
  const reportDir = path.join(outputRoot, `${sanitizePathPart(image)}-${Date.now()}`)
  ensureDir(reportDir)

  const workerConfigFixturePath = path.join(reportDir, 'worker-config.json')
  writeWorkerConfigFixture(workerConfigFixturePath)

  const containerCommand = [
    'set -euo pipefail',
    'mkdir -p /tmp/package-test /root/.codex /root/.claude /tmp/wemux-live-llm-test /tmp/wemux-worker-home',
    'cp /fixtures/codex-config.toml /root/.codex/config.toml',
    'cp /fixtures/codex-auth.json /root/.codex/auth.json',
    'cp /fixtures/claude-settings.json /root/.claude/settings.json',
    'cp /fixtures/worker-config.json /tmp/wemux-worker-home/config.json',
    'cd /tmp/package-test',
    'npm init -y >/dev/null 2>&1',
    `npm install /work/${path.basename(tarballPath)} >/dev/null`,
    'export WEMUX_WORKER_HOME=/tmp/wemux-worker-home',
    './node_modules/.bin/wemux-worker bootstrap --target Codex --json | tee /out/bootstrap-codex.json',
    './node_modules/.bin/wemux-worker bootstrap --target ClaudeCode --json | tee /out/bootstrap-claude.json',
    './node_modules/.bin/wemux-worker runtime-smoke --agent Codex --cwd /tmp/wemux-live-llm-test --title "Docker Codex Live Test" --prompt "Reply with exactly: OK_CODEX_DOCKER_TEST" --json | tee /out/runtime-smoke-codex.json',
    './node_modules/.bin/wemux-worker runtime-smoke --agent ClaudeCode --cwd /tmp/wemux-live-llm-test --title "Docker Claude Live Test" --prompt "Reply with exactly: OK_CLAUDE_DOCKER_TEST" --json | tee /out/runtime-smoke-claude.json',
    "node -e \"const fs=require('fs'); const path=require('path'); const codex=JSON.parse(fs.readFileSync('/out/runtime-smoke-codex.json','utf8')); const claude=JSON.parse(fs.readFileSync('/out/runtime-smoke-claude.json','utf8')); const result={codex:{ok:true,output:codex.output,sessionId:codex.sessionId||''},claude:{ok:true,output:claude.output,sessionId:claude.sessionId||''}}; fs.writeFileSync(path.join('/out','results.json'), JSON.stringify(result,null,2)+'\\n'); console.log(JSON.stringify(result,null,2)); if (codex.output.trim() !== 'OK_CODEX_DOCKER_TEST' || claude.output.trim() !== 'OK_CLAUDE_DOCKER_TEST') process.exit(1)\"",
  ].join('\n')

  run('docker', [
    'run',
    '--rm',
    '-v', `${packageRoot}:/work`,
    '-v', `${reportDir}:/out`,
    '-v', `${codexConfigPath}:/fixtures/codex-config.toml:ro`,
    '-v', `${codexAuthPath}:/fixtures/codex-auth.json:ro`,
    '-v', `${claudeSettingsJsonPath}:/fixtures/claude-settings.json:ro`,
    '-v', `${workerConfigFixturePath}:/fixtures/worker-config.json:ro`,
    image,
    'bash',
    '-lc',
    containerCommand,
  ], {
    stdio: 'inherit',
  })

  const results = JSON.parse(readFileSync(path.join(reportDir, 'results.json'), 'utf8'))
  const summary = {
    image,
    reportDir,
    codex: results.codex?.ok ? results.codex.output : results.codex?.error,
    claude: results.claude?.ok ? results.claude.output : results.claude?.error,
  }
  writeFileSync(path.join(reportDir, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`, 'utf8')
  console.log(JSON.stringify(summary, null, 2))
}

main().catch((error) => {
  console.error(`[worker:live-llm-docker] ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
})
