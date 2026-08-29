/**
 * [INPUT]: Workspace session state transitions, notification preferences, and optional event delivery.
 * [OUTPUT]: Completion notifications for external channels and the agent event inbox.
 * [POS]: Side-effect boundary for completed, attention, and failed workspace sessions.
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */
import { isCustomAgentEnabled, readCustomAgentConfig } from '@shared/custom-agent'
import type { DistributedTask, Project, Task, WorkspaceSession, WorkspaceRecord } from '@shared/types'
import { getAgent } from '../repositories/agent'
import { getDistributedTask, getWorkspace, listDistributedTasks } from '../storage/distributed-task-store'
import { loadState } from '../storage/app-state-store'
import { getUserNotificationSettings } from './user-notification-settings-service'
import { sendPushToUser } from './web-push-service'
import { sendFeishuMessageToWebhook } from '../integrations/feishu'
import type { AgentEventInput } from './agent-event-runtime'

export type WorkspaceSessionCompletionTone = 'complete' | 'attention' | 'error'

const isBusyWorkspaceSession = (session: Pick<WorkspaceSession, 'agentRunningStatus' | 'runtimeStatus'> | null | undefined) => {
  if (!session) {
    return false
  }

  return (
    session.agentRunningStatus === 'thinking'
    || session.agentRunningStatus === 'executing'
    || session.agentRunningStatus === 'waiting'
    || session.runtimeStatus === 'queued'
    || session.runtimeStatus === 'running'
    || session.runtimeStatus === 'waiting'
  )
}

export const resolveWorkspaceSessionAttentionTone = (params: {
  session: Pick<WorkspaceSession, 'agentRunningStatus' | 'runtimeStatus' | 'needsHumanConfirm'>
  distributedTask?: Pick<DistributedTask, 'status'> | null
}): WorkspaceSessionCompletionTone | null => {
  const { session, distributedTask } = params
  if (
    session.agentRunningStatus === 'error'
    || session.runtimeStatus === 'error'
    || session.runtimeStatus === 'lost'
    || session.runtimeStatus === 'cancelled'
    || (
      distributedTask
      && ['failed', 'cancelled', 'timed_out', 'lost'].includes(distributedTask.status)
    )
  ) {
    return 'error'
  }

  if (
    session.agentRunningStatus === 'complete'
    || session.runtimeStatus === 'completed'
    || distributedTask?.status === 'completed'
  ) {
    return 'complete'
  }

  if (
    session.needsHumanConfirm
    || session.agentRunningStatus === 'waiting'
    || session.runtimeStatus === 'waiting'
  ) {
    return 'attention'
  }

  return null
}

const getWorkspaceSessionCompletionSignature = (
  session: Pick<WorkspaceSession, 'agentRunningStatus' | 'runtimeStatus' | 'needsHumanConfirm' | 'runtimeSequence' | 'lastRuntimeEventAt' | 'updatedAt' | 'createdAt'>,
  tone: WorkspaceSessionCompletionTone,
) => {
  return `${tone}:${session.runtimeSequence}:${session.lastRuntimeEventAt || session.updatedAt || session.createdAt}`
}

const getToneTitle = (tone: WorkspaceSessionCompletionTone) => {
  if (tone === 'attention') {
    return 'wemux 工作区会话等待确认'
  }

  if (tone === 'error') {
    return 'wemux 工作区会话执行出错'
  }

  return 'wemux 工作区会话已完成'
}

const buildWorkspaceSessionCompletionMessage = (params: {
  tone: WorkspaceSessionCompletionTone
  session: WorkspaceSession
  task?: Task | null
  project?: Project | null
  workspace?: WorkspaceRecord | null
}) => {
  const lines = [
    getToneTitle(params.tone),
    `会话: ${params.session.title}`,
  ]

  if (params.task?.title) {
    lines.push(`任务: ${params.task.title}`)
  }

  if (params.project?.name) {
    lines.push(`项目: ${params.project.name}`)
  }

  if (params.workspace?.name) {
    lines.push(`工作区: ${params.workspace.name}`)
  }

  lines.push(`状态: ${params.tone === 'attention' ? '待确认' : params.tone === 'error' ? '出错' : '完成'}`)
  return lines.join('\n')
}

const resolveWorkspaceSessionEventType = (tone: WorkspaceSessionCompletionTone) => (
  tone === 'complete'
    ? 'workspace.session.completed'
    : tone === 'attention'
      ? 'workspace.session.waiting'
      : 'workspace.session.failed'
)

export const buildWorkspaceSessionAttentionEvent = (params: {
  tone: WorkspaceSessionCompletionTone
  session: WorkspaceSession
  distributedTask: DistributedTask
  task?: Task | null
  project?: Project | null
  workspace?: WorkspaceRecord | null
}): AgentEventInput | null => {
  return buildWorkspaceTurnAttentionEvent({
    tone: params.tone,
    session: params.session,
    taskRunId: params.distributedTask.originTaskRunId ?? params.distributedTask.id,
    requestedByUserId: params.distributedTask.requestedByUserId,
    requestedByAgentId: params.distributedTask.requestedByAgentId,
    sourceAgentEventId: params.distributedTask.sourceAgentEventId,
    taskId: params.distributedTask.originTaskId,
    projectId: params.distributedTask.projectId,
    workspaceId: params.distributedTask.workspaceId,
    task: params.task,
    project: params.project,
    workspace: params.workspace,
    result: params.distributedTask.result
      ? {
          summary: params.distributedTask.result.summary,
          filesChanged: params.distributedTask.result.filesChanged,
          changeSummary: params.distributedTask.result.changeSummary,
          commitShas: params.distributedTask.result.commitShas,
        }
      : undefined,
    errorMessage: params.distributedTask.errorMessage,
    distributedTaskId: params.distributedTask.id,
    distributedTaskStatus: params.distributedTask.status,
    attentionKey: params.distributedTask.id,
  })
}

export const buildWorkspaceTurnAttentionEvent = (params: {
  tone: WorkspaceSessionCompletionTone
  session: WorkspaceSession
  taskRunId: string
  requestedByUserId?: string
  requestedByAgentId?: string
  sourceAgentEventId?: string
  taskId?: string
  projectId?: string
  workspaceId?: string
  task?: Task | null
  project?: Project | null
  workspace?: WorkspaceRecord | null
  result?: {
    summary?: string
    filesChanged?: string[]
    changeSummary?: unknown
    commitShas?: string[]
  }
  errorMessage?: string
  distributedTaskId?: string
  distributedTaskStatus?: string
  attentionKey?: string
}): AgentEventInput | null => {
  const requestedByAgentId = params.requestedByAgentId?.trim()
  if (!requestedByAgentId) return null

  const eventType = resolveWorkspaceSessionEventType(params.tone)
  const taskId = params.taskId?.trim() || params.task?.id?.trim()
  const projectId = params.projectId?.trim() || params.project?.id?.trim() || params.task?.projectId?.trim()
  const taskRunId = params.taskRunId.trim()
  if (!taskId || !projectId || !taskRunId) return null
  const attentionKey = params.attentionKey?.trim() || taskRunId
  return {
    type: eventType,
    targetAgentId: requestedByAgentId,
    actingUserId: params.requestedByUserId,
    sourceAgentEventId: params.sourceAgentEventId,
    actor: { type: 'system' },
    scope: {
      projectId,
      taskId,
      workspaceId: params.workspaceId?.trim() || params.workspace?.id || params.session.workspaceId,
      workspaceSessionId: params.session.id,
      taskRunId,
      ...(params.distributedTaskId ? { distributedTaskId: params.distributedTaskId } : {}),
    },
    payload: {
      tone: params.tone,
      taskTitle: params.task?.title ?? '',
      workspaceName: params.workspace?.name ?? '',
      sessionTitle: params.session.title,
      currentStep: params.session.currentStep,
      runtimeStatus: params.session.runtimeStatus,
      runtimeSequence: params.session.runtimeSequence,
      ...(params.distributedTaskStatus ? { distributedTaskStatus: params.distributedTaskStatus } : {}),
      resultSummary: params.result?.summary ?? '',
      filesChanged: params.result?.filesChanged ?? [],
      changeSummary: params.result?.changeSummary ?? null,
      commitShas: params.result?.commitShas ?? [],
      errorMessage: params.errorMessage ?? '',
      sourceAgentEventId: params.sourceAgentEventId ?? '',
    },
    conversationKey: `task:${taskId}`,
    idempotencyKey: params.tone === 'attention'
      ? `workspace-run:${attentionKey}:waiting:${params.session.runtimeSequence}`
      : `workspace-run:${attentionKey}:terminal`,
  }
}

export const publishWorkspaceTurnAttentionIfAvailable = async (event: AgentEventInput | null) => {
  if (!event?.targetAgentId) return false
  const targetAgent = getAgent(event.targetAgentId)
  if (!targetAgent || !isCustomAgentEnabled(readCustomAgentConfig(targetAgent.config))) {
    console.warn(
      `[workspace-session-completion] requesting Agent ${event.targetAgentId} is unavailable; keeping human notifications only`,
    )
    return false
  }

  await publishWorkspaceSessionAttention(event)
  return true
}

export const notifyWorkspaceSessionCompletionIfNeeded = async (params: {
  previousSession?: WorkspaceSession | null
  nextSession: WorkspaceSession
  recipientUserIds: string[]
  task?: Task | null
  project?: Project | null
  workspace?: WorkspaceRecord | null
}) => {
  const previousSession = params.previousSession ?? null
  const distributedTask = params.nextSession.distributedTaskId
    ? getDistributedTask(params.nextSession.distributedTaskId)
    : null
  const nextTone = resolveWorkspaceSessionAttentionTone({
    session: params.nextSession,
    distributedTask,
  })
  if (!isBusyWorkspaceSession(previousSession) || !nextTone) {
    return
  }

  const previousTone = previousSession
    ? resolveWorkspaceSessionAttentionTone({ session: previousSession })
    : null
  const previousSignature = previousSession && previousTone
    ? getWorkspaceSessionCompletionSignature(previousSession, previousTone)
    : null
  const nextSignature = getWorkspaceSessionCompletionSignature(params.nextSession, nextTone)
  if (previousSignature === nextSignature) {
    return
  }

  const message = buildWorkspaceSessionCompletionMessage({
    tone: nextTone,
    session: params.nextSession,
    task: params.task,
    project: params.project,
    workspace: params.workspace,
  })

  const attentionEvent = distributedTask
    ? buildWorkspaceSessionAttentionEvent({
        tone: nextTone,
        session: params.nextSession,
        distributedTask,
        task: params.task,
        project: params.project,
        workspace: params.workspace,
      })
    : null
  void publishWorkspaceTurnAttentionIfAvailable(attentionEvent)

  await Promise.allSettled(
    params.recipientUserIds.map(async (userId) => {
      const settings = getUserNotificationSettings(userId)

      // feature P3：会话终态 → Web Push（页面关闭也能收；browserEnabled 才推）。
      if (settings.workspaceSessionCompletion.browserEnabled) {
        await sendPushToUser({
          userId,
          payload: {
            title: getToneTitle(nextTone),
            body: message,
            tag: `workspace-session-complete:${params.nextSession.id}`,
            url: params.nextSession.workspaceId
              ? `/workspace?workspaceId=${params.nextSession.workspaceId}&workspaceSessionId=${params.nextSession.id}`
              : '/workspaces',
          },
          limit: 4,
        }).catch(() => undefined)
      }

      if (!settings.workspaceSessionCompletion.feishuEnabled) {
        return
      }

      const webhookUrl = settings.channels.feishuWebhookUrl.trim()
      if (!webhookUrl) {
        return
      }

      await sendFeishuMessageToWebhook(webhookUrl, message)
    }),
  )
}

const publishWorkspaceSessionAttention = async (event: AgentEventInput) => {
  try {
    const { publishAgentEvent } = await import('./agent-event-runtime')
    publishAgentEvent(event)
  } catch (error) {
    console.warn('[workspace-session-completion] failed to publish agent event', error)
  }
}

export const reconcileWorkspaceSessionAgentAttentions = async () => {
  const state = loadState()
  const events: AgentEventInput[] = []
  for (const distributedTask of listDistributedTasks()) {
    if (!distributedTask.requestedByAgentId) continue
    const session = distributedTask.workspaceSessionId
      ? state.workspaceSessions.find((item) => item.id === distributedTask.workspaceSessionId)
      : null
    if (!session) continue

    const tone = resolveWorkspaceSessionAttentionTone({
      session,
      distributedTask,
    })
    if (!tone) continue

    const task = state.tasks.find((item) => item.id === distributedTask.originTaskId) ?? null
    const project = task ? state.projects.find((item) => item.id === task.projectId) ?? null : null
    const workspace = getWorkspace(session.workspaceId)
    const event = buildWorkspaceSessionAttentionEvent({
      tone,
      session,
      distributedTask,
      task,
      project,
      workspace,
    })
    if (!event?.targetAgentId) continue
    const agent = getAgent(event.targetAgentId)
    if (!agent || !isCustomAgentEnabled(readCustomAgentConfig(agent.config))) continue
    events.push(event)
  }
  await Promise.all(events.map(publishWorkspaceSessionAttention))
}
