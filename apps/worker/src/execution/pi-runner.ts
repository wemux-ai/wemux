/**
 * [INPUT]: Main-chat and workspace prompt requests, prompt execution surface, Pi runtime configuration, and MCP tool bridges.
 * [OUTPUT]: Streamed Pi responses, surface-scoped built-in tools, tool events, and persisted runtime session identifiers.
 * [POS]: Pi execution adapter; combines built-in tools with runtime-provided MCP tools.
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { createAgentSession, DefaultResourceLoader, type AgentSessionEvent } from '@mariozechner/pi-coding-agent'
import type { McpServerPolicy } from '@shared/mcp'
import type { PiAgentSettings, ModelTokenUsage } from '@shared/types'
import { createPiMcpTools } from './pi-mcp-tools'
import { installPiOpenAiCompatibleFetchPatch } from './pi-http-compat'
import { materializePromptAttachments, type MaterializedPromptAttachment } from './prompt-attachments'
import { emitAgentEvent, normalizeExecutionModel, toAbortError, type WorkerAgentPromptParams, type WorkerAgentPromptResult } from './agent-runner-shared'
import { preparePiSessionConfig } from './pi-session-config'
import { loadWorkerConfig } from '../core/config'

type PiStreamingState = {
  activeAssistantMessageId: string
  assistantCounter: number
  latestAssistantMessage?: unknown
  reasoningParts: Map<number, string>
  textParts: Map<number, string>
}

type PiSessionDrainTarget = {
  agent?: {
    streamFn?: (...args: unknown[]) => unknown
    waitForIdle?: () => Promise<void>
  }
  _agentEventQueue?: Promise<unknown>
}

type AssistantContentPart = {
  index: number
  text: string
  type: 'text' | 'thinking'
}

type PiToolCallBlock = {
  type: 'toolCall'
  id?: string
  name?: string
  arguments?: unknown
  [key: string]: unknown
}

type PiAssistantMessage = {
  role?: string
  content?: unknown
  /** Pi SDK AssistantMessage.usage（含 cache 读写与官方 totalTokens）。 */
  usage?: {
    input?: number
    output?: number
    cacheRead?: number
    cacheWrite?: number
    totalTokens?: number
  }
  [key: string]: unknown
}

type PiAssistantStreamEvent = {
  type: string
  partial?: PiAssistantMessage
  message?: PiAssistantMessage
  error?: PiAssistantMessage
  toolCall?: PiToolCallBlock
  [key: string]: unknown
}

type PiAssistantStream = AsyncIterable<PiAssistantStreamEvent> & {
  result?: () => Promise<PiAssistantMessage>
}

const PI_BUILTIN_TOOL_NAMES = ['read', 'bash', 'edit', 'write', 'grep', 'find', 'ls']

export const buildPiSessionToolNames = (customToolNames: readonly string[]) => {
  return [...new Set([...PI_BUILTIN_TOOL_NAMES, ...customToolNames])]
}

export const resolvePiMcpServers = (
  requestMcpServers: McpServerPolicy[] | undefined,
  workerMcpServers: McpServerPolicy[] | undefined,
) => requestMcpServers ?? workerMcpServers ?? []

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

export const parsePiSkillPaths = (value?: string, delimiter = path.delimiter) => {
  const normalized = value?.trim() || ''
  if (!normalized) {
    return []
  }

  return normalized
    .split(/\r?\n/)
    .flatMap((line) => line.split(delimiter))
    .map((item) => item.trim())
    .filter(Boolean)
}

const isToolCallBlock = (value: unknown): value is PiToolCallBlock => {
  return isRecord(value) && value.type === 'toolCall'
}

const hasToolIdentity = (toolCall: PiToolCallBlock) => {
  return Boolean(toolCall.id?.trim() && toolCall.name?.trim())
}

const hasMeaningfulToolArguments = (value: unknown) => {
  return isRecord(value) && Object.keys(value).length > 0
}

const mergeToolArguments = (base: unknown, patch: unknown) => {
  return {
    ...(isRecord(base) ? base : {}),
    ...(isRecord(patch) ? patch : {}),
  }
}

export const repairPiAssistantMessageForToolCalls = <T extends PiAssistantMessage>(message: T): T => {
  if (message.role !== 'assistant' || !Array.isArray(message.content)) {
    return message
  }

  const content: unknown[] = []
  let previousValidToolCall: PiToolCallBlock | undefined
  let changed = false

  for (const item of message.content) {
    if (!isToolCallBlock(item)) {
      content.push(item)
      previousValidToolCall = undefined
      continue
    }

    if (hasToolIdentity(item)) {
      const nextToolCall = { ...item }
      content.push(nextToolCall)
      previousValidToolCall = nextToolCall
      if (nextToolCall !== item) {
        changed = true
      }
      continue
    }

    if (previousValidToolCall && hasMeaningfulToolArguments(item.arguments)) {
      previousValidToolCall.arguments = mergeToolArguments(previousValidToolCall.arguments, item.arguments)
      changed = true
      continue
    }

    changed = true
  }

  return changed
    ? {
        ...message,
        content,
      }
    : message
}

const repairPiAssistantStreamEvent = <T extends PiAssistantStreamEvent>(event: T): T => {
  const repaired = { ...event } as PiAssistantStreamEvent

  if (event.partial) {
    repaired.partial = repairPiAssistantMessageForToolCalls(event.partial)
  }
  if (event.message) {
    repaired.message = repairPiAssistantMessageForToolCalls(event.message)
  }
  if (event.error) {
    repaired.error = repairPiAssistantMessageForToolCalls(event.error)
  }

  if (event.toolCall && !hasToolIdentity(event.toolCall)) {
    delete repaired.toolCall
  }

  return repaired as T
}

export const repairPiAssistantStream = (source: PiAssistantStream): PiAssistantStream => {
  let finalMessage: PiAssistantMessage | undefined

  return {
    async *[Symbol.asyncIterator]() {
      for await (const rawEvent of source) {
        const event = repairPiAssistantStreamEvent(rawEvent)
        if (event.type === 'done' && event.message) {
          finalMessage = event.message
        }
        if (event.type === 'error' && event.error) {
          finalMessage = event.error
        }
        yield event
      }
    },
    result: async () => {
      if (finalMessage) {
        return finalMessage
      }

      const sourceResult = await source.result?.()
      return sourceResult ? repairPiAssistantMessageForToolCalls(sourceResult) : {
        role: 'assistant',
        content: [],
      }
    },
  }
}

const installPiToolCallStreamRepair = (session: PiSessionDrainTarget) => {
  const agent = session.agent
  const originalStreamFn = agent?.streamFn
  if (!agent || !originalStreamFn) {
    return () => undefined
  }

  agent.streamFn = async (...args: unknown[]) => {
    const source = await originalStreamFn.apply(agent, args)
    if (!source || typeof source !== 'object') {
      return source
    }

    const stream = source as PiAssistantStream
    if (typeof stream[Symbol.asyncIterator] !== 'function') {
      return source
    }

    return repairPiAssistantStream(stream)
  }

  return () => {
    agent.streamFn = originalStreamFn
  }
}

const extractAssistantContentParts = (message: unknown): AssistantContentPart[] => {
  const record = message as { role?: string; content?: unknown }
  if (record?.role !== 'assistant') {
    return []
  }

  if (typeof record.content === 'string') {
    const text = record.content.trim()
    return text ? [{ index: 0, text, type: 'text' }] : []
  }

  if (!Array.isArray(record.content)) {
    return []
  }

  return record.content.flatMap<AssistantContentPart>((item, index) => {
    const part = item as { content?: unknown; text?: unknown; thinking?: unknown; type?: string }
    if (part.type === 'text') {
      const text = typeof part.text === 'string'
        ? part.text.trim()
        : typeof part.content === 'string'
          ? part.content.trim()
          : ''
      return text ? [{ index, text, type: 'text' as const }] : []
    }

    if (part.type === 'thinking') {
      const text = typeof part.thinking === 'string'
        ? part.thinking.trim()
        : typeof part.text === 'string'
          ? part.text.trim()
          : ''
      return text ? [{ index, text, type: 'thinking' as const }] : []
    }

    return []
  })
}

const extractAssistantText = (message: unknown) => {
  return extractAssistantContentParts(message)
    .filter((part) => part.type === 'text')
    .map((part) => part.text)
    .join('\n\n')
    .trim()
}

const extractAssistantError = (message: unknown) => {
  const record = message as { role?: string; errorMessage?: unknown; stopReason?: unknown }
  if (record?.role !== 'assistant' || record.stopReason !== 'error') {
    return ''
  }

  return typeof record.errorMessage === 'string' ? record.errorMessage.trim() : ''
}

const getLatestAssistantMessage = (messages: unknown[]) => {
  for (const message of [...messages].reverse()) {
    if ((message as { role?: string })?.role === 'assistant') {
      return message
    }
  }

  return undefined
}

export const extractPiAssistantUsage = (message: unknown): ModelTokenUsage | undefined => {
  const usage = (message as { usage?: { input?: number; output?: number; cacheRead?: number; cacheWrite?: number; totalTokens?: number } } | undefined)?.usage
  if (!usage) {
    return undefined
  }

  const inputTokens = normalizeUsageCount(usage.input)
  const outputTokens = normalizeUsageCount(usage.output)
  const cacheReadTokens = normalizeUsageCount(usage.cacheRead)
  const cacheWriteTokens = normalizeUsageCount(usage.cacheWrite)
  const totalTokens = normalizeUsageCount(usage.totalTokens)
  if (inputTokens <= 0 && outputTokens <= 0 && cacheReadTokens <= 0 && cacheWriteTokens <= 0 && totalTokens <= 0) {
    return undefined
  }

  return {
    inputTokens,
    outputTokens,
    reasoningTokens: undefined,
    cacheReadTokens: cacheReadTokens > 0 ? cacheReadTokens : undefined,
    cacheWriteTokens: cacheWriteTokens > 0 ? cacheWriteTokens : undefined,
    /** 优先采用 Pi SDK 官方 totalTokens；缺失时按 input + output 兜底（Pi 不单独报 reasoning）。 */
    totalTokens: totalTokens > 0 ? totalTokens : inputTokens + outputTokens,
  }
}

const normalizeUsageCount = (value: number | undefined) => {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.round(value) : 0
}

const ensureAssistantMessage = (params: WorkerAgentPromptParams, state: PiStreamingState) => {
  emitAgentEvent('Pi', params.onEvent, {
    type: 'message.updated',
    properties: {
      info: {
        id: state.activeAssistantMessageId,
        role: 'assistant',
      },
    },
  })
}

const updateAssistantPart = (
  params: WorkerAgentPromptParams,
  state: PiStreamingState,
  kind: 'text' | 'reasoning',
  index: number,
  nextText: string,
  delta?: string,
) => {
  const parts = kind === 'text' ? state.textParts : state.reasoningParts
  if ((parts.get(index) ?? '') === nextText) {
    return
  }

  parts.set(index, nextText)
  ensureAssistantMessage(params, state)
  emitAgentEvent('Pi', params.onEvent, {
    type: 'message.part.updated',
    properties: {
      part: {
        id: `${state.activeAssistantMessageId}:${kind}:${index}`,
        messageID: state.activeAssistantMessageId,
        type: kind,
        text: nextText,
      },
      delta,
    },
  })
}

const emitTextPart = (params: WorkerAgentPromptParams, state: PiStreamingState, index: number, delta: string) => {
  const nextText = `${state.textParts.get(index) ?? ''}${delta}`
  updateAssistantPart(params, state, 'text', index, nextText, delta)
}

const emitReasoningPart = (params: WorkerAgentPromptParams, state: PiStreamingState, index: number, delta: string) => {
  const nextText = `${state.reasoningParts.get(index) ?? ''}${delta}`
  updateAssistantPart(params, state, 'reasoning', index, nextText, delta)
}

const syncAssistantMessageToStream = (
  params: WorkerAgentPromptParams,
  state: PiStreamingState,
  message: unknown,
) => {
  state.latestAssistantMessage = message

  for (const part of extractAssistantContentParts(message)) {
    const currentText = (part.type === 'text' ? state.textParts : state.reasoningParts).get(part.index) ?? ''
    const delta = part.text.startsWith(currentText)
      ? part.text.slice(currentText.length) || undefined
      : undefined
    updateAssistantPart(
      params,
      state,
      part.type === 'text' ? 'text' : 'reasoning',
      part.index,
      part.text,
      delta,
    )
  }
}

const emitToolState = (params: WorkerAgentPromptParams, state: PiStreamingState, event: {
  toolCallId: string
  toolName: string
  raw?: string
  output?: string
  error?: string
  status: 'pending' | 'running' | 'completed' | 'error'
}) => {
  ensureAssistantMessage(params, state)
  emitAgentEvent('Pi', params.onEvent, {
    type: 'message.part.updated',
    properties: {
      part: {
        id: event.toolCallId,
        messageID: state.activeAssistantMessageId,
        type: 'tool',
        tool: event.toolName,
        state: {
          status: event.status,
          raw: event.raw,
          output: event.output,
          error: event.error,
        },
      },
    },
  })
}

const hasValidToolIdentity = (event: { toolCallId?: string; toolName?: string }) => {
  return Boolean(event.toolCallId?.trim() && event.toolName?.trim())
}

const handlePiSessionEvent = (params: WorkerAgentPromptParams, state: PiStreamingState, event: AgentSessionEvent) => {
  if (event.type === 'agent_start') {
    emitAgentEvent('Pi', params.onEvent, {
      type: 'session.status',
      properties: {
        status: {
          type: 'busy',
          message: 'Pi 会话执行中',
        },
      },
    })
    return
  }

  if (event.type === 'turn_start') {
    state.assistantCounter += 1
    state.activeAssistantMessageId = `pi:${state.assistantCounter}`
    state.latestAssistantMessage = undefined
    state.textParts.clear()
    state.reasoningParts.clear()
    return
  }

  if (event.type === 'message_update') {
    state.latestAssistantMessage = event.message
    if (event.assistantMessageEvent.type === 'text_delta') {
      emitTextPart(params, state, event.assistantMessageEvent.contentIndex, event.assistantMessageEvent.delta)
    }

    if (event.assistantMessageEvent.type === 'thinking_delta') {
      emitReasoningPart(params, state, event.assistantMessageEvent.contentIndex, event.assistantMessageEvent.delta)
    }

    if (
      event.assistantMessageEvent.type === 'text_end'
      || event.assistantMessageEvent.type === 'thinking_end'
      || event.assistantMessageEvent.type === 'done'
    ) {
      syncAssistantMessageToStream(params, state, event.message)
    }
    return
  }

  if (event.type === 'message_end' && event.message.role === 'assistant') {
    syncAssistantMessageToStream(params, state, event.message)
    return
  }

  if (event.type === 'turn_end' && event.message.role === 'assistant') {
    syncAssistantMessageToStream(params, state, event.message)
    return
  }

  if (event.type === 'tool_execution_start') {
    if (!hasValidToolIdentity(event)) {
      return
    }

    emitToolState(params, state, {
      toolCallId: event.toolCallId,
      toolName: event.toolName,
      raw: JSON.stringify(event.args ?? {}, null, 2),
      status: 'running',
    })
    return
  }

  if (event.type === 'tool_execution_update') {
    if (!hasValidToolIdentity(event)) {
      return
    }

    emitToolState(params, state, {
      toolCallId: event.toolCallId,
      toolName: event.toolName,
      raw: JSON.stringify(event.args ?? {}, null, 2),
      output: JSON.stringify(event.partialResult ?? {}, null, 2),
      status: 'running',
    })
    return
  }

  if (event.type === 'tool_execution_end') {
    if (!hasValidToolIdentity(event)) {
      return
    }

    emitToolState(params, state, {
      toolCallId: event.toolCallId,
      toolName: event.toolName,
      output: JSON.stringify(event.result ?? {}, null, 2),
      error: event.isError ? JSON.stringify(event.result ?? {}, null, 2) : undefined,
      status: event.isError ? 'error' : 'completed',
    })
    return
  }

  if (event.type === 'agent_end') {
    const latestAssistantMessage = getLatestAssistantMessage(event.messages)
    if (latestAssistantMessage) {
      syncAssistantMessageToStream(params, state, latestAssistantMessage)
    }
    emitAgentEvent('Pi', params.onEvent, {
      type: 'session.idle',
      properties: {},
    })
  }
}

const getLatestAssistantOutput = (messages: unknown[]) => {
  for (const message of [...messages].reverse()) {
    const output = extractAssistantText(message) || extractAssistantError(message)
    if (output) {
      return output
    }
  }

  return ''
}

const getCurrentTurnTextFromStream = (state: PiStreamingState) => {
  return [...state.textParts.entries()]
    .sort((left, right) => left[0] - right[0])
    .map(([, text]) => text.trim())
    .filter(Boolean)
    .join('\n\n')
    .trim()
}

export const resolvePiPromptOutput = (messages: unknown[], turnStartIndex: number, state: PiStreamingState) => {
  const eventOutput = extractAssistantText(state.latestAssistantMessage) || extractAssistantError(state.latestAssistantMessage)
  if (eventOutput) {
    return eventOutput
  }

  const currentTurnOutput = getLatestAssistantOutput(messages.slice(turnStartIndex))
  if (currentTurnOutput) {
    return currentTurnOutput
  }

  return getCurrentTurnTextFromStream(state)
}

export const waitForPiSessionSettled = async (session: PiSessionDrainTarget) => {
  await session.agent?.waitForIdle?.()
  while (true) {
    // Pi SDK persists session messages through an internal async event queue.
    // `session.prompt()` can resolve before that queue fully drains.
    const queue = session._agentEventQueue
    await queue
    if (queue === session._agentEventQueue) {
      return
    }
  }
}

const buildPiPromptImages = async (attachments: MaterializedPromptAttachment[]) => {
  return Promise.all(attachments
    .filter((attachment) => attachment.contentType?.startsWith('image/'))
    .map(async (attachment) => ({
      type: 'image' as const,
      data: await readFile(attachment.localPath, 'base64'),
      mimeType: attachment.contentType || 'image/png',
    })))
}

const runPiPromptWithPatchedFetch = async (params: WorkerAgentPromptParams): Promise<WorkerAgentPromptResult> => {
  const piSettings = params.agentSettings && 'agentDir' in params.agentSettings ? params.agentSettings as PiAgentSettings : undefined
  const executionModel = normalizeExecutionModel(params.executionModel) ?? normalizeExecutionModel(piSettings?.defaultModel)
  const workerConfig = loadWorkerConfig()
  const runtime = await preparePiSessionConfig({
    cwd: params.cwd,
    executionModel,
    resumeSessionId: params.resumeSessionId,
    runtimeEnv: params.runtimeEnv,
    settings: piSettings,
  })
  const effectiveMcpServers = resolvePiMcpServers(params.mcpServers, workerConfig.mcpServers)
  const mcpTools = await createPiMcpTools({
    actingUserId: params.actingUserId,
    runtimeAgentId: params.runtimeAgentId,
    workspaceId: params.workspaceId,
    mcpServers: effectiveMcpServers,
    workerConfig,
  })
  const skillPaths = parsePiSkillPaths(params.runtimeEnv?.WEMUX_PI_SKILL_PATHS)
  const resourceLoader = new DefaultResourceLoader({
    cwd: params.cwd,
    agentDir: runtime.agentDir,
    settingsManager: runtime.settingsManager,
    additionalSkillPaths: skillPaths,
  })

  await resourceLoader.reload()

  const { session } = await createAgentSession({
    cwd: params.cwd,
    agentDir: runtime.agentDir,
    authStorage: runtime.authStorage,
    modelRegistry: runtime.modelRegistry,
    model: runtime.selectedModel,
    tools: buildPiSessionToolNames(mcpTools.tools.map((tool) => tool.name)),
    customTools: mcpTools.tools,
    resourceLoader,
    sessionManager: runtime.sessionManager,
    settingsManager: runtime.settingsManager,
  })

  const warnings = mcpTools.warnings.join('\n')
  if (warnings) {
    emitAgentEvent('Pi', params.onEvent, {
      type: 'session.status',
      properties: {
        status: {
          type: 'busy',
          message: warnings,
        },
      },
    })
  } else if (mcpTools.tools.length > 0) {
    emitAgentEvent('Pi', params.onEvent, {
      type: 'session.status',
      properties: {
        status: {
          type: 'busy',
          message: `已挂载 ${mcpTools.tools.length} 个 MCP 工具。`,
        },
      },
    })
  }

  const state: PiStreamingState = {
    activeAssistantMessageId: 'pi:0',
    assistantCounter: 0,
    reasoningParts: new Map(),
    textParts: new Map(),
  }
  const turnStartIndex = session.messages.length
  const unsubscribe = session.subscribe((event) => {
    handlePiSessionEvent(params, state, event)
  })
  const restorePiToolCallStream = installPiToolCallStreamRepair(session as unknown as PiSessionDrainTarget)

  const abortHandler = () => {
    void session.abort()
  }
  params.signal?.addEventListener('abort', abortHandler, { once: true })
  let preparedAttachments: {
    attachments: MaterializedPromptAttachment[]
    cleanup: () => Promise<void>
  } = {
    attachments: [],
    cleanup: async () => undefined,
  }

  try {
    preparedAttachments = params.preparedAttachments
      ? {
          attachments: params.preparedAttachments,
          cleanup: async () => undefined,
        }
      : await materializePromptAttachments({
          attachments: params.attachments,
          cloudUrl: workerConfig.cloudUrl,
          signal: params.signal,
        })
    const promptImages = await buildPiPromptImages(preparedAttachments.attachments)
    await session.prompt(params.prompt, promptImages.length > 0 ? { images: promptImages } : undefined)
    await waitForPiSessionSettled(session as unknown as PiSessionDrainTarget)
    if (params.signal?.aborted) {
      throw toAbortError(params.signal)
    }

    return {
      ok: true,
      output: resolvePiPromptOutput(session.messages, turnStartIndex, state),
      sessionId: session.sessionId,
      usage: extractPiAssistantUsage(getLatestAssistantMessage(session.messages)),
    }
  } catch (error) {
    if (params.signal?.aborted || (error instanceof Error && error.name === 'AbortError')) {
      throw toAbortError(params.signal)
    }

    emitAgentEvent('Pi', params.onEvent, {
      type: 'session.error',
      properties: {
        error: error instanceof Error ? error.message : 'Pi 执行失败',
        message: error instanceof Error ? error.message : 'Pi 执行失败',
      },
    })
    throw error
  } finally {
    params.signal?.removeEventListener('abort', abortHandler)
    unsubscribe()
    restorePiToolCallStream()
    session.dispose()
    await preparedAttachments.cleanup()
    await mcpTools.cleanup()
    runtime.cleanup()
  }
}

export const runPiPrompt = async (params: WorkerAgentPromptParams): Promise<WorkerAgentPromptResult> => {
  const restorePiFetchPatch = installPiOpenAiCompatibleFetchPatch()
  try {
    return await runPiPromptWithPatchedFetch(params)
  } finally {
    restorePiFetchPatch()
  }
}
