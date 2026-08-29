// [INPUT]: 工作区会话状态、实时 Socket 发送能力与任务聊天 HTTP 队列 API
// [OUTPUT]: 消息发送、停止、队列移除及附件操作；实时通道不可用时自动降级到控制面队列
// [POS]: /workspace 会话聊天的用户动作编排层，负责前端即时反馈而不等待实时连接建立
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
import { useCallback } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'
import { getRuntimeDescriptor, resolveAgentTypeForRuntimeId } from '@shared/agent-type'
import { toast } from 'sonner'
import { buildSubagentDelegatePrompt } from '@shared/subagent-role'
import type { TaskChatAttachment } from '@shared/task-chat-attachment'
import type { TaskChatMessageRuntimeConfig, TaskChatSessionSnapshot } from '@shared/task-chat-session'
import type {
  AgentRuntimeSettings,
  AppState,
  Task,
  WorkingDirectoryMode,
} from '@shared/types'
import { api, getAuthHeaders, resolveApiUrl } from '../../../lib/api'
import { CURRENT_APP_VERSION } from '../../../lib/node-version'
import { workspaceQueryKeys } from '../../../lib/workspace-query-keys'
import { useAppDialog } from '../../ui/app-dialog-provider'
import { parseCustomAgentProfile } from '../../../lib/custom-agent/draft'
import {
  buildAgentPromptEnvelope,
  resolveDefaultDelegateBaseBranch,
  resolveDefaultDelegateSessionMode,
  resolveDefaultDelegateWorkingDirectoryMode,
} from '../../../lib/custom-agent/delegate-runtime'
import {
  reconcileOptimisticWorkspaceSessionSnapshotFromTaskPart,
  restoreWorkspaceSessionSnapshotRuntime,
} from './workspace-session-chat-socket-sync'
import { resolveIncomingTaskChatSessionSnapshot } from '../../../lib/thread/thread-merge'
import {
  isTaskChatSocketNotReadyError,
  normalizeMcpSelection,
  prependNotice,
  removeTaskChatTurnEvents,
  resolveSubagentEnvironmentContext,
  resolveTaskChatRuntimeSettings,
  resolveUpdatedTaskFromMutation,
  resolveUpdatedTaskFromState,
  shouldAttemptAutoRenameWorkspaceSession,
  upsertOptimisticTaskChatTurn,
} from './workspace-session-chat-helpers'
import type { ChatImage, WorkspaceSessionChatDraftPayload, WorkspaceSessionChatProps } from './workspace-session-chat-types'
import { useTaskChatState } from './workspace-session-chat-state'
import { extractWorkspaceContextRefs, mergeTaskChatContextRefs } from './workspace-session-chat-context-refs'

type TaskChatMessageActionsParams = Pick<
  WorkspaceSessionChatProps,
  | 'agentSettings'
  | 'busy'
  | 'launchId'
  | 'mentionProjects'
  | 'onWorkspaceSessionChange'
  | 'project'
  | 'task'
  | 'workspaceId'
  | 'workspaceOwnerUserId'
  | 'workspaceRepoPath'
  | 'workspaceRoot'
  | 'workspaceSession'
  | 'workspaceSessionId'
> & {
  state: ReturnType<typeof useTaskChatState>
}

type ComposerDraftSnapshot = {
  text: string
  images: ChatImage[]
  contextRefs: ReturnType<typeof useTaskChatState>['selectedContextRefs']
}

type OptimisticTurnState = {
  turnId: string
  startedAt: string
}

const buildPreparationHint = (params: {
  requiresExecutorSelection: boolean
  requiresModelSelection: boolean
}) => {
  if (params.requiresExecutorSelection && params.requiresModelSelection) {
    return '请先选择执行节点和模型，再发送消息。'
  }

  if (params.requiresExecutorSelection) {
    return '请先选择执行节点，再发送消息。'
  }

  if (params.requiresModelSelection) {
    return '请先选择模型，再发送消息。'
  }

  return '当前会话还没准备好，请先完成底部配置后再发送。'
}

export function useTaskChatMessageActions({
  agentSettings,
  busy,
  launchId,
  mentionProjects,
  onWorkspaceSessionChange,
  project,
  state,
  task,
  workspaceId,
  workspaceOwnerUserId,
  workspaceRepoPath,
  workspaceRoot,
  workspaceSession,
  workspaceSessionId,
}: TaskChatMessageActionsParams) {
  const isReadyComposerImage = useCallback((image: Pick<ChatImage, 'uploadState'> | TaskChatAttachment) => {
    if (!('uploadState' in image)) {
      return true
    }

    return image.uploadState !== 'uploading' && image.uploadState !== 'failed'
  }, [])

  const uploadTaskAttachment = useCallback((params: {
    file: File
    fileData: string
    onProgress: (progress: number) => void
  }) => {
    return new Promise<TaskChatAttachment>((resolve, reject) => {
      const xhr = new XMLHttpRequest()
      xhr.open('POST', resolveApiUrl(`/api/tasks/${task.id}/attachments`))
      xhr.responseType = 'json'

      const headers = { 'Content-Type': 'application/json', ...getAuthHeaders() }
      for (const [key, value] of Object.entries(headers)) {
        xhr.setRequestHeader(key, value)
      }

      xhr.upload.onprogress = (event) => {
        if (!event.lengthComputable) {
          return
        }

        params.onProgress(Math.min(100, Math.max(0, Math.round((event.loaded / event.total) * 100))))
      }

      xhr.onerror = () => {
        reject(new Error(`上传附件 ${params.file.name} 失败，请检查网络后重试。`))
      }

      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          const response = xhr.response
          const result = (
            response && typeof response === 'object'
              ? response
              : JSON.parse(xhr.responseText || '{}')
          ) as Partial<TaskChatAttachment>

          if (typeof result.id === 'string' && typeof result.url === 'string') {
            params.onProgress(100)
            resolve({
              id: result.id,
              url: result.url,
              filename: typeof result.filename === 'string' ? result.filename : params.file.name,
              contentType: typeof result.contentType === 'string' ? result.contentType : params.file.type || undefined,
            })
            return
          }

          reject(new Error(`上传附件 ${params.file.name} 失败，返回结果不完整。`))
          return
        }

        const response = xhr.response
        const message = (
          response
          && typeof response === 'object'
          && 'message' in response
          && typeof response.message === 'string'
        )
          ? response.message
          : `上传附件 ${params.file.name} 失败。`
        reject(new Error(message))
      }

      xhr.send(JSON.stringify({
        file: params.fileData,
        filename: params.file.name,
        contentType: params.file.type || 'application/octet-stream',
      }))
    })
  }, [task.id])

  const navigate = useNavigate()
  const { confirm } = useAppDialog()
  const queryClient = useQueryClient()
  const writeChatSessionSnapshot = useCallback((
    snapshot: TaskChatSessionSnapshot,
    targetWorkspaceId?: string,
    targetWorkspaceSessionId?: string,
  ) => {
    queryClient.setQueryData(
      workspaceQueryKeys.chatSession(task.id, targetWorkspaceId, targetWorkspaceSessionId),
      snapshot,
    )
  }, [queryClient, task.id])
  const refreshChatSessionSnapshot = useCallback(async (
    targetWorkspaceId?: string,
    targetWorkspaceSessionId?: string,
  ) => {
    const snapshot = await api.getTaskChatSession(task.id, targetWorkspaceId, targetWorkspaceSessionId)
    if (state.isCurrentChatScope(targetWorkspaceId, targetWorkspaceSessionId)) {
      state.setChatSession((current) => resolveIncomingTaskChatSessionSnapshot(current, snapshot))
    }
    writeChatSessionSnapshot(snapshot, targetWorkspaceId, targetWorkspaceSessionId)
    return snapshot
  }, [state, task.id, writeChatSessionSnapshot])
  const shouldAutoRenameWorkspaceSession = useCallback((
    targetWorkspaceId?: string,
    targetWorkspaceSessionId?: string,
  ) => {
    const targetWorkspaceSession = state.isCurrentChatScope(targetWorkspaceId, targetWorkspaceSessionId)
      ? workspaceSession
      : null

    return shouldAttemptAutoRenameWorkspaceSession({
      onWorkspaceSessionChange,
      targetWorkspaceId,
      targetWorkspaceSessionId,
      workspaceSession: targetWorkspaceSession,
    })
  }, [onWorkspaceSessionChange, state, workspaceSession])

  const maybeAutoRenameWorkspaceSession = useCallback(async (
    message: string,
    targetWorkspaceId?: string,
    targetWorkspaceSessionId?: string,
  ) => {
    if (!shouldAutoRenameWorkspaceSession(targetWorkspaceId, targetWorkspaceSessionId)) {
      return
    }

    if (!onWorkspaceSessionChange || !targetWorkspaceId || !targetWorkspaceSessionId) {
      return
    }

    try {
      const response = await api.autoRenameWorkspaceSession(targetWorkspaceId, targetWorkspaceSessionId, {
        taskId: task.id,
        message,
      })
      const nextWorkspaceSessionId = response.workspaceSessionId ?? targetWorkspaceSessionId
      const nextTask = resolveUpdatedTaskFromState(
        response.state,
        task.id,
        targetWorkspaceId,
        nextWorkspaceSessionId,
      ) ?? task

      onWorkspaceSessionChange({
        workspaceSessionId: nextWorkspaceSessionId,
        state: response.state,
        task: nextTask,
      })
    } catch {
      // 标题自动更新失败时不打断主消息流程
    }
  }, [onWorkspaceSessionChange, shouldAutoRenameWorkspaceSession, task])

  const forceScrollToBottom = useCallback(() => {
    state.resumeAutoScroll()
    state.scrollToBottom('instant')
    window.requestAnimationFrame(() => {
      state.scrollToBottom('smooth')
    })
  }, [state])

  const clearComposerAfterSend = useCallback((sentText: string) => {
    state.rememberComposerHistory(sentText)
    state.resetComposerHistoryNavigation()
    state.setInput('')
    state.setImages([])
    state.setSelectedContextRefs([])
  }, [state])

  const restoreComposerDraft = useCallback((draft: ComposerDraftSnapshot) => {
    state.resetComposerHistoryNavigation()
    state.setInput(draft.text)
    state.setImages(draft.images)
    state.setSelectedContextRefs(draft.contextRefs)
    state.scrollToBottom()
  }, [state])

  const reportTaskChatSendError = useCallback((message: string) => {
    state.setNotices((prev) => prependNotice(prev, {
      id: crypto.randomUUID(),
      level: 'error',
      message,
    }))
    toast.error(message)
  }, [state])

  const buildCurrentRuntimeConfig = useCallback((): TaskChatMessageRuntimeConfig => {
    return {
      agentType: state.selectedAgentType,
      executionModel: state.effectiveModel || undefined,
      agentSettings: workspaceId && state.selectedAgentType !== 'OpenCode' && state.selectedAgentType !== 'Pi'
        ? state.selectedRuntimeSettings
        : undefined,
      enabledMcpServerIds: workspaceId ? normalizeMcpSelection(state.selectedMcpServerIds) : undefined,
    }
  }, [
    state.selectedAgentType,
    state.effectiveModel,
    state.selectedMcpServerIds,
    state.selectedRuntimeSettings,
    workspaceId,
  ])

  const buildRuntimeConfigFromOverrides = useCallback((runtimeOverrides?: {
    runtime: Task['agentType']
    executorNodeId?: string
    model?: string
    agentSettings?: AgentRuntimeSettings
    enabledMcpServerIds?: string[]
  }): TaskChatMessageRuntimeConfig => {
    if (!runtimeOverrides) {
      return buildCurrentRuntimeConfig()
    }

    return {
      agentType: runtimeOverrides.runtime,
      executorNodeId: workspaceId ? undefined : runtimeOverrides.executorNodeId?.trim() || undefined,
      executionModel: runtimeOverrides.model?.trim() || undefined,
      agentSettings: workspaceId && runtimeOverrides.runtime !== 'OpenCode' && runtimeOverrides.runtime !== 'Pi'
        ? runtimeOverrides.agentSettings
        : undefined,
      enabledMcpServerIds: workspaceId ? normalizeMcpSelection(runtimeOverrides.enabledMcpServerIds) : undefined,
    }
  }, [buildCurrentRuntimeConfig, workspaceId])

  const ensureExecutorVersionSupported = useCallback(async (executorId?: string) => {
    const normalizedExecutorId = executorId?.trim()
    if (!normalizedExecutorId) {
      return true
    }

    const targetExecutor = state.executorCards.find((item) => item.executor.executorId === normalizedExecutorId)
    if (!targetExecutor?.isOutdated) {
      return true
    }

    const confirmed = await confirm({
      title: '当前节点需要先升级',
      description: `${targetExecutor.executor.name} 当前运行 v${targetExecutor.executor.version || '-'}，已落后于控制面 v${CURRENT_APP_VERSION}。请先去节点管理升级节点，然后再运行。`,
      confirmText: '去节点管理',
      cancelText: '稍后',
      mobileLayout: 'bottom-sheet',
    })
    if (confirmed) {
      void navigate({
        to: '/execution',
        search: {
          createExecutor: undefined,
          editExecutorId: undefined,
          terminalExecutorId: undefined,
          workspaceId: undefined,
          teamId: undefined,
        },
      })
    }
    return false
  }, [confirm, navigate, state.executorCards])

  const submitPreparedMessage = useCallback(async (
    draft: string | WorkspaceSessionChatDraftPayload,
    targetScope?: {
      workspaceId?: string
      workspaceSessionId?: string
    },
    runtimeConfig?: TaskChatMessageRuntimeConfig,
    options?: {
      optimisticTurn?: OptimisticTurnState
    },
  ): Promise<boolean> => {
    forceScrollToBottom()

    const payload = typeof draft === 'string'
      ? {
          text: draft,
          attachments: state.images.filter(isReadyComposerImage),
          contextRefs: state.selectedContextRefs,
        }
      : {
          text: draft.text,
          attachments: (draft.attachments ?? []).filter(isReadyComposerImage),
          contextRefs: draft.contextRefs ?? state.selectedContextRefs,
        }
    const targetWorkspaceId = targetScope?.workspaceId ?? workspaceId
    const targetWorkspaceSessionId = targetScope?.workspaceSessionId ?? workspaceSessionId
    const extractedContext = extractWorkspaceContextRefs({
      input: payload.text,
      projectId: project?.id || task.projectId,
      projects: mentionProjects,
      workspaceId: targetWorkspaceId,
      workspaceSessionId: targetWorkspaceSessionId,
    })
    const combinedContextRefs = mergeTaskChatContextRefs(
      payload.contextRefs ?? [],
      extractedContext.contextRefs,
    )
    const normalizedText = extractedContext.message.trim()
    if (!normalizedText && payload.attachments.length === 0 && combinedContextRefs.length === 0) {
      return false
    }

    const targetExecutorId = runtimeConfig?.executorNodeId?.trim() || state.selectedExecutorId || undefined
    const scopedToCurrentSession = state.isCurrentChatScope(targetWorkspaceId, targetWorkspaceSessionId)
    const attachments = payload.attachments.map((image) => ({
      id: image.id,
      url: image.url,
      filename: image.filename,
      contentType: image.contentType,
    }))

    const waitingStep = state.queuePending || state.isSessionBusy ? '消息已提交，等待会话处理' : '正在提交消息'
    const setPendingRuntime = (
      status: 'thinking' | 'executing' | 'waiting',
      step: string,
    ) => {
      if (!scopedToCurrentSession) {
        return
      }

      state.markLiveSessionRevision()
      state.setLiveStatus(status)
      state.setLiveStep(step)
      state.setChatSession((current) => reconcileOptimisticWorkspaceSessionSnapshotFromTaskPart(current, {
        agentRunningStatus: status,
        currentStep: step,
        needsHumanConfirm: false,
      }))
    }

    const syncPendingRuntime = (
      status: 'thinking' | 'executing' | 'waiting',
      step: string,
    ) => {
      if (!scopedToCurrentSession) {
        return
      }

      state.syncTaskRuntime({
        agentRunningStatus: status,
        currentStep: step,
        needsHumanConfirm: false,
        updatedAt: new Date().toISOString(),
      })
    }

    const turnId = options?.optimisticTurn?.turnId ?? crypto.randomUUID()
    const optimisticTimestamp = options?.optimisticTurn?.startedAt ?? new Date().toISOString()
    let optimisticTurnApplied = false
    let previousChatSessionSnapshot: TaskChatSessionSnapshot | null = null
    const applyOptimisticTurn = () => {
      if (!scopedToCurrentSession || optimisticTurnApplied) {
        return
      }

      previousChatSessionSnapshot = state.chatSession
      state.setCurrentRunTiming({
        turnId,
        startedAt: optimisticTimestamp,
      })
      state.setTimeline((prev) => upsertOptimisticTaskChatTurn(prev, {
        turnId,
        text: normalizedText,
        status: 'thinking',
        step: waitingStep,
        ts: optimisticTimestamp,
        attachments,
      }))
      setPendingRuntime('thinking', waitingStep)
      optimisticTurnApplied = true
    }

    const restorePendingRuntime = () => {
      if (!scopedToCurrentSession) {
        return
      }

      state.setLiveStatus(task.agentRunningStatus)
      state.setLiveStep(task.currentStep)
      state.syncTaskRuntime({
        agentRunningStatus: task.agentRunningStatus,
        currentStep: task.currentStep,
        needsHumanConfirm: Boolean(task.needsHumanConfirm),
        updatedAt: new Date().toISOString(),
      })
    }

    const rollbackOptimisticTurn = () => {
      if (!scopedToCurrentSession || !optimisticTurnApplied) {
        return
      }

      state.setTimeline((prev) => removeTaskChatTurnEvents(prev, turnId))
      state.setChatSession((current) => restoreWorkspaceSessionSnapshotRuntime(current, previousChatSessionSnapshot))
      restorePendingRuntime()
    }

    applyOptimisticTurn()

    if (!(await ensureExecutorVersionSupported(targetExecutorId))) {
      rollbackOptimisticTurn()
      return false
    }

    const missingRequiredExecutor = state.requiresExecutorSelection && !targetExecutorId
    const missingRequiredModel = state.requiresModelSelection
      && !(runtimeConfig?.executionModel?.trim() || state.effectiveModel)
    if (missingRequiredModel || missingRequiredExecutor) {
      rollbackOptimisticTurn()
      throw new Error(buildPreparationHint({
        requiresExecutorSelection: missingRequiredExecutor,
        requiresModelSelection: missingRequiredModel,
      }))
    }

    const useQueueFallback = !scopedToCurrentSession || !state.isSocketOpen
    if (useQueueFallback) {
      try {
        if (!scopedToCurrentSession && !targetWorkspaceId) {
          throw new Error('缺少工作区上下文，无法把消息发送到目标会话。')
        }

        if (!scopedToCurrentSession && !targetWorkspaceSessionId) {
          throw new Error('目标工作区会话不存在，无法发送消息。')
        }

        if (!scopedToCurrentSession && targetWorkspaceId && targetWorkspaceSessionId) {
          const queued = await api.enqueueTaskChatMessage(
            task.id,
            normalizedText,
            targetWorkspaceId,
            targetWorkspaceSessionId,
            attachments,
            combinedContextRefs,
            runtimeConfig,
          )
          state.setNotices((prev) => prependNotice(prev, {
            id: crypto.randomUUID(),
            level: 'info',
            message: queued.message || '委派消息已进入独立工作区会话队列。',
          }))
          writeChatSessionSnapshot(queued.snapshot, targetWorkspaceId, targetWorkspaceSessionId)
          void maybeAutoRenameWorkspaceSession(normalizedText, targetWorkspaceId, targetWorkspaceSessionId)
          return true
        }

        const queued = await api.enqueueTaskChatMessage(
          task.id,
          normalizedText,
          targetWorkspaceId,
          targetWorkspaceSessionId,
          attachments,
          combinedContextRefs,
          runtimeConfig,
        )
        rollbackOptimisticTurn()
        state.setChatSession(queued.snapshot)
        writeChatSessionSnapshot(queued.snapshot, targetWorkspaceId, targetWorkspaceSessionId)
        forceScrollToBottom()
        state.setNotices((prev) => prependNotice(prev, {
          id: crypto.randomUUID(),
          level: 'info',
          message: queued.message || '实时连接暂不可用，已通过备用通道加入消息队列。',
        }))
        void maybeAutoRenameWorkspaceSession(normalizedText, targetWorkspaceId, targetWorkspaceSessionId)
        return true
      } catch (error) {
        rollbackOptimisticTurn()
        throw error
      }
    }

    const requestId = crypto.randomUUID()
    let ack: Awaited<ReturnType<typeof state.sendSocketMessageWithAck>>
    try {
      ack = await state.sendSocketMessageWithAck({
        type: 'task_chat.send',
        requestId,
        message: normalizedText,
        attachments,
        contextRefs: combinedContextRefs,
        runtimeConfig,
        launchId: launchId || undefined,
        turnId,
      })
    } catch (error) {
      if (!isTaskChatSocketNotReadyError(error)) {
        rollbackOptimisticTurn()
        throw error
      }

      try {
        const queued = await api.enqueueTaskChatMessage(
          task.id,
          normalizedText,
          targetWorkspaceId,
          targetWorkspaceSessionId,
          attachments,
          combinedContextRefs,
          runtimeConfig,
        )
        rollbackOptimisticTurn()
        state.setChatSession(queued.snapshot)
        writeChatSessionSnapshot(queued.snapshot, targetWorkspaceId, targetWorkspaceSessionId)
        forceScrollToBottom()
        state.setNotices((prev) => prependNotice(prev, {
          id: crypto.randomUUID(),
          level: 'info',
          message: queued.message || '实时连接暂不可用，已通过备用通道加入消息队列。',
        }))
        void maybeAutoRenameWorkspaceSession(normalizedText, targetWorkspaceId, targetWorkspaceSessionId)
        return true
      } catch (fallbackError) {
        rollbackOptimisticTurn()
        throw fallbackError
      }
    }
    if (ack.status !== 'accepted' && ack.status !== 'queued' && ack.status !== 'noop') {
      rollbackOptimisticTurn()
      throw new Error(ack.message || '消息发送失败，请稍后重试。')
    }

    const ackMessage = ack.message
    if ((ack.status === 'queued' || ack.status === 'noop') && ackMessage) {
      state.setNotices((prev) => prependNotice(prev, {
        id: crypto.randomUUID(),
        level: 'info',
        message: ackMessage,
      }))
    }

    if (ack.status === 'noop') {
      rollbackOptimisticTurn()
      forceScrollToBottom()
      return true
    }

    if (ack.status === 'queued') {
      rollbackOptimisticTurn()
      try {
        await refreshChatSessionSnapshot(targetWorkspaceId, targetWorkspaceSessionId)
      } catch (error) {
        console.warn('[workspace-session-chat] queued snapshot refresh failed', error)
      }
      forceScrollToBottom()
      void maybeAutoRenameWorkspaceSession(normalizedText, targetWorkspaceId, targetWorkspaceSessionId)
      return true
    }

    syncPendingRuntime('thinking', waitingStep)
    forceScrollToBottom()
    void maybeAutoRenameWorkspaceSession(normalizedText, targetWorkspaceId, targetWorkspaceSessionId)
    return true
  }, [
    ensureExecutorVersionSupported,
    forceScrollToBottom,
    launchId,
    mentionProjects,
    maybeAutoRenameWorkspaceSession,
    project?.id,
    state,
    task.agentRunningStatus,
    task.currentStep,
    task.id,
    task.needsHumanConfirm,
    refreshChatSessionSnapshot,
    writeChatSessionSnapshot,
    workspaceId,
    workspaceSessionId,
  ])

  const dispatchAgentScopedMessage = useCallback(async (
    agent: NonNullable<ReturnType<typeof useTaskChatState>['selectedDelegateAgent']>,
    mode: 'mention' | 'delegate',
    rawMessage: string,
    runtimeOverrides?: {
      runtime: Task['agentType']
      executorNodeId?: string
      model?: string
      agentSettings?: AgentRuntimeSettings
      enabledMcpServerIds?: string[]
    },
  ): Promise<boolean> => {
    const profile = parseCustomAgentProfile(agent)
    const preferredRuntime = runtimeOverrides?.runtime ?? profile.preferredRuntime
    const desiredRuntime = resolveAgentTypeForRuntimeId(preferredRuntime)
    if (!desiredRuntime) {
      toast.error(`${getRuntimeDescriptor(preferredRuntime).label} 还没有接入当前 Wemux worker，暂时不能调用这个 Agent。`)
      return false
    }
    const preferredModel = profile.preferredModel.trim()
    const desiredModel = runtimeOverrides?.model ?? (preferredModel || state.selectedModel || state.defaultModel)
    const desiredRuntimeSettings = runtimeOverrides?.agentSettings
      ?? (desiredRuntime === state.selectedAgentType
        ? state.selectedRuntimeSettings
        : resolveTaskChatRuntimeSettings(desiredRuntime, agentSettings))
    const desiredMcpServerIds = normalizeMcpSelection(runtimeOverrides?.enabledMcpServerIds ?? state.selectedMcpServerIds)
    const desiredExecutorId = runtimeOverrides?.executorNodeId?.trim() || state.selectedExecutorId || undefined
    const runtimeMutationExecutorId = workspaceId ? undefined : desiredExecutorId
    if (!(await ensureExecutorVersionSupported(desiredExecutorId))) {
      return false
    }
    const fallbackWorkingDirectoryMode = (task as Task & { workingDirectoryMode?: WorkingDirectoryMode }).workingDirectoryMode
    const delegateSessionMode = resolveDefaultDelegateSessionMode(agent)
    const delegateBaseBranch = resolveDefaultDelegateBaseBranch(agent, {
      task,
      projectDefaultBranch: project?.defaultBranch,
    })
    const delegateWorkingDirectoryMode = resolveDefaultDelegateWorkingDirectoryMode(agent, fallbackWorkingDirectoryMode)
    const shouldOpenPreflight = !runtimeOverrides && (
      desiredRuntime !== state.selectedAgentType
      || (!!desiredModel && desiredModel !== (state.selectedModel || state.defaultModel))
      || state.requiresExecutorSelection
      || state.requiresModelSelection
    )

    if (shouldOpenPreflight) {
      toast.error(buildPreparationHint({
        requiresExecutorSelection: state.requiresExecutorSelection,
        requiresModelSelection: state.requiresModelSelection || !desiredModel,
      }))
      return false
    }

    let targetWorkspaceId = workspaceId
    let targetWorkspaceSessionId = workspaceSessionId
    let latestState: AppState | null = null
    let runtimeSettingsApplied = false
    let mcpSettingsApplied = false
    const currentWorkspaceSessionId = workspaceSessionId || state.chatSession?.scope.workspaceSessionId
    const shouldReuseCurrentSession = mode === 'delegate'
      && delegateSessionMode === 'reuse-current'
      && Boolean(workspaceId && currentWorkspaceSessionId)

    if (mode === 'delegate' && workspaceId) {
      const response = await api.bindTaskWorkspace(task.id, workspaceId, {
        baseBranch: delegateBaseBranch,
        workingDirectoryMode: delegateWorkingDirectoryMode,
        workspaceSessionId: currentWorkspaceSessionId,
        createNewSession: !shouldReuseCurrentSession,
        customAgentId: agent.id,
        customAgentName: agent.name,
        agentInvocationMode: 'delegate',
        sessionKind: shouldReuseCurrentSession ? undefined : 'subagent',
        sessionRole: shouldReuseCurrentSession ? undefined : state.delegateSessionRole,
        parentSessionId: shouldReuseCurrentSession ? undefined : currentWorkspaceSessionId,
        rootSessionId: shouldReuseCurrentSession ? undefined : (state.chatSession?.runtime.rootSessionId ?? currentWorkspaceSessionId),
        delegatedPrompt: rawMessage,
      })
      latestState = response.state
      targetWorkspaceSessionId = response.workspaceSessionId ?? response.workspaceSession?.id
      if (!targetWorkspaceSessionId) {
        throw new Error('委派会话创建成功，但未返回会话 ID。')
      }

      state.syncScopedTaskFromState(response.state, targetWorkspaceSessionId)

      const boundTask = resolveUpdatedTaskFromState(response.state, task.id, workspaceId, targetWorkspaceSessionId)
      if (!boundTask) {
        throw new Error('委派会话创建成功，但未找到目标会话任务。')
      }

      let effectiveTask = boundTask
      if (desiredRuntime !== boundTask.agentType) {
        const runtimeResponse = await api.updateTaskAgent(
          task.id,
          desiredRuntime,
          runtimeMutationExecutorId,
          targetWorkspaceId,
          targetWorkspaceSessionId,
        )
        const runtimeTask = resolveUpdatedTaskFromMutation(runtimeResponse.task, runtimeResponse.workspaceSession)
        state.setSelectedAgentType(runtimeTask.agentType)
        state.setPreflightAgentType(runtimeTask.agentType)
        state.setSelectedModel(runtimeTask.executionModel ?? '')
        state.setPreflightModel(runtimeTask.executionModel ?? '')
        effectiveTask = runtimeTask
      }

      const nextModel = desiredModel || undefined
      if ((nextModel ?? '') !== (effectiveTask.executionModel ?? '')) {
        const modelResponse = await api.updateTaskModel(
          task.id,
          nextModel,
          runtimeMutationExecutorId,
          targetWorkspaceId,
          targetWorkspaceSessionId,
        )
        latestState = modelResponse.state
        state.syncScopedTaskFromState(modelResponse.state, targetWorkspaceSessionId)
      }

      if (targetWorkspaceId && desiredRuntime !== 'OpenCode') {
        const runtimeSettingsResponse = await api.updateTaskAgentSettings(
          task.id,
          desiredRuntime,
          desiredRuntimeSettings,
          runtimeMutationExecutorId,
          targetWorkspaceId,
          targetWorkspaceSessionId,
        )
        latestState = runtimeSettingsResponse.state
        state.syncScopedTaskFromState(runtimeSettingsResponse.state, targetWorkspaceSessionId)
        runtimeSettingsApplied = true
      }

      if (targetWorkspaceId && targetWorkspaceSessionId) {
        const mcpSettingsResponse = await api.updateTaskMcpSettings(
          task.id,
          desiredMcpServerIds,
          targetWorkspaceId,
          targetWorkspaceSessionId,
        )
        latestState = mcpSettingsResponse.state
        state.syncScopedTaskFromState(mcpSettingsResponse.state, targetWorkspaceSessionId)
        mcpSettingsApplied = true
      }
    } else if (mode === 'delegate' && !workspaceId) {
      state.setNotices((prev) => prependNotice(prev, {
        id: crypto.randomUUID(),
        level: 'warning',
        message: '当前不在工作区上下文，暂时回退为在当前会话内执行委派提示。',
      }))
    }

    if (!runtimeSettingsApplied && targetWorkspaceId && desiredRuntime !== 'OpenCode') {
      const runtimeSettingsResponse = await api.updateTaskAgentSettings(
        task.id,
        desiredRuntime,
        desiredRuntimeSettings,
        runtimeMutationExecutorId,
        targetWorkspaceId,
        targetWorkspaceSessionId,
      )
      latestState = runtimeSettingsResponse.state
      state.syncScopedTaskFromState(runtimeSettingsResponse.state, targetWorkspaceSessionId)
    }

    if (!mcpSettingsApplied && targetWorkspaceId && targetWorkspaceSessionId) {
      const mcpSettingsResponse = await api.updateTaskMcpSettings(
        task.id,
        desiredMcpServerIds,
        targetWorkspaceId,
        targetWorkspaceSessionId,
      )
      latestState = mcpSettingsResponse.state
      state.syncScopedTaskFromState(mcpSettingsResponse.state, targetWorkspaceSessionId)
    }

    const nextWorkspaceSession = targetWorkspaceSessionId
      ? (latestState ?? null)?.workspaceSessions.find((item) => item.id === targetWorkspaceSessionId) ?? null
      : null
    const delegateMessage = mode === 'delegate' && !shouldReuseCurrentSession
      ? buildSubagentDelegatePrompt({
        role: state.delegateSessionRole,
        task,
        message: rawMessage,
        environment: resolveSubagentEnvironmentContext({
          project,
          session: nextWorkspaceSession ?? undefined,
          workspaceOwnerUserId,
          workspaceRoot,
          workspaceRepoPath,
        }),
      })
      : rawMessage
    const compiledMessage = buildAgentPromptEnvelope({
      agent,
      profile,
      mode,
      task,
      message: delegateMessage,
      workspaceId: targetWorkspaceId,
      workspaceSessionId: targetWorkspaceSessionId,
    })
    const testerMessage = state.maybeInjectTesterLogContext(compiledMessage, {
      testerSession: mode === 'delegate' && state.delegateSessionRole === 'tester',
      logs: state.unseenTesterSystemLogs,
      observations: state.unseenTesterObservationMessages,
    })

    const sent = await submitPreparedMessage(testerMessage.message, {
      workspaceId: targetWorkspaceId,
      workspaceSessionId: targetWorkspaceSessionId,
    }, buildRuntimeConfigFromOverrides({
      runtime: desiredRuntime,
      executorNodeId: runtimeMutationExecutorId,
      model: desiredModel || undefined,
      agentSettings: desiredRuntimeSettings,
      enabledMcpServerIds: desiredMcpServerIds,
    }))
    if (!sent) {
      return false
    }
    state.markTesterContextInjected({
      logs: testerMessage.injectedLogs,
      observations: testerMessage.injectedObservations,
    })
    return true
  }, [agentSettings, ensureExecutorVersionSupported, project, state, submitPreparedMessage, task, workspaceId, workspaceOwnerUserId, workspaceRepoPath, workspaceRoot, workspaceSessionId])

  const handleSend = useCallback(async () => {
    const text = state.input.trim()
    const hasReadyImages = state.images.some((image) => image.uploadState !== 'uploading' && image.uploadState !== 'failed')
    if (!text && !hasReadyImages) {
      return
    }

    if (state.isSendingMessage || state.sendDisabled) {
      return
    }

    forceScrollToBottom()

    state.setIsSendingMessage(true)

    const firstMention = state.mentionedAgents[0]
    if (firstMention) {
      try {
        const sent = await dispatchAgentScopedMessage(firstMention.agent, 'mention', text)
        if (sent) {
          clearComposerAfterSend(text)
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Agent 调用失败'
        reportTaskChatSendError(message)
      } finally {
        state.setIsSendingMessage(false)
      }
      return
    }

    const draftSnapshot = {
      text,
      images: state.images,
      contextRefs: state.selectedContextRefs,
    }

    try {
      const testerMessage = state.maybeInjectTesterLogContext(text, {
        testerSession: state.isTesterSubagentSession,
        logs: state.unseenTesterSystemLogs,
        observations: state.unseenTesterObservationMessages,
      })
      const readyImages = state.images.filter(isReadyComposerImage)
      const sent = await submitPreparedMessage({
        text: testerMessage.message,
        attachments: readyImages,
        contextRefs: draftSnapshot.contextRefs,
      }, undefined, buildCurrentRuntimeConfig(), {
        optimisticTurn: {
          turnId: crypto.randomUUID(),
          startedAt: new Date().toISOString(),
        },
      })
      if (!sent) {
        restoreComposerDraft(draftSnapshot)
        reportTaskChatSendError('消息未发送，请检查当前会话状态后重试。')
        return
      }
      clearComposerAfterSend(text)
      state.markTesterContextInjected({
        logs: testerMessage.injectedLogs,
        observations: testerMessage.injectedObservations,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : '消息发送失败'
      restoreComposerDraft(draftSnapshot)
      reportTaskChatSendError(message)
    } finally {
      state.setIsSendingMessage(false)
    }
  }, [buildCurrentRuntimeConfig, clearComposerAfterSend, dispatchAgentScopedMessage, ensureExecutorVersionSupported, forceScrollToBottom, isReadyComposerImage, reportTaskChatSendError, restoreComposerDraft, state, submitPreparedMessage])

  const handleImageUpload = useCallback(async (files: File[]) => {
    if (files.length === 0 || busy || state.isUploading) {
      return
    }

    state.setIsUploading(true)
    try {
      for (const file of files) {
        const draftId = crypto.randomUUID()
        const previewUrl = file.type.startsWith('image/') ? URL.createObjectURL(file) : undefined
        const draftImage: ChatImage = {
          id: draftId,
          url: previewUrl || '',
          previewUrl,
          filename: file.name,
          contentType: file.type || undefined,
          uploadState: 'uploading',
          uploadProgress: 0,
        }
        state.setImages((prev) => [...prev, draftImage])

        const reader = new FileReader()
        try {
          const base64 = await new Promise<string>((resolve, reject) => {
            reader.onload = () => resolve(reader.result as string)
            reader.onerror = reject
            reader.readAsDataURL(file)
          })

          const result = await uploadTaskAttachment({
            file,
            fileData: base64,
            onProgress: (progress) => {
              state.setImages((prev) => prev.map((image) => image.id === draftId
                ? { ...image, uploadProgress: progress }
                : image))
            },
          })

          state.setImages((prev) => prev.map((image) => image.id === draftId
            ? {
                id: result.id,
                url: result.url,
                filename: result.filename,
                contentType: result.contentType,
                uploadProgress: 100,
              }
            : image))
          if (previewUrl) {
            URL.revokeObjectURL(previewUrl)
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : `上传附件 ${file.name} 失败。`
          state.setImages((prev) => prev.map((image) => image.id === draftId
            ? {
                ...image,
                uploadState: 'failed',
                uploadError: message,
              }
            : image))
          toast.error(message)
        }
      }
    } finally {
      state.setIsUploading(false)
    }
  }, [busy, state, uploadTaskAttachment])

  const handleRemoveImage = useCallback((id: string) => {
    state.setImages((prev) => {
      const image = prev.find((item) => item.id === id)
      const objectUrl = image?.previewUrl || (image?.url.startsWith('blob:') ? image.url : '')
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl)
      }

      return prev.filter((item) => item.id !== id)
    })
  }, [state])

  const handleStop = useCallback(async () => {
    const markStoppedLocally = () => {
      state.markLiveSessionRevision()
      state.setLiveStatus('idle')
      state.setLiveStep('已停止')
      state.setLiveTools([])
      state.setChatSession((current) => reconcileOptimisticWorkspaceSessionSnapshotFromTaskPart(current, {
        agentRunningStatus: 'idle',
        currentStep: '已停止',
        needsHumanConfirm: false,
      }))
      state.syncTaskRuntime({
        agentRunningStatus: 'idle',
        currentStep: '已停止',
        needsHumanConfirm: false,
        toolCalls: [],
        updatedAt: new Date().toISOString(),
      })
    }

    if (state.isSocketOpen) {
      try {
        const ack = await state.sendSocketMessageWithAck({
          type: 'task_chat.stop',
          requestId: crypto.randomUUID(),
        })

        if (ack.status === 'accepted' || ack.status === 'noop') {
          markStoppedLocally()
        }
        const message = ack.message?.trim()
        state.setNotices((prev) => prependNotice(prev, {
          id: crypto.randomUUID(),
          level: 'info',
          message: message || (ack.status === 'accepted'
            ? '已发送停止指令，等待执行器响应。'
            : '当前没有可停止的回复。'),
        }))
        return
      } catch (error) {
        if (!isTaskChatSocketNotReadyError(error)) {
          console.warn('[workspace-session-chat] stop websocket fallback', error)
        }
      }
    }

    try {
      const snapshot = await api.stopTaskChat(task.id, workspaceId, workspaceSessionId)
      state.setChatSession(snapshot)
      markStoppedLocally()
      writeChatSessionSnapshot(snapshot, workspaceId, workspaceSessionId)
      state.setNotices((prev) => prependNotice(prev, {
        id: crypto.randomUUID(),
        level: 'info',
        message: state.isSocketOpen
          ? '实时连接暂不可用，已通过备用通道发送停止指令。'
          : '实时连接已断开，已通过备用通道发送停止指令。',
      }))
    } catch (error) {
      const message = error instanceof Error ? error.message : '停止任务对话失败'
      state.setNotices((prev) => prependNotice(prev, {
        id: crypto.randomUUID(),
        level: 'error',
        message,
      }))
      toast.error(message)
      return
    }
  }, [state, task.id, workspaceId, workspaceSessionId, writeChatSessionSnapshot])

  const handleRemoveQueuedMessage = useCallback(async (queueId: string) => {
    const removeQueuedMessageViaHttp = async (noticeMessage: string) => {
      try {
        const snapshot = await api.removeTaskChatQueueMessage(task.id, queueId, workspaceId, workspaceSessionId)
        state.setChatSession(snapshot)
        writeChatSessionSnapshot(snapshot, workspaceId, workspaceSessionId)
        state.setNotices((prev) => prependNotice(prev, {
          id: crypto.randomUUID(),
          level: 'info',
          message: noticeMessage,
        }))
      } catch (error) {
        const message = error instanceof Error ? error.message : '移除排队消息失败'
        state.setNotices((prev) => prependNotice(prev, {
          id: crypto.randomUUID(),
          level: 'error',
          message,
        }))
        toast.error(message)
      }
    }

    if (!state.isSocketOpen) {
      await removeQueuedMessageViaHttp('实时连接暂不可用，已通过备用通道移除排队消息。')
      return
    }

    try {
      await state.sendSocketMessageWithAck({
        type: 'task_chat.queue.remove',
        requestId: crypto.randomUUID(),
        queueId,
      })
    } catch (error) {
      if (!isTaskChatSocketNotReadyError(error)) {
        console.warn('[workspace-session-chat] remove queued message websocket fallback', error)
      }
      await removeQueuedMessageViaHttp('实时移除未确认，已通过备用通道移除排队消息。')
    }
  }, [state, task.id, workspaceId, workspaceSessionId, writeChatSessionSnapshot])

  return {
    dispatchAgentScopedMessage,
    handleImageUpload,
    handleRemoveImage,
    handleRemoveQueuedMessage,
    handleSend,
    handleStop,
    submitPreparedMessage,
  }
}
