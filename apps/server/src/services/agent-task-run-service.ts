/**
 * [INPUT]: Agent event prompts, executor stream events, lifecycle outcomes, and model usage.
 * [OUTPUT]: Throttled live transcript snapshots, compact assistant-output previews, runtime heartbeats, usage aggregation, and normalized failure codes.
 * [POS]: Task Agent run projection layer between the generic event runtime and AgentTaskRun persistence.
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */
import type {
  AgentRunningStatus,
  AgentTaskRunFailureCode,
  ChatMessage,
  ModelTokenUsage,
  ToolCall,
} from '@shared/types'
import { updateAgentTaskRun } from '../storage/postgres/agent-task-run-store'

type AgentTaskRunStreamEvent =
  | { type: 'status'; status: 'thinking' | 'executing' | 'complete' | 'error'; currentStep: string }
  | { type: 'delta'; content: string }
  | { type: 'reasoning'; partId: string; content: string }
  | { type: 'tool'; status: 'pending' | 'running' | 'completed' | 'error'; toolCall: ToolCall }

const normalizeUsageValue = (value: number | undefined) => (
  typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0
)

const normalizeTranscriptPreview = (value: string) => value.replace(/\s+/g, ' ').trim()

export const summarizeAgentTaskRunTranscript = (
  messages: ChatMessage[],
  maxLength = 160,
) => {
  const assistant = [...messages]
    .reverse()
    .find((message) => message.role === 'assistant' && normalizeTranscriptPreview(message.content))
  const content = normalizeTranscriptPreview(assistant?.content ?? '')
  if (!content || maxLength <= 0) return undefined
  return content.length > maxLength ? `${content.slice(0, maxLength).trimEnd()}…` : content
}

export const mergeAgentTaskRunUsage = (
  current?: ModelTokenUsage,
  next?: ModelTokenUsage,
): ModelTokenUsage | undefined => {
  if (!current && !next) return undefined
  return {
    inputTokens: normalizeUsageValue(current?.inputTokens) + normalizeUsageValue(next?.inputTokens),
    outputTokens: normalizeUsageValue(current?.outputTokens) + normalizeUsageValue(next?.outputTokens),
    reasoningTokens: normalizeUsageValue(current?.reasoningTokens) + normalizeUsageValue(next?.reasoningTokens) || undefined,
    cacheReadTokens: normalizeUsageValue(current?.cacheReadTokens) + normalizeUsageValue(next?.cacheReadTokens) || undefined,
    cacheWriteTokens: normalizeUsageValue(current?.cacheWriteTokens) + normalizeUsageValue(next?.cacheWriteTokens) || undefined,
    totalTokens: normalizeUsageValue(current?.totalTokens) + normalizeUsageValue(next?.totalTokens),
  }
}

export const classifyAgentTaskRunFailure = (params: {
  message: string
  retryableInfrastructure?: boolean
  poisoned?: boolean
}): AgentTaskRunFailureCode => {
  const message = params.message.toLowerCase()
  if (params.poisoned) return 'context_poisoned'
  if (message.includes('task.delivery.report')) return 'delivery_missing'
  if (message.includes('没有在线执行节点') || message.includes('执行器当前未在线')) {
    return 'infrastructure_unavailable'
  }
  if (params.retryableInfrastructure) return 'infrastructure_interrupted'
  return 'execution_failed'
}

const resolveRunningStatus = (status: Extract<AgentTaskRunStreamEvent, { type: 'status' }>['status']): AgentRunningStatus => {
  if (status === 'executing') return 'executing'
  if (status === 'complete') return 'complete'
  if (status === 'error') return 'error'
  return 'thinking'
}

export const createAgentTaskRunTranscriptCapture = (params: {
  agentTaskId: string
  agentId: string
  agentName: string
  prompt: string
  startedAt: string
  onHeartbeat?: () => void
  onTranscriptChange?: () => void
}) => {
  let messages: ChatMessage[] = []
  let currentAssistantId = ''
  let usage: ModelTokenUsage | undefined
  let flushTimer: NodeJS.Timeout | null = null
  const reasoningByPart = new Map<string, string>()
  const toolCallsById = new Map<string, ToolCall>()

  const flush = () => {
    if (flushTimer) clearTimeout(flushTimer)
    flushTimer = null
    updateAgentTaskRun(params.agentTaskId, {
      transcript: messages,
      usage,
      lastHeartbeatAt: new Date().toISOString(),
    })
    params.onTranscriptChange?.()
  }

  const scheduleFlush = () => {
    if (flushTimer) return
    flushTimer = setTimeout(flush, 1_000)
  }

  const appendPrompt = (prompt: string, createdAt = new Date().toISOString()) => {
    currentAssistantId = ''
    reasoningByPart.clear()
    toolCallsById.clear()
    messages = [
      ...messages,
      {
        id: `agent-task-run:${params.agentTaskId}:user:${messages.length}`,
        role: 'user',
        content: prompt,
        createdAt,
        authorType: 'system',
      },
    ]
    scheduleFlush()
  }

  const updateAssistant = (patch: Partial<ChatMessage>) => {
    let assistantIndex = currentAssistantId
      ? messages.findIndex((message) => message.id === currentAssistantId)
      : -1
    if (assistantIndex < 0) {
      currentAssistantId = `agent-task-run:${params.agentTaskId}:assistant:${messages.length}`
      messages = [
        ...messages,
        {
          id: currentAssistantId,
          role: 'assistant',
          content: '',
          createdAt: new Date().toISOString(),
          authorType: 'agent',
          authorId: params.agentId,
          authorName: params.agentName,
        },
      ]
      assistantIndex = messages.length - 1
    }
    messages = messages.map((message, index) => (
      index === assistantIndex ? { ...message, ...patch } : message
    ))
    scheduleFlush()
  }

  const onEvent = (event: AgentTaskRunStreamEvent) => {
    if (event.type === 'delta') {
      const assistant = messages.find((message) => message.id === currentAssistantId)
      updateAssistant({ content: `${assistant?.content ?? ''}${event.content}` })
      return
    }
    if (event.type === 'reasoning') {
      reasoningByPart.set(event.partId, event.content)
      updateAssistant({ reasoning: [...reasoningByPart.values()].filter(Boolean) })
      return
    }
    if (event.type === 'tool') {
      toolCallsById.set(event.toolCall.id, event.toolCall)
      updateAssistant({ toolCalls: [...toolCallsById.values()] })
      return
    }
    updateAssistant({
      agentRunningStatus: resolveRunningStatus(event.status),
      currentStep: event.currentStep,
    })
  }

  const recordUsage = (nextUsage?: ModelTokenUsage) => {
    usage = mergeAgentTaskRunUsage(usage, nextUsage)
    if (usage) updateAssistant({ usage })
    return usage
  }

  const replaceTranscript = (nextMessages: ChatMessage[]) => {
    if (nextMessages.length > 0) messages = nextMessages
    currentAssistantId = ''
    reasoningByPart.clear()
    toolCallsById.clear()
    scheduleFlush()
  }

  const heartbeatTimer = setInterval(() => {
    updateAgentTaskRun(params.agentTaskId, { lastHeartbeatAt: new Date().toISOString() })
    params.onHeartbeat?.()
  }, 10_000)

  appendPrompt(params.prompt, params.startedAt)

  return {
    appendPrompt,
    onEvent,
    recordUsage,
    replaceTranscript,
    fail: (message: string) => {
      const assistant = messages.find((item) => item.id === currentAssistantId)
      updateAssistant({
        content: assistant?.content || message,
        agentRunningStatus: 'error',
        currentStep: message,
      })
    },
    finish: () => {
      clearInterval(heartbeatTimer)
      flush()
      return { messages, usage }
    },
  }
}
