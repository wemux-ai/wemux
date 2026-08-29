/**
 * [INPUT]: Task creator/comments/history, task-scoped Agent activities, TaskRun history, and bound workspace sessions.
 * [OUTPUT]: A deterministic collaboration Timeline projection with explicit workspace/task context and without delivery or acceptance semantics.
 * [POS]: Pure task-detail view-model builder; mutation and persistence remain owned by server task/runtime services.
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */
import type { Task, Workspace, WorkspaceSession } from '@shared/types'

import type { TaskAgentActivityRecord } from '../../lib/api'

export type TaskTimelineCategory = 'collaboration' | 'agent' | 'workspace'

export type TaskTimelineEntryKind =
  | 'created'
  | 'assignment'
  | 'comment'
  | 'mention'
  | 'agent_queued'
  | 'agent_running'
  | 'agent_waiting'
  | 'agent_finished'
  | 'workspace_queued'
  | 'workspace_running'
  | 'workspace_waiting'
  | 'workspace_changed'
  | 'workspace_finished'

export interface TaskTimelineActor {
  type: 'user' | 'agent' | 'system'
  id?: string
  name: string
  avatarUrl?: string
}

export interface TaskTimelineEntry {
  id: string
  category: TaskTimelineCategory
  kind: TaskTimelineEntryKind
  at: string
  title: string
  detail?: string
  actor?: TaskTimelineActor
  mentions?: string[]
  activityId?: string
  activityLabel?: string
  workspaceId?: string
  workspaceSessionId?: string
}

const isDeliveryComment = (comment: Task['comments'][number]) => (
  comment.idempotencyKey?.startsWith('task-delivery:') === true
)

const describeComment = (comment: Task['comments'][number]) => {
  if (comment.deletedAt) return '评论已删除'
  if (comment.content.trim()) return comment.content.trim()
  const attachmentCount = comment.attachments?.length ?? 0
  return attachmentCount > 0 ? `添加了 ${attachmentCount} 个附件` : undefined
}

const toCommentActor = (comment: Task['comments'][number]): TaskTimelineActor => ({
  type: comment.authorType === 'agent' ? 'agent' : comment.authorType === 'system' ? 'system' : 'user',
  id: comment.authorId,
  name: comment.authorName || (comment.authorType === 'agent' ? 'Agent' : '团队成员'),
  avatarUrl: comment.authorAvatarUrl,
})

const buildCreatedEntry = (task: Task): TaskTimelineEntry => {
  const actor = task.createdBy ? {
    type: task.createdBy.type,
    id: task.createdBy.id,
    name: task.createdBy.name,
    avatarUrl: task.createdBy.avatarUrl,
  } : undefined

  return {
    id: `created:${task.id}`,
    category: 'collaboration',
    kind: 'created',
    at: task.createdAt,
    title: actor ? `${actor.name} 创建了任务` : '创建了任务',
    actor,
  }
}

const buildAssignmentEntries = (task: Task): TaskTimelineEntry[] => task.history.flatMap((entry) => {
  if (entry.kind !== 'assignment') return []
  const actorName = entry.actor?.name
  const targetName = entry.assignee?.name
  return [{
    id: `assignment:${entry.id}`,
    category: 'collaboration' as const,
    kind: 'assignment' as const,
    at: entry.at,
    title: targetName
      ? `${actorName ? `${actorName} ` : ''}指派给 ${targetName}`
      : `${actorName ? `${actorName} ` : ''}清除了负责人`,
    actor: entry.actor,
  }]
})

const buildCommentEntries = (task: Task): TaskTimelineEntry[] => task.comments.flatMap((comment) => {
  if (isDeliveryComment(comment)) return []
  const mentionNames = Array.from(new Set((comment.mentions ?? []).map((mention) => mention.targetName).filter(Boolean)))
  const actor = toCommentActor(comment)
  const kind = mentionNames.length > 0 ? 'mention' as const : 'comment' as const
  const mentionSummary = mentionNames.length > 0 ? `并提及 ${mentionNames.join('、')}` : ''
  return [{
    id: `comment:${comment.id}`,
    category: 'collaboration' as const,
    kind,
    at: comment.createdAt,
    title: `${actor.name} 留下评论${mentionSummary}`,
    detail: describeComment(comment),
    actor,
    mentions: mentionNames,
  }]
})

const hasMatchingAssignmentEntry = (task: Task, activity: TaskAgentActivityRecord) => task.history.some((entry) => (
  entry.kind === 'assignment'
  && entry.assignee?.type === 'agent'
  && entry.assignee.id === activity.agentId
  && Math.abs(Date.parse(entry.at) - Date.parse(activity.createdAt)) < 5_000
))

export const describeTaskAgentActivityTrigger = (activity: TaskAgentActivityRecord) => {
  switch (activity.triggerKind) {
    case 'assignment': return '任务指派'
    case 'mention': return '评论 @Agent'
    case 'reply': return '评论回复'
    case 'assignee': return '负责人评论'
    case 'status': return '移出 Backlog'
    case 'manual_start': return '手动启动'
    case 'workspace_completed': return '工作区完成通知'
    case 'workspace_waiting': return '工作区等待通知'
    case 'workspace_failed': return '工作区失败通知'
    default: return activity.eventType
  }
}

const buildAgentActivityEntries = (
  task: Task,
  activities: TaskAgentActivityRecord[],
): TaskTimelineEntry[] => activities.flatMap((activity) => {
  const actor: TaskTimelineActor = {
    type: 'agent',
    id: activity.agentId,
    name: activity.agentName,
    avatarUrl: activity.agentAvatarUrl,
  }
  const workspaceAttentionTitle = activity.eventType === 'workspace.session.completed'
    ? `${activity.agentName} 已收到工作区完成通知`
    : activity.eventType === 'workspace.session.waiting'
      ? `${activity.agentName} 已收到工作区等待通知`
      : activity.eventType === 'workspace.session.failed'
        ? `${activity.agentName} 已收到工作区失败通知`
        : `${activity.agentName} 已加入处理队列`
  const activityLabel = `${describeTaskAgentActivityTrigger(activity)} · 第 ${activity.attempt} 次`
  const entries: TaskTimelineEntry[] = []

  if (activity.eventType === 'task.assigned' && !hasMatchingAssignmentEntry(task, activity)) {
    entries.push({
      id: `activity:${activity.id}:assignment`,
      category: 'collaboration',
      kind: 'assignment',
      at: activity.createdAt,
      title: `${activity.triggerActorName ? `${activity.triggerActorName} ` : ''}指派给 ${activity.agentName}`,
      actor: activity.triggerActorName ? {
        type: activity.triggerActorType,
        id: activity.triggerActorId,
        name: activity.triggerActorName,
      } : undefined,
    })
  }

  entries.push({
    id: `activity:${activity.id}:queued`,
    category: 'agent',
    kind: 'agent_queued',
    at: activity.createdAt,
    title: workspaceAttentionTitle,
    detail: activity.comment?.trim() || undefined,
    actor,
    activityId: activity.id,
    activityLabel,
  })

  if (activity.startedAt) {
    entries.push({
      id: `activity:${activity.id}:running`,
      category: 'agent',
      kind: 'agent_running',
      at: activity.startedAt,
      title: `${activity.agentName} 开始运行`,
      detail: activity.completedAt ? undefined : activity.summaryPreview,
      actor,
      activityId: activity.id,
      activityLabel,
    })
  }

  if (activity.status === 'waiting') {
    entries.push({
      id: `activity:${activity.id}:waiting`,
      category: 'agent',
      kind: 'agent_waiting',
      at: activity.updatedAt || activity.lastHeartbeatAt || activity.startedAt || activity.createdAt,
      title: `${activity.agentName} 正在等待`,
      detail: activity.summaryPreview,
      actor,
      activityId: activity.id,
      activityLabel,
    })
  }

  if (activity.completedAt) {
    const title = activity.status === 'failed'
      ? `${activity.agentName} 运行失败`
      : activity.status === 'canceled'
        ? `${activity.agentName} 的运行已取消`
        : `${activity.agentName} 结束本轮处理`
    entries.push({
      id: `activity:${activity.id}:finished`,
      category: 'agent',
      kind: 'agent_finished',
      at: activity.completedAt,
      title,
      detail: activity.failureMessage || activity.summaryPreview,
      actor,
      activityId: activity.id,
      activityLabel,
    })
  }

  return entries
})

const workspaceStatusTitle = (status: Task['executionHistory'][number]['status']) => {
  if (status === 'completed') return '工作区执行结束'
  if (status === 'failed') return '工作区执行失败'
  if (status === 'cancelled') return '工作区执行已取消'
  if (status === 'timed_out') return '工作区执行超时'
  if (status === 'lost') return '工作区执行连接丢失'
  if (status === 'syncing_back') return '工作区正在同步修改'
  return '工作区正在运行'
}

const buildWorkspaceRunEntries = (
  task: Task,
  workspaces: Workspace[],
): TaskTimelineEntry[] => {
  const workspaceById = new Map(workspaces.map((workspace) => [workspace.id, workspace]))
  return task.executionHistory.flatMap((run) => {
    if (!run.workspaceId) return []
    const workspace = workspaceById.get(run.workspaceId)
    const workspaceName = workspace?.name || '工作区'
    const taskLabel = `任务「${task.title}」`
    const branch = run.baseBranch?.trim()
    const entries: TaskTimelineEntry[] = [{
      id: `workspace-run:${run.id}:queued`,
      category: 'workspace',
      kind: 'workspace_queued',
      at: run.createdAt,
      title: `工作区「${workspaceName}」已加入执行队列`,
      detail: [taskLabel, branch ? `起始分支 ${branch}` : undefined].filter(Boolean).join(' · '),
      workspaceId: run.workspaceId,
      workspaceSessionId: run.workspaceSessionId,
    }]

    if (run.status === 'queued' || run.status === 'draft' || run.status === 'planned') return entries

    const filesChanged = run.result?.filesChanged ?? []
    const changed = run.status === 'completed' && filesChanged.length > 0
    entries.push({
      id: `workspace-run:${run.id}:status`,
      category: 'workspace',
      kind: changed
        ? 'workspace_changed'
        : run.status === 'completed' || run.status === 'failed' || run.status === 'cancelled' || run.status === 'timed_out' || run.status === 'lost'
          ? 'workspace_finished'
          : 'workspace_running',
      at: run.updatedAt,
      title: changed
        ? `工作区「${workspaceName}」修改了 ${filesChanged.length} 个文件`
        : `工作区「${workspaceName}」· ${workspaceStatusTitle(run.status)}`,
      detail: changed
        ? [taskLabel, filesChanged.slice(0, 5).join('、')].filter(Boolean).join(' · ')
        : taskLabel,
      workspaceId: run.workspaceId,
      workspaceSessionId: run.workspaceSessionId,
    })
    return entries
  })
}

const buildWorkspaceWaitingEntries = (
  task: Task,
  sessions: WorkspaceSession[],
  workspaces: Workspace[],
): TaskTimelineEntry[] => {
  const workspaceIds = new Set(task.executionHistory.map((run) => run.workspaceId).filter(Boolean))
  const workspaceById = new Map(workspaces.map((workspace) => [workspace.id, workspace]))
  return sessions.flatMap((session) => {
    if (session.runtimeStatus !== 'waiting') return []
    if (!workspaceIds.has(session.workspaceId) && !task.executionHistory.some((run) => run.workspaceSessionId === session.id)) return []
    const workspaceName = workspaceById.get(session.workspaceId)?.name || '工作区'
    return [{
      id: `workspace-session:${session.id}:waiting`,
      category: 'workspace' as const,
      kind: 'workspace_waiting' as const,
      at: session.lastRuntimeEventAt || session.updatedAt,
      title: `工作区「${workspaceName}」会话正在等待`,
      detail: `任务「${task.title}」`,
      workspaceId: session.workspaceId,
      workspaceSessionId: session.id,
    }]
  })
}

export const buildTaskTimelineEntries = (params: {
  task: Task
  activities: TaskAgentActivityRecord[]
  workspaces: Workspace[]
  workspaceSessions: WorkspaceSession[]
}) => [
  buildCreatedEntry(params.task),
  ...buildAssignmentEntries(params.task),
  ...buildCommentEntries(params.task),
  ...buildAgentActivityEntries(params.task, params.activities),
  ...buildWorkspaceRunEntries(params.task, params.workspaces),
  ...buildWorkspaceWaitingEntries(params.task, params.workspaceSessions, params.workspaces),
].sort((left, right) => (
  right.at.localeCompare(left.at)
  || left.id.localeCompare(right.id)
))
