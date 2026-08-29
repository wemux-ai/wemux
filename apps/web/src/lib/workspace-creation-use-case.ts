// [INPUT]: Workspace/session API callbacks, Agent runtime defaults, initial prompt, and optional image upload callbacks.
// [OUTPUT]: Effective creation runtime settings plus workspace/task/session ids, attachments, and queued chat snapshot.
// [POS]: UI-free web orchestration shared by onboarding and the /workspaces creation controller.
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import type { TaskChatAttachment } from '@shared/task-chat-attachment'
import { mergeAgentRuntimeSettings, normalizeAgentSettings } from '@shared/agent-config'
import type {
  AgentRuntimeSettings,
  AgentSettings,
  ExecutorRecord,
  Project,
  Task,
  Workspace,
  WorkspaceExecutionDefaults,
  WorkspaceSession,
} from '@shared/types'
import type {
  CreateWorkspaceResponse,
  EnqueueTaskChatMessageResponse,
  TaskWorkspaceBindingResponse,
} from './api/types'
import { isManagedCloudExecutorRecord } from './managed-cloud-executor'
import { readWorkspaceCreateRuntimePreference } from './workspace-create-preferences'

type WorkspaceCreationImage = {
  id: string
  filename: string
  contentType?: string
}

export const readWorkspaceCreationImage = (file: File) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader()
  reader.onload = () => resolve(reader.result as string)
  reader.onerror = reject
  reader.readAsDataURL(file)
})

export const isUsableWorkspaceCreationExecutor = (executor?: ExecutorRecord | null) => {
  return Boolean(executor && (executor.status === 'online' || executor.status === 'paired' || isManagedCloudExecutorRecord(executor)))
}

export const resolveDefaultWorkspaceCreationExecutorId = (
  project: Project | null,
  executorOptions: ExecutorRecord[],
  defaults?: WorkspaceExecutionDefaults,
) => {
  const defaultExecutorId = defaults?.executorNodeId.trim() || ''
  const defaultExecutor = defaultExecutorId
    ? executorOptions.find((executor) => executor.executorId === defaultExecutorId)
    : null
  if (isUsableWorkspaceCreationExecutor(defaultExecutor)) return defaultExecutorId

  const preferredExecutorId = project?.preferredExecutorId?.trim() || ''
  const preferredExecutor = preferredExecutorId
    ? executorOptions.find((executor) => executor.executorId === preferredExecutorId)
    : null
  if (isUsableWorkspaceCreationExecutor(preferredExecutor)) return preferredExecutorId

  // 本地在线优先；无在线本地节点时用云节点兜底（P0-5）。
  const onlineLocalExecutor = executorOptions.find((executor) => (
    executor.status === 'online' && !isManagedCloudExecutorRecord(executor)
  ))
  if (onlineLocalExecutor) return onlineLocalExecutor.executorId

  const managedCloudExecutor = executorOptions.find((executor) => isManagedCloudExecutorRecord(executor))
  if (managedCloudExecutor && isUsableWorkspaceCreationExecutor(managedCloudExecutor)) return managedCloudExecutor.executorId

  return executorOptions.find((executor) => executor.status === 'online')?.executorId
    || executorOptions.find((executor) => executor.status === 'paired' && !isManagedCloudExecutorRecord(executor))?.executorId
    || executorOptions.find(isUsableWorkspaceCreationExecutor)?.executorId
    || ''
}

export const resolveWorkspaceCreationCloneBlockReason = (
  project: Project | null,
  t: (key: string, options?: Record<string, unknown>) => string,
) => {
  if (project?.repositoryCloneStatus === 'cloning') return t('workspace.createPanel.cloneBlock.inProgress')
  if (project?.repositoryCloneStatus !== 'failed') return ''
  return project.repositoryCloneMessage?.trim()
    ? t('workspace.createPanel.cloneBlock.failedWithMessage', { message: project.repositoryCloneMessage })
    : t('workspace.createPanel.cloneBlock.failed')
}

export const resolvePreferredWorkspaceCreationRuntime = (params: {
  defaults?: WorkspaceExecutionDefaults
  fallbackAgentType?: Workspace['agentType'] | WorkspaceSession['agentType']
  project: Project | null
  projectId: string
}) => {
  const runtimePreference = readWorkspaceCreateRuntimePreference(params.projectId)
  const defaultAgentType = params.defaults?.agentType
  return {
    agentType: defaultAgentType ?? runtimePreference.agentType ?? params.fallbackAgentType ?? 'OpenCode',
    executionModel: defaultAgentType && defaultAgentType === params.defaults?.agentType
      ? params.defaults.executionModel
      : '',
    workingDirectoryMode: params.project?.versionControl === 'none'
      ? 'original-dir' as const
      : runtimePreference.workingDirectoryMode ?? 'worktree',
  }
}

export const resolveWorkspaceCreationAgentSettings = (params: {
  agentType: Task['agentType']
  globalAgentSettings: AgentSettings
  scopedAgentSettings?: AgentRuntimeSettings
}) => {
  const normalizedAgentSettings = normalizeAgentSettings(params.globalAgentSettings)
  return mergeAgentRuntimeSettings(
    params.agentType,
    normalizedAgentSettings[params.agentType],
    params.scopedAgentSettings,
  )
}

export const runWorkspaceCreationUseCase = async (params: {
  createWorkspace: () => Promise<CreateWorkspaceResponse>
  createSession: (response: CreateWorkspaceResponse) => Promise<TaskWorkspaceBindingResponse>
  fallbackTaskId?: string
  images?: WorkspaceCreationImage[]
  initialPrompt?: string
  startAgent?: boolean
  deferUntilWorkspaceReady?: boolean
  uploadImage?: (taskId: string, image: WorkspaceCreationImage) => Promise<TaskChatAttachment>
  enqueueInitialMessage?: (input: {
    taskId: string
    workspaceId: string
    workspaceSessionId: string
    message: string
    attachments: TaskChatAttachment[]
    deferUntilWorkspaceReady: boolean
  }) => Promise<EnqueueTaskChatMessageResponse>
  onSessionCreate?: () => void
  onWorkspaceCreated?: (response: CreateWorkspaceResponse) => void | Promise<void>
  onWorkspaceSessionReady?: (result: {
    response: CreateWorkspaceResponse
    sessionResponse: TaskWorkspaceBindingResponse
    taskId: string
    workspaceSessionId: string
  }) => void | Promise<void>
  onUploadStart?: (images: WorkspaceCreationImage[]) => void
  onUploadSuccess?: (image: WorkspaceCreationImage) => void
  onUploadError?: (image: WorkspaceCreationImage, error: unknown) => void
  onInitialMessageError?: (error: unknown) => void
}) => {
  const response = await params.createWorkspace()
  await params.onWorkspaceCreated?.(response)
  const sessionResponse = response.state && (response.workspaceSessionId || response.workspaceSession)
    ? {
        state: response.state,
        taskId: response.taskId,
        workspaceSessionId: response.workspaceSessionId,
        workspaceSession: response.workspaceSession,
        workspaces: response.workspaces,
      }
    : await (async () => {
        params.onSessionCreate?.()
        return params.createSession(response)
      })()

  const workspaceSessionId = sessionResponse.workspaceSessionId ?? sessionResponse.workspaceSession?.id ?? ''
  const taskId = sessionResponse.taskId
    || params.fallbackTaskId
    || response.taskId
    || workspaceSessionId
  await params.onWorkspaceSessionReady?.({ response, sessionResponse, taskId, workspaceSessionId })
  const images = params.startAgent === false ? [] : params.images ?? []
  const attachments: TaskChatAttachment[] = []

  if (images.length > 0 && taskId && params.uploadImage) {
    params.onUploadStart?.(images)
    for (const image of images) {
      try {
        attachments.push(await params.uploadImage(taskId, image))
        params.onUploadSuccess?.(image)
      } catch (error) {
        params.onUploadError?.(image, error)
      }
    }
  }

  let queuedInitialMessage: EnqueueTaskChatMessageResponse | undefined
  const initialPrompt = params.initialPrompt?.trim() || ''
  if (params.startAgent !== false && !taskId && (initialPrompt || images.length > 0)) {
    params.onInitialMessageError?.(new Error('工作区会话未绑定真实任务，无法通过任务聊天链路发送首条消息。'))
  }
  if (params.startAgent !== false && taskId && workspaceSessionId && (initialPrompt || attachments.length > 0) && params.enqueueInitialMessage) {
    try {
      queuedInitialMessage = await params.enqueueInitialMessage({
        taskId,
        workspaceId: response.workspace.id,
        workspaceSessionId,
        message: initialPrompt,
        attachments,
        deferUntilWorkspaceReady: params.deferUntilWorkspaceReady ?? false,
      })
    } catch (error) {
      params.onInitialMessageError?.(error)
    }
  }

  return { response, sessionResponse, taskId, workspaceSessionId, attachments, queuedInitialMessage }
}
