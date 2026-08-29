/**
 * [INPUT]: OpenCode prompt requests, execution surface, runtime configuration, and MCP policies.
 * [OUTPUT]: Streamed OpenCode responses with surface-scoped permissions and resumable session ids.
 * [POS]: OpenCode prompt adapter used by worker task and Agent chat execution.
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */
import { existsSync } from 'node:fs'
import { createOpenCodeInactivityTracker } from '@shared/opencode-activity'
import { unwrapOpenCodeEvent } from '@shared/opencode-event'
import { buildOpencodeConfigWithMcp } from '@shared/mcp'
import type { McpServerPolicy } from '@shared/mcp'
import { parseOpencodeConfigContent } from '@shared/opencode-config'
import type { AgentRuntimeSettings, ModelTokenUsage, OpenCodeExecutionConfig } from '@shared/types'
import { getWorkerEffectiveOpencodeConfigContent, loadWorkerConfig } from '../../core/config'
import { toAbortError } from '../agent-runner-shared'
import type { WorkerAgentPromptParams, WorkerAgentPromptResult } from '../agent-runner-shared'
import { ensureOpencodeSession, getOpencodeClient } from './client'
import {
  applyOpenCodePartTextDelta,
  createOpenCodeSessionErrorEvent,
  extractOpencodeAssistantUsage,
  extractStreamingText,
  getAssistantEntriesForPrompt,
  getErrorFromMessageEntries,
  getErrorText,
  getMessageTextState,
  getOutputFromMessageEntries,
  hasSettledAssistantEntry,
  isOpenCodeMissingTextOutput,
  logWorkerOpencodeDebug,
  OPENCODE_MISSING_TEXT_OUTPUT_ERROR_MESSAGE,
  type OpenCodePromptEvent,
  parseExecutionModel,
  parseOpenCodePermissionPolicy,
  type PromptMessageInfo,
  type PromptPart,
  resolveOpenCodeAgentSettings,
  sleep,
  summarizeEntries,
  type PromptMessageEntry,
} from './shared'

const PROMPT_OUTPUT_POLL_INTERVAL_MS = 500
const PROMPT_OUTPUT_POLL_TIMEOUT_MS = 120_000
const PROMPT_OUTPUT_LOOKBACK_MS = 1_000
const OPENCODE_NO_ACTIVITY_TIMEOUT_ERROR_MESSAGE = `OpenCode 会话已启动，但在 ${PROMPT_OUTPUT_POLL_TIMEOUT_MS}ms 内没有返回事件或文本输出。`

type OpenCodeSessionStatus = {
  type?: string
  message?: string
}

const readSessionSnapshot = async (client: Awaited<ReturnType<typeof getOpencodeClient>>, cwd: string, sessionId: string) => {
  try {
    const messages = await client.session.messages({
      path: { id: sessionId },
      query: { directory: cwd, limit: 20 },
    })

    return summarizeEntries(Array.isArray(messages.data) ? messages.data as PromptMessageEntry[] : [])
  } catch (error) {
    return [{ snapshotError: getErrorText(error) }]
  }
}

const buildPromptConfigContent = (params: {
  baseConfigContent: string
  agent?: string
  permissionPolicy?: string
  variant?: string
  executionModel?: string
  provider?: OpenCodeExecutionConfig['provider']
}) => {
  const parsed = parseOpencodeConfigContent(params.baseConfigContent) as Record<string, unknown>
  const nextConfig: Record<string, unknown> = { ...parsed }
  const selectedAgent = params.agent?.trim() || undefined
  const permission = parseOpenCodePermissionPolicy(params.permissionPolicy)
  const variant = params.variant?.trim() || undefined
  const executionModel = params.executionModel?.trim() || undefined

  if (selectedAgent && typeof nextConfig.default_agent !== 'string') {
    nextConfig.default_agent = selectedAgent
  }

  if (executionModel) {
    nextConfig.model = executionModel
  }

  if (params.provider && typeof params.provider === 'object') {
    const existingProvider = nextConfig.provider && typeof nextConfig.provider === 'object' && !Array.isArray(nextConfig.provider)
      ? nextConfig.provider as Record<string, unknown>
      : {}
    nextConfig.provider = mergeOpenCodeProviderConfig(existingProvider, params.provider)
  }

  if (!permission && !variant) {
    return JSON.stringify(nextConfig)
  }

  if (!selectedAgent) {
    if (permission) {
      nextConfig.permission = permission
    }
    return JSON.stringify(nextConfig)
  }

  const existingAgents = nextConfig.agent && typeof nextConfig.agent === 'object' && !Array.isArray(nextConfig.agent)
    ? nextConfig.agent as Record<string, unknown>
    : {}
  const existingAgentConfig = existingAgents[selectedAgent]
  nextConfig.agent = {
    ...existingAgents,
    [selectedAgent]: existingAgentConfig && typeof existingAgentConfig === 'object' && !Array.isArray(existingAgentConfig)
      ? {
          ...existingAgentConfig,
          ...(permission ? { permission } : {}),
          ...(variant ? { variant } : {}),
        }
      : {
          ...(permission ? { permission } : {}),
          ...(variant ? { variant } : {}),
        },
  }

  return JSON.stringify(nextConfig)
}

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

const mergeRecordField = (base: unknown, override: unknown) => {
  if (!isRecord(base) && !isRecord(override)) {
    return override
  }

  return {
    ...(isRecord(base) ? base : {}),
    ...(isRecord(override) ? override : {}),
  }
}

const mergeOpenCodeProviderEntry = (base: unknown, override: unknown) => {
  if (!isRecord(base) || !isRecord(override)) {
    return isRecord(override) ? override : base
  }

  return {
    ...override,
    ...base,
    models: mergeRecordField(base.models, override.models),
    options: mergeRecordField(base.options, override.options),
  }
}

const mergeOpenCodeProviderConfig = (
  baseProvider: Record<string, unknown>,
  overrideProvider: OpenCodeExecutionConfig['provider'],
) => {
  const merged = { ...baseProvider }
  for (const [providerId, overrideConfig] of Object.entries(overrideProvider ?? {})) {
    merged[providerId] = mergeOpenCodeProviderEntry(baseProvider[providerId], overrideConfig)
  }

  return merged
}

const resolvePromptOptions = (params: {
  actingUserId?: string
  runtimeAgentId?: string
  workspaceId?: string
  executionModel?: string
  agentSettings?: AgentRuntimeSettings
  opencodeConfig?: OpenCodeExecutionConfig
  mcpServers?: McpServerPolicy[]
}) => {
  const workerConfig = loadWorkerConfig()
  const agentSettings = resolveOpenCodeAgentSettings(params.agentSettings)
  const agent = params.opencodeConfig?.agent?.trim() || agentSettings?.agent?.trim() || undefined
  const variant = params.opencodeConfig?.variant?.trim() || undefined
  const permissionPolicy = params.opencodeConfig?.permissionPolicy?.trim() || agentSettings?.permissionPolicy?.trim() || undefined
  const executionModel = params.executionModel?.trim()
    || params.opencodeConfig?.model?.trim()
    || agentSettings?.defaultModel?.trim()
    || undefined
  const hasRuntimeMcpOverride = Array.isArray(params.mcpServers)
  const effectiveMcpServers = params.mcpServers ?? workerConfig.mcpServers ?? []
  const mergedMcpServers = [
    ...effectiveMcpServers,
    ...(params.opencodeConfig?.mcpServers ?? []),
  ]
  const baseConfigContent = hasRuntimeMcpOverride || params.opencodeConfig?.mcpServers?.length
    ? buildOpencodeConfigWithMcp(workerConfig.opencodeConfigContent, mergedMcpServers, {
        cloudUrl: workerConfig.cloudUrl,
        executorToken: workerConfig.executorToken,
        actingUserId: params.actingUserId,
        runtimeAgentId: params.runtimeAgentId,
        workspaceId: params.workspaceId,
      }).trim()
    : getWorkerEffectiveOpencodeConfigContent(workerConfig, params.actingUserId, params.workspaceId).trim()

  return {
    agent,
    variant,
    executionModel,
    configContent: buildPromptConfigContent({
      baseConfigContent,
      agent,
      permissionPolicy,
      variant,
      executionModel,
      provider: params.opencodeConfig?.provider,
    }),
  }
}

const isAbortLikeError = (error: unknown) => {
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : ''
  return /\babort(ed|ing)?\b/i.test(message)
}

const getSessionStatus = (
  sessionStatuses: { data?: Record<string, OpenCodeSessionStatus> } | null,
  sessionId: string,
) => {
  const data = sessionStatuses?.data
  if (!data || typeof data !== 'object') {
    return undefined
  }

  return sessionId in data ? data[sessionId] : undefined
}

const promptSession = async (params: {
  actingUserId?: string
  runtimeAgentId?: string
  workspaceId?: string
  resumeSessionId?: string
  cwd: string
  title: string
  prompt: string
  executionModel?: string
  agentSettings?: AgentRuntimeSettings
  opencodeConfig?: OpenCodeExecutionConfig
  mcpServers?: McpServerPolicy[]
  runtimeEnv?: Record<string, string>
  signal?: AbortSignal
  onEvent?: (event: OpenCodePromptEvent) => void
}): Promise<WorkerAgentPromptResult> => {
  if (!existsSync(params.cwd)) {
    throw new Error(`工作目录不存在: ${params.cwd}`)
  }

  const promptOptions = resolvePromptOptions({
    actingUserId: params.actingUserId,
    runtimeAgentId: params.runtimeAgentId,
    workspaceId: params.workspaceId,
    executionModel: params.executionModel,
    agentSettings: params.agentSettings,
    opencodeConfig: params.opencodeConfig,
    mcpServers: params.mcpServers,
  })
  const client = await getOpencodeClient(params.cwd, promptOptions.configContent, params.runtimeEnv)
  const sessionId = await ensureOpencodeSession(client, params.cwd, params.resumeSessionId, params.title)
  const promptStartedAtMs = Date.now()
  const inactivityTracker = createOpenCodeInactivityTracker(PROMPT_OUTPUT_POLL_TIMEOUT_MS)

  let aborted = false
  let promptError: Error | null = null
  const textStateByMessageId = new Map<string, Map<string, string>>()
  let sawRelevantActivity = false
  let assistantMessageId = ''
  /** 当前 prompt 回复的 assistant message token 用量（message.updated / snapshot 携带完整 tokens 时更新）。 */
  let assistantUsage: ModelTokenUsage | undefined
  const abortController = new AbortController()
  const snapshotMessageIds = new Set<string>()
  const ignoredAssistantMessageIds = new Set<string>()
  const snapshotPartFingerprints = new Map<string, string>()
  const snapshotPartText = new Map<string, string>()
  let snapshotStatusKey = ''
  let snapshotSettled = false
  let stopSnapshotPolling = false
  let promptOutputTimedOut = false
  const markRelevantActivity = () => {
    sawRelevantActivity = true
    inactivityTracker.markActivity()
  }
  const handleAbort = () => {
    aborted = true
    abortController.abort()
    void client.session.abort({
      path: { id: sessionId },
      query: { directory: params.cwd },
    }).catch(() => undefined)
  }

  params.signal?.addEventListener('abort', handleAbort, { once: true })

  try {
    const applyAssistantMessageUpdate = (
      info: PromptMessageInfo,
      source: 'stream' | 'snapshot',
    ) => {
      if (info.sessionID && info.sessionID !== sessionId) {
        return false
      }

      if (info.role !== 'assistant' || !info.id) {
        return false
      }

      if (
        info.time?.created !== undefined
        && info.time.created < Math.max(0, promptStartedAtMs - PROMPT_OUTPUT_LOOKBACK_MS)
      ) {
        ignoredAssistantMessageIds.add(info.id)
        return false
      }

      assistantMessageId = info.id
      markRelevantActivity()

      const nextUsage = extractOpencodeAssistantUsage(info)
      if (nextUsage) {
        assistantUsage = nextUsage
      }

      if (source === 'stream') {
        logWorkerOpencodeDebug('event:message-updated', {
          sessionId,
          assistantMessageId,
          role: info.role,
        })
      }

      return true
    }

    const applyAssistantPartUpdate = (
      part: PromptPart,
      source: 'stream' | 'snapshot',
    ) => {
      if (part.sessionID && part.sessionID !== sessionId) {
        return false
      }

      if (part.messageID && ignoredAssistantMessageIds.has(part.messageID)) {
        return false
      }

      if (!assistantMessageId && part.messageID) {
        assistantMessageId = part.messageID
      }

      if (assistantMessageId && part.messageID && part.messageID !== assistantMessageId) {
        return false
      }

      markRelevantActivity()

      if (source === 'stream') {
        logWorkerOpencodeDebug('event:message-part', {
          sessionId,
          assistantMessageId,
          partId: part.id,
          messageId: part.messageID,
          partType: part.type,
          textPreview: (part.text ?? '').slice(0, 120),
        })
      }

      if (part.type === 'text' && part.messageID && part.id) {
        getMessageTextState(textStateByMessageId, part.messageID).set(part.id, part.text ?? '')
      }

      return true
    }

    const emitSnapshotEvents = (
      entries: PromptMessageEntry[],
      currentSessionStatus?: OpenCodeSessionStatus,
      promptWindowStartedAtMs?: number,
    ) => {
      const nextStatusKey = currentSessionStatus?.type
        ? JSON.stringify(currentSessionStatus)
        : ''

      if (nextStatusKey && nextStatusKey !== snapshotStatusKey) {
        snapshotStatusKey = nextStatusKey
        params.onEvent?.({
          type: 'session.status',
          properties: {
            sessionID: sessionId,
            status: currentSessionStatus,
          },
        })
      }

      const assistantEntries = getAssistantEntriesForPrompt(entries, assistantMessageId, promptWindowStartedAtMs)
        .filter((entry) => entry.info?.role === 'assistant' && entry.info?.id)

      for (const entry of assistantEntries) {
        const info = entry.info
        if (!info?.id) {
          continue
        }

        if (!snapshotMessageIds.has(info.id)) {
          snapshotMessageIds.add(info.id)
          params.onEvent?.({
            type: 'message.updated',
            properties: {
              info,
            },
          })
        }

        applyAssistantMessageUpdate(info, 'snapshot')

        for (const rawPart of entry.parts ?? []) {
          if (rawPart.type !== 'text' && rawPart.type !== 'reasoning' && rawPart.type !== 'tool') {
            continue
          }

          const part = rawPart.id ? rawPart : {
            ...rawPart,
            id: `${entry.info?.id}:${rawPart.type}:${rawPart.tool ?? 'part'}`,
          }
          const fingerprint = JSON.stringify({
            type: part.type,
            text: part.text ?? '',
            tool: part.tool ?? '',
            state: part.state ?? null,
            time: part.time ?? null,
          })
          if (snapshotPartFingerprints.get(part.id!) === fingerprint) {
            continue
          }

          snapshotPartFingerprints.set(part.id!, fingerprint)
          const previousText = snapshotPartText.get(part.id!) ?? ''
          const nextText = part.text ?? ''
          if (part.type === 'text' || part.type === 'reasoning') {
            snapshotPartText.set(part.id!, nextText)
          }

          const delta = nextText && nextText.startsWith(previousText)
            ? nextText.slice(previousText.length)
            : undefined

          params.onEvent?.({
            type: 'message.part.updated',
            properties: delta === undefined
              ? { part }
              : {
                  part,
                  delta,
                },
          })
          applyAssistantPartUpdate(part, 'snapshot')
        }
      }
    }

    const pollSessionSnapshot = async () => {
      while (
        !stopSnapshotPolling
        && !aborted
        && !params.signal?.aborted
        && !inactivityTracker.hasTimedOut()
      ) {
        try {
          const [messages, sessionStatuses] = await Promise.all([
            client.session.messages({
              path: { id: sessionId },
              query: { directory: params.cwd, limit: 20 },
            }),
            client.session.status({
              query: { directory: params.cwd },
            }).catch(() => null),
          ])
          const entries = Array.isArray(messages.data) ? messages.data as PromptMessageEntry[] : []
          const currentSessionStatus = getSessionStatus(sessionStatuses as { data?: Record<string, OpenCodeSessionStatus> } | null, sessionId)
          const promptWindowStartedAtMs = assistantMessageId
            ? undefined
            : Math.max(0, promptStartedAtMs - PROMPT_OUTPUT_LOOKBACK_MS)
          const sessionStillBusy = currentSessionStatus?.type === 'busy'
          const output = getOutputFromMessageEntries(entries, assistantMessageId, promptWindowStartedAtMs)
          const hasSettledAssistantOutput = hasSettledAssistantEntry(entries, assistantMessageId, promptWindowStartedAtMs)

          emitSnapshotEvents(entries, currentSessionStatus, promptWindowStartedAtMs)
          if (output) {
            markRelevantActivity()
          }

          if (!sessionStillBusy && hasSettledAssistantOutput) {
            if (!snapshotSettled) {
              snapshotSettled = true
              params.onEvent?.({
                type: 'session.idle',
                properties: { sessionID: sessionId },
              })
            }
            abortController.abort()
            break
          }
        } catch (error) {
          if (stopSnapshotPolling || aborted || params.signal?.aborted || isAbortLikeError(error)) {
            return
          }
        }

        if (stopSnapshotPolling || aborted || params.signal?.aborted) {
          return
        }

        await sleep(PROMPT_OUTPUT_POLL_INTERVAL_MS)
      }

      if (stopSnapshotPolling || aborted || params.signal?.aborted || snapshotSettled) {
        return
      }

      promptOutputTimedOut = true
      promptError = new Error(OPENCODE_NO_ACTIVITY_TIMEOUT_ERROR_MESSAGE)
      logWorkerOpencodeDebug('prompt:output-timeout', {
        cwd: params.cwd,
        sessionId,
        sawRelevantActivity,
        lastActivityAt: inactivityTracker.getLastActivityAt(),
        inactiveForMs: inactivityTracker.getElapsedSinceActivity(),
      })
      params.onEvent?.(createOpenCodeSessionErrorEvent(sessionId, promptError.message))
      abortController.abort()
    }

    logWorkerOpencodeDebug('prompt:start', {
      cwd: params.cwd,
      title: params.title,
      executionModel: promptOptions.executionModel ?? 'default',
      agent: promptOptions.agent ?? 'default',
      variant: promptOptions.variant ?? 'default',
      promptPreview: params.prompt.slice(0, 200),
    })
    const subscription = await client.event.subscribe({ signal: abortController.signal })
    logWorkerOpencodeDebug('prompt:subscribed', {
      cwd: params.cwd,
      sessionId,
    })
    const promptPromise = client.session.promptAsync({
      path: { id: sessionId },
      query: { directory: params.cwd },
      body: {
        model: parseExecutionModel(promptOptions.executionModel),
        agent: promptOptions.agent,
        parts: [{ type: 'text', text: params.prompt }],
      },
    }).then((result) => {
      logWorkerOpencodeDebug('prompt:async-result', {
        cwd: params.cwd,
        sessionId,
        ok: !('error' in result) || !result.error,
        error: 'error' in result && result.error ? getErrorText(result.error) : undefined,
        hasData: 'data' in result ? Boolean(result.data) : undefined,
      })

      if ('error' in result && result.error) {
        throw result.error
      }

      return result
    }).catch((error) => {
      if (aborted || params.signal?.aborted) {
        return undefined
      }

      promptError = error instanceof Error ? error : new Error(getErrorText(error))
      stopSnapshotPolling = true
      logWorkerOpencodeDebug('prompt:async-error', {
        cwd: params.cwd,
        sessionId,
        error: promptError.message,
      })
      params.onEvent?.(createOpenCodeSessionErrorEvent(sessionId, promptError.message))
      abortController.abort()
      return undefined
    })

    const snapshotPollingPromise = pollSessionSnapshot()

    try {
      for await (const rawEvent of subscription.stream as AsyncIterable<Record<string, unknown>>) {
        if (aborted || params.signal?.aborted) {
          throw toAbortError(params.signal)
        }

        const event = unwrapOpenCodeEvent(rawEvent)
        if (!event) {
          continue
        }

        if (event.type === 'permission.updated') {
          params.onEvent?.({ type: 'permission.updated', properties: event.properties })
        }

        if (event.type === 'session.status') {
          params.onEvent?.({ type: 'session.status', properties: event.properties })
          const currentSessionId = event.properties.sessionID
          if (currentSessionId === sessionId) {
            markRelevantActivity()
            logWorkerOpencodeDebug('event:session-status', {
              sessionId,
              status: event.properties.status,
            })
          }
          continue
        }

        if (event.type === 'message.updated') {
          params.onEvent?.({ type: 'message.updated', properties: event.properties })
          const info = event.properties.info as { id?: string; sessionID?: string; role?: string }
          applyAssistantMessageUpdate(info, 'stream')
          continue
        }

        if (event.type === 'message.part.updated') {
          params.onEvent?.({ type: 'message.part.updated', properties: event.properties })
          const part = event.properties.part as PromptPart
          applyAssistantPartUpdate(part, 'stream')
          continue
        }

        if (event.type === 'message.part.delta') {
          const part = applyOpenCodePartTextDelta(
            textStateByMessageId,
            event.properties,
          )
          if (part) {
            params.onEvent?.({
              type: 'message.part.updated',
              properties: {
                part,
                delta: event.properties.delta,
              },
            })
            applyAssistantPartUpdate(part, 'stream')
          }
          continue
        }

        if (event.type === 'session.error') {
          params.onEvent?.({ type: 'session.error', properties: event.properties })
          const properties = event.properties as { sessionID?: string; error?: unknown }
          if (properties.sessionID !== sessionId) {
            continue
          }

          logWorkerOpencodeDebug('event:session-error', {
            sessionId,
            error: properties.error,
          })

          throw new Error(getErrorText(properties.error))
        }

        if (event.type === 'session.idle') {
          params.onEvent?.({ type: 'session.idle', properties: event.properties })
          const properties = event.properties as { sessionID?: string }
          if (properties.sessionID === sessionId && sawRelevantActivity) {
            snapshotSettled = true
            logWorkerOpencodeDebug('event:session-idle', {
              sessionId,
              assistantMessageId,
              textPartCount: assistantMessageId ? (textStateByMessageId.get(assistantMessageId)?.size ?? 0) : 0,
            })
            break
          }
        }
      }
    } catch (error) {
      if (!(aborted || params.signal?.aborted || snapshotSettled || promptOutputTimedOut || isAbortLikeError(error))) {
        throw error
      }
    }

    await snapshotPollingPromise
    stopSnapshotPolling = true
    abortController.abort()
    await promptPromise

    if (aborted || params.signal?.aborted) {
      throw toAbortError(params.signal)
    }

    if (promptError) {
      throw promptError
    }

    let output = assistantMessageId
      ? extractStreamingText(textStateByMessageId.get(assistantMessageId) ?? new Map())
      : ''
    let settledAssistantError = ''
    if (!output) {
      for (let attempt = 0; attempt === 0 || !inactivityTracker.hasTimedOut(); attempt += 1) {
        if (attempt > 0) {
          await sleep(PROMPT_OUTPUT_POLL_INTERVAL_MS)
        }

        const [messages, sessionStatuses] = await Promise.all([
          client.session.messages({
            path: { id: sessionId },
            query: { directory: params.cwd, limit: 20 },
          }),
          client.session.status({
            query: { directory: params.cwd },
          }).catch(() => null),
        ])
        const entries = Array.isArray(messages.data) ? messages.data as PromptMessageEntry[] : []
        const promptWindowStartedAtMs = assistantMessageId
          ? undefined
          : Math.max(0, promptStartedAtMs - PROMPT_OUTPUT_LOOKBACK_MS)
        const currentSessionStatus = sessionStatuses?.data
          && typeof sessionStatuses.data === 'object'
          && sessionId in sessionStatuses.data
          ? sessionStatuses.data[sessionId]
          : undefined
        const sessionStillBusy = currentSessionStatus?.type === 'busy'

        output = getOutputFromMessageEntries(entries, assistantMessageId, promptWindowStartedAtMs)
        settledAssistantError = getErrorFromMessageEntries(entries, assistantMessageId, promptWindowStartedAtMs)
        const hasSettledAssistantOutput = hasSettledAssistantEntry(entries, assistantMessageId, promptWindowStartedAtMs)
        if (output || settledAssistantError || hasSettledAssistantOutput || sessionStillBusy) {
          markRelevantActivity()
        }
        if (output && !sessionStillBusy && hasSettledAssistantOutput) {
          break
        }

        if (!sessionStillBusy && hasSettledAssistantOutput) {
          break
        }
      }
    }

    if (!output && settledAssistantError) {
      throw new Error(settledAssistantError)
    }

    if (isOpenCodeMissingTextOutput(output)) {
      throw new Error(OPENCODE_MISSING_TEXT_OUTPUT_ERROR_MESSAGE)
    }

    const emptyOutputSnapshot = output
      ? undefined
      : await readSessionSnapshot(client, params.cwd, sessionId)

    logWorkerOpencodeDebug('prompt:finish', {
      cwd: params.cwd,
      sessionId,
      assistantMessageId,
      sawRelevantActivity,
      snapshotSettled,
      emptyOutputSnapshot,
      outputPreview: (output || 'OpenCode 未返回文本输出。').slice(0, 200),
    })

    return {
      ok: true,
      sessionId,
      output,
      usage: assistantUsage,
    }
  } catch (error) {
    stopSnapshotPolling = true
    logWorkerOpencodeDebug('prompt:error', {
      cwd: params.cwd,
      sessionId,
      assistantMessageId,
      aborted,
      error: getErrorText(error),
      snapshot: await readSessionSnapshot(client, params.cwd, sessionId),
    })
    throw error
  } finally {
    params.signal?.removeEventListener('abort', handleAbort)
  }
}

export const runWorkerOpenCodeTask = async (params: {
  actingUserId?: string
  runtimeAgentId?: string
  cwd: string
  title: string
  description: string
  executionModel?: string
  agentSettings?: AgentRuntimeSettings
  opencodeConfig?: OpenCodeExecutionConfig
  mcpServers?: McpServerPolicy[]
  runtimeEnv?: Record<string, string>
  runtimeArgs?: string[]
  signal?: AbortSignal
}): Promise<WorkerAgentPromptResult> => {
  const prompt = [
    `任务标题: ${params.title}`,
    `任务描述: ${params.description}`,
    '',
    '请直接在当前工作目录完成任务所需修改。',
    '如果需要读取代码、编辑文件、运行测试或生成补丁，请直接执行。',
    '完成后请返回简洁总结：做了什么、是否还有阻塞。',
  ].join('\n')

  return promptSession({
    actingUserId: params.actingUserId,
    runtimeAgentId: params.runtimeAgentId,
    cwd: params.cwd,
    title: `Task: ${params.title}`,
    prompt,
    executionModel: params.executionModel,
    agentSettings: params.agentSettings,
    opencodeConfig: params.opencodeConfig,
    mcpServers: params.mcpServers,
    runtimeEnv: params.runtimeEnv,
    signal: params.signal,
  })
}

export const runWorkerOpenCodePrompt = async (params: {
  actingUserId?: string
  runtimeAgentId?: string
  workspaceId?: string
  resumeSessionId?: string
  cwd: string
  title: string
  prompt: string
  executionModel?: string
  agentSettings?: AgentRuntimeSettings
  opencodeConfig?: OpenCodeExecutionConfig
  mcpServers?: McpServerPolicy[]
  runtimeEnv?: Record<string, string>
  runtimeArgs?: string[]
  signal?: AbortSignal
  onEvent?: (event: OpenCodePromptEvent) => void
}): Promise<WorkerAgentPromptResult> => {
  return promptSession({
    actingUserId: params.actingUserId,
    runtimeAgentId: params.runtimeAgentId,
    workspaceId: params.workspaceId,
    resumeSessionId: params.resumeSessionId,
    cwd: params.cwd,
    title: params.title,
    prompt: params.prompt,
    executionModel: params.executionModel,
    agentSettings: params.agentSettings,
    opencodeConfig: params.opencodeConfig,
    mcpServers: params.mcpServers,
    runtimeEnv: params.runtimeEnv,
    signal: params.signal,
    onEvent: params.onEvent,
  })
}
