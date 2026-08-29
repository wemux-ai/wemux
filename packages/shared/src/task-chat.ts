// [INPUT]: 任务对话输入
// [OUTPUT]: 对话契约
// [POS]: 任务对话类型
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import type { UIMessage } from 'ai'
import type { TaskChatAttachment } from './task-chat-attachment'
import type { TaskSubagentObservation } from './subagent-role'
import type { TaskChatSessionSnapshot } from './task-chat-session'
import type { ExecutionLog, Task } from './types'
import type { ChatTimelineEvent } from './timeline'

export type TaskChatRuntimeUpdate = Pick<Task, 'id' | 'agentRunningStatus' | 'currentStep'> & {
  toolCalls?: Task['toolCalls']
  logs?: ExecutionLog[]
}

export type TaskChatDataParts = {
  timeline_event: ChatTimelineEvent
  task: TaskChatRuntimeUpdate
  session: TaskChatSessionSnapshot
  notice: {
    level: 'info' | 'warning' | 'error'
    message: string
  }
  observation: TaskSubagentObservation
}

export type TaskChatMessage = UIMessage<never, TaskChatDataParts> & {
  attachments?: TaskChatAttachment[]
}

const buildQuotedUserMessage = (message: string) => {
  return message
    .split('\n')
    .map((line) => (line ? `> ${line}` : '>'))
    .join('\n')
}

const PROMPT_ECHO_HEAD_MARKERS = [
  '当前会话已启用以下全局 MCP：',
  '优先使用这些工具族：',
  '当前选中项目:',
  '当前选中任务:',
  '当前选中会话:',
  '项目列表:',
  '--- 最近对话 ---',
  '用户消息：',
]

const PROMPT_ECHO_TAIL_MARKERS = [
  '请直接面向用户回复，保持简洁、真实、可执行。',
]

const stripPromptEchoScaffold = (reply: string) => {
  const trimmedReply = reply.trim()
  if (!trimmedReply) {
    return trimmedReply
  }

  let lastTailIndex = -1
  let lastTailMarker = ''
  for (const marker of PROMPT_ECHO_TAIL_MARKERS) {
    const markerIndex = trimmedReply.lastIndexOf(marker)
    if (markerIndex > lastTailIndex) {
      lastTailIndex = markerIndex
      lastTailMarker = marker
    }
  }

  if (lastTailIndex >= 0 && lastTailMarker) {
    const remainder = trimmedReply.slice(lastTailIndex + lastTailMarker.length).trim()
    if (remainder) {
      return remainder
    }
  }

  return PROMPT_ECHO_HEAD_MARKERS.some((marker) => trimmedReply.includes(marker)) ? '' : trimmedReply
}

const stripLeadingEchoPrefix = (reply: string, prefix: string) => {
  const trimmedPrefix = prefix.trim()
  if (!trimmedPrefix) {
    return null
  }

  if (!reply.startsWith(trimmedPrefix)) {
    return null
  }

  const remainder = reply.slice(trimmedPrefix.length)
  return remainder.replace(/^[\s'"`“”‘’「」>：:，,。.!！?？-]+/u, '').trimStart()
}

export const normalizeAssistantReplyText = (reply: string, userMessage?: string) => {
  let trimmedReply = stripPromptEchoScaffold(reply)
  const trimmedUserMessage = userMessage?.trim()

  if (!trimmedReply || !trimmedUserMessage) {
    return trimmedReply
  }

  const prefixes = [trimmedUserMessage, buildQuotedUserMessage(trimmedUserMessage)]

  for (const prefix of prefixes) {
    const normalized = stripLeadingEchoPrefix(trimmedReply, prefix)
    if (normalized !== null) {
      trimmedReply = normalized
      break
    }
  }

  return stripPromptEchoScaffold(trimmedReply)
}
