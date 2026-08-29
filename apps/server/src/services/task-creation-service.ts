/**
 * [INPUT]: A validated project, trusted creator identity, task form fields, and app runtime defaults.
 * [OUTPUT]: One normalized Task record shared by HTTP, MCP, and Agent quick-create entry points.
 * [POS]: Canonical Task construction boundary; callers own authorization, persistence, and dispatch side effects.
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */
import { createTaskFromRequirement } from '@shared/task-orchestrator'
import type { AgentConfig, CreatorIdentity, Project, Task, TaskOriginType, TaskStatus } from '@shared/types'
import { recordTaskAssignmentHistory } from './task-assignment-history-service'

export type CreateTaskRecordInput = {
  project: Project
  config?: Pick<AgentConfig, 'workspaceRoot'>
  actingUserId: string
  creator: CreatorIdentity
  description: string
  title?: string
  parentTaskId?: string
  priority?: Task['priority']
  status?: TaskStatus
  startedAt?: string
  dueAt?: string
  acceptanceCriteria?: string
  draftId?: string
  draftSavedAt?: string
  recommendedTitle?: string
  baseBranchHint?: string
  requirementType?: Task['requirementType']
  assigneeId?: string
  assigneeAgentId?: string
  assigneeAgentGroupId?: string
  agentManaged?: Task['agentManaged']
  agentType?: Task['agentType']
  executionModel?: Task['executionModel']
  opencodeConfig?: Task['opencodeConfig']
  originType?: TaskOriginType
  originId?: string
}

export const createTaskRecord = (input: CreateTaskRecordInput): Task => {
  const requirementType = input.requirementType ?? 'task'
  const status = requirementType === 'requirement' ? 'backlog' : input.status ?? 'todo'
  const baseBranchHint = input.baseBranchHint?.trim()
    || input.project.recentBaseBranches?.[0]
    || input.project.defaultBranch
    || 'main'
  let task: Task = {
    ...createTaskFromRequirement(
      input.project,
      input.description,
      'medium',
      input.title,
      input.agentManaged,
      input.agentType,
      input.executionModel,
      undefined,
      input.config,
      input.opencodeConfig,
    ),
    parentTaskId: input.parentTaskId,
    createdBy: input.creator,
    originType: input.originType,
    originId: input.originId?.trim() || undefined,
    assigneeId: input.assigneeAgentId ? undefined : input.assigneeId,
    assigneeAgentId: input.assigneeAgentId,
    assigneeAgentGroupId: input.assigneeAgentGroupId,
    status,
    acceptanceCriteria: input.acceptanceCriteria?.trim() || undefined,
    priority: input.priority ?? 'none',
    startedAt: input.startedAt,
    dueAt: input.dueAt,
    draftId: input.draftId?.trim() || undefined,
    draftSavedAt: input.draftSavedAt?.trim() || undefined,
    recommendedTitle: input.recommendedTitle?.trim() || undefined,
    baseBranchHint,
    requirementType,
  }

  if (task.assigneeId || task.assigneeAgentId) {
    task = recordTaskAssignmentHistory({
      task,
      actorUserId: input.actingUserId,
      assigneeId: task.assigneeId,
      assigneeAgentId: task.assigneeAgentId,
      at: task.createdAt,
    })
  }

  return task
}

export const findTaskByOrigin = (
  tasks: Task[],
  originType: TaskOriginType,
  originId: string,
) => tasks.find((task) => task.originType === originType && task.originId === originId) ?? null
