import { resolveAgentTypeForRuntimeId, type AgentType } from '@shared/agent-type'
import { readCustomAgentConfig } from '@shared/custom-agent'
import { memo, useEffect, useMemo, useRef, useState, type DragEvent } from 'react'
import type { ExecutorAgentSessionSummary, WorkspaceSession } from '@shared/types'
import { ChevronDown, ChevronRight, ChevronUp, Clock3, Loader2, Pin, Plus, RefreshCw, Trash2 } from 'lucide-react'
import { AiLoader } from '../ui/ai-loader'
import { Avatar, AvatarFallback, AvatarImage } from '../ui/avatar'
import { Badge } from '../ui/badge'
import { Button } from '../ui/button'
import { RuntimeIcon, RuntimeLabel } from '../runtime/runtime-icons'
import { resolveMediaUrl } from '../../lib/api'
import type { AgentRecord } from '../../lib/api/types'
import { getAgentAvatarAccent } from '../../lib/agent-avatar'
import { useTranslation } from '../../lib/i18n/react'
import { cn } from '../../lib/utils'
import {
  getWorkspaceSessionAttentionSignature,
  getWorkspaceSessionUnreadTone,
  type WorkspaceSessionAttentionTone,
  type WorkspaceSessionUnreadStoreState,
} from '../../lib/workspace-session-attention'
import { getWorkspaceSessionDisplayStatus, type WorkspaceSessionDisplayStatus } from './workspace-session-status'

export type WorkspaceSessionIndicatorMode =
  | 'running'
  | 'queued'
  | 'idle'
  | 'unread-attention'
  | 'unread-complete'
  | 'unread-error'

export const DEFAULT_COLLAPSED_VISIBLE_WORKSPACE_SESSION_COUNT = 10
export const DEFAULT_WORKSPACE_SESSION_EXPAND_STEP_COUNT = 10
export const DEFAULT_COLLAPSED_VISIBLE_LOCAL_SESSION_COUNT = 10
export const DEFAULT_LOCAL_SESSION_EXPAND_STEP_COUNT = 10

type WorkspaceSessionAgentProfile = {
  customAgentId?: string
  customAgentName?: string
  avatarUrl?: string
  agentType?: AgentType
}

type WorkspaceSessionIndicatorIdentity = {
  kind: 'runtime' | 'custom-avatar' | 'initials'
  runtime?: AgentType
  avatarUrl?: string
  initials: string
  accentSeed: string
}

export const getWorkspaceSessionIndicatorMode = (
  unreadTone: WorkspaceSessionAttentionTone | undefined,
  displayStatus: WorkspaceSessionDisplayStatus,
): WorkspaceSessionIndicatorMode => {
  if (displayStatus === 'running' || displayStatus === 'queued') {
    return displayStatus
  }

  if (unreadTone) {
    return `unread-${unreadTone}`
  }

  return 'idle'
}

const getWorkspaceSessionIndicatorInitials = (value?: string) => {
  const normalized = value?.trim()
  if (!normalized) {
    return 'AI'
  }

  const segments = normalized
    .split(/\s+/)
    .map((segment) => segment.trim())
    .filter(Boolean)

  if (segments.length >= 2) {
    return `${segments[0]?.[0] ?? ''}${segments[1]?.[0] ?? ''}`.toUpperCase()
  }

  const compact = normalized.replace(/\s+/g, '')
  return compact.slice(0, 2).toUpperCase() || 'AI'
}

export const resolveWorkspaceSessionIndicatorIdentity = (
  session: Pick<WorkspaceSession, 'agentType' | 'customAgentId' | 'customAgentName'>,
  agentProfilesById: ReadonlyMap<string, WorkspaceSessionAgentProfile>,
): WorkspaceSessionIndicatorIdentity => {
  const normalizedCustomAgentId = session.customAgentId?.trim() || ''
  const profile = normalizedCustomAgentId ? agentProfilesById.get(normalizedCustomAgentId) : undefined
  const resolvedRuntime = session.agentType ?? profile?.agentType ?? undefined
  const resolvedName = profile?.customAgentName?.trim()
    || session.customAgentName?.trim()
    || 'AI'
  const resolvedAvatarUrl = profile?.avatarUrl?.trim() || ''

  if (resolvedAvatarUrl) {
    return {
      kind: 'custom-avatar',
      avatarUrl: resolvedAvatarUrl,
      initials: getWorkspaceSessionIndicatorInitials(resolvedName),
      accentSeed: normalizedCustomAgentId || resolvedName,
      runtime: resolvedRuntime,
    }
  }

  if (resolvedRuntime) {
    return {
      kind: 'runtime',
      runtime: resolvedRuntime,
      initials: getWorkspaceSessionIndicatorInitials(resolvedName),
      accentSeed: resolvedRuntime,
    }
  }

  return {
    kind: 'initials',
    initials: getWorkspaceSessionIndicatorInitials(resolvedName),
    accentSeed: normalizedCustomAgentId || resolvedName,
  }
}

const normalizeWorkspaceSessionVisibleCount = (value?: number) => {
  if (!Number.isFinite(value)) {
    return 0
  }

  return Math.max(0, Math.floor(value as number))
}

export const resolveWorkspaceSessionVisibilityState = ({
  totalCount,
  currentVisibleCount,
  collapsedVisibleCount,
  expandStepCount,
}: {
  totalCount: number
  currentVisibleCount?: number
  collapsedVisibleCount?: number
  expandStepCount?: number
}) => {
  const normalizedCollapsedVisibleCount = (
    normalizeWorkspaceSessionVisibleCount(collapsedVisibleCount)
    || DEFAULT_COLLAPSED_VISIBLE_WORKSPACE_SESSION_COUNT
  )
  const collapsedCount = Math.min(totalCount, normalizedCollapsedVisibleCount)
  const normalizedExpandStepCount = (
    normalizeWorkspaceSessionVisibleCount(expandStepCount)
    || normalizedCollapsedVisibleCount
  )
  const canToggle = totalCount > collapsedCount

  if (!canToggle) {
    return {
      canToggle: false,
      canExpand: false,
      canCollapse: false,
      visibleCount: totalCount,
      hiddenCount: 0,
      nextVisibleCount: totalCount,
      collapsedVisibleCount: totalCount,
    }
  }

  const normalizedCurrentVisibleCount = normalizeWorkspaceSessionVisibleCount(currentVisibleCount)
  const visibleCount = normalizedCurrentVisibleCount > collapsedCount
    ? Math.min(totalCount, normalizedCurrentVisibleCount)
    : collapsedCount

  return {
    canToggle: true,
    canExpand: visibleCount < totalCount,
    canCollapse: visibleCount > collapsedCount,
    visibleCount,
    hiddenCount: Math.max(0, totalCount - visibleCount),
    nextVisibleCount: Math.min(totalCount, visibleCount + normalizedExpandStepCount),
    collapsedVisibleCount: collapsedCount,
  }
}

const SessionStatusIndicator = memo(function SessionStatusIndicator({
  unreadTone,
  displayStatus,
  selected,
  title,
  session,
  agentProfilesById,
}: {
  unreadTone?: WorkspaceSessionAttentionTone
  displayStatus: WorkspaceSessionDisplayStatus
  selected: boolean
  title: string
  session: Pick<WorkspaceSession, 'agentType' | 'customAgentId' | 'customAgentName'>
  agentProfilesById: ReadonlyMap<string, WorkspaceSessionAgentProfile>
}) {
  const indicatorMode = getWorkspaceSessionIndicatorMode(unreadTone, displayStatus)
  const identity = resolveWorkspaceSessionIndicatorIdentity(session, agentProfilesById)
  const runningAvatarInsetClassName = identity.kind === 'custom-avatar'
    ? 'inset-0 rounded-full'
    : identity.kind === 'runtime'
      ? 'inset-[3px] rounded-[4px]'
      : 'inset-[3px] rounded-full'
  const queuedAvatarInsetClassName = identity.kind === 'custom-avatar'
    ? 'inset-0 rounded-full'
    : identity.kind === 'runtime'
      ? 'inset-[2px] rounded-[4px]'
      : 'inset-[2px] rounded-full'

  if (indicatorMode === 'running') {
    return (
      <span
        className={cn(
          'relative inline-flex h-4.5 w-4.5 shrink-0 items-center justify-center rounded-full border shadow-[0_0_14px_rgba(56,189,248,0.22)]',
          selected
            ? 'border-sky-300/50 bg-sky-200/12'
            : 'border-sky-500/35 bg-sky-500/10',
        )}
        title={title}
        aria-hidden="true"
      >
        <AiLoader size={15} text="" ringClassName={selected ? 'brightness-[1.3]' : 'brightness-[1.15]'} />
        <span className={cn('absolute z-10 overflow-hidden bg-[#09090b]', runningAvatarInsetClassName)}>
          {identity.kind === 'runtime' && identity.runtime ? (
            <RuntimeIcon
              runtime={identity.runtime}
              size="100%"
              className="rounded-[4px]"
              fullBleed
            />
          ) : (
            <Avatar className="h-full w-full border-0 bg-transparent">
              {identity.kind === 'custom-avatar' && identity.avatarUrl ? (
                <AvatarImage src={resolveMediaUrl(identity.avatarUrl)} className="object-cover" />
              ) : null}
              <AvatarFallback
                className={cn(
                  'text-[7px] font-black text-zinc-950',
                  identity.kind === 'custom-avatar'
                    ? 'bg-zinc-950 text-zinc-100'
                    : `bg-gradient-to-br ${getAgentAvatarAccent(identity.accentSeed)}`,
                )}
              >
                {identity.initials}
              </AvatarFallback>
            </Avatar>
          )}
        </span>
      </span>
    )
  }

  if (indicatorMode === 'queued') {
    return (
      <span
        className={cn(
          'relative inline-flex h-4.5 w-4.5 shrink-0 items-center justify-center rounded-full border',
          selected
            ? 'border-amber-300/40 bg-amber-200/12 text-amber-100'
            : 'border-amber-500/30 bg-amber-500/10 text-amber-300',
        )}
        title={title}
        aria-hidden="true"
      >
        <span className={cn('absolute overflow-hidden bg-[#09090b]', queuedAvatarInsetClassName)}>
          {identity.kind === 'runtime' && identity.runtime ? (
            <RuntimeIcon
              runtime={identity.runtime}
              size="100%"
              className="rounded-[4px]"
              fullBleed
            />
          ) : (
            <Avatar className="h-full w-full border-0 bg-transparent">
              {identity.kind === 'custom-avatar' && identity.avatarUrl ? (
                <AvatarImage src={resolveMediaUrl(identity.avatarUrl)} className="object-cover" />
              ) : null}
              <AvatarFallback
                className={cn(
                  'text-[7px] font-black text-zinc-950',
                  identity.kind === 'custom-avatar'
                    ? 'bg-zinc-950 text-zinc-100'
                    : `bg-gradient-to-br ${getAgentAvatarAccent(identity.accentSeed)}`,
                )}
              >
                {identity.initials}
              </AvatarFallback>
            </Avatar>
          )}
        </span>
        <span className="absolute -right-0.5 -bottom-0.5 z-20 inline-flex h-2.5 w-2.5 items-center justify-center rounded-full border border-[#09090b] bg-amber-400 text-[7px] text-zinc-950 shadow-[0_0_10px_rgba(251,191,36,0.35)]">
          <Clock3 className="h-1.5 w-1.5" />
        </span>
      </span>
    )
  }

  if (indicatorMode.startsWith('unread-')) {
    return (
      <span
        className={cn(
          'inline-flex h-2.5 w-2.5 shrink-0 rounded-full ring-3 shadow-[0_0_12px_rgba(0,0,0,0.2)]',
indicatorMode === 'unread-attention'
            ? selected ? 'bg-cyan-200 ring-cyan-300/25' : 'bg-cyan-400 ring-cyan-500/20 shadow-[0_0_12px_rgba(34,211,238,0.28)]'
            : indicatorMode === 'unread-complete'
              ? selected ? 'bg-emerald-200 ring-emerald-300/25' : 'bg-emerald-400 ring-emerald-500/20 shadow-[0_0_12px_rgba(52,211,153,0.28)]'
              : selected ? 'bg-orange-300 ring-orange-300/25' : 'bg-orange-400 ring-orange-500/20 shadow-[0_0_12px_rgba(251,146,60,0.28)]',
        )}
        title={title}
        aria-hidden="true"
      />
    )
  }

  return (
    <span
      className={cn(
        'h-2 w-2 shrink-0 rounded-full transition-colors',
        selected ? 'bg-zinc-100' : 'bg-zinc-600 group-hover:bg-zinc-400',
      )}
      title={title}
      aria-hidden="true"
    />
  )
})

const buildWorkspaceSessionTree = (sessions: WorkspaceSession[]) => {
  const sessionMap = new Map(sessions.map((session) => [session.id, session]))
  const childrenByParent = new Map<string, WorkspaceSession[]>()

  for (const session of sessions) {
    const parentId = session.parentSessionId?.trim()
    if (!parentId || !sessionMap.has(parentId)) {
      continue
    }

    const children = childrenByParent.get(parentId) ?? []
    children.push(session)
    childrenByParent.set(parentId, children)
  }

  const roots = sessions.filter((session) => {
    const parentId = session.parentSessionId?.trim()
    return !parentId || !sessionMap.has(parentId)
  })

  const ordered: Array<{ session: WorkspaceSession; depth: number }> = []
  const visit = (session: WorkspaceSession, depth: number) => {
    ordered.push({ session, depth })
    for (const child of childrenByParent.get(session.id) ?? []) {
      visit(child, depth + 1)
    }
  }

  for (const root of roots) {
    visit(root, 0)
  }

  return ordered
}

type WorkspaceSessionDropPosition = 'before' | 'after'

const getWorkspaceSessionParentKey = (session: Pick<WorkspaceSession, 'parentSessionId'>) => {
  return session.parentSessionId?.trim() || ''
}

const orderWorkspaceSessionsByIds = (
  sessions: WorkspaceSession[],
  orderedSessionIds: string[],
) => {
  if (new Set(orderedSessionIds).size !== sessions.length) {
    return sessions
  }

  const sessionById = new Map(sessions.map((session) => [session.id, session]))
  const orderedSessions = orderedSessionIds
    .map((sessionId) => sessionById.get(sessionId))
    .filter((session): session is WorkspaceSession => Boolean(session))

  if (orderedSessions.length !== sessions.length) {
    return sessions
  }

  return orderedSessions
}

const resolveWorkspaceSessionDropPosition = (event: DragEvent<HTMLDivElement>): WorkspaceSessionDropPosition => {
  const bounds = event.currentTarget.getBoundingClientRect()
  return event.clientY - bounds.top >= bounds.height / 2 ? 'after' : 'before'
}

const applyWorkspaceSessionRowDragImage = (
  event: DragEvent<HTMLButtonElement>,
) => {
  const workspaceSessionRow = event.currentTarget.closest<HTMLElement>('[data-workspace-session-row="true"]')
  if (!workspaceSessionRow) {
    return
  }

  const bounds = workspaceSessionRow.getBoundingClientRect()
  event.dataTransfer.setDragImage(
    workspaceSessionRow,
    Math.max(12, event.clientX - bounds.left),
    event.clientY - bounds.top,
  )
}

const reorderWorkspaceSessionsWithinSiblings = (
  sessions: WorkspaceSession[],
  draggedWorkspaceSessionId: string,
  targetWorkspaceSessionId: string,
  position: WorkspaceSessionDropPosition,
) => {
  if (!draggedWorkspaceSessionId || draggedWorkspaceSessionId === targetWorkspaceSessionId) {
    return null
  }

  const sessionById = new Map(sessions.map((session) => [session.id, session]))
  const draggedSession = sessionById.get(draggedWorkspaceSessionId)
  const targetSession = sessionById.get(targetWorkspaceSessionId)
  if (!draggedSession || !targetSession) {
    return null
  }

  if (getWorkspaceSessionParentKey(draggedSession) !== getWorkspaceSessionParentKey(targetSession)) {
    return null
  }

  const orderedSessionIds = sessions.map((session) => session.id)
  const nextOrderedSessionIds = orderedSessionIds.filter((sessionId) => sessionId !== draggedWorkspaceSessionId)
  const targetIndex = nextOrderedSessionIds.indexOf(targetWorkspaceSessionId)
  if (targetIndex < 0) {
    return null
  }

  nextOrderedSessionIds.splice(position === 'after' ? targetIndex + 1 : targetIndex, 0, draggedWorkspaceSessionId)

  return nextOrderedSessionIds.every((sessionId, index) => sessionId === orderedSessionIds[index])
    ? null
    : nextOrderedSessionIds
}

type WorkspaceSessionListProps = {
  workspaceSessions: WorkspaceSession[]
  sessionTokenSummaryById?: Record<string, string>
  availableAgents?: AgentRecord[]
  selectedWorkspaceSessionId: string
  unreadState: WorkspaceSessionUnreadStoreState
  localSessions?: ExecutorAgentSessionSummary[]
  localSessionsOpen?: boolean
  localSessionsLoading?: boolean
  localSessionsRefreshing?: boolean
  localSessionExecutorName?: string
  selectedLocalSessionKey?: string
  title?: string
  eyebrow?: string
  className?: string
  bodyClassName?: string
  compact?: boolean
  collapsedVisibleCount?: number
  expandStepCount?: number
  canCreateWorkspaceSession?: boolean
  creatingWorkspaceSession?: boolean
  deletingWorkspaceSessionId?: string
  reorderingWorkspaceSessions?: boolean
  onCreateWorkspaceSession?: () => void
  onToggleLocalSessions?: () => void
  onRefreshLocalSessions?: () => void
  onSelectLocalSession?: (session: ExecutorAgentSessionSummary) => void
  onDeleteWorkspaceSession?: (workspaceSessionId: string) => void
  onPinWorkspaceSession?: (workspaceSessionId: string, pinned: boolean) => void
  onRequestRenameWorkspaceSession?: (session: WorkspaceSession) => void
  onReorderWorkspaceSessions?: (orderedWorkspaceSessionIds: string[]) => void | Promise<void>
  onSelectWorkspaceSession: (workspaceSessionId: string) => void
}

const LOCAL_SESSION_RUNTIME_BY_SOURCE = {
  claude: 'ClaudeCode',
  opencode: 'OpenCode',
  codex: 'Codex',
  pi: 'Pi',
} as const

const buildLocalSessionKey = (session: Pick<ExecutorAgentSessionSummary, 'source' | 'id'>) => `${session.source}:${session.id}`

const formatLocalSessionTimestamp = (value?: string) => {
  if (!value) {
    return '—'
  }

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return value
  }

  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

export function WorkspaceSessionList({
  workspaceSessions,
  sessionTokenSummaryById = {},
  availableAgents = [],
  selectedWorkspaceSessionId,
  unreadState,
  localSessions = [],
  localSessionsOpen = false,
  localSessionsLoading = false,
  localSessionsRefreshing = false,
  localSessionExecutorName,
  selectedLocalSessionKey = '',
  title,
  eyebrow,
  className,
  bodyClassName,
  compact = false,
  collapsedVisibleCount,
  expandStepCount,
  canCreateWorkspaceSession = false,
  creatingWorkspaceSession = false,
  deletingWorkspaceSessionId,
  reorderingWorkspaceSessions = false,
  onCreateWorkspaceSession,
  onToggleLocalSessions,
  onRefreshLocalSessions,
  onSelectLocalSession,
  onDeleteWorkspaceSession,
  onPinWorkspaceSession,
  onRequestRenameWorkspaceSession,
  onReorderWorkspaceSessions,
  onSelectWorkspaceSession,
}: WorkspaceSessionListProps) {
  const { t } = useTranslation()
  const agentProfilesById = useMemo(() => {
    const map = new Map<string, WorkspaceSessionAgentProfile>()
    for (const agent of availableAgents) {
      const normalizedAgentId = agent.id.trim()
      if (!normalizedAgentId) {
        continue
      }

      const profile = readCustomAgentConfig(agent.config)
      map.set(normalizedAgentId, {
        customAgentId: normalizedAgentId,
        customAgentName: agent.name.trim() || undefined,
        avatarUrl: profile.avatarUrl?.trim() || undefined,
        agentType: resolveAgentTypeForRuntimeId(profile.preferredRuntime) ?? undefined,
      })
    }
    return map
  }, [availableAgents])
  const canReorderWorkspaceSessions = Boolean(onReorderWorkspaceSessions) && workspaceSessions.length > 1 && !reorderingWorkspaceSessions
  const [draggedWorkspaceSessionId, setDraggedWorkspaceSessionId] = useState('')
  const [dropTarget, setDropTarget] = useState<{
    sessionId: string
    position: WorkspaceSessionDropPosition
  } | null>(null)
  const [pendingOrderedWorkspaceSessionIds, setPendingOrderedWorkspaceSessionIds] = useState<string[] | null>(null)
  const [workspaceSessionVisibleCount, setWorkspaceSessionVisibleCount] = useState<number | null>(null)
  const [localSessionVisibleCount, setLocalSessionVisibleCount] = useState<number | null>(null)
  const workspaceSessionOrderKey = useMemo(
    () => workspaceSessions.map((session) => `${session.id}:${session.parentSessionId || ''}`).join('|'),
    [workspaceSessions],
  )
  const previousWorkspaceSessionOrderKeyRef = useRef(workspaceSessionOrderKey)
  const effectiveWorkspaceSessions = useMemo(
    () => pendingOrderedWorkspaceSessionIds
      ? orderWorkspaceSessionsByIds(workspaceSessions, pendingOrderedWorkspaceSessionIds)
      : workspaceSessions,
    [pendingOrderedWorkspaceSessionIds, workspaceSessions],
  )
  const orderedWorkspaceSessions = useMemo(
    () => buildWorkspaceSessionTree(effectiveWorkspaceSessions),
    [effectiveWorkspaceSessions],
  )
  const workspaceSessionVisibilityState = useMemo(
    () => resolveWorkspaceSessionVisibilityState({
      totalCount: orderedWorkspaceSessions.length,
      currentVisibleCount: workspaceSessionVisibleCount ?? undefined,
      collapsedVisibleCount,
      expandStepCount,
    }),
    [collapsedVisibleCount, expandStepCount, orderedWorkspaceSessions.length, workspaceSessionVisibleCount],
  )
  const visibleWorkspaceSessions = useMemo(
    () => orderedWorkspaceSessions.slice(0, workspaceSessionVisibilityState.visibleCount),
    [orderedWorkspaceSessions, workspaceSessionVisibilityState.visibleCount],
  )
  const localSessionVisibilityState = useMemo(
    () => resolveWorkspaceSessionVisibilityState({
      totalCount: localSessions.length,
      currentVisibleCount: localSessionVisibleCount ?? undefined,
      collapsedVisibleCount: DEFAULT_COLLAPSED_VISIBLE_LOCAL_SESSION_COUNT,
      expandStepCount: DEFAULT_LOCAL_SESSION_EXPAND_STEP_COUNT,
    }),
    [localSessions.length, localSessionVisibleCount],
  )
  const visibleLocalSessions = useMemo(
    () => localSessions.slice(0, localSessionVisibilityState.visibleCount),
    [localSessions, localSessionVisibilityState.visibleCount],
  )
  const resolvedBodyClassName = bodyClassName ?? (compact ? 'px-2 py-2' : 'px-1.5 py-1.5')

  useEffect(() => {
    const previousOrderKey = previousWorkspaceSessionOrderKeyRef.current
    previousWorkspaceSessionOrderKeyRef.current = workspaceSessionOrderKey

    if (!pendingOrderedWorkspaceSessionIds) {
      return
    }

    const pendingOrderKey = pendingOrderedWorkspaceSessionIds.join('|')
    if (workspaceSessionOrderKey === pendingOrderKey || previousOrderKey !== workspaceSessionOrderKey) {
      setPendingOrderedWorkspaceSessionIds(null)
    }
  }, [pendingOrderedWorkspaceSessionIds, workspaceSessionOrderKey])

  useEffect(() => {
    if (canReorderWorkspaceSessions) {
      return
    }

    setDraggedWorkspaceSessionId('')
    setDropTarget(null)
  }, [canReorderWorkspaceSessions])

  useEffect(() => {
    if (workspaceSessionVisibilityState.canToggle) {
      return
    }

    setWorkspaceSessionVisibleCount(null)
  }, [workspaceSessionVisibilityState.canToggle])

  useEffect(() => {
    if (localSessionVisibilityState.canToggle) {
      return
    }

    setLocalSessionVisibleCount(null)
  }, [localSessionVisibilityState.canToggle])

  return (
    <aside className={cn('flex h-full min-h-0 flex-col overflow-hidden bg-[#080809]', className)}>
      <div className={cn('border-b border-zinc-900 bg-[#080809] px-3', eyebrow ? 'py-2.5' : 'flex h-9 items-center')}>
        <div className="flex w-full items-center justify-between gap-3">
          <div className="min-w-0 flex-1">
            {eyebrow ? (
              <>
                <p className="font-mono text-[9px] uppercase tracking-[0.22em] text-zinc-600">{eyebrow}</p>
                <h3 className="mt-1 truncate text-sm font-semibold text-zinc-100">{title || t('workspace.shell.sessionList')}</h3>
              </>
            ) : (
              <p className="text-[12px] font-medium text-zinc-400">{title || t('workspace.shell.sessionList')}</p>
            )}
          </div>
          {canCreateWorkspaceSession && onCreateWorkspaceSession ? (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={onCreateWorkspaceSession}
              disabled={creatingWorkspaceSession}
              className="h-7 w-7 shrink-0 rounded-md border border-zinc-800 bg-zinc-950 text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100"
              aria-label={t('workspace.shell.createSession')}
              title={t('workspace.shell.createSession')}
            >
              {creatingWorkspaceSession ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
            </Button>
          ) : null}
        </div>
      </div>

      <div className={cn('min-h-0 flex-1 overflow-y-auto', resolvedBodyClassName)}>
        <div className={cn(compact ? 'space-y-1.5' : 'space-y-0.5')}>
          {visibleWorkspaceSessions.map(({ session: item, depth }) => {
            const selected = item.id === selectedWorkspaceSessionId
            const deleting = deletingWorkspaceSessionId === item.id
            const isForkSession = item.sessionOrigin === 'fork'
            const isSubagentSession = item.sessionKind === 'subagent'
            const displayStatus = getWorkspaceSessionDisplayStatus(item)
            const attentionSignature = getWorkspaceSessionAttentionSignature(item)
            const manualUnreadActive = attentionSignature
              ? unreadState.manuallyUnreadSessionAttentionById[item.id] === attentionSignature
              : false
            const unreadTone = getWorkspaceSessionUnreadTone(item, {
              sessionAttentionById: unreadState.sessionAttentionById,
              acknowledgedSessionAttentionById: unreadState.acknowledgedSessionAttentionById,
              manuallyUnreadSessionAttentionById: unreadState.manuallyUnreadSessionAttentionById,
            }) ?? undefined
            const sessionBusy = displayStatus === 'running'
            const sessionQueued = displayStatus === 'queued'
            const showFailedBadge = unreadTone === 'error'
            const canDeleteSession = workspaceSessions.length > 1 && Boolean(onDeleteWorkspaceSession)
            const isPinned = Boolean(item.pinnedAt)
            const canPinSession = Boolean(onPinWorkspaceSession)
            const isDraggingWorkspaceSession = draggedWorkspaceSessionId === item.id
            const isDropTarget = dropTarget?.sessionId === item.id
            const sessionTokenSummary = sessionTokenSummaryById[item.id]
            const indentStyle = depth > 0
              ? compact
                ? { marginLeft: `${depth * 10}px` }
                : { paddingLeft: `${8 + depth * 12}px` }
              : undefined
            const failureReason = item.terminalReason?.trim() || item.currentStep?.trim()
            const indicatorTitle = displayStatus === 'running'
              ? t('workspace.shell.sessionStatus.working')
              : displayStatus === 'queued'
                ? t('workspace.shell.sessionStatus.queued', { defaultValue: '排队中' })
                : unreadTone
                  ? t('workspace.shell.sessionBadge.unread', { defaultValue: '未读' })
                : displayStatus === 'attention'
                  ? t('workspace.shell.sessionStatus.attention')
                  : displayStatus === 'complete'
                    ? t('workspace.shell.sessionStatus.completed')
                    : displayStatus === 'error'
                      ? (failureReason
                        ? t('workspace.shell.sessionStatus.failedWithReason', { defaultValue: '执行失败：{{message}}', message: failureReason })
                        : t('workspace.shell.sessionStatus.failed'))
                      : item.title
            return (
              <div
                key={item.id}
                data-workspace-session-row="true"
                onDragOver={(event) => {
                  if (!canReorderWorkspaceSessions || !draggedWorkspaceSessionId) {
                    return
                  }

                  const nextPosition = resolveWorkspaceSessionDropPosition(event)
                  const nextOrderedWorkspaceSessionIds = reorderWorkspaceSessionsWithinSiblings(
                    effectiveWorkspaceSessions,
                    draggedWorkspaceSessionId,
                    item.id,
                    nextPosition,
                  )
                  if (!nextOrderedWorkspaceSessionIds) {
                    if (dropTarget?.sessionId === item.id) {
                      setDropTarget(null)
                    }
                    return
                  }

                  event.preventDefault()
                  event.dataTransfer.dropEffect = 'move'
                  setDropTarget((current) => {
                    if (current?.sessionId === item.id && current.position === nextPosition) {
                      return current
                    }

                    return {
                      sessionId: item.id,
                      position: nextPosition,
                    }
                  })
                }}
                onDrop={(event) => {
                  const droppedWorkspaceSessionId = event.dataTransfer.getData('application/x-wemux-workspace-session')
                    || event.dataTransfer.getData('text/plain')
                    || draggedWorkspaceSessionId
                  const nextPosition = resolveWorkspaceSessionDropPosition(event)
                  const nextOrderedWorkspaceSessionIds = reorderWorkspaceSessionsWithinSiblings(
                    effectiveWorkspaceSessions,
                    droppedWorkspaceSessionId,
                    item.id,
                    nextPosition,
                  )

                  event.preventDefault()
                  setDraggedWorkspaceSessionId('')
                  setDropTarget(null)

                  if (!canReorderWorkspaceSessions || !onReorderWorkspaceSessions || !nextOrderedWorkspaceSessionIds) {
                    return
                  }

                  setPendingOrderedWorkspaceSessionIds(nextOrderedWorkspaceSessionIds)
                  try {
                    const result = onReorderWorkspaceSessions(nextOrderedWorkspaceSessionIds)
                    void Promise.resolve(result).catch(() => {
                      setPendingOrderedWorkspaceSessionIds(null)
                    })
                  } catch {
                    setPendingOrderedWorkspaceSessionIds(null)
                  }
                }}
                className={cn(
                  'group relative flex w-full min-w-0 items-center gap-2 overflow-hidden rounded-md border px-2.5 transition-colors',
                  compact ? 'min-h-[42px] py-2' : 'h-9',
                  isDraggingWorkspaceSession && 'opacity-60',
                  selected
                    ? sessionBusy
                      ? 'border-zinc-800 bg-zinc-900 text-zinc-50'
                      : 'border-zinc-700 bg-zinc-900 text-zinc-50 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.04)]'
                    : 'border-transparent text-zinc-500 hover:border-zinc-800 hover:bg-zinc-950 hover:text-zinc-200',
manualUnreadActive && 'border-zinc-700 bg-zinc-900/85 text-zinc-100 shadow-[inset_0_0_0_1px_rgba(34,211,238,0.08)] hover:border-zinc-600 hover:bg-zinc-900 hover:text-zinc-50',
                  sessionBusy && (selected
                    ? 'shadow-[0_0_0_1px_rgba(125,211,252,0.14),0_0_24px_rgba(14,165,233,0.08)]'
                    : 'border-transparent bg-sky-500/[0.03]'),
                  sessionQueued && (selected
                    ? 'shadow-[0_0_0_1px_rgba(253,230,138,0.12),0_0_22px_rgba(245,158,11,0.08)]'
                    : 'border-amber-500/15 bg-amber-500/[0.03]'),
                  unreadTone === 'attention' && !selected && 'border-blue-500/25 bg-blue-950/[0.1]',
                  unreadTone === 'complete' && !selected && 'border-emerald-500/15 bg-emerald-500/[0.03]',
                  unreadTone === 'error' && !selected && 'border-orange-500/15 bg-orange-500/[0.03]',
                  unreadTone === 'attention' && selected && (
                    'border-blue-400/35 shadow-[inset_0_0_0_1px_rgba(59,130,246,0.1),0_0_18px_rgba(37,99,235,0.08)]'
                  ),
                  unreadTone === 'complete' && selected && (
                    'shadow-[0_0_0_1px_rgba(110,231,183,0.14),0_0_22px_rgba(16,185,129,0.08)]'
                  ),
                  unreadTone === 'error' && selected && (
                    'shadow-[0_0_0_1px_rgba(253,186,116,0.16),0_0_22px_rgba(249,115,22,0.08)]'
                  ),
                )}
                style={indentStyle}
              >
                {isDropTarget ? (
                  <span
                    className={cn(
                      'pointer-events-none absolute left-2 right-2 z-10 h-px rounded-full bg-sky-300/90 shadow-[0_0_12px_rgba(125,211,252,0.35)]',
                      dropTarget?.position === 'before' ? 'top-0' : 'bottom-0',
                    )}
                    aria-hidden="true"
                  />
                ) : null}
                {manualUnreadActive ? (
                  <span
                    className="absolute inset-y-2 left-0 w-0.5 rounded-r-full bg-blue-500/85"
                    aria-hidden="true"
                  />
                ) : null}
                <button
                  type="button"
                  draggable={canReorderWorkspaceSessions}
                  onClick={() => onSelectWorkspaceSession(item.id)}
                  onDoubleClick={onRequestRenameWorkspaceSession ? () => onRequestRenameWorkspaceSession(item) : undefined}
                  onDragStart={(event) => {
                    if (!canReorderWorkspaceSessions) {
                      event.preventDefault()
                      return
                    }

                    setDraggedWorkspaceSessionId(item.id)
                    setDropTarget(null)
                    event.dataTransfer.effectAllowed = 'move'
                    event.dataTransfer.setData('text/plain', item.id)
                    event.dataTransfer.setData('application/x-wemux-workspace-session', item.id)
                    applyWorkspaceSessionRowDragImage(event)
                  }}
                  onDragEnd={() => {
                    setDraggedWorkspaceSessionId('')
                    setDropTarget(null)
                  }}
                  className={cn(
                    'flex min-w-0 flex-1 items-center gap-2 text-left outline-none focus:outline-none focus-visible:outline-none',
                    canReorderWorkspaceSessions && 'cursor-grab active:cursor-grabbing',
                  )}
                  title={item.title}
                >
                  <SessionStatusIndicator
                    unreadTone={unreadTone}
                    displayStatus={displayStatus}
                    selected={selected}
                    title={indicatorTitle}
                    session={item}
                    agentProfilesById={agentProfilesById}
                  />
                  <span className="min-w-0 flex-1">
                    <span className={cn(
                      'block truncate',
                      manualUnreadActive ? 'font-medium text-zinc-50' : 'font-medium',
                      compact ? 'text-[12px]' : 'text-[13px]',
                    )}
                    >
                      {item.title}
                    </span>
                  </span>
                  {sessionTokenSummary ? (
                    <span className={cn(
                      'shrink-0 rounded-full border border-cyan-500/20 bg-cyan-500/10 px-1.5 py-0.5 text-cyan-100',
                      compact ? 'text-[9px]' : 'text-[10px]',
                    )}>
                      {sessionTokenSummary}
                    </span>
                  ) : null}
                  {showFailedBadge ? (
                    <span
                      className={cn(
                        'shrink-0 rounded-full border px-1.5 py-0.5 font-medium',
                        compact ? 'text-[9px]' : 'text-[10px]',
                        selected
                          ? 'border-orange-300/30 bg-orange-300/12 text-orange-100'
                          : 'border-orange-500/20 bg-orange-500/10 text-orange-300',
                      )}
                      title={indicatorTitle}
                    >
                      {t('workspace.shell.sessionBadge.failed', { defaultValue: '异常' })}
                    </span>
                  ) : null}
                  {isForkSession && item.forkMode !== 'local' ? (
                    <span className={cn(
                      'shrink-0 rounded-full border border-zinc-800 bg-zinc-950 px-1.5 py-0.5 text-zinc-400',
                      compact ? 'text-[9px]' : 'text-[10px]',
                    )}
                    >
                      {t('workspace.shell.sessionBadges.newWorktree')}
                    </span>
                  ) : null}
                  {isSubagentSession ? (
                    <span className={cn(
                      'shrink-0 rounded-full border border-zinc-800 bg-zinc-950 px-1.5 py-0.5 text-zinc-400',
                      compact ? 'text-[9px]' : 'text-[10px]',
                    )}
                    >
                      {t('workspace.shell.sessionBadges.subsession')}
                    </span>
                  ) : null}
                </button>
                {canPinSession ? (
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation()
                      onPinWorkspaceSession?.(item.id, !isPinned)
                    }}
                    className={cn(
                      'inline-flex shrink-0 items-center rounded-md border border-transparent p-1 text-[11px] transition-colors',
                      selected || isPinned ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 focus-visible:opacity-100',
                      isPinned
                        ? 'text-amber-400 hover:border-amber-500/20 hover:bg-amber-500/10 hover:text-amber-300'
                        : 'text-zinc-500 hover:border-zinc-700/20 hover:bg-zinc-700/10 hover:text-zinc-300',
                    )}
                    title={isPinned ? t('workspace.shell.unpinSession', { defaultValue: '取消置顶' }) : t('workspace.shell.pinSession', { defaultValue: '置顶会话' })}
                    aria-label={isPinned ? t('workspace.shell.unpinSession', { defaultValue: '取消置顶' }) : t('workspace.shell.pinSession', { defaultValue: '置顶会话' })}
                  >
                    <Pin className={cn('h-3 w-3', isPinned && 'fill-amber-400')} />
                  </button>
                ) : null}
                {canDeleteSession ? (
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation()
                      onDeleteWorkspaceSession?.(item.id)
                    }}
                    disabled={deleting}
                    className={cn(
                      'inline-flex shrink-0 items-center rounded-md border border-transparent p-1 text-[11px] transition-colors',
                      selected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 focus-visible:opacity-100',
                      deleting
                        ? 'cursor-not-allowed text-zinc-500'
                        : 'text-rose-400 hover:border-rose-500/20 hover:bg-rose-500/10 hover:text-rose-300',
                    )}
                    title={t('workspace.shell.deleteSessionWithName', { name: item.title })}
                    aria-label={t('workspace.shell.deleteSessionWithName', { name: item.title })}
                  >
                    {deleting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
                  </button>
                ) : null}
              </div>
            )
          })}

          {workspaceSessionVisibilityState.canToggle ? (
            <div className={cn(compact ? 'px-1 pt-1' : 'px-1.5 pt-1.5')}>
              <div className="flex items-center justify-between gap-2 rounded-md border border-zinc-900 bg-zinc-950/60 px-2 py-1.5">
                <span className={cn('text-zinc-500', compact ? 'text-[10px]' : 'text-[11px]')}>
                  {t('workspace.shell.sessionListVisibleSummary', {
                    defaultValue: '已显示 {{visible}} / {{total}}',
                    visible: workspaceSessionVisibilityState.visibleCount,
                    total: orderedWorkspaceSessions.length,
                  })}
                </span>
                <div className="flex items-center gap-1">
                  {workspaceSessionVisibilityState.canExpand ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setWorkspaceSessionVisibleCount(workspaceSessionVisibilityState.nextVisibleCount)}
                      className={cn(
                        'h-6 w-6 rounded-md p-0 text-zinc-300 hover:bg-zinc-900 hover:text-zinc-100',
                      )}
                    >
                      <ChevronDown className="h-3 w-3" />
                    </Button>
                  ) : null}
                  {workspaceSessionVisibilityState.canCollapse ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setWorkspaceSessionVisibleCount(null)}
                      className={cn(
                        'h-6 w-6 rounded-md p-0 text-zinc-300 hover:bg-zinc-900 hover:text-zinc-100',
                      )}
                    >
                      <ChevronUp className="h-3 w-3" />
                    </Button>
                  ) : null}
                </div>
              </div>
            </div>
          ) : null}

          {onToggleLocalSessions ? (
            <section className={cn('pt-2', compact ? 'mt-1.5 border-t border-zinc-900' : 'mt-2 border-t border-zinc-900')}>
              <div className="flex items-center gap-2 px-1">
                <button
                  type="button"
                  onClick={onToggleLocalSessions}
                  className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-1 py-1 text-left text-zinc-400 transition hover:bg-zinc-950 hover:text-zinc-100"
                >
                  {localSessionsOpen ? <ChevronDown className="h-3.5 w-3.5 shrink-0" /> : <ChevronRight className="h-3.5 w-3.5 shrink-0" />}
                  <span className="min-w-0 flex-1 truncate text-[12px] font-medium">
                    {t('workspace.localSessions.groupTitle', { defaultValue: '节点本地会话' })}
                  </span>
                  {localSessions.length > 0 ? (
                    <span className="rounded-full border border-zinc-800 bg-zinc-950 px-1.5 py-0.5 text-[10px] text-zinc-500">
                      {localSessions.length}
                    </span>
                  ) : null}
                </button>
                {localSessionsOpen && onRefreshLocalSessions ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={onRefreshLocalSessions}
                    disabled={localSessionsLoading || localSessionsRefreshing}
                    className="h-6 w-6 shrink-0 rounded-md border border-zinc-800 bg-zinc-950 text-zinc-500 hover:bg-zinc-900 hover:text-zinc-100"
                    aria-label={t('workspace.localSessions.refresh', { defaultValue: '刷新节点本地会话' })}
                    title={t('workspace.localSessions.refresh', { defaultValue: '刷新节点本地会话' })}
                  >
                    {localSessionsLoading || localSessionsRefreshing
                      ? <Loader2 className="h-3 w-3 animate-spin" />
                      : <RefreshCw className="h-3 w-3" />}
                  </Button>
                ) : null}
              </div>

              {localSessionsOpen ? (
                <div className="mt-2 space-y-1.5">
                  {localSessionsLoading ? (
                    <div className="flex min-h-20 items-center justify-center rounded-lg border border-zinc-900 bg-zinc-950/60 px-3 py-4 text-xs text-zinc-500">
                      <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                      {t('workspace.localSessions.loading', { defaultValue: '正在扫描当前项目的节点本地会话…' })}
                    </div>
                  ) : localSessions.length === 0 ? (
                    <div className="rounded-lg border border-dashed border-zinc-900 bg-zinc-950/40 px-3 py-4 text-xs text-zinc-500">
                      {t('workspace.localSessions.empty', { defaultValue: '当前项目还没有探测到可浏览的节点本地会话。' })}
                    </div>
                  ) : (
                    visibleLocalSessions.map((session) => {
                      const localSelected = buildLocalSessionKey(session) === selectedLocalSessionKey

                      return (
                        <button
                          key={buildLocalSessionKey(session)}
                          type="button"
                          onClick={() => onSelectLocalSession?.(session)}
                          className={cn(
                            'w-full rounded-lg border px-3 py-2.5 text-left transition',
                            localSelected
                              ? 'border-zinc-700 bg-zinc-900 text-zinc-50 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.04)]'
                              : 'border-zinc-900 bg-zinc-950/50 text-zinc-400 hover:border-zinc-800 hover:bg-zinc-950 hover:text-zinc-100',
                          )}
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0 flex-1">
                              <div className="truncate text-[12px] font-medium">{session.title || t('workspace.localSessions.untitled', { defaultValue: '未命名节点本地会话' })}</div>
                              <div className="mt-1 flex flex-wrap items-center gap-1.5">
                                <span className="rounded-full border border-zinc-800 bg-zinc-950 px-1.5 py-0.5 text-[9px] text-zinc-500">
                                  <RuntimeLabel
                                    runtime={LOCAL_SESSION_RUNTIME_BY_SOURCE[session.source]}
                                    size={10}
                                    className="gap-1"
                                    labelClassName="text-[9px] text-zinc-500"
                                  />
                                </span>
                                <span className="text-[10px] text-zinc-600">
                                  {t('workspace.localSessions.messageCount', { defaultValue: '{{count}} 条', count: session.entryCount })}
                                </span>
                              </div>
                              {localSessionExecutorName ? (
                                <Badge className="mt-1 inline-flex max-w-full items-center border border-zinc-800 bg-zinc-950 px-2 py-0.5 text-[9px] font-medium text-zinc-400">
                                  <span className="truncate">
                                    {t('workspace.localSessions.executorName', { defaultValue: '节点 · {{name}}', name: localSessionExecutorName })}
                                  </span>
                                </Badge>
                              ) : null}
                            </div>
                            <span className="shrink-0 text-[10px] text-zinc-600">
                              {formatLocalSessionTimestamp(session.lastUpdatedAt)}
                            </span>
                          </div>
                        </button>
                      )
                    })
)}

                  {localSessionVisibilityState.canToggle ? (
                    <div className="flex items-center justify-between gap-2 rounded-md border border-zinc-900 bg-zinc-950/60 px-2 py-1.5">
                      <span className="text-[10px] text-zinc-500">
                        {t('workspace.localSessions.visibleSummary', {
                          defaultValue: '已显示 {{visible}} / {{total}}',
                          visible: localSessionVisibilityState.visibleCount,
                          total: localSessions.length,
                        })}
                      </span>
                      <div className="flex items-center gap-1">
                        {localSessionVisibilityState.canExpand ? (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => setLocalSessionVisibleCount(localSessionVisibilityState.nextVisibleCount)}
                            className="h-5 w-5 rounded-md p-0 text-zinc-300 hover:bg-zinc-900 hover:text-zinc-100"
                          >
                            <ChevronDown className="h-3 w-3" />
                          </Button>
                        ) : null}
                        {localSessionVisibilityState.canCollapse ? (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => setLocalSessionVisibleCount(null)}
                            className="h-5 w-5 rounded-md p-0 text-zinc-300 hover:bg-zinc-900 hover:text-zinc-100"
                          >
                            <ChevronUp className="h-3 w-3" />
                          </Button>
                        ) : null}
                      </div>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </section>
          ) : null}
        </div>
      </div>
    </aside>
  )
}
