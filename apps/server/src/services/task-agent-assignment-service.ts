/**
 * [INPUT]: Project/workspace-scoped user assignment requests, Agent visibility policy, and workspace Squad records.
 * [OUTPUT]: A validated direct Agent or explicit Squad leader assignment target shared by HTTP, comments, and MCP.
 * [POS]: Canonical task-Agent access policy; explicit project/workspace sharing can cross owners, Squad leadership never follows member order.
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */
import {
  hasCustomAgentScopeRestrictions,
  isCustomAgentAccessible,
  isCustomAgentEnabled,
  matchesCustomAgentScope,
  readCustomAgentConfig,
} from '@shared/custom-agent'
import type { AgentRecord, Project, WorkspaceSessionAgentInvocationMode } from '@shared/types'
import { getWorkspaceGroupConversationDetail } from '../control-plane/conversation-service'
import { getAgent } from '../repositories/agent'

export const resolveWorkspaceGroupLeaderId = (
  detail: {
    conversation: { orchestratorAgentId?: string }
    members: Array<{ memberType: string; memberId: string }>
  } | null,
) => {
  if (!detail) return null
  const leaderAgentId = detail.conversation.orchestratorAgentId?.trim()
  if (!leaderAgentId) return null
  return detail.members.some((member) => (
    member.memberType === 'agent' && member.memberId === leaderAgentId
  )) ? leaderAgentId : null
}

export const resolveCustomAgentProjectAccess = (params: {
  agent: AgentRecord
  userId?: string
  projectId: string
  collaborationWorkspaceId?: string
  mode: WorkspaceSessionAgentInvocationMode
}) => {
  if (params.agent.type.trim().toLowerCase() === 'main') {
    return { ok: false as const, status: 404 as const, message: 'Agent 负责人不存在。' }
  }

  const profile = readCustomAgentConfig(params.agent.config)
  if (!isCustomAgentEnabled(profile)) {
    return { ok: false as const, status: 409 as const, message: 'Agent 负责人当前不可用。' }
  }
  if (!profile.allowedModes.includes(params.mode)) {
    return {
      ok: false as const,
      status: 403 as const,
      message: params.mode === 'mention'
        ? '该 Agent 未开启 @ 调用。'
        : '该 Agent 未开启任务委派。',
    }
  }

  const accessible = isCustomAgentAccessible(profile, {
    userId: params.userId?.trim() || '',
    ownerUserId: params.agent.ownerUserId,
    workspaceId: params.collaborationWorkspaceId,
    projectId: params.projectId,
  })
  if (!accessible) {
    return { ok: false as const, status: 403 as const, message: '该 Agent 未开放给当前项目或组织。' }
  }

  return { ok: true as const, agent: params.agent, profile }
}

const validateAgentAssignment = (params: {
  project: Project
  userId: string
  agentId: string
}) => {
  const agent = getAgent(params.agentId)
  if (!agent || agent.type.trim().toLowerCase() === 'main') {
    return { ok: false as const, status: 404 as const, message: 'Agent 负责人不存在。' }
  }

  const access = resolveCustomAgentProjectAccess({
    agent,
    userId: params.userId,
    projectId: params.project.id,
    collaborationWorkspaceId: params.project.workspaceId,
    mode: 'delegate',
  })
  if (!access.ok) return access

  return {
    ok: true as const,
    agentId: agent.id,
    agentGroupId: undefined,
    agentGroupTitle: undefined,
  }
}

export const resolveTaskAgentAssignment = (params: {
  project: Project
  userId: string
  assigneeAgentId?: string
  assigneeAgentGroupId?: string
}) => {
  const agentId = params.assigneeAgentId?.trim()
  const groupId = params.assigneeAgentGroupId?.trim()
  if (agentId && groupId) {
    return { ok: false as const, status: 400 as const, message: 'Agent 与 Squad 负责人不能同时设置。' }
  }
  if (agentId) {
    return validateAgentAssignment({ project: params.project, userId: params.userId, agentId })
  }
  if (!groupId) {
    return { ok: true as const, agentId: undefined, agentGroupId: undefined, agentGroupTitle: undefined }
  }
  if (!params.project.workspaceId) {
    return { ok: false as const, status: 400 as const, message: '当前项目没有可用的组织 Squad。' }
  }

  const detail = getWorkspaceGroupConversationDetail(params.project.workspaceId, groupId)
  if (!detail) {
    return { ok: false as const, status: 404 as const, message: 'Squad 不存在。' }
  }
  if (!detail.members.some((member) => member.memberType === 'user' && member.memberId === params.userId)) {
    return { ok: false as const, status: 403 as const, message: '当前用户不是该 Squad 成员。' }
  }

  const leaderAgentId = resolveWorkspaceGroupLeaderId(detail)
  if (!leaderAgentId) {
    return { ok: false as const, status: 409 as const, message: '该 Squad 尚未设置明确负责人。' }
  }
  const agentResult = validateAgentAssignment({ project: params.project, userId: params.userId, agentId: leaderAgentId })
  if (!agentResult.ok) return agentResult

  return {
    ok: true as const,
    agentId: agentResult.agentId,
    agentGroupId: groupId,
    agentGroupTitle: detail.conversation.title,
  }
}
