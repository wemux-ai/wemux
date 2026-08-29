// [INPUT]: 消息输出输入
// [OUTPUT]: 输出规范化
// [POS]: OpenCode 消息输出
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

type OpenCodePromptPartLike = {
  type?: string
  text?: string
}

type OpenCodePromptMessageInfoLike = {
  id?: string
  role?: string
  time?: {
    created?: number
    completed?: number
  }
  error?: unknown
}

export type OpenCodePromptMessageEntryLike = {
  info?: OpenCodePromptMessageInfoLike
  parts?: readonly OpenCodePromptPartLike[]
}

type OpenCodeMessageSelectionOptions = {
  preferredMessageId?: string
  promptStartedAtMs?: number
}

export const OPENCODE_MISSING_TEXT_OUTPUT_ERROR_MESSAGE = 'OpenCode 未生成有效文本回复，请重试。'

const OPENCODE_MISSING_TEXT_OUTPUT_PLACEHOLDERS = new Set([
  'OpenCode 未返回文本输出。',
  'OpenCode 已处理完成，但没有返回文本输出。',
  OPENCODE_MISSING_TEXT_OUTPUT_ERROR_MESSAGE,
])

const getParts = (parts?: readonly OpenCodePromptPartLike[]) => Array.isArray(parts) ? parts : []

const isAssistantEntry = (entry: OpenCodePromptMessageEntryLike) => entry.info?.role === 'assistant'

const getCreatedAt = (entry: OpenCodePromptMessageEntryLike) => entry.info?.time?.created ?? 0

const matchesPromptWindow = (
  entry: OpenCodePromptMessageEntryLike,
  promptStartedAtMs?: number,
) => {
  if (promptStartedAtMs === undefined) {
    return true
  }

  return getCreatedAt(entry) >= promptStartedAtMs
}

const getCandidateAssistantEntries = (
  entries: readonly OpenCodePromptMessageEntryLike[],
  options: OpenCodeMessageSelectionOptions = {},
) => {
  return entries
    .filter((entry) => isAssistantEntry(entry) && matchesPromptWindow(entry, options.promptStartedAtMs))
    .sort((left, right) => getCreatedAt(right) - getCreatedAt(left))
}

const extractOpenCodeErrorText = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message.trim()
  }

  if (typeof error === 'string') {
    return error.trim()
  }

  if (!error || typeof error !== 'object') {
    return ''
  }

  const maybeError = error as {
    message?: unknown
    data?: { message?: unknown }
    error?: unknown
  }
  if (typeof maybeError.message === 'string' && maybeError.message.trim()) {
    return maybeError.message.trim()
  }

  if (typeof maybeError.data?.message === 'string' && maybeError.data.message.trim()) {
    return maybeError.data.message.trim()
  }

  const nestedError = extractOpenCodeErrorText(maybeError.error)
  if (nestedError) {
    return nestedError
  }

  try {
    const serialized = JSON.stringify(error)
    return serialized === '{}' ? '' : serialized
  } catch {
    return ''
  }
}

const getOpenCodeErrorFromEntry = (entry?: OpenCodePromptMessageEntryLike) => {
  return extractOpenCodeErrorText(entry?.info?.error)
}

export const getOpenCodeAssistantEntriesForPrompt = (
  entries: readonly OpenCodePromptMessageEntryLike[],
  options: OpenCodeMessageSelectionOptions = {},
) => {
  if (options.preferredMessageId) {
    return entries.filter((entry) => entry.info?.id === options.preferredMessageId)
  }

  return getCandidateAssistantEntries(entries, options)
    .slice()
    .sort((left, right) => getCreatedAt(left) - getCreatedAt(right))
}

export const extractOpenCodeTextOutput = (parts?: readonly OpenCodePromptPartLike[]) => {
  return getParts(parts)
    .filter((part) => part.type === 'text')
    .map((part) => part.text?.trim() ?? '')
    .filter(Boolean)
    .join('\n\n')
}

export const isOpenCodeMissingTextOutput = (output?: string | null) => {
  const normalized = output?.trim() ?? ''
  return !normalized || OPENCODE_MISSING_TEXT_OUTPUT_PLACEHOLDERS.has(normalized)
}

export const getOpenCodeOutputFromMessageEntries = (
  entries: readonly OpenCodePromptMessageEntryLike[],
  options: OpenCodeMessageSelectionOptions = {},
) => {
  const preferredEntry = options.preferredMessageId
    ? entries.find((entry) => entry.info?.id === options.preferredMessageId)
    : undefined
  const preferredOutput = extractOpenCodeTextOutput(preferredEntry?.parts)
  if (preferredOutput) {
    return preferredOutput
  }

  const latestAssistantEntry = getCandidateAssistantEntries(entries, options)
    .find((entry) => extractOpenCodeTextOutput(entry.parts))

  return latestAssistantEntry ? extractOpenCodeTextOutput(latestAssistantEntry.parts) : ''
}

export const getOpenCodeErrorFromMessageEntries = (
  entries: readonly OpenCodePromptMessageEntryLike[],
  options: OpenCodeMessageSelectionOptions = {},
) => {
  const preferredEntry = options.preferredMessageId
    ? entries.find((entry) => entry.info?.id === options.preferredMessageId)
    : undefined
  const preferredError = getOpenCodeErrorFromEntry(preferredEntry)
  if (preferredError) {
    return preferredError
  }

  const latestErroredAssistantEntry = getCandidateAssistantEntries(entries, options)
    .find((entry) => getOpenCodeErrorFromEntry(entry))

  return getOpenCodeErrorFromEntry(latestErroredAssistantEntry)
}

export const isOpenCodeMessageSettled = (entry?: OpenCodePromptMessageEntryLike) => {
  return Boolean(entry?.info?.time?.completed) || Boolean(entry?.info?.error)
}

export const hasSettledOpenCodeAssistantEntry = (
  entries: readonly OpenCodePromptMessageEntryLike[],
  options: OpenCodeMessageSelectionOptions = {},
) => {
  const preferredEntry = options.preferredMessageId
    ? entries.find((entry) => entry.info?.id === options.preferredMessageId)
    : undefined

  if (preferredEntry && isOpenCodeMessageSettled(preferredEntry)) {
    return true
  }

  return getCandidateAssistantEntries(entries, options).some((entry) => isOpenCodeMessageSettled(entry))
}
