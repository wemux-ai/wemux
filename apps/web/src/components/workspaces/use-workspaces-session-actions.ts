/**
 * [INPUT]: /workspaces selection state, route/cache adapters, workspace APIs, and confirmation UI.
 * [OUTPUT]: Session actions and transient UI state for the selected item in the workspace directory.
 * [POS]: /workspaces-specific action adapter over shared workspace-session mutations; owns no /workspace navigation.
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */

import { useState, type MutableRefObject } from 'react'
import { stripWorkspaceExecutionFieldsFromTask, syncWorkspaceSessionFromTaskExecutionView } from '@shared/task-workspace'
import type { AppState, Task, WorkspaceSession } from '@shared/types'
import { toast } from 'sonner'
import { api } from '../../lib/api'
import { renameWorkspaceSession, resolveCreatedWorkspaceSession } from '../../lib/workspace-session-mutations'
import { markWorkspaceSessionUnread } from '../../lib/workspace-session-attention'
import type { WorkspaceSessionChatRevisionAction } from './workspace-session-chat'
import type { WorkspaceListItem } from './workspaces-page-utils'

type ConfirmOptions = {
  title: string
  description: string
  confirmText: string
  cancelText: string
  tone: 'danger'
}

type UseWorkspacesSessionActionsOptions = {
  clearPendingWorkspaceSessionSelection: () => void
  clearSelectedLocalSessionPreview: () => void
  confirm: (options: ConfirmOptions) => Promise<boolean>
  displayTask: Task | null
  isMobile: boolean
  pendingWorkspaceSessionSelectionIdRef: MutableRefObject<string>
  runMutation: <T extends { state: AppState; message?: string }>(action: () => Promise<T>) => Promise<T | undefined>
  selectedItem: WorkspaceListItem | null
  selectedWorkspaceSession: WorkspaceSession | null
  selectedWorkspaceSessionId: string
  selectedWorkspaceSessions: WorkspaceSession[]
  selectedWorkspaceTask: Task | null
  setMobileView: (view: 'list' | 'detail' | 'create') => void
  setOptimisticWorkspaceSession: (updater: WorkspaceSession | null | ((current: WorkspaceSession | null) => WorkspaceSession | null)) => void
  setPendingPostForkAction: (value: {
    targetWorkspaceSessionId: string
    action: 'prefill' | 'send'
    draft: {
      text: string
      attachments?: WorkspaceSessionChatRevisionAction['attachments']
    }
  } | null) => void
  setSelectedWorkspaceSessionId: (workspaceSessionId: string) => void
  setState: (updater: AppState | ((state: AppState) => AppState)) => void
  setWorkspacePrimaryViewState: (workspaceId: string | undefined, view: 'chat' | 'records') => void
  workspaceSessions: WorkspaceSession[]
  t: (key: string, options?: Record<string, unknown>) => string
  updateWorkspaceSearch: (patch: { taskId?: string | undefined; workspaceSessionId?: string | undefined; panel?: 'records' | undefined }) => void
}

export function useWorkspacesSessionActions({
  clearPendingWorkspaceSessionSelection,
  clearSelectedLocalSessionPreview,
  confirm,
  displayTask,
  isMobile,
  pendingWorkspaceSessionSelectionIdRef,
  runMutation,
  selectedItem,
  selectedWorkspaceSession,
  selectedWorkspaceSessionId,
  selectedWorkspaceSessions,
  selectedWorkspaceTask,
  setMobileView,
  setOptimisticWorkspaceSession,
  setPendingPostForkAction,
  setSelectedWorkspaceSessionId,
  setState,
  setWorkspacePrimaryViewState,
  workspaceSessions,
  t,
  updateWorkspaceSearch,
}: UseWorkspacesSessionActionsOptions) {
  const [creatingWorkspaceSession, setCreatingWorkspaceSession] = useState(false)
  const [deletingWorkspaceSessionId, setDeletingWorkspaceSessionId] = useState('')
  const [forkingMessageId, setForkingMessageId] = useState<string | null>(null)
  const [revisingTurnId, setRevisingTurnId] = useState<string | null>(null)
  const [sessionRenameOpen, setSessionRenameOpen] = useState(false)
  const [sessionRenameDraft, setSessionRenameDraft] = useState('')
  const [sessionRenameBusy, setSessionRenameBusy] = useState(false)

  const handleWorkspaceTaskUpdate = (updatedTask: Task) => {
    if (!selectedItem || !selectedWorkspaceSession) {
      setState((prev) => ({
        ...prev,
        tasks: prev.tasks.map((task) => (task.id === updatedTask.id ? updatedTask : task)),
      }))
      return
    }

    setState((prev) => {
      const baseTask = prev.tasks.find((task) => task.id === updatedTask.id) ?? updatedTask
      const nextTask = stripWorkspaceExecutionFieldsFromTask(baseTask, updatedTask)
      const nextSession = syncWorkspaceSessionFromTaskExecutionView(baseTask, selectedWorkspaceSession, updatedTask)

      return {
        ...prev,
        tasks: prev.tasks.map((task) => (task.id === updatedTask.id ? nextTask : task)),
        workspaceSessions: prev.workspaceSessions.some((session) => session.id === nextSession.id)
          ? prev.workspaceSessions.map((session) => (session.id === nextSession.id ? nextSession : session))
          : [nextSession, ...prev.workspaceSessions],
      }
    })
  }

  const handleCreateWorkspaceSession = async () => {
    if (creatingWorkspaceSession) {
      return
    }
    if (!selectedItem) {
      toast.error(t('workspace.page.errors.noWorkspaceSelected', { defaultValue: '请先选择一个工作区。' }))
      return
    }

    setCreatingWorkspaceSession(true)
    try {
      const previousSessionIds = new Set(
        selectedWorkspaceSessions
          .filter((session) => session.workspaceId === selectedItem.workspace.id)
          .map((session) => session.id),
      )
      const response = await api.createWorkspaceSession(selectedItem.workspace.id, {
        baseBranch: selectedWorkspaceSession?.baseBranch || selectedWorkspaceTask?.baseBranch || selectedWorkspaceTask?.baseBranchHint,
        createNewSession: true,
      })
      const nextSession = resolveCreatedWorkspaceSession({
        workspaceId: selectedItem.workspace.id,
        previousSessionIds,
        response,
      })

      if (nextSession) {
        pendingWorkspaceSessionSelectionIdRef.current = nextSession.id
        setOptimisticWorkspaceSession(nextSession)
      }

      setState(response.state)

      if (nextSession) {
        clearSelectedLocalSessionPreview()
        setSelectedWorkspaceSessionId(nextSession.id)
        setWorkspacePrimaryViewState(selectedItem.workspace.id, 'chat')
        if (isMobile) {
          setMobileView('detail')
        }
        updateWorkspaceSearch({
          taskId: undefined,
          workspaceSessionId: nextSession.id,
          panel: undefined,
        })
      }

      toast.success(t('workspace.session.created'))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('workspace.session.createFailed'))
    } finally {
      setCreatingWorkspaceSession(false)
    }
  }

  const handleRenameWorkspaceSession = async (
    workspaceSessionId: string,
    title: string,
    target?: { workspaceId: string; taskId?: string },
  ) => {
    const nextTitle = title.trim()
    const targetSession = workspaceSessions.find((item) => item.id === workspaceSessionId)
      ?? selectedWorkspaceSessions.find((item) => item.id === workspaceSessionId)
    const targetWorkspaceId = target?.workspaceId || targetSession?.workspaceId || selectedItem?.workspace.id || ''
    if (!targetSession || !targetWorkspaceId || !nextTitle || nextTitle === targetSession.title) {
      return
    }

    const response = await renameWorkspaceSession({
      workspaceSessionId,
      workspaceId: targetWorkspaceId,
      title: nextTitle,
    })
    setState(response.state)
    if (selectedWorkspaceSessionId === workspaceSessionId || selectedItem?.workspace.id === targetWorkspaceId) {
      setSelectedWorkspaceSessionId(response.workspaceSessionId ?? workspaceSessionId)
      updateWorkspaceSearch({ workspaceSessionId: response.workspaceSessionId ?? workspaceSessionId })
    }
    toast.success(t('workspace.page.sessionRenameUpdated'))
  }

  const handleDeleteWorkspaceSession = async (workspaceSessionId: string) => {
    if (!selectedItem) {
      return
    }

    const targetSession = selectedWorkspaceSessions.find((item) => item.id === workspaceSessionId)
    if (!targetSession) {
      return
    }

    const confirmed = await confirm({
      title: t('workspace.page.deleteSessionDialog.title', { name: targetSession.title }),
      description: t('workspace.page.deleteSessionDialog.description'),
      confirmText: t('workspace.page.deleteSessionDialog.confirm'),
      cancelText: t('common.cancel'),
      tone: 'danger',
    })
    if (!confirmed) {
      return
    }

    setDeletingWorkspaceSessionId(workspaceSessionId)
    try {
      const response = await runMutation(() => api.deleteWorkspaceSession(selectedItem.workspace.id, workspaceSessionId))
      if (!response) {
        return
      }

      if (selectedWorkspaceSessionId === workspaceSessionId) {
        setSelectedWorkspaceSessionId(response.workspaceSessionId ?? '')
        updateWorkspaceSearch({ workspaceSessionId: response.workspaceSessionId ?? undefined })
      }
    } finally {
      setDeletingWorkspaceSessionId('')
    }
  }

  const handlePinWorkspaceSession = async (workspaceSessionId: string, pinned: boolean) => {
    if (!selectedItem) {
      return
    }

    await runMutation(() => api.updateWorkspaceSessionPinned(selectedItem.workspace.id, workspaceSessionId, pinned))
  }

  const openSelectedWorkspaceSessionRenameDialog = () => {
    if (!selectedWorkspaceSession) {
      return
    }

    setSessionRenameDraft(selectedWorkspaceSession.title)
    setSessionRenameOpen(true)
  }

  const handleMarkSelectedWorkspaceSessionUnread = () => {
    if (!selectedWorkspaceSession || !markWorkspaceSessionUnread(selectedWorkspaceSession)) {
      return
    }

    toast.success(t('workspace.pageView.messages.currentSessionMarkedUnread', { defaultValue: '已将当前会话标记为未读。' }))
  }

  const handleRenameSelectedWorkspaceSession = async () => {
    const nextTitle = sessionRenameDraft.trim()
    if (!selectedWorkspaceSession || !nextTitle) {
      return
    }

    setSessionRenameBusy(true)
    try {
      await handleRenameWorkspaceSession(selectedWorkspaceSession.id, nextTitle)
      setSessionRenameOpen(false)
      setSessionRenameDraft('')
    } finally {
      setSessionRenameBusy(false)
    }
  }

  const handleForkWorkspaceSessionFromMessage = async (messageId: string, mode: 'local' | 'worktree') => {
    if (!displayTask || !selectedItem || !selectedWorkspaceSession) {
      toast.error(t('workspace.page.errors.currentSessionMissing'))
      return
    }

    setForkingMessageId(messageId)
    try {
      const response = await api.forkWorkspaceSession(selectedItem.workspace.id, selectedWorkspaceSession.id, {
        taskId: displayTask.id,
        sourceMessageId: messageId,
        mode,
      })
      setState(response.state)
      const workspaceSessionId = response.workspaceSessionId ?? response.workspaceSession?.id
      setSelectedWorkspaceSessionId(workspaceSessionId ?? '')
      updateWorkspaceSearch({ workspaceSessionId })
      toast.success(response.message || t('workspace.page.forkCreated'))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('workspace.page.errors.forkFailed'))
    } finally {
      setForkingMessageId(null)
    }
  }

  const handleReviseWorkspaceSessionTurn = async (payload: WorkspaceSessionChatRevisionAction) => {
    if (!displayTask || !selectedItem || !selectedWorkspaceSession) {
      toast.error(t('workspace.page.errors.currentSessionMissing'))
      return
    }

    setRevisingTurnId(payload.turnId)
    try {
      const response = await api.forkWorkspaceSession(selectedItem.workspace.id, selectedWorkspaceSession.id, {
        taskId: displayTask.id,
        sourceMessageId: payload.sourceMessageId,
        mode: payload.mode,
        revision: {
          kind: payload.kind,
          sourceTurnId: payload.turnId,
          sourceUserMessageId: payload.kind === 'retry-assistant-turn' ? payload.userMessageId : payload.sourceMessageId,
          sourceAssistantMessageId: payload.kind === 'retry-assistant-turn' ? payload.assistantMessageId : undefined,
        },
      })
      setState(response.state)
      const nextWorkspaceSessionId = response.workspaceSessionId ?? response.workspaceSession?.id
      if (!nextWorkspaceSessionId) {
        throw new Error('分叉成功，但没有返回新的工作区会话。')
      }

      setPendingPostForkAction({
        targetWorkspaceSessionId: nextWorkspaceSessionId,
        action: payload.kind === 'retry-assistant-turn' ? 'send' : 'prefill',
        draft: {
          text: payload.text,
          attachments: payload.attachments,
        },
      })
      setSelectedWorkspaceSessionId(nextWorkspaceSessionId)
      updateWorkspaceSearch({ workspaceSessionId: nextWorkspaceSessionId })
      toast.success(response.message || t('workspace.page.forkCreated'))
    } catch (error) {
      setPendingPostForkAction(null)
      toast.error(error instanceof Error ? error.message : t('workspace.page.errors.forkFailed'))
    } finally {
      setRevisingTurnId(null)
    }
  }

  return {
    creatingWorkspaceSession,
    deletingWorkspaceSessionId,
    forkingMessageId,
    handleCreateWorkspaceSession,
    handleDeleteWorkspaceSession,
    handleForkWorkspaceSessionFromMessage,
    handleMarkSelectedWorkspaceSessionUnread,
    handlePinWorkspaceSession,
    handleRenameSelectedWorkspaceSession,
    handleRenameWorkspaceSession,
    handleReviseWorkspaceSessionTurn,
    handleWorkspaceTaskUpdate,
    openSelectedWorkspaceSessionRenameDialog,
    revisingTurnId,
    sessionRenameBusy,
    sessionRenameDraft,
    sessionRenameOpen,
    setSessionRenameDraft,
    setSessionRenameOpen,
  }
}
