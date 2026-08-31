// [INPUT]: runtime 上下文输入（cwd/技能/mcp/env）
// [OUTPUT]: 执行上下文
// [POS]: runtime 上下文准备
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { resolveRuntimeIdForAgentType, type RuntimeId } from '@shared/agent-type'
import { materializeMcpServersForOpencode, VIBEMUX_MCP_TARGET, OFFICIAL_CONNECTOR_MCP_SERVER_ID } from '@shared/mcp'
import { MANAGED_MODEL_RUNTIME_ENV } from '@shared/model-profile'
import type { AgentType, ExecutorSkillPackage, WorkerConfig } from '@shared/types'
import { getWorkspaceUserScopeDir } from '@shared/workspace-paths'
import { getWorkerHome, getWorkerNodeDir } from '../core/config'
import { resolveSelectedCodexAccountAuthPath } from '../runtime/codex-oauth/account-store'
import { loadWorkerRuntimeConfig } from '../core/runtime-cloud-url'
import { buildAgentRuntimeWorkerCommandEnvironment } from './agent-runtime-env'
import { ensureCodexProviderEnvKeyInConfig, ensureCodexProviderNameInConfig, hasCodexAuthDotJsonContent, hasLegacyCodexAccessTokenContent, parseCodexCredentialEnvironment, resolveCodexProviderConfig } from './codex-models'

const MANAGED_SKILL_INDEX = '.wemux-managed.json'
const TASK_RUNTIME_MARKER = 'vibemux-task-runtime-'
const CLAUDE_CREDENTIAL_FILES = ['.credentials.json']
const VIBEMUX_MCP_EXECUTOR_TOKEN_ENV = 'VIBEMUX_MCP_EXECUTOR_TOKEN'
const VIBEMUX_MCP_CLOUD_URL_ENV = 'VIBEMUX_MCP_CLOUD_URL'
const VIBEMUX_MCP_ACTING_USER_ENV = 'VIBEMUX_MCP_ACTING_USER'
const VIBEMUX_MCP_RUNTIME_AGENT_ENV = 'VIBEMUX_MCP_RUNTIME_AGENT'
const VIBEMUX_CONNECTOR_TOKEN_ENV = 'VIBEMUX_CONNECTOR_TOKEN'
const VIBEMUX_MCP_WORKSPACE_ENV = 'VIBEMUX_MCP_WORKSPACE'

type ManagedCodexModelRuntime = {
  bindingId: string
  providerId: string
  modelId: string
  baseUrl: string
  apiKey: string
}

const RUNTIME_CONTEXT_DESCRIPTORS: Record<RuntimeId, { skillRoot: string }> = {
  OpenCode: { skillRoot: '.opencode/skills' },
  Codex: { skillRoot: '.codex/skills' },
  ClaudeCode: { skillRoot: '.claude/skills' },
  Pi: { skillRoot: '.pi/skills' },
}

const getRuntimeSkillRoot = (agentType: AgentType) => {
  return RUNTIME_CONTEXT_DESCRIPTORS[resolveRuntimeIdForAgentType(agentType)].skillRoot
}

const escapeTomlString = (value: string) => value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const readManagedCodexModelRuntime = (runtimeEnv?: Record<string, string>): ManagedCodexModelRuntime | null => {
  if (runtimeEnv?.[MANAGED_MODEL_RUNTIME_ENV.enabled] !== '1') {
    return null
  }

  const bindingId = runtimeEnv[MANAGED_MODEL_RUNTIME_ENV.bindingId]?.trim() || ''
  const providerId = runtimeEnv[MANAGED_MODEL_RUNTIME_ENV.providerId]?.trim() || ''
  const modelId = runtimeEnv[MANAGED_MODEL_RUNTIME_ENV.modelId]?.trim() || ''
  const baseUrl = runtimeEnv[MANAGED_MODEL_RUNTIME_ENV.baseUrl]?.trim() || ''
  const apiKey = runtimeEnv[MANAGED_MODEL_RUNTIME_ENV.apiKey]?.trim() || ''
  if (!bindingId || !providerId || !modelId || !baseUrl || !apiKey) {
    throw new Error('受管 Codex 模型配置不完整，已拒绝回退到节点本地凭据。')
  }

  return { bindingId, providerId, modelId, baseUrl, apiKey }
}

const buildManagedCodexConfig = (model: ManagedCodexModelRuntime) => [
  `model = "${escapeTomlString(model.modelId)}"`,
  `model_provider = "${escapeTomlString(model.providerId)}"`,
  '',
  `[model_providers.${model.providerId}]`,
  `name = "${escapeTomlString(model.providerId)}"`,
  `base_url = "${escapeTomlString(model.baseUrl)}"`,
  `env_key = "${MANAGED_MODEL_RUNTIME_ENV.apiKey}"`,
].join('\n')

const isTomlBareKey = (value: string) => /^[A-Za-z0-9_-]+$/.test(value)

const logWorkerCodexRuntimeDebug = (stage: string, payload: Record<string, unknown>) => {
  console.log('[worker-codex-runtime]', stage, JSON.stringify(payload))
}

const buildTomlTablePattern = (segments: string[]) => {
  const pattern = segments
    .map((segment) => {
      const quoted = `"${escapeRegExp(segment)}"`
      if (!isTomlBareKey(segment)) {
        return quoted
      }

      return `(?:${escapeRegExp(segment)}|${quoted})`
    })
    .join('\\s*\\.\\s*')

  return new RegExp(`^\\s*\\[\\s*${pattern}\\s*\\]\\s*(?:#.*)?$`)
}

const hasTomlTable = (content: string, segments: string[]) => {
  if (!content.trim() || segments.length === 0) {
    return false
  }

  return content.split(/\r?\n/).some((line) => buildTomlTablePattern(segments).test(line))
}

const removeTomlTable = (content: string, segments: string[]) => {
  if (!content.trim() || segments.length === 0) {
    return content
  }

  const tablePattern = buildTomlTablePattern(segments)
  const nextTablePattern = /^\s*\[[^\]]+\]\s*(?:#.*)?$/
  const output: string[] = []
  let skipping = false

  for (const line of content.split(/\r?\n/)) {
    if (tablePattern.test(line)) {
      skipping = true
      continue
    }

    if (skipping && nextTablePattern.test(line)) {
      skipping = false
    }

    if (!skipping) {
      output.push(line)
    }
  }

  return output.join('\n').replace(/\n{3,}/g, '\n\n').trim()
}

// model/model_provider 是 codex 的顶层 root 键，必须出现在所有 [table] 之前才会被识别。
// 用户手写或合并后的 config 可能把它们夹在 mcp_servers 表之后，removeTomlTable 删 MCP 表时
// 会顺带删掉这些 root 键，导致 codex 读不到模型库配的 provider、回退到 ChatGPT 订阅。
// 这里仅把这两个键提前到所有表之前（base_url/openai_base_url 可能是 model_providers 段内的键，不动）。
const CODEX_ROOT_HOIST_KEYS = new Set(['model', 'model_provider'])

const hoistCodexRootKeys = (content: string) => {
  const normalized = content.trim()
  if (!normalized) {
    return content
  }

  const hoisted: string[] = []
  const output: string[] = []
  let sawTable = false

  for (const rawLine of normalized.split(/\r?\n/)) {
    const trimmed = rawLine.trim()
    if (/^\[[^\]]+\]\s*(?:#.*)?$/.test(trimmed)) {
      sawTable = true
      output.push(rawLine)
      continue
    }

    const keyMatch = trimmed.match(/^([A-Za-z0-9_.-]+)\s*=/)
    if (sawTable && keyMatch && CODEX_ROOT_HOIST_KEYS.has(keyMatch[1] ?? '')) {
      hoisted.push(rawLine)
      continue
    }

    output.push(rawLine)
  }

  if (hoisted.length === 0) {
    return content
  }

  return [...hoisted, '', output.join('\n').replace(/\n{3,}/g, '\n\n').trim()].join('\n')
}

const normalizePortablePath = (value: string) => {
  const parts: string[] = []
  for (const segment of value.replace(/\\/g, '/').replace(/^\/+/, '').split('/')) {
    if (!segment || segment === '.') {
      continue
    }

    if (segment === '..') {
      if (parts.length > 0) {
        parts.pop()
      }
      continue
    }

    parts.push(segment)
  }

  return parts.join('/')
}

const normalizeRuntimeConfigKey = (value: string) => {
  return normalizePortablePath(value)
    .replace(/\//g, '-')
    .replace(/[^A-Za-z0-9_-]/g, '_')
    .replace(/-+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
}

const legacyRuntimeConfigKey = (value: string) => {
  return normalizePortablePath(value).replace(/\//g, '-')
}

export const buildWindowsRuntimeHomeEnv = (runtimeRoot: string, platform = process.platform): Record<string, string> => {
  if (platform !== 'win32') {
    return {}
  }

  return {
    USERPROFILE: runtimeRoot,
    APPDATA: path.join(runtimeRoot, 'AppData', 'Roaming'),
    LOCALAPPDATA: path.join(runtimeRoot, 'AppData', 'Local'),
  }
}

const ensureWindowsRuntimeHomeDirs = (runtimeRoot: string): Record<string, string> => {
  const env = buildWindowsRuntimeHomeEnv(runtimeRoot)
  for (const directory of Object.values(env)) {
    mkdirSync(directory, { recursive: true })
  }
  return env
}

export const buildMcpShellCommand = (command: string, platform = process.platform) => (
  platform === 'win32'
    ? {
        command: process.env.ComSpec?.trim() || 'cmd.exe',
        args: ['/d', '/s', '/c', command],
      }
    : {
        command: 'sh',
        args: ['-lc', command],
      }
)

const normalizeRemoteTarget = (target: string) => {
  return target.startsWith('sse://')
    ? `http://${target.slice('sse://'.length)}`
    : target.trim()
}

const isRemoteTarget = (target: string) => {
  return /^https?:\/\//i.test(target) || /^sse:\/\//i.test(target)
}

const writeJsonFile = (filePath: string, value: unknown) => {
  mkdirSync(path.dirname(filePath), { recursive: true })
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

const writeTextFile = (filePath: string, value: string) => {
  mkdirSync(path.dirname(filePath), { recursive: true })
  writeFileSync(filePath, value, 'utf8')
}

const requireRuntimeActingUserId = (actingUserId?: string) => {
  const normalized = actingUserId?.trim() || ''
  if (!normalized || normalized === 'unknown' || normalized === 'unknown-user') {
    throw new Error('actingUserId is required to prepare user-scoped agent runtime.')
  }

  return normalized
}

const normalizeSkillFileContent = (value: ExecutorSkillPackage['files'][string] | string | null | undefined) => {
  if (typeof value === 'string') {
    return {
      encoding: 'utf8' as const,
      content: value,
    }
  }

  if (!value || typeof value !== 'object' || typeof value.content !== 'string') {
    return null
  }

  return {
    encoding: value.encoding === 'base64' ? 'base64' as const : 'utf8' as const,
    content: value.content,
  }
}

const getRuntimeBaseRoot = (prefix: string, actingUserId?: string) => {
  const userId = actingUserId?.trim()
  return userId
    ? path.join(getWorkspaceUserScopeDir(getWorkerHome(), userId), 'runtime', prefix)
    : path.join(getWorkerNodeDir(), 'runtime', prefix)
}

const buildStableRuntimeBucket = (prefix: string, key: string, actingUserId?: string) => {
  const digest = createHash('sha1').update(key).digest('hex').slice(0, 16)
  return path.join(getRuntimeBaseRoot(prefix, actingUserId), digest)
}

const createManagedTempRoot = (prefix: string, actingUserId?: string) => {
  const runtimeBaseRoot = getRuntimeBaseRoot(prefix, actingUserId)
  mkdirSync(runtimeBaseRoot, { recursive: true })
  return mkdtempSync(path.join(runtimeBaseRoot, `${prefix}-`))
}

const isTaskIsolatedPath = (value: string) => {
  return value.replace(/\\/g, '/').split('/').some((segment) => segment.startsWith(TASK_RUNTIME_MARKER))
}

const parseClaudeSettingsContent = (content: string) => {
  const trimmed = content.trim()
  if (!trimmed) {
    return null
  }

  try {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>
    const envRecord = parsed.env && typeof parsed.env === 'object'
      ? Object.entries(parsed.env as Record<string, unknown>).reduce<Record<string, string>>((result, [key, value]) => {
          if (typeof value === 'string' && value.trim()) {
            result[key] = value
          }
          return result
        }, {})
      : {}
    return {
      settings: parsed,
      runtimeEnv: envRecord,
    }
  } catch {
    return null
  }
}

const readManagedSkillIndex = (rootPath: string) => {
  const indexPath = path.join(rootPath, MANAGED_SKILL_INDEX)
  if (!existsSync(indexPath)) {
    return [] as string[]
  }

  try {
    const parsed = JSON.parse(readFileSync(indexPath, 'utf8')) as { slugs?: unknown }
    return Array.isArray(parsed.slugs)
      ? parsed.slugs.filter((slug): slug is string => typeof slug === 'string' && slug.trim().length > 0)
      : []
  } catch {
    return []
  }
}

const writeManagedSkillIndex = (rootPath: string, slugs: string[]) => {
  writeJsonFile(path.join(rootPath, MANAGED_SKILL_INDEX), { slugs })
}

type RuntimeSkillMaterialization = {
  promptRoot: string
  cleanup: () => void
}

const createTempRuntimeSkillRoot = (agentType: AgentType): {
  rootPath: string
  promptRoot: string
  cleanup: () => void
} => {
  const runtimeRoot = createManagedTempRoot(`skills-${agentType.toLowerCase()}`)
  const rootPath = path.join(runtimeRoot, getRuntimeSkillRoot(agentType))
  mkdirSync(rootPath, { recursive: true })
  return {
    rootPath,
    promptRoot: rootPath.replace(/\\/g, '/'),
    cleanup: () => {
      rmSync(runtimeRoot, { recursive: true, force: true })
    },
  }
}

const writeRuntimeSkillPackages = (rootPath: string, skillPackages: ExecutorSkillPackage[]) => {
  for (const slug of readManagedSkillIndex(rootPath)) {
    rmSync(path.join(rootPath, slug), { recursive: true, force: true })
  }

  const nextSlugs: string[] = []
  for (const skill of skillPackages) {
    const slug = normalizePortablePath(skill.slug)
    if (!slug) {
      continue
    }

    nextSlugs.push(slug)
    const skillRoot = path.join(rootPath, slug)
    rmSync(skillRoot, { recursive: true, force: true })
    mkdirSync(skillRoot, { recursive: true })

    for (const [rawFilePath, rawContent] of Object.entries(skill.files)) {
      const normalizedFilePath = normalizePortablePath(rawFilePath)
      if (!normalizedFilePath) {
        continue
      }

      const targetPath = path.resolve(skillRoot, normalizedFilePath)
      if (targetPath !== skillRoot && !targetPath.startsWith(`${skillRoot}${path.sep}`)) {
        continue
      }

      const content = normalizeSkillFileContent(rawContent)
      if (!content) {
        continue
      }

      mkdirSync(path.dirname(targetPath), { recursive: true })
      if (content.encoding === 'base64') {
        writeFileSync(targetPath, Buffer.from(content.content, 'base64'))
        continue
      }

      writeTextFile(targetPath, content.content)
    }

    if (!existsSync(path.join(skillRoot, 'SKILL.md'))) {
      writeTextFile(path.join(skillRoot, 'SKILL.md'), skill.markdown)
    }
  }

  writeManagedSkillIndex(rootPath, nextSlugs)
}

const materializeRuntimeSkills = (agentType: AgentType, cwd: string, skillPackages: ExecutorSkillPackage[]): RuntimeSkillMaterialization | null => {
  if (skillPackages.length === 0) {
    return null
  }

  if (resolveRuntimeIdForAgentType(agentType) === 'OpenCode') {
    const relativeRoot = getRuntimeSkillRoot(agentType)
    const preferredRootPath = path.join(cwd, relativeRoot)
    mkdirSync(preferredRootPath, { recursive: true })
    writeRuntimeSkillPackages(preferredRootPath, skillPackages)
    return {
      promptRoot: relativeRoot.replace(/\\/g, '/'),
      cleanup: () => undefined,
    }
  }

  let isolatedError: unknown
  try {
    const tempRoot = createTempRuntimeSkillRoot(agentType)
    try {
      writeRuntimeSkillPackages(tempRoot.rootPath, skillPackages)
      return {
        promptRoot: tempRoot.promptRoot,
        cleanup: tempRoot.cleanup,
      }
    } catch (error) {
      tempRoot.cleanup()
      throw error
    }
  } catch (error) {
    isolatedError = error
    const relativeRoot = getRuntimeSkillRoot(agentType)
    const preferredRootPath = path.join(cwd, relativeRoot)
    try {
      mkdirSync(preferredRootPath, { recursive: true })
      writeRuntimeSkillPackages(preferredRootPath, skillPackages)
      return {
        promptRoot: relativeRoot.replace(/\\/g, '/'),
        cleanup: () => undefined,
      }
    } catch (projectError) {
      throw projectError instanceof Error ? projectError : (isolatedError instanceof Error ? isolatedError : new Error('写入运行时技能目录失败。'))
    }
  }
}

const extractBearerToken = (headers?: Record<string, string>) => {
  if (!headers) {
    return ''
  }
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === 'authorization') {
      return value.replace(/^Bearer\s+/i, '').trim()
    }
  }
  return ''
}

const buildCodexMcpConfig = (config: WorkerConfig, existingConfigContent = '', actingUserId?: string, runtimeAgentId?: string, workspaceId?: string) => {
  const sections: string[] = []
  const env: Record<string, string> = {}
  let baseConfig = existingConfigContent
  const workerCommandEnv = buildAgentRuntimeWorkerCommandEnvironment()
  const runtimeActingUserId = actingUserId?.trim()
  const normalizedRuntimeAgentId = runtimeAgentId?.trim()

  for (const server of config.mcpServers ?? []) {
    if (!server.enabled) {
      continue
    }

    const key = normalizeRuntimeConfigKey(server.id || server.name)
    if (!key) {
      continue
    }

    const isManagedWemuxServer = server.target === VIBEMUX_MCP_TARGET
    const isOfficialConnectorServer = server.id === OFFICIAL_CONNECTOR_MCP_SERVER_ID
    if (isManagedWemuxServer || isOfficialConnectorServer) {
      const oldKey = legacyRuntimeConfigKey(server.id || server.name)
      baseConfig = removeTomlTable(baseConfig, ['mcp_servers', key])
      baseConfig = removeTomlTable(baseConfig, ['mcp_servers', key, 'env'])
      if (oldKey && oldKey !== key) {
        baseConfig = removeTomlTable(baseConfig, ['mcp_servers', oldKey])
        baseConfig = removeTomlTable(baseConfig, ['mcp_servers', oldKey, 'env'])
      }
    } else if (hasTomlTable(baseConfig, ['mcp_servers', key])) {
      continue
    }

    if (server.transport === 'stdio' || server.target.startsWith('stdio://')) {
      const command = server.target.replace(/^stdio:\/\//, '').trim()
      if (!command || command.includes('&&') || command.includes('|') || command.includes(';')) {
        continue
      }

      const shell = buildMcpShellCommand(command)
      sections.push(
        `[mcp_servers."${escapeTomlString(key)}"]`,
        `command = "${escapeTomlString(shell.command)}"`,
        `args = [${shell.args.map((arg) => `"${escapeTomlString(arg)}"`).join(', ')}]`,
        '',
      )
      continue
    }

    if (isManagedWemuxServer) {
      if (!config.executorToken?.trim()) {
        continue
      }

      const shell = workerCommandEnv.WEMUX_WORKER_LAUNCHER
        ? { command: workerCommandEnv.WEMUX_WORKER_LAUNCHER, args: ['mcp-stdio'] }
        : workerCommandEnv.WEMUX_WORKER_RUNNER && workerCommandEnv.WEMUX_WORKER_ENTRY
          ? { command: workerCommandEnv.WEMUX_WORKER_RUNNER, args: [workerCommandEnv.WEMUX_WORKER_ENTRY, 'mcp-stdio'] }
          : null

      if (!shell) {
        continue
      }

      env[VIBEMUX_MCP_EXECUTOR_TOKEN_ENV] = config.executorToken.trim()
      env[VIBEMUX_MCP_CLOUD_URL_ENV] = config.cloudUrl.trim()
      if (runtimeActingUserId) {
        env[VIBEMUX_MCP_ACTING_USER_ENV] = runtimeActingUserId
      }
      if (normalizedRuntimeAgentId) {
        env[VIBEMUX_MCP_RUNTIME_AGENT_ENV] = normalizedRuntimeAgentId
      }

      sections.push(
        `[mcp_servers."${escapeTomlString(key)}"]`,
        `command = "${escapeTomlString(shell.command)}"`,
        `args = [${shell.args.map((arg) => `"${escapeTomlString(arg)}"`).join(', ')}]`,
        '',
        `[mcp_servers."${escapeTomlString(key)}".env]`,
        `${VIBEMUX_MCP_EXECUTOR_TOKEN_ENV} = "${escapeTomlString(config.executorToken.trim())}"`,
        `${VIBEMUX_MCP_CLOUD_URL_ENV} = "${escapeTomlString(config.cloudUrl.trim())}"`,
        ...(runtimeActingUserId ? [`${VIBEMUX_MCP_ACTING_USER_ENV} = "${escapeTomlString(runtimeActingUserId)}"`] : []),
        ...(normalizedRuntimeAgentId ? [`${VIBEMUX_MCP_RUNTIME_AGENT_ENV} = "${escapeTomlString(normalizedRuntimeAgentId)}"`] : []),
        '',
      )
      continue
    }

    // 官方连接器：Codex 远程 MCP 不支持自定义 headers，经本地 stdio 桥转发到 Wemux 代理（携带 workspace 上下文与 runtime token）
    if (isOfficialConnectorServer) {
      const connectorToken = extractBearerToken(server.headers)
      const normalizedWorkspaceId = workspaceId?.trim()
      if (!connectorToken || !normalizedWorkspaceId) {
        continue
      }

      const shell = workerCommandEnv.WEMUX_WORKER_LAUNCHER
        ? { command: workerCommandEnv.WEMUX_WORKER_LAUNCHER, args: ['mcp-connector-stdio'] }
        : workerCommandEnv.WEMUX_WORKER_RUNNER && workerCommandEnv.WEMUX_WORKER_ENTRY
          ? { command: workerCommandEnv.WEMUX_WORKER_RUNNER, args: [workerCommandEnv.WEMUX_WORKER_ENTRY, 'mcp-connector-stdio'] }
          : null

      if (!shell) {
        continue
      }

      env[VIBEMUX_CONNECTOR_TOKEN_ENV] = connectorToken
      env[VIBEMUX_MCP_CLOUD_URL_ENV] = config.cloudUrl.trim()
      env[VIBEMUX_MCP_WORKSPACE_ENV] = normalizedWorkspaceId
      if (runtimeActingUserId) {
        env[VIBEMUX_MCP_ACTING_USER_ENV] = runtimeActingUserId
      }
      if (normalizedRuntimeAgentId) {
        env[VIBEMUX_MCP_RUNTIME_AGENT_ENV] = normalizedRuntimeAgentId
      }

      sections.push(
        `[mcp_servers."${escapeTomlString(key)}"]`,
        `command = "${escapeTomlString(shell.command)}"`,
        `args = [${shell.args.map((arg) => `"${escapeTomlString(arg)}"`).join(', ')}]`,
        '',
        `[mcp_servers."${escapeTomlString(key)}".env]`,
        `${VIBEMUX_CONNECTOR_TOKEN_ENV} = "${escapeTomlString(connectorToken)}"`,
        `${VIBEMUX_MCP_CLOUD_URL_ENV} = "${escapeTomlString(config.cloudUrl.trim())}"`,
        `${VIBEMUX_MCP_WORKSPACE_ENV} = "${escapeTomlString(normalizedWorkspaceId)}"`,
        ...(runtimeActingUserId ? [`${VIBEMUX_MCP_ACTING_USER_ENV} = "${escapeTomlString(runtimeActingUserId)}"`] : []),
        ...(normalizedRuntimeAgentId ? [`${VIBEMUX_MCP_RUNTIME_AGENT_ENV} = "${escapeTomlString(normalizedRuntimeAgentId)}"`] : []),
        '',
      )
      continue
    }

    if (!isRemoteTarget(server.target)) {
      continue
    }

    const url = normalizeRemoteTarget(server.target)
    if (!url) {
      continue
    }

    sections.push(
      `[mcp_servers."${escapeTomlString(key)}"]`,
      `url = "${escapeTomlString(url)}"`,
      '',
    )
  }

  return {
    baseConfig,
    configText: sections.join('\n'),
    env,
  }
}

const buildClaudeMcpConfig = (config: WorkerConfig, actingUserId?: string, runtimeAgentId?: string, workspaceId?: string) => {
  const materialized = materializeMcpServersForOpencode(config.mcpServers ?? [], {
    cloudUrl: config.cloudUrl,
    executorToken: config.executorToken,
    actingUserId,
    runtimeAgentId,
    workspaceId,
  })

  const mcpServers = Object.entries(materialized).reduce<Record<string, unknown>>((result, [key, definition]) => {
    const record = definition as Record<string, unknown>
    if (typeof record.command === 'string' && record.command.trim()) {
      const shell = buildMcpShellCommand(record.command.trim())
      result[key] = {
        command: shell.command,
        args: shell.args,
      }
      return result
    }

    if (typeof record.url === 'string' && record.url.trim()) {
      result[key] = {
        type: 'http',
        url: record.url.trim(),
        ...(record.headers && typeof record.headers === 'object' ? { headers: record.headers } : {}),
      }
    }

    return result
  }, {})

  return { mcpServers }
}

const createCodexRuntime = (
  cwd: string,
  config: WorkerConfig,
  actingUserId?: string,
  runtimeEnv?: Record<string, string>,
  runtimeAgentId?: string,
  workspaceId?: string,
) => {
  const runtimeUserId = requireRuntimeActingUserId(actingUserId)
  const managedModel = readManagedCodexModelRuntime(runtimeEnv)
  const runtimeBucketKey = [runtimeUserId, cwd].join('\0')
  const runtimeRoot = isTaskIsolatedPath(cwd)
    ? createManagedTempRoot('codex-home', runtimeUserId)
    : buildStableRuntimeBucket('codex-home', runtimeBucketKey, runtimeUserId)
  const sourceRoot = process.env.CODEX_HOME?.trim() || path.join(os.homedir(), '.codex')
  const sourceConfigPath = path.join(sourceRoot, 'config.toml')
  // 托管 ChatGPT 账户登录态优先于 worker 本地 ~/.codex（OAuth token 只存 users/<userId>/runtime 私有目录）
  const managedAccountAuthPath = resolveSelectedCodexAccountAuthPath(runtimeUserId)
  const sourceAuthPath = managedAccountAuthPath || path.join(sourceRoot, 'auth.json')
  const targetConfigPath = path.join(runtimeRoot, 'config.toml')
  const targetAuthPath = path.join(runtimeRoot, 'auth.json')
  const sourceConfigContent = managedModel || !existsSync(sourceConfigPath) ? '' : readFileSync(sourceConfigPath, 'utf8').trim()
  const sourceAuthExists = !managedModel && existsSync(sourceAuthPath)

  logWorkerCodexRuntimeDebug('runtime-auth-source', {
    actingUserId: runtimeUserId,
    credentialSource: managedModel ? 'managed-model' : managedAccountAuthPath ? 'managed-chatgpt-account' : 'local-codex-home',
  })

  mkdirSync(runtimeRoot, { recursive: true })

  const rawBaseConfig = managedModel
    ? buildManagedCodexConfig(managedModel)
    : config.codexConfigContent?.trim()
      || sourceConfigContent
  const resolvedBaseProvider = resolveCodexProviderConfig({
    configContent: rawBaseConfig,
    authContent: managedModel ? undefined : config.codexAuthContent,
  })
  const namedBaseConfig = ensureCodexProviderNameInConfig(rawBaseConfig, resolvedBaseProvider.providerId)
  const envKeyBaseConfig = ensureCodexProviderEnvKeyInConfig(
    namedBaseConfig.content,
    resolvedBaseProvider.providerId,
    resolvedBaseProvider.envKey,
  )
  const baseConfig = hoistCodexRootKeys(envKeyBaseConfig.content)
  const currentProjectTrust = hasTomlTable(baseConfig, ['projects', cwd])
    ? ''
    : [
        `[projects."${escapeTomlString(cwd)}"]`,
        'trust_level = "trusted"',
      ].join('\n')
  const mcpConfig = buildCodexMcpConfig(config, baseConfig, runtimeUserId, runtimeAgentId, workspaceId)
  const parts = [mcpConfig.baseConfig, currentProjectTrust, mcpConfig.configText].filter((part) => part.trim())
  writeTextFile(targetConfigPath, `${parts.join('\n\n')}\n`)
  const managedCredentialEnv = managedModel
    ? { [MANAGED_MODEL_RUNTIME_ENV.apiKey]: managedModel.apiKey }
    : parseCodexCredentialEnvironment(config.codexAuthContent)
  const managedCredentialEnvKeys = Object.keys(managedCredentialEnv).sort()
  let credentialStrategy: 'env-json' | 'legacy-auth-json' | 'oauth-auth-json' | 'local-auth-copy' | 'none' = 'none'
  if (!managedModel && hasCodexAuthDotJsonContent(config.codexAuthContent)) {
    writeTextFile(targetAuthPath, `${config.codexAuthContent?.trim() || ''}\n`)
    credentialStrategy = 'oauth-auth-json'
  } else if (!managedModel && hasLegacyCodexAccessTokenContent(config.codexAuthContent)) {
    writeTextFile(targetAuthPath, `${config.codexAuthContent?.trim() || ''}\n`)
    credentialStrategy = 'legacy-auth-json'
  } else if (managedCredentialEnvKeys.length > 0) {
    credentialStrategy = 'env-json'
  } else if (sourceAuthExists && !existsSync(targetAuthPath)) {
    copyFileSync(sourceAuthPath, targetAuthPath)
    credentialStrategy = 'local-auth-copy'
  }

  logWorkerCodexRuntimeDebug('runtime-created', {
    cwd,
    actingUserId: runtimeUserId,
    runtimeRoot,
    runtimeRootMode: isTaskIsolatedPath(cwd) ? 'isolated-temp' : 'stable-per-workspace',
    configSource: managedModel
      ? 'model-profile-binding'
      : config.codexConfigContent?.trim()
        ? 'managed-config-sync'
        : sourceConfigContent
          ? 'local-codex-home'
          : 'empty',
    configPresent: Boolean(baseConfig.trim()),
    providerId: resolvedBaseProvider.providerId,
    configuredModel: resolvedBaseProvider.configuredModel || '',
    providerNameAdded: namedBaseConfig.changed,
    providerEnvKey: resolvedBaseProvider.envKey,
    providerEnvKeyAdded: envKeyBaseConfig.changed,
    credentialStrategy,
    managedCredentialEnvKeys,
    sourceAuthExists,
    trustAdded: Boolean(currentProjectTrust),
    mcpConfigAdded: Boolean(mcpConfig.configText.trim()),
    mcpEnvKeys: Object.keys(mcpConfig.env).sort(),
    managedModelBindingId: managedModel?.bindingId || '',
  })

  return {
    runtimeEnv: {
      CODEX_HOME: runtimeRoot,
      ...ensureWindowsRuntimeHomeDirs(runtimeRoot),
      ...mcpConfig.env,
      ...managedCredentialEnv,
    },
    cleanup: () => {
      if (isTaskIsolatedPath(cwd)) {
        rmSync(runtimeRoot, { recursive: true, force: true })
      }
    },
  }
}

const createClaudeRuntime = (config: WorkerConfig, actingUserId?: string, runtimeAgentId?: string, workspaceId?: string) => {
  const runtimeUserId = requireRuntimeActingUserId(actingUserId)
  const runtimeRoot = createManagedTempRoot('claude-home', runtimeUserId)
  const configPath = path.join(runtimeRoot, 'mcp.json')
  const sourceRoot = process.env.CLAUDE_HOME?.trim() || path.join(os.homedir(), '.claude')
  const sourceSettingsPath = path.join(sourceRoot, 'settings.json')
  const localSettings = existsSync(sourceSettingsPath) ? readFileSync(sourceSettingsPath, 'utf8').trim() : ''
  const managedSettings = config.claudeCodeConfigContent?.trim() || localSettings
  const parsedManagedSettings = managedSettings ? parseClaudeSettingsContent(managedSettings) : null

  if (managedSettings) {
    if (!parsedManagedSettings) {
      rmSync(runtimeRoot, { recursive: true, force: true })
      throw new Error('Claude Code settings.json 格式不正确。')
    }

    writeJsonFile(path.join(runtimeRoot, 'settings.json'), parsedManagedSettings.settings)
  }

  for (const filename of CLAUDE_CREDENTIAL_FILES) {
    const targetPath = path.join(runtimeRoot, filename)
    // 平台托管 Claude OAuth 凭证优先（多节点场景，随配置广播到所有节点）
    const managedCredentials = config.claudeCodeCredentialsContent?.trim()
    if (managedCredentials && !existsSync(targetPath)) {
      writeJsonFile(targetPath, JSON.parse(managedCredentials))
      continue
    }
    const sourcePath = path.join(sourceRoot, filename)
    if (existsSync(sourcePath) && !existsSync(targetPath)) {
      copyFileSync(sourcePath, targetPath)
    }
  }

  writeJsonFile(configPath, buildClaudeMcpConfig(config, runtimeUserId, runtimeAgentId, workspaceId))

  return {
    runtimeArgs: ['--mcp-config', configPath],
    runtimeEnv: {
      CLAUDE_HOME: runtimeRoot,
      ...ensureWindowsRuntimeHomeDirs(runtimeRoot),
      ...(parsedManagedSettings?.runtimeEnv ?? {}),
    },
    cleanup: () => {
      rmSync(runtimeRoot, { recursive: true, force: true })
    },
  }
}

const createClaudeProjectSettingsRuntime = (config: WorkerConfig, actingUserId?: string, runtimeAgentId?: string, workspaceId?: string) => {
  const runtime = createClaudeRuntime(config, actingUserId, runtimeAgentId, workspaceId)
  return {
    runtimeArgs: runtime.runtimeArgs,
    runtimeEnv: runtime.runtimeEnv,
    cleanup: () => {
      runtime.cleanup()
    },
  }
}

const createOpenCodeRuntime = (cwd: string, actingUserId?: string) => {
  const runtimeBucketKey = [actingUserId?.trim() || 'node', cwd].join('\0')
  const runtimeRoot = isTaskIsolatedPath(cwd)
    ? createManagedTempRoot('opencode-home', actingUserId)
    : buildStableRuntimeBucket('opencode-home', runtimeBucketKey, actingUserId)
  const xdgRoot = path.join(runtimeRoot, '.local')

  mkdirSync(path.join(runtimeRoot, '.config'), { recursive: true })
  mkdirSync(path.join(xdgRoot, 'share'), { recursive: true })
  mkdirSync(path.join(xdgRoot, 'state'), { recursive: true })
  mkdirSync(path.join(xdgRoot, 'cache'), { recursive: true })

  return {
    runtimeEnv: {
      HOME: runtimeRoot,
      ...ensureWindowsRuntimeHomeDirs(runtimeRoot),
      XDG_CONFIG_HOME: path.join(runtimeRoot, '.config'),
      XDG_DATA_HOME: path.join(xdgRoot, 'share'),
      XDG_STATE_HOME: path.join(xdgRoot, 'state'),
      XDG_CACHE_HOME: path.join(xdgRoot, 'cache'),
    },
    cleanup: () => {
      if (isTaskIsolatedPath(cwd)) {
        rmSync(runtimeRoot, { recursive: true, force: true })
      }
    },
  }
}

export const prependRuntimePrompt = (prompt: string, prefix: string) => {
  const normalizedPrefix = prefix.trim()
  if (!normalizedPrefix) {
    return prompt
  }

  return [normalizedPrefix, '', prompt].join('\n')
}

type RuntimePreparationParams = {
  agentType: AgentType
  actingUserId?: string
  runtimeAgentId?: string
  workspaceId?: string
  cwd: string
  effectiveConfig: WorkerConfig
  promptPrefix: string
  runtimeSkills: RuntimeSkillMaterialization | null
  runtimeEnv?: Record<string, string>
}

type RuntimePreparationResult = {
  promptPrefix: string
  runtimeEnv: Record<string, string>
  runtimeArgs: string[]
  cleanup: () => void
}

const createOpenCodeRuntimePreparation = (params: RuntimePreparationParams): RuntimePreparationResult => {
  const runtime = createOpenCodeRuntime(params.cwd, params.actingUserId)
  return {
    promptPrefix: params.promptPrefix,
    runtimeEnv: runtime.runtimeEnv,
    runtimeArgs: [],
    cleanup: () => {
      params.runtimeSkills?.cleanup()
      runtime.cleanup()
    },
  }
}

const createCodexRuntimePreparation = (params: RuntimePreparationParams): RuntimePreparationResult => {
  const runtime = createCodexRuntime(params.cwd, params.effectiveConfig, params.actingUserId, params.runtimeEnv, params.runtimeAgentId, params.workspaceId)
  return {
    promptPrefix: params.promptPrefix,
    runtimeEnv: runtime.runtimeEnv,
    runtimeArgs: [],
    cleanup: () => {
      params.runtimeSkills?.cleanup()
      runtime.cleanup()
    },
  }
}

const createClaudeRuntimePreparation = (params: RuntimePreparationParams): RuntimePreparationResult => {
  const runtime = createClaudeProjectSettingsRuntime(params.effectiveConfig, params.actingUserId, params.runtimeAgentId, params.workspaceId)
  return {
    promptPrefix: params.promptPrefix,
    runtimeEnv: runtime.runtimeEnv,
    runtimeArgs: runtime.runtimeArgs,
    cleanup: () => {
      params.runtimeSkills?.cleanup()
      runtime.cleanup()
    },
  }
}

const createPiRuntimePreparation = (params: RuntimePreparationParams): RuntimePreparationResult => {
  const configuredAgentDir = params.effectiveConfig.agentSettings.Pi.agentDir?.trim()
    || params.effectiveConfig.piAgentDir?.trim()
    || path.join(os.homedir(), '.pi', 'agent')
  const skillPath = params.runtimeSkills?.promptRoot?.trim()

  return {
    promptPrefix: params.promptPrefix,
    runtimeEnv: {
      WEMUX_PI_AGENT_DIR: configuredAgentDir,
      ...(skillPath ? { WEMUX_PI_SKILL_PATHS: skillPath.split('\n').join(path.delimiter) } : {}),
    },
    runtimeArgs: [],
    cleanup: () => {
      params.runtimeSkills?.cleanup()
    },
  }
}

const RUNTIME_PREPARERS: Partial<Record<RuntimeId, (params: RuntimePreparationParams) => RuntimePreparationResult>> = {
  OpenCode: createOpenCodeRuntimePreparation,
  Codex: createCodexRuntimePreparation,
  ClaudeCode: createClaudeRuntimePreparation,
  Pi: createPiRuntimePreparation,
}

export const prepareWorkerAgentRuntime = (params: {
  agentType: AgentType
  cwd: string
  actingUserId?: string
  runtimeAgentId?: string
  workspaceId?: string
  runtimeSkillPackages?: ExecutorSkillPackage[]
  mcpServers?: WorkerConfig['mcpServers']
  workerConfig?: WorkerConfig
  runtimeEnv?: Record<string, string>
}): RuntimePreparationResult => {
  const config = params.workerConfig ?? loadWorkerRuntimeConfig()
  const effectiveConfig = params.mcpServers
    ? {
        ...config,
        mcpServers: params.mcpServers,
      }
    : config
  const skillPackages = params.runtimeSkillPackages ?? []
  const runtimeSkills = existsSync(params.cwd)
    ? materializeRuntimeSkills(params.agentType, params.cwd, skillPackages)
    : null

  const runtimeId = resolveRuntimeIdForAgentType(params.agentType)
  const prepareRuntime = RUNTIME_PREPARERS[runtimeId] ?? createOpenCodeRuntimePreparation
  const prepared = prepareRuntime({
    agentType: params.agentType,
    actingUserId: params.actingUserId,
    runtimeAgentId: params.runtimeAgentId,
    workspaceId: params.workspaceId,
    cwd: params.cwd,
    effectiveConfig,
    promptPrefix: '',
    runtimeSkills,
    runtimeEnv: params.runtimeEnv,
  })

  return {
    ...prepared,
    runtimeEnv: {
      ...prepared.runtimeEnv,
      ...buildAgentRuntimeWorkerCommandEnvironment(),
    },
  }
}
