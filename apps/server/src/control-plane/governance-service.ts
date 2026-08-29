// [INPUT]: 权限/治理上下文（用户/项目/团队/执行器）
// [OUTPUT]: 授权决策结果
// [POS]: 授权治理服务（谁能用什么资源）
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import type { Project, Task, ToolCall } from '@shared/types'
import type { AgentMessageResult } from '../integrations/opencode/task-chat-stream'
import { publishWorkspaceBrainReview } from '../services/scheduling-brain/event-supervisor'
import {
  getAgentSessionByTaskAndRuntimeSession,
  saveAgentAction,
  saveAgentSession,
  saveApprovalRequest,
  saveAuditLog,
  type AgentMode,
  type AgentSessionRecord,
  type AgentSessionStatus,
  type RiskLevel,
} from '../storage/governance-store'

const parseJsonObject = (value?: string) => {
  if (!value?.trim()) {
    return {}
  }

  try {
    const parsed = JSON.parse(value) as unknown
    return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : { raw: value }
  } catch {
    return { raw: value }
  }
}

const mapTaskAgentMode = (task: Task): AgentMode => {
  if (task.agentManaged === 'ai') {
    return 'coordinate'
  }

  return 'assist'
}

const mapResultStatus = (result: AgentMessageResult): AgentSessionStatus => {
  if (result.agentRunningStatus === 'waiting') {
    return 'waiting'
  }

  if (!result.ok || result.agentRunningStatus === 'error') {
    return 'failed'
  }

  return 'completed'
}

const buildTaskContextSnapshot = (task: Task, project: Project) => ({
  taskId: task.id,
  taskTitle: task.title,
  projectId: project.id,
  projectName: project.name,
  agentType: task.agentType,
  executionModel: task.executionModel ?? null,
  agentManaged: task.agentManaged,
})

export const ensureTaskAgentSession = (params: {
  task: Task
  project: Project
  workspaceId?: string
  agentSessionId?: string
  createdByUserId?: string
  status?: AgentSessionStatus
}) => {
  const workspaceId = params.workspaceId?.trim() || undefined
  const existingSession = getAgentSessionByTaskAndRuntimeSession(params.task.id, workspaceId, params.agentSessionId)
  const timestamp = new Date().toISOString()

  const session: AgentSessionRecord = existingSession
    ? {
        ...existingSession,
        status: params.status ?? existingSession.status,
        workspaceId,
        runtime: params.task.agentType,
        agentSessionId: params.agentSessionId ?? existingSession.agentSessionId,
        contextSnapshot: buildTaskContextSnapshot(params.task, params.project),
        updatedAt: timestamp,
      }
    : {
        id: crypto.randomUUID(),
        projectId: params.project.id,
        taskId: params.task.id,
        workspaceId,
        runtime: params.task.agentType,
        mode: mapTaskAgentMode(params.task),
        status: params.status ?? 'running',
        agentSessionId: params.agentSessionId,
        contextSnapshot: buildTaskContextSnapshot(params.task, params.project),
        createdBy: params.createdByUserId,
        createdAt: timestamp,
        updatedAt: timestamp,
      }

  saveAgentSession(session)
  return session
}

export const recordAuditEvent = (params: {
  workspaceId?: string
  projectId?: string
  taskId?: string
  conversationId?: string
  agentSessionId?: string
  approvalRequestId?: string
  channelBindingId?: string
  eventType: string
  actorType: 'user' | 'agent' | 'system' | 'channel'
  actorId?: string
  payload?: Record<string, unknown>
}) => {
  saveAuditLog({
    id: crypto.randomUUID(),
    workspaceId: params.workspaceId,
    projectId: params.projectId,
    taskId: params.taskId,
    conversationId: params.conversationId,
    agentSessionId: params.agentSessionId,
    approvalRequestId: params.approvalRequestId,
    channelBindingId: params.channelBindingId,
    eventType: params.eventType,
    actorType: params.actorType,
    actorId: params.actorId,
    payload: params.payload,
    createdAt: new Date().toISOString(),
  })
}

export const recordAdminOperationAudit = (params: {
  actorUserId?: string
  workspaceId?: string
  projectId?: string
  taskId?: string
  eventType: string
  payload?: Record<string, unknown>
}) => {
  recordAuditEvent({
    workspaceId: params.workspaceId,
    projectId: params.projectId,
    taskId: params.taskId,
    eventType: params.eventType,
    actorType: 'user',
    actorId: params.actorUserId,
    payload: params.payload,
  })
}

export const recordTaskStatusChange = (params: {
  task: Task
  project: Project
  fromStatus: Task['status']
  toStatus: Task['status']
  actorUserId?: string
  conversationId?: string
}) => {
  recordAuditEvent({
    projectId: params.project.id,
    taskId: params.task.id,
    conversationId: params.conversationId,
    eventType: 'task.status.changed',
    actorType: 'user',
    actorId: params.actorUserId,
    payload: {
      fromStatus: params.fromStatus,
      toStatus: params.toStatus,
      taskTitle: params.task.title,
    },
  })

  // 调度大脑（feature P0-2）：状态变更统一上报点——路由/MCP/Agent 交付都收敛到这里，
  // 无主判定在 event-supervisor 内部做（有主事件零开销 skip）。
  if (params.fromStatus !== params.toStatus) {
    void publishWorkspaceBrainReview({
      kind: 'task.status.changed',
      projectId: params.project.id,
      actingUserId: params.actorUserId,
      actor: { type: 'user', id: params.actorUserId },
      eventKey: `task-status:${params.task.id}:${params.fromStatus}:${params.toStatus}:${params.task.updatedAt}`,
      task: {
        id: params.task.id,
        title: params.task.title,
        status: params.toStatus,
        projectId: params.project.id,
        assigneeId: params.task.assigneeId,
        assigneeAgentId: params.task.assigneeAgentId,
        assigneeAgentGroupId: params.task.assigneeAgentGroupId,
      },
    })
  }
}

export const recordChannelMessageAudit = (params: {
  projectId?: string
  taskId?: string
  conversationId: string
  channelBindingId?: string
  direction: 'inbound' | 'outbound'
  channelType: 'telegram' | 'feishu' | 'wechat' | 'discord' | 'slack' | 'wecom' | 'whatsapp' | 'dingtalk'
  senderId?: string
  externalChatId: string
  externalThreadId?: string
  externalMessageId?: string
}) => {
  recordAuditEvent({
    projectId: params.projectId,
    taskId: params.taskId,
    conversationId: params.conversationId,
    channelBindingId: params.channelBindingId,
    eventType: `channel.message.${params.direction}`,
    actorType: 'channel',
    actorId: params.senderId,
    payload: {
      channelType: params.channelType,
      externalChatId: params.externalChatId,
      externalThreadId: params.externalThreadId,
      externalMessageId: params.externalMessageId,
    },
  })
}

export const recordTaskAgentTurn = (params: {
  task: Task
  project: Project
  result: AgentMessageResult
  previousToolCalls: ToolCall[]
  conversationId?: string
  workspaceId?: string
  triggeredByUserId?: string
}) => {
  const session = ensureTaskAgentSession({
    task: params.task,
    project: params.project,
    workspaceId: params.workspaceId,
    agentSessionId: params.result.agentSessionId ?? params.result.opencodeSessionId,
    createdByUserId: params.triggeredByUserId,
    status: mapResultStatus(params.result),
  })

  const previousToolIds = new Set((params.previousToolCalls ?? []).map((toolCall) => toolCall.id))
  const newToolCalls = (params.result.toolCalls ?? []).filter((toolCall) => !previousToolIds.has(toolCall.id))

  for (const toolCall of newToolCalls) {
    saveAgentAction({
      id: crypto.randomUUID(),
      agentSessionId: session.id,
      actionType: `${session.runtime}.tool`,
      capabilityName: toolCall.name,
      input: parseJsonObject(toolCall.args),
      result: parseJsonObject(toolCall.result),
      status: toolCall.finishedAt ? 'completed' : 'started',
      approvalStatus: 'not_required',
      riskLevel: 'low',
      startedAt: toolCall.startedAt,
      finishedAt: toolCall.finishedAt,
    })
  }

  for (const title of params.result.approvalRequests ?? []) {
    const timestamp = new Date().toISOString()
    const actionId = crypto.randomUUID()

    saveAgentAction({
      id: actionId,
      agentSessionId: session.id,
      actionType: `${session.runtime}.permission`,
      capabilityName: title,
      input: { title },
      result: { status: 'pending' },
      status: 'waiting_approval',
      approvalStatus: 'pending',
      riskLevel: 'high',
      startedAt: timestamp,
    })

    const approvalRequestId = crypto.randomUUID()
    saveApprovalRequest({
      id: approvalRequestId,
      agentActionId: actionId,
      requestedByAgentSessionId: session.id,
      title,
      detail: `${session.runtime} 会话请求权限：${title}`,
      status: 'pending',
      riskLevel: 'high',
      createdAt: timestamp,
      updatedAt: timestamp,
    })

    recordAuditEvent({
      projectId: params.project.id,
      taskId: params.task.id,
      conversationId: params.conversationId,
      agentSessionId: session.id,
      approvalRequestId,
      eventType: 'approval.requested',
      actorType: 'agent',
      payload: {
        title,
        agentSessionId: params.result.agentSessionId ?? params.result.opencodeSessionId,
        opencodeSessionId: params.result.opencodeSessionId,
      },
    })
  }

  const turnStatus: 'completed' | 'failed' | 'waiting' =
    params.result.agentRunningStatus === 'waiting'
      ? 'waiting'
      : params.result.ok === false || params.result.agentRunningStatus === 'error'
        ? 'failed'
        : 'completed'

  recordAuditEvent({
    projectId: params.project.id,
    taskId: params.task.id,
    conversationId: params.conversationId,
    agentSessionId: session.id,
    eventType: `agent.turn.${turnStatus}`,
    actorType: 'agent',
    actorId: params.triggeredByUserId,
    payload: {
      ok: params.result.ok,
      status: turnStatus,
      currentStep: params.result.currentStep,
      outputPreview: (params.result.output ?? '').slice(0, 400),
      toolCallCount: newToolCalls.length,
      approvalRequestCount: (params.result.approvalRequests ?? []).length,
    },
  })

  return session
}
