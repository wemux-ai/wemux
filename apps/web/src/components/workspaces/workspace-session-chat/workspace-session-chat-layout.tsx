import { type ReactNode, type Ref, type UIEventHandler, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { Bot, Check, ChevronDown, ChevronUp, Clock3, Copy, File, FileText, GitBranch, ImagePlus, Loader2, Pencil, Radio, Send, Square, Trash2, X } from 'lucide-react'
import type { AgentRecord } from '../../../lib/api'
import type { SkillRecord } from '@shared/skill'
import type { CreatorIdentity, Project, WorkspaceSession } from '@shared/types'
import { parseCustomAgentProfile } from '../../../lib/custom-agent/draft'
import { isImeComposingKeyboardEvent } from '../../../lib/ime-keyboard'
import { resolveApiUrl } from '../../../lib/runtime-config'
import { agentMeta, cn } from '../../../lib/utils'
import { ChatComposer } from '../../chat/chat-composer'
import { ChatTranscript } from '../../chat/chat-transcript'
import { ChatViewport } from '../../chat/chat-viewport'
import { RuntimeLabel } from '../../runtime/runtime-icons'
import { Badge } from '../../ui/badge'
import { Button } from '../../ui/button'
import { Card, CardContent, CardHeader } from '../../ui/card'
import { PreviewableImage } from '../../ui/previewable-image'
import { AgentChatQueue, ExecutorSwitchEventCard, parseExecutorSwitchSummary, QueuedMessages, SystemLogItem, TaskCreatedResultCard } from './workspace-session-chat-ui'
import type { TaskChatAttachment } from '@shared/task-chat-attachment'
import type { TaskChatQueueEntry } from '@shared/task-chat-session'
import type { ExecutionLog, Task } from '@shared/types'
import type { AgentType } from '@shared/types'
import type { WorkspaceSessionDisplayStatus } from '../../../lib/workspace-session-status'
import {
  canMutateWorkspaceUserTurn,
  canRetryWorkspaceAssistantTurn,
  canReviseWorkspaceUserTurn,
  isRenderableWorkspaceAssistantMessage,
  shouldShowSystemLog,
  type NoticeItem,
  type TimelineTurnDisplay,
} from './workspace-session-chat-helpers'
import {
  buildTaskChatTurnAnchorId,
  type TaskChatOutlineItem,
} from './workspace-session-chat-outline'
import { WorkspaceSessionChatMentionMenu } from './workspace-session-chat-mention-menu'
import { traceWorkspaceSessionChat } from './workspace-session-chat-trace'
import type {
  ChatImage,
  WorkspaceSessionChatRevisionAction,
  WorkspaceSessionKnownCollaborator,
  WorkspaceSessionSelectedContextItem,
} from './workspace-session-chat-types'

type DraftQueueItem = {
  id: string
  content: string
  attachments: TaskChatAttachment[]
  createdAt: string
  editedAt?: string
}

interface MentionedAgentItem {
  agent: AgentRecord
  start: number
}

interface TaskChatHeaderProps {
  socketStatus: 'connecting' | 'open' | 'closed' | 'error'
  liveBadgeTone: string
  isSessionBusy: boolean
  queuePending: boolean
  sessionQueued: boolean
  displayStatus: WorkspaceSessionDisplayStatus
  visibleMessagesCount: number
  visibleToolsCount: number
  selectedAgentType: Task['agentType']
  workspaceSession?: WorkspaceSession | null
  workspaceSessions?: WorkspaceSession[]
  isSubagentSession: boolean
  sessionRoleLabel: string
  boundCustomAgentName: string
  boundCustomAgentMode: string
  mountedSkillNames: string[]
  mountedMcpServerNames: string[]
  sessionTokenSummary?: string
  flush?: boolean
}

interface TaskChatFeedProps {
  scrollRef: Ref<HTMLDivElement>
  onScroll: UIEventHandler<HTMLDivElement>
  bottomInset: number
  isMobile?: boolean
  assistantAvatarUrl?: string
  currentUserId?: string
  knownCollaborators?: WorkspaceSessionKnownCollaborator[]
  workspaceCreatedBy?: CreatorIdentity
  workspaceOwnerUserId?: string
  userAvatarUrl?: string
  userAvatarFallback?: string
  userLabel?: string
  hasMoreBefore: boolean
  isWorkspaceHistoryMode: boolean
  loadingMoreBefore: boolean
  loadOlderSentinelRef?: Ref<HTMLDivElement>
  onLoadOlderTranscriptPage: () => void
  selectedAgentType: Task['agentType']
  boundCustomAgentName: string
  boundCustomAgentMode: string
  mountedSkillNames: string[]
  mountedMcpServerNames: string[]
  notices: NoticeItem[]
  systemLogs: ExecutionLog[]
  displayTimeline: TimelineTurnDisplay[]
  tasksById?: ReadonlyMap<string, Task>
  initialTranscriptReady?: boolean
  isSessionBusy: boolean
  displayStep: string
  currentRunTiming?: {
    turnId: string
    startedAt: string
    finishedAt?: string
  } | null
  outlineItems?: TaskChatOutlineItem[]
  queueStatusMessage?: string
  scrollShortcutTarget: 'top' | 'bottom' | null
  onJumpToBottom: () => void
  onJumpToTop: () => void
  onJumpToOutlineTurn?: (item: TaskChatOutlineItem) => Promise<unknown> | unknown
  onCopyMessage?: (messageId: string, text: string) => Promise<void> | void
  copiedMessageId?: string | null
  onDeleteMessage?: (messageId: string) => Promise<void> | void
  deletingMessageId?: string | null
  onEditMessage?: (messageId: string, text: string, attachments: TaskChatAttachment[]) => Promise<void> | void
  onOpenWorkspaceFileLink?: (href: string) => boolean
  onForkMessage?: (messageId: string, role: 'user' | 'assistant', text: string) => void
  forkingMessageId?: string | null
  onReviseTurn?: (payload: WorkspaceSessionChatRevisionAction) => void
  revisingTurnId?: string | null
  onOpenTaskFromResult?: (task: Task) => void
}

interface TaskChatComposerProps {
  executorId?: string
  fileRootPath?: string
  input: string
  floating?: boolean
  onInputChange: (value: string, caretTarget: HTMLTextAreaElement | null) => void
  onCaretChange: (target: HTMLTextAreaElement | null) => void
  onNavigateHistory: (direction: 'prev' | 'next') => void
  onSend: () => Promise<void>
  onStop: () => Promise<void>
  onPasteImages: (files: File[]) => void
  onUploadImages: (files: File[]) => void
  isUploading: boolean
  isSendingMessage: boolean
  busy: boolean
  sendDisabled: boolean
  isSessionBusy: boolean
  queueStatusMessage?: string
  queuedMessages: TaskChatQueueEntry[]
  onEditQueuedMessage: (queueId: string, message: string, attachments: TaskChatAttachment[]) => void
  onRemoveQueuedMessage: (queueId: string) => Promise<void>
  messageQueue: DraftQueueItem[]
  onRemoveQueuedDraft: (id: string) => void
  onEditQueuedDraft: (id: string, content: string) => void
  onMoveQueuedDraftToInput: (id: string) => void
  mentionedAgents: MentionedAgentItem[]
  mentionQueryActive: boolean
  mentionAvailableOptions: AgentRecord[]
  mentionProject?: Project | null
  mentionProjects?: Project[]
  mentionQueryText?: string
  mentionSkills?: SkillRecord[]
  mentionSkillsLoading?: boolean
  mentionUnavailableOptions: Array<{ agent: AgentRecord; blockerMessage: string }>
  onInsertAgentMention: (agent: AgentRecord) => void
  onInsertFileMention?: (item: { absolutePath: string; mentionPath: string; label: string; directoryLabel: string }) => void
  onInsertProjectMention?: (project: Project) => void
  onInsertSkillMention?: (token: string) => void
  selectedContextItems: WorkspaceSessionSelectedContextItem[]
  onRemoveSelectedContextItem: (key: string) => void
  images: ChatImage[]
  imagesLocked: boolean
  onRemoveImage: (id: string) => void
  footerControls: ReactNode
  actionPlacement?: 'inside' | 'side'
  placeholder?: string
  composerClassName?: string
  composerMaxHeight?: number
  composerMinHeight?: number
  sendActionClassName?: string
  containerClassName?: string
  inputShellClassName?: string
  shellClassName?: string
  uploadActionClassName?: string
  onHeightChange?: (height: number) => void
}

interface TaskChatSurfaceProps {
  scrollRef: Ref<HTMLDivElement>
  onScroll: UIEventHandler<HTMLDivElement>
  showJumpToBottom: boolean
  scrollShortcutTarget: 'top' | 'bottom' | null
  onJumpToBottom: () => void
  onJumpToTop: () => void
  onScrollToBottom?: (mode?: 'instant' | 'smooth') => void
  minBottomInset?: number
  feedProps: Omit<TaskChatFeedProps, 'scrollRef' | 'onScroll' | 'bottomInset' | 'scrollShortcutTarget' | 'onJumpToBottom' | 'onJumpToTop'>
  composerProps: Omit<TaskChatComposerProps, 'onHeightChange'>
}

const TASK_CHAT_SURFACE_MIN_BOTTOM_INSET = 224
const TASK_CHAT_FEED_FALLBACK_SORT_TS = Number.MAX_SAFE_INTEGER
const TASK_CHAT_FEED_ACTIVE_TURN_SORT_TS = Number.POSITIVE_INFINITY
const TASK_CHAT_CONTENT_MAX_WIDTH_CLASS = 'mx-auto w-full max-w-[1200px]'

// 与原 ChatComposerShell 默认一致的 shell 视觉（悬浮圆角 + 渐变底）
const TASK_CHAT_COMPOSER_DEFAULT_SHELL_CLASS = cn(
  'pointer-events-auto rounded-lg border border-zinc-800/40 bg-gradient-to-b from-[#09090b]/95 to-[#0a0a0c]/95 p-2.5 shadow-[0_8px_32px_rgba(0,0,0,0.35)] backdrop-blur-sm',
  TASK_CHAT_CONTENT_MAX_WIDTH_CLASS,
)

// 与原 ChatComposerShell 默认一致的输入框容器视觉
const TASK_CHAT_COMPOSER_DEFAULT_INPUT_SHELL_CLASS = cn(
  'rounded-lg border border-zinc-800/50 bg-[#111113] shadow-[0_0_0_1px_rgba(255,255,255,0.02),0_2px_16px_rgba(0,0,0,0.3)] transition-all focus-within:border-zinc-700/70 focus-within:shadow-[0_0_0_1px_rgba(255,255,255,0.04),0_4px_24px_rgba(0,0,0,0.4)]',
)

const parseTimestampMs = (value?: string) => {
  if (!value) {
    return null
  }

  const timestamp = new Date(value).getTime()
  return Number.isNaN(timestamp) ? null : timestamp
}

const ensureMinimumSettledTurnDuration = (params: {
  turn: TimelineTurnDisplay
  startedAt?: string
  finishedAt?: string
  isLiveCurrentTurn: boolean
}) => {
  const { turn, startedAt, finishedAt, isLiveCurrentTurn } = params
  if (isLiveCurrentTurn || !startedAt || !finishedAt) {
    return finishedAt
  }

  const startedAtMs = parseTimestampMs(startedAt)
  const finishedAtMs = parseTimestampMs(finishedAt)
  if (startedAtMs === null || finishedAtMs === null) {
    return finishedAt
  }

  const hasSettledTurnOutput = Boolean(
    turn.error
    || turn.entries.some((entry) => {
      if (entry.kind === 'assistant') {
        return Boolean(entry.message.text.trim()) || (entry.message.attachments?.length ?? 0) > 0
      }

      return entry.kind === 'thinking' || entry.kind === 'tool' || entry.kind === 'interaction'
    }),
  )

  if (!hasSettledTurnOutput || finishedAtMs - startedAtMs >= 1000) {
    return finishedAt
  }

  return new Date(startedAtMs + 1000).toISOString()
}

const resolveTurnTimingBounds = (params: {
  turn: TimelineTurnDisplay
  currentRunTiming?: {
    turnId: string
    startedAt: string
    finishedAt?: string
  } | null
}) => {
  const { turn, currentRunTiming } = params
  const currentTurnTiming = turn.isCurrent && currentRunTiming?.turnId === turn.id
    ? currentRunTiming
    : null
  const isLiveCurrentTurn = Boolean(
    turn.isCurrent
    && !currentTurnTiming?.finishedAt
    && !turn.error
    && (
      !turn.status
      || turn.status.status === 'thinking'
      || turn.status.status === 'executing'
      || turn.status.status === 'waiting'
    ),
  )

  const startedCandidates = [
    turn.user?.ts,
    turn.user?.ts ? undefined : currentTurnTiming?.startedAt,
    turn.status?.ts,
    turn.error?.ts,
    ...turn.entries.flatMap((entry) => {
      if (entry.kind === 'assistant') {
        return [entry.message.createdAt]
      }

      if (entry.kind === 'tool') {
        return [entry.tool.startedAt]
      }

      if (entry.kind === 'interaction') {
        return [entry.createdAt]
      }

      return []
    }),
  ].filter((value): value is string => Boolean(value))

  const finishedCandidates = [
    turn.status?.ts,
    turn.error?.ts,
    currentTurnTiming?.finishedAt,
    ...turn.entries.flatMap((entry) => {
      if (entry.kind === 'assistant') {
        return [entry.message.createdAt]
      }

      if (entry.kind === 'tool') {
        return [entry.tool.finishedAt ?? entry.tool.startedAt]
      }

      if (entry.kind === 'interaction') {
        return [entry.createdAt]
      }

      return []
    }),
  ].filter((value): value is string => Boolean(value))

  const turnStartedAt = startedCandidates.reduce<string | undefined>((earliest, current) => {
    if (!earliest) {
      return current
    }

    const earliestMs = parseTimestampMs(earliest)
    const currentMs = parseTimestampMs(current)
    if (earliestMs === null) {
      return current
    }
    if (currentMs === null) {
      return earliest
    }

    return currentMs < earliestMs ? current : earliest
  }, undefined)

  const turnFinishedAt = finishedCandidates.reduce<string | undefined>((latest, current) => {
    if (!latest) {
      return current
    }

    const latestMs = parseTimestampMs(latest)
    const currentMs = parseTimestampMs(current)
    if (latestMs === null) {
      return current
    }
    if (currentMs === null) {
      return latest
    }

    return currentMs > latestMs ? current : latest
  }, undefined)

  return {
    startedAt: turnStartedAt,
    finishedAt: ensureMinimumSettledTurnDuration({
      turn,
      startedAt: turnStartedAt,
      finishedAt: isLiveCurrentTurn ? undefined : turnFinishedAt,
      isLiveCurrentTurn,
    }),
  }
}

const resolveFeedTurnSortTimestampMs = (params: {
  turn: TimelineTurnDisplay
  currentRunTiming?: {
    turnId: string
    startedAt: string
    finishedAt?: string
  } | null
}) => {
  const { startedAt, finishedAt } = resolveTurnTimingBounds(params)
  return parseTimestampMs(finishedAt)
    ?? parseTimestampMs(startedAt)
    ?? TASK_CHAT_FEED_FALLBACK_SORT_TS
}

const resolveVisibleTurnContentSortTimestampMs = (turn: TimelineTurnDisplay) => {
  const visibleEntryTimestamps = turn.entries.flatMap((entry) => {
    if (entry.kind === 'assistant') {
      if (entry.message.authorType === 'system') {
        return []
      }

      const timestamp = parseTimestampMs(entry.message.createdAt)
      return timestamp === null ? [] : [timestamp]
    }

    if (entry.kind === 'delivery_result' || entry.kind === 'interaction') {
      const timestamp = parseTimestampMs(entry.createdAt)
      return timestamp === null ? [] : [timestamp]
    }

    return []
  })

  return visibleEntryTimestamps.length > 0
    ? Math.max(...visibleEntryTimestamps)
    : null
}

const taskChatDisplayStatusMeta: Record<WorkspaceSessionDisplayStatus, { label: string; tone: string }> = {
  idle: {
    label: '空闲',
    tone: 'border-zinc-800 bg-zinc-950 text-zinc-300',
  },
  queued: {
    label: '排队中',
    tone: 'border-amber-500/30 bg-amber-500/10 text-amber-100',
  },
  running: {
    label: '处理中',
    tone: 'border-sky-500/30 bg-sky-500/10 text-sky-200',
  },
  attention: {
    label: '待确认',
    tone: 'border-amber-500/30 bg-amber-500/10 text-amber-100',
  },
  complete: {
    label: '已完成',
    tone: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-100',
  },
  error: {
    label: '出错',
    tone: 'border-rose-500/30 bg-rose-500/10 text-rose-200',
  },
}

const runtimeEntries = Object.entries(agentMeta) as Array<[AgentType, { label: string }]>

const resolveAssistantRuntimeFromAuthor = (
  authorName: string | undefined,
  fallbackRuntime: Task['agentType'],
): AgentType => {
  const normalizedAuthorName = authorName?.trim().toLowerCase() || ''
  if (!normalizedAuthorName) {
    return fallbackRuntime
  }

  const matchedRuntime = runtimeEntries.find(([, meta]) => meta.label.trim().toLowerCase() === normalizedAuthorName)?.[0]
  return matchedRuntime ?? fallbackRuntime
}

const resolveWorkspaceUserDisplay = ({
  turnAuthor,
  turnAuthorId,
  currentUserId,
  currentUserLabel,
  knownCollaborator,
}: {
  turnAuthor?: CreatorIdentity
  turnAuthorId?: string
  currentUserId?: string
  currentUserLabel?: string
  knownCollaborator?: WorkspaceSessionKnownCollaborator
}) => {
  const normalizedAuthorId = turnAuthor?.id.trim() || turnAuthorId?.trim() || ''
  const normalizedCurrentUserId = currentUserId?.trim() || ''
  const memberName = knownCollaborator?.name?.trim() || ''
  const fallbackCurrentUserLabel = currentUserLabel?.trim() || ''
  const isCurrentUserTurn = turnAuthor?.type === 'agent'
    ? false
    : !normalizedAuthorId
    || !normalizedCurrentUserId
    || normalizedAuthorId === normalizedCurrentUserId

  return {
    isCurrentUserTurn,
    authorType: turnAuthor?.type ?? 'user' as const,
    authorName: turnAuthor?.name.trim() || memberName || (isCurrentUserTurn ? fallbackCurrentUserLabel : '成员'),
    avatarUrl: turnAuthor?.avatarUrl?.trim() || knownCollaborator?.avatarUrl?.trim() || undefined,
  }
}

const isRenderableTaskChatAssistantEntry = (
  entry: TimelineTurnDisplay['entries'][number],
) => {
  if (entry.kind !== 'assistant') {
    return false
  }

  return isRenderableWorkspaceAssistantMessage({
    text: entry.message.text,
    attachments: entry.message.attachments,
  })
}

const isRunningTurnStatus = (status?: TimelineTurnDisplay['status']) => {
  return status?.status === 'thinking' || status?.status === 'executing' || status?.status === 'waiting'
}

const hasRunningToolEntry = (turn: TimelineTurnDisplay) => {
  return turn.entries.some((entry) => entry.kind === 'tool' && !entry.tool.finishedAt)
}

const hasBusyTimelineAnchor = (timeline: TimelineTurnDisplay[]) => {
  return timeline.some((turn) => {
    if (!turn.isCurrent || turn.error) {
      return false
    }

    if (isRunningTurnStatus(turn.status)) {
      return true
    }

    const hasRenderableAssistantEntry = turn.entries.some((entry) => isRenderableTaskChatAssistantEntry(entry))
    if (turn.user && !hasRenderableAssistantEntry) {
      return true
    }

    return turn.entries.some((entry) => {
      if (entry.kind === 'assistant') {
        return Boolean(entry.message.streaming)
      }

      if (entry.kind === 'tool') {
        return !entry.tool.finishedAt
      }

      return false
    })
  })
}

const shouldNavigateComposerHistory = (
  target: HTMLTextAreaElement,
  direction: 'prev' | 'next',
  input: string,
) => {
  if (input.includes('\n')) {
    return false
  }

  const selectionStart = target.selectionStart ?? 0
  const selectionEnd = target.selectionEnd ?? 0
  if (selectionStart !== selectionEnd) {
    return false
  }

  if (direction === 'prev') {
    return selectionStart === 0
  }

  return selectionEnd === input.length
}

export function TaskChatHeader({
  liveBadgeTone,
  isSessionBusy,
  queuePending,
  sessionQueued,
  displayStatus,
  visibleMessagesCount,
  visibleToolsCount,
  selectedAgentType,
  workspaceSession,
  workspaceSessions = [],
  isSubagentSession,
  sessionRoleLabel,
  boundCustomAgentName,
  boundCustomAgentMode,
  mountedSkillNames,
  mountedMcpServerNames,
  sessionTokenSummary,
  flush = false,
}: TaskChatHeaderProps) {
  const displayStatusMeta = taskChatDisplayStatusMeta[displayStatus]
  const liveBadgeLabel = sessionQueued
    ? '会话排队中'
    : displayStatus === 'attention'
      ? '等待确认'
      : isSessionBusy
        ? '会话处理中'
        : queuePending
          ? '消息待发送'
          : ''

  const content = (
    <>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex shrink-0 items-center gap-2 whitespace-nowrap text-sm font-medium">
          <Bot size={14} />
          AI 对话
        </div>
        <div className="flex min-w-0 flex-wrap items-center gap-2 sm:justify-end">
          {liveBadgeLabel ? (
            <Badge variant="outline" className={cn('gap-1.5 border text-xs', liveBadgeTone)}>
              <Radio className={cn('h-3 w-3', isSessionBusy || sessionQueued ? 'animate-pulse' : '')} />
              {liveBadgeLabel}
            </Badge>
          ) : null}
          <Badge variant="outline" className={cn('text-xs', displayStatusMeta.tone)}>
            {displayStatusMeta.label}
          </Badge>
          {isSubagentSession ? (
            <Badge variant="outline" className="border-violet-500/30 bg-violet-500/10 text-xs text-violet-100">
              子会话 · {sessionRoleLabel}
            </Badge>
          ) : null}
          <Badge variant="outline" className="border-zinc-800 bg-zinc-950 text-xs text-zinc-300">
            {visibleMessagesCount} 条消息
          </Badge>
          <Badge variant="outline" className="border-zinc-800 bg-zinc-950 text-xs text-zinc-300">
            {visibleToolsCount} 个工具
          </Badge>
          {sessionTokenSummary ? (
            <Badge variant="outline" className="border-cyan-500/30 bg-cyan-500/10 text-xs text-cyan-100">
              {sessionTokenSummary}
            </Badge>
          ) : null}
          <Badge variant="outline" className="border-zinc-800 bg-zinc-950 text-xs text-zinc-300">
            <RuntimeLabel runtime={selectedAgentType} size={12} labelClassName="text-inherit" />
          </Badge>
          {boundCustomAgentName ? (
            <Badge variant="outline" className="border-emerald-500/30 bg-emerald-500/10 text-xs text-emerald-100">
              {boundCustomAgentName}{boundCustomAgentMode ? ` · ${boundCustomAgentMode}` : ''}
            </Badge>
          ) : null}
          {mountedSkillNames.length > 0 ? (
            <Badge variant="outline" className="border-cyan-500/30 bg-cyan-500/10 text-xs text-cyan-100">
              Skills · {mountedSkillNames.length}
            </Badge>
          ) : null}
          {mountedMcpServerNames.length > 0 ? (
            <Badge variant="outline" className="border-amber-500/30 bg-amber-500/10 text-xs text-amber-100">
              MCP · {mountedMcpServerNames.length}
            </Badge>
          ) : null}
        </div>
      </div>
    </>
  )

  if (flush) {
    return (
      <div className="flex-shrink-0 border-b border-zinc-800 bg-[#09090b] px-4 py-3">
        {content}
      </div>
    )
  }

  return (
    <CardHeader className="flex-shrink-0 border-b border-zinc-800 bg-[#09090b] px-4 pb-3">
      {content}
    </CardHeader>
  )
}

export function TaskChatFeed({
  scrollRef,
  onScroll,
  bottomInset,
  isMobile = false,
  assistantAvatarUrl,
  currentUserId,
  knownCollaborators = [],
  workspaceCreatedBy,
  workspaceOwnerUserId,
  userAvatarUrl,
  userAvatarFallback,
  userLabel,
  hasMoreBefore,
  isWorkspaceHistoryMode,
  loadingMoreBefore,
  loadOlderSentinelRef,
  onLoadOlderTranscriptPage,
  selectedAgentType,
  boundCustomAgentName,
  boundCustomAgentMode,
  mountedSkillNames,
  mountedMcpServerNames,
  notices,
  systemLogs,
  displayTimeline,
  tasksById,
  initialTranscriptReady = true,
  isSessionBusy,
  displayStep,
  currentRunTiming,
  outlineItems,
  queueStatusMessage,
  scrollShortcutTarget,
  onJumpToBottom,
  onJumpToTop,
  onJumpToOutlineTurn,
  onCopyMessage,
  copiedMessageId,
  onDeleteMessage,
  deletingMessageId,
  onEditMessage,
  onOpenWorkspaceFileLink,
  onForkMessage,
  forkingMessageId,
  onReviseTurn,
  revisingTurnId,
  onOpenTaskFromResult,
}: TaskChatFeedProps) {
  const onCopyMessageRef = useRef(onCopyMessage)
  const onDeleteMessageRef = useRef(onDeleteMessage)
  const onEditMessageRef = useRef(onEditMessage)
  const onForkMessageRef = useRef(onForkMessage)
  const onReviseTurnRef = useRef(onReviseTurn)
  const onOpenWorkspaceFileLinkRef = useRef(onOpenWorkspaceFileLink)
  const runtimeOnlyStartedAtRef = useRef<string | null>(null)
  const collaboratorById = useMemo(() => {
    return new Map(knownCollaborators.map((collaborator) => [collaborator.id, collaborator] as const))
  }, [knownCollaborators])

  useEffect(() => {
    onCopyMessageRef.current = onCopyMessage
  }, [onCopyMessage])

  useEffect(() => {
    onDeleteMessageRef.current = onDeleteMessage
  }, [onDeleteMessage])

  useEffect(() => {
    onEditMessageRef.current = onEditMessage
  }, [onEditMessage])

  useEffect(() => {
    onForkMessageRef.current = onForkMessage
  }, [onForkMessage])

  useEffect(() => {
    onReviseTurnRef.current = onReviseTurn
  }, [onReviseTurn])

  useEffect(() => {
    onOpenWorkspaceFileLinkRef.current = onOpenWorkspaceFileLink
  }, [onOpenWorkspaceFileLink])

  const handleOpenMessageLink = useCallback((href: string) => {
    return onOpenWorkspaceFileLinkRef.current?.(href) ?? false
  }, [])

  const hasCopyMessage = Boolean(onCopyMessage)
  const hasDeleteMessage = Boolean(onDeleteMessage)
  const hasEditMessage = Boolean(onEditMessage)
  const hasForkMessage = Boolean(onForkMessage)
  const hasReviseTurn = Boolean(onReviseTurn)
  const transcriptActionRevisionKey = [
    copiedMessageId ?? '',
    deletingMessageId ?? '',
    forkingMessageId ?? '',
    revisingTurnId ?? '',
    hasCopyMessage ? 'copy' : '',
    hasDeleteMessage ? 'delete' : '',
    hasEditMessage ? 'edit' : '',
    hasForkMessage ? 'fork' : '',
    hasReviseTurn ? 'revise' : '',
  ].join('|')

  const shouldAppendRuntimeOnlyTurn = isSessionBusy && !hasBusyTimelineAnchor(displayTimeline)
  if (shouldAppendRuntimeOnlyTurn && !runtimeOnlyStartedAtRef.current) {
    runtimeOnlyStartedAtRef.current = new Date(Date.now()).toISOString()
  }
  if (!isSessionBusy) {
    runtimeOnlyStartedAtRef.current = null
  }

  const renderTimeline: TimelineTurnDisplay[] = useMemo(() => {
    if (!shouldAppendRuntimeOnlyTurn) {
      return displayTimeline
    }

    const runtimeOnlyTurnId = 'workspace-session-runtime-working'
    return [
      ...displayTimeline.map((turn) => ({ ...turn, isCurrent: false })),
      {
        id: runtimeOnlyTurnId,
        entries: [],
        isCurrent: true,
        status: {
          id: `${runtimeOnlyTurnId}:status`,
          ts: runtimeOnlyStartedAtRef.current ?? new Date(Date.now()).toISOString(),
          turnId: runtimeOnlyTurnId,
          seq: 1,
          kind: 'status' as const,
          status: 'executing' as const,
          step: displayStep || '正在处理',
        },
      },
    ]
  }, [displayStep, displayTimeline, shouldAppendRuntimeOnlyTurn])
  const legacyAgentAuthorTurnId = useMemo(() => {
    const normalizedOwnerUserId = workspaceOwnerUserId?.trim() || ''
    if (hasMoreBefore || workspaceCreatedBy?.type !== 'agent' || !normalizedOwnerUserId) {
      return undefined
    }

    return renderTimeline.find((turn) => {
      const userEvent = turn.user
      return Boolean(
        userEvent
        && !userEvent.author
        && userEvent.turnId.startsWith('task-chat-queue:')
        && userEvent.authorId?.trim() === normalizedOwnerUserId,
      )
    })?.id
  }, [hasMoreBefore, renderTimeline, workspaceCreatedBy, workspaceOwnerUserId])

  // Keep stable turn objects while users drag-select text, or the browser selection gets reset by unnecessary transcript re-renders.
  const transcriptTurns = useMemo(() => {
    return renderTimeline.map((turn) => {
      const hasRenderableAssistantEntry = turn.entries.some((entry) => {
        return isRenderableTaskChatAssistantEntry(entry)
      })
      const shouldAppendWorkingBubble = Boolean(
        isSessionBusy
        && turn.isCurrent
        && !hasRenderableAssistantEntry
        && (
          !turn.status
          || turn.status.status === 'thinking'
          || turn.status.status === 'executing'
          || turn.status.status === 'waiting'
        )
        && !turn.error,
      )
      const turnUser = turn.user
      const turnAuthor = turnUser?.author
        ?? (turn.id === legacyAgentAuthorTurnId ? workspaceCreatedBy : undefined)
      const knownCollaborator = turnUser?.authorId ? collaboratorById.get(turnUser.authorId) : undefined
      const {
        isCurrentUserTurn,
        authorType: resolvedUserAuthorType,
        authorName: resolvedUserAuthorName,
        avatarUrl: resolvedUserAvatarUrl,
      } = resolveWorkspaceUserDisplay({
        turnAuthor,
        turnAuthorId: turnUser?.authorId,
        currentUserId,
        currentUserLabel: userLabel,
        knownCollaborator,
      })
      const canEditUserMessage = isCurrentUserTurn && canMutateWorkspaceUserTurn({
        turn,
        isWorkspaceHistoryMode,
        isSessionBusy: isSessionBusy || shouldAppendWorkingBubble,
      })
      const canDeleteUserMessage = canEditUserMessage
      const canReviseUserTurn = isCurrentUserTurn && canReviseWorkspaceUserTurn({
        turn,
        isWorkspaceHistoryMode,
        isSessionBusy: isSessionBusy || shouldAppendWorkingBubble,
      })
      const canRetryAssistantTurn = canRetryWorkspaceAssistantTurn({
        turn,
        isWorkspaceHistoryMode,
        isSessionBusy: isSessionBusy || shouldAppendWorkingBubble,
      })
      const deletingCurrentUserMessage = deletingMessageId === turn.user?.messageId
      const taskCreatedResultTask = turn.entries.reduce<Task | undefined>((matchedTask, entry) => {
        if (matchedTask || entry.kind !== 'tool') {
          return matchedTask
        }

        const previewTaskId = entry.tool.metadata?.resultPreviewTaskId?.trim()
        return previewTaskId ? tasksById?.get(previewTaskId) : undefined
      }, undefined)
      const visibleEntries = turn.entries.filter((entry) => {
        if (entry.kind !== 'assistant') {
          return true
        }

        if (entry.message.authorType === 'system') {
          return false
        }

        return isRenderableTaskChatAssistantEntry(entry)
      })
      const lastAssistantEntryIndex = taskCreatedResultTask
        ? (() => {
            for (let index = visibleEntries.length - 1; index >= 0; index -= 1) {
              if (visibleEntries[index]?.kind === 'assistant') {
                return index
              }
            }
            return -1
          })()
        : -1
      const entries = visibleEntries.map((entry, entryIndex) => {
        if (entry.kind !== 'assistant') {
          return entry
        }

        return {
          ...entry,
          message: {
            ...entry.message,
            createdAt: entry.message.createdAt,
            avatarRuntime: resolveAssistantRuntimeFromAuthor(entry.message.authorName, selectedAgentType),
            afterContent: taskCreatedResultTask && entryIndex === lastAssistantEntryIndex ? (
              <TaskCreatedResultCard task={taskCreatedResultTask} onOpenTask={onOpenTaskFromResult} />
            ) : entry.message.afterContent,
            actions: entry.message.streaming
              ? undefined
              : (hasCopyMessage || hasForkMessage || hasReviseTurn ? (
                  <div className="flex items-center gap-0.5">
                    {hasCopyMessage ? (
                      <IconActionButton
                        label={copiedMessageId === entry.message.id ? '已复制' : '复制消息'}
                        onClick={() => void onCopyMessageRef.current?.(entry.message.id, entry.message.text)}
                        noBorder
                      >
                        {copiedMessageId === entry.message.id ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                      </IconActionButton>
                    ) : null}
                    {hasForkMessage ? (
                      <IconActionButton
                        label="从这里分叉"
                        onClick={() => onForkMessageRef.current?.(entry.message.id, 'assistant', entry.message.text)}
                        disabled={forkingMessageId === entry.message.id}
                        noBorder
                      >
                        {forkingMessageId === entry.message.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <GitBranch className="h-3.5 w-3.5" />}
                      </IconActionButton>
                    ) : null}
                    {hasReviseTurn && canRetryAssistantTurn && turnUser ? (
                      <IconActionButton
                        label="重试并分叉"
                        onClick={() => onReviseTurnRef.current?.({
                          kind: 'retry-assistant-turn',
                          turnId: turn.id,
                          sourceMessageId: turnUser.messageId,
                          userMessageId: turnUser.messageId,
                          assistantMessageId: entry.message.id,
                          text: turnUser.text,
                          attachments: turnUser.attachments ?? [],
                          mode: 'local',
                        })}
                        disabled={revisingTurnId === turn.id}
                        noBorder
                      >
                        {revisingTurnId === turn.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                      </IconActionButton>
                    ) : null}
                  </div>
            ) : undefined),
          },
        }
      })
      const renderedEntries = shouldAppendWorkingBubble
        ? [
            ...entries,
            {
              kind: 'assistant' as const,
              id: `working:${turn.id}`,
              message: {
                id: `working:${turn.id}`,
                role: 'assistant' as const,
                text: '',
                streaming: true,
                agentRunningStatus: turn.status?.status ?? 'thinking',
                currentStep: turn.status?.step || displayStep || '正在处理',
                avatarRuntime: selectedAgentType,
              },
            },
          ]
        : entries
      const turnTimingBounds = resolveTurnTimingBounds({
        turn,
        currentRunTiming,
      })
      const inferredRunningTurnStatus = !turn.status
        && !turn.error
        && turn.isCurrent
        && isSessionBusy
        && (shouldAppendWorkingBubble || hasRunningToolEntry(turn))
          ? {
              status: hasRunningToolEntry(turn) ? 'executing' as const : 'thinking' as const,
              step: displayStep.trim() || (hasRunningToolEntry(turn) ? '正在执行工具' : '正在处理'),
              startedAt: turnTimingBounds.startedAt,
              finishedAt: undefined,
            }
          : undefined

      const turnStatus = turn.status ? {
        status: turn.status.status,
        step: turn.status.step,
        startedAt: turnTimingBounds.startedAt,
        finishedAt: turnTimingBounds.finishedAt,
        workspaceExecutor: turn.status.workspaceExecutor,
      } : turn.error ? {
        status: 'error' as const,
        step: turn.isCurrent
          ? (displayStep.trim() || '工作区对话失败')
          : '工作区对话失败',
        startedAt: turnTimingBounds.startedAt,
        finishedAt: turnTimingBounds.finishedAt,
      } : inferredRunningTurnStatus

      return {
        ...turn,
        anchorId: turn.user ? buildTaskChatTurnAnchorId(turn.id) : undefined,
        user: turn.user ? {
          id: turn.user.messageId,
          role: 'user' as const,
          text: turn.user.text,
          createdAt: turn.user.ts,
          authorType: resolvedUserAuthorType,
          authorName: resolvedUserAuthorName,
          avatarUrl: resolvedUserAvatarUrl,
          attachments: turn.user.attachments,
          actions: hasCopyMessage || (canEditUserMessage && hasEditMessage) || (canDeleteUserMessage && hasDeleteMessage) || (canReviseUserTurn && hasReviseTurn) ? (
            <div className="flex items-center gap-0.5">
              {canEditUserMessage && hasEditMessage ? (
                <IconActionButton
                  label="编辑消息"
                  onClick={() => onEditMessageRef.current?.(turn.user!.messageId, turn.user!.text, turn.user!.attachments ?? [])}
                  disabled={deletingCurrentUserMessage}
                >
                  <Pencil className="h-3.5 w-3.5" />
                </IconActionButton>
              ) : null}
              {canDeleteUserMessage && hasDeleteMessage ? (
                <IconActionButton
                  label="删除消息"
                  onClick={() => onDeleteMessageRef.current?.(turn.user!.messageId)}
                  disabled={deletingCurrentUserMessage}
                >
                  {deletingCurrentUserMessage ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                </IconActionButton>
              ) : null}
              {canReviseUserTurn && hasReviseTurn ? (
                <IconActionButton
                  label="改写并分叉"
                  onClick={() => onReviseTurnRef.current?.({
                    kind: 'rewrite-user-turn',
                    turnId: turn.id,
                    sourceMessageId: turn.user!.messageId,
                    text: turn.user!.text,
                    attachments: turn.user!.attachments ?? [],
                    mode: 'local',
                  })}
                  disabled={revisingTurnId === turn.id}
                >
                  {revisingTurnId === turn.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <GitBranch className="h-3.5 w-3.5" />}
                </IconActionButton>
              ) : null}
              {hasCopyMessage ? (
                <IconActionButton
                  label={copiedMessageId === turn.user.messageId ? '已复制' : '复制消息'}
                  onClick={() => void onCopyMessageRef.current?.(turn.user!.messageId, turn.user!.text)}
                  noBorder
                >
                  {copiedMessageId === turn.user.messageId ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                </IconActionButton>
              ) : null}
            </div>
              ) : undefined,
        } : undefined,
        entries: renderedEntries,
        status: turnStatus,
        error: turn.error ? { message: turn.error.message } : undefined,
        renderRevisionKey: transcriptActionRevisionKey,
      }
    })
  }, [
    copiedMessageId,
    currentUserId,
    deletingMessageId,
    displayStep,
    forkingMessageId,
    hasCopyMessage,
    hasDeleteMessage,
    hasEditMessage,
    hasForkMessage,
    hasReviseTurn,
    isWorkspaceHistoryMode,
    isSessionBusy,
    currentRunTiming,
    renderTimeline,
    revisingTurnId,
    selectedAgentType,
    collaboratorById,
    legacyAgentAuthorTurnId,
    tasksById,
    transcriptActionRevisionKey,
    workspaceCreatedBy,
  ])

  const mergedFeedItems = useMemo(() => {
    const turnItems = transcriptTurns.flatMap((turn, index) => {
      const sourceTurn = renderTimeline[index]!
      const hasVisibleTurnContent = Boolean(
        turn.user
        || turn.entries.length > 0
        || turn.status
        || turn.error,
      )
      const turnItem = {
        id: `turn:${turn.id}`,
        kind: 'turn' as const,
        order: index,
        sortAtMs: isSessionBusy && turn.isCurrent
          ? TASK_CHAT_FEED_ACTIVE_TURN_SORT_TS
          : resolveVisibleTurnContentSortTimestampMs(sourceTurn)
            ?? resolveFeedTurnSortTimestampMs({
                turn: sourceTurn,
                currentRunTiming,
              }),
        turn,
      }
      const timelineSystemItems = sourceTurn.entries.flatMap((entry) => {
        if (entry.kind !== 'assistant' || entry.message.authorType !== 'system') {
          return []
        }

        if (!shouldShowSystemLog({ content: entry.message.text })) {
          return []
        }

        const switchSummary = parseExecutorSwitchSummary(entry.message.text)

        return [{
          id: `${switchSummary ? 'executor-switch' : 'system-log'}:${entry.id}`,
          kind: (switchSummary ? 'executor_switch' : 'system_log') as 'executor_switch' | 'system_log',
          order: index,
          sortAtMs: parseTimestampMs(entry.message.createdAt) ?? turnItem.sortAtMs,
          log: {
            id: entry.id,
            role: 'system' as const,
            content: entry.message.text,
            createdAt: entry.message.createdAt ?? new Date(0).toISOString(),
          },
        }]
      })

      return hasVisibleTurnContent ? [turnItem, ...timelineSystemItems] : timelineSystemItems
    })
    const systemLogItems = systemLogs.map((log, index) => {
      const switchSummary = parseExecutorSwitchSummary(log.content)
      return {
        id: `${switchSummary ? 'executor-switch' : 'system-log'}:${log.id}`,
        kind: (switchSummary ? 'executor_switch' : 'system_log') as 'executor_switch' | 'system_log',
        order: transcriptTurns.length + index,
        sortAtMs: parseTimestampMs(log.createdAt) ?? TASK_CHAT_FEED_FALLBACK_SORT_TS,
        log,
      }
    })

    return [...turnItems, ...systemLogItems].sort((left, right) => {
      if (left.sortAtMs !== right.sortAtMs) {
        return left.sortAtMs - right.sortAtMs
      }

      return left.order - right.order
    })
  }, [currentRunTiming, renderTimeline, systemLogs, transcriptTurns])

  const groupedFeedItems = useMemo(() => {
    type FeedItem = (typeof mergedFeedItems)[number]
    type FeedGroup =
      | { id: string; kind: 'system_cluster'; items: FeedItem[] }
      | { id: string; kind: 'turn'; item: FeedItem }
    const groups: FeedGroup[] = []
    let currentSystemCluster: Extract<FeedGroup, { kind: 'system_cluster' }> | null = null

    const isSystemFeedItem = (item: FeedItem) => item.kind === 'system_log' || item.kind === 'executor_switch'

    for (const item of mergedFeedItems) {
      if (isSystemFeedItem(item)) {
        if (!currentSystemCluster) {
          currentSystemCluster = {
            id: `system-cluster:${item.id}`,
            kind: 'system_cluster',
            items: [],
          }
          groups.push(currentSystemCluster)
        }
        currentSystemCluster.items.push(item)
        continue
      }

      currentSystemCluster = null
      groups.push({
        id: item.id,
        kind: 'turn',
        item,
      })
    }

    return groups
  }, [mergedFeedItems])

  type FeedRow =
    | { key: string; kind: 'load_older' }
    | { key: string; kind: 'queue_message'; message: string }
    | { key: string; kind: 'notices'; notices: NoticeItem[] }
    | { key: string; kind: 'feed_group'; group: (typeof groupedFeedItems)[number] }

  const feedRows: FeedRow[] = [
    ...(hasMoreBefore ? [{ key: 'load-older', kind: 'load_older' as const }] : []),
    ...(queueStatusMessage ? [{ key: 'queue-message', kind: 'queue_message' as const, message: queueStatusMessage }] : []),
    ...(notices.length > 0 ? [{ key: 'notices', kind: 'notices' as const, notices }] : []),
    ...groupedFeedItems.map((group) => ({ key: group.id, kind: 'feed_group' as const, group })),
  ]

  const getScrollElement = useCallback(() => {
    if (typeof scrollRef === 'function') {
      return null
    }

    return scrollRef?.current ?? null
  }, [scrollRef])

  const virtualizer = useVirtualizer({
    count: feedRows.length,
    getScrollElement,
    estimateSize: () => 200,
    overscan: 6,
    gap: 16,
    getItemKey: (index) => feedRows[index]?.key ?? index,
  })

  const virtualItems = virtualizer.getVirtualItems()
  const renderFallbackFeed = feedRows.length > 0 && virtualItems.length === 0

  const renderFeedRow = (row: FeedRow) => {
    if (row.kind === 'load_older') {
      return (
        <div ref={loadOlderSentinelRef} className="flex justify-center">
          <button
            type="button"
            onClick={onLoadOlderTranscriptPage}
            disabled={loadingMoreBefore}
            className="rounded-full border border-zinc-800 bg-zinc-900/80 px-3 py-1 text-[11px] text-zinc-400 transition-colors hover:border-zinc-700 hover:text-zinc-200 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loadingMoreBefore ? '加载中...' : '加载更早消息'}
          </button>
        </div>
      )
    }

    if (row.kind === 'queue_message') {
      return (
        <div className="rounded-xl border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-xs text-amber-100">
          <div className="flex items-center gap-2 font-medium text-amber-200">
            <Clock3 className="h-3.5 w-3.5" />
            <span>会话排队中</span>
          </div>
          <p className="mt-1 leading-5 text-amber-100/90">{row.message}</p>
        </div>
      )
    }

    if (row.kind === 'notices') {
      return (
        <div className="space-y-2">
          {row.notices.map((notice) => (
            <div
              key={notice.id}
              className={cn(
                'rounded-xl border px-3 py-2 text-xs',
                notice.level === 'error' && 'border-rose-500/20 bg-rose-500/10 text-rose-200',
                notice.level === 'warning' && 'border-amber-500/20 bg-amber-500/10 text-amber-200',
                notice.level === 'info' && 'border-sky-500/20 bg-sky-500/10 text-sky-200',
              )}
            >
              {notice.message}
            </div>
          ))}
        </div>
      )
    }

    const group = row.group
    if (group.kind === 'system_cluster') {
      return (
        <div className="space-y-0 py-0.5">
          {group.items.map((item, index) => {
            const previousItem = group.items[index - 1]
            const nextItem = group.items[index + 1]
            const connectBefore = previousItem?.kind === 'system_log' || previousItem?.kind === 'executor_switch'
            const connectAfter = nextItem?.kind === 'system_log' || nextItem?.kind === 'executor_switch'

            if (item.kind === 'executor_switch') {
              return (
                <ExecutorSwitchEventCard
                  key={item.id}
                  content={item.log.content}
                  createdAt={item.log.createdAt}
                  connectBefore={connectBefore}
                  connectAfter={connectAfter}
                />
              )
            }

            if (item.kind === 'system_log') {
              return (
                <SystemLogItem
                  key={item.id}
                  log={item.log}
                  connectBefore={connectBefore}
                  connectAfter={connectAfter}
                />
              )
            }

            return null
          })}
        </div>
      )
    }

    const item = group.item
    if (item.kind !== 'turn') {
      return null
    }

    return (
      <ChatTranscript
        assistantLabel={agentMeta[selectedAgentType].label}
        assistantAvatarUrl={assistantAvatarUrl}
        assistantAvatarRuntime={selectedAgentType}
        showFullExecutionModel
        enableProcessFolding
        userAvatarUrl={userAvatarUrl}
        userAvatarFallback={userAvatarFallback}
        userLabel={userLabel}
        onOpenMessageLink={handleOpenMessageLink}
        turns={[item.turn]}
        isBusy={isSessionBusy}
        fallbackStep={displayStep}
        mobileHeaderLayout={isMobile}
      />
    )
  }

  return (
    <ChatViewport
      scrollRef={scrollRef}
      onScroll={onScroll}
      paddingBottom={bottomInset}
      scrollClassName={cn(
        'h-full overflow-auto overscroll-y-contain bg-[linear-gradient(180deg,rgba(9,9,11,0.92),rgba(5,5,6,1))]',
        !initialTranscriptReady && 'opacity-0',
        isMobile ? 'px-3 py-4' : 'p-5',
      )}
      jumpButton={scrollShortcutTarget ? (
        <div
          className="pointer-events-none absolute right-5 z-30"
          style={{ bottom: bottomInset + 12 }}
        >
          <Button
            type="button"
            size="icon"
            className="pointer-events-auto size-9 rounded-full border border-zinc-800/80 bg-zinc-900/95 text-zinc-100 shadow-lg shadow-black/30 hover:bg-zinc-800"
            onClick={scrollShortcutTarget === 'top' ? onJumpToTop : onJumpToBottom}
            aria-label={scrollShortcutTarget === 'top' ? '回到顶部' : '回到底部'}
            title={scrollShortcutTarget === 'top' ? '回到顶部' : '回到底部'}
          >
            {scrollShortcutTarget === 'top' ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </Button>
        </div>
      ) : null}
    >
      <div className={cn(TASK_CHAT_CONTENT_MAX_WIDTH_CLASS)}>
        {renderFallbackFeed ? (
          <div className="space-y-4">
            {feedRows.map((row) => (
              <div key={row.key}>{renderFeedRow(row)}</div>
            ))}
          </div>
        ) : feedRows.length > 0 ? (
          <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
            {virtualItems.map((virtualItem) => {
              const row = feedRows[virtualItem.index]
              if (!row) {
                return null
              }

              return (
                <div
                  key={row.key}
                  data-index={virtualItem.index}
                  ref={virtualizer.measureElement}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    transform: `translateY(${virtualItem.start}px)`,
                  }}
                >
                  {renderFeedRow(row)}
                </div>
              )
            })}
          </div>
        ) : null}
      </div>
    </ChatViewport>
  )
}

function IconActionButton({
  label,
  onClick,
  disabled = false,
  noBorder = false,
  children,
}: {
  label: string
  onClick: () => void
  disabled?: boolean
  noBorder?: boolean
  children: ReactNode
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'inline-flex h-6 w-6 select-none items-center justify-center rounded-md bg-transparent text-zinc-500 transition hover:bg-zinc-900 hover:text-zinc-100 disabled:cursor-not-allowed disabled:opacity-60 [&_svg]:h-3 [&_svg]:w-3',
        noBorder ? '' : 'border border-zinc-800/80 hover:border-zinc-700'
      )}
    >
      {children}
    </button>
  )
}

function SelectedContextChips({
  items,
  onRemove,
  inline = false,
}: {
  items: WorkspaceSessionSelectedContextItem[]
  onRemove: (key: string) => void
  inline?: boolean
}) {
  if (items.length === 0) {
    return null
  }

  return (
    <div className={cn(
      'flex gap-2',
      inline ? 'max-w-full flex-nowrap items-center overflow-hidden whitespace-nowrap' : 'flex-wrap pb-3',
    )}>
      {items.map((item) => (
        <div
          key={item.key}
          className={cn(
            'inline-flex min-w-0 items-center gap-2 rounded-full border border-zinc-800 bg-zinc-950/90 px-3 py-1 text-xs text-zinc-200',
            inline && 'pointer-events-none max-w-[24rem]',
          )}
        >
          {item.kind === 'project' ? (
            <span
              className="h-2.5 w-2.5 shrink-0 rounded-[3px] border border-white/10"
              style={{ backgroundColor: item.accentColor || '#71717a' }}
            />
          ) : (
            <FileText className="h-3.5 w-3.5 shrink-0 text-sky-300" />
          )}
          <span className="max-w-[10rem] shrink-0 truncate font-medium">{item.label}</span>
          {item.meta ? (
            <span className="max-w-[12rem] truncate text-zinc-500">{item.meta}</span>
          ) : null}
          <button
            type="button"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => onRemove(item.key)}
            className="pointer-events-auto inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-zinc-500 transition hover:bg-zinc-800 hover:text-zinc-100"
            aria-label={`移除 ${item.label}`}
            title={`移除 ${item.label}`}
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      ))}
    </div>
  )
}

export function TaskChatComposer({
  executorId,
  fileRootPath,
  input,
  floating = true,
  onInputChange,
  onCaretChange,
  onNavigateHistory,
  onSend,
  onStop,
  onPasteImages,
  onUploadImages,
  isUploading,
  isSendingMessage,
  busy,
  sendDisabled,
  isSessionBusy,
  queueStatusMessage,
  queuedMessages,
  onEditQueuedMessage,
  onRemoveQueuedMessage,
  messageQueue,
  onRemoveQueuedDraft,
  onEditQueuedDraft,
  onMoveQueuedDraftToInput,
  mentionedAgents,
  mentionQueryActive,
  mentionAvailableOptions,
  mentionProject,
  mentionProjects,
  mentionQueryText = '',
  mentionSkills = [],
  mentionSkillsLoading = false,
  mentionUnavailableOptions,
  onInsertAgentMention,
  onInsertFileMention,
  onInsertProjectMention,
  onInsertSkillMention,
  selectedContextItems,
  onRemoveSelectedContextItem,
  images,
  imagesLocked,
  onRemoveImage,
  footerControls,
  actionPlacement = 'side',
  placeholder = '与AI进行对话',
  composerClassName,
  composerMaxHeight,
  composerMinHeight,
  sendActionClassName,
  containerClassName,
  inputShellClassName,
  shellClassName,
  uploadActionClassName,
  onHeightChange,
}: TaskChatComposerProps) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const imageAttachments = useMemo(
    () => images.filter((image) => (image.contentType || '').startsWith('image/')),
    [images],
  )
  const fileAttachments = useMemo(
    () => images.filter((image) => !(image.contentType || '').startsWith('image/')),
    [images],
  )
  const previewGalleryItems = useMemo(() => {
    return imageAttachments.map((image) => ({
      src: image.previewUrl || resolveApiUrl(image.url),
      alt: image.filename,
      caption: image.uploadState === 'uploading'
        ? `附件正在上传 ${Math.max(0, Math.min(100, image.uploadProgress ?? 0))}%`
        : image.uploadState === 'failed'
          ? (image.uploadError || '附件上传失败')
          : '点击可浏览预览',
    }))
  }, [imageAttachments])
  const sendActionLabel = isSessionBusy
    ? '停止'
    : isSendingMessage
      ? '发送中'
      : '发送'
  const hasComposerBeforeInput = queuedMessages.length > 0
    || messageQueue.length > 0
    || mentionedAgents.length > 0
    || mentionQueryActive
    || images.length > 0
  const selectedContextPrefix = selectedContextItems.length > 0
    ? (
        <SelectedContextChips
          items={selectedContextItems}
          onRemove={onRemoveSelectedContextItem}
          inline
        />
      )
    : null

  return (
    <ChatComposer
      ref={textareaRef}
      rows={1}
      placeholder={placeholder}
      value={input}
      onChange={(event) => onInputChange(event.target.value, event.target)}
      onClick={(event) => onCaretChange(event.currentTarget)}
      onSelect={(event) => onCaretChange(event.currentTarget)}
      onKeyDown={(event) => {
        if (isImeComposingKeyboardEvent(event)) {
          return
        }

        if (
          !event.shiftKey
          && !event.altKey
          && !event.ctrlKey
          && !event.metaKey
          && (event.key === 'ArrowUp' || event.key === 'ArrowDown')
        ) {
          const direction = event.key === 'ArrowUp' ? 'prev' : 'next'
          if (shouldNavigateComposerHistory(event.currentTarget, direction, input)) {
            event.preventDefault()
            onNavigateHistory(direction)
            window.requestAnimationFrame(() => {
              const node = textareaRef.current
              if (!node) {
                return
              }

              const caret = node.value.length
              node.setSelectionRange(caret, caret)
            })
            return
          }
        }

        if (event.key === 'Enter' && !event.shiftKey) {
          event.preventDefault()
          if (sendDisabled) {
            return
          }
          void onSend()
        }
      }}
      onPaste={(event) => {
        const files: File[] = []
        for (const item of Array.from(event.clipboardData.items)) {
          if (!item.type.startsWith('image/')) {
            continue
          }

          const file = item.getAsFile()
          if (file) {
            files.push(file)
          }
        }

        if (files.length === 0) {
          return
        }

        event.preventDefault()
        onPasteImages(files)
      }}
      floating={floating}
      footerInside
      containerClassName={containerClassName ?? (floating ? "px-3 pb-3 pt-6" : undefined)}
      className={cn("min-h-0 px-3.5 py-2 text-[13px] leading-[1.4]", composerClassName)}
      minHeight={composerMinHeight ?? 36}
      maxHeight={composerMaxHeight ?? 160}
      onHeightChange={onHeightChange}
      shellClassName={shellClassName ?? TASK_CHAT_COMPOSER_DEFAULT_SHELL_CLASS}
      inputShellClassName={cn(TASK_CHAT_COMPOSER_DEFAULT_INPUT_SHELL_CLASS, "rounded-xl", inputShellClassName)}
      inputInlinePrefix={selectedContextPrefix}
      beforeInput={hasComposerBeforeInput ? (
        <>
          {queuedMessages.length > 0 ? (
            <div className="mb-2">
              <QueuedMessages
                queuedMessages={queuedMessages}
                queueStatusMessage={queueStatusMessage}
                onEdit={onEditQueuedMessage}
                onRemove={(queueId) => void onRemoveQueuedMessage(queueId)}
              />
            </div>
          ) : null}

          {messageQueue.length > 0 ? (
            <div className="mb-3">
              <AgentChatQueue
                queue={messageQueue}
                onRemove={onRemoveQueuedDraft}
                onEdit={onEditQueuedDraft}
                onMoveToInput={onMoveQueuedDraftToInput}
              />
            </div>
          ) : null}

          {mentionedAgents.length > 0 ? (
            <div className="mb-3 flex flex-wrap gap-2">
              {mentionedAgents.map((item) => {
                const profile = parseCustomAgentProfile(item.agent)
                return (
                  <div key={`${item.agent.id}:${item.start}`} className="inline-flex items-center gap-2 rounded-full border border-sky-500/20 bg-sky-500/10 px-3 py-1 text-xs text-sky-200">
                    <Bot className="h-3.5 w-3.5" />
                    <span>@{item.agent.name}</span>
                    <span className="text-sky-300/70">{profile.role || item.agent.type}</span>
                  </div>
                )
              })}
            </div>
          ) : null}

          {mentionQueryActive ? (
            <WorkspaceSessionChatMentionMenu
              executorId={executorId}
              fileRootPath={fileRootPath}
              mentionAvailableAgents={mentionAvailableOptions}
              mentionQuery={mentionQueryText}
              mentionProjects={mentionProjects}
              mentionSkills={mentionSkills}
              mentionSkillsLoading={mentionSkillsLoading}
              mentionUnavailableOptions={mentionUnavailableOptions}
              onSelectAgent={onInsertAgentMention}
              onSelectFile={(item) => onInsertFileMention?.(item)}
              onSelectProject={(project) => onInsertProjectMention?.(project)}
              onSelectSkill={(token) => onInsertSkillMention?.(token)}
              project={mentionProject}
            />
          ) : null}

          {images.length > 0 ? (
            <div className="mb-3 flex flex-wrap gap-2">
              {images.map((image) => {
                const isImageAttachment = (image.contentType || '').startsWith('image/')
                const galleryIndex = imageAttachments.findIndex((item) => item.id === image.id)

                return (
                  <div key={image.id} className="group relative">
                    {isImageAttachment ? (
                      <PreviewableImage
                        src={image.previewUrl || resolveApiUrl(image.url)}
                        alt={image.filename}
                        caption={image.uploadState === 'uploading'
                          ? `附件正在上传 ${Math.max(0, Math.min(100, image.uploadProgress ?? 0))}%`
                          : image.uploadState === 'failed'
                            ? (image.uploadError || '附件上传失败')
                            : '点击可浏览预览'}
                        galleryItems={previewGalleryItems}
                        galleryIndex={galleryIndex}
                        triggerClassName={cn(
                          'overflow-hidden rounded-xl',
                          image.uploadState === 'failed' && 'cursor-not-allowed',
                        )}
                        imageClassName={cn(
                          'h-14 w-14 rounded-xl border object-cover shadow-lg transition',
                          image.uploadState === 'failed'
                            ? 'border-rose-500/50 opacity-70'
                            : 'border-zinc-800/60',
                        )}
                        previewImageClassName="bg-zinc-950"
                      />
                    ) : (
                      <div className={cn(
                        'flex min-h-14 w-44 items-center gap-3 rounded-xl border bg-zinc-950/90 px-3 py-2 shadow-lg',
                        image.uploadState === 'failed'
                          ? 'border-rose-500/40 text-rose-100'
                          : 'border-zinc-800/60 text-zinc-200',
                      )}>
                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-zinc-900 text-zinc-400">
                          <File className="h-4 w-4" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-xs font-medium">{image.filename}</p>
                          <p className="truncate text-[10px] text-zinc-500">
                            {image.uploadState === 'uploading'
                              ? `上传中 ${Math.max(0, Math.min(100, image.uploadProgress ?? 0))}%`
                              : image.uploadState === 'failed'
                                ? (image.uploadError || '附件上传失败')
                                : (image.contentType || '附件')}
                          </p>
                        </div>
                      </div>
                    )}
                    {image.uploadState === 'uploading' && isImageAttachment ? (
                      <div className="pointer-events-none absolute inset-x-1.5 bottom-1.5 rounded-md border border-zinc-800/80 bg-black/75 px-1.5 py-1 shadow-lg backdrop-blur-sm">
                        <div className="flex items-center justify-between gap-2 text-[9px] font-medium uppercase tracking-[0.16em] text-zinc-200">
                          <span>上传中</span>
                          <span>{Math.max(0, Math.min(100, image.uploadProgress ?? 0))}%</span>
                        </div>
                        <div className="mt-1 h-1 overflow-hidden rounded-full bg-zinc-800">
                          <div
                            className="h-full rounded-full bg-sky-400 transition-[width] duration-200"
                            style={{ width: `${Math.max(4, Math.min(100, image.uploadProgress ?? 0))}%` }}
                          />
                        </div>
                      </div>
                    ) : null}
                    {image.uploadState === 'failed' && isImageAttachment ? (
                      <div className="pointer-events-none absolute inset-x-1.5 bottom-1.5 rounded-md border border-rose-500/30 bg-rose-950/80 px-1.5 py-1 text-[9px] font-medium text-rose-100 shadow-lg backdrop-blur-sm">
                        上传失败
                      </div>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => onRemoveImage(image.id)}
                      disabled={imagesLocked}
                      className={cn(
                        'absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-zinc-800/90 text-zinc-100 shadow-lg transition-opacity',
                        imagesLocked ? 'cursor-not-allowed opacity-40' : 'opacity-0 group-hover:opacity-100',
                      )}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                )
              })}
            </div>
          ) : null}
        </>
      ) : null}
      overlay={(
        <>
          <label
            className={cn(
              'flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-lg border border-zinc-700/60 bg-zinc-900/80 text-zinc-400 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)] transition-all hover:border-zinc-600 hover:bg-zinc-800/90 hover:text-zinc-200',
              (busy || isUploading || isSendingMessage) && 'pointer-events-none opacity-50',
              uploadActionClassName,
            )}
            aria-label="上传附件"
            title="上传附件"
          >
            <input
              type="file"
              multiple
              className="hidden"
              onChange={(event) => {
                const files = event.target.files ? Array.from(event.target.files) : []
                if (files.length > 0) {
                  onUploadImages(files)
                }
                event.target.value = ''
              }}
              disabled={busy || isUploading || isSendingMessage}
            />
            {isUploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ImagePlus size={14} />}
          </label>
          <Button
            onClick={() => void (isSessionBusy ? onStop() : onSend())}
            disabled={sendDisabled}
            size="icon"
            className={cn(
              'h-9 w-9 shrink-0 rounded-lg transition-all',
              isSessionBusy
                ? 'border border-zinc-700/60 bg-zinc-900/80 text-zinc-400 hover:border-zinc-600 hover:bg-zinc-800/90 hover:text-zinc-200'
                : 'bg-zinc-100 text-zinc-900 shadow-[0_6px_20px_rgba(255,255,255,0.06)] hover:bg-white hover:shadow-[0_8px_24px_rgba(255,255,255,0.1)]',
              sendActionClassName,
            )}
            aria-label={sendActionLabel}
            title={sendActionLabel}
          >
            {isSessionBusy ? <Square size={14} /> : isSendingMessage ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send size={14} />}
          </Button>
        </>
      )}
      overlayPlacement={actionPlacement}
      sideInputClassName="flex items-center gap-1.5"
      footer={(
        <div className="mt-2 min-w-0 px-0 sm:mt-3 sm:px-1">
          <div className="flex min-w-0">
            <div className="min-w-0 flex-1">
              {footerControls}
            </div>
          </div>
        </div>
      )}
    />
  )
}

export function TaskChatSurface({
  scrollRef,
  onScroll,
  showJumpToBottom,
  scrollShortcutTarget,
  onJumpToBottom,
  onJumpToTop,
  onScrollToBottom,
  minBottomInset = TASK_CHAT_SURFACE_MIN_BOTTOM_INSET,
  feedProps,
  composerProps,
}: TaskChatSurfaceProps) {
  const [composerHeight, setComposerHeight] = useState(() => Math.max(0, minBottomInset - 16))
  const bottomInset = Math.max(minBottomInset, Math.ceil(composerHeight) + 16)
  const previousBottomInsetRef = useRef<number | null>(null)

  useEffect(() => {
    const previousBottomInset = previousBottomInsetRef.current
    previousBottomInsetRef.current = bottomInset

    if (previousBottomInset === null || previousBottomInset === bottomInset) {
      return
    }

    if (showJumpToBottom) {
      return
    }

    traceWorkspaceSessionChat('composer-inset-scroll', {
      composerHeight: Math.ceil(composerHeight),
      bottomInset,
      previousBottomInset,
      minBottomInset,
    })
    onScrollToBottom?.('instant')
  }, [bottomInset, onScrollToBottom, showJumpToBottom])

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <TaskChatFeed
        {...feedProps}
        scrollRef={scrollRef}
        onScroll={onScroll}
        bottomInset={bottomInset}
        scrollShortcutTarget={scrollShortcutTarget}
        onJumpToBottom={onJumpToBottom}
        onJumpToTop={onJumpToTop}
      />
      <TaskChatComposer
        {...composerProps}
        onHeightChange={setComposerHeight}
      />
    </div>
  )
}

export function TaskChatShell({ children }: { children: ReactNode }) {
  return (
    <Card className="flex h-full flex-col overflow-hidden border-zinc-800 bg-zinc-950/70 text-zinc-100 shadow-none">
      <CardContent className="relative flex min-h-0 flex-1 flex-col p-0">
        {children}
      </CardContent>
    </Card>
  )
}
