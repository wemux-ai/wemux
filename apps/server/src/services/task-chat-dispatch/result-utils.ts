import { markTaskExecutionFinished, markTaskExecutionStarted, syncTaskStatusFromReviewReady, touchTaskStatus } from '@shared/task-status-flow'
import { buildWorkspaceTaskExecutionView, getWorkspaceSessionRoleLabel, mergeWorkspaceSession, resolveWorkspaceSessionExecutorId } from '@shared/task-workspace'
import type { ExecutionLog, Project, Task, TaskResultDelivery, WorkspaceSession, WorkspaceSessionRuntimeStatus } from '@shared/types'
import type { WorkspaceDeliverySummary } from '@shared/workspace-delivery'
import { appendTaskConversationMessage } from '../../control-plane/conversation-service'
import {
  createAssistantMessageEvent,
  createErrorEvent,
  createStatusEvent,
  createTimelineCollector,
} from '../../integrations/opencode/task-chat-stream'
import { getWorkspaceSessionById } from '../../storage/app-state-store'
import type { TaskMessageResult } from './types'
import { publishTaskChatTimelineEvent } from './runtime-state'

const githubPullRequestUrlPattern = /https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/pull\/(\d+)/i

const extractAgentCreatedPullRequest = (output?: string) => {
  const text = output?.trim() || ''
  if (!text) {
    return null
  }

  const match = githubPullRequestUrlPattern.exec(text)
  if (!match?.[0]) {
    return null
  }

  const number = Number.parseInt(match[1] ?? '', 10)
  const state = /已合并|merged/i.test(text)
    ? 'merged'
    : /已关闭|closed/i.test(text)
      ? 'closed'
      : 'open'

  return {
    url: match[0],
    number: Number.isFinite(number) ? number : undefined,
    state,
  }
}

const buildAgentCreatedPullRequestDelivery = (params: {
  task: Task
  project: Project
  session: WorkspaceSession
  pullRequest: NonNullable<ReturnType<typeof extractAgentCreatedPullRequest>>
}) => {
  const baseBranch = params.session.baseBranch?.trim()
    || params.task.baseBranch?.trim()
    || params.task.baseBranchHint?.trim()
    || 'main'
  const compareBranch = params.session.branchName?.trim() || params.task.result?.delivery?.pullRequest?.compareBranch?.trim()

  return {
    mode: 'commit' as const,
    ...(params.task.result?.delivery ?? {}),
    pullRequest: {
      ready: true,
      remoteReady: true,
      repoUrl: params.task.result?.delivery?.pullRequest?.repoUrl ?? params.project.gitUrl ?? '',
      title: params.task.result?.delivery?.pullRequest?.title,
      description: params.task.result?.delivery?.pullRequest?.description,
      baseBranch,
      compareBranch,
      number: params.pullRequest.number,
      url: params.pullRequest.url,
      state: params.pullRequest.state,
    },
    syncFailureReason: undefined,
  }
}

const buildWorkspacePullRequestDeliverySummary = (params: {
  session: WorkspaceSession
  delivery: TaskResultDelivery
  updatedAt: string
}): WorkspaceDeliverySummary | undefined => {
  const pullRequest = params.delivery.pullRequest
  if (!pullRequest) {
    return undefined
  }

  return {
    pullRequest: {
      state: pullRequest.state === 'open' || pullRequest.state === 'merged' || pullRequest.state === 'closed'
        ? pullRequest.state
        : 'unknown',
      updatedAt: params.updatedAt,
      url: pullRequest.url?.trim() || undefined,
      number: pullRequest.number,
      compareBranch: pullRequest.compareBranch?.trim() || params.session.branchName?.trim() || undefined,
      workspaceId: params.session.workspaceId,
      workspaceSessionId: params.session.id,
    },
  }
}

const hasPullRequestDeliveryEvent = (params: {
  result: TaskMessageResult
  pullRequestUrl?: string
  pullRequestNumber?: number
}) => {
  return (params.result.conversationTimeline ?? []).some((event) => {
    if (event.kind !== 'delivery_result') {
      return false
    }

    const eventPullRequest = event.delivery?.pullRequest
    return Boolean(
      (params.pullRequestUrl && eventPullRequest?.url === params.pullRequestUrl)
      || (typeof params.pullRequestNumber === 'number' && eventPullRequest?.number === params.pullRequestNumber),
    )
  })
}

const hasVisibleAssistantTimelineEvent = (result: TaskMessageResult) => {
  return (result.conversationTimeline ?? []).some((event) => {
    return event.kind === 'assistant_message' && event.text.trim().length > 0
  })
}

export const ensureWorkspaceResultAssistantTimeline = (result: TaskMessageResult, authorName?: string): TaskMessageResult => {
  const output = result.output?.trim() || ''
  if (!output || hasVisibleAssistantTimelineEvent(result)) {
    return result
  }

  const turnId = result.turnId ?? crypto.randomUUID()
  const timeline = createTimelineCollector(turnId)
  const existingTimeline = result.conversationTimeline ?? []
  for (const event of existingTimeline) {
    timeline.upsert(event)
  }

  const assistantEvent = createAssistantMessageEvent(
    timeline,
    result.agentSessionId || result.opencodeSessionId || `assistant:${turnId}`,
    output,
    new Date().toISOString(),
    `final:${turnId}`,
    authorName,
    result.executionModel,
  )

  return {
    ...result,
    turnId,
    conversationTimeline: [...existingTimeline, assistantEvent],
  }
}

export const markAgentCreatedPullRequestResult = (params: {
  result: TaskMessageResult
  task: Task
  project: Project
  session: WorkspaceSession
}) => {
  if (!params.result.ok) {
    return {
      result: params.result,
      deliverySummary: undefined,
    }
  }

  const pullRequest = extractAgentCreatedPullRequest(params.result.output)
  if (!pullRequest) {
    return {
      result: params.result,
      deliverySummary: params.result.delivery
        ? buildWorkspacePullRequestDeliverySummary({
            session: params.session,
            delivery: params.result.delivery,
            updatedAt: new Date().toISOString(),
          })
        : undefined,
    }
  }

  const delivery = buildAgentCreatedPullRequestDelivery({
    task: params.task,
    project: params.project,
    session: params.session,
    pullRequest,
  })
  const timestamp = new Date().toISOString()
  const deliverySummary = buildWorkspacePullRequestDeliverySummary({
    session: params.session,
    delivery,
    updatedAt: timestamp,
  })
  const existingTimeline = params.result.conversationTimeline ?? []
  const conversationTimeline = hasPullRequestDeliveryEvent({
    result: params.result,
    pullRequestUrl: pullRequest.url,
    pullRequestNumber: pullRequest.number,
  })
    ? existingTimeline
    : [
        ...existingTimeline,
        {
          id: `turn:${params.result.turnId ?? 'agent-created-pr'}:delivery:pull-request:${pullRequest.number ?? pullRequest.url}`,
          ts: timestamp,
          turnId: params.result.turnId ?? `agent-created-pr:${timestamp}`,
          seq: existingTimeline.length + 1,
          kind: 'delivery_result' as const,
          message: pullRequest.url ? `PR 已创建：${pullRequest.url}` : 'PR 已创建。',
          remoteBranchName: delivery.pullRequest?.compareBranch,
          delivery,
        },
      ]

  return {
    result: {
      ...params.result,
      delivery,
      conversationTimeline,
    },
    deliverySummary,
  }
}

export const buildPendingTask = (
  task: Task,
  message: string,
  timestamp: string,
  launchId?: string,
  workspaceId?: string,
  workspaceSessionId?: string,
) => {
  const userLog: ExecutionLog = {
    id: crypto.randomUUID(),
    role: 'user',
    content: message,
    createdAt: timestamp,
    launchId,
    workspaceId,
    workspaceSessionId,
  }
  const nextTask = workspaceId
    ? touchTaskStatus(task, timestamp)
    : markTaskExecutionStarted(task, timestamp)

  return {
    ...nextTask,
    logs: [...(nextTask.logs ?? []), userLog],
    needsHumanConfirm: false,
    agentRunningStatus: 'thinking' as const,
    currentStep: workspaceId ? '正在处理工作区对话' : '正在处理任务详情对话',
  }
}

export const buildPendingWorkspaceSession = (
  task: Task,
  session: WorkspaceSession,
  timestamp: string,
  runtimeOwnerExecutorId?: string,
) => {
  return mergeWorkspaceSession(task, session, {
    agentSessionId: session.agentSessionId ?? session.opencodeSessionId,
    needsHumanConfirm: false,
    agentRunningStatus: 'thinking',
    runtimeStatus: 'running',
    // 直连执行路径没有心跳维持 lastHeartbeatAt：清掉旧心跳时间，
    // 避免 web 端心跳新鲜度判定把「正在跑但无心跳」的直连会话误判为失联。
    lastHeartbeatAt: '',
    runtimeOwnerExecutorId: runtimeOwnerExecutorId?.trim() || resolveWorkspaceSessionExecutorId(session),
    runtimeStartedAt: timestamp,
    lastRuntimeEventAt: timestamp,
    terminalReason: undefined,
    runtimeSequence: session.runtimeSequence + 1,
    currentStep: '正在处理工作区对话',
    updatedAt: timestamp,
    lastActiveAt: timestamp,
    opencodeSessionId: session.opencodeSessionId,
    distributedTaskId: session.distributedTaskId,
    worktreeStatus: session.worktreeStatus,
    executorNodeId: session.executorNodeId,
    executionModel: session.executionModel,
    gitIdentityMode: session.gitIdentityMode,
    baseBranch: session.baseBranch,
    branchName: session.branchName,
    worktreeId: session.worktreeId,
  })
}

const resolveWorkspaceMessageRuntimeStatus = (result: TaskMessageResult): WorkspaceSessionRuntimeStatus => {
  if (result.agentRunningStatus === 'idle') {
    return 'idle'
  }

  if (result.agentRunningStatus === 'waiting') {
    return 'waiting'
  }

  if (result.agentRunningStatus === 'error') {
    return 'error'
  }

  if (result.agentRunningStatus === 'complete' || result.ok) {
    return 'completed'
  }

  if (!result.ok) {
    return 'error'
  }

  return 'idle'
}

export const applyWorkspaceMessageResult = (task: Task, session: WorkspaceSession, result: TaskMessageResult) => {
  const replyAt = new Date().toISOString()
  const runtimeStatus = resolveWorkspaceMessageRuntimeStatus(result)
  const terminalReason = runtimeStatus === 'error'
    ? result.output.trim() || result.currentStep || '工作区对话失败'
    : undefined
  const deliverySummary = result.delivery
    ? buildWorkspacePullRequestDeliverySummary({
        session,
        delivery: result.delivery,
        updatedAt: replyAt,
      }) ?? session.deliverySummary
    : session.deliverySummary

  return mergeWorkspaceSession(task, session, {
    agentSessionId: result.agentSessionId ?? result.opencodeSessionId ?? session.agentSessionId ?? session.opencodeSessionId,
    opencodeSessionId: result.opencodeSessionId ?? session.opencodeSessionId,
    runtimeContinuations: result.runtimeContinuations ?? session.runtimeContinuations,
    needsHumanConfirm: result.ok,
    agentRunningStatus: result.agentRunningStatus ?? (result.ok ? 'complete' : 'error'),
    runtimeStatus,
    lastRuntimeEventAt: replyAt,
    terminalReason,
    runtimeSequence: session.runtimeSequence + 1,
    currentStep: result.currentStep ?? (result.ok ? '工作区对话已完成' : '工作区对话失败'),
    deliverySummary,
    updatedAt: replyAt,
    lastActiveAt: replyAt,
  })
}

export const buildFailedWorkspaceMessageResult = (message: string, turnId?: string): TaskMessageResult => {
  const output = message.trim() || '工作区对话失败'
  const currentStep = '工作区对话失败'

  if (!turnId) {
    return {
      ok: false,
      output,
      agentRunningStatus: 'error',
      currentStep,
    }
  }

  const timestamp = new Date().toISOString()
  const timeline = createTimelineCollector(turnId)

  return {
    ok: false,
    output,
    turnId,
    agentRunningStatus: 'error',
    currentStep,
    conversationTimeline: [
      createStatusEvent(timeline, 'error', currentStep, timestamp),
      createErrorEvent(timeline, output, timestamp),
    ],
  }
}

const trimHandoffSummary = (value?: string, limit = 600) => {
  const normalized = value?.trim()
  if (!normalized) {
    return '本轮未生成可展示摘要。'
  }

  return normalized.length > limit
    ? `${normalized.slice(0, limit)}\n...（已截断）`
    : normalized
}

export const handoffSubagentTurnToParent = (params: {
  task: Task
  project: Project
  session: WorkspaceSession
  result: TaskMessageResult
}) => {
  if (params.session.sessionKind !== 'subagent' || !params.session.parentSessionId?.trim()) {
    return
  }

  const parentSession = getWorkspaceSessionById(params.session.parentSessionId)
  if (!parentSession) {
    return
  }

  const timestamp = new Date().toISOString()
  const roleLabel = getWorkspaceSessionRoleLabel(params.session.sessionRole)
  const statusLabel = params.result.ok ? '完成' : '失败'
  const summary = [
    `子会话「${params.session.title}」已${statusLabel}本轮处理。`,
    `角色：${roleLabel}`,
    `状态：${params.result.currentStep ?? (params.result.ok ? '工作区对话已完成' : '工作区对话失败')}`,
    '',
    trimHandoffSummary(params.result.output),
  ].join('\n')

  appendTaskConversationMessage({
    task: params.task,
    project: params.project,
    workspaceId: parentSession.workspaceId,
    workspaceSessionId: parentSession.id,
    role: 'assistant',
    content: summary,
    contentType: 'json',
    externalRef: {
      subagentHandoff: {
        childSessionId: params.session.id,
        childTitle: params.session.title,
        childRole: params.session.sessionRole,
        status: params.result.ok ? 'completed' : 'failed',
      },
    },
  })

  publishTaskChatTimelineEvent(
    params.task.id,
    parentSession.workspaceId,
    parentSession.id,
    createAssistantMessageEvent(
      createTimelineCollector(`handoff:${params.session.id}:${timestamp}`),
      `handoff:${params.session.id}:${timestamp}`,
      summary,
      timestamp,
    ),
  )
}

export const applyTaskMessageResult = (task: Task, result: TaskMessageResult, workspaceId?: string) => {
  const replyAt = new Date().toISOString()
  const nextTask = workspaceId
    ? (result.ok ? syncTaskStatusFromReviewReady(task, replyAt) : touchTaskStatus(task, replyAt))
    : markTaskExecutionFinished(task, result.ok, replyAt)
  const replyLog: ExecutionLog = {
    id: crypto.randomUUID(),
    role: 'agent',
    content: result.output ?? '操作失败',
    createdAt: replyAt,
    workspaceId,
  }

  return {
    ...nextTask,
    toolCalls: result.toolCalls ?? nextTask.toolCalls ?? [],
    logs: [...(nextTask.logs ?? []), replyLog],
    needsHumanConfirm: result.ok,
    agentRunningStatus: result.agentRunningStatus ?? (result.ok ? 'complete' : 'error'),
    currentStep: result.currentStep ?? (result.ok ? '任务详情对话已完成' : '任务详情对话失败'),
  } satisfies Task
}
