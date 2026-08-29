/**
 * [INPUT]: A task, one persisted comment, the typed comment author, and the target human recipient.
 * [OUTPUT]: A pure inbox publish intent describing why the recipient got it and where a reply should go.
 * [POS]: Pure mapping from task comments to inbox items; persistence stays in inbox-service.
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */
import { buildTaskInboxGroupKey, type InboxItemKind, type InboxItemReason } from '@shared/inbox'
import type { Task, TaskComment } from '@shared/types'
import { listTaskWorkspaceBindings } from '../storage/app-state-store'
import type { InboxPublishInput } from './inbox-service'
import type { TaskCommentAuthor } from './task-comment-service'

export const TASK_COMMENT_INBOX_EVENT_TYPE = 'task.comment.mentioned'

/** 为什么收到这条：被 @ 是 mention（计 badge），只是关注是 observe（不计 badge）。 */
export type TaskCommentInboxTrigger = 'mentioned' | 'replied' | 'subscribed'

const KIND_BY_TRIGGER: Record<TaskCommentInboxTrigger, InboxItemKind> = {
  mentioned: 'mention',
  replied: 'mention',
  subscribed: 'observe',
}

const REASON_BY_TRIGGER: Record<TaskCommentInboxTrigger, InboxItemReason> = {
  mentioned: 'mentioned',
  replied: 'replied',
  subscribed: 'subscribed',
}

export const buildTaskCommentInboxBody = (comment: TaskComment) => {
  const attachmentSummary = comment.attachments?.length
    ? `[附件] ${comment.attachments.map((attachment) => attachment.filename).join('、')}`
    : ''
  return comment.content.trim() || attachmentSummary
}

export const buildTaskCommentInboxItem = (params: {
  task: Task
  comment: TaskComment
  author: TaskCommentAuthor
  targetUserId: string
  trigger: TaskCommentInboxTrigger
}): InboxPublishInput => {
  const workspaceId = listTaskWorkspaceBindings(params.task.id)[0]?.workspaceId
  return {
    recipientType: 'user',
    recipientId: params.targetUserId,
    kind: KIND_BY_TRIGGER[params.trigger],
    reason: REASON_BY_TRIGGER[params.trigger],
    eventType: TASK_COMMENT_INBOX_EVENT_TYPE,
    actor: { type: params.author.type, id: params.author.id, name: params.author.name },
    title: params.task.title,
    body: buildTaskCommentInboxBody(params.comment),
    scope: {
      projectId: params.task.projectId,
      taskId: params.task.id,
      commentId: params.comment.id,
      ...(workspaceId ? { workspaceId } : {}),
    },
    groupKey: buildTaskInboxGroupKey(params.task.id),
    replyTo: {
      kind: 'task_comment',
      taskId: params.task.id,
      parentCommentId: params.comment.parentCommentId ?? params.comment.id,
    },
    dedupeKey: `task-comment:${params.comment.id}`,
    createdAt: params.comment.createdAt,
  }
}
