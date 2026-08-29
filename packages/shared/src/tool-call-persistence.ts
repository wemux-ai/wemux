// [INPUT]: 工具调用输入
// [OUTPUT]: 持久化模型
// [POS]: 工具调用持久化
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import type { ToolCall } from './types'

const TOOL_CALL_PERSISTENCE_META_MARKER = '[tool_call_persistence_meta]'
const TOOL_CALL_TRUNCATED_PREVIEW_SUFFIX = '…(结果已截断，完整输出未写入历史存储)'
const TOOL_CALL_CONTENT_OMITTED_SUFFIX = '（工具输入与输出未写入历史存储）'
const TOOL_CALL_PREVIEW_MAX_LENGTH = 160

const TOOL_ARG_PATH_KEYS = [
  'file_path',
  'filepath',
  'path',
  'paths',
  'file',
  'filename',
  'target_file',
  'target',
  'cwd',
] as const

const TOOL_ARG_COMMAND_KEYS = ['command', 'cmd', 'script', 'input'] as const
const TOOL_ARG_SEARCH_KEYS = ['pattern', 'query', 'q', 'term'] as const

export type ToolCallPersistenceMetadata = {
  contentOmitted: true
  argsStored: false
  resultStored: false
  argsLength: number
  resultLength: number
}

export type ToolCallPersistenceDisplay = {
  args?: string
  result?: string
  meta?: ToolCallPersistenceMetadata
  contentOmitted: boolean
}

const normalizeToolCallText = (value?: string) => {
  const normalized = value?.trim()
  return normalized ? normalized : undefined
}

const normalizeInlineText = (value: string) => value.replace(/\s+/g, ' ').trim()

const truncateInlineText = (value: string, maxLength = TOOL_CALL_PREVIEW_MAX_LENGTH) => {
  const normalized = normalizeInlineText(value)
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength - 1)}…` : normalized
}

const parseToolArgs = (args?: string): unknown => {
  const normalized = normalizeToolCallText(args)
  if (!normalized) {
    return undefined
  }

  try {
    return JSON.parse(normalized)
  } catch {
    return normalized
  }
}

const findFirstValueByKeys = (value: unknown, keys: readonly string[]): unknown => {
  if (!value || typeof value !== 'object') {
    return undefined
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findFirstValueByKeys(item, keys)
      if (found !== undefined) {
        return found
      }
    }
    return undefined
  }

  const record = value as Record<string, unknown>
  for (const key of keys) {
    if (record[key] !== undefined) {
      return record[key]
    }
  }

  for (const item of Object.values(record)) {
    const found = findFirstValueByKeys(item, keys)
    if (found !== undefined) {
      return found
    }
  }

  return undefined
}

const formatPreviewValue = (value: unknown): string => {
  if (typeof value === 'string') {
    return truncateInlineText(value)
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value)
  }

  if (Array.isArray(value)) {
    const parts = value.map(formatPreviewValue).filter(Boolean)
    return truncateInlineText(parts.join(', '))
  }

  return ''
}

const buildToolArgsPreview = (toolCall: Pick<ToolCall, 'name' | 'args'>) => {
  const parsedArgs = parseToolArgs(toolCall.args)
  const normalizedName = toolCall.name.toLowerCase()
  const command = formatPreviewValue(findFirstValueByKeys(parsedArgs, TOOL_ARG_COMMAND_KEYS))
  const path = formatPreviewValue(findFirstValueByKeys(parsedArgs, TOOL_ARG_PATH_KEYS))
  const search = formatPreviewValue(findFirstValueByKeys(parsedArgs, TOOL_ARG_SEARCH_KEYS))

  if (normalizedName.includes('bash') || normalizedName.includes('shell') || normalizedName.includes('exec') || normalizedName.includes('command')) {
    return command || (typeof parsedArgs === 'string' ? truncateInlineText(parsedArgs) : '')
  }

  if (normalizedName.includes('grep') || normalizedName.includes('search') || normalizedName.includes('find')) {
    if (search && path) {
      return truncateInlineText(`${search} · ${path}`)
    }
    return search || path || command
  }

  if (path) {
    return path
  }

  if (command) {
    return command
  }

  if (search) {
    return search
  }

  return typeof parsedArgs === 'string' && !parsedArgs.includes('\n') ? truncateInlineText(parsedArgs) : ''
}

const buildToolCallPersistenceMetadata = (toolCall: Pick<ToolCall, 'args' | 'result'>): ToolCallPersistenceMetadata => ({
  contentOmitted: true,
  argsStored: false,
  resultStored: false,
  argsLength: toolCall.args?.length ?? 0,
  resultLength: toolCall.result?.length ?? 0,
})

const buildToolCallMetadataMarker = (meta: ToolCallPersistenceMetadata) => {
  return `${TOOL_CALL_PERSISTENCE_META_MARKER}\n${JSON.stringify(meta)}`
}

const parseLegacyTruncationMetadata = (value: string): ToolCallPersistenceMetadata | undefined => {
  try {
    const parsed = JSON.parse(value) as Partial<{
      truncated: true
      argsLength: number
      resultLength: number
      argsTruncated: boolean
      resultTruncated: boolean
      contentOmitted: true
      argsStored: false
      resultStored: false
    }>

    if (parsed?.contentOmitted === true) {
      return {
        contentOmitted: true,
        argsStored: false,
        resultStored: false,
        argsLength: Number.isFinite(parsed.argsLength) ? Number(parsed.argsLength) : 0,
        resultLength: Number.isFinite(parsed.resultLength) ? Number(parsed.resultLength) : 0,
      }
    }

    if (parsed?.truncated !== true) {
      return undefined
    }

    return {
      contentOmitted: true,
      argsStored: false,
      resultStored: false,
      argsLength: Number.isFinite(parsed.argsLength) ? Number(parsed.argsLength) : 0,
      resultLength: Number.isFinite(parsed.resultLength) ? Number(parsed.resultLength) : 0,
    }
  } catch {
    return undefined
  }
}

const parseStoredToolCallArgs = (value?: string) => {
  const normalized = normalizeToolCallText(value)
  if (!normalized) {
    return {
      args: undefined,
      meta: undefined,
      contentOmitted: false,
    }
  }

  const markerIndex = normalized.indexOf(TOOL_CALL_PERSISTENCE_META_MARKER)
  if (markerIndex >= 0) {
    const args = normalized.slice(0, markerIndex).trim() || undefined
    const metaText = normalized.slice(markerIndex + TOOL_CALL_PERSISTENCE_META_MARKER.length).trim()
    return {
      args,
      meta: metaText ? parseLegacyTruncationMetadata(metaText) : undefined,
      contentOmitted: true,
    }
  }

  if (normalized === TOOL_CALL_CONTENT_OMITTED_SUFFIX) {
    return {
      args: undefined,
      meta: buildToolCallPersistenceMetadata({ args: normalized, result: undefined }),
      contentOmitted: true,
    }
  }

  return {
    args: normalized,
    meta: undefined,
    contentOmitted: false,
  }
}

const parseStoredToolCallResult = (value?: string) => {
  const normalized = normalizeToolCallText(value)
  if (!normalized) {
    return {
      result: undefined,
      contentOmitted: false,
    }
  }

  if (
    normalized === TOOL_CALL_CONTENT_OMITTED_SUFFIX
    || normalized.endsWith(TOOL_CALL_TRUNCATED_PREVIEW_SUFFIX)
  ) {
    return {
      result: undefined,
      contentOmitted: true,
    }
  }

  return {
    result: normalized,
    contentOmitted: false,
  }
}

const buildOmittedPreview = (toolCall: ToolCall) => {
  const meta = buildToolCallPersistenceMetadata(toolCall)
  const argsPreview = buildToolArgsPreview(toolCall)
  const args = argsPreview
    ? `${argsPreview}\n\n${buildToolCallMetadataMarker(meta)}`
    : buildToolCallMetadataMarker(meta)

  return {
    ...toolCall,
    args,
    result: undefined,
  }
}

export const sanitizeToolCallForPersistence = (toolCall: ToolCall): ToolCall => {
  return buildOmittedPreview(toolCall)
}

export const sanitizeToolCallsForPersistence = (toolCalls: ToolCall[]) => {
  return toolCalls.map(sanitizeToolCallForPersistence)
}

export const toolCallHasOmittedPersistenceContent = (toolCall: Pick<ToolCall, 'args' | 'result'>) => {
  return getToolCallPersistenceDisplay(toolCall).contentOmitted
}

export const toolCallHasTruncatedPersistencePreview = (toolCall: Pick<ToolCall, 'args' | 'result'>) => {
  return toolCallHasOmittedPersistenceContent(toolCall)
}

export const getToolCallPersistenceDisplay = (toolCall: Pick<ToolCall, 'args' | 'result'>): ToolCallPersistenceDisplay => {
  const argsState = parseStoredToolCallArgs(toolCall.args)
  const resultState = parseStoredToolCallResult(toolCall.result)

  return {
    args: argsState.args,
    result: resultState.result,
    meta: argsState.meta,
    contentOmitted: argsState.contentOmitted || resultState.contentOmitted,
  }
}

export const getToolCallPersistenceOmittedLabel = () => TOOL_CALL_CONTENT_OMITTED_SUFFIX
