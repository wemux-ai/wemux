// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
// INPUT: workspace session props, state/action hooks, and workspace-level callbacks
// OUTPUT: complete workspace-session chat surface and imperative composer handle
// POS: composition root for a single workspace session chat

import { useNavigate } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'
import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { buildWorkspaceTaskExecutionView } from '@shared/task-workspace'
import type { TaskChatAttachment } from '@shared/task-chat-attachment'
import type { WorkspaceSessionEventRecord } from '@shared/workspace-session-history'
import type { Task } from '@shared/types'
import { Card, CardContent } from '../../ui/card'
import { useAppDialog } from '../../ui/app-dialog-provider'
import { useSidebar } from '../../ui/sidebar'
import { api } from '../../../lib/api'
import { loadProjectAssignees } from '../../../lib/project-collaboration-data'
import { workspaceQueryKeys } from '../../../lib/workspace-query-keys'
import { clearCachedWorkspaceBranches, loadCachedWorkspaceBranches } from '../../../lib/workspace-branch-cache'
import { buildWorkspaceWorktreePath } from '../../../lib/workspace-paths'
import { usePreventPullToRefresh } from '../../../lib/use-prevent-pull-to-refresh'
import {
  buildSelectedContextItemsFromRefs,
  getTaskChatContextRefKey,
} from './workspace-session-chat-context-refs'
import { TaskChatDelegateDialog, TaskChatForkDialog, TaskChatRevisionDialog } from './workspace-session-chat-dialogs'
import { TaskChatFooterControls } from './workspace-session-chat-footer'
import { agentOptions } from './workspace-session-chat-helpers'
import { TaskChatHeader, TaskChatSurface } from './workspace-session-chat-layout'
import { useTaskChatActions } from './workspace-session-chat-actions'
import { resolveDisplayedWorkspaceBranchName } from './workspace-session-chat-workspace-branch-state'
import { useTaskChatState } from './workspace-session-chat-state'
import type {
  WorkspaceSessionChatDraftPayload,
  WorkspaceSessionChatHandle,
  WorkspaceSessionKnownCollaborator,
  WorkspaceSessionChatProps,
  WorkspaceSessionChatRevisionAction,
} from './workspace-session-chat-types'
import { SUB_AGENT_SESSION_ROLE_OPTIONS } from '../../../lib/custom-agent/delegate-runtime'
import { useAuth } from '../../../lib/auth-context'

const TASK_CHAT_SCROLL_TOP_THRESHOLD = 120

const getUserInitials = (name: string) => {
  const normalized = name.trim()
  if (!normalized) {
    return 'U'
  }

  const parts = normalized.split(/\s+/).filter(Boolean)
  if (parts.length > 1) {
    return parts.slice(0, 2).map((part) => part[0]).join('').toUpperCase()
  }

  return Array.from(normalized).slice(0, 2).join('').toUpperCase()
}

export const WorkspaceSessionChat = forwardRef<WorkspaceSessionChatHandle, WorkspaceSessionChatProps>(function WorkspaceSessionChat(props, ref) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { user } = useAuth()
  const { isMobile } = useSidebar()
  const { confirm } = useAppDialog()
  const state = useTaskChatState(props)
  const chrome = props.chrome ?? 'card'
  const isFlush = chrome === 'flush'
  const hideHeader = props.hideHeader ?? false
  const inlineSessionTokenSummary = props.inlineSessionTokenSummary?.trim() || ''
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [forkDialogOpen, setForkDialogOpen] = useState(false)
  const [forkTarget, setForkTarget] = useState<{
    messageId: string
    role: 'user' | 'assistant'
    text: string
  } | null>(null)
  const [revisionDialogOpen, setRevisionDialogOpen] = useState(false)
  const [revisionAction, setRevisionAction] = useState<WorkspaceSessionChatRevisionAction | null>(null)
  const [revisionMessage, setRevisionMessage] = useState('')
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null)
  const [deletingMessageId, setDeletingMessageId] = useState<string | null>(null)
  const [workspaceBranchOptions, setWorkspaceBranchOptions] = useState<string[]>([])
  const [workspaceBranchSources, setWorkspaceBranchSources] = useState<Record<string, 'remote' | 'local-only'> | undefined>(undefined)
  const [workspaceBranchLoading, setWorkspaceBranchLoading] = useState(false)
  const [workspaceBranchSaving, setWorkspaceBranchSaving] = useState(false)
  const [workspaceBranchMessage, setWorkspaceBranchMessage] = useState('')
  const [workspaceCurrentBranchOverride, setWorkspaceCurrentBranchOverride] = useState('')
  const [sessionTokenSummary, setSessionTokenSummary] = useState('')
  const [knownCollaborators, setKnownCollaborators] = useState<WorkspaceSessionKnownCollaborator[]>([])
  const [frozenTranscriptState, setFrozenTranscriptState] = useState<{
    displayTimeline: typeof state.displayTimeline
    systemLogs: typeof state.systemLogs
    notices: typeof state.notices
    displayStep: string
    queueStatusMessage: string
    isSessionBusy: boolean
  } | null>(null)
  const loadOlderSentinelRef = useRef<HTMLDivElement | null>(null)
  const lastTranscriptScrollTopRef = useRef<number | null>(null)
  const lastWorkspaceBranchRefreshAtRef = useRef(0)

  usePreventPullToRefresh({
    enabled: isMobile,
    scrollRef: state.scrollRef,
  })

  const actions = useTaskChatActions({
    agentSettings: props.agentSettings,
    busy: props.busy,
    launchId: props.launchId,
    mentionProjects: props.mentionProjects,
    onAssignExecutor: props.onAssignExecutor,
    onWorkspaceSessionChange: props.onWorkspaceSessionChange,
    project: props.project,
    state,
    task: props.task,
    workspaceId: props.workspaceId,
    workspaceOwnerUserId: props.workspaceOwnerUserId,
    workspaceRepoPath: props.workspaceRepoPath,
    workspaceRoot: props.workspaceRoot,
    workspaceSession: props.workspaceSession,
    workspaceSessionId: props.workspaceSessionId,
  })

  const fileMentionRootPath = useMemo(() => {
    if (!props.project || !props.workspaceId) {
      return ''
    }

    const workingDirectoryMode = props.workspaceSession?.workingDirectoryMode
      ?? props.workspaceWorkingDirectoryMode
      ?? 'worktree'
    if (props.project.versionControl === 'none' || workingDirectoryMode === 'original-dir') {
      return props.workspaceRepoPath?.trim() || props.workspaceRoot?.trim() || ''
    }

    if (props.workspaceSession?.worktreeStatus !== 'cleaned' && props.workspaceSession?.worktreeId?.trim()) {
      return buildWorkspaceWorktreePath(
        props.workspaceRoot,
        props.project,
        props.workspaceSession.worktreeId,
        props.workspaceId,
        props.workspaceOwnerUserId,
      )
    }

    return props.workspaceRepoPath?.trim() || props.workspaceRoot?.trim() || ''
  }, [
    props.project,
    props.workspaceId,
    props.workspaceOwnerUserId,
    props.workspaceRepoPath,
    props.workspaceRoot,
    props.workspaceSession,
    props.workspaceWorkingDirectoryMode,
  ])

  const selectedContextItems = useMemo(() => {
    return buildSelectedContextItemsFromRefs({
      refs: state.selectedContextRefs,
      project: props.project,
      projects: props.mentionProjects,
      workspacePath: fileMentionRootPath,
    })
  }, [fileMentionRootPath, props.mentionProjects, props.project, state.selectedContextRefs])

  const insertMentionToken = useCallback((token: string) => {
    const normalizedToken = token.trim()
    if (!normalizedToken) {
      return
    }

    const mentionQuery = state.mentionQuery
    state.resetComposerHistoryNavigation()
    state.setInput((current) => {
      if (!mentionQuery) {
        const separator = current && !/\s$/.test(current) ? ' ' : ''
        return `${current}${separator}${normalizedToken} `
      }

      return `${current.slice(0, mentionQuery.start)}${normalizedToken} ${current.slice(mentionQuery.end)}`
    })
    if (mentionQuery) {
      state.setComposerCaret(mentionQuery.start + normalizedToken.length + 1)
    }
  }, [state])

  const handleInsertProjectContext = useCallback((project: NonNullable<WorkspaceSessionChatProps['project']>) => {
    if (!project) {
      return
    }

    insertMentionToken(project.id === props.project?.id ? '@项目' : `@${project.name}`)
  }, [insertMentionToken, props.project?.id])

  const handleInsertFileContext = useCallback((item: {
    absolutePath: string
    mentionPath: string
    label: string
    directoryLabel: string
  }) => {
    if (!props.workspaceId || !props.workspaceSessionId) {
      return
    }

    insertMentionToken(`@${item.mentionPath}`)
  }, [insertMentionToken, props.workspaceId, props.workspaceSessionId])

  const prepareDraft = useCallback((payload: WorkspaceSessionChatDraftPayload) => {
    state.resetComposerHistoryNavigation()
    state.setInput(payload.text)
    state.setImages(payload.attachments ?? [])
    state.setSelectedContextRefs(payload.contextRefs ?? [])
    state.scrollToBottom()
  }, [state])

  useImperativeHandle(ref, () => ({
    canSend: !props.busy
      && !state.runtimeSettingsSaving
      && !state.mcpSettingsSaving
      && !state.requiresModelSelection
      && !state.requiresExecutorSelection
      && state.isSocketOpen,
    prefillMessage: (text: string) => {
      state.setSelectedContextRefs([])
      state.setInput(text)
    },
    prepareDraft,
    refreshSessionView: state.refreshSessionView,
    sendPreparedMessage: actions.submitPreparedMessage,
  }), [
    actions.submitPreparedMessage,
    prepareDraft,
    props.busy,
    state.refreshSessionView,
    state.mcpSettingsSaving,
    state.requiresExecutorSelection,
    state.requiresModelSelection,
    state.runtimeSettingsSaving,
    state.isSocketOpen,
  ])

  const sessionRoleOptions = useMemo(() => {
    return SUB_AGENT_SESSION_ROLE_OPTIONS.map((item) => ({
      value: item.value,
      label: item.label,
      description: item.description,
    }))
  }, [])

  const openExecutorSetup = () => {
    state.setExecutorMenuOpen(false)
    void navigate({
      to: '/execution',
      search: { createExecutor: '1', editExecutorId: undefined, terminalExecutorId: undefined, workspaceId: undefined, teamId: undefined },
    })
  }

  const handleExecutorSelect = (executorId: string) => {
    state.setExecutorMenuOpen(false)
    actions.handleExecutorChange(executorId)
  }

  const handleDelegateDialogReset = () => {
    state.setDelegateOpen(false)
    state.setDelegatePrompt('')
    state.setDelegateAgentId('')
    state.setDelegateSessionRole('general')
  }

  const handleForkDialogCancel = () => {
    if (props.forkingMessageId) {
      return
    }

    setForkDialogOpen(false)
    setForkTarget(null)
  }

  const handleRevisionDialogCancel = () => {
    if (props.revisingTurnId) {
      return
    }

    setRevisionDialogOpen(false)
    setRevisionAction(null)
    setRevisionMessage('')
  }

  useEffect(() => {
    return () => {
      if (copyTimerRef.current) {
        clearTimeout(copyTimerRef.current)
      }
    }
  }, [])

  useEffect(() => {
    lastTranscriptScrollTopRef.current = null
  }, [props.task.id, props.workspaceId, props.workspaceSessionId])

  useEffect(() => {
    if (state.isSelectionGestureActive) {
      setFrozenTranscriptState({
        displayTimeline: state.displayTimeline,
        systemLogs: state.systemLogs,
        notices: state.notices,
        displayStep: state.displayStep,
        queueStatusMessage: state.queueStatusMessage,
        isSessionBusy: state.isSessionBusy,
      })
      return
    }

    setFrozenTranscriptState(null)
  }, [
    state.displayStep,
    state.displayTimeline,
    state.isSelectionGestureActive,
    state.isSessionBusy,
    state.notices,
    state.queueStatusMessage,
    state.systemLogs,
  ])

  useEffect(() => {
    if (!props.workspaceId || !props.workspaceSessionId) {
      setSessionTokenSummary('')
      return
    }

    let cancelled = false
    void queryClient.fetchQuery({
      queryKey: workspaceQueryKeys.modelUsageSummary('all', props.task.id, props.workspaceId, props.workspaceSessionId),
      queryFn: () => api.getModelUsageSummary('all', {
        taskId: props.task.id,
        workspaceId: props.workspaceId,
        workspaceSessionId: props.workspaceSessionId,
      }),
      staleTime: 30_000,
    }).then((response) => {
      if (cancelled) {
        return
      }

      const totalTokens = response.summary.totals.totalTokens
      const runCount = response.summary.totals.runCount
      setSessionTokenSummary(totalTokens > 0
        ? `Token ${totalTokens.toLocaleString()} · ${runCount} 次`
        : '')
    }).catch(() => {
      if (!cancelled) {
        setSessionTokenSummary('')
      }
    })

    return () => {
      cancelled = true
    }
  }, [props.task.id, props.workspaceId, props.workspaceSessionId, queryClient])

  const refreshWorkspaceBranches = useCallback(async ({
    force = false,
    resetOnError = false,
    showLoading = false,
  }: {
    force?: boolean
    resetOnError?: boolean
    showLoading?: boolean
  } = {}) => {
    const workspaceId = props.workspaceId?.trim()
    if (!workspaceId || props.project?.versionControl === 'none') {
      return
    }

    const branchSnapshotScope = {
      taskId: props.task.id,
      workspaceSessionId: props.workspaceSessionId,
    }

    if (force) {
      clearCachedWorkspaceBranches(workspaceId, branchSnapshotScope)
    }

    if (showLoading) {
      setWorkspaceBranchLoading(true)
    }

    try {
      const response = await loadCachedWorkspaceBranches(workspaceId, branchSnapshotScope)
      setWorkspaceBranchOptions(response.branches)
      setWorkspaceBranchSources(response.branchSources)
      setWorkspaceBranchMessage(response.message || '')
      setWorkspaceCurrentBranchOverride(response.currentBranch?.trim() || '')
    } catch (error) {
      if (resetOnError) {
        setWorkspaceBranchOptions([])
        setWorkspaceBranchSources(undefined)
        setWorkspaceBranchMessage(error instanceof Error ? error.message : '分支列表加载失败')
        setWorkspaceCurrentBranchOverride('')
      }
    } finally {
      if (showLoading) {
        setWorkspaceBranchLoading(false)
      }
    }
  }, [props.project?.versionControl, props.task.id, props.workspaceId, props.workspaceSessionId])

  useEffect(() => {
    if (!props.workspaceId) {
      setWorkspaceBranchOptions([])
      setWorkspaceBranchSources(undefined)
      setWorkspaceBranchLoading(false)
      setWorkspaceBranchMessage('')
      setWorkspaceCurrentBranchOverride('')
      return
    }

    if (props.project?.versionControl === 'none') {
      setWorkspaceBranchOptions([])
      setWorkspaceBranchSources(undefined)
      setWorkspaceBranchLoading(false)
      setWorkspaceBranchMessage('当前项目未启用 Git。')
      setWorkspaceCurrentBranchOverride('')
      return
    }

    void refreshWorkspaceBranches({ resetOnError: true, showLoading: true })
  }, [props.project?.versionControl, props.workspaceId, refreshWorkspaceBranches])

  useEffect(() => {
    if (!props.workspaceId || props.project?.versionControl === 'none') {
      return
    }

    const refreshOnWorkspaceFocus = () => {
      const now = Date.now()
      if (now - lastWorkspaceBranchRefreshAtRef.current < 1000) {
        return
      }

      lastWorkspaceBranchRefreshAtRef.current = now
      void refreshWorkspaceBranches({ force: true })
    }

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        refreshOnWorkspaceFocus()
      }
    }

    window.addEventListener('focus', refreshOnWorkspaceFocus)
    document.addEventListener('focusin', refreshOnWorkspaceFocus)
    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => {
      window.removeEventListener('focus', refreshOnWorkspaceFocus)
      document.removeEventListener('focusin', refreshOnWorkspaceFocus)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [props.project?.versionControl, props.workspaceId, refreshWorkspaceBranches])

  const displayedWorkspaceBranchName = resolveDisplayedWorkspaceBranchName({
    versionControl: props.project?.versionControl,
    workingDirectoryMode: props.workspaceWorkingDirectoryMode,
    currentRepoBranch: workspaceCurrentBranchOverride,
    workspaceSessionBranchName: props.workspaceBranchName,
  })

  const handleWorkspaceBranchSelect = async (branchName: string) => {
    if (!props.workspaceId || !props.workspaceSessionId) {
      return
    }

    setWorkspaceBranchSaving(true)
    try {
      const response = await api.switchTaskWorkspaceBranch(props.task.id, {
        workspaceId: props.workspaceId,
        workspaceSessionId: props.workspaceSessionId,
        branchName,
      })
      const nextWorkspaceSessionId = response.workspaceSessionId ?? props.workspaceSessionId
      const nextTask = response.workspaceSession
        ? buildWorkspaceTaskExecutionView(props.task, response.workspaceSession)
        : props.task

      props.onWorkspaceSessionChange?.({
        workspaceSessionId: nextWorkspaceSessionId,
        state: response.state,
        task: nextTask,
      })
      props.onTaskUpdate(nextTask)
      setWorkspaceCurrentBranchOverride(branchName)
      toast.success(response.message || '工作区分支已更新。')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '切换工作区分支失败。')
    } finally {
      setWorkspaceBranchSaving(false)
    }
  }

  const markMessageCopied = (messageId: string) => {
    setCopiedMessageId(messageId)
    if (copyTimerRef.current) {
      clearTimeout(copyTimerRef.current)
    }
    copyTimerRef.current = setTimeout(() => {
      setCopiedMessageId((current) => current === messageId ? null : current)
    }, 1200)
  }

  const handleCopyMessage = useCallback(async (messageId: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text)
      markMessageCopied(messageId)
    } catch {
      toast.error('复制失败，请手动复制。')
    }
  }, [])

  const isWorkspaceHistoryMode = Boolean(
    props.workspaceId
    && props.workspaceSessionId,
  )
  const hasMoreBefore = isWorkspaceHistoryMode ? state.historyHasMoreBefore : state.conversationHasMoreBefore
  const loadingMoreBefore = isWorkspaceHistoryMode ? state.loadingOlderHistory : state.loadingOlderConversation

  const deleteWorkspaceHistoryTurn = async (messageId: string) => {
    if (!props.workspaceSessionId || !props.workspaceId) {
      throw new Error('当前不是工作区会话，无法走新的历史删除链路。')
    }

    const targetTurn = state.displayTimeline.find((turn) => turn.user?.messageId === messageId)
    const turnId = targetTurn?.id?.trim()
    if (!turnId) {
      throw new Error('没有找到对应的工作区回合，无法删除这条消息。')
    }

    const result = await api.deleteWorkspaceSessionTurn(
      props.workspaceId,
      props.workspaceSessionId,
      {
        turnId,
        messageId,
      },
    )

    if (result.status === 'noop') {
      state.setTimeline((current) => current.filter((event) => event.turnId !== turnId))
      return
    }

    const deletedEvent = result.event
    state.setTimeline((current) => current.filter((event) => event.turnId !== deletedEvent.payload.deletedTurnId))
    queryClient.setQueryData(
      workspaceQueryKeys.historyEvents(props.workspaceId, props.workspaceSessionId),
      (current: WorkspaceSessionEventRecord[] | undefined) => {
        const next = new Map<string, WorkspaceSessionEventRecord>()
        for (const event of current ?? []) {
          next.set(event.id, event)
        }
        next.set(deletedEvent.id, deletedEvent)
        return [...next.values()].sort((left, right) => left.sessionSeq - right.sessionSeq)
      },
    )
    await queryClient.invalidateQueries({
      queryKey: workspaceQueryKeys.historyEventsScope(props.workspaceId, props.workspaceSessionId),
    })
    await queryClient.invalidateQueries({
      queryKey: workspaceQueryKeys.historyTurns(props.workspaceId, props.workspaceSessionId),
    })
    if (result.runtime) {
      state.setLiveStatus(result.runtime.agentRunningStatus)
      state.setLiveStep(result.runtime.currentStep)
      state.setLiveTools(result.runtime.activeToolCalls ?? [])
    }
  }

  const handleEditMessage = useCallback(async (messageId: string, text: string, attachments: TaskChatAttachment[]) => {
    if (state.isSessionBusy) {
      await actions.handleStop()
    }

    setDeletingMessageId(messageId)
    void (async () => {
      try {
        await deleteWorkspaceHistoryTurn(messageId)

        state.resetComposerHistoryNavigation()
        state.setInput(text)
        state.setImages(attachments)
        state.setSelectedContextRefs([])
        state.scrollToBottom()
        toast.success('已放回输入框，可继续修改后重发。')
      } catch (error) {
        toast.error(error instanceof Error ? error.message : '删除原消息失败，请手动重试。')
      } finally {
        setDeletingMessageId((current) => current === messageId ? null : current)
      }
    })()
  }, [actions, props.task.id, props.workspaceId, props.workspaceSessionId, state, isWorkspaceHistoryMode])

  const handleDeleteMessage = useCallback(async (messageId: string) => {
    const confirmed = await confirm({
      title: '删除这条消息？',
      description: '这会删除当前工作区会话里的这条用户消息，不会删除整个会话。',
      confirmText: '删除消息',
      cancelText: '取消',
      tone: 'danger',
    })
    if (!confirmed) {
      return
    }

    if (state.isSessionBusy) {
      await actions.handleStop()
    }

    setDeletingMessageId(messageId)
    try {
      await deleteWorkspaceHistoryTurn(messageId)
      toast.success('消息已删除。')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '删除消息失败。')
    } finally {
      setDeletingMessageId((current) => current === messageId ? null : current)
    }
  }, [actions, confirm, props.task.id, props.workspaceId, props.workspaceSessionId, state, isWorkspaceHistoryMode])

  const handleTranscriptScroll = () => {
    state.updateStickiness()
    const node = state.scrollRef.current
    if (!node || !hasMoreBefore || loadingMoreBefore) {
      if (node) {
        lastTranscriptScrollTopRef.current = node.scrollTop
      }
      return
    }

    const previousScrollTop = lastTranscriptScrollTopRef.current
    lastTranscriptScrollTopRef.current = node.scrollTop
    const scrolledUp = typeof previousScrollTop === 'number' && node.scrollTop < previousScrollTop - 2
    if (scrolledUp && node.scrollTop <= TASK_CHAT_SCROLL_TOP_THRESHOLD) {
      void state.loadOlderTranscriptPage()
    }
  }

  const userLabel = user?.name?.trim() || '成员'
  const userAvatarFallback = getUserInitials(userLabel)
  const userAvatarUrl = user?.avatarUrl?.trim() || undefined
  const tasksById = useMemo(() => {
    const tasks = props.allTasks ?? [props.task]
    return new Map(tasks.map((task) => [task.id, task] as const))
  }, [props.allTasks, props.task])
  const handleOpenTaskFromResult = useCallback((task: Task) => {
    void navigate({
      to: '/kanban',
      search: {
        projectId: task.projectId,
        taskId: task.id,
        createTask: undefined,
      },
    })
  }, [navigate])

  useEffect(() => {
    const projectId = props.project?.id?.trim() || ''
    if (!projectId) {
      setKnownCollaborators([])
      return
    }

    let cancelled = false
    void loadProjectAssignees(projectId)
      .then((assignees) => {
        if (!cancelled) {
          setKnownCollaborators(assignees)
        }
      })
      .catch(() => {
        if (!cancelled) {
          setKnownCollaborators([])
        }
      })

    return () => {
      cancelled = true
    }
  }, [props.project?.id])

  const transcriptState = frozenTranscriptState ?? {
    displayTimeline: state.displayTimeline,
    systemLogs: state.systemLogs,
    notices: state.notices,
    displayStep: state.displayStep,
    queueStatusMessage: state.queueStatusMessage,
    isSessionBusy: state.isSessionBusy,
  }

  const chatBody = (
    <>
      {hideHeader ? null : (
        <TaskChatHeader
          socketStatus={state.socketStatus}
          liveBadgeTone={state.liveBadgeTone}
          isSessionBusy={state.isSessionBusy}
          queuePending={state.queuePending}
          sessionQueued={state.sessionQueued}
          displayStatus={state.displayStatus}
          visibleMessagesCount={state.visibleMessages.length}
          visibleToolsCount={state.visibleTools.length}
          selectedAgentType={state.selectedAgentType}
          workspaceSession={props.workspaceSession}
          workspaceSessions={props.workspaceSessions}
          isSubagentSession={state.isSubagentSession}
          sessionRoleLabel={state.sessionRoleLabel}
          boundCustomAgentName={state.boundCustomAgentName}
          boundCustomAgentMode={state.boundCustomAgentMode}
          mountedSkillNames={state.mountedSkillNames}
          mountedMcpServerNames={state.mountedMcpServerNames}
          sessionTokenSummary={sessionTokenSummary}
          flush={isFlush}
        />
      )}
      {hideHeader && (inlineSessionTokenSummary || sessionTokenSummary) ? (
        <div className="px-3 pb-2">
          <div className="inline-flex items-center rounded-full border border-cyan-500/30 bg-cyan-500/10 px-2.5 py-1 text-xs text-cyan-100">
            {inlineSessionTokenSummary || sessionTokenSummary}
          </div>
        </div>
      ) : null}

      <TaskChatSurface
        scrollRef={state.scrollRef}
        onScroll={handleTranscriptScroll}
        showJumpToBottom={state.showJumpToBottom}
        scrollShortcutTarget={state.scrollShortcutTarget}
        onJumpToBottom={() => state.scrollToBottom()}
        onJumpToTop={() => state.scrollToTop()}
        onScrollToBottom={state.scrollToBottom}
        feedProps={{
          isMobile,
          currentUserId: user?.id?.trim() || undefined,
          knownCollaborators,
          workspaceCreatedBy: props.workspaceCreatedBy,
          workspaceOwnerUserId: props.workspaceOwnerUserId,
          userAvatarUrl,
          userAvatarFallback,
          userLabel,
          hasMoreBefore,
          isWorkspaceHistoryMode,
          loadingMoreBefore,
          loadOlderSentinelRef,
          onLoadOlderTranscriptPage: () => void state.loadOlderTranscriptPage(),
          selectedAgentType: state.selectedAgentType,
          boundCustomAgentName: state.boundCustomAgentName,
          boundCustomAgentMode: state.boundCustomAgentMode,
          mountedSkillNames: state.mountedSkillNames,
          mountedMcpServerNames: state.mountedMcpServerNames,
          notices: transcriptState.notices,
          systemLogs: transcriptState.systemLogs,
          displayTimeline: transcriptState.displayTimeline,
          tasksById,
          initialTranscriptReady: state.initialTranscriptReady,
          isSessionBusy: transcriptState.isSessionBusy,
          displayStep: transcriptState.displayStep,
          currentRunTiming: state.currentRunTiming,
          outlineItems: state.outlineItems,
          queueStatusMessage: transcriptState.queueStatusMessage,
          onJumpToOutlineTurn: state.ensureOutlineItemVisible,
          onCopyMessage: handleCopyMessage,
          copiedMessageId,
          onDeleteMessage: handleDeleteMessage,
          deletingMessageId,
          onEditMessage: handleEditMessage,
          onOpenWorkspaceFileLink: props.onOpenWorkspaceFileLink,
          onForkMessage: props.onForkFromMessage ? (messageId, role, text) => {
            setForkTarget({ messageId, role, text })
            setForkDialogOpen(true)
          } : undefined,
          forkingMessageId: props.forkingMessageId,
          onReviseTurn: props.onReviseTurn ? (payload) => {
            setRevisionAction(payload)
            setRevisionMessage(payload.text)
            setRevisionDialogOpen(true)
          } : undefined,
          revisingTurnId: props.revisingTurnId,
          onOpenTaskFromResult: handleOpenTaskFromResult,
        }}
        composerProps={{
          input: state.input,
          onInputChange: (value, target) => {
            state.resetComposerHistoryNavigation()
            state.setInput(value)
            state.updateComposerCaret(target)
          },
          onCaretChange: state.updateComposerCaret,
          onNavigateHistory: state.navigateComposerHistory,
          onSend: actions.handleSend,
          onStop: actions.handleStop,
          onPasteImages: actions.handleImageUpload,
          onUploadImages: actions.handleImageUpload,
          isUploading: state.isUploading,
          isSendingMessage: state.isSendingMessage,
          busy: props.busy,
          sendDisabled: state.sendDisabled,
          isSessionBusy: state.isSessionBusy,
          queueStatusMessage: transcriptState.queueStatusMessage,
          queuedMessages: state.queuedMessages,
          onEditQueuedMessage: (queueId, message, attachments) => {
            state.resetComposerHistoryNavigation()
            state.setInput(message)
            state.setImages(attachments)
            state.setSelectedContextRefs([])
            void actions.handleRemoveQueuedMessage(queueId)
          },
          onRemoveQueuedMessage: actions.handleRemoveQueuedMessage,
          messageQueue: state.messageQueue,
          onRemoveQueuedDraft: (id) => {
            state.setMessageQueue((prev) => prev.filter((item) => item.id !== id))
          },
          onEditQueuedDraft: (id, content) => {
            state.setMessageQueue((prev) => {
              return prev.map((item) => item.id === id ? { ...item, content, editedAt: new Date().toISOString() } : item)
            })
          },
          onMoveQueuedDraftToInput: (id) => {
            const draft = state.messageQueue.find((item) => item.id === id)
            if (!draft) {
              return
            }

            state.resetComposerHistoryNavigation()
            state.setInput(draft.content)
            state.setImages(draft.attachments)
            state.setSelectedContextRefs([])
            state.setMessageQueue((prev) => prev.filter((item) => item.id !== id))
          },
          mentionedAgents: state.mentionedAgents,
          mentionQueryActive: Boolean(state.mentionQuery),
          mentionAvailableOptions: state.mentionAvailableOptions,
          mentionProject: props.project,
          mentionProjects: props.mentionProjects,
          mentionQueryText: state.mentionQuery?.query ?? '',
          mentionSkills: state.mentionSkills,
          mentionSkillsLoading: state.mentionSkillsLoading,
          mentionUnavailableOptions: state.mentionUnavailableAgentItems,
          executorId: state.effectiveExecutorId,
          fileRootPath: fileMentionRootPath,
          onInsertAgentMention: state.insertAgentMention,
          onInsertFileMention: handleInsertFileContext,
          onInsertProjectMention: handleInsertProjectContext,
          onInsertSkillMention: insertMentionToken,
          selectedContextItems,
          onRemoveSelectedContextItem: (key) => {
            state.setSelectedContextRefs((current) => current.filter((item) => getTaskChatContextRefKey(item) !== key))
          },
          images: state.images,
          imagesLocked: state.isSendingMessage,
          onRemoveImage: actions.handleRemoveImage,
          footerControls: (
            <TaskChatFooterControls
              activeExecutorName={props.activeExecutorName}
              agentMenuOpen={state.agentMenuOpen}
              agentOptions={agentOptions}
              agentSaving={state.agentSaving}
              availableMcpServers={state.availableMcpServers}
              busy={props.busy}
              defaultModel={state.defaultModel}
              effectiveExecutorId={state.effectiveExecutorId}
              executorCards={state.executorCards}
              executorMenuOpen={state.executorMenuOpen}
              executorSaving={state.executorSaving}
              groupedModelOptions={state.groupedModelOptions}
              hasUnavailableSelectedModel={state.hasUnavailableSelectedModel}
              input={state.input}
              mentionSkills={state.mentionSkills}
              mentionSkillsLoading={state.mentionSkillsLoading}
              mcpSettingsSaving={state.mcpSettingsSaving}
              modelDisabled={state.modelDisabled}
              modelMenuOpen={state.modelMenuOpen}
              modelMeta={state.modelMeta}
              modelSaving={state.modelSaving}
              modelSummary={state.modelSummary}
              modelSummaryHint={state.modelSummaryHint}
              modelSummaryTitle={state.modelSummaryTitle}
              runtimeSettingsDisabled={state.runtimeSettingsDisabled}
              runtimeSettingsSaving={state.runtimeSettingsSaving}
              selectedAgentType={state.selectedAgentType}
              selectedMcpServerIds={state.selectedMcpServerIds}
              selectedModel={state.selectedModel}
              selectedRuntimeSettings={state.selectedRuntimeSettings}
              visibleSelectedModel={state.visibleSelectedModel}
              workspaceId={props.workspaceId}
              isSessionBusy={state.isSessionBusy}
              workspaceWorkingDirectoryMode={props.workspaceWorkingDirectoryMode}
              workspaceVersionControl={props.project?.versionControl}
              workspaceBranchName={displayedWorkspaceBranchName}
              workspaceBaseBranch={props.workspaceBaseBranch}
              workspaceBranchLoading={workspaceBranchLoading}
              workspaceBranchSaving={workspaceBranchSaving}
              workspaceBranchOptions={workspaceBranchOptions}
              workspaceBranchSources={workspaceBranchSources}
              workspaceBranchMessage={workspaceBranchMessage}
              onOpenDelegate={() => {
                state.setDelegatePrompt(state.input.trim())
                state.setDelegateOpen(true)
              }}
              onLoadMentionSkills={state.requestMentionSkills}
              onSelectSkillMention={state.setInput}
              onExecutorMenuOpenChange={state.setExecutorMenuOpen}
              onSelectExecutor={handleExecutorSelect}
              onCreateExecutor={openExecutorSetup}
              onAgentMenuOpenChange={state.setAgentMenuOpen}
              onSelectAgent={actions.handleAgentChange}
              onModelMenuOpenChange={state.setModelMenuOpen}
              onSelectModel={actions.handleModelChange}
              onChangeMcpSettings={(nextIds) => {
                void actions.handleMcpSettingsChange(nextIds)
              }}
              onChangeRuntimeSettings={(nextSettings) => {
                void actions.handleRuntimeSettingsChange(nextSettings)
              }}
              onSelectWorkspaceBranch={handleWorkspaceBranchSelect}
            />
          ),
        }}
      />
    </>
  )

  return (
    <>
      {isFlush ? (
        <div className="flex h-full min-h-0 flex-col overflow-hidden">
          {chatBody}
        </div>
      ) : (
        <Card className="flex h-full flex-col overflow-hidden border-zinc-800 bg-zinc-950/70 text-zinc-100 shadow-none">
          <CardContent className="relative flex min-h-0 flex-1 flex-col p-0">
            {chatBody}
          </CardContent>
        </Card>
      )}
      <TaskChatDelegateDialog
        open={state.delegateOpen}
        onOpenChange={state.setDelegateOpen}
        delegateAgentId={state.delegateAgentId}
        delegateOptions={state.delegateOptions}
        delegateUnavailableOptions={state.delegateUnavailableAgentItems}
        selectedDelegateSummary={state.selectedDelegateSummary}
        delegatePrompt={state.delegatePrompt}
        delegatePromptHint={state.delegatePromptHint}
        delegatePromptPlaceholder={state.delegatePromptPlaceholder}
        delegateSessionRole={state.delegateSessionRole}
        sessionRoleOptions={sessionRoleOptions}
        onSelectAgent={state.setDelegateAgentId}
        onChangePrompt={state.setDelegatePrompt}
        onSelectSessionRole={state.setDelegateSessionRole}
        onConfirm={actions.handleDelegateConfirm}
        onReset={handleDelegateDialogReset}
      />
      <TaskChatForkDialog
        open={forkDialogOpen}
        sourceLabel={forkTarget?.role === 'user' ? '从这条用户消息分叉' : '从这条助手消息分叉'}
        sourcePreview={(forkTarget?.text || '').trim().slice(0, 180) || '该消息没有可预览内容。'}
        saving={Boolean(props.forkingMessageId)}
        onOpenChange={(open) => {
          setForkDialogOpen(open)
          if (!open && !props.forkingMessageId) {
            setForkTarget(null)
          }
        }}
        onCancel={handleForkDialogCancel}
        onConfirm={async (mode) => {
          if (!forkTarget || !props.onForkFromMessage) {
            return
          }

          await props.onForkFromMessage(forkTarget.messageId, mode)
          setForkDialogOpen(false)
          setForkTarget(null)
        }}
      />
      <TaskChatRevisionDialog
        open={revisionDialogOpen}
        title={revisionAction?.kind === 'retry-assistant-turn' ? '重试并分叉' : '改写并分叉'}
        description={revisionAction?.kind === 'retry-assistant-turn'
          ? '会基于当前这轮用户输入创建一个新分支，并在新会话里重新发送。'
          : '会基于当前这轮用户输入创建一个新分支，并把改写后的内容放到新会话输入框。'}
        message={revisionMessage}
        saving={Boolean(props.revisingTurnId)}
        confirmLabel={revisionAction?.kind === 'retry-assistant-turn' ? '重试并分叉' : '改写并分叉'}
        onOpenChange={(open) => {
          setRevisionDialogOpen(open)
          if (!open && !props.revisingTurnId) {
            setRevisionAction(null)
            setRevisionMessage('')
          }
        }}
        onCancel={handleRevisionDialogCancel}
        onChangeMessage={setRevisionMessage}
        onConfirm={async (mode) => {
          if (!revisionAction || !props.onReviseTurn) {
            return
          }

          await props.onReviseTurn({
            ...revisionAction,
            text: revisionMessage,
            mode,
          })
          setRevisionDialogOpen(false)
          setRevisionAction(null)
          setRevisionMessage('')
        }}
      />
    </>
  )
})
