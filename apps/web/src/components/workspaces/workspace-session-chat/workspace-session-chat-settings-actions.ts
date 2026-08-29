// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
// INPUT: workspace-session runtime selections and persistence callbacks
// OUTPUT: guarded async actions for executor, agent, model, runtime, MCP, and preflight changes
// POS: persistence/action boundary for workspace session chat settings

import { useCallback } from 'react'
import { isManagedCloudAutoExecutorId } from '@shared/managed-cloud'
import { toast } from 'sonner'
import type { TaskChatMessageRuntimeConfig } from '@shared/task-chat-session'
import type { AgentRuntimeSettings, Task } from '@shared/types'
import { api } from '../../../lib/api'
import { resolveDefaultDelegatePrompt } from '../../../lib/custom-agent/delegate-runtime'
import {
  readWorkspaceCreateRuntimePreference,
  writeWorkspaceCreateRuntimePreference,
} from '../../../lib/workspace-create-preferences'
import {
  getTaskScopedAgentSettings,
  getTaskScopedEnabledMcpServerIds,
  prependNotice,
  resolveTaskChatMcpServerSelection,
  resolveTaskChatRuntimeSettings,
  resolveUpdatedTaskFromMutation,
} from './workspace-session-chat-helpers'
import type { WorkspaceSessionChatProps } from './workspace-session-chat-types'
import { useTaskChatState } from './workspace-session-chat-state'

type TaskChatSettingsActionsParams = Pick<
  WorkspaceSessionChatProps,
  | 'agentSettings'
  | 'busy'
  | 'onAssignExecutor'
  | 'task'
  | 'workspaceId'
  | 'workspaceWorkingDirectoryMode'
  | 'workspaceSessionId'
> & {
  dispatchAgentScopedMessage: (
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
  ) => Promise<boolean>
  state: ReturnType<typeof useTaskChatState>
  submitPreparedMessage: (
    text: string,
    targetScope?: {
      workspaceId?: string
      workspaceSessionId?: string
    },
    runtimeConfig?: TaskChatMessageRuntimeConfig,
  ) => Promise<boolean>
}

export function useTaskChatSettingsActions({
  agentSettings,
  busy,
  dispatchAgentScopedMessage,
  onAssignExecutor,
  state,
  submitPreparedMessage,
  task,
  workspaceId,
  workspaceWorkingDirectoryMode,
  workspaceSessionId,
}: TaskChatSettingsActionsParams) {
  const shouldDeferRuntimeConfigPersistence = busy || state.isSessionBusy || state.queuePending

  const handleExecutorChange = useCallback(async (nextExecutorId: string) => {
    const normalizedExecutorId = nextExecutorId.trim()
    if (!normalizedExecutorId) {
      return
    }

    const virtualManagedCloudSelection = isManagedCloudAutoExecutorId(normalizedExecutorId)

    state.setExecutorMenuOpen(false)
    if (!virtualManagedCloudSelection) {
      state.setSelectedExecutorId(normalizedExecutorId)
      state.setPreflightExecutorId(normalizedExecutorId)
    }

    console.info('[workspace-session-chat][executor-switch][ui-select]', {
      taskId: task.id,
      workspaceId,
      workspaceSessionId,
      selectedExecutorId: normalizedExecutorId,
      persistedExecutorId: state.persistedExecutorId,
      currentEffectiveExecutorId: state.effectiveExecutorId,
      shouldDeferRuntimeConfigPersistence,
      isSessionBusy: state.isSessionBusy,
      queuePending: state.queuePending,
      agentSaving: state.agentSaving,
      modelSaving: state.modelSaving,
      runtimeSettingsSaving: state.runtimeSettingsSaving,
      mcpSettingsSaving: state.mcpSettingsSaving,
    })

    if (
      !workspaceId
      || state.agentSaving
      || state.executorSaving
      || state.modelSaving
      || state.runtimeSettingsSaving
      || state.mcpSettingsSaving
      || (normalizedExecutorId === state.persistedExecutorId && !virtualManagedCloudSelection)
    ) {
      console.info('[workspace-session-chat][executor-switch][ui-skip]', {
        taskId: task.id,
        workspaceId,
        workspaceSessionId,
        selectedExecutorId: normalizedExecutorId,
        persistedExecutorId: state.persistedExecutorId,
        workspaceMissing: !workspaceId,
        deferred: false,
        agentSaving: state.agentSaving,
        executorSaving: state.executorSaving,
        modelSaving: state.modelSaving,
        runtimeSettingsSaving: state.runtimeSettingsSaving,
        mcpSettingsSaving: state.mcpSettingsSaving,
        sameAsPersisted: normalizedExecutorId === state.persistedExecutorId && !virtualManagedCloudSelection,
      })
      return
    }

    state.setExecutorSaving(true)
    try {
      const resolvedExecutorId = await onAssignExecutor(task.id, normalizedExecutorId, workspaceId, workspaceSessionId)
      const nextSelectedExecutorId = resolvedExecutorId?.trim()
      console.info('[workspace-session-chat][executor-switch][ui-resolved]', {
        taskId: task.id,
        workspaceId,
        workspaceSessionId,
        requestedExecutorId: normalizedExecutorId,
        resolvedExecutorId: nextSelectedExecutorId,
      })
      if (nextSelectedExecutorId) {
        state.setSelectedExecutorId(nextSelectedExecutorId)
        state.setPreflightExecutorId(nextSelectedExecutorId)
        return
      }

      state.setSelectedExecutorId(state.persistedExecutorId)
      state.setPreflightExecutorId(state.persistedExecutorId)
    } finally {
      state.setExecutorSaving(false)
    }
  }, [onAssignExecutor, shouldDeferRuntimeConfigPersistence, state, task.id, workspaceId, workspaceSessionId])

  const handleRuntimeSettingsChange = useCallback(async (nextSettings: AgentRuntimeSettings) => {
    if (!workspaceId || state.agentSaving || state.modelSaving || state.runtimeSettingsSaving) {
      return
    }

    const previousSettings = state.selectedRuntimeSettings
    state.setSelectedRuntimeSettings(nextSettings)
    state.setPreflightRuntimeSettings(nextSettings)

    if (shouldDeferRuntimeConfigPersistence) {
      return
    }

    state.setRuntimeSettingsSaving(true)

    try {
      const response = await api.updateTaskAgentSettingsCompact(
        task.id,
        state.selectedAgentType,
        nextSettings,
        undefined,
        workspaceId,
        workspaceSessionId,
      )
      const updatedTask = resolveUpdatedTaskFromMutation(response.task, response.workspaceSession)
      if (updatedTask) {
        const nextRuntimeSettings = resolveTaskChatRuntimeSettings(
          updatedTask.agentType,
          agentSettings,
          getTaskScopedAgentSettings(updatedTask),
        )
        state.setSelectedRuntimeSettings(nextRuntimeSettings)
        state.setPreflightRuntimeSettings(nextRuntimeSettings)
      }
    } catch (error) {
      state.setSelectedRuntimeSettings(previousSettings)
      state.setPreflightRuntimeSettings(previousSettings)
      const message = error instanceof Error ? error.message : '保存运行参数失败'
      state.setNotices((prev) => prependNotice(prev, {
        id: crypto.randomUUID(),
        level: 'error',
        message,
      }))
      toast.error(message)
    } finally {
      state.setRuntimeSettingsSaving(false)
    }
  }, [agentSettings, shouldDeferRuntimeConfigPersistence, state, task.id, workspaceId, workspaceSessionId])

  const handleMcpSettingsChange = useCallback(async (nextSelectedIds: string[]) => {
    if (
      !workspaceId
      || state.agentSaving
      || state.modelSaving
      || state.runtimeSettingsSaving
      || state.mcpSettingsSaving
    ) {
      return
    }

    const normalizedIds = resolveTaskChatMcpServerSelection(state.availableMcpServers, nextSelectedIds)
    const previousIds = state.selectedMcpServerIds
    state.setSelectedMcpServerIds(normalizedIds)
    state.setPreflightMcpServerIds(normalizedIds)
    state.syncLocalMountedMcpServerNames(normalizedIds)

    if (shouldDeferRuntimeConfigPersistence) {
      return
    }

    state.setMcpSettingsSaving(true)

    try {
      const response = await api.updateTaskMcpSettingsCompact(task.id, normalizedIds, workspaceId, workspaceSessionId)
      const updatedTask = resolveUpdatedTaskFromMutation(response.task, response.workspaceSession)
      if (updatedTask) {
        const nextSelected = resolveTaskChatMcpServerSelection(
          state.availableMcpServers,
          getTaskScopedEnabledMcpServerIds(updatedTask),
        )
        state.setSelectedMcpServerIds(nextSelected)
        state.setPreflightMcpServerIds(nextSelected)
        state.syncLocalMountedMcpServerNames(nextSelected)
      }
    } catch (error) {
      state.setSelectedMcpServerIds(previousIds)
      state.setPreflightMcpServerIds(previousIds)
      state.syncLocalMountedMcpServerNames(previousIds)
      const message = error instanceof Error ? error.message : '保存 MCP 设置失败'
      state.setNotices((prev) => prependNotice(prev, {
        id: crypto.randomUUID(),
        level: 'error',
        message,
      }))
      toast.error(message)
    } finally {
      state.setMcpSettingsSaving(false)
    }
  }, [shouldDeferRuntimeConfigPersistence, state, task.id, workspaceId, workspaceSessionId])

  const handleModelChange = useCallback(async (nextModel: string) => {
    if (state.modelSaving || state.agentSaving) {
      return
    }

    // The model selection targets the NEXT message, so we always persist it immediately —
    // even while a turn is running. That turn already captured its model at dispatch time
    // (it flows through runtimeConfig/RPC), and persisting session.executionModel does not
    // bump runtimeSequence, so the running turn's completion is unaffected. Persisting now
    // keeps session.executionModel the single source of truth and makes the choice survive
    // navigation/remount without any client-side shadow state.
    const previousModel = state.selectedModel
    if (nextModel === previousModel) {
      state.setModelMenuOpen(false)
      return
    }

    state.setSelectedModel(nextModel)
    state.setModelMenuOpen(false)
    state.setModelSaving(true)

    try {
      const response = await api.updateTaskModelCompact(
        task.id,
        nextModel || undefined,
        workspaceId ? undefined : state.effectiveExecutorId,
        workspaceId,
        workspaceSessionId,
      )
      const updatedTask = resolveUpdatedTaskFromMutation(response.task, response.workspaceSession)
      if (updatedTask) {
        const savedModel = updatedTask.executionModel ?? ''
        state.setSelectedModel(savedModel)
        state.rememberWorkspaceSessionModelMenuSelection(savedModel || nextModel)
      } else {
        state.rememberWorkspaceSessionModelMenuSelection(nextModel)
      }
    } catch (error) {
      state.setSelectedModel(previousModel)
      const message = error instanceof Error ? error.message : '切换模型失败'
      state.setNotices((prev) => prependNotice(prev, {
        id: crypto.randomUUID(),
        level: 'error',
        message,
      }))
      toast.error(message)
    } finally {
      state.setModelSaving(false)
    }
  }, [state, task.id, workspaceId, workspaceSessionId])

  const handleAgentChange = useCallback(async (nextAgentType: Task['agentType']) => {
    if (state.agentSaving || state.modelSaving || nextAgentType === state.selectedAgentType) {
      return
    }

    const previousAgentType = state.selectedAgentType
    const previousModel = state.selectedModel
    const previousModelOptions = state.modelOptions
    const previousDefaultModel = state.defaultModel
    const previousSettings = state.selectedRuntimeSettings
    const nextSettings = resolveTaskChatRuntimeSettings(nextAgentType, agentSettings)
    state.setSelectedAgentType(nextAgentType)
    state.setPreflightAgentType(nextAgentType)
    state.setSelectedModel('')
    state.setPreflightModel('')
    state.setSelectedRuntimeSettings(nextSettings)
    state.setPreflightRuntimeSettings(nextSettings)
    state.setModelOptions([])
    state.setDefaultModel('')
    state.setAgentMenuOpen(false)
    state.setModelMenuOpen(false)

    const rememberWorkspaceRuntimeAgent = (agentType: Task['agentType']) => {
      const currentPreference = readWorkspaceCreateRuntimePreference(task.projectId)
      writeWorkspaceCreateRuntimePreference(task.projectId, {
        ...currentPreference,
        agentType,
        workingDirectoryMode: workspaceWorkingDirectoryMode ?? currentPreference.workingDirectoryMode,
      })
    }

    if (shouldDeferRuntimeConfigPersistence) {
      rememberWorkspaceRuntimeAgent(nextAgentType)
      return
    }

    state.setAgentSaving(true)

    try {
      const response = await api.updateTaskAgent(
        task.id,
        nextAgentType,
        workspaceId ? undefined : state.effectiveExecutorId || undefined,
        workspaceId,
        workspaceSessionId,
      )
      const updatedTask = resolveUpdatedTaskFromMutation(response.task, response.workspaceSession)
      if (updatedTask) {
        state.setSelectedAgentType(updatedTask.agentType)
        state.setPreflightAgentType(updatedTask.agentType)
        state.setSelectedModel(updatedTask.executionModel ?? '')
        state.setPreflightModel(updatedTask.executionModel ?? '')
        const runtimeSettings = resolveTaskChatRuntimeSettings(
          updatedTask.agentType,
          agentSettings,
          getTaskScopedAgentSettings(updatedTask),
        )
        state.setSelectedRuntimeSettings(runtimeSettings)
        state.setPreflightRuntimeSettings(runtimeSettings)
        rememberWorkspaceRuntimeAgent(updatedTask.agentType)
      } else {
        rememberWorkspaceRuntimeAgent(nextAgentType)
      }
    } catch (error) {
      state.setSelectedAgentType(previousAgentType)
      state.setPreflightAgentType(previousAgentType)
      state.setSelectedModel(previousModel)
      state.setPreflightModel(previousModel)
      state.setSelectedRuntimeSettings(previousSettings)
      state.setPreflightRuntimeSettings(previousSettings)
      state.setModelOptions(previousModelOptions)
      state.setDefaultModel(previousDefaultModel)
      const message = error instanceof Error ? error.message : '切换执行端失败'
      state.setNotices((prev) => prependNotice(prev, {
        id: crypto.randomUUID(),
        level: 'error',
        message,
      }))
      toast.error(message)
    } finally {
      state.setAgentSaving(false)
    }
  }, [agentSettings, shouldDeferRuntimeConfigPersistence, state, task.id, task.projectId, workspaceId, workspaceSessionId, workspaceWorkingDirectoryMode])

  const handlePreflightConfirm = useCallback(async () => {
    if (!state.canConfirmPreflight || state.preflightSaving || !state.pendingMessage) {
      return
    }

    state.setPreflightSaving(true)
    try {
      if (state.pendingAgentDispatch) {
        const dispatch = state.pendingAgentDispatch
        const sent = await dispatchAgentScopedMessage(dispatch.agent, dispatch.mode, dispatch.rawMessage, {
          runtime: state.preflightAgentType,
          executorNodeId: workspaceId ? undefined : state.preflightExecutorId || undefined,
          model: state.effectivePreflightModel || undefined,
          agentSettings: state.preflightRuntimeSettings,
          enabledMcpServerIds: state.preflightMcpServerIds,
        })
        if (!sent) {
          return
        }
        state.setPendingMessage('')
        state.setPendingAgentDispatch(null)
        state.setPreflightOpen(false)
        return
      }

      let updatedTask = task
      if (state.preflightAgentType !== state.selectedAgentType) {
        const response = await api.updateTaskAgent(
          task.id,
          state.preflightAgentType,
          workspaceId ? undefined : state.preflightExecutorId || state.effectiveExecutorId,
          workspaceId,
          workspaceSessionId,
        )
        const nextTask = resolveUpdatedTaskFromMutation(response.task, response.workspaceSession)
        if (nextTask) {
          updatedTask = nextTask
          state.setSelectedAgentType(nextTask.agentType)
          state.setPreflightAgentType(nextTask.agentType)
          state.setSelectedModel(nextTask.executionModel ?? '')
          state.setPreflightModel(nextTask.executionModel ?? '')
          const nextRuntimeSettings = resolveTaskChatRuntimeSettings(
            nextTask.agentType,
            agentSettings,
            getTaskScopedAgentSettings(nextTask),
          )
          state.setSelectedRuntimeSettings(nextRuntimeSettings)
          state.setPreflightRuntimeSettings(nextRuntimeSettings)
        }
      }

      if (
        (state.preflightRequiresModelSelection || state.effectivePreflightModel !== state.selectedModel)
        && state.effectivePreflightModel !== (updatedTask.executionModel ?? '')
      ) {
        const response = await api.updateTaskModelCompact(
          task.id,
          state.preflightModel || undefined,
          workspaceId ? undefined : state.preflightExecutorId || state.effectiveExecutorId,
          workspaceId,
          workspaceSessionId,
        )
        const nextTask = resolveUpdatedTaskFromMutation(response.task, response.workspaceSession)
        if (nextTask) {
          state.setSelectedAgentType(nextTask.agentType)
          state.setPreflightAgentType(nextTask.agentType)
          const savedModel = nextTask.executionModel ?? ''
          state.setSelectedModel(savedModel)
          state.setPreflightModel(savedModel)
          state.rememberWorkspaceSessionModelMenuSelection(savedModel || state.preflightModel)
          updatedTask = nextTask
        }
      }

      if (workspaceId && state.preflightAgentType !== 'OpenCode') {
        const response = await api.updateTaskAgentSettingsCompact(
          task.id,
          state.preflightAgentType,
          state.preflightRuntimeSettings,
          workspaceId ? undefined : state.preflightExecutorId || state.effectiveExecutorId,
          workspaceId,
          workspaceSessionId,
        )
        const nextTask = resolveUpdatedTaskFromMutation(response.task, response.workspaceSession)
        if (nextTask) {
          const nextRuntimeSettings = resolveTaskChatRuntimeSettings(
            nextTask.agentType,
            agentSettings,
            getTaskScopedAgentSettings(nextTask),
          )
          state.setSelectedRuntimeSettings(nextRuntimeSettings)
          state.setPreflightRuntimeSettings(nextRuntimeSettings)
          updatedTask = nextTask
        }
      }

      if (workspaceId) {
        const nextMcpSelection = resolveTaskChatMcpServerSelection(state.availableMcpServers, state.preflightMcpServerIds)
        const response = await api.updateTaskMcpSettingsCompact(task.id, nextMcpSelection, workspaceId, workspaceSessionId)
        const nextTask = resolveUpdatedTaskFromMutation(response.task, response.workspaceSession)
        if (nextTask) {
          const savedSelection = resolveTaskChatMcpServerSelection(
            state.availableMcpServers,
            getTaskScopedEnabledMcpServerIds(nextTask),
          )
          state.setSelectedMcpServerIds(savedSelection)
          state.setPreflightMcpServerIds(savedSelection)
          state.syncLocalMountedMcpServerNames(savedSelection)
        }
      }

      if (state.requiresExecutorSelection && state.preflightExecutorId && state.preflightExecutorId !== state.effectiveExecutorId) {
        onAssignExecutor(task.id, state.preflightExecutorId, workspaceId, workspaceSessionId)
      }

      const messageToSend = state.pendingMessage
      const sent = await submitPreparedMessage(messageToSend)
      if (!sent) {
        return
      }
      state.setPendingMessage('')
      state.setPendingAgentDispatch(null)
      state.setPreflightOpen(false)
    } catch (error) {
      const message = error instanceof Error ? error.message : '发送前校验保存失败'
      state.setNotices((prev) => prependNotice(prev, {
        id: crypto.randomUUID(),
        level: 'error',
        message,
      }))
      toast.error(message)
    } finally {
      state.setPreflightSaving(false)
    }
  }, [agentSettings, dispatchAgentScopedMessage, onAssignExecutor, state, submitPreparedMessage, task, workspaceId, workspaceSessionId])

  const handleDelegateConfirm = useCallback(async () => {
    const agent = state.selectedDelegateAgent
    if (!agent) {
      toast.error('请先选择要委派的 Agent')
      return
    }

    const message = state.delegatePrompt.trim() || resolveDefaultDelegatePrompt(agent) || state.input.trim() || task.description
    if (!message) {
      toast.error('请先填写委派说明')
      return
    }

    state.setDelegateOpen(false)
    state.setDelegatePrompt('')
    state.setDelegateAgentId('')
    try {
      await dispatchAgentScopedMessage(agent, 'delegate', message)
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : '委派失败'
      state.setNotices((prev) => prependNotice(prev, {
        id: crypto.randomUUID(),
        level: 'error',
        message: errorMessage,
      }))
      toast.error(errorMessage)
    }
  }, [dispatchAgentScopedMessage, state, task.description])

  return {
    handleExecutorChange,
    handleAgentChange,
    handleDelegateConfirm,
    handleMcpSettingsChange,
    handleModelChange,
    handlePreflightConfirm,
    handleRuntimeSettingsChange,
  }
}
