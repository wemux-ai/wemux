/**
 * [INPUT]: Codex app-server JSON-RPC events, prompt execution surface, and worker runtime model configuration.
 * [OUTPUT]: A streamed Worker Agent result with surface-scoped sandboxing and safe protocol responses for approvals and MCP interactions.
 * [POS]: Worker execution adapter for Codex-backed Agent and task turns.
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */
import { readFileSync, writeFileSync } from 'node:fs'
import http from 'node:http'
import { spawn } from 'node:child_process'
import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import { once } from 'node:events'
import type { AddressInfo } from 'node:net'
import path from 'node:path'
import { VIBEMUX_READ_ONLY_MCP_TOOL_NAMES } from '@shared/mcp'
import { parseExecutionModelId, toNativeRuntimeModelId } from '@shared/model-profile'
import type { CodexAgentSettings, CodexApprovalMode, ModelTokenUsage } from '@shared/types'
import { buildAgentRuntimeEnvironment } from './agent-runtime-env'
import { emitAgentEvent, normalizeExecutionModel, readJsonLine, resolveExecutable, shouldSpawnWithShellOnWindows, toAbortError, type WorkerAgentPromptParams, type WorkerAgentPromptResult } from './agent-runner-shared'
import { ensureCodexProviderEnvKeyInConfig, ensureCodexProviderNameInConfig, resolveCodexProviderConfig } from './codex-models'

/**
 * codex >= 0.41.0 uses 'proto' for stdin/stdout JSON-RPC.
 * Older versions use 'app-server'.
 * Detect by checking 'codex --help' output for the 'proto' subcommand.
 */
let cachedProtoSupported: boolean | null = null
const isCodexProtoSupported = (executable: string): boolean => {
  if (cachedProtoSupported !== null) return cachedProtoSupported
  try {
    const result = require('node:child_process').spawnSync(executable, ['--help'], {
      encoding: 'utf8',
      timeout: 5000,
      shell: shouldSpawnWithShellOnWindows(executable),
    })
    cachedProtoSupported = result.stdout?.includes('proto') ?? false
  } catch {
    cachedProtoSupported = false
  }
  return cachedProtoSupported ?? false
}

type CodexProtocolSubcommand = 'proto' | 'app-server'

const resolveCodexProtocolCandidates = (executable: string): CodexProtocolSubcommand[] => {
  return isCodexProtoSupported(executable)
    ? ['proto', 'app-server']
    : ['app-server', 'proto']
}

const buildCodexProtocolArgs = (subcommand: CodexProtocolSubcommand, extraArgs: string[] = []): string[] => {
  return [subcommand, ...extraArgs]
}

type JsonRpcId = number | string

const DEFAULT_CODEX_STARTUP_RPC_TIMEOUT_MS = 60_000

const readPositiveIntegerEnv = (name: string, fallback: number) => {
  const raw = process.env[name]?.trim()
  if (!raw) {
    return fallback
  }

  const parsed = Number.parseInt(raw, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

const resolveCodexStartupRpcTimeoutMs = () => readPositiveIntegerEnv(
  'WEMUX_CODEX_STARTUP_RPC_TIMEOUT_MS',
  DEFAULT_CODEX_STARTUP_RPC_TIMEOUT_MS,
)

const createCodexRpcTimeoutError = (method: string, timeoutMs: number) => new Error(
  `Codex 启动超时：${method} 在 ${timeoutMs}ms 内没有响应。请检查节点上的 Codex CLI 登录状态、模型配置或网络，然后重试本轮工作区对话。`,
)

type JsonRpcRequest = {
  jsonrpc: '2.0'
  id: JsonRpcId
  method: string
  params?: unknown
}

type JsonRpcNotification = {
  jsonrpc: '2.0'
  method: string
  params?: unknown
}

type JsonRpcResponse = {
  jsonrpc?: '2.0'
  id: JsonRpcId
  result?: unknown
  error?: {
    code?: number
    message?: string
    data?: unknown
  }
}

type CodexMcpElicitationParams = {
  mode?: unknown
  serverName?: unknown
}

const TRUSTED_VIBEMUX_MCP_SERVER_NAMES = new Set(['mcp_vibemux', 'vibemux'])

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const paramsMentionReadOnlyWemuxTool = (params: unknown) => {
  let serialized = ''
  try {
    const encoded = JSON.stringify(params)
    if (!encoded) {
      return false
    }
    serialized = encoded.toLowerCase()
  } catch {
    return false
  }

  return VIBEMUX_READ_ONLY_MCP_TOOL_NAMES.some((toolName) => {
    const aliases = [toolName, toolName.replace(/\./g, '_')]
    return aliases.some((alias) => new RegExp(`(^|[^a-z0-9_])${escapeRegExp(alias)}([^a-z0-9_]|$)`).test(serialized))
  })
}

export const resolveCodexElicitationResponse = (method: string, params?: unknown) => {
  if (method !== 'mcpServer/elicitation/request') {
    return null
  }

  const payload = params && typeof params === 'object' ? params as CodexMcpElicitationParams : {}
  const serverName = typeof payload.serverName === 'string' ? payload.serverName.trim().toLowerCase() : ''
  const acceptsTrustedRead = payload.mode === 'form'
    && TRUSTED_VIBEMUX_MCP_SERVER_NAMES.has(serverName)
    && paramsMentionReadOnlyWemuxTool(params)

  return acceptsTrustedRead
    ? { action: 'accept' as const, content: {}, _meta: null }
    : { action: 'decline' as const, content: null, _meta: null }
}

type CodexThreadItem =
  | {
      type: 'agentMessage'
      id: string
      text: string
      phase?: 'commentary' | 'final_answer' | null
    }
  | {
      type: 'reasoning'
      id: string
      summary?: string[]
      content?: string[]
    }
  | {
      type: 'commandExecution'
      id: string
      command: string
      cwd: string
      aggregatedOutput?: string | null
      exitCode?: number | null
      status: 'inProgress' | 'completed' | 'failed' | 'declined'
    }
  | {
      type: 'fileChange'
      id: string
      status: 'success' | 'failed' | 'declined' | 'pending'
      changes?: unknown[]
    }
  | {
      type: string
      id: string
      [key: string]: unknown
    }

type TurnCompletedParams = {
  threadId: string
  turn: {
    id: string
    status: 'completed' | 'interrupted' | 'failed' | 'inProgress'
    error?: {
      message?: string
      details?: string
      [key: string]: unknown
    } | null
    /** Codex CLI Turn 的 token 计数（turn/completed 通知携带）。 */
    token_count?: {
      input_tokens?: number
      output_tokens?: number
      reasoning_tokens?: number
    }
  }
}

type TurnStartedParams = {
  threadId: string
  turn: {
    id: string
  }
}

type ItemLifecycleParams = {
  item: CodexThreadItem
  threadId: string
  turnId: string
}

type AgentMessageDeltaParams = {
  threadId: string
  turnId: string
  itemId: string
  delta: string
}

type ReasoningDeltaParams = {
  threadId: string
  turnId: string
  itemId: string
  delta: string
  contentIndex?: number
  summaryIndex?: number
}

type ApprovalRequestParams = {
  itemId: string
  reason?: string | null
  command?: string | null
}

type ToolRequestUserInputParams = {
  itemId: string
  questions?: Array<{
    header?: string
    question?: string
  }>
}

type ThreadStartResponse = {
  thread: {
    id: string
  }
  model: string
}

type CodexRpcTransport = {
  pid?: number
  stderrBuffer: () => string
  send: (payload: unknown) => void
  shutdown: () => void
  close: () => void
  onLine: (handler: (line: string) => void) => void
  onStderrLine: (handler: (line: string) => void) => void
  onError: (handler: (error: Error) => void) => void
  onClose: (handler: (code: number | null) => void) => void
}

export const resolveCodexSandbox = (
  settings: CodexAgentSettings | undefined,
) => settings?.sandbox ?? 'workspace-write'

const buildThreadStartParams = (
  cwd: string,
  model: string | undefined,
  settings: CodexAgentSettings | undefined,
) => {
  const config: Record<string, string> = {}
  if (settings?.reasoningEffort) {
    config.model_reasoning_effort = settings.reasoningEffort
  }
  if (settings?.reasoningSummary) {
    config.model_reasoning_summary = settings.reasoningSummary
  }

  return {
    model: model ?? null,
    cwd,
    approvalPolicy: settings?.approval ?? 'never',
    sandbox: resolveCodexSandbox(settings),
    config: Object.keys(config).length > 0 ? config : null,
    experimentalRawEvents: false,
    persistExtendedHistory: true,
  }
}

const buildThreadResumeParams = (
  cwd: string,
  threadId: string,
  model: string | undefined,
  settings: CodexAgentSettings | undefined,
) => {
  const config: Record<string, string> = {}
  if (settings?.reasoningEffort) {
    config.model_reasoning_effort = settings.reasoningEffort
  }
  if (settings?.reasoningSummary) {
    config.model_reasoning_summary = settings.reasoningSummary
  }

  return {
    threadId,
    cwd,
    model: model ?? null,
    approvalPolicy: settings?.approval ?? 'never',
    sandbox: resolveCodexSandbox(settings),
    config: Object.keys(config).length > 0 ? config : null,
    persistExtendedHistory: true,
  }
}

export const buildCodexCollaborationMode = (model: string) => ({
  mode: 'default' as const,
  settings: {
    model,
    reasoning_effort: null,
    developer_instructions: null,
  },
})

const buildPermissionDecision = (approval: CodexApprovalMode | undefined) => {
  if (approval === 'never') {
    return {
      command: 'acceptForSession' as const,
      fileChange: 'acceptForSession' as const,
    }
  }

  return {
    command: 'decline' as const,
    fileChange: 'decline' as const,
  }
}

const shouldRetryCodexResume = (error: unknown) => {
  const message = error instanceof Error ? error.message.trim().toLowerCase() : ''
  if (!message) {
    return false
  }

  return message.includes('no rollout found for thread id')
    || message.includes('no thread found for id')
    || (message.includes('thread/resume') && message.includes('not found'))
}

const GENERIC_CODEX_ERROR_MESSAGES = new Set([
  'codex 执行失败',
  'codex execution failed',
  'execution failed',
  'request failed',
  'unknown error',
])

const normalizeCodexErrorText = (value: string) => {
  return value
    .split('\n')
    .map((line) => line.trimEnd())
    .join('\n')
    .trim()
}

const isSpecificCodexErrorMessage = (value: string) => {
  const normalized = normalizeCodexErrorText(value)
  if (!normalized) {
    return false
  }

  return !GENERIC_CODEX_ERROR_MESSAGES.has(normalized.toLowerCase())
}

const logWorkerCodexDebug = (stage: string, payload: Record<string, unknown>) => {
  console.log('[worker-codex]', stage, JSON.stringify(payload))
}

const CODEX_E2BIG_FRIENDLY_MESSAGE = 'Codex 启动失败：当前会话挂载的 Skills、MCP 或环境变量过多，超过了系统启动限制。请减少重复 Skills、关闭一部分 MCP，或精简环境变量后重试。'

const summarizeCodexValue = (value: unknown): unknown => {
  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: value.stack?.split('\n').slice(0, 5).join('\n') || '',
    }
  }

  if (value == null) {
    return value
  }

  if (typeof value === 'string') {
    return value.slice(0, 240)
  }

  if (Array.isArray(value)) {
    return {
      type: 'array',
      length: value.length,
    }
  }

  if (typeof value !== 'object') {
    return value
  }

  const result: Record<string, unknown> = {}
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === 'string') {
      result[key] = entry.slice(0, 240)
      continue
    }

    if (Array.isArray(entry)) {
      result[key] = {
        type: 'array',
        length: entry.length,
      }
      continue
    }

    if (entry && typeof entry === 'object') {
      result[key] = summarizeCodexValue(entry)
      continue
    }

    result[key] = entry
  }

  return result
}

const isSpawnE2bigError = (value: unknown) => {
  if (value instanceof Error) {
    const errorCode = 'code' in value && typeof value.code === 'string'
      ? value.code.trim().toUpperCase()
      : ''
    if (errorCode === 'E2BIG') {
      return true
    }
  }

  const message = value instanceof Error
    ? value.message
    : typeof value === 'string'
      ? value
      : ''
  const normalized = message.trim().toLowerCase()
  return normalized.includes('spawn e2big')
    || (normalized.includes('e2big') && normalized.includes('spawn'))
}

const normalizeCodexRuntimeErrorText = (value: string) => {
  return isSpawnE2bigError(value)
    ? CODEX_E2BIG_FRIENDLY_MESSAGE
    : value.trim()
}

export const extractCodexRuntimeErrorText = (value: unknown) => {
  if (isSpawnE2bigError(value)) {
    return CODEX_E2BIG_FRIENDLY_MESSAGE
  }

  return normalizeCodexRuntimeErrorText(
    extractCodexErrorMessage(value)
      || (value instanceof Error ? value.message.trim() : '')
      || '',
  )
}

const escapeTomlString = (value: string) => {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

const normalizeTomlSectionName = (value: string) => {
  return value
    .split('.')
    .map((segment) => segment.trim().replace(/^"(.*)"$/, '$1'))
    .join('.')
}

const buildTomlStringLine = (key: string, value: string) => {
  return `${key} = "${escapeTomlString(value)}"`
}

export const replaceCodexBaseUrlInConfig = (content: string, providerId: string, nextBaseUrl: string) => {
  if (!content.trim() || !providerId.trim() || !nextBaseUrl.trim()) {
    return { content, changed: false }
  }

  let currentSection = ''
  let changed = false
  const nextLines = content.split(/\r?\n/).map((rawLine) => {
    const trimmed = rawLine.trim()
    const sectionMatch = trimmed.match(/^\[([^\]]+)\]$/)
    if (sectionMatch) {
      currentSection = normalizeTomlSectionName(sectionMatch[1] ?? '')
      return rawLine
    }

    const keyMatch = rawLine.match(/^(\s*)([A-Za-z0-9_.-]+)(\s*=\s*)["']([^"']*)["'](\s*(?:#.*)?)$/)
    if (!keyMatch) {
      return rawLine
    }

    const [, indent, key, separator, , suffix] = keyMatch
    const inProviderSection = currentSection === `model_providers.${providerId}`
    const inRootSection = currentSection === ''
    if (!inProviderSection && !inRootSection) {
      return rawLine
    }

    if (key !== 'base_url' && key !== 'openai_base_url') {
      return rawLine
    }

    changed = true
    return `${indent}${key}${separator}"${escapeTomlString(nextBaseUrl)}"${suffix}`
  })

  return {
    content: changed ? nextLines.join('\n') : content,
    changed,
  }
}

export const rewriteCodexConfigForExecutionModel = (
  content: string,
  params: {
    executionModel?: string
    runtimeEnv?: Record<string, string>
  },
) => {
  const parsedExecutionModel = parseExecutionModelId(params.executionModel)
  const baseUrl = params.runtimeEnv?.OPENAI_BASE_URL?.trim() || ''
  const envKey = params.runtimeEnv?.OPENAI_API_KEY?.trim() ? 'OPENAI_API_KEY' : ''
  const resolvedRuntimeProvider = baseUrl || envKey
    ? resolveCodexProviderConfig({
        configContent: content,
        env: params.runtimeEnv,
      })
    : null
  const providerId = parsedExecutionModel?.providerId?.trim()
    || resolvedRuntimeProvider?.providerId?.trim()
    || ''
  const modelId = parsedExecutionModel?.modelId?.trim()
    || resolvedRuntimeProvider?.configuredModel?.trim()
    || ''

  if (!providerId && !modelId && !baseUrl && !envKey) {
    return { content, changed: false }
  }

  if (!content.trim()) {
    const nextLines: string[] = []
    if (modelId) {
      nextLines.push(buildTomlStringLine('model', modelId))
    }
    if (providerId) {
      nextLines.push(buildTomlStringLine('model_provider', providerId))
    }
    if (providerId && (baseUrl || envKey)) {
      if (nextLines.length > 0) {
        nextLines.push('')
      }
      nextLines.push(`[model_providers.${providerId}]`)
      nextLines.push(buildTomlStringLine('name', providerId))
      if (baseUrl) {
        nextLines.push(buildTomlStringLine('base_url', baseUrl))
      }
      if (envKey) {
        nextLines.push(buildTomlStringLine('env_key', envKey))
      }
    }

    const nextContent = nextLines.join('\n')
    return {
      content: nextContent || content,
      changed: Boolean(nextContent),
    }
  }

  const targetProviderSection = providerId ? `model_providers.${providerId}` : ''
  const output: string[] = []
  let currentSection = ''
  let changed = false
  let insertedRoot = false
  let sawRootModel = false
  let sawRootProvider = false
  let sawTargetProviderSection = false
  let targetProviderSectionOpen = false
  let sawTargetProviderBaseUrl = false
  let sawTargetProviderEnvKey = false

  const flushRootInsertions = () => {
    if (insertedRoot) {
      return
    }

    const insertedLines: string[] = []
    if (modelId && !sawRootModel) {
      insertedLines.push(buildTomlStringLine('model', modelId))
    }
    if (providerId && !sawRootProvider) {
      insertedLines.push(buildTomlStringLine('model_provider', providerId))
    }

    if (insertedLines.length > 0) {
      if (output.length > 0 && output[output.length - 1]?.trim()) {
        output.push('')
      }
      output.push(...insertedLines)
      changed = true
    }

    insertedRoot = true
  }

  const flushTargetProviderInsertions = () => {
    if (!targetProviderSectionOpen) {
      return
    }

    const insertedLines: string[] = []
    if (baseUrl && !sawTargetProviderBaseUrl) {
      insertedLines.push(buildTomlStringLine('base_url', baseUrl))
    }
    if (envKey && !sawTargetProviderEnvKey) {
      insertedLines.push(buildTomlStringLine('env_key', envKey))
    }
    if (!sawTargetProviderSection && providerId) {
      insertedLines.unshift(buildTomlStringLine('name', providerId))
    }

    if (insertedLines.length > 0) {
      output.push(...insertedLines)
      changed = true
    }

    targetProviderSectionOpen = false
  }

  for (const rawLine of content.split(/\r?\n/)) {
    const trimmed = rawLine.trim()
    const sectionMatch = trimmed.match(/^\[([^\]]+)\]$/)
    if (sectionMatch) {
      flushTargetProviderInsertions()
      flushRootInsertions()
      currentSection = normalizeTomlSectionName(sectionMatch[1] ?? '')
      if (currentSection === targetProviderSection) {
        sawTargetProviderSection = true
        targetProviderSectionOpen = true
        sawTargetProviderBaseUrl = false
        sawTargetProviderEnvKey = false
      }
      output.push(rawLine)
      continue
    }

    const keyMatch = rawLine.match(/^(\s*)([A-Za-z0-9_.-]+)(\s*=\s*)["']([^"']*)["'](\s*(?:#.*)?)$/)
    if (!keyMatch) {
      output.push(rawLine)
      continue
    }

    const [, indent, key, separator, currentValue, suffix] = keyMatch
    const inRootSection = currentSection === ''
    const inTargetProviderSection = currentSection === targetProviderSection

    if (inRootSection && key === 'model' && modelId) {
      sawRootModel = true
      if (currentValue !== modelId) {
        output.push(`${indent}${key}${separator}"${escapeTomlString(modelId)}"${suffix}`)
        changed = true
      } else {
        output.push(rawLine)
      }
      continue
    }

    if (inRootSection && key === 'model_provider' && providerId) {
      sawRootProvider = true
      if (currentValue !== providerId) {
        output.push(`${indent}${key}${separator}"${escapeTomlString(providerId)}"${suffix}`)
        changed = true
      } else {
        output.push(rawLine)
      }
      continue
    }

    if (inTargetProviderSection && key === 'base_url' && baseUrl) {
      sawTargetProviderBaseUrl = true
      if (currentValue !== baseUrl) {
        output.push(`${indent}${key}${separator}"${escapeTomlString(baseUrl)}"${suffix}`)
        changed = true
      } else {
        output.push(rawLine)
      }
      continue
    }

    if (inTargetProviderSection && key === 'env_key' && envKey) {
      sawTargetProviderEnvKey = true
      if (currentValue !== envKey) {
        output.push(`${indent}${key}${separator}"${escapeTomlString(envKey)}"${suffix}`)
        changed = true
      } else {
        output.push(rawLine)
      }
      continue
    }

    output.push(rawLine)
  }

  flushTargetProviderInsertions()
  flushRootInsertions()

  if (targetProviderSection && !sawTargetProviderSection && (baseUrl || envKey)) {
    if (output.length > 0 && output[output.length - 1]?.trim()) {
      output.push('')
    }
    output.push(`[model_providers.${providerId}]`)
    output.push(buildTomlStringLine('name', providerId))
    if (baseUrl) {
      output.push(buildTomlStringLine('base_url', baseUrl))
    }
    if (envKey) {
      output.push(buildTomlStringLine('env_key', envKey))
    }
    changed = true
  }

  return {
    content: changed ? output.join('\n') : content,
    changed,
  }
}

const shouldUseCodexCompatibilityProxy = (baseUrl: string) => {
  const normalized = baseUrl.trim()
  if (!/^https?:\/\//i.test(normalized)) {
    return false
  }

  return !/^https?:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?(?:\/|$)/i.test(normalized)
}

const readNodeRequestBody = async (request: http.IncomingMessage) => {
  const chunks: Buffer[] = []
  for await (const chunk of request) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk)
  }

  if (chunks.length === 0) {
    return undefined
  }

  return Buffer.concat(chunks)
}

const pipeFetchResponseBody = async (upstreamResponse: Response, response: http.ServerResponse) => {
  if (!upstreamResponse.body) {
    response.end()
    return
  }

  const reader = upstreamResponse.body.getReader()
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) {
        break
      }

      if (!value || value.byteLength === 0) {
        continue
      }

      if (!response.write(Buffer.from(value))) {
        await once(response, 'drain')
      }
    }

    response.end()
  } finally {
    reader.releaseLock()
  }
}

const startCodexCompatibilityProxy = async (targetBaseUrl: string) => {
  const upstreamBaseUrl = targetBaseUrl.trim().replace(/\/+$/, '')
  const upstreamBase = new URL(`${upstreamBaseUrl}/`)
  const server = http.createServer(async (request, response) => {
    try {
      const targetUrl = new URL(request.url || '/', upstreamBase)
      const headers = new Headers()
      for (const [key, value] of Object.entries(request.headers)) {
        if (!value || key.toLowerCase() === 'host' || key.toLowerCase() === 'connection') {
          continue
        }

        headers.set(key, Array.isArray(value) ? value.join(', ') : value)
      }

      const requestBody = request.method === 'GET' || request.method === 'HEAD'
        ? undefined
        : await readNodeRequestBody(request)
      const upstreamResponse = await fetch(targetUrl, {
        method: request.method,
        headers,
        body: requestBody,
        redirect: 'manual',
      })

      response.statusCode = upstreamResponse.status
      response.statusMessage = upstreamResponse.statusText
      upstreamResponse.headers.forEach((value, key) => {
        if (key.toLowerCase() === 'connection' || key.toLowerCase() === 'transfer-encoding') {
          return
        }

        response.setHeader(key, value)
      })

      if (!upstreamResponse.body) {
        response.end()
        return
      }

      await pipeFetchResponseBody(upstreamResponse, response)
    } catch (error) {
      logWorkerCodexDebug('compatibility-proxy:error', {
        targetBaseUrl: upstreamBaseUrl,
        requestUrl: request.url || '/',
        error: error instanceof Error ? error.message : 'Codex compatibility proxy failed.',
      })

      if (response.headersSent) {
        response.destroy(error instanceof Error ? error : new Error('Codex compatibility proxy failed.'))
        return
      }

      response.statusCode = 502
      response.setHeader('Content-Type', 'text/plain; charset=utf-8')
      response.end(error instanceof Error ? error.message : 'Codex compatibility proxy failed.')
    }
  })

  const address = await new Promise<AddressInfo>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const value = server.address()
      if (!value || typeof value === 'string') {
        reject(new Error('Failed to allocate Codex compatibility proxy port.'))
        return
      }

      resolve(value)
    })
  })

  let closed = false
  return {
    proxiedBaseUrl: `http://127.0.0.1:${address.port}${upstreamBase.pathname.replace(/\/$/, '')}`,
    close: () => {
      if (closed) {
        return
      }

      closed = true
      server.close()
    },
  }
}

const prepareCodexCompatibilityProxy = async (params: {
  executionModel?: string
  runtimeEnv?: Record<string, string>
}) => {
  const codexHome = params.runtimeEnv?.CODEX_HOME?.trim()
  if (!codexHome) {
    logWorkerCodexDebug('launch-config:skipped', {
      reason: 'missing-codex-home',
    })
    return null
  }

  const configPath = path.join(codexHome, 'config.toml')
  const authPath = path.join(codexHome, 'auth.json')
  let configContent = ''
  try {
    configContent = readFileSync(configPath, 'utf8')
  } catch {
    logWorkerCodexDebug('launch-config:skipped', {
      reason: 'config-unreadable',
      configPath,
    })
    return null
  }

  const authContent = (() => {
    try {
      return readFileSync(authPath, 'utf8')
    } catch {
      return ''
    }
  })()

  let nextConfigContent = configContent
  const launchRewrite = rewriteCodexConfigForExecutionModel(configContent, {
    executionModel: params.executionModel,
    runtimeEnv: params.runtimeEnv,
  })
  if (launchRewrite.changed) {
    nextConfigContent = launchRewrite.content
    logWorkerCodexDebug('launch-config:enabled', {
      executionModel: params.executionModel || 'default',
      baseUrlOverride: params.runtimeEnv?.OPENAI_BASE_URL || '',
    })
  }

  const resolvedExecutionProvider = resolveCodexProviderConfig({
    configContent: nextConfigContent,
    authContent,
    env: params.runtimeEnv,
  })
  const resolvedExecutionProviderId = parseExecutionModelId(params.executionModel)?.providerId
    || resolvedExecutionProvider.providerId
  const namedConfig = ensureCodexProviderNameInConfig(nextConfigContent, resolvedExecutionProviderId)
  if (namedConfig.changed) {
    nextConfigContent = namedConfig.content
    logWorkerCodexDebug('launch-config:provider-name-added', {
      providerId: resolvedExecutionProviderId,
    })
  }

  const envKeyConfig = ensureCodexProviderEnvKeyInConfig(
    nextConfigContent,
    resolvedExecutionProviderId,
    resolvedExecutionProvider.envKey,
  )
  if (envKeyConfig.changed) {
    nextConfigContent = envKeyConfig.content
    logWorkerCodexDebug('launch-config:provider-env-key-added', {
      providerId: resolvedExecutionProviderId,
      envKey: resolvedExecutionProvider.envKey,
    })
  }

  const provider = resolveCodexProviderConfig({
    configContent: nextConfigContent,
    authContent,
    env: params.runtimeEnv,
  })

  logWorkerCodexDebug('launch-config:resolved', {
    providerId: provider.providerId,
    configuredModel: provider.configuredModel || '',
    baseUrl: provider.baseUrl || '',
    envKey: provider.envKey,
    hasApiToken: Boolean(provider.apiToken),
  })

  let proxy: Awaited<ReturnType<typeof startCodexCompatibilityProxy>> | null = null
  try {
    if (provider.baseUrl && shouldUseCodexCompatibilityProxy(provider.baseUrl)) {
      proxy = await startCodexCompatibilityProxy(provider.baseUrl)
      const rewritten = replaceCodexBaseUrlInConfig(nextConfigContent, provider.providerId, proxy.proxiedBaseUrl)
      if (!rewritten.changed) {
        logWorkerCodexDebug('compatibility-proxy:skipped', {
          providerId: provider.providerId,
          upstreamBaseUrl: provider.baseUrl,
          reason: 'config did not contain a rewritable base_url entry',
        })
        proxy.close()
        proxy = null
      } else {
        nextConfigContent = rewritten.content
        logWorkerCodexDebug('compatibility-proxy:enabled', {
          providerId: provider.providerId,
          upstreamBaseUrl: provider.baseUrl,
          proxiedBaseUrl: proxy.proxiedBaseUrl,
        })
      }
    }

    if (nextConfigContent === configContent) {
      return null
    }

    writeFileSync(configPath, nextConfigContent, 'utf8')

    let closed = false
    return {
      close: () => {
        if (closed) {
          return
        }

        closed = true
        try {
          writeFileSync(configPath, configContent, 'utf8')
        } finally {
          proxy?.close()
        }
      },
    }
  } catch (error) {
    proxy?.close()
    throw error
  }
}

const resolveCodexLaunchProvider = (runtimeEnv?: Record<string, string>) => {
  const codexHome = runtimeEnv?.CODEX_HOME?.trim()
  const configPath = codexHome ? path.join(codexHome, 'config.toml') : ''
  const authPath = codexHome ? path.join(codexHome, 'auth.json') : ''
  const configContent = (() => {
    if (!configPath) {
      return ''
    }

    try {
      return readFileSync(configPath, 'utf8')
    } catch {
      return ''
    }
  })()
  const authContent = (() => {
    if (!authPath) {
      return ''
    }

    try {
      return readFileSync(authPath, 'utf8')
    } catch {
      return ''
    }
  })()

  return resolveCodexProviderConfig({
    configContent,
    authContent,
    env: runtimeEnv,
  })
}

export const isTransientCodexStatusMessage = (value: string) => {
  const normalized = normalizeCodexErrorText(value)
  if (!normalized) {
    return false
  }

  return /^reconnecting\.\.\.\s*\d+\/\d+$/i.test(normalized)
}

const TRANSIENT_CODEX_STREAM_CLOSE_PATTERNS = [
  'stream disconnected before completion',
  'stream closed before response.completed',
  'websocket stream closed before response.completed',
]

export const isTransientCodexRetryableMessage = (value: string) => {
  const normalized = normalizeCodexErrorText(value)
  if (!normalized) {
    return false
  }

  const lowerCased = normalized.toLowerCase()
  return isTransientCodexStatusMessage(normalized)
    || TRANSIENT_CODEX_STREAM_CLOSE_PATTERNS.some((pattern) => lowerCased.includes(pattern))
}

const buildCodexRetryStatusMessage = (value: string) => {
  const normalized = normalizeCodexErrorText(value)
  if (!normalized) {
    return 'Codex 正在重试'
  }

  if (isTransientCodexStatusMessage(normalized)) {
    return normalized
  }

  if (isTransientCodexRetryableMessage(normalized)) {
    return '连接短暂中断，Codex 正在重试'
  }

  const firstLine = normalized.split('\n').map((line) => line.trim()).find(Boolean) || normalized
  return `Codex 正在重试：${firstLine}`
}

const collectCodexErrorMessages = (value: unknown, seen = new Set<unknown>()): string[] => {
  if (typeof value === 'string') {
    const normalized = normalizeCodexErrorText(value)
    if (!normalized) {
      return []
    }

    try {
      const nestedMessages = collectCodexErrorMessages(JSON.parse(normalized), seen)
      return nestedMessages.length > 0 ? nestedMessages : [normalized]
    } catch {
      return [normalized]
    }
  }

  if (!value || typeof value !== 'object') {
    return []
  }

  if (seen.has(value)) {
    return []
  }
  seen.add(value)

  if (Array.isArray(value)) {
    return value.flatMap((item) => collectCodexErrorMessages(item, seen))
  }

  return Object.values(value).flatMap((item) => collectCodexErrorMessages(item, seen))
}

const pickPreferredCodexErrorMessage = (candidates: string[]) => {
  const specificMessages = candidates.filter(isSpecificCodexErrorMessage)
  const stableSpecificMessage = specificMessages.find((candidate) => !isTransientCodexRetryableMessage(candidate))
  if (stableSpecificMessage) {
    return stableSpecificMessage
  }

  if (specificMessages[0]) {
    return specificMessages[0]
  }

  return candidates.find(Boolean) || ''
}

export const extractCodexErrorMessage = (value: unknown) => {
  return pickPreferredCodexErrorMessage(collectCodexErrorMessages(value))
}

export const extractCodexTurnUsage = (turn: TurnCompletedParams['turn'] | undefined): ModelTokenUsage | undefined => {
  const tokenCount = turn?.token_count
  if (!tokenCount) {
    return undefined
  }

  const inputTokens = normalizeUsageCount(tokenCount.input_tokens)
  const outputTokens = normalizeUsageCount(tokenCount.output_tokens)
  const reasoningTokens = normalizeUsageCount(tokenCount.reasoning_tokens)
  if (inputTokens <= 0 && outputTokens <= 0 && reasoningTokens <= 0) {
    return undefined
  }

  return {
    inputTokens,
    outputTokens,
    reasoningTokens: reasoningTokens > 0 ? reasoningTokens : undefined,
    cacheReadTokens: undefined,
    cacheWriteTokens: undefined,
    /** Codex 无 cache 上报，真实消耗口径：input + output + reasoning。 */
    totalTokens: inputTokens + outputTokens + reasoningTokens,
  }
}

const normalizeUsageCount = (value: number | undefined) => {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.round(value) : 0
}

export const extractTurnError = (turn: TurnCompletedParams['turn']) => {
  const candidates = [
    ...(turn.error?.details ? collectCodexErrorMessages(turn.error.details) : []),
    ...(turn.error?.message ? collectCodexErrorMessages(turn.error.message) : []),
    ...collectCodexErrorMessages(turn.error),
  ]

  return pickPreferredCodexErrorMessage(candidates) || (turn.status === 'failed' ? 'Codex 执行失败' : '')
}

export const pickCodexProcessErrorMessage = (primaryMessage: string, stderrBuffer: string, exitCode: number | null) => {
  const normalizedPrimaryMessage = normalizeCodexErrorText(primaryMessage)
  const stderrLines = stderrBuffer
    .trim()
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
  const stderrCandidates = [
    ...[...stderrLines].reverse().flatMap((line) => collectCodexErrorMessages(line)),
    ...collectCodexErrorMessages(stderrBuffer),
  ]
  const stderrMessage = pickPreferredCodexErrorMessage(stderrCandidates)

  if (stderrMessage && !isSpecificCodexErrorMessage(normalizedPrimaryMessage)) {
    return normalizeCodexRuntimeErrorText(stderrMessage)
  }

  if (normalizedPrimaryMessage && !isTransientCodexRetryableMessage(normalizedPrimaryMessage)) {
    return normalizeCodexRuntimeErrorText(normalizedPrimaryMessage)
  }

  if (stderrMessage && !isTransientCodexRetryableMessage(stderrMessage)) {
    return normalizeCodexRuntimeErrorText(stderrMessage)
  }

  if (normalizedPrimaryMessage || stderrMessage) {
    return 'Codex 连接短暂中断，但进程已退出且未收到完成事件。请重试本轮工作区对话。'
  }

  return `Codex 执行失败（退出码 ${exitCode ?? -1}）`
}

const emitAssistantMessage = (
  params: WorkerAgentPromptParams,
  messageId: string,
  text: string,
  delta?: string,
) => {
  emitAgentEvent(params.agentType, params.onEvent, {
    type: 'message.updated',
    properties: {
      info: {
        id: messageId,
        role: 'assistant',
      },
    },
  })
  emitAgentEvent(params.agentType, params.onEvent, {
    type: 'message.part.updated',
    properties: {
      part: {
        id: `${messageId}:text`,
        messageID: messageId,
        type: 'text',
        text,
      },
      delta,
    },
  })
}

const emitReasoning = (
  params: WorkerAgentPromptParams,
  assistantMessageId: string,
  partId: string,
  text: string,
  delta?: string,
) => {
  emitAgentEvent(params.agentType, params.onEvent, {
    type: 'message.part.updated',
    properties: {
      part: {
        id: partId,
        messageID: assistantMessageId,
        type: 'reasoning',
        text,
      },
      delta,
    },
  })
}

const emitPendingInteraction = (
  params: WorkerAgentPromptParams,
  interaction: {
    id: string
    type: 'question' | 'approval' | 'permission'
    title: string
    prompt?: string
    toolName?: string
  },
) => {
  emitAgentEvent(params.agentType, params.onEvent, {
    type: 'interaction.pending',
    properties: {
      interaction: {
        ...interaction,
        status: 'pending',
        provider: params.agentType,
      },
    },
  })
}

const emitToolPart = (
  params: WorkerAgentPromptParams,
  assistantMessageId: string | undefined,
  item: CodexThreadItem,
  status: 'pending' | 'running' | 'completed' | 'error',
  output?: string,
  error?: string,
) => {
  const tool = item.type === 'fileChange' ? 'apply_patch' : 'shell'
  const raw = item.type === 'commandExecution'
    ? item.command
    : item.type === 'fileChange'
      ? JSON.stringify(item.changes ?? [], null, 2)
      : undefined
  emitAgentEvent(params.agentType, params.onEvent, {
    type: 'message.part.updated',
    properties: {
      part: {
        id: item.id,
        messageID: assistantMessageId,
        type: 'tool',
        tool,
        state: {
          status,
          raw,
          output,
          error,
        },
      },
    },
  })
}

const sendJsonLine = (child: ChildProcessWithoutNullStreams, payload: unknown) => {
  child.stdin.write(`${JSON.stringify(payload)}\n`)
}

const createStdioCodexTransport = (params: {
  executable: string
  cwd: string
  runtimeEnv: Record<string, string>
  runtimeArgs?: string[]
  subcommand?: CodexProtocolSubcommand
}): CodexRpcTransport => {
  const child = spawn(
    params.executable,
    buildCodexProtocolArgs(params.subcommand ?? resolveCodexProtocolCandidates(params.executable)[0], params.runtimeArgs),
    {
    cwd: params.cwd,
    env: params.runtimeEnv,
    stdio: ['pipe', 'pipe', 'pipe'] as const,
    shell: shouldSpawnWithShellOnWindows(params.executable),
    },
  )
  let stdoutBuffer = ''
  let stderrBuffer = ''

  return {
    pid: child.pid ?? undefined,
    stderrBuffer: () => stderrBuffer,
    send: (payload) => sendJsonLine(child, payload),
    shutdown: () => {
      if (!child.killed) {
        child.kill('SIGTERM')
      }
    },
    close: () => {
      if (!child.killed) {
        child.kill('SIGTERM')
      }
    },
    onLine: (handler) => {
      child.stdout.on('data', (chunk: Buffer | string) => {
        stdoutBuffer += chunk.toString()
        const lines = stdoutBuffer.split('\n')
        stdoutBuffer = lines.pop() ?? ''
        for (const line of lines) {
          handler(line)
        }
      })
      child.on('close', () => {
        if (stdoutBuffer.trim()) {
          handler(stdoutBuffer)
          stdoutBuffer = ''
        }
      })
    },
    onStderrLine: (handler) => {
      child.stderr.on('data', (chunk: Buffer | string) => {
        const text = chunk.toString()
        stderrBuffer += text
        for (const line of text.split('\n').map((entry) => entry.trim()).filter(Boolean)) {
          handler(line)
        }
      })
    },
    onError: (handler) => {
      child.on('error', handler)
    },
    onClose: (handler) => {
      child.on('close', handler)
    },
  }
}

const createCodexTransport = async (params: {
  executable: string
  cwd: string
  runtimeEnv: Record<string, string>
  runtimeArgs?: string[]
  signal?: AbortSignal
  subcommand?: CodexProtocolSubcommand
}) => {
  return createStdioCodexTransport(params)
}

const shouldRetryCodexWithAlternateProtocol = (error: unknown) => {
  const message = error instanceof Error ? error.message.trim().toLowerCase() : ''
  if (!message) {
    return false
  }

  return message.includes('initialize 在')
    || message.includes('codex 启动超时：initialize')
    || message.includes('codex app-server 请求失败')
    || message.includes('method not found')
    || message.includes('unrecognized subcommand')
    || message.includes('unknown subcommand')
    || message.includes('unexpected token')
    || message.includes('invalid request')
}

export const shouldRetryCodexWithAlternateProtocolForTest = shouldRetryCodexWithAlternateProtocol

const runCodexPromptWithTransport = async (
  params: WorkerAgentPromptParams,
  options?: { subcommand?: CodexProtocolSubcommand },
): Promise<WorkerAgentPromptResult> => {
  const executable = resolveExecutable('codex')
  if (!executable) {
    throw new Error('未检测到 `codex` 可执行文件。')
  }

  const codexSettings = params.agentSettings && 'sandbox' in params.agentSettings ? params.agentSettings : undefined
  const requestedProviderId = parseExecutionModelId(params.executionModel)?.providerId || 'openai'
  const defaultProviderId = parseExecutionModelId(codexSettings?.defaultModel)?.providerId || 'openai'
  const selectedModel = normalizeExecutionModel(
    toNativeRuntimeModelId('Codex', requestedProviderId, params.executionModel),
  ) ?? normalizeExecutionModel(
    toNativeRuntimeModelId('Codex', defaultProviderId, codexSettings?.defaultModel),
  )
  const approvalDecision = buildPermissionDecision(codexSettings?.approval)
  const launchExecutionModel = params.executionModel?.trim() || codexSettings?.defaultModel?.trim() || ''
  const compatibilityProxy = await prepareCodexCompatibilityProxy({
    executionModel: launchExecutionModel,
    runtimeEnv: params.runtimeEnv,
  })
  const runtimeEnv: Record<string, string> = {
    ...buildAgentRuntimeEnvironment(),
    ...(params.runtimeEnv ?? {}),
  }
  const launchProvider = resolveCodexLaunchProvider(runtimeEnv)

  logWorkerCodexDebug('launch:spawn', {
    cwd: params.cwd,
    executionModel: launchExecutionModel || 'default',
    transportSubcommand: options?.subcommand || resolveCodexProtocolCandidates(executable)[0],
    selectedModel: selectedModel || '',
    requestedProviderId,
    defaultProviderId,
    codexHomePresent: Boolean(runtimeEnv.CODEX_HOME?.trim()),
    runtimeArgCount: (params.runtimeArgs ?? []).length,
    runtimeEnvKeys: Object.keys(params.runtimeEnv ?? {})
      .filter((key) => key.startsWith('OPENAI_') || key.startsWith('CODEX_') || key.startsWith('WEMUX_CODEX_'))
      .sort(),
    runtimeHasOpenAiApiKey: Boolean(runtimeEnv.OPENAI_API_KEY?.trim()),
    runtimeOpenAiBaseUrl: runtimeEnv.OPENAI_BASE_URL || '',
    runtimeProviderId: launchProvider.providerId,
    runtimeProviderEnvKey: launchProvider.envKey,
    runtimeHasProviderApiToken: Boolean(launchProvider.apiToken),
    compatibilityProxyEnabled: Boolean(compatibilityProxy),
    transport: 'stdio',
  })

  let transport: Awaited<ReturnType<typeof createCodexTransport>>
  try {
    transport = await createCodexTransport({
      executable,
      cwd: params.cwd,
      runtimeEnv,
      runtimeArgs: params.runtimeArgs,
      signal: params.signal,
      subcommand: options?.subcommand,
    })
  } catch (error) {
    compatibilityProxy?.close()
    throw error
  }

  return new Promise<WorkerAgentPromptResult>((resolve, reject) => {
    logWorkerCodexDebug('launch:child-started', {
      pid: transport.pid ?? null,
      transport: 'stdio',
    })

    let nextId = 1
    let sessionId = ''
    let finalOutput = ''
    let lastError = ''
    let completed = false
    let assistantMessageId = ''
    /** turn/completed 通知携带的 token 计数（Codex CLI proto）。 */
    let turnUsage: ModelTokenUsage | undefined
    const pending = new Map<JsonRpcId, {
      method: string
      resolve: (value: unknown) => void
      reject: (error: Error) => void
      timeout?: ReturnType<typeof setTimeout>
    }>()
    const messageState = new Map<string, string>()
    const reasoningState = new Map<string, string>()
    const startupRpcTimeoutMs = resolveCodexStartupRpcTimeoutMs()

    const cleanupPending = (error: Error) => {
      for (const entry of pending.values()) {
        if (entry.timeout) {
          clearTimeout(entry.timeout)
        }
        entry.reject(error)
      }
      pending.clear()
    }

    const request = <T>(method: string, reqParams?: unknown, options?: { timeoutMs?: number }) => {
      const id = nextId++
      logWorkerCodexDebug('rpc:request', {
        id,
        method,
        params: summarizeCodexValue(reqParams),
      })
      transport.send({
        jsonrpc: '2.0',
        id,
        method,
        params: reqParams,
      } satisfies JsonRpcRequest)
      return new Promise<T>((requestResolve, requestReject) => {
        const timeoutMs = options?.timeoutMs
        const timeout = timeoutMs
          ? setTimeout(() => {
              const resolver = pending.get(id)
              if (!resolver) {
                return
              }
              pending.delete(id)
              const error = createCodexRpcTimeoutError(method, timeoutMs)
              logWorkerCodexDebug('rpc:timeout', {
                id,
                method,
                timeoutMs,
              })
              resolver.reject(error)
            }, timeoutMs)
          : undefined

        pending.set(id, {
          method,
          resolve: (value) => requestResolve(value as T),
          reject: requestReject,
          timeout,
        })
      })
    }

    const respond = (id: JsonRpcId, result: unknown) => {
      logWorkerCodexDebug('rpc:response', {
        id,
        result: summarizeCodexValue(result),
      })
      transport.send({
        jsonrpc: '2.0',
        id,
        result,
      } satisfies JsonRpcResponse)
    }

    const shutdown = () => {
      transport.shutdown()
    }

    const handleAbort = () => {
      shutdown()
    }

    params.signal?.addEventListener('abort', handleAbort, { once: true })

    const handleServerRequest = (message: JsonRpcRequest) => {
      logWorkerCodexDebug('rpc:server-request', {
        id: message.id,
        method: message.method,
        params: summarizeCodexValue(message.params),
      })

      if (message.method === 'item/commandExecution/requestApproval') {
        const payload = (message.params ?? {}) as ApprovalRequestParams
        const title = payload.reason?.trim() || payload.command?.trim() || '命令执行权限'
        if (approvalDecision.command === 'decline') {
          emitPendingInteraction(params, {
            id: `codex-command:${message.id}`,
            type: 'permission',
            title,
            prompt: payload.command?.trim() || payload.reason?.trim() || undefined,
            toolName: 'commandExecution',
          })
          emitAgentEvent(params.agentType, params.onEvent, {
            type: 'permission.updated',
            properties: {
              title,
            },
          })
        }
        respond(message.id, { decision: approvalDecision.command })
        return
      }

      if (message.method === 'item/fileChange/requestApproval') {
        const payload = (message.params ?? {}) as ApprovalRequestParams
        const title = payload.reason?.trim() || '文件修改权限'
        if (approvalDecision.fileChange === 'decline') {
          emitPendingInteraction(params, {
            id: `codex-file:${message.id}`,
            type: 'permission',
            title,
            prompt: payload.reason?.trim() || undefined,
            toolName: 'fileChange',
          })
          emitAgentEvent(params.agentType, params.onEvent, {
            type: 'permission.updated',
            properties: {
              title,
            },
          })
        }
        respond(message.id, { decision: approvalDecision.fileChange })
        return
      }

      if (message.method === 'item/tool/requestUserInput') {
        const payload = (message.params ?? {}) as ToolRequestUserInputParams
        const firstQuestion = payload.questions?.[0]
        const title = firstQuestion?.header?.trim() || firstQuestion?.question?.trim() || '等待用户输入'
        emitPendingInteraction(params, {
          id: payload.itemId?.trim() || `codex-question:${message.id}`,
          type: 'question',
          title,
          prompt: firstQuestion?.question?.trim() || title,
          toolName: 'requestUserInput',
        })
        emitAgentEvent(params.agentType, params.onEvent, {
          type: 'permission.updated',
          properties: {
            title,
          },
        })
        respond(message.id, { answers: {} })
        return
      }

      const elicitationResponse = resolveCodexElicitationResponse(message.method, message.params)
      if (elicitationResponse) {
        // Read-only calls to the acting-user-scoped built-in server are safe to continue
        // headlessly. All other elicitations use the protocol's explicit decline shape.
        respond(message.id, elicitationResponse)
        return
      }

      respond(message.id, null)
    }

    const handleCodexItem = (item: CodexThreadItem, eventType: 'started' | 'completed') => {
      if (item.type === 'agentMessage') {
        const agentItem = item as Extract<CodexThreadItem, { type: 'agentMessage' }>
        assistantMessageId = agentItem.id
        messageState.set(agentItem.id, agentItem.text)
        if (agentItem.text.trim()) {
          finalOutput = agentItem.text.trim()
        }
        emitAssistantMessage(params, agentItem.id, agentItem.text)
        return
      }

      if (item.type === 'reasoning') {
        const reasoningItem = item as Extract<CodexThreadItem, { type: 'reasoning' }>
        const content = reasoningItem.summary?.join('') || reasoningItem.content?.join('') || ''
        if (content) {
          reasoningState.set(reasoningItem.id, content)
          emitReasoning(params, assistantMessageId || `${sessionId || 'codex'}:assistant`, `${reasoningItem.id}:reasoning`, content)
        }
        return
      }

      if (item.type === 'commandExecution') {
        const commandItem = item as Extract<CodexThreadItem, { type: 'commandExecution' }>
        const status = eventType === 'started'
          ? 'running'
          : commandItem.status === 'completed'
            ? 'completed'
            : 'error'
        emitToolPart(
          params,
          assistantMessageId || undefined,
          commandItem,
          status,
          commandItem.aggregatedOutput ?? undefined,
          commandItem.status === 'failed' || commandItem.status === 'declined'
            ? commandItem.aggregatedOutput || `命令失败（退出码 ${commandItem.exitCode ?? -1}）`
            : undefined,
        )
        return
      }

      if (item.type === 'fileChange') {
        const fileChangeItem = item as Extract<CodexThreadItem, { type: 'fileChange' }>
        const status = eventType === 'started'
          ? 'running'
          : fileChangeItem.status === 'success'
            ? 'completed'
            : 'error'
        emitToolPart(
          params,
          assistantMessageId || undefined,
          fileChangeItem,
          status,
          JSON.stringify(fileChangeItem.changes ?? [], null, 2),
          fileChangeItem.status === 'failed' || fileChangeItem.status === 'declined' ? '文件修改未完成' : undefined,
        )
      }
    }

    const handleNotification = async (message: JsonRpcNotification) => {
      if (message.method === 'thread/started') {
        const payload = message.params as { thread: { id: string } }
        sessionId = payload.thread.id
        logWorkerCodexDebug('notification:thread-started', {
          threadId: sessionId,
        })
        return
      }

      if (message.method === 'turn/started') {
        const payload = message.params as TurnStartedParams
        sessionId = sessionId || payload.threadId
        logWorkerCodexDebug('notification:turn-started', {
          threadId: payload.threadId,
          turnId: payload.turn.id,
        })
        emitAgentEvent(params.agentType, params.onEvent, {
          type: 'session.status',
          properties: {
            status: {
              type: 'busy',
              message: 'Codex 正在处理请求',
            },
          },
        })
        return
      }

      if (message.method === 'item/started') {
        handleCodexItem((message.params as ItemLifecycleParams).item, 'started')
        return
      }

      if (message.method === 'item/completed') {
        handleCodexItem((message.params as ItemLifecycleParams).item, 'completed')
        return
      }

      if (message.method === 'item/agentMessage/delta') {
        const payload = message.params as AgentMessageDeltaParams
        assistantMessageId = payload.itemId
        const nextText = `${messageState.get(payload.itemId) ?? ''}${payload.delta ?? ''}`
        messageState.set(payload.itemId, nextText)
        if (nextText.trim()) {
          finalOutput = nextText.trim()
        }
        emitAssistantMessage(params, payload.itemId, nextText, payload.delta)
        return
      }

      if (message.method === 'item/reasoning/textDelta' || message.method === 'item/reasoning/summaryTextDelta') {
        const payload = message.params as ReasoningDeltaParams
        const partSuffix = message.method === 'item/reasoning/textDelta'
          ? `content:${payload.contentIndex ?? 0}`
          : `summary:${payload.summaryIndex ?? 0}`
        const partId = `${payload.itemId}:reasoning:${partSuffix}`
        const nextText = `${reasoningState.get(partId) ?? ''}${payload.delta ?? ''}`
        reasoningState.set(partId, nextText)
        emitReasoning(params, assistantMessageId || `${sessionId || 'codex'}:assistant`, partId, nextText, payload.delta)
        return
      }

      if (message.method === 'turn/completed') {
        const payload = message.params as TurnCompletedParams
        sessionId = sessionId || payload.threadId
        completed = payload.turn.status === 'completed'
        turnUsage = extractCodexTurnUsage(payload.turn) || turnUsage
        logWorkerCodexDebug('notification:turn-completed', {
          threadId: payload.threadId,
          turnId: payload.turn.id,
          status: payload.turn.status,
          error: summarizeCodexValue(payload.turn.error ?? null),
          extractedError: payload.turn.status === 'failed' ? extractTurnError(payload.turn) || 'Codex 执行失败' : '',
        })
        if (payload.turn.status === 'failed') {
          lastError = extractTurnError(payload.turn) || 'Codex 执行失败'
          emitAgentEvent(params.agentType, params.onEvent, {
            type: 'session.error',
            properties: { error: lastError },
          })
        } else {
          emitAgentEvent(params.agentType, params.onEvent, {
            type: 'session.status',
            properties: {
              status: {
                type: 'idle',
                message: 'Codex 已完成',
              },
            },
          })
        }
        shutdown()
        return
      }

      if (message.method === 'error') {
        const notificationPayload = message.params as {
          error?: {
            message?: string
            additionalDetails?: string
            codexErrorInfo?: unknown
          }
          willRetry?: boolean
          threadId?: string
          turnId?: string
        }
        logWorkerCodexDebug('notification:error', {
          threadId: notificationPayload.threadId || '',
          turnId: notificationPayload.turnId || '',
          willRetry: Boolean(notificationPayload.willRetry),
          message: notificationPayload.error?.message || '',
          additionalDetails: notificationPayload.error?.additionalDetails || '',
          codexErrorInfo: summarizeCodexValue(notificationPayload.error?.codexErrorInfo ?? null),
        })
        const nextError = extractCodexErrorMessage(message.params) || 'Codex 执行失败'
        if (notificationPayload.willRetry || isTransientCodexRetryableMessage(nextError)) {
          emitAgentEvent(params.agentType, params.onEvent, {
            type: 'session.status',
            properties: {
              status: {
                type: 'retry',
                message: buildCodexRetryStatusMessage(nextError),
              },
            },
          })
          return
        }

        lastError = nextError
        emitAgentEvent(params.agentType, params.onEvent, {
          type: 'session.error',
          properties: { error: lastError },
        })
        shutdown()
      }
    }

    const handleLine = (line: string) => {
      const trimmed = line.trim()
      if (!trimmed) {
        return
      }

      const response = readJsonLine<JsonRpcResponse>(trimmed)
      if (!response) {
        logWorkerCodexDebug('stdout:non-json', {
          line: trimmed.slice(0, 240),
        })
        return
      }

      if (typeof response.id !== 'undefined' && (typeof response.result !== 'undefined' || typeof response.error !== 'undefined')) {
        const resolver = pending.get(response.id)
        if (!resolver) {
          logWorkerCodexDebug('rpc:orphaned-response', {
            id: response.id,
            hasResult: typeof response.result !== 'undefined',
            error: summarizeCodexValue(response.error ?? null),
          })
          return
        }
        pending.delete(response.id)
        if (resolver.timeout) {
          clearTimeout(resolver.timeout)
        }
        if (response.error) {
          logWorkerCodexDebug('rpc:error', {
            id: response.id,
            method: resolver.method,
            error: summarizeCodexValue(response.error),
          })
          resolver.reject(new Error(extractCodexErrorMessage(response.error) || 'Codex app-server 请求失败'))
          return
        }
        logWorkerCodexDebug('rpc:result', {
          id: response.id,
          method: resolver.method,
          result: summarizeCodexValue(response.result),
        })
        resolver.resolve(response.result)
        return
      }

      if (typeof response.id !== 'undefined' && typeof (response as JsonRpcRequest).method === 'string') {
        handleServerRequest(response as unknown as JsonRpcRequest)
        return
      }

      if (typeof (response as unknown as JsonRpcNotification).method === 'string') {
        void handleNotification(response as unknown as JsonRpcNotification)
      }
    }

    transport.onLine(handleLine)

    transport.onStderrLine((line) => {
      logWorkerCodexDebug('stderr', {
        line: line.slice(0, 320),
      })
    })

    transport.onError((error) => {
      compatibilityProxy?.close()
      transport.close()
      params.signal?.removeEventListener('abort', handleAbort)
      const friendlyError = new Error(extractCodexRuntimeErrorText(error) || 'Codex 执行失败')
      logWorkerCodexDebug('launch:child-error', {
        error: friendlyError.message,
      })
      cleanupPending(friendlyError)
      reject(friendlyError)
    })

    transport.onClose((code) => {
      compatibilityProxy?.close()
      params.signal?.removeEventListener('abort', handleAbort)

      if (params.signal?.aborted) {
        logWorkerCodexDebug('launch:close', {
          code,
          aborted: true,
          completed,
          lastError,
        })
        cleanupPending(toAbortError(params.signal))
        reject(toAbortError(params.signal))
        return
      }

      if (!completed || lastError) {
        const stderrBuffer = transport.stderrBuffer()
        const error = new Error(pickCodexProcessErrorMessage(lastError, stderrBuffer, code))
        logWorkerCodexDebug('launch:close', {
          code,
          aborted: false,
          completed,
          lastError,
          finalError: error.message,
          stderrTail: stderrBuffer.trim().split('\n').filter(Boolean).slice(-5),
        })
        cleanupPending(error)
        reject(error)
        return
      }

      logWorkerCodexDebug('launch:close', {
        code,
        aborted: false,
        completed,
        lastError,
        sessionId: sessionId || '',
        outputPreview: (finalOutput || 'Codex 未返回文本输出。').slice(0, 120),
      })
      cleanupPending(new Error('Codex 会话已结束'))
      resolve({
        ok: true,
        output: finalOutput || 'Codex 未返回文本输出。',
        sessionId: sessionId || undefined,
        usage: turnUsage,
      })
    })

    void (async () => {
      try {
        await request('initialize', {
          clientInfo: {
            name: 'wemux-worker',
            version: '0.1.1',
          },
          capabilities: {
            experimentalApi: true,
          },
        }, { timeoutMs: startupRpcTimeoutMs })

        transport.send({
          jsonrpc: '2.0',
          method: 'initialized',
        } satisfies JsonRpcNotification)

        const account = await request<{ account: unknown | null; requiresOpenaiAuth: boolean }>('account/read', {
          refreshToken: false,
        }, { timeoutMs: startupRpcTimeoutMs })
        const hasProviderCredential = Boolean(launchProvider.apiToken)
        logWorkerCodexDebug('launch:account-read', {
          hasAccount: Boolean(account.account),
          requiresOpenaiAuth: Boolean(account.requiresOpenaiAuth),
          providerId: launchProvider.providerId,
          providerEnvKey: launchProvider.envKey,
          hasProviderCredential,
        })

        if (account.requiresOpenaiAuth && !account.account) {
          if (!hasProviderCredential) {
            logWorkerCodexDebug('launch:account-decision', {
              ok: false,
              reason: 'openai-auth-required-without-provider-credential',
              providerId: launchProvider.providerId,
              providerEnvKey: launchProvider.envKey,
            })
            throw new Error('Codex 需要先登录后才能执行。')
          }

          logWorkerCodexDebug('launch:account-decision', {
            ok: true,
            reason: 'managed-provider-credentials-present',
            providerId: launchProvider.providerId,
            providerEnvKey: launchProvider.envKey,
          })
        } else {
          logWorkerCodexDebug('launch:account-decision', {
            ok: true,
            reason: account.account ? 'account-present' : 'provider-auth-not-required',
            providerId: launchProvider.providerId,
            providerEnvKey: launchProvider.envKey,
          })
        }

        const resumeSessionId = params.resumeSessionId?.trim()
        let thread: ThreadStartResponse
        if (resumeSessionId) {
          try {
            thread = await request<ThreadStartResponse>('thread/resume', buildThreadResumeParams(params.cwd, resumeSessionId, selectedModel, codexSettings), { timeoutMs: startupRpcTimeoutMs })
          } catch (error) {
            if (!shouldRetryCodexResume(error)) {
              throw error
            }

            thread = await request<ThreadStartResponse>('thread/start', buildThreadStartParams(params.cwd, selectedModel, codexSettings), { timeoutMs: startupRpcTimeoutMs })
          }
        } else {
          thread = await request<ThreadStartResponse>('thread/start', buildThreadStartParams(params.cwd, selectedModel, codexSettings), { timeoutMs: startupRpcTimeoutMs })
        }
        sessionId = thread.thread.id
        await request('turn/start', {
          threadId: sessionId,
          input: [
            {
              type: 'text',
              text: params.prompt,
              text_elements: [],
            },
          ],
          collaborationMode: buildCodexCollaborationMode(thread.model),
        }, { timeoutMs: startupRpcTimeoutMs })
      } catch (error) {
        lastError = extractCodexRuntimeErrorText(error) || 'Codex 初始化失败'
        logWorkerCodexDebug('launch:init-error', {
          error: lastError,
          raw: summarizeCodexValue(error),
        })
        emitAgentEvent(params.agentType, params.onEvent, {
          type: 'session.error',
          properties: { error: lastError },
        })
        shutdown()
      }
    })()
  })
}

export const runCodexPrompt = async (params: WorkerAgentPromptParams): Promise<WorkerAgentPromptResult> => {
  const executable = resolveExecutable('codex')
  if (!executable) {
    throw new Error('未检测到 `codex` 可执行文件。')
  }

  const [primarySubcommand, secondarySubcommand] = resolveCodexProtocolCandidates(executable)

  try {
    return await runCodexPromptWithTransport(params, {
      subcommand: primarySubcommand,
    })
  } catch (error) {
    if (!secondarySubcommand || !shouldRetryCodexWithAlternateProtocol(error)) {
      throw error
    }

    logWorkerCodexDebug('launch:retry-alternate-protocol', {
      fromSubcommand: primarySubcommand,
      toSubcommand: secondarySubcommand,
      reason: error instanceof Error ? error.message : String(error),
    })

    return runCodexPromptWithTransport(params, {
      subcommand: secondarySubcommand,
    })
  }
}
