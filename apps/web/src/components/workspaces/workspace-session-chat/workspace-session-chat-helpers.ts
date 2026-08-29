// [INPUT]: 工作区会话、任务聊天时间线、运行时配置与展示状态
// [OUTPUT]: 会话聊天使用的纯函数、状态判定、格式化与实时通道错误分类
// [POS]: /workspace 会话聊天的共享前端规则层，不负责网络请求或执行调度
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
import { mergeAgentRuntimeSettings, normalizeAgentSettings } from '@shared/agent-config'
import { VIBEMUX_MCP_SERVER_ID, type McpServerPolicy } from '@shared/mcp'
import { isOpenCodeMissingTextOutput } from '@shared/opencode-message-output'
import { resolveProjectEnvironmentPreview } from '@shared/project-environment-template'
import type { TaskChatAttachment } from '@shared/task-chat-attachment'
import type { SubagentEnvironmentContext, TaskSubagentObservation } from '@shared/subagent-role'
import { buildWorkspaceTaskExecutionView, sortWorkspaceSessions } from '@shared/task-workspace'
import type {
  AgentRunningStatus,
  AgentRuntimeSettings,
  AgentSettings,
  AppState,
  ExecutionLog,
  ModelTokenUsage,
  Project,
  Task,
  WorkspaceSession,
  WorkspaceSessionRuntimeStatus,
} from '@shared/types'
import {
  collapseDuplicateAssistantEvents,
  isAssistantMessageEvent,
  isErrorEvent,
  isInteractionEvent,
  isStatusEvent,
  isSystemMessageEvent,
  isThinkingEvent,
  isToolCallEvent,
  isUserMessageEvent,
  upsertTimelineEvent,
} from '@shared/timeline'
import type { ConversationMessageRecord } from '../../../lib/api'
import { buildTaskAgentOptions } from '../../../lib/agent-runtime-options'
import type { ChatTimelineEvent } from '../../../lib/workspace-session-chat-ui'
import type { ChatTranscriptTurnEntry } from '../../chat/chat-transcript'
import { buildWorkspaceWorktreePath } from '@shared/workspace-paths'

export interface NoticeItem {
  id: string
  level: 'info' | 'warning' | 'error'
  message: string
}

export type TimelineTurnDisplay = {
  id: string
  user?: Extract<ChatTimelineEvent, { kind: 'user_message' }>
  entries: ChatTranscriptTurnEntry[]
  status?: Extract<ChatTimelineEvent, { kind: 'status' }>
  error?: Extract<ChatTimelineEvent, { kind: 'error' }>
  usage?: ModelTokenUsage
  isCurrent: boolean
}

export const isAutoRenameableWorkspaceSessionTitleOrigin = (
  titleOrigin?: WorkspaceSession['titleOrigin'] | null,
) => {
  return (titleOrigin ?? 'system') === 'system'
}

export const shouldAttemptAutoRenameWorkspaceSession = (params: {
  onWorkspaceSessionChange?: unknown
  targetWorkspaceId?: string
  targetWorkspaceSessionId?: string
  workspaceSession?: WorkspaceSession | null
}) => {
  if (!params.targetWorkspaceId || !params.targetWorkspaceSessionId || !params.onWorkspaceSessionChange) {
    return false
  }

  return isAutoRenameableWorkspaceSessionTitleOrigin(params.workspaceSession?.titleOrigin)
}

export const isRenderableWorkspaceAssistantMessage = (params: {
  text: string
  attachments?: { id: string }[]
}) => {
  const normalizedText = params.text.trim()
  if ((params.attachments?.length ?? 0) > 0) {
    return true
  }

  if (!normalizedText) {
    return false
  }

  return !isOpenCodeMissingTextOutput(normalizedText)
}

export const canMutateWorkspaceUserTurn = (params: {
  turn: TimelineTurnDisplay
  isWorkspaceHistoryMode: boolean
  isSessionBusy: boolean
}) => {
  if (!params.turn.user || !params.turn.isCurrent) {
    return false
  }

  const hasRenderableAssistantEntry = params.turn.entries.some((entry) => {
    return entry.kind === 'assistant'
      && entry.message.authorType !== 'system'
      && isRenderableWorkspaceAssistantMessage({
        text: entry.message.text,
        attachments: entry.message.attachments,
      })
  })
  const hasBlockingOutput = hasRenderableAssistantEntry || params.turn.entries.some((entry) => {
    return entry.kind === 'thinking' || entry.kind === 'tool' || entry.kind === 'interaction'
  }) || Boolean(params.turn.error)

  if (params.isWorkspaceHistoryMode) {
    return !params.isSessionBusy && !hasBlockingOutput
  }

  return !hasRenderableAssistantEntry && !params.isSessionBusy
}

export const canReviseWorkspaceUserTurn = (params: {
  turn: TimelineTurnDisplay
  isWorkspaceHistoryMode: boolean
  isSessionBusy: boolean
}) => {
  if (!params.isWorkspaceHistoryMode || !params.turn.user || params.isSessionBusy) {
    return false
  }

  const hasRenderableAssistantEntry = params.turn.entries.some((entry) => {
    return entry.kind === 'assistant'
      && entry.message.authorType !== 'system'
      && isRenderableWorkspaceAssistantMessage({
        text: entry.message.text,
        attachments: entry.message.attachments,
      })
  })

  return hasRenderableAssistantEntry
}

export const canRetryWorkspaceAssistantTurn = (params: {
  turn: TimelineTurnDisplay
  isWorkspaceHistoryMode: boolean
  isSessionBusy: boolean
}) => {
  if (!params.isWorkspaceHistoryMode || !params.turn.user || params.isSessionBusy) {
    return false
  }

  return params.turn.entries.some((entry) => {
    return entry.kind === 'assistant'
      && entry.message.authorType !== 'system'
      && isRenderableWorkspaceAssistantMessage({
        text: entry.message.text,
        attachments: entry.message.attachments,
      })
  })
}

type TaskWithScopedAgentSettings = Task & {
  agentSettings?: AgentRuntimeSettings
}

type TaskWithScopedMcpSettings = Task & {
  enabledMcpServerIds?: string[]
}

const hiddenSystemLogPatterns = [
  '已关联工作区',
  'Agent 系统已接收需求，正在做需求理解与技术栈分析。',
  '已收到裁剪需求，正在创建分支',
  '[分布式 preparing]',
  '[分布式 executing]',
  '[分布式 syncing_back]',
  '[分布式 assigned]',
  '[分布式 queued]',
  '[分布式 draft]',
  '[分布式 completed]',
  '[分布式 failed]',
  '[分布式 cancelled]',
  '[分布式 lost]',
  '[分布式 timed_out]',
  '后台准备已停止，已由更新的节点切换替代',
]

const hiddenInfoNoticeMessages = new Set([
  '消息已入队。',
  '委派消息已进入独立工作区会话队列。',
  '实时连接暂不可用，已通过备用通道加入消息队列。',
  '官方云节点正在启动，消息已进入队列，准备完成后会自动发送。',
])

export const TASK_CHAT_SOCKET_NOT_READY_MESSAGE = '实时连接尚未建立，请稍后重试。'

const observationKindLabels: Record<TaskSubagentObservation['kind'], string> = {
  action: '页面动作',
  terminal: '终端日志',
  'browser-console': '浏览器 Console',
  network: '网络请求',
  screenshot: '页面截图',
}

const truncateContextBlock = (value: string, limit = 1200) => {
  const trimmed = value.trim()
  if (trimmed.length <= limit) {
    return trimmed
  }

  return `${trimmed.slice(0, limit)}\n…(已截断)`
}

export const aggregateTimelineForDisplay = (
  timeline: ChatTimelineEvent[],
  isRunning: boolean,
): TimelineTurnDisplay[] => {
  const normalizedTimeline = collapseDuplicateAssistantEvents(timeline)
  if (normalizedTimeline.length === 0) {
    return []
  }

  const latestTurnId = normalizedTimeline.at(-1)?.turnId ?? ''
  const turns = new Map<string, TimelineTurnDisplay>()
  const orderedTurnIds: string[] = []

  const getTurn = (turnId: string) => {
    const existing = turns.get(turnId)
    if (existing) {
      return existing
    }

    const next: TimelineTurnDisplay = {
      id: turnId,
      entries: [],
      isCurrent: turnId === latestTurnId,
    }
    turns.set(turnId, next)
    orderedTurnIds.push(turnId)
    return next
  }

  for (const entry of normalizedTimeline) {
    const turn = getTurn(entry.turnId)

    if (isUserMessageEvent(entry)) {
      turn.user = entry
      continue
    }

    if (isAssistantMessageEvent(entry)) {
      const existingIndex = turn.entries.findIndex((item) => item.kind === 'assistant' && item.id === entry.id)
      const message = {
        id: entry.messageId,
        role: 'assistant' as const,
        text: entry.text,
        createdAt: entry.ts,
        authorName: entry.authorName,
        executionModel: entry.executionModel,
        attachments: entry.attachments,
      }
      if (existingIndex === -1) {
        turn.entries.push({
          kind: 'assistant',
          id: entry.id,
          message,
        })
      } else {
        turn.entries[existingIndex] = {
          kind: 'assistant',
          id: entry.id,
          message,
        }
      }
      continue
    }

    if (isSystemMessageEvent(entry)) {
      const existingIndex = turn.entries.findIndex((item) => item.kind === 'assistant' && item.id === entry.id)
      const message = {
        id: entry.id,
        role: 'assistant' as const,
        text: entry.message,
        createdAt: entry.ts,
        authorType: 'system' as const,
        authorName: '系统提示',
      }
      if (existingIndex === -1) {
        turn.entries.push({
          kind: 'assistant',
          id: entry.id,
          message,
        })
      } else {
        turn.entries[existingIndex] = {
          kind: 'assistant',
          id: entry.id,
          message,
        }
      }
      continue
    }

    if (entry.kind === 'delivery_result') {
      const existingIndex = turn.entries.findIndex((item) => item.kind === 'delivery_result' && item.id === entry.id)
      const nextEntry: ChatTranscriptTurnEntry = {
        kind: 'delivery_result',
        id: entry.id,
        message: entry.message,
        createdAt: entry.ts,
        remoteBranchName: entry.remoteBranchName,
        commitShas: entry.commitShas,
        delivery: entry.delivery,
      }
      if (existingIndex === -1) {
        turn.entries.push(nextEntry)
      } else {
        turn.entries[existingIndex] = nextEntry
      }
      if (entry.changeSummary) {
        turn.entries = turn.entries.map((item) => (
          item.kind === 'tool'
            ? { ...item, changeSummary: entry.changeSummary }
            : item
        ))
        const summaryEntry: ChatTranscriptTurnEntry = {
          kind: 'change_summary',
          id: `${entry.id}:change-summary`,
          changeSummary: entry.changeSummary,
          createdAt: entry.ts,
        }
        const summaryIndex = turn.entries.findIndex((item) => item.kind === 'change_summary' && item.id === summaryEntry.id)
        if (summaryIndex === -1) {
          turn.entries.push(summaryEntry)
        } else {
          turn.entries[summaryIndex] = summaryEntry
        }
      }
      continue
    }

    if (isThinkingEvent(entry)) {
      const existingIndex = turn.entries.findIndex((item) => item.kind === 'thinking' && item.id === entry.id)
      const nextEntry: ChatTranscriptTurnEntry = {
        kind: 'thinking',
        id: entry.id,
        content: entry.text,
      }
      if (existingIndex === -1) {
        turn.entries.push(nextEntry)
      } else {
        turn.entries[existingIndex] = nextEntry
      }
      continue
    }

    if (isToolCallEvent(entry)) {
      const existingIndex = turn.entries.findIndex((item) => item.kind === 'tool' && item.id === entry.id)
      const deliveryEntryWithSummary = turn.entries.find((item): item is Extract<ChatTranscriptTurnEntry, { kind: 'delivery_result' }> => {
        return item.kind === 'delivery_result' && Boolean(item.changeSummary)
      })
      const turnChangeSummary = deliveryEntryWithSummary?.changeSummary
      const nextEntry: ChatTranscriptTurnEntry = {
        kind: 'tool',
        id: entry.id,
        tool: entry.toolCall,
        changeSummary: turnChangeSummary,
      }
      if (existingIndex === -1) {
        turn.entries.push(nextEntry)
      } else {
        turn.entries[existingIndex] = nextEntry
      }
      continue
    }

    if (isInteractionEvent(entry)) {
      const existingIndex = turn.entries.findIndex((item) => item.kind === 'interaction' && item.id === entry.id)
      const nextEntry: ChatTranscriptTurnEntry = {
        kind: 'interaction',
        id: entry.id,
        interaction: entry.interaction,
        createdAt: entry.ts,
      }
      if (existingIndex === -1) {
        turn.entries.push(nextEntry)
      } else {
        turn.entries[existingIndex] = nextEntry
      }
      continue
    }

    if (isStatusEvent(entry)) {
      if (
        entry.status === 'complete'
        || entry.status === 'error'
        || (entry.turnId === latestTurnId && isRunning)
      ) {
        turn.status = entry
      }
      continue
    }

    if (isErrorEvent(entry)) {
      turn.error = entry
    }
  }

  return removeReplayedAssistantPrefixes(orderedTurnIds
    .map((turnId) => turns.get(turnId)!)
    .filter((turn) => Boolean(
      turn.user
      || turn.entries.length > 0
      || turn.status
      || turn.error,
    )))
}

const normalizeAssistantEntryText = (entry: ChatTranscriptTurnEntry) => {
  if (entry.kind !== 'assistant') {
    return ''
  }
  if (entry.message.authorType === 'system') {
    return ''
  }

  return entry.message.text.trim().replace(/\s+/g, ' ')
}

const removeReplayedAssistantPrefixes = (turns: TimelineTurnDisplay[]) => {
  const seenAssistantTexts = new Set<string>()

  return turns.map((turn) => {
    let replayedPrefixLength = 0
    for (const entry of turn.entries) {
      const text = normalizeAssistantEntryText(entry)
      if (!text || !seenAssistantTexts.has(text)) {
        break
      }
      replayedPrefixLength += 1
    }

    const entries = replayedPrefixLength > 0 && replayedPrefixLength < turn.entries.length
      ? turn.entries.slice(replayedPrefixLength)
      : turn.entries

    for (const entry of entries) {
      const text = normalizeAssistantEntryText(entry)
      if (text) {
        seenAssistantTexts.add(text)
      }
    }

    return entries === turn.entries ? turn : { ...turn, entries }
  })
}

export const upsertOptimisticTaskChatTurn = (
  timeline: ChatTimelineEvent[],
  params: {
    turnId: string
    text: string
    status: Extract<AgentRunningStatus, 'thinking' | 'executing' | 'waiting'>
    step: string
    ts?: string
    attachments?: TaskChatAttachment[]
  },
) => {
  const ts = params.ts ?? new Date().toISOString()
  const messageId = `user:${params.turnId}`
  const userMessageEvent: ChatTimelineEvent = {
    id: `turn:${params.turnId}:user:${messageId}`,
    ts,
    turnId: params.turnId,
    seq: 1,
    kind: 'user_message',
    messageId,
    text: params.text,
    ...(params.attachments?.length ? { attachments: params.attachments } : {}),
  }
  const statusEvent: ChatTimelineEvent = {
    id: `turn:${params.turnId}:status:${params.status}:${params.step}`,
    ts,
    turnId: params.turnId,
    seq: 2,
    kind: 'status',
    status: params.status,
    step: params.step,
  }

  return [userMessageEvent, statusEvent].reduce(
    (events, event) => upsertTimelineEvent(events, event),
    timeline,
  )
}

export const replaceOptimisticTaskChatTurnStatus = (
  timeline: ChatTimelineEvent[],
  params: {
    turnId: string
    status: Extract<AgentRunningStatus, 'thinking' | 'executing' | 'waiting'>
    step: string
    ts?: string
  },
) => {
  const nextTimeline = timeline.filter((event) => !(event.turnId === params.turnId && event.kind === 'status'))

  return upsertTimelineEvent(nextTimeline, {
    id: `turn:${params.turnId}:status:${params.status}:${params.step}`,
    ts: params.ts ?? new Date().toISOString(),
    turnId: params.turnId,
    seq: 2,
    kind: 'status',
    status: params.status,
    step: params.step,
  })
}

export const removeTaskChatTurnEvents = (
  timeline: ChatTimelineEvent[],
  turnId: string,
) => {
  return timeline.filter((event) => event.turnId !== turnId)
}

export const shouldShowSystemLog = (log: Pick<ExecutionLog, 'content'>) => {
  return !hiddenSystemLogPatterns.some((pattern) => log.content.includes(pattern))
}

export const shouldShowTaskChatNotice = (notice: Pick<NoticeItem, 'level' | 'message'>) => {
  if (notice.level !== 'info') {
    return true
  }

  return !hiddenInfoNoticeMessages.has(notice.message.trim())
}

export const prependNotice = (prev: NoticeItem[], notice: NoticeItem) => {
  if (!shouldShowTaskChatNotice(notice)) {
    return prev
  }

  return [notice, ...prev].slice(0, 4)
}

export const agentOptions = buildTaskAgentOptions()

export const normalizeChatErrorMessage = (message: string) => {
  if (message.includes('does not support image input')) {
    return '当前模型不支持图片输入，请移除图片后重试，或切换到支持图片的模型。'
  }

  return message
}

export const isTaskChatSocketNotReadyError = (error: unknown) => {
  if (!(error instanceof Error)) {
    return false
  }

  return error.message.includes(TASK_CHAT_SOCKET_NOT_READY_MESSAGE)
    || error.message.includes('实时连接已断开')
}

export const resolveTaskChatQueueStatusMessage = (
  runtimeStatus: WorkspaceSessionRuntimeStatus | undefined,
  currentStep: string,
) => {
  if (runtimeStatus !== 'queued') {
    return ''
  }

  return currentStep.trim() || '执行节点执行队列已满，当前会话正在排队，等待空闲槽位后自动开始。'
}

export const formatObservationNotice = (observation: TaskSubagentObservation): NoticeItem => {
  const prefix = observationKindLabels[observation.kind]
  const message = observation.detail?.trim()
    ? `${prefix} · ${observation.title}：${observation.detail.trim()}`
    : `${prefix} · ${observation.title}`

  return {
    id: observation.id,
    level: observation.level === 'error'
      ? 'error'
      : observation.level === 'warning'
        ? 'warning'
        : 'info',
    message,
  }
}

export const buildTesterLogContext = (logs: ExecutionLog[]) => {
  if (logs.length === 0) {
    return ''
  }

  return [
    '[最近环境/终端观测]',
    ...logs.map((log) => `- ${log.createdAt}\n${truncateContextBlock(log.content)}`),
  ].join('\n')
}

export const buildTesterObservationContext = (messages: ConversationMessageRecord[]) => {
  if (messages.length === 0) {
    return ''
  }

  return [
    '[最近浏览器观测]',
    ...messages.map((message) => `- ${message.createdAt}\n${truncateContextBlock(message.content)}`),
  ].join('\n')
}

export const resolveSubagentEnvironmentContext = (params: {
  project?: Project | null
  session?: WorkspaceSession
  workspaceOwnerUserId?: string
  workspaceRoot?: string
  workspaceRepoPath?: string
}): SubagentEnvironmentContext | null => {
  if (!params.project || !params.session) {
    return null
  }

  const cwd = params.session.workingDirectoryMode === 'original-dir'
    ? params.workspaceRepoPath?.trim() || undefined
    : buildWorkspaceWorktreePath(
      params.workspaceRoot,
      params.project,
      params.session.worktreeId,
      params.session.workspaceId,
      params.workspaceOwnerUserId,
    )

  const preview = resolveProjectEnvironmentPreview({
    project: params.project,
    session: params.session,
    cwd,
  })

  if (!preview && !cwd) {
    return null
  }

  return {
    cwd,
    installCommand: preview?.installCommand,
    startCommand: preview?.startCommand,
    stopCommand: preview?.stopCommand,
    healthUrl: preview?.healthUrl,
    appUrl: preview?.appUrl,
    logsCommand: preview?.logsCommand,
  }
}

export const resolveUpdatedTaskFromState = (
  state: Pick<AppState, 'tasks' | 'workspaceSessions'>,
  taskId: string,
  workspaceId?: string,
  workspaceSessionId?: string,
) => {
  const baseTask = state.tasks.find((item) => item.id === taskId)
  if (!baseTask) {
    return null
  }

  if (!workspaceId) {
    return baseTask
  }

  const scopedSessions = state.workspaceSessions
    .filter((item) => item.workspaceId === workspaceId)
  const orderedSessions = sortWorkspaceSessions(scopedSessions)
  const session = workspaceSessionId
    ? orderedSessions.find((item) => item.id === workspaceSessionId) ?? orderedSessions[0]
    : orderedSessions[0]

  return session ? buildWorkspaceTaskExecutionView(baseTask, session) : baseTask
}

export const resolveUpdatedTaskFromMutation = (
  task: Task,
  workspaceSession?: WorkspaceSession | null,
) => {
  return workspaceSession ? buildWorkspaceTaskExecutionView(task, workspaceSession) : task
}

export const resolveWorkspaceSessionScopedRuntimeConfig = (
  task: Task,
  workspaceSession?: WorkspaceSession | null,
) => {
  const scopedTask = workspaceSession ? buildWorkspaceTaskExecutionView(task, workspaceSession) : task

  return {
    agentType: scopedTask.agentType,
    executionModel: scopedTask.executionModel ?? '',
    agentSettings: getTaskScopedAgentSettings(scopedTask),
    enabledMcpServerIds: getTaskScopedEnabledMcpServerIds(scopedTask),
  }
}

export const getTaskScopedAgentSettings = (task: Task) => {
  return (task as TaskWithScopedAgentSettings).agentSettings
}

export const getTaskScopedEnabledMcpServerIds = (task: Task) => {
  return (task as TaskWithScopedMcpSettings).enabledMcpServerIds
}

export const mergeTaskChatMcpServers = (servers: McpServerPolicy[]) => {
  const seen = new Set<string>()
  return servers.filter((server) => {
    const key = server.id?.trim() || server.name.trim()
    if (!key || seen.has(key)) {
      return false
    }

    seen.add(key)
    return true
  })
}

export const normalizeMcpSelection = (selectedIds?: string[]) => {
  return Array.from(
    new Set((selectedIds ?? []).map((item) => item.trim()).filter(Boolean)),
  ).sort((left, right) => left.localeCompare(right))
}

export const resolveTaskChatMcpServerSelection = (
  servers: McpServerPolicy[],
  scopedEnabledMcpServerIds?: string[],
) => {
  const availableIds = new Set(servers.map((server) => server.id))
  if (!Array.isArray(scopedEnabledMcpServerIds)) {
    return availableIds.has(VIBEMUX_MCP_SERVER_ID) ? [VIBEMUX_MCP_SERVER_ID] : []
  }

  return normalizeMcpSelection(scopedEnabledMcpServerIds).filter((id) => availableIds.has(id))
}

export const resolveTaskChatRuntimeSettings = (
  agentType: Task['agentType'],
  globalAgentSettings?: AgentSettings,
  scopedAgentSettings?: AgentRuntimeSettings,
) => {
  const normalizedAgentSettings = normalizeAgentSettings(globalAgentSettings)
  return mergeAgentRuntimeSettings(agentType, normalizedAgentSettings[agentType], scopedAgentSettings)
}
