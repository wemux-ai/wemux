/**
 * [INPUT]: Task assignment mutations plus authenticated actor and target identifiers.
 * [OUTPUT]: Task records with a durable structured assignment-history entry.
 * [POS]: Server identity-resolution boundary for the task Timeline; it does not perform assignment authorization.
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */
import { readCustomAgentConfig } from '@shared/custom-agent'
import { appendTaskAssignmentHistory } from '@shared/task-history'
import type { Task, TaskHistoryIdentity } from '@shared/types'

import { getAgent } from '../repositories/agent'
import { getUserById } from '../repositories/auth'

const resolveUserIdentity = (userId?: string): TaskHistoryIdentity | undefined => {
  if (!userId) return undefined
  const user = getUserById(userId)
  return {
    type: 'user',
    id: userId,
    name: user?.name || userId,
    avatarUrl: user?.avatarUrl,
  }
}

const resolveAgentIdentity = (agentId?: string): TaskHistoryIdentity | undefined => {
  if (!agentId) return undefined
  const agent = getAgent(agentId)
  if (!agent) {
    return { type: 'agent', id: agentId, name: agentId }
  }
  const profile = readCustomAgentConfig(agent.config)
  return {
    type: 'agent',
    id: agent.id,
    name: agent.name,
    avatarUrl: profile.avatarUrl || undefined,
  }
}

export const recordTaskAssignmentHistory = (params: {
  task: Task
  actorUserId?: string
  actor?: TaskHistoryIdentity
  assigneeId?: string
  assigneeAgentId?: string
  at?: string
}) => appendTaskAssignmentHistory(params.task, {
  actor: params.actor ?? resolveUserIdentity(params.actorUserId),
  assignee: resolveAgentIdentity(params.assigneeAgentId) ?? resolveUserIdentity(params.assigneeId),
  at: params.at,
})
