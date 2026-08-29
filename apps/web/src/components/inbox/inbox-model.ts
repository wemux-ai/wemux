/**
 * [INPUT]: Inbox route search values, timestamps, and shared item reasons.
 * [OUTPUT]: Pure section parsing, labels, relative time, and snooze preset helpers.
 * [POS]: Presentation model shared by the global Inbox route components.
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */
import type { InboxItemReason, InboxQueryScope } from '@shared/inbox'

export type InboxPageSection = 'all' | 'action' | 'following' | 'archived'
export type InboxSnoozePreset = 'hour' | 'tomorrow' | 'week'

export const INBOX_PAGE_SECTIONS: readonly InboxPageSection[] = ['all', 'action', 'following', 'archived']

/** 默认落「全部」：人打开收件箱先要看到全貌，再自己收窄到待处理。 */
export const parseInboxPageSection = (value: unknown): InboxPageSection => (
  typeof value === 'string' && INBOX_PAGE_SECTIONS.includes(value as InboxPageSection)
    ? value as InboxPageSection
    : 'all'
)

/** 全部 section 都是 inbox_items 的服务端读取范围。 */
export const toInboxSection = (section: InboxPageSection): InboxQueryScope => section

export const inboxSectionLabel = (section: InboxPageSection, language: string) => {
  const labels: Record<InboxPageSection, [string, string]> = {
    all: ['全部', 'All'],
    action: ['待处理', 'Action'],
    following: ['关注', 'Following'],
    archived: ['已归档', 'Archived'],
  }
  return labels[section][language === 'zh' ? 0 : 1]
}

export const inboxReasonLabel = (reason: InboxItemReason, language: string) => {
  const labels: Record<InboxItemReason, [string, string]> = {
    assigned: ['已指派', 'Assigned'],
    started: ['已开始', 'Started'],
    mentioned: ['提及了你', 'Mentioned you'],
    replied: ['回复了你', 'Replied'],
    subscribed: ['关注更新', 'Following'],
    workspace_completed: ['工作已完成', 'Work completed'],
    workspace_failed: ['工作失败', 'Work failed'],
    workspace_needs_input: ['需要输入', 'Needs input'],
    status_changed: ['状态更新', 'Status changed'],
    handoff_requested: ['请求交接', 'Handoff requested'],
    handoff_returned: ['交接退回', 'Handoff returned'],
    quick_create: ['快速创建', 'Quick create'],
    generic_event: ['新动态', 'New activity'],
  }
  return labels[reason][language === 'zh' ? 0 : 1]
}

/** 好友请求 / 加入邀请等事件类型的行内归因（优先于 reason 通用文案）。 */
export const inboxEventTypeReasonLabel = (eventType: string, language: string) => {
  const labels: Record<string, [string, string]> = {
    'user.connection.requested': ['好友请求', 'Friend request'],
    'user.connection.accepted': ['已成为好友', 'Connected'],
    'team.invitation.sent': ['加入邀请', 'Invitation'],
    'dm.message': ['私聊消息', 'Direct message'],
    'workspace.group_chat.mentioned': ['群聊提及', 'Group mention'],
  }
  const entry = labels[eventType]
  return entry ? entry[language === 'zh' ? 0 : 1] : ''
}

export const formatInboxRelativeTime = (value: string, language: string, now = Date.now()) => {
  const timestamp = new Date(value).getTime()
  if (!Number.isFinite(timestamp)) return ''
  const delta = Math.max(0, now - timestamp)
  const minute = 60_000
  const hour = 60 * minute
  const day = 24 * hour
  if (delta < minute) return language === 'zh' ? '刚刚' : 'Now'
  if (delta < hour) {
    const count = Math.max(1, Math.floor(delta / minute))
    return language === 'zh' ? `${count} 分钟前` : `${count}m`
  }
  if (delta < day) {
    const count = Math.max(1, Math.floor(delta / hour))
    return language === 'zh' ? `${count} 小时前` : `${count}h`
  }
  if (delta < 7 * day) {
    const count = Math.max(1, Math.floor(delta / day))
    return language === 'zh' ? `${count} 天前` : `${count}d`
  }
  return new Date(timestamp).toLocaleDateString(language === 'zh' ? 'zh-CN' : 'en-US', {
    month: 'short',
    day: 'numeric',
  })
}

export const resolveInboxSnoozeUntil = (preset: InboxSnoozePreset, now = new Date()) => {
  const target = new Date(now)
  if (preset === 'hour') target.setHours(target.getHours() + 1)
  if (preset === 'tomorrow') {
    target.setDate(target.getDate() + 1)
    target.setHours(9, 0, 0, 0)
  }
  if (preset === 'week') {
    target.setDate(target.getDate() + 7)
    target.setHours(9, 0, 0, 0)
  }
  return target.toISOString()
}
