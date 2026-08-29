import { memo, useEffect, useMemo, useState, type ReactNode } from 'react'
import { ChevronDown, ChevronUp, CircleStop, FileText, MessageSquare, ScrollText } from 'lucide-react'
import type { TaskChatMessage } from '../../lib/workspace-session-chat-ui'
import { useTranslation } from '../../lib/i18n/react'
import { cn } from '../../lib/utils'
import {
  ChangeSummaryCard,
  ChatMessageItem,
  CollapsedThinkingGroup,
  EmptyState,
  SystemTimelineItem,
  statusLabel,
  ToolCallGroup,
  TurnStatusMeta,
  TypingBubble,
} from '../workspaces/workspace-session-chat/workspace-session-chat-ui'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog'
import type { AgentType, ModelTokenUsage } from '@shared/types'
import type { TaskGitChangeSummary } from '@shared/task-git-ops'
import type { MessagePart } from '@shared/thread-message'
import type { ConversationMessage, ConversationTurn, ConversationTurnEntry } from './conversation-types'
import type { ChatMentionTarget } from './mention-text'

type TaskChatMessageWithCreatedAt = TaskChatMessage & {
  createdAt?: string
  executionModel?: string
}

type SystemTimelineConnection = {
  connectBefore: boolean
  connectAfter: boolean
}

export interface ConversationFeedProps {
  turns: ConversationTurn[]
  isBusy: boolean
  assistantLabel?: string
  assistantAvatarUrl?: string
  assistantAvatarFallback?: string
  assistantAvatarRuntime?: AgentType
  showFullExecutionModel?: boolean
  fallbackStep?: string
  emptyTitle?: string
  emptyDescription?: string
  userAvatarUrl?: string
  userAvatarFallback?: string
  userLabel?: string
  onOpenMessageLink?: (href: string) => boolean
  mobileHeaderLayout?: boolean
  enableProcessFolding?: boolean
  hideProcessBehindLog?: boolean
  mentionTargets?: readonly ChatMentionTarget[]
}

const getAuthorInitials = (name?: string, fallback = 'AI') => {
  const normalized = name?.trim() || ''
  if (!normalized) {
    return fallback
  }

  const parts = normalized.split(/\s+/).filter(Boolean)
  if (parts.length > 1) {
    return parts.slice(0, 2).map((part) => part[0]).join('').toUpperCase()
  }

  return Array.from(normalized).slice(0, 2).join('').toUpperCase()
}

/**
 * ConversationMessage.parts 是 thread-message 的 MessagePart（领域内容块），
 * TaskChatMessage.parts 是 ai SDK 的 UIMessage part —— 两者形状不同，这里只桥接
 * ChatMessageItem 实际会渲染的 text（tool_call/reasoning 等在这层已由独立的
 * ConversationTurnEntry 承载，不需要在消息气泡内重复渲染）。
 */
const mapMessagePartsToTaskChatParts = (parts: MessagePart[]): TaskChatMessage['parts'] => {
  return parts
    .filter((part): part is Extract<MessagePart, { type: 'text' }> => part.type === 'text')
    .map((part) => ({ type: 'text' as const, text: part.text }))
}

const buildTaskChatMessage = (message: ConversationMessage): TaskChatMessage => {
  const mappedParts = message.parts?.length ? mapMessagePartsToTaskChatParts(message.parts) : []

  return {
    id: message.id,
    createdAt: message.createdAt,
    role: message.role,
    parts: mappedParts.length > 0 ? mappedParts : [{ type: 'text', text: message.text }],
    attachments: message.attachments,
    executionModel: message.executionModel,
  } as TaskChatMessageWithCreatedAt
}

const isWorkingAssistantMessage = (message: ConversationMessage) => {
  return message.role === 'assistant'
    && message.streaming
    && !message.text.trim()
    && (message.attachments?.length ?? 0) === 0
}

const hasRenderableMessageContent = (message: ConversationMessage) => {
  return Boolean(message.text.trim())
    || (message.attachments?.length ?? 0) > 0
    || Boolean(message.afterContent)
}

const isRenderableAssistantMessage = (message: ConversationMessage) => {
  return isWorkingAssistantMessage(message) || hasRenderableMessageContent(message)
}

/**
 * 片段判定只认显式 'aborted'：finishReason 缺省意味着「仍在生成或历史未记录」，
 * 把缺省当成片段会给所有旧消息挂上截断标记。
 * streaming 期间不标注，正在流的消息本来就不完整，此时提示是噪音。
 */
const isTruncatedAssistantMessage = (message: ConversationMessage) => {
  return message.role === 'assistant' && message.finishReason === 'aborted' && !message.streaming
}

/**
 * 截断标记。渲染层自己取语言，避免把 language 串进 renderMessage/renderTurnEntry
 * 两条已经很长的位置参数链。
 */
const TruncatedReplyNotice = memo(function TruncatedReplyNotice({ mobileHeaderLayout }: { mobileHeaderLayout: boolean }) {
  const { language } = useTranslation()

  return (
    <div className={cn(
      'flex items-center gap-1.5 text-xs text-muted-foreground',
      mobileHeaderLayout ? 'ml-0' : 'ml-9',
    )}>
      <CircleStop className="size-3.5 shrink-0" aria-hidden="true" />
      <span>{language === 'zh' ? '已停止，以上内容不完整' : 'Stopped — the reply above is incomplete'}</span>
    </div>
  )
})

const PendingInteractionCard = ({ entry }: { entry: Extract<ConversationTurnEntry, { kind: 'interaction' }> }) => {
  const { interaction } = entry
  const label = interaction.type === 'question'
    ? '等待回答'
    : interaction.type === 'permission'
      ? '等待权限'
      : '等待确认'
  const prompt = interaction.prompt?.trim()

  return (
    <div className="rounded-lg border border-amber-500/20 bg-amber-500/8 px-3.5 py-3 text-sm text-amber-50 shadow-sm">
      <div className="flex min-w-0 items-start gap-2.5">
        <MessageSquare className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-300" />
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <span className="flex-shrink-0 rounded-full border border-amber-500/25 bg-amber-500/10 px-2 py-0.5 text-[11px] font-medium text-amber-200">
              {label}
            </span>
            {interaction.provider ? <span className="truncate text-[11px] text-amber-200/55">{interaction.provider}</span> : null}
          </div>
          <p className="mt-2 whitespace-pre-wrap break-words font-medium leading-6 text-amber-50">{interaction.title}</p>
          {prompt && prompt !== interaction.title ? (
            <p className="mt-1 whitespace-pre-wrap break-words text-[13px] leading-5 text-amber-100/75">{prompt}</p>
          ) : null}
        </div>
      </div>
    </div>
  )
}

const isResultConversationTailEntry = (entry: ConversationTurnEntry) => {
  return entry.kind === 'delivery_result' || entry.kind === 'change_summary'
}

const isResultConversationEntry = (entry: ConversationTurnEntry) => {
  if (isResultConversationTailEntry(entry)) {
    return true
  }

  return entry.kind === 'assistant'
    && entry.message.authorType !== 'system'
    && isRenderableAssistantMessage(entry.message)
}

const findVisibleResultStartIndex = (entries: ConversationTurnEntry[]) => {
  if (entries.length === 0) {
    return -1
  }

  let trailingIndex = entries.length - 1
  while (trailingIndex >= 0 && isResultConversationTailEntry(entries[trailingIndex]!)) {
    trailingIndex -= 1
  }

  if (trailingIndex >= 0 && isResultConversationEntry(entries[trailingIndex]!)) {
    return trailingIndex
  }

  for (let index = entries.length - 1; index >= 0; index -= 1) {
    if (isResultConversationEntry(entries[index]!)) {
      return index
    }
  }

  return -1
}

type ConversationTurnProcessFold = {
  collapsible: boolean
  hiddenEntries: ConversationTurnEntry[]
  visibleEntries: ConversationTurnEntry[]
}

const isSettledConversationTurn = (turn: ConversationTurn, isBusy: boolean) => {
  if (isBusy && turn.isCurrent) {
    return false
  }

  if (turn.error) {
    return true
  }

  if (turn.status?.status === 'complete' || turn.status?.status === 'error') {
    return true
  }

  return Boolean(turn.status?.finishedAt)
}

export const resolveConversationTurnProcessFold = ({
  turn,
  isBusy,
  enabled,
}: {
  turn: ConversationTurn
  isBusy: boolean
  enabled: boolean
}): ConversationTurnProcessFold => {
  if (!enabled || turn.entries.length === 0 || !isSettledConversationTurn(turn, isBusy)) {
    return {
      collapsible: false,
      hiddenEntries: [],
      visibleEntries: turn.entries,
    }
  }

  const resultBlockStart = findVisibleResultStartIndex(turn.entries)

  if (resultBlockStart > 0) {
    return {
      collapsible: true,
      hiddenEntries: turn.entries.slice(0, resultBlockStart),
      visibleEntries: turn.entries.slice(resultBlockStart),
    }
  }

  if (resultBlockStart === 0) {
    return {
      collapsible: false,
      hiddenEntries: [],
      visibleEntries: turn.entries,
    }
  }

  if (turn.error && turn.entries.length > 0) {
    return {
      collapsible: true,
      hiddenEntries: turn.entries,
      visibleEntries: [],
    }
  }

  return {
    collapsible: false,
    hiddenEntries: [],
    visibleEntries: turn.entries,
  }
}

const isProcessEntry = (entry: ConversationTurnEntry) => {
  return entry.kind === 'thinking' || entry.kind === 'tool'
}

/**
 * 日志折叠模式：中间过程（thinking/tool）在「工作中与完成后」都不平铺，
 * 只通过回复气泡右下角的日志图标展开。与 enableProcessFolding（settled 后才折叠）
 * 的区别在于不要求 settled，且 visibleEntries 只保留非过程条目（assistant 结果）。
 */
export const resolveConversationTurnLogFold = ({
  turn,
  enabled,
}: {
  turn: ConversationTurn
  enabled: boolean
}): ConversationTurnProcessFold => {
  if (!enabled || turn.entries.length === 0) {
    return {
      collapsible: false,
      hiddenEntries: [],
      visibleEntries: turn.entries,
    }
  }

  const hiddenEntries = turn.entries.filter(isProcessEntry)
  if (hiddenEntries.length === 0) {
    return {
      collapsible: false,
      hiddenEntries: [],
      visibleEntries: turn.entries,
    }
  }

  return {
    collapsible: true,
    hiddenEntries,
    visibleEntries: turn.entries.filter((entry) => !isProcessEntry(entry)),
  }
}

const buildProcessSummary = (entries: ConversationTurnEntry[]) => {
  return entries.reduce((summary, entry) => {
    summary.total += 1
    if (entry.kind === 'thinking') {
      summary.thinking += 1
      return summary
    }
    if (entry.kind === 'tool') {
      summary.tools += 1
      return summary
    }
    if (entry.kind === 'assistant') {
      summary.messages += 1
      return summary
    }
    if (entry.kind === 'delivery_result') {
      summary.deliveries += 1
    }
    return summary
  }, {
    total: 0,
    thinking: 0,
    tools: 0,
    messages: 0,
    deliveries: 0,
  })
}

const formatProcessToggleSummary = (language: string, entries: ConversationTurnEntry[]) => {
  const summary = buildProcessSummary(entries)
  const segments: string[] = []

  if (summary.messages > 0) {
    segments.push(language === 'zh' ? `${summary.messages} 条消息` : `${summary.messages} messages`)
  }
  if (summary.tools > 0) {
    segments.push(language === 'zh' ? `${summary.tools} 个工具` : `${summary.tools} tools`)
  }
  if (summary.thinking > 0) {
    segments.push(language === 'zh' ? `${summary.thinking} 段思考` : `${summary.thinking} thoughts`)
  }
  if (summary.deliveries > 0) {
    segments.push(language === 'zh' ? `${summary.deliveries} 个结果` : `${summary.deliveries} results`)
  }

  if (segments.length > 0) {
    return segments.join(' · ')
  }

  return language === 'zh' ? `${summary.total} 项` : `${summary.total} items`
}

const renderMessage = (
  message: ConversationMessage,
  assistantLabel = 'AI',
  assistantAvatarUrl?: string,
  assistantAvatarFallback?: string,
  assistantAvatarRuntime?: AgentType,
  showFullExecutionModel = false,
  userAvatarUrl?: string,
  userAvatarFallback?: string,
  userLabel = '你',
  onOpenMessageLink?: (href: string) => boolean,
  systemTimelineConnection?: SystemTimelineConnection,
  mobileHeaderLayout = false,
  logFooter?: ReactNode,
  mentionTargets?: readonly ChatMentionTarget[],
) => {
  if (message.authorType === 'system') {
    return (
      <SystemTimelineItem
        content={message.text || ''}
        connectBefore={systemTimelineConnection?.connectBefore}
        connectAfter={systemTimelineConnection?.connectAfter}
      />
    )
  }

  const isAssistant = message.role === 'assistant'
  const userCardUserId = (message.role === 'user' || message.authorType === 'user') && message.authorId
    ? message.authorId
    : undefined
  // Agent 消息头像同样可 hover/点击弹出 Agent 卡片。
  const agentCardUserId = message.authorType === 'agent' && message.authorId
    ? message.authorId
    : undefined
  const resolvedLabel = message.authorName || (isAssistant ? assistantLabel : userLabel)
  const hasExplicitAvatarUrl = typeof message.avatarUrl === 'string'
  const resolvedAvatarUrl = hasExplicitAvatarUrl
    ? message.avatarUrl
    : isAssistant
      ? assistantAvatarUrl
      : message.authorType === 'agent'
        ? undefined
        : userAvatarUrl
  const resolvedAssistantRuntime = isAssistant
    ? (message.avatarRuntime ?? assistantAvatarRuntime)
    : undefined
  const fallbackSeed = isAssistant ? assistantAvatarFallback || 'AI' : userAvatarFallback || '你'
  const resolvedAvatarFallback = message.avatarFallback || getAuthorInitials(resolvedLabel, fallbackSeed)

  if (isWorkingAssistantMessage(message)) {
    return (
      <TypingBubble
        step={message.currentStep?.trim() || statusLabel[message.agentRunningStatus ?? 'thinking']}
        assistantLabel={resolvedLabel}
        assistantAvatarUrl={resolvedAvatarUrl}
        assistantAvatarFallback={resolvedAvatarFallback}
        assistantAvatarRuntime={resolvedAssistantRuntime}
        mobileHeaderLayout={mobileHeaderLayout}
      />
    )
  }

  return (
    <div className="space-y-2" data-message-id={message.id}>
      <ChatMessageItem
        message={buildTaskChatMessage(message)}
        footer={message.actions}
        footerEnd={logFooter}
        onOpenLink={onOpenMessageLink}
        authorLabel={resolvedLabel}
        messageAvatarUrl={resolvedAvatarUrl}
        messageAvatarFallback={resolvedAvatarFallback}
        assistantLabel={assistantLabel}
        assistantAvatarUrl={assistantAvatarUrl}
        assistantAvatarFallback={assistantAvatarFallback}
        assistantAvatarRuntime={hasExplicitAvatarUrl ? undefined : resolvedAssistantRuntime}
        showFullExecutionModel={showFullExecutionModel}
        messageExecutionModel={message.executionModel}
        userAvatarUrl={userAvatarUrl}
        userAvatarFallback={userAvatarFallback}
        userLabel={userLabel}
        mobileHeaderLayout={mobileHeaderLayout}
        userCardUserId={userCardUserId}
        agentCardUserId={agentCardUserId}
        mentionTargets={mentionTargets}
      />
      {isTruncatedAssistantMessage(message) ? (
        <TruncatedReplyNotice mobileHeaderLayout={mobileHeaderLayout} />
      ) : null}
      {message.afterContent ? (
        <div className={cn(
          message.role === 'assistant' ? 'ml-9 max-w-[88%]' : 'mr-9 ml-auto max-w-[88%]',
          mobileHeaderLayout && (message.role === 'assistant' ? 'ml-0 max-w-full' : 'mr-0 max-w-full'),
        )}>
          {message.afterContent}
        </div>
      ) : null}
    </div>
  )
}

const isSystemAssistantEntry = (entry: ConversationTurnEntry | undefined) => {
  return entry?.kind === 'assistant' && entry.message.authorType === 'system'
}

const renderTurnEntries = (
  entries: ConversationTurnEntry[],
  forceSettledTools: boolean,
  assistantLabel = 'AI',
  assistantAvatarUrl?: string,
  assistantAvatarFallback?: string,
  assistantAvatarRuntime?: AgentType,
  showFullExecutionModel = false,
  userAvatarUrl?: string,
  userAvatarFallback?: string,
  userLabel = '你',
  onOpenMessageLink?: (href: string) => boolean,
  mobileHeaderLayout = false,
  logFooter?: ReactNode,
  mentionTargets?: readonly ChatMentionTarget[],
) => {
  const renderedEntries: ReactNode[] = []
  let lastAssistantIndex = -1
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    if (entries[index]?.kind === 'assistant') {
      lastAssistantIndex = index
      break
    }
  }
  const turnChangeSummary = entries.find((entry): entry is Extract<ConversationTurnEntry, { kind: 'delivery_result' }> => {
    return entry.kind === 'delivery_result' && Boolean(entry.changeSummary)
  })?.changeSummary

  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index]
    if (entry.kind === 'thinking') {
      const groupedEntries: Array<{ id: string; content: string }> = []
      let previousContent = ''

      while (index < entries.length) {
        const thinkingEntry = entries[index]
        if (!thinkingEntry || thinkingEntry.kind !== 'thinking') {
          break
        }

        const normalizedContent = thinkingEntry.content.trim()
        if (normalizedContent && normalizedContent !== previousContent) {
          groupedEntries.push({
            id: thinkingEntry.id,
            content: thinkingEntry.content,
          })
          previousContent = normalizedContent
        }
        index += 1
      }

      if (groupedEntries.length > 0) {
        renderedEntries.push(
          <CollapsedThinkingGroup
            key={`thinking:${groupedEntries.map((item) => item.id).join(':')}`}
            entries={groupedEntries}
          />,
        )
      }

      index -= 1
      continue
    }

    if (entry.kind === 'tool') {
      const groupedTools: Array<Extract<ConversationTurnEntry, { kind: 'tool' }>> = []

      while (index < entries.length) {
        const toolEntry = entries[index]
        if (!toolEntry || toolEntry.kind !== 'tool') {
          break
        }

        groupedTools.push(toolEntry)
        index += 1
      }

      if (groupedTools.length > 0) {
        renderedEntries.push(
          <ToolCallGroup
            key={`tools:${groupedTools.map((item) => item.id).join(':')}`}
            tools={groupedTools.map((item) => item.tool)}
            changeSummary={mergeChangeSummaries(groupedTools.map((item) => item.changeSummary)) ?? turnChangeSummary}
            forceSettled={forceSettledTools}
            defaultExpanded
          />,
        )
      }

      index -= 1
      continue
    }

    const systemTimelineConnection = isSystemAssistantEntry(entry)
      ? {
          connectBefore: index > 0 && isSystemAssistantEntry(entries[index - 1]),
          connectAfter: index < entries.length - 1 && isSystemAssistantEntry(entries[index + 1]),
        }
      : undefined

    if (entry.kind === 'delivery_result' && entry.changeSummary) {
      renderedEntries.push(renderTurnEntry(
        {
          kind: 'change_summary',
          id: `${entry.id}:change-summary`,
          changeSummary: entry.changeSummary,
          createdAt: entry.createdAt,
        },
        forceSettledTools,
        assistantLabel,
        assistantAvatarUrl,
        assistantAvatarFallback,
        assistantAvatarRuntime,
        showFullExecutionModel,
        userAvatarUrl,
        userAvatarFallback,
        userLabel,
        onOpenMessageLink,
        systemTimelineConnection,
        mobileHeaderLayout,
        undefined,
        mentionTargets,
      ))

      continue
    }

    renderedEntries.push(
      renderTurnEntry(
        entry,
        forceSettledTools,
        assistantLabel,
        assistantAvatarUrl,
        assistantAvatarFallback,
        assistantAvatarRuntime,
        showFullExecutionModel,
        userAvatarUrl,
        userAvatarFallback,
        userLabel,
        onOpenMessageLink,
        systemTimelineConnection,
        mobileHeaderLayout,
        index === lastAssistantIndex ? logFooter : undefined,
        mentionTargets,
      ),
    )
  }

  return renderedEntries
}

const mergeChangeSummaries = (summaries: Array<TaskGitChangeSummary | undefined>) => {
  const files = summaries.flatMap((summary) => summary?.files ?? [])
  if (files.length === 0) {
    return undefined
  }

  return {
    fileCount: files.length,
    additions: files.reduce((total, file) => total + file.additions, 0),
    deletions: files.reduce((total, file) => total + file.deletions, 0),
    files,
  }
}

const renderTurnEntry = (
  entry: ConversationTurnEntry,
  forceSettledTools: boolean,
  assistantLabel = 'AI',
  assistantAvatarUrl?: string,
  assistantAvatarFallback?: string,
  assistantAvatarRuntime?: AgentType,
  showFullExecutionModel = false,
  userAvatarUrl?: string,
  userAvatarFallback?: string,
  userLabel = '你',
  onOpenMessageLink?: (href: string) => boolean,
  systemTimelineConnection?: SystemTimelineConnection,
  mobileHeaderLayout = false,
  logFooter?: ReactNode,
  mentionTargets?: readonly ChatMentionTarget[],
) => {
  if (entry.kind === 'tool') {
    return <ToolCallGroup key={entry.id} tools={[entry.tool]} changeSummary={entry.changeSummary} forceSettled={forceSettledTools} />
  }

  if (entry.kind === 'interaction') {
    return <PendingInteractionCard key={entry.id} entry={entry} />
  }

  if (entry.kind === 'change_summary') {
    return (
      <div key={entry.id}>
        <ChangeSummaryCard changeSummary={entry.changeSummary} createdAt={entry.createdAt} />
      </div>
    )
  }

  if (entry.kind === 'delivery_result') {
    return null
  }

  if (entry.kind !== 'assistant') {
    return null
  }

  return (
    <div key={entry.id}>
      {renderMessage(entry.message, assistantLabel, assistantAvatarUrl, assistantAvatarFallback, assistantAvatarRuntime, showFullExecutionModel, userAvatarUrl, userAvatarFallback, userLabel, onOpenMessageLink, systemTimelineConnection, mobileHeaderLayout, logFooter, mentionTargets)}
    </div>
  )
}

const RUNNING_STATUS_SET = new Set(['thinking', 'executing', 'waiting'] as const)
const isRunningConversationStatus = (status?: ConversationTurn['status']) => {
  if (!status) {
    return false
  }

  return status.status === 'thinking' || status.status === 'executing' || status.status === 'waiting'
}

const parseTimestampMs = (value?: string) => {
  if (!value) {
    return null
  }

  const timestamp = new Date(value).getTime()
  return Number.isNaN(timestamp) ? null : timestamp
}

const formatRunDuration = (durationMs: number) => {
  const totalSeconds = Math.max(0, Math.floor(durationMs / 1000))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}

const formatTokenCount = (value: number | undefined) => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return ''
  }

  return value.toLocaleString()
}

const buildTurnUsageSummary = (usage?: ModelTokenUsage) => {
  if (!usage) {
    return ''
  }

  const segments = [
    usage.totalTokens > 0 ? `Token ${formatTokenCount(usage.totalTokens)}` : '',
    usage.inputTokens > 0 ? `In ${formatTokenCount(usage.inputTokens)}` : '',
    usage.outputTokens > 0 ? `Out ${formatTokenCount(usage.outputTokens)}` : '',
    usage.reasoningTokens ? `Reason ${formatTokenCount(usage.reasoningTokens)}` : '',
    usage.cacheReadTokens ? `Cache Hit ${formatTokenCount(usage.cacheReadTokens)}` : '',
  ].filter(Boolean)

  return segments.join(' · ')
}

function RunDurationLabel({
  startedAt,
  finishedAt,
  status,
}: {
  startedAt?: string
  finishedAt?: string
  status: ConversationTurn['status']
}) {
  const [now, setNow] = useState(() => Date.now())
  const startedAtMs = parseTimestampMs(startedAt)
  const finishedAtMs = parseTimestampMs(finishedAt)
  const isRunning = Boolean(startedAtMs && !finishedAtMs && isRunningConversationStatus(status))

  useEffect(() => {
    if (!isRunning) {
      return
    }

    const intervalId = window.setInterval(() => {
      setNow(Date.now())
    }, 1000)

    return () => window.clearInterval(intervalId)
  }, [isRunning])

  if (!startedAtMs) {
    return null
  }

  const endTimeMs = finishedAtMs ?? now
  const durationLabel = formatRunDuration(endTimeMs - startedAtMs)

  return (
    <span className="font-mono tabular-nums opacity-90">
      {durationLabel}
    </span>
  )
}

function TurnStatusExtraMeta({ status }: { status: ConversationTurn['status'] }) {
  const runDuration = (
    <RunDurationLabel
      startedAt={status?.startedAt}
      finishedAt={status?.finishedAt}
      status={status}
    />
  )
  const executorLabel = status?.workspaceExecutor?.name?.trim()
    ? status.workspaceExecutor.name.trim()
    : status?.workspaceExecutor?.executorId
      ? status.workspaceExecutor.executorId.slice(0, 8)
      : ''

  if (!executorLabel) {
    return runDuration
  }

  const sourceLabel = status?.workspaceExecutor?.executorSource === 'managed-cloud'
    || status?.workspaceExecutor?.managedBy === 'vibemux'
    ? '云节点'
    : '自有节点'

  return (
    <span className="inline-flex min-w-0 items-center gap-2">
      <span className="truncate opacity-90" title={status?.workspaceExecutor?.executorId}>
        运行节点 {executorLabel} · {sourceLabel}
      </span>
      {runDuration ? (
        <>
          <span aria-hidden="true" className="opacity-35">·</span>
          {runDuration}
        </>
      ) : null}
    </span>
  )
}

const areAttachmentsEqual = (
  left: ConversationMessage['attachments'],
  right: ConversationMessage['attachments'],
) => {
  if (left === right) {
    return true
  }

  if ((left?.length ?? 0) !== (right?.length ?? 0)) {
    return false
  }

  return (left ?? []).every((leftAttachment, index) => {
    const rightAttachment = right?.[index]
    if (!rightAttachment) {
      return false
    }

    return leftAttachment.id === rightAttachment.id
      && leftAttachment.url === rightAttachment.url
      && leftAttachment.filename === rightAttachment.filename
      && leftAttachment.contentType === rightAttachment.contentType
  })
}

const areMessagesEqual = (
  left: ConversationMessage | undefined,
  right: ConversationMessage | undefined,
  useRenderRevisionKey: boolean,
) => {
  if (left === right) {
    return true
  }

  if (!left || !right) {
    return false
  }

  return left.id === right.id
    && left.sourceId === right.sourceId
    && left.anchorId === right.anchorId
    && left.role === right.role
    && left.text === right.text
    && left.createdAt === right.createdAt
    && left.streaming === right.streaming
    && left.authorType === right.authorType
    && left.authorId === right.authorId
    && left.authorName === right.authorName
    && left.avatarUrl === right.avatarUrl
    && left.avatarFallback === right.avatarFallback
    && left.avatarRuntime === right.avatarRuntime
    && left.agentRunningStatus === right.agentRunningStatus
    && left.currentStep === right.currentStep
    && left.executionModel === right.executionModel
    && left.finishReason === right.finishReason
    && areAttachmentsEqual(left.attachments, right.attachments)
    && left.afterContent === right.afterContent
    && (useRenderRevisionKey ? Boolean(left.actions) === Boolean(right.actions) : left.actions === right.actions)
}

const buildChangeSummarySignature = (entry: { changeSummary?: TaskGitChangeSummary }) => {
  const summary = entry.changeSummary
  if (!summary) {
    return ''
  }

  return [
    summary.fileCount,
    summary.additions,
    summary.deletions,
    ...summary.files.map((file) => `${file.path}:${file.status}:${file.additions}:${file.deletions}`),
  ].join('|')
}

const areTurnEntriesEqual = (
  left: ConversationTurnEntry[],
  right: ConversationTurnEntry[],
  useRenderRevisionKey: boolean,
) => {
  if (left === right) {
    return true
  }

  if (left.length !== right.length) {
    return false
  }

  return left.every((leftEntry, index) => {
    const rightEntry = right[index]
    if (!rightEntry || leftEntry.kind !== rightEntry.kind || leftEntry.id !== rightEntry.id) {
      return false
    }

    if (leftEntry.kind === 'thinking' && rightEntry.kind === 'thinking') {
      return leftEntry.content === rightEntry.content
    }

    if (leftEntry.kind === 'tool' && rightEntry.kind === 'tool') {
      return leftEntry.tool === rightEntry.tool
        || (
          leftEntry.tool.id === rightEntry.tool.id
          && leftEntry.tool.name === rightEntry.tool.name
          && leftEntry.tool.args === rightEntry.tool.args
          && leftEntry.tool.result === rightEntry.tool.result
          && leftEntry.tool.startedAt === rightEntry.tool.startedAt
          && leftEntry.tool.finishedAt === rightEntry.tool.finishedAt
          && leftEntry.tool.workspaceId === rightEntry.tool.workspaceId
        )
    }

    if (leftEntry.kind === 'delivery_result' && rightEntry.kind === 'delivery_result') {
      return leftEntry.message === rightEntry.message
        && leftEntry.createdAt === rightEntry.createdAt
        && leftEntry.remoteBranchName === rightEntry.remoteBranchName
        && (leftEntry.commitShas ?? []).join(',') === (rightEntry.commitShas ?? []).join(',')
        && leftEntry.delivery?.pullRequest?.url === rightEntry.delivery?.pullRequest?.url
        && leftEntry.delivery?.pullRequest?.number === rightEntry.delivery?.pullRequest?.number
        && leftEntry.delivery?.pullRequest?.state === rightEntry.delivery?.pullRequest?.state
        && leftEntry.delivery?.pullRequest?.compareBranch === rightEntry.delivery?.pullRequest?.compareBranch
    }

    if (leftEntry.kind === 'change_summary' && rightEntry.kind === 'change_summary') {
      return leftEntry.createdAt === rightEntry.createdAt
        && buildChangeSummarySignature(leftEntry) === buildChangeSummarySignature(rightEntry)
    }

    if (leftEntry.kind === 'interaction' && rightEntry.kind === 'interaction') {
      return leftEntry.createdAt === rightEntry.createdAt
        && leftEntry.interaction.id === rightEntry.interaction.id
        && leftEntry.interaction.type === rightEntry.interaction.type
        && leftEntry.interaction.status === rightEntry.interaction.status
        && leftEntry.interaction.title === rightEntry.interaction.title
        && leftEntry.interaction.prompt === rightEntry.interaction.prompt
        && leftEntry.interaction.provider === rightEntry.interaction.provider
        && leftEntry.interaction.toolName === rightEntry.interaction.toolName
    }

    return leftEntry.kind === 'assistant'
      && rightEntry.kind === 'assistant'
      && areMessagesEqual(leftEntry.message, rightEntry.message, useRenderRevisionKey)
  })
}

const areStatusesEqual = (
  left: ConversationTurn['status'],
  right: ConversationTurn['status'],
) => {
  if (left === right) {
    return true
  }

  if (!left || !right) {
    return false
  }

  return left.status === right.status
    && left.step === right.step
    && left.startedAt === right.startedAt
    && left.finishedAt === right.finishedAt
    && left.workspaceExecutor === right.workspaceExecutor
}

const areTurnsEqual = (left: ConversationTurn, right: ConversationTurn) => {
  const useRenderRevisionKey = left.renderRevisionKey !== undefined || right.renderRevisionKey !== undefined

  return left.id === right.id
    && left.anchorId === right.anchorId
    && left.isCurrent === right.isCurrent
    && left.highlighted === right.highlighted
    && left.renderRevisionKey === right.renderRevisionKey
    && areMessagesEqual(left.user, right.user, useRenderRevisionKey)
    && areTurnEntriesEqual(left.entries, right.entries, useRenderRevisionKey)
    && areStatusesEqual(left.status, right.status)
    && left.error?.message === right.error?.message
}

interface ConversationTurnItemProps {
  turn: ConversationTurn
  isBusy: boolean
  language: string
  assistantLabel: string
  assistantAvatarUrl?: string
  assistantAvatarFallback?: string
  assistantAvatarRuntime?: AgentType
  showFullExecutionModel: boolean
  fallbackStep: string
  userAvatarUrl?: string
  userAvatarFallback?: string
  userLabel: string
  onOpenMessageLink?: (href: string) => boolean
  mobileHeaderLayout: boolean
  enableProcessFolding: boolean
  hideProcessBehindLog: boolean
  mentionTargets?: readonly ChatMentionTarget[]
}

const ConversationTurnItem = memo(function ConversationTurnItem({
  turn,
  isBusy,
  language,
  assistantLabel,
  assistantAvatarUrl,
  assistantAvatarFallback,
  assistantAvatarRuntime,
  showFullExecutionModel,
  fallbackStep,
  userAvatarUrl,
  userAvatarFallback,
  userLabel,
  onOpenMessageLink,
  mobileHeaderLayout,
  enableProcessFolding,
  hideProcessBehindLog,
  mentionTargets,
}: ConversationTurnItemProps) {
  const processFold = useMemo(() => {
    if (hideProcessBehindLog) {
      return resolveConversationTurnLogFold({ turn, enabled: true })
    }

    return resolveConversationTurnProcessFold({
      turn,
      isBusy,
      enabled: enableProcessFolding,
    })
  }, [enableProcessFolding, hideProcessBehindLog, isBusy, turn])
  const [processExpanded, setProcessExpanded] = useState(false)
  const [logOpen, setLogOpen] = useState(false)

  useEffect(() => {
    setProcessExpanded(false)
    setLogOpen(false)
  }, [turn.id])

  useEffect(() => {
    if (!processFold.collapsible) {
      setProcessExpanded(false)
    }
  }, [processFold.collapsible])

  const usageSummary = useMemo(() => buildTurnUsageSummary(turn.usage), [turn.usage])
  const hasRenderableAssistantEntry = turn.entries.some((entry) => {
    return entry.kind === 'assistant' && isRenderableAssistantMessage(entry.message)
  })
  const showPendingAssistant = Boolean(turn.isCurrent && turn.user && !hasRenderableAssistantEntry && !turn.error && isBusy)
  const displayedEntries = processFold.collapsible && !processExpanded
    ? processFold.visibleEntries
    : turn.entries
  const processSummary = processFold.collapsible
    ? formatProcessToggleSummary(language, processFold.hiddenEntries)
    : ''
  const hasAssistantVisible = processFold.visibleEntries.some((entry) => entry.kind === 'assistant')
  const showPillToggle = processFold.collapsible && !(hideProcessBehindLog && hasAssistantVisible)
  const logFooter = hideProcessBehindLog && processFold.collapsible && hasAssistantVisible ? (
    <button
      type="button"
      aria-haspopup="dialog"
      onClick={() => setLogOpen(true)}
      title={language === 'zh' ? '查看工作日志' : 'View work log'}
      className="inline-flex shrink-0 items-center justify-center rounded-md border border-zinc-800/80 bg-zinc-900/70 p-1 text-zinc-400 transition-colors hover:border-zinc-700 hover:bg-zinc-900 hover:text-zinc-200"
    >
      <ScrollText className="size-3" />
    </button>
  ) : null
  const hasFinishedRun = Boolean(turn.status?.startedAt && turn.status?.finishedAt)
  const showHistoricalTurnStatus = Boolean(
    turn.status
    && !turn.isCurrent
    && hasFinishedRun
    && (turn.status.status === 'complete' || turn.status.status === 'error'),
  )
  const showTurnStatus = Boolean(
    turn.status
    && ((turn.isCurrent && (isBusy || hasFinishedRun)) || showHistoricalTurnStatus),
  )

  return (
    <div
      id={turn.anchorId}
      data-conversation-turn-id={turn.id}
      data-conversation-user-message-id={turn.user?.id}
      className={cn(
        turn.isCurrent ? 'space-y-3' : 'space-y-2.5',
        'scroll-mt-5 rounded-2xl transition-[background-color,box-shadow]',
        turn.highlighted && 'bg-sky-500/5 shadow-[inset_0_0_0_1px_rgba(56,189,248,0.38)]',
      )}
    >
      {turn.user
        ? renderMessage(turn.user, assistantLabel, assistantAvatarUrl, assistantAvatarFallback, assistantAvatarRuntime, showFullExecutionModel, userAvatarUrl, userAvatarFallback, userLabel, onOpenMessageLink, undefined, mobileHeaderLayout, undefined, mentionTargets)
        : null}

      {turn.conversationReferences && turn.conversationReferences.length > 0 ? (
        <div className={cn('flex flex-wrap gap-1.5', mobileHeaderLayout ? 'pl-0' : 'pl-9')}>
          {turn.conversationReferences.map((reference) => (
            <button
              key={reference.id}
              type="button"
              title={language === 'zh' ? `引用会话「${reference.title}」` : `References conversation "${reference.title}"`}
              onClick={() => navigator.clipboard.writeText(`${window.location.origin}/shared/${reference.id}`).catch(() => {})}
              className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-[11px] text-emerald-300 transition-colors hover:bg-emerald-500/20"
            >
              <MessageSquare className="h-3 w-3" />
              <span className="max-w-40 truncate">{reference.title}</span>
            </button>
          ))}
        </div>
      ) : null}

      {turn.referencedDocs && turn.referencedDocs.length > 0 ? (
        <div className={cn('flex flex-wrap gap-1.5', mobileHeaderLayout ? 'pl-0' : 'pl-9')}>
          {turn.referencedDocs.map((doc) => (
            <button
              key={doc.id}
              type="button"
              title={language === 'zh' ? `引用文档「${doc.name}」` : `References document "${doc.name}"`}
              onClick={() => window.location.assign('/drive')}
              className="inline-flex items-center gap-1.5 rounded-full border border-sky-500/30 bg-sky-500/10 px-2.5 py-1 text-[11px] text-sky-300 transition-colors hover:bg-sky-500/20"
            >
              <FileText className="h-3 w-3" />
              <span className="max-w-40 truncate">{doc.name}</span>
            </button>
          ))}
        </div>
      ) : null}

      {showPillToggle ? (
        <div className={cn('ml-9', mobileHeaderLayout && 'ml-0')}>
          <button
            type="button"
            aria-expanded={processExpanded}
            onClick={() => setProcessExpanded((value) => !value)}
            className="inline-flex items-center gap-1.5 rounded-full border border-zinc-800/80 bg-zinc-900/70 px-2.5 py-1 text-[11px] font-normal text-zinc-400 transition-colors hover:border-zinc-700 hover:bg-zinc-900 hover:text-zinc-200"
          >
            {processExpanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
            <span>{language === 'zh' ? (processExpanded ? '收起过程' : '展开过程') : (processExpanded ? 'Hide process' : 'Show process')}</span>
            <span className="text-zinc-500">{processSummary}</span>
          </button>
        </div>
      ) : null}

      {displayedEntries.length > 0 ? (
        <div className="space-y-3">
          {renderTurnEntries(
            displayedEntries,
            !(isBusy && turn.isCurrent),
            assistantLabel,
            assistantAvatarUrl,
            assistantAvatarFallback,
            assistantAvatarRuntime,
            showFullExecutionModel,
            userAvatarUrl,
            userAvatarFallback,
            userLabel,
            onOpenMessageLink,
            mobileHeaderLayout,
            logFooter,
            mentionTargets,
          )}
        </div>
      ) : null}

      {showPendingAssistant ? (
        <TypingBubble
          step={turn.status?.step || fallbackStep || (language === 'zh' ? '正在响应...' : 'Responding...')}
          assistantLabel={assistantLabel}
          assistantAvatarUrl={assistantAvatarUrl}
          assistantAvatarFallback={assistantAvatarFallback}
          assistantAvatarRuntime={assistantAvatarRuntime}
          mobileHeaderLayout={mobileHeaderLayout}
        />
      ) : null}

      {showTurnStatus && turn.status ? (
        <div className={cn('ml-9', mobileHeaderLayout && 'ml-0')}>
          <TurnStatusMeta status={turn.status.status}>
            <TurnStatusExtraMeta status={turn.status} />
          </TurnStatusMeta>
          {usageSummary ? (
            <div className="mt-1 text-xs text-zinc-500">
              {usageSummary}
            </div>
          ) : null}
        </div>
      ) : null}

      {turn.error ? (
        <div className="rounded-lg border border-rose-500/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
          {turn.error.message}
        </div>
      ) : null}

      <Dialog open={logOpen} onOpenChange={setLogOpen}>
        <DialogContent
          className="max-w-2xl gap-0 border-zinc-800 bg-[#09090b] p-0 text-zinc-100 shadow-2xl shadow-black/40 sm:rounded-xl"
        >
          <DialogHeader className="pr-12 text-left">
            <DialogTitle className="flex items-center gap-2 text-sm font-medium text-zinc-200">
              <ScrollText className="size-4 text-zinc-500" />
              {language === 'zh' ? '工作日志' : 'Work log'}
            </DialogTitle>
            {processSummary ? (
              <DialogDescription className="text-xs text-zinc-500">
                {processSummary}
              </DialogDescription>
            ) : null}
          </DialogHeader>
          <div className="scrollbar-subtle max-h-[70vh] overflow-y-auto p-4">
            <div className="space-y-3">
              {renderTurnEntries(
                processFold.hiddenEntries,
                !(isBusy && turn.isCurrent),
                assistantLabel,
                assistantAvatarUrl,
                assistantAvatarFallback,
                assistantAvatarRuntime,
                showFullExecutionModel,
                userAvatarUrl,
                userAvatarFallback,
                userLabel,
                onOpenMessageLink,
                mobileHeaderLayout,
                undefined,
                mentionTargets,
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}, (previous, next) => {
  return previous.isBusy === next.isBusy
    && previous.language === next.language
    && previous.assistantLabel === next.assistantLabel
    && previous.assistantAvatarUrl === next.assistantAvatarUrl
    && previous.assistantAvatarFallback === next.assistantAvatarFallback
    && previous.assistantAvatarRuntime === next.assistantAvatarRuntime
    && previous.showFullExecutionModel === next.showFullExecutionModel
    && previous.fallbackStep === next.fallbackStep
    && previous.userAvatarUrl === next.userAvatarUrl
    && previous.userAvatarFallback === next.userAvatarFallback
    && previous.userLabel === next.userLabel
    && previous.onOpenMessageLink === next.onOpenMessageLink
    && previous.mobileHeaderLayout === next.mobileHeaderLayout
    && previous.enableProcessFolding === next.enableProcessFolding
    && previous.hideProcessBehindLog === next.hideProcessBehindLog
    && previous.mentionTargets === next.mentionTargets
    && areTurnsEqual(previous.turn, next.turn)
})

export function ConversationFeed({
  turns,
  isBusy,
  assistantLabel = 'AI',
  assistantAvatarUrl,
  assistantAvatarFallback,
  assistantAvatarRuntime,
  showFullExecutionModel = false,
  fallbackStep = '',
  emptyTitle,
  emptyDescription,
  userAvatarUrl,
  userAvatarFallback,
  userLabel = '你',
  onOpenMessageLink,
  mobileHeaderLayout = false,
  enableProcessFolding = false,
  hideProcessBehindLog = false,
  mentionTargets,
}: ConversationFeedProps) {
  const { language } = useTranslation()

  if (turns.length === 0) {
    return <EmptyState title={emptyTitle} description={emptyDescription} />
  }

  return (
    <div className="space-y-4">
      {turns.map((turn) => (
        <ConversationTurnItem
          key={turn.id}
          turn={turn}
          isBusy={isBusy}
          language={language}
          assistantLabel={assistantLabel}
          assistantAvatarUrl={assistantAvatarUrl}
          assistantAvatarFallback={assistantAvatarFallback}
          assistantAvatarRuntime={assistantAvatarRuntime}
          showFullExecutionModel={showFullExecutionModel}
          fallbackStep={fallbackStep}
          userAvatarUrl={userAvatarUrl}
          userAvatarFallback={userAvatarFallback}
          userLabel={userLabel}
          onOpenMessageLink={onOpenMessageLink}
          mobileHeaderLayout={mobileHeaderLayout}
          enableProcessFolding={enableProcessFolding}
          hideProcessBehindLog={hideProcessBehindLog}
          mentionTargets={mentionTargets}
        />
      ))}
    </div>
  )
}
