/**
 * [INPUT]: Shared inbox items for a user recipient.
 * [OUTPUT]: The legacy `UserMentionNotification` projection plus the待处理 badge count for the global bell.
 * [POS]: Compatibility boundary between the unified inbox and the existing notification UI contract.
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */
import type { InboxItem } from '@shared/inbox'
import type { UserMentionNotification } from '@shared/types'
import {
  archiveInboxItem,
  listInboxItems,
  markAllInboxItemsRead,
  markInboxItemRead,
} from './inbox-service'

/**
 * 把 inbox item 投影成前端已有的通知契约。分组、snooze、归档等新能力留在 inbox 层，
 * 等前端收件箱改造（P2）时再暴露。
 */
export const projectInboxItemToMentionNotification = (item: InboxItem): UserMentionNotification | null => {
  if (!item.scope.projectId || !item.scope.taskId || !item.scope.commentId) return null
  return {
    kind: 'task_comment',
    id: item.id,
    userId: item.recipientId,
    projectId: item.scope.projectId,
    taskId: item.scope.taskId,
    taskTitle: item.title,
    commentId: item.scope.commentId,
    comment: item.body,
    actorType: item.actorType,
    actorId: item.actorId,
    actorName: item.actorName,
    readAt: item.readAt,
    createdAt: item.createdAt,
  }
}

export const listUserMentionNotifications = async (userId: string, limit = 40) => {
  const { items, unreadGroups } = await listInboxItems({ recipientId: userId, limit })
  const notifications = items
    .map(projectInboxItemToMentionNotification)
    .filter((notification): notification is UserMentionNotification => notification !== null)

  return { notifications, unreadCount: unreadGroups }
}

export const markUserMentionNotificationRead = async (userId: string, notificationId: string) => (
  markInboxItemRead(userId, notificationId)
)

export const markAllUserMentionNotificationsRead = async (userId: string) => {
  await markAllInboxItemsRead(userId)
}

export const archiveUserMentionNotification = async (userId: string, notificationId: string) => (
  archiveInboxItem(userId, notificationId)
)
