// [INPUT]: OpenCode 共享输入
// [OUTPUT]: 共享工具
// [POS]: OpenCode 共享
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import {
  extractOpenCodeTextOutput,
  getOpenCodeAssistantEntriesForPrompt,
  getOpenCodeErrorFromMessageEntries,
  getOpenCodeOutputFromMessageEntries,
  hasSettledOpenCodeAssistantEntry,
  isOpenCodeMissingTextOutput,
  OPENCODE_MISSING_TEXT_OUTPUT_ERROR_MESSAGE,
} from '@shared/opencode-message-output'
import type { AgentRuntimeSettings, ModelTokenUsage } from '@shared/types'

export type PromptPart = {
  id?: string
  sessionID?: string
  messageID?: string
  type: string
  text?: string
  tool?: string
  callID?: string
  state?: {
    status?: 'pending' | 'running' | 'completed' | 'error'
    input?: Record<string, unknown>
    output?: string
    error?: string
    raw?: string
    time?: {
      start?: number
      end?: number
    }
  }
  time?: {
    start?: number
    end?: number
  }
}

export type PromptMessageInfo = {
  id?: string
  sessionID?: string
  role?: string
  time?: {
    created?: number
    completed?: number
  }
  error?: unknown
  /** OpenCode SDK AssistantMessage 的 token 计数（message.updated / session.messages 的 info 携带）。 */
  tokens?: {
    input?: number
    output?: number
    reasoning?: number
    cache?: {
      read?: number
      write?: number
    }
  }
  modelID?: string
  providerID?: string
  cost?: number
}

export type PromptMessageEntry = {
  info?: PromptMessageInfo
  parts?: PromptPart[]
}

export type OpenCodePromptEvent = {
  type: 'session.status' | 'message.updated' | 'message.part.updated' | 'message.part.delta' | 'permission.updated' | 'session.error' | 'session.idle'
  properties: Record<string, unknown>
}

export const createOpenCodeSessionErrorEvent = (sessionId: string, message: string): OpenCodePromptEvent => ({
  type: 'session.error',
  properties: {
    sessionID: sessionId,
    error: message,
    message,
  },
})

export const logWorkerOpencodeDebug = (stage: string, payload: Record<string, unknown>) => {
  console.log(`[worker-opencode] ${stage}`, JSON.stringify(payload))
}

export const getErrorText = (error: unknown) => {
  if (error instanceof Error) {
    return error.message
  }

  if (typeof error === 'string') {
    return error
  }

  if (error && typeof error === 'object') {
    const maybeError = error as {
      message?: unknown
      data?: { message?: unknown }
      error?: { message?: unknown; data?: { message?: unknown } }
    }

    if (typeof maybeError.message === 'string' && maybeError.message.trim()) {
      return maybeError.message
    }

    if (typeof maybeError.data?.message === 'string' && maybeError.data.message.trim()) {
      return maybeError.data.message
    }

    if (typeof maybeError.error?.message === 'string' && maybeError.error.message.trim()) {
      return maybeError.error.message
    }

    if (typeof maybeError.error?.data?.message === 'string' && maybeError.error.data.message.trim()) {
      return maybeError.error.data.message
    }
  }

  return 'OpenCode 执行失败。'
}

export const parseExecutionModel = (model?: string) => {
  if (!model) {
    return undefined
  }

  const [providerID, ...rest] = model.split('/')
  const modelID = rest.join('/')
  if (!providerID || !modelID) {
    return undefined
  }

  return { providerID, modelID }
}

export const getParts = (parts?: PromptPart[]) => Array.isArray(parts) ? parts : []

export { isOpenCodeMissingTextOutput, OPENCODE_MISSING_TEXT_OUTPUT_ERROR_MESSAGE }

export const extractTextOutput = (parts: PromptPart[]) => extractOpenCodeTextOutput(parts)

export const extractOpencodeAssistantUsage = (info?: PromptMessageInfo): ModelTokenUsage | undefined => {
  const tokens = info?.tokens
  if (!tokens) {
    return undefined
  }

  const inputTokens = normalizeUsageCount(tokens.input)
  const outputTokens = normalizeUsageCount(tokens.output)
  const reasoningTokens = normalizeUsageCount(tokens.reasoning)
  const cacheReadTokens = normalizeUsageCount(tokens.cache?.read)
  const cacheWriteTokens = normalizeUsageCount(tokens.cache?.write)
  if (inputTokens <= 0 && outputTokens <= 0 && reasoningTokens <= 0) {
    return undefined
  }

  return {
    inputTokens,
    outputTokens,
    reasoningTokens: reasoningTokens > 0 ? reasoningTokens : undefined,
    cacheReadTokens: cacheReadTokens > 0 ? cacheReadTokens : undefined,
    cacheWriteTokens: cacheWriteTokens > 0 ? cacheWriteTokens : undefined,
    /** 真实消耗口径：input + output + reasoning；cache 读写单独列，不计入总量。 */
    totalTokens: inputTokens + outputTokens + reasoningTokens,
  }
}

const normalizeUsageCount = (value: number | undefined) => {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.round(value) : 0
}

export const summarizeEntries = (entries: PromptMessageEntry[]) => {
  return entries.map((entry) => ({
    id: entry.info?.id,
    role: entry.info?.role,
    created: entry.info?.time?.created,
    completed: Boolean(entry.info?.time?.completed),
    error: Boolean(entry.info?.error),
    partTypes: getParts(entry.parts).map((part) => part.type),
    textPreview: extractTextOutput(getParts(entry.parts)).slice(0, 160),
  }))
}

export const getOutputFromMessageEntries = (
  entries: PromptMessageEntry[],
  preferredMessageId?: string,
  promptStartedAtMs?: number,
) => {
  return getOpenCodeOutputFromMessageEntries(entries, {
    preferredMessageId,
    promptStartedAtMs,
  })
}

export const getErrorFromMessageEntries = (
  entries: PromptMessageEntry[],
  preferredMessageId?: string,
  promptStartedAtMs?: number,
) => {
  return getOpenCodeErrorFromMessageEntries(entries, {
    preferredMessageId,
    promptStartedAtMs,
  })
}

export const getAssistantEntriesForPrompt = (
  entries: PromptMessageEntry[],
  preferredMessageId?: string,
  promptStartedAtMs?: number,
) => {
  return getOpenCodeAssistantEntriesForPrompt(entries, {
    preferredMessageId,
    promptStartedAtMs,
  }) as PromptMessageEntry[]
}

export const hasSettledAssistantEntry = (
  entries: PromptMessageEntry[],
  preferredMessageId?: string,
  promptStartedAtMs?: number,
) => {
  return hasSettledOpenCodeAssistantEntry(entries, {
    preferredMessageId,
    promptStartedAtMs,
  })
}

export const extractStreamingText = (parts: Map<string, string>) => {
  return [...parts.values()]
    .join('')
    .trim()
}

export const getMessageTextState = (state: Map<string, Map<string, string>>, messageId: string) => {
  const existing = state.get(messageId)
  if (existing) {
    return existing
  }

  const next = new Map<string, string>()
  state.set(messageId, next)
  return next
}

export const applyOpenCodePartTextDelta = (
  state: Map<string, Map<string, string>>,
  delta: Record<string, unknown>,
) => {
  const messageId = typeof delta.messageID === 'string' ? delta.messageID.trim() : ''
  const partId = typeof delta.partID === 'string' ? delta.partID.trim() : ''
  const textDelta = typeof delta.delta === 'string' ? delta.delta : ''
  if (!messageId || !partId || delta.field !== 'text' || !textDelta) {
    return undefined
  }

  const partState = getMessageTextState(state, messageId)
  const previousText = partState.get(partId) ?? ''
  const text = `${previousText}${textDelta}`
  partState.set(partId, text)

  return {
    id: partId,
    sessionID: typeof delta.sessionID === 'string' ? delta.sessionID : undefined,
    messageID: messageId,
    type: 'text',
    text,
  } satisfies PromptPart
}

export const sleep = async (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

export const parseOpenCodePermissionPolicy = (value?: string): unknown => {
  const normalized = value?.trim()
  if (!normalized || normalized.toLowerCase() === 'default') {
    return undefined
  }

  if (normalized.startsWith('{') || normalized.startsWith('[') || normalized.startsWith('"')) {
    try {
      const parsed = JSON.parse(normalized) as unknown
      if (typeof parsed === 'string') {
        return parseOpenCodePermissionPolicy(parsed)
      }
      if (parsed && typeof parsed === 'object') {
        return parsed
      }
    } catch {
      // ignore invalid JSON-like input and fall through to shorthand mapping
    }
  }

  switch (normalized.toLowerCase()) {
    case 'auto':
    case 'allow':
    case 'approve':
    case 'acceptedits':
    case 'bypasspermissions':
    case 'yolo':
      return 'allow'
    case 'ask':
    case 'prompt':
    case 'manual':
      return 'ask'
    case 'deny':
    case 'disabled':
    case 'forbid':
      return 'deny'
    default:
      return undefined
  }
}

export const resolveOpenCodeAgentSettings = (settings?: AgentRuntimeSettings) => {
  return settings && 'permissionPolicy' in settings ? settings : undefined
}
