// [INPUT]: Agent 工具调用记录
// [OUTPUT]: 持久化结果
// [POS]: Agent 工具调用持久化
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import type { Task } from '@shared/types'

const MAX_TOOL_INLINE_DETAIL_LENGTH = 240
const MAX_TOOL_ERROR_LENGTH = 500
const TOOL_DETAIL_KEYS = [
  'command',
  'cmd',
  'path',
  'filePath',
  'filepath',
  'filename',
  'file',
  'pattern',
  'query',
  'q',
  'url',
] as const
const LARGE_TOOL_PAYLOAD_KEYS = new Set(['content', 'contents', 'body', 'data', 'output', 'result', 'text', 'diff', 'patch'])

const toIsoTime = (value?: number) => (typeof value === 'number' ? new Date(value).toISOString() : new Date().toISOString())

const isInteractiveQuestionTool = (toolName: string) => ['question', 'AskUserQuestion'].includes(toolName)
const isTaskCreationTool = (toolName: string) => ['task.create', 'task.create_subtask'].includes(toolName)

const serializeToolInput = (input?: Record<string, unknown>) => {
  try {
    return JSON.stringify(input ?? {}, null, 2)
  } catch {
    return '{}'
  }
}

const hasMeaningfulToolArgs = (value?: string) => {
  const normalized = value?.trim()
  return Boolean(normalized && normalized !== '{}' && normalized !== '[]')
}

const collapseInlineText = (value: string) => value.replace(/\s+/g, ' ').trim()

const truncateInlineText = (value: string, limit = MAX_TOOL_INLINE_DETAIL_LENGTH) => {
  const normalized = collapseInlineText(value)
  return normalized.length > limit ? `${normalized.slice(0, Math.max(0, limit - 3)).trimEnd()}...` : normalized
}

const parseJsonValue = (value: string): unknown | undefined => {
  try {
    return JSON.parse(value) as unknown
  } catch {
    return undefined
  }
}

const formatInlineValue = (value: unknown): string => {
  if (typeof value === 'string') {
    return truncateInlineText(value)
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value)
  }

  if (Array.isArray(value)) {
    const values = value
      .map((item) => formatInlineValue(item))
      .filter(Boolean)
      .slice(0, 3)
    return truncateInlineText(values.join(', '))
  }

  return ''
}

const buildToolArgsPreviewFromObject = (input: Record<string, unknown>) => {
  const parts: string[] = []

  for (const key of TOOL_DETAIL_KEYS) {
    if (!(key in input)) {
      continue
    }

    const value = formatInlineValue(input[key])
    if (value) {
      parts.push(`${key}: ${value}`)
    }
    if (parts.length >= 2) {
      break
    }
  }

  if (parts.length > 0) {
    return truncateInlineText(parts.join(' - '))
  }

  const fallbackKey = Object.keys(input).find((key) => !LARGE_TOOL_PAYLOAD_KEYS.has(key) && formatInlineValue(input[key]))
  return fallbackKey ? truncateInlineText(`${fallbackKey}: ${formatInlineValue(input[fallbackKey])}`) : ''
}

const buildToolArgsPreviewFromValue = (value: unknown): string => {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return buildToolArgsPreviewFromObject(value as Record<string, unknown>)
  }

  if (Array.isArray(value)) {
    const values = value
      .map((item) => buildToolArgsPreviewFromValue(item) || formatInlineValue(item))
      .filter(Boolean)
      .slice(0, 3)
    return truncateInlineText(values.join(' - '))
  }

  return formatInlineValue(value)
}

const buildToolArgsPreview = (raw?: string, input?: Record<string, unknown>) => {
  if (input) {
    const inputPreview = buildToolArgsPreviewFromValue(input)
    if (inputPreview) {
      return inputPreview
    }
  }

  const normalized = raw?.trim() ?? ''
  if (!normalized || normalized === '{}' || normalized === '[]') {
    return normalized
  }

  const parsed = parseJsonValue(normalized)
  if (parsed !== undefined) {
    const parsedPreview = buildToolArgsPreviewFromValue(parsed)
    if (parsedPreview) {
      return parsedPreview
    }
  }

  const firstLine = normalized.split(/\r?\n/).find((line) => line.trim())?.trim() ?? ''
  return truncateInlineText(firstLine)
}

const buildToolResultPreview = (value?: string, options?: { keepMultiline?: boolean }) => {
  const normalized = value?.trim() ?? ''
  if (!normalized) {
    return undefined
  }

  if (!options?.keepMultiline && /\r|\n/.test(normalized)) {
    return undefined
  }

  if (!options?.keepMultiline && normalized.length > MAX_TOOL_INLINE_DETAIL_LENGTH) {
    return undefined
  }

  return truncateInlineText(normalized, options?.keepMultiline ? MAX_TOOL_ERROR_LENGTH : MAX_TOOL_INLINE_DETAIL_LENGTH)
}

const buildTaskCreationResultPreview = (value?: string) => {
  const normalized = value?.trim() ?? ''
  if (!normalized) {
    return undefined
  }

  const parsed = parseJsonValue(normalized)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return buildToolResultPreview(value)
  }

  const task = (parsed as { task?: Record<string, unknown> }).task
  if (!task || typeof task !== 'object' || Array.isArray(task)) {
    return buildToolResultPreview(value)
  }

  const taskId = typeof task.id === 'string' ? task.id.trim() : ''
  const taskTitle = typeof task.title === 'string' ? task.title.trim() : ''
  const taskStatus = typeof task.status === 'string' ? task.status.trim() : ''
  const projectName = typeof task.projectName === 'string' ? task.projectName.trim() : ''
  const parts = [
    taskTitle ? `title=${taskTitle}` : '',
    taskId ? `taskId=${taskId}` : '',
    taskStatus ? `status=${taskStatus}` : '',
    projectName ? `project=${projectName}` : '',
  ].filter(Boolean)

  if (parts.length === 0) {
    return buildToolResultPreview(value)
  }

  return truncateInlineText(parts.join(' | '))
}

export const buildToolCall = (
  part: {
    id: string
    tool: string
    state: {
      status: 'pending' | 'running' | 'completed' | 'error'
      input?: Record<string, unknown>
      output?: string
      error?: string
      raw?: string
      time?: {
        start?: number
        end?: number
      }
    }
  },
  existing?: Task['toolCalls'][number],
) => {
  const nextArgs = part.state.raw ?? serializeToolInput(part.state.input)
  const nextArgsPreview = buildToolArgsPreview(part.state.raw, part.state.input)
  const args = hasMeaningfulToolArgs(nextArgsPreview) ? nextArgsPreview : (existing?.args ?? nextArgsPreview)
  const name = part.tool === 'tool' && existing?.name ? existing.name : part.tool
  const parsedOutput = typeof part.state.output === 'string' ? parseJsonValue(part.state.output) : undefined
  const parsedOutputRecord = parsedOutput && typeof parsedOutput === 'object' && !Array.isArray(parsedOutput)
    ? parsedOutput as Record<string, unknown>
    : undefined
  const parsedOutputTaskRecord = parsedOutputRecord?.task && typeof parsedOutputRecord.task === 'object' && !Array.isArray(parsedOutputRecord.task)
    ? parsedOutputRecord.task as Record<string, unknown>
    : undefined
  const result = part.state.status === 'completed'
    ? (isTaskCreationTool(name) ? buildTaskCreationResultPreview(part.state.output) : buildToolResultPreview(part.state.output))
    : part.state.status === 'error'
      ? buildToolResultPreview(part.state.error, { keepMultiline: true })
      : existing?.result

  const waitingForUserInput = isInteractiveQuestionTool(name) && (part.state.status === 'pending' || part.state.status === 'running')
  const resultPreviewTaskId = isTaskCreationTool(name)
    && typeof parsedOutputTaskRecord?.id === 'string'
    ? (parsedOutputTaskRecord.id.trim() || undefined)
    : existing?.metadata?.resultPreviewTaskId
  const metadata = resultPreviewTaskId
    ? {
        resultPreviewKind: 'task_created' as const,
        resultPreviewTaskId,
      }
    : existing?.metadata

  return {
    id: part.id,
    name,
    args,
    result,
    startedAt: existing?.startedAt ?? toIsoTime(part.state.time?.start),
    finishedAt: part.state.status === 'completed' || part.state.status === 'error' || waitingForUserInput ? toIsoTime(part.state.time?.end) : undefined,
    metadata,
  }
}
