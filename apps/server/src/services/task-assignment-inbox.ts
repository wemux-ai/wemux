/**
 * [INPUT]: A task whose assignee just changed, plus the actor who made the change.
 * [OUTPUT]: Pure inbox publish intents: a directive for a new human assignee, an observe record for an Agent that was registered but not woken.
 * [POS]: Pure mapping from task assignment to inbox items; persistence stays in inbox-service.
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */
import { buildTaskInboxGroupKey } from '@shared/inbox'
import type { InboxActorType } from '@shared/inbox'
import type { Task } from '@shared/types'
import { listTaskWorkspaceBindings } from '../storage/app-state-store'
import type { InboxPublishInput } from './inbox-service'

export const TASK_ASSIGNMENT_INBOX_EVENT_TYPE = 'task.assigned'

/**
 * 指派给人是 directive：这是「有事等你做」，必须计入 badge。
 * Agent 侧的 task.assigned 走 agent-event-runtime，不经过这里。
 */
export const buildTaskAssignmentInboxItem = (params: {
  task: Task
  assigneeUserId: string
  actor: { type: InboxActorType; id?: string; name?: string }
  at?: string
}): InboxPublishInput => {
  const workspaceId = listTaskWorkspaceBindings(params.task.id)[0]?.workspaceId
  return {
    recipientType: 'user',
    recipientId: params.assigneeUserId,
    kind: 'directive',
    reason: 'assigned',
    eventType: TASK_ASSIGNMENT_INBOX_EVENT_TYPE,
    actor: params.actor,
    title: params.task.title,
    body: params.task.description?.trim() || '任务已指派给你。',
    scope: {
      projectId: params.task.projectId,
      taskId: params.task.id,
      ...(workspaceId ? { workspaceId } : {}),
    },
    // 与任务评论同组：指派和后续讨论在收件箱里是同一条线，不额外占一行。
    groupKey: buildTaskInboxGroupKey(params.task.id),
    replyTo: { kind: 'task_comment', taskId: params.task.id },
    // 同一个人被重复指派同一任务只投一次；换人再换回来会因 updatedAt 变化而重新投递。
    dedupeKey: `task-assigned:${params.task.id}:${params.assigneeUserId}:${params.task.updatedAt}`,
    createdAt: params.at,
  }
}

/**
 * 登记了负责 Agent 但没有唤醒它（Backlog 或 startMode='parked'）。
 *
 * 唤醒时不走这里：`publishAgentEvent` 内部的 `persistAgentEventInbox` 会产出一条
 * `directive`，这里再投一条就是双记录。所以这个 builder 只补「没唤醒」那一半 ——
 * 在此之前不唤醒等于收件箱里什么都没有，Agent 无从知道自己被登记为负责人。
 *
 * `observe` 意味着不计 badge、归入 following 区，与「有事等你做」区分开。
 */
export const buildTaskAssignmentAgentObserveItem = (params: {
  task: Task
  assigneeAgentId: string
  actor: { type: InboxActorType; id?: string; name?: string }
  /** 为什么没唤醒，进正文让 Agent 读到原因而不只是看到一条记录。 */
  reason: string
  at?: string
}): InboxPublishInput => {
  const workspaceId = listTaskWorkspaceBindings(params.task.id)[0]?.workspaceId
  return {
    recipientType: 'agent',
    recipientId: params.assigneeAgentId,
    kind: 'observe',
    reason: 'assigned',
    eventType: TASK_ASSIGNMENT_INBOX_EVENT_TYPE,
    actor: params.actor,
    title: params.task.title,
    body: params.reason,
    scope: {
      projectId: params.task.projectId,
      taskId: params.task.id,
      ...(workspaceId ? { workspaceId } : {}),
    },
    groupKey: buildTaskInboxGroupKey(params.task.id),
    replyTo: { kind: 'task_comment', taskId: params.task.id },
    // 与唤醒态的 key 分开命名空间，两者不会互相去重。
    dedupeKey: `task-assigned-parked:${params.task.id}:${params.assigneeAgentId}:${params.task.updatedAt}`,
    createdAt: params.at,
  }
}
