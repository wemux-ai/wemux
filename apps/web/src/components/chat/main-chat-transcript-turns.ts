/**
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 * [INPUT]: ChatBubbleMessage[]（持久化主对话消息 + timelineOrder，可选 streaming）
 *         与可选实时 timelineEntries；纯 ChatMessage[] 可经 chatMessagesToChatBubbleMessages 转换。
 * [OUTPUT]: 合并消息与实时 timeline 后的 ConversationTurn[]，加确定性过滤与纯文本导出，
 *           供共享 ChatTranscript 渲染器（Agent 面板 / /chat 路由 / 任务执行日志）消费。
 * [POS]: 纯 transform 模块，无 React 闭包；乐观 pending 状态由调用方（Agent 面板 adapter）
 *        先合成进 ChatBubbleMessage[] 再调用，本模块不感知发送过程。
 */
import type { ChatMessage } from '@shared/types'
import { getCurrentLanguage } from '../../lib/i18n'
import type { ChatBubbleMessage, ChatTimelineEntry } from '../../routes/-chat-route/chat-route-types'
import type { ChatTranscriptTurn } from './chat-transcript'

/**
 * 把持久化 `ChatMessage[]` 映射成 `ChatBubbleMessage[]`：补 `timelineOrder`
 * （数组下标 + 1），并清掉持久化消息上可能残留的 `streaming` 标记（历史重开是静态内容，
 * 只有当前轮实时流才有 streaming 气泡）。
 */
export const chatMessagesToChatBubbleMessages = (
  messages: ChatMessage[],
): ChatBubbleMessage[] => {
  return messages.map((message, index) => ({
    ...message,
    streaming: false,
    timelineOrder: index + 1,
  }))
}

/**
 * 合并持久化消息与实时 timeline 为 ConversationTurn[]。
 * - timeline 的 assistant/tool 条目优先于消息里同 id 的临时气泡/工具调用（去重）。
 * - status 条目落到 turn.status，error 状态且无 assistant 内容时落 turn.error。
 * - 只有最后一轮 isCurrent。
 */
export const buildMainChatTranscriptTurns = (
  messages: ChatBubbleMessage[],
  timelineEntries: ChatTimelineEntry[] = [],
): ChatTranscriptTurn[] => {
  const assistantTimelineMessageIds = new Set(
    timelineEntries
      .filter((entry): entry is Extract<ChatTimelineEntry, { kind: 'assistant' }> => entry.kind === 'assistant')
      .map((entry) => entry.messageId),
  )
  const explicitToolCallIds = new Set(
    timelineEntries
      .filter((entry): entry is Extract<ChatTimelineEntry, { kind: 'tool' }> => entry.kind === 'tool')
      .map((entry) => entry.toolCall.id),
  )
  const orderedItems = [
    ...messages.map((message) => ({
      kind: 'message' as const,
      timelineOrder: message.timelineOrder,
      message,
    })),
    ...timelineEntries.map((entry) => ({
      kind: 'entry' as const,
      timelineOrder: entry.timelineOrder,
      entry,
    })),
  ].sort((left, right) => left.timelineOrder - right.timelineOrder)

  const turns: ChatTranscriptTurn[] = []
  let currentTurn: ChatTranscriptTurn | null = null

  const ensureTurn = (id: string) => {
    if (!currentTurn) {
      currentTurn = {
        id,
        entries: [],
        isCurrent: false,
      }
    }

    return currentTurn
  }

  const pushCurrentTurn = () => {
    if (!currentTurn) {
      return
    }

    turns.push(currentTurn)
    currentTurn = null
  }

  for (const item of orderedItems) {
    if (item.kind === 'message') {
      const { message } = item

      if (message.role === 'user') {
        pushCurrentTurn()
        currentTurn = {
          id: `turn:${message.id}`,
          user: {
            id: message.id,
            role: 'user',
            text: message.content,
            createdAt: message.createdAt,
            attachments: message.attachments,
          },
          referencedDocs: message.externalRef?.referencedDocs,
          entries: [],
          isCurrent: false,
        }
        continue
      }

      if (assistantTimelineMessageIds.has(message.id)) {
        continue
      }

      const turn = ensureTurn(`turn:${message.id}`)
      const hasLiveAssistantEntry = turn.entries.some((entry) => entry.kind === 'assistant')
      if (!hasLiveAssistantEntry) {
        const persistedReasoning = (message.reasoning ?? []).map((item) => item.trim()).filter(Boolean)
        const persistedToolCalls = (message.toolCalls ?? []).filter((toolCall) => !explicitToolCallIds.has(toolCall.id))

        for (const [reasoningIndex, reasoning] of persistedReasoning.entries()) {
          turn.entries.push({
            kind: 'thinking',
            id: `message:${message.id}:thinking:${reasoningIndex}`,
            content: reasoning,
          })
        }

        for (const toolCall of persistedToolCalls) {
          turn.entries.push({
            kind: 'tool',
            id: `message:${message.id}:tool:${toolCall.id}`,
            tool: toolCall,
          })
        }

        turn.entries.push({
          kind: 'assistant',
          id: `message:${message.id}`,
          message: {
            id: message.id,
            role: 'assistant',
            text: message.content,
            createdAt: message.createdAt,
            streaming: message.streaming,
            authorType: message.authorType,
            authorId: message.authorId,
            authorName: message.authorName,
            agentRunningStatus: message.agentRunningStatus,
            currentStep: message.currentStep,
            finishReason: message.finishReason,
            attachments: message.attachments,
          },
        })
      }
      continue
    }

    const turn = ensureTurn(`turn:${item.entry.id}`)
    if (item.entry.kind === 'thinking') {
      const existingIndex = turn.entries.findIndex((entry) => entry.kind === 'thinking' && entry.id === item.entry.id)
      const nextEntry: ChatTranscriptTurn['entries'][number] = {
        kind: 'thinking',
        id: item.entry.id,
        content: item.entry.content,
      }
      if (existingIndex === -1) {
        turn.entries.push(nextEntry)
      } else {
        turn.entries[existingIndex] = nextEntry
      }
      continue
    }

    if (item.entry.kind === 'assistant') {
      const existingIndex = turn.entries.findIndex((entry) => entry.kind === 'assistant' && entry.id === item.entry.id)
      const nextEntry: ChatTranscriptTurn['entries'][number] = {
        kind: 'assistant',
        id: item.entry.id,
        message: {
          id: item.entry.id,
          sourceId: item.entry.messageId,
          role: 'assistant',
          text: item.entry.text,
        },
      }
      if (existingIndex === -1) {
        turn.entries.push(nextEntry)
      } else {
        turn.entries[existingIndex] = nextEntry
      }
      continue
    }

    if (item.entry.kind === 'tool') {
      const existingIndex = turn.entries.findIndex((entry) => entry.kind === 'tool' && entry.id === item.entry.id)
      const nextEntry: ChatTranscriptTurn['entries'][number] = {
        kind: 'tool',
        id: item.entry.id,
        tool: item.entry.toolCall,
      }
      if (existingIndex === -1) {
        turn.entries.push(nextEntry)
      } else {
        turn.entries[existingIndex] = nextEntry
      }
      continue
    }

    if (item.entry.kind === 'status') {
      turn.status = {
        status: item.entry.status,
        step: item.entry.currentStep || '',
      }
      const hasAssistantEntry = turn.entries.some((entry) => entry.kind === 'assistant')
      if (item.entry.status === 'error' && !hasAssistantEntry) {
        turn.error = {
          message: item.entry.currentStep || (
            getCurrentLanguage() === 'zh'
              ? 'Agent 系统对话失败'
              : 'Agent system conversation failed'
          ),
        }
      }
    }
  }

  pushCurrentTurn()

  return turns.map((turn, index) => ({
    ...turn,
    isCurrent: index === turns.length - 1,
  }))
}

export type MainChatTranscriptFilter = 'all' | 'conversation' | 'process'

export const filterMainChatTranscriptTurns = (
  turns: ChatTranscriptTurn[],
  filter: MainChatTranscriptFilter,
) => {
  if (filter === 'all') return turns
  return turns.flatMap((turn) => {
    const entries = turn.entries.filter((entry) => filter === 'conversation'
      ? entry.kind === 'assistant'
      : entry.kind === 'thinking' || entry.kind === 'tool')
    if (filter === 'process' && entries.length === 0) return []
    return [{
      ...turn,
      user: filter === 'conversation' ? turn.user : undefined,
      entries,
    }]
  })
}

export const formatMainChatTranscriptTurnsForCopy = (turns: ChatTranscriptTurn[]) => turns.flatMap((turn) => {
  const blocks: string[] = []
  if (turn.user?.text.trim()) blocks.push(`[用户]\n${turn.user.text.trim()}`)
  for (const entry of turn.entries) {
    if (entry.kind === 'thinking' && entry.content.trim()) {
      blocks.push(`[思考]\n${entry.content.trim()}`)
    } else if (entry.kind === 'tool') {
      const details = [
        `[工具] ${entry.tool.name}`,
        entry.tool.args?.trim() ? `参数:\n${entry.tool.args.trim()}` : '',
        entry.tool.result?.trim() ? `结果:\n${entry.tool.result.trim()}` : '',
      ].filter(Boolean)
      blocks.push(details.join('\n'))
    } else if (entry.kind === 'assistant' && entry.message.text.trim()) {
      blocks.push(`[Agent]\n${entry.message.text.trim()}`)
    }
  }
  return blocks
}).join('\n\n')
