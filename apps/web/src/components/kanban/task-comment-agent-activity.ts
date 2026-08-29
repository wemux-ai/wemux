/**
 * [INPUT]: Task-scoped Agent activities plus comment IDs or persisted Agent-event idempotency keys.
 * [OUTPUT]: Active activities processing a comment and the exact activity that produced an Agent comment.
 * [POS]: Pure comment-to-Agent-activity projection used by the task-detail comments UI.
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */
import type { TaskAgentActivityRecord } from '../../lib/api'

export type ActiveTaskCommentAgentActivity = TaskAgentActivityRecord & {
  status: 'pending' | 'running' | 'waiting'
}

const ACTIVE_STATUS_RANK: Record<ActiveTaskCommentAgentActivity['status'], number> = {
  running: 0,
  waiting: 1,
  pending: 2,
}

const AGENT_EVENT_COMMENT_IDEMPOTENCY_PREFIXES = [
  'task-agent-event-comment:',
  'task-delivery:',
] as const

const isActiveTaskCommentAgentActivity = (
  activity: TaskAgentActivityRecord,
): activity is ActiveTaskCommentAgentActivity => (
  activity.status === 'pending'
  || activity.status === 'running'
  || activity.status === 'waiting'
)

export const getTaskCommentActiveAgentActivities = (
  activities: TaskAgentActivityRecord[],
  commentId: string,
) => activities
  .filter(isActiveTaskCommentAgentActivity)
  .filter((activity) => (
    activity.commentId === commentId
    || activity.includedCommentIds.includes(commentId)
  ))
  .sort((left, right) => (
    ACTIVE_STATUS_RANK[left.status] - ACTIVE_STATUS_RANK[right.status]
    || right.createdAt.localeCompare(left.createdAt)
  ))

export const getTaskCommentLinkedAgentActivity = (
  activities: TaskAgentActivityRecord[],
  idempotencyKey?: string,
) => {
  const normalizedKey = idempotencyKey?.trim() ?? ''
  const prefix = AGENT_EVENT_COMMENT_IDEMPOTENCY_PREFIXES.find((candidate) => (
    normalizedKey.startsWith(candidate)
  ))
  if (!prefix) return undefined

  const eventId = normalizedKey.slice(prefix.length).trim()
  return eventId
    ? activities.find((activity) => activity.id === eventId)
    : undefined
}
