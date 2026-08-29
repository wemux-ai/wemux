import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { normalizeAgentSettings } from '@shared/agent-config'
import { MANAGED_MODEL_RUNTIME_ENV } from '@shared/model-profile'
import type { ExecutorSkillPackage, WorkerConfig } from '@shared/types'
import { buildMcpShellCommand, buildWindowsRuntimeHomeEnv, prepareWorkerAgentRuntime } from './runtime-context'

const createTempDir = (prefix: string) => mkdtemp(path.join(os.tmpdir(), prefix))

const createWorkerConfig = (workspaceRoot: string): WorkerConfig => ({
  cloudUrl: 'http://127.0.0.1:8989',
  machineId: 'test-machine',
  machineName: 'Test Machine',
  agentSettings: normalizeAgentSettings(),
  workspaceRoot,
  maxConcurrency: 1,
  labels: [],
  capabilities: ['code-execution'],
  localServerPort: 48100,
  mcpServers: [],
  opencodeConfigContent: '',
  codexConfigContent: '',
  codexAuthContent: '',
  claudeCodeConfigContent: '',
  piAgentDir: path.join(workspaceRoot, '.pi-agent'),
  defaultModel: '',
  projectBindings: [],
})

test('buildMcpShellCommand uses cmd.exe on Windows workers', () => {
  const previousComSpec = process.env.ComSpec
  process.env.ComSpec = 'C:\\Windows\\System32\\cmd.exe'

  try {
    assert.deepEqual(buildMcpShellCommand('node server.js', 'win32'), {
      command: 'C:\\Windows\\System32\\cmd.exe',
      args: ['/d', '/s', '/c', 'node server.js'],
    })
  } finally {
    if (previousComSpec === undefined) {
      delete process.env.ComSpec
    } else {
      process.env.ComSpec = previousComSpec
    }
  }
})

test('buildMcpShellCommand keeps sh on non-Windows workers', () => {
  assert.deepEqual(buildMcpShellCommand('node server.js', 'linux'), {
    command: 'sh',
    args: ['-lc', 'node server.js'],
  })
})

test('buildWindowsRuntimeHomeEnv maps user-scoped runtime dirs on Windows', () => {
  const env = buildWindowsRuntimeHomeEnv('C:\\Users\\x\\.vibemux\\runtime', 'win32')
  assert.equal(env.USERPROFILE, 'C:\\Users\\x\\.vibemux\\runtime')
  assert.equal(env.APPDATA?.endsWith(path.join('AppData', 'Roaming')), true)
  assert.equal(env.LOCALAPPDATA?.endsWith(path.join('AppData', 'Local')), true)
  assert.deepEqual(buildWindowsRuntimeHomeEnv('/tmp/runtime', 'linux'), {})
})

test('prepareWorkerAgentRuntime materializes binary skill assets for Pi', async () => {
  const tempRoot = await createTempDir('vibemux-runtime-skill-')
  const previousCloudUrl = process.env.VIBEMUX_CLOUD_URL
  const previousNodeEnv = process.env.NODE_ENV
  const previousWorkerHome = process.env.VIBEMUX_WORKER_HOME

  try {
    const cwd = path.join(tempRoot, 'cwd')
    await mkdir(cwd, { recursive: true })
    process.env.NODE_ENV = 'development'
    process.env.VIBEMUX_CLOUD_URL = 'http://127.0.0.1:8989'
    process.env.VIBEMUX_WORKER_HOME = path.join(tempRoot, 'worker-home')

    const assetBuffer = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x01, 0x02, 0x03, 0x04])
    const runtimeSkillPackages: ExecutorSkillPackage[] = [{
      name: 'Asset Skill',
      slug: 'asset-skill',
      description: 'Contains an image asset.',
      markdown: '# Asset Skill\n',
      sourceLocator: 'vibemux://skills/asset-skill',
      trustLevel: 'assets',
      fileInventory: [
        { path: 'SKILL.md', kind: 'skill' },
        { path: 'assets/logo.png', kind: 'asset' },
      ],
      files: {
        'SKILL.md': {
          encoding: 'utf8',
          content: '# Asset Skill\n',
        },
        'assets/logo.png': {
          encoding: 'base64',
          content: assetBuffer.toString('base64'),
        },
      },
    }]

    const runtime = prepareWorkerAgentRuntime({
      agentType: 'Pi',
      cwd,
      runtimeSkillPackages,
      workerConfig: createWorkerConfig(path.join(tempRoot, 'workspace')),
    })

    try {
      assert.equal(runtime.promptPrefix, '')
      const skillRoot = runtime.runtimeEnv.WEMUX_PI_SKILL_PATHS
      assert.ok(skillRoot)
      assert.equal(skillRoot.includes(path.delimiter), false)

      const assetPath = path.join(skillRoot, 'asset-skill', 'assets', 'logo.png')
      assert.equal(existsSync(assetPath), true)
      assert.deepEqual(await readFile(assetPath), assetBuffer)
    } finally {
      runtime.cleanup()
    }
  } finally {
    if (previousCloudUrl === undefined) {
      delete process.env.VIBEMUX_CLOUD_URL
    } else {
      process.env.VIBEMUX_CLOUD_URL = previousCloudUrl
    }
    if (previousNodeEnv === undefined) {
      delete process.env.NODE_ENV
    } else {
      process.env.NODE_ENV = previousNodeEnv
    }
    if (previousWorkerHome === undefined) {
      delete process.env.VIBEMUX_WORKER_HOME
    } else {
      process.env.VIBEMUX_WORKER_HOME = previousWorkerHome
    }

    await rm(tempRoot, { recursive: true, force: true })
  }
})

test('prepareWorkerAgentRuntime materializes OpenCode skills into workspace .opencode/skills', async () => {
  const tempRoot = await createTempDir('vibemux-runtime-opencode-skill-')
  const previousWorkerHome = process.env.VIBEMUX_WORKER_HOME

  try {
    const cwd = path.join(tempRoot, 'cwd')
    await mkdir(cwd, { recursive: true })
    process.env.VIBEMUX_WORKER_HOME = path.join(tempRoot, 'worker-home')

    const runtimeSkillPackages: ExecutorSkillPackage[] = [{
      name: 'wemux YML',
      slug: 'vibemux-yml',
      description: 'Write or update the repo-root .vibemux.yml environment template.',
      markdown: '# wemux YML\n',
      sourceLocator: 'builtin://vibemux-yml',
      trustLevel: 'markdown_only',
      fileInventory: [
        { path: 'SKILL.md', kind: 'skill' },
        { path: 'references/schema.md', kind: 'reference' },
      ],
      files: {
        'SKILL.md': {
          encoding: 'utf8',
          content: '# wemux YML\n',
        },
        'references/schema.md': {
          encoding: 'utf8',
          content: 'schema',
        },
      },
    }]

    const runtime = prepareWorkerAgentRuntime({
      agentType: 'OpenCode',
      cwd,
      actingUserId: 'user-a',
      runtimeSkillPackages,
      workerConfig: createWorkerConfig(path.join(tempRoot, 'workspace')),
    })

    try {
      assert.equal(typeof runtime.runtimeEnv.VIBEMUX_WORKER_RUNNER, 'string')
      assert.equal(typeof runtime.runtimeEnv.VIBEMUX_WORKER_ENTRY, 'string')
      assert.ok(runtime.runtimeEnv.HOME)
      assert.match(runtime.runtimeEnv.HOME, /users\/user-a\/runtime\/opencode-home\//)
      assert.equal(runtime.runtimeEnv.XDG_DATA_HOME, path.join(runtime.runtimeEnv.HOME, '.local', 'share'))
      assert.equal(runtime.runtimeEnv.XDG_CONFIG_HOME, path.join(runtime.runtimeEnv.HOME, '.config'))
      const skillRoot = path.join(cwd, '.opencode', 'skills', 'vibemux-yml')
      assert.equal(existsSync(path.join(skillRoot, 'SKILL.md')), true)
      assert.equal(existsSync(path.join(skillRoot, 'references', 'schema.md')), true)
      assert.equal(await readFile(path.join(skillRoot, 'SKILL.md'), 'utf8'), '# wemux YML\n')
    } finally {
      runtime.cleanup()
    }
  } finally {
    if (previousWorkerHome === undefined) {
      delete process.env.VIBEMUX_WORKER_HOME
    } else {
      process.env.VIBEMUX_WORKER_HOME = previousWorkerHome
    }

    await rm(tempRoot, { recursive: true, force: true })
  }
})

test('prepareWorkerAgentRuntime separates stable OpenCode homes by acting user', async () => {
  const tempRoot = await createTempDir('vibemux-runtime-opencode-user-scope-')
  const previousWorkerHome = process.env.VIBEMUX_WORKER_HOME

  try {
    const cwd = path.join(tempRoot, 'cwd')
    await mkdir(cwd, { recursive: true })
    process.env.VIBEMUX_WORKER_HOME = path.join(tempRoot, 'worker-home')
    const workerConfig = createWorkerConfig(path.join(tempRoot, 'workspace'))

    const userARuntime = prepareWorkerAgentRuntime({
      agentType: 'OpenCode',
      cwd,
      actingUserId: 'user-a',
      workerConfig,
    })
    const userBRuntime = prepareWorkerAgentRuntime({
      agentType: 'OpenCode',
      cwd,
      actingUserId: 'user-b',
      workerConfig,
    })

    try {
      assert.notEqual(userARuntime.runtimeEnv.HOME, userBRuntime.runtimeEnv.HOME)
    } finally {
      userARuntime.cleanup()
      userBRuntime.cleanup()
    }
  } finally {
    if (previousWorkerHome === undefined) {
      delete process.env.VIBEMUX_WORKER_HOME
    } else {
      process.env.VIBEMUX_WORKER_HOME = previousWorkerHome
    }

    await rm(tempRoot, { recursive: true, force: true })
  }
})

test('prepareWorkerAgentRuntime does not inject Desktop Sandbox hints for preview workers', async () => {
  const tempRoot = await createTempDir('vibemux-runtime-sandbox-preview-')
  const previousCloudUrl = process.env.VIBEMUX_CLOUD_URL
  const previousNodeEnv = process.env.NODE_ENV
  const previousWorkerHome = process.env.VIBEMUX_WORKER_HOME

  try {
    const cwd = path.join(tempRoot, 'cwd')
    await mkdir(cwd, { recursive: true })
    process.env.NODE_ENV = 'development'
    process.env.VIBEMUX_CLOUD_URL = 'https://wemux.xyz/'
    process.env.VIBEMUX_WORKER_HOME = path.join(tempRoot, 'worker-home')

    const runtime = prepareWorkerAgentRuntime({
      agentType: 'Pi',
      cwd,
      workerConfig: createWorkerConfig(path.join(tempRoot, 'workspace')),
    })

    try {
      assert.equal(runtime.promptPrefix, '')
    } finally {
      runtime.cleanup()
    }
  } finally {
    if (previousCloudUrl === undefined) {
      delete process.env.VIBEMUX_CLOUD_URL
    } else {
      process.env.VIBEMUX_CLOUD_URL = previousCloudUrl
    }
    if (previousNodeEnv === undefined) {
      delete process.env.NODE_ENV
    } else {
      process.env.NODE_ENV = previousNodeEnv
    }
    if (previousWorkerHome === undefined) {
      delete process.env.VIBEMUX_WORKER_HOME
    } else {
      process.env.VIBEMUX_WORKER_HOME = previousWorkerHome
    }

    await rm(tempRoot, { recursive: true, force: true })
  }
})

test('prepareWorkerAgentRuntime writes managed Codex config and exports managed credential env into isolated CODEX_HOME', async () => {
  const tempRoot = await createTempDir('vibemux-runtime-codex-')
  const previousWorkerHome = process.env.VIBEMUX_WORKER_HOME

  try {
    const cwd = path.join(tempRoot, 'cwd')
    await mkdir(cwd, { recursive: true })
    process.env.VIBEMUX_WORKER_HOME = path.join(tempRoot, 'worker-home')

    const runtime = prepareWorkerAgentRuntime({
      agentType: 'Codex',
      cwd,
      actingUserId: 'user-a',
      workerConfig: {
        ...createWorkerConfig(path.join(tempRoot, 'workspace')),
        executorToken: 'executor-token-1',
        codexConfigContent: [
          'model = "gpt-5.4"',
          'model_provider = "codexzh"',
          '',
          '[model_providers.codexzh]',
          'base_url = "https://api.codexzh.example/v1"',
        ].join('\n'),
        codexAuthContent: '{\n  "OPENAI_API_KEY": "codex-test-token"\n}\n',
      },
    })

    try {
      const codexHome = runtime.runtimeEnv.CODEX_HOME
      assert.ok(codexHome)
      const configContent = await readFile(path.join(codexHome, 'config.toml'), 'utf8')

      assert.match(configContent, /model = "gpt-5\.4"/)
      assert.match(configContent, /model_provider = "codexzh"/)
      assert.match(configContent, /\[projects\.".*cwd"\]/)
      assert.match(configContent, /trust_level = "trusted"/)
      assert.match(configContent, /name = "codexzh"/)
      assert.match(configContent, /env_key = "OPENAI_API_KEY"/)
      assert.equal(runtime.runtimeEnv.OPENAI_API_KEY, 'codex-test-token')
      assert.equal(existsSync(path.join(codexHome, 'auth.json')), false)
    } finally {
      runtime.cleanup()
    }
  } finally {
    if (previousWorkerHome === undefined) {
      delete process.env.VIBEMUX_WORKER_HOME
    } else {
      process.env.VIBEMUX_WORKER_HOME = previousWorkerHome
    }

    await rm(tempRoot, { recursive: true, force: true })
  }
})

test('prepareWorkerAgentRuntime materializes ChatGPT OAuth AuthDotJson into CODEX_HOME', async () => {
  const tempRoot = await createTempDir('vibemux-runtime-codex-oauth-')
  const previousWorkerHome = process.env.VIBEMUX_WORKER_HOME

  try {
    const cwd = path.join(tempRoot, 'cwd')
    await mkdir(cwd, { recursive: true })
    process.env.VIBEMUX_WORKER_HOME = path.join(tempRoot, 'worker-home')
    const authContent = JSON.stringify({
      auth_mode: 'chatgpt',
      OPENAI_API_KEY: null,
      tokens: {
        id_token: 'id-token',
        access_token: 'access-token',
        refresh_token: 'refresh-token',
        account_id: 'account-id',
      },
      last_refresh: '2026-08-13T00:00:00.000Z',
    })

    const runtime = prepareWorkerAgentRuntime({
      agentType: 'Codex',
      cwd,
      actingUserId: 'user-a',
      workerConfig: {
        ...createWorkerConfig(path.join(tempRoot, 'workspace')),
        codexConfigContent: 'model = "gpt-5.6-terra"\n',
        codexAuthContent: authContent,
      },
    })

    try {
      const codexHome = runtime.runtimeEnv.CODEX_HOME
      assert.ok(codexHome)
      assert.equal(await readFile(path.join(codexHome, 'auth.json'), 'utf8'), `${authContent}\n`)
      assert.equal(runtime.runtimeEnv.auth_mode, undefined)
      assert.equal(runtime.runtimeEnv.last_refresh, undefined)
    } finally {
      runtime.cleanup()
    }
  } finally {
    if (previousWorkerHome === undefined) {
      delete process.env.VIBEMUX_WORKER_HOME
    } else {
      process.env.VIBEMUX_WORKER_HOME = previousWorkerHome
    }

    await rm(tempRoot, { recursive: true, force: true })
  }
})

test('prepareWorkerAgentRuntime isolates managed Codex model bindings from node-local config and credentials', async () => {
  const tempRoot = await createTempDir('vibemux-runtime-codex-profile-')
  const previousWorkerHome = process.env.VIBEMUX_WORKER_HOME

  try {
    const cwd = path.join(tempRoot, 'cwd')
    await mkdir(cwd, { recursive: true })
    process.env.VIBEMUX_WORKER_HOME = path.join(tempRoot, 'worker-home')

    const runtime = prepareWorkerAgentRuntime({
      agentType: 'Codex',
      cwd,
      actingUserId: 'user-a',
      runtimeEnv: {
        [MANAGED_MODEL_RUNTIME_ENV.enabled]: '1',
        [MANAGED_MODEL_RUNTIME_ENV.bindingId]: 'binding-blackai',
        [MANAGED_MODEL_RUNTIME_ENV.providerId]: 'blacakai',
        [MANAGED_MODEL_RUNTIME_ENV.modelId]: 'gpt-5.6-terra',
        [MANAGED_MODEL_RUNTIME_ENV.baseUrl]: 'https://api.blackai.example/v1',
        [MANAGED_MODEL_RUNTIME_ENV.apiKey]: 'profile-api-key',
      },
      workerConfig: {
        ...createWorkerConfig(path.join(tempRoot, 'workspace')),
        codexConfigContent: [
          'model = "node-local-model"',
          'model_provider = "node-local-provider"',
          '',
          '[model_providers.node-local-provider]',
          'base_url = "https://node-local.example/v1"',
          'env_key = "OPENAI_API_KEY"',
        ].join('\n'),
        codexAuthContent: '{\n  "OPENAI_API_KEY": "node-local-key"\n}\n',
      },
    })

    try {
      const codexHome = runtime.runtimeEnv.CODEX_HOME
      assert.ok(codexHome)
      const configContent = await readFile(path.join(codexHome, 'config.toml'), 'utf8')

      assert.match(configContent, /model = "gpt-5\.6-terra"/)
      assert.match(configContent, /model_provider = "blacakai"/)
      assert.match(configContent, /base_url = "https:\/\/api\.blackai\.example\/v1"/)
      assert.match(configContent, /env_key = "VIBEMUX_MANAGED_MODEL_API_KEY"/)
      assert.doesNotMatch(configContent, /node-local/)
      assert.equal(runtime.runtimeEnv.VIBEMUX_MANAGED_MODEL_API_KEY, 'profile-api-key')
      assert.equal(runtime.runtimeEnv.OPENAI_API_KEY, undefined)
      assert.equal(existsSync(path.join(codexHome, 'auth.json')), false)
    } finally {
      runtime.cleanup()
    }
  } finally {
    if (previousWorkerHome === undefined) {
      delete process.env.VIBEMUX_WORKER_HOME
    } else {
      process.env.VIBEMUX_WORKER_HOME = previousWorkerHome
    }

    await rm(tempRoot, { recursive: true, force: true })
  }
})

test('prepareWorkerAgentRuntime writes portable Codex MCP table names', async () => {
  const tempRoot = await createTempDir('vibemux-runtime-codex-mcp-')
  const previousWorkerHome = process.env.VIBEMUX_WORKER_HOME

  try {
    const cwd = path.join(tempRoot, 'cwd')
    await mkdir(cwd, { recursive: true })
    process.env.VIBEMUX_WORKER_HOME = path.join(tempRoot, 'worker-home')

    const runtime = prepareWorkerAgentRuntime({
      agentType: 'Codex',
      cwd,
      actingUserId: 'user-a',
      workerConfig: {
        ...createWorkerConfig(path.join(tempRoot, 'workspace')),
        codexConfigContent: [
          '[mcp_servers.mcp-vibemux]',
          'url = "https://old.example/mcp"',
          'bearer_token = "stale-token"',
          '',
          '[mcp_servers.mcp_vibemux]',
          'url = "https://old.example/mcp"',
          'bearer_token = "stale-token"',
          '',
          '[mcp_servers.mcp_vibemux.env]',
          'VIBEMUX_MCP_EXECUTOR_TOKEN = "stale-token"',
          '',
          '[mcp_servers.keep_user_server]',
          'url = "https://user.example/mcp"',
        ].join('\n'),
        executorToken: 'executor-token-1',
        mcpServers: [{
          id: 'mcp-vibemux',
          name: 'vibemux',
          target: 'built-in://vibemux',
          transport: 'http',
          enabled: true,
          capabilityMode: 'resources+tools',
          managedBySystem: true,
        }],
      },
    })

    try {
      const codexHome = runtime.runtimeEnv.CODEX_HOME
      assert.ok(codexHome)
      const configContent = await readFile(path.join(codexHome, 'config.toml'), 'utf8')

      assert.match(configContent, /\[mcp_servers\."mcp_vibemux"\]/)
      assert.match(configContent, /\[mcp_servers\.keep_user_server\]/)
      assert.doesNotMatch(configContent, /mcp-vibemux/)
      assert.doesNotMatch(configContent, /bearer_token = "stale-token"/)
      assert.doesNotMatch(configContent, /bearer_token_env_var/)
      assert.doesNotMatch(configContent, /stale-token/)
      assert.doesNotMatch(configContent, /old\.example/)
      assert.match(configContent, /args = \[.*"mcp-stdio".*\]/)
      assert.match(configContent, /\[mcp_servers\."mcp_vibemux"\.env\]/)
      assert.match(configContent, /VIBEMUX_MCP_EXECUTOR_TOKEN = "executor-token-1"/)
      assert.match(configContent, /VIBEMUX_MCP_CLOUD_URL = "http:\/\/127\.0\.0\.1:8989"/)
      assert.match(configContent, /VIBEMUX_MCP_ACTING_USER = "user-a"/)
      assert.equal(runtime.runtimeEnv.VIBEMUX_MCP_EXECUTOR_TOKEN, 'executor-token-1')
      assert.equal(runtime.runtimeEnv.VIBEMUX_MCP_CLOUD_URL, 'http://127.0.0.1:8989')
      assert.equal(runtime.runtimeEnv.VIBEMUX_MCP_ACTING_USER, 'user-a')
    } finally {
      runtime.cleanup()
    }
  } finally {
    if (previousWorkerHome === undefined) {
      delete process.env.VIBEMUX_WORKER_HOME
    } else {
      process.env.VIBEMUX_WORKER_HOME = previousWorkerHome
    }

    await rm(tempRoot, { recursive: true, force: true })
  }
})

test('prepareWorkerAgentRuntime keeps Codex root model keys when mcp_servers table precedes them', async () => {
  const tempRoot = await createTempDir('vibemux-runtime-codex-root-keys-')
  const previousWorkerHome = process.env.VIBEMUX_WORKER_HOME

  try {
    const cwd = path.join(tempRoot, 'cwd')
    await mkdir(cwd, { recursive: true })
    process.env.VIBEMUX_WORKER_HOME = path.join(tempRoot, 'worker-home')

    // 不规范但 codex 容忍的形态：root 键 model/model_provider 夹在 mcp_servers 表之后。
    // removeTomlTable 删 mcp_servers 表时不应顺带删掉它们，否则 codex 读不到 provider、回退到订阅。
    const runtime = prepareWorkerAgentRuntime({
      agentType: 'Codex',
      cwd,
      actingUserId: 'user-a',
      workerConfig: {
        ...createWorkerConfig(path.join(tempRoot, 'workspace')),
        codexConfigContent: [
          'base_url = "https://api.example.com/v1"',
          '',
          '[mcp_servers."mcp_vibemux"]',
          'url = "https://old.example/mcp"',
          'bearer_token = "stale-token"',
          '',
          'model = "gpt-4o"',
          'model_provider = "myprovider"',
          '',
          '[model_providers.myprovider]',
          'name = "myprovider"',
          'base_url = "https://api.example.com/v1"',
          'env_key = "OPENAI_API_KEY"',
        ].join('\n'),
        executorToken: 'executor-token-1',
        mcpServers: [{
          id: 'mcp-vibemux',
          name: 'vibemux',
          target: 'built-in://vibemux',
          transport: 'http',
          enabled: true,
          capabilityMode: 'resources+tools',
          managedBySystem: true,
        }],
      },
    })

    try {
      const codexHome = runtime.runtimeEnv.CODEX_HOME
      assert.ok(codexHome)
      const configContent = await readFile(path.join(codexHome, 'config.toml'), 'utf8')

      assert.match(configContent, /model = "gpt-4o"/)
      assert.match(configContent, /model_provider = "myprovider"/)
      assert.match(configContent, /\[model_providers\.myprovider\]/)
      assert.match(configContent, /base_url = "https:\/\/api\.example\.com\/v1"/)
      // model_provider 必须出现在第一个 [table] 之前，否则 codex 会把它归入前一个表而读不到。
      const firstTableIndex = configContent.search(/^\[[^\]]+\]/m)
      const modelProviderIndex = configContent.indexOf('model_provider = "myprovider"')
      assert.ok(firstTableIndex > -1, 'expected at least one TOML table')
      assert.ok(modelProviderIndex > -1 && modelProviderIndex < firstTableIndex,
        'model_provider must precede the first TOML table so codex reads it as a root key')
    } finally {
      runtime.cleanup()
    }
  } finally {
    if (previousWorkerHome === undefined) {
      delete process.env.VIBEMUX_WORKER_HOME
    } else {
      process.env.VIBEMUX_WORKER_HOME = previousWorkerHome
    }

    await rm(tempRoot, { recursive: true, force: true })
  }
})

test('prepareWorkerAgentRuntime separates stable Codex homes by acting user', async () => {
  const tempRoot = await createTempDir('vibemux-runtime-codex-user-scope-')
  const previousWorkerHome = process.env.VIBEMUX_WORKER_HOME

  try {
    const cwd = path.join(tempRoot, 'cwd')
    await mkdir(cwd, { recursive: true })
    process.env.VIBEMUX_WORKER_HOME = path.join(tempRoot, 'worker-home')
    const workerConfig = createWorkerConfig(path.join(tempRoot, 'workspace'))

    const userARuntime = prepareWorkerAgentRuntime({
      agentType: 'Codex',
      cwd,
      actingUserId: 'user-a',
      workerConfig,
    })
    const userBRuntime = prepareWorkerAgentRuntime({
      agentType: 'Codex',
      cwd,
      actingUserId: 'user-b',
      workerConfig,
    })

    try {
      assert.notEqual(userARuntime.runtimeEnv.CODEX_HOME, userBRuntime.runtimeEnv.CODEX_HOME)
    } finally {
      userARuntime.cleanup()
      userBRuntime.cleanup()
    }
  } finally {
    if (previousWorkerHome === undefined) {
      delete process.env.VIBEMUX_WORKER_HOME
    } else {
      process.env.VIBEMUX_WORKER_HOME = previousWorkerHome
    }

    await rm(tempRoot, { recursive: true, force: true })
  }
})

test('prepareWorkerAgentRuntime writes managed Claude settings and exports provider env into CLAUDE_HOME', async () => {
  const tempRoot = await createTempDir('vibemux-runtime-claude-')
  const previousWorkerHome = process.env.VIBEMUX_WORKER_HOME

  try {
    const cwd = path.join(tempRoot, 'cwd')
    await mkdir(cwd, { recursive: true })
    process.env.VIBEMUX_WORKER_HOME = path.join(tempRoot, 'worker-home')

    const runtime = prepareWorkerAgentRuntime({
      agentType: 'ClaudeCode',
      cwd,
      actingUserId: 'user-a',
      workerConfig: {
        ...createWorkerConfig(path.join(tempRoot, 'workspace')),
        claudeCodeConfigContent: JSON.stringify({
          env: {
            ANTHROPIC_API_KEY: 'claude-test-key',
          },
        }, null, 2),
      },
    })

    try {
      const claudeHome = runtime.runtimeEnv.CLAUDE_HOME
      assert.ok(claudeHome)
      assert.equal(runtime.runtimeEnv.ANTHROPIC_API_KEY, 'claude-test-key')
      assert.deepEqual(runtime.runtimeArgs, ['--mcp-config', path.join(claudeHome, 'mcp.json')])

      const settingsContent = await readFile(path.join(claudeHome, 'settings.json'), 'utf8')
      assert.match(settingsContent, /claude-test-key/)
    } finally {
      runtime.cleanup()
    }
  } finally {
    if (previousWorkerHome === undefined) {
      delete process.env.VIBEMUX_WORKER_HOME
    } else {
      process.env.VIBEMUX_WORKER_HOME = previousWorkerHome
    }

    await rm(tempRoot, { recursive: true, force: true })
  }
})

test('prepareWorkerAgentRuntime only falls back to local Claude settings.json', async () => {
  const tempRoot = await createTempDir('vibemux-runtime-claude-local-')
  const previousClaudeHome = process.env.CLAUDE_HOME
  const previousWorkerHome = process.env.VIBEMUX_WORKER_HOME

  try {
    const cwd = path.join(tempRoot, 'cwd')
    const claudeHome = path.join(tempRoot, 'source-claude')
    await mkdir(cwd, { recursive: true })
    await mkdir(claudeHome, { recursive: true })
    await writeFile(path.join(claudeHome, 'config.json'), JSON.stringify({
      env: {
        ANTHROPIC_API_KEY: 'legacy-config-key',
      },
    }), 'utf8')
    process.env.CLAUDE_HOME = claudeHome
    process.env.VIBEMUX_WORKER_HOME = path.join(tempRoot, 'worker-home')

    const runtimeWithoutSettings = prepareWorkerAgentRuntime({
      agentType: 'ClaudeCode',
      cwd,
      actingUserId: 'user-a',
      workerConfig: createWorkerConfig(path.join(tempRoot, 'workspace')),
    })
    try {
      assert.equal(runtimeWithoutSettings.runtimeEnv.ANTHROPIC_API_KEY, undefined)
      assert.equal(existsSync(path.join(runtimeWithoutSettings.runtimeEnv.CLAUDE_HOME!, 'settings.json')), false)
    } finally {
      runtimeWithoutSettings.cleanup()
    }

    await writeFile(path.join(claudeHome, 'settings.json'), JSON.stringify({
      env: {
        ANTHROPIC_API_KEY: 'settings-key',
      },
    }), 'utf8')

    const runtimeWithSettings = prepareWorkerAgentRuntime({
      agentType: 'ClaudeCode',
      cwd,
      actingUserId: 'user-a',
      workerConfig: createWorkerConfig(path.join(tempRoot, 'workspace')),
    })
    try {
      assert.equal(runtimeWithSettings.runtimeEnv.ANTHROPIC_API_KEY, 'settings-key')
    } finally {
      runtimeWithSettings.cleanup()
    }
  } finally {
    if (previousClaudeHome === undefined) {
      delete process.env.CLAUDE_HOME
    } else {
      process.env.CLAUDE_HOME = previousClaudeHome
    }

    if (previousWorkerHome === undefined) {
      delete process.env.VIBEMUX_WORKER_HOME
    } else {
      process.env.VIBEMUX_WORKER_HOME = previousWorkerHome
    }

    await rm(tempRoot, { recursive: true, force: true })
  }
})

test('prepareWorkerAgentRuntime writes Codex official-connector stdio bridge with workspace context', async () => {
  const tempRoot = await createTempDir('vibemux-runtime-codex-connector-')
  const previousWorkerHome = process.env.VIBEMUX_WORKER_HOME

  try {
    const cwd = path.join(tempRoot, 'cwd')
    await mkdir(cwd, { recursive: true })
    process.env.VIBEMUX_WORKER_HOME = path.join(tempRoot, 'worker-home')

    const runtime = prepareWorkerAgentRuntime({
      agentType: 'Codex',
      cwd,
      actingUserId: 'user-a',
      workspaceId: 'exec-ws-1',
      workerConfig: {
        ...createWorkerConfig(path.join(tempRoot, 'workspace')),
        executorToken: 'executor-token-1',
        // 旧 Codex 配置里已有远程 url 表（无 headers 的老形态），应被 stdio 桥替换
        codexConfigContent: [
          '[mcp_servers."mcp-official-connector"]',
          'url = "http://127.0.0.1:8989/api/connector/mcp"',
          '',
        ].join('\n'),
        mcpServers: [{
          id: 'mcp-official-connector',
          name: 'official-connector',
          target: 'http://host.docker.internal:13000/mcp',
          transport: 'http',
          enabled: true,
          capabilityMode: 'resources+tools',
          managedBySystem: true,
          headers: { Authorization: 'Bearer runtime-token-1' },
        }],
      },
    })

    try {
      const codexHome = runtime.runtimeEnv.CODEX_HOME
      assert.ok(codexHome)
      const configContent = await readFile(path.join(codexHome, 'config.toml'), 'utf8')

      assert.match(configContent, /\[mcp_servers\."mcp_official_connector"\]/)
      assert.doesNotMatch(configContent, /api\/connector\/mcp\)/) // 旧远程 url 表被移除
      assert.match(configContent, /args = \[.*"mcp-connector-stdio".*\]/)
      assert.match(configContent, /\[mcp_servers\."mcp_official_connector"\.env\]/)
      assert.match(configContent, /VIBEMUX_CONNECTOR_TOKEN = "runtime-token-1"/)
      assert.match(configContent, /VIBEMUX_MCP_WORKSPACE = "exec-ws-1"/)
      assert.match(configContent, /VIBEMUX_MCP_CLOUD_URL = "http:\/\/127\.0\.0\.1:8989"/)
      assert.match(configContent, /VIBEMUX_MCP_ACTING_USER = "user-a"/)

      assert.equal(runtime.runtimeEnv.VIBEMUX_CONNECTOR_TOKEN, 'runtime-token-1')
      assert.equal(runtime.runtimeEnv.VIBEMUX_MCP_WORKSPACE, 'exec-ws-1')
      assert.equal(runtime.runtimeEnv.VIBEMUX_MCP_ACTING_USER, 'user-a')
    } finally {
      runtime.cleanup()
    }
  } finally {
    if (previousWorkerHome === undefined) {
      delete process.env.VIBEMUX_WORKER_HOME
    } else {
      process.env.VIBEMUX_WORKER_HOME = previousWorkerHome
    }

    await rm(tempRoot, { recursive: true, force: true })
  }
})
