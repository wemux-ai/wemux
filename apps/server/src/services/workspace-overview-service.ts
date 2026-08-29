// [INPUT]: 协作组织 ID
// [OUTPUT]: 组织组织概览（成员/Agent 卡片：进行中任务 + 待跟进任务 + 最近工作记录 + Agent 完成率）
// [POS]: 工作记录可见性聚合层；纯确定性组装（零 LLM 调用）；隔离由路由层 isWorkspaceMember 保证
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import type { WorkRecord } from '@shared/types'
import { readCustomAgentConfig } from '@shared/custom-agent'
import { loadState } from '../storage/app-state-store'
import { getAllAgents } from '../storage/postgres/agent-store'
import { listWorkspaceMembers, listWorkspaceProjects } from '../repositories/workspace'
import { listWorkRecords } from '../repositories/profile-store'
import { scoreFromWorkRecords } from './agent-health-score'

const RECENT_LIMIT = 50
const SCORE_RECORD_LIMIT = 200

/** 需要管理者跟进的非进行中状态：阻塞 / 待审核 */
const ATTENTION_STATUSES = new Set(['in_review', 'blocked'])

const summarizeTask = (task: { id: string; title: string; status: string }) => ({
  id: task.id,
  title: task.title,
  status: task.status,
})

const summarizeRecord = (record: WorkRecord) => ({
  id: record.id,
  recordType: record.recordType,
  title: record.title,
  targetType: record.targetType,
  targetId: record.targetId,
  occurredAt: record.occurredAt,
})

export type WorkspaceOverview = {
  workspaceId: string
  members: Array<{
    userId: string
    name: string
    avatarUrl: string | null
    role: string
    inProgressTasks: Array<{ id: string; title: string; status: string }>
    attentionTasks: Array<{ id: string; title: string; status: string }>
    recent: Array<ReturnType<typeof summarizeRecord>>
  }>
  agents: Array<{
    agentId: string
    name: string
    avatarUrl: string | null
    ownerUserId: string | null
    healthScore: number | null
    /** 完成率样本（近 SCORE_RECORD_LIMIT 条工作记录）；无任何记录时为 null */
    healthSample: { completed: number; dispatched: number } | null
    inProgressTasks: Array<{ id: string; title: string; status: string }>
    attentionTasks: Array<{ id: string; title: string; status: string }>
    recent: Array<ReturnType<typeof summarizeRecord>>
  }>
}

export const getWorkspaceOverview = async (workspaceId: string): Promise<WorkspaceOverview> => {
  const [members, projects] = await Promise.all([
    listWorkspaceMembers(workspaceId),
    listWorkspaceProjects(workspaceId),
  ])
  const projectIds = new Set(projects.map((project) => project.projectId))
  const memberIds = new Set(members.map((member) => member.id))
  const state = loadState()

  const inProgressTasks = state.tasks.filter(
    (task) => projectIds.has(task.projectId) && task.status === 'in_progress',
  )
  const attentionTasks = state.tasks.filter(
    (task) => projectIds.has(task.projectId) && ATTENTION_STATUSES.has(task.status),
  )
  const agents = getAllAgents().filter((agent) => agent.ownerUserId && memberIds.has(agent.ownerUserId))

  const memberCards = await Promise.all(members.map(async (member) => {
    const records = await listWorkRecords('user', member.id, RECENT_LIMIT)
    return {
      userId: member.id,
      name: member.name,
      avatarUrl: member.avatarUrl ?? null,
      role: member.role,
      inProgressTasks: inProgressTasks.filter((task) => task.assigneeId === member.id).map(summarizeTask),
      attentionTasks: attentionTasks.filter((task) => task.assigneeId === member.id).map(summarizeTask),
      recent: records.map(summarizeRecord),
    }
  }))

  const agentCards = await Promise.all(agents.map(async (agent) => {
    // 拉取近 SCORE_RECORD_LIMIT 条：现算完成率（不依赖可能过期的画像快照）+ 提供样本量
    const records = await listWorkRecords('agent', agent.id, SCORE_RECORD_LIMIT)
    const completed = records.filter((record) => record.recordType === 'task_completed').length
    const dispatched = records.filter((record) => record.recordType === 'task_dispatched').length
    const customConfig = readCustomAgentConfig(agent.config)
    return {
      agentId: agent.id,
      name: agent.name,
      avatarUrl: customConfig.avatarUrl.trim() || null,
      ownerUserId: agent.ownerUserId ?? null,
      healthScore: scoreFromWorkRecords(records),
      healthSample: records.length === 0 ? null : { completed, dispatched },
      inProgressTasks: inProgressTasks.filter((task) => task.assigneeAgentId === agent.id).map(summarizeTask),
      attentionTasks: attentionTasks.filter((task) => task.assigneeAgentId === agent.id).map(summarizeTask),
      recent: records.slice(0, RECENT_LIMIT).map(summarizeRecord),
    }
  }))

  return { workspaceId, members: memberCards, agents: agentCards }
}
