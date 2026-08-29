/**
 * [INPUT]: Inbox delivery intents from task comments, group chat mentions, assignments and Agent events.
 * [OUTPUT]: One inbox item contract shared by human and Agent recipients, plus pure kind/badge helpers.
 * [POS]: Canonical inbox contract; `kind` decides sectioning and badge counting, `replyTo` isolates channel differences.
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */

export type InboxRecipientType = 'user' | 'agent'
export type InboxActorType = 'user' | 'agent' | 'system'

/**
 * 待办性质。决定归入哪个 section、是否计入 badge。
 *
 * 注意：不决定 Agent 是否被唤醒。唤醒由投递方是否调用 `publishAgentEvent` 决定，
 * Agent 侧的 inbox item 是那次唤醒的产物而非触发器。`observe` 用于「登记了负责人
 * 但没有唤醒」，让这种情况在 Agent 收件箱里留痕而不误报成待办。
 */
export type InboxItemKind = 'directive' | 'mention' | 'handoff' | 'observe'

/** 为什么会收到这条。用于收件箱行内归因展示。 */
export type InboxItemReason =
  | 'assigned'
  | 'started'
  | 'mentioned'
  | 'replied'
  | 'subscribed'
  | 'workspace_completed'
  | 'workspace_failed'
  | 'workspace_needs_input'
  | 'status_changed'
  | 'handoff_requested'
  | 'handoff_returned'
  | 'quick_create'
  | 'generic_event'

/** 回信地址。渠道差异只活在这里，投递方必须填，路由层不猜。 */
export type InboxReplyTarget =
  | { kind: 'none' }
  | { kind: 'task_comment'; taskId: string; parentCommentId?: string }
  | {
      kind: 'channel'
      channelType: 'feishu' | 'telegram'
      externalChatId: string
      externalThreadId?: string
    }
  | { kind: 'inbox_item'; itemId: string }
  | { kind: 'feedback_item'; feedbackId: string }

export type InboxScope = {
  projectId?: string
  taskId?: string
  commentId?: string
  workspaceId?: string
  workspaceSessionId?: string
  groupId?: string
  /** 私聊（DM）会话 id：收件箱条目可跳回对应私聊会话。 */
  conversationId?: string
  /** 协作空间加入邀请 token：收件箱条目可跳回邀请确认页。 */
  invitationToken?: string
  messageId?: string
  feedbackId?: string
}

export type InboxItem = {
  id: string
  recipientType: InboxRecipientType
  recipientId: string
  kind: InboxItemKind
  reason: InboxItemReason
  /** 语义事件类型，沿用现有 `task.assigned` / `task.comment.mentioned` 等。 */
  eventType: string
  actorType: InboxActorType
  actorId?: string
  actorName: string
  title: string
  body: string
  scope: InboxScope
  /** 分组键。未读数按 group 计，不按 item 计。 */
  groupKey: string
  replyTo: InboxReplyTarget
  /** 整条因果链共享，跨 Agent 不变。 */
  traceId: string
  /** 因果链开始时间，用于限制 A2A 链的墙钟时长。 */
  chainStartedAt: string
  /** 触发当前 item 的上游 inbox item。 */
  sourceInboxItemId?: string
  /** 链深度，投递时继承 +1。 */
  hopCount: number
  dedupeKey: string
  readAt?: string
  snoozedUntil?: string
  archivedAt?: string
  createdAt: string
}

export type InboxSection = 'action' | 'following' | 'snoozed' | 'archived'

/**
 * 读取范围。`all` 只是查询维度，不是 item 的归属：
 * 每条 item 永远属于唯一一个 `InboxSection`，`all` 视图里各行仍按自己的真实 section 展示。
 */
export type InboxQueryScope = InboxSection | 'all'

export const INBOX_QUERY_SCOPES: readonly InboxQueryScope[] = [
  'all',
  'action',
  'following',
  'snoozed',
  'archived',
]

export type InboxExecutionSummary = {
  status: 'not_woken' | 'pending' | 'running' | 'waiting' | 'completed' | 'failed' | 'canceled' | 'dispatch_fault'
  attemptCount: number
  latestAgentTaskId?: string
  latestRunId?: string
  conversationSessionId?: string
  failureCode?: string
  failureMessage?: string
  startedAt?: string
  completedAt?: string
}

export type InboxGroupSummary = {
  groupKey: string
  section: InboxSection
  latestItem: InboxItem
  itemCount: number
  unreadCount: number
  actionableUnreadCount: number
  snoozedUntil?: string
  execution?: InboxExecutionSummary
}

export type InboxGroupListResponse = {
  groups: InboxGroupSummary[]
  unreadGroups: number
  nextCursor?: string
}

export type InboxItemListResponse = {
  items: InboxItem[]
  unreadGroups: number
  nextCursor?: string
}

export type InboxBadgeResponse = {
  unreadGroups: number
}

export type InboxSnoozeInput = {
  until: string
}

export const resolveInboxSection = (
  item: Pick<InboxItem, 'kind' | 'archivedAt' | 'snoozedUntil'>,
  now = new Date().toISOString(),
): InboxSection => {
  if (item.archivedAt) return 'archived'
  if (item.snoozedUntil && item.snoozedUntil > now) return 'snoozed'
  return item.kind === 'observe' ? 'following' : 'action'
}

/**
 * 需要收件人动手的性质：人的 badge 会点亮，Agent 侧表示这条对应一次真实唤醒。
 * 名字里的 "waking" 是描述性的 —— 它不触发唤醒，只标记这条属于待处理而非旁观。
 */
export const INBOX_WAKING_KINDS: readonly InboxItemKind[] = ['directive', 'mention', 'handoff']

export const isInboxWakingKind = (kind: InboxItemKind) => INBOX_WAKING_KINDS.includes(kind)

/**
 * badge 只表示「有事等你处理」，不表示「有更新」。
 * `observe` 不计入：关注项一多 badge 会长期非零，长期非零之后人就不看它了。
 */
export const countsTowardInboxBadge = (
  item: Pick<InboxItem, 'kind' | 'readAt' | 'archivedAt' | 'snoozedUntil'>,
  now = new Date().toISOString(),
) => {
  if (!isInboxWakingKind(item.kind)) return false
  if (item.readAt || item.archivedAt) return false
  if (item.snoozedUntil && item.snoozedUntil > now) return false
  return true
}

export const buildTaskInboxGroupKey = (taskId: string) => `task:${taskId}`
export const buildGroupChatInboxGroupKey = (groupId: string) => `group:${groupId}`
/** 私聊（DM）会话按会话分组：一个私聊对话 = 一个收件箱 group。 */
export const buildDmInboxGroupKey = (conversationId: string) => `dm:${conversationId}`

/** 未读 group 数。行内再显示组内未读条数。 */
export const countUnreadInboxGroups = (
  items: Array<Pick<InboxItem, 'kind' | 'readAt' | 'archivedAt' | 'snoozedUntil' | 'groupKey'>>,
  now = new Date().toISOString(),
) => new Set(
  items.filter((item) => countsTowardInboxBadge(item, now)).map((item) => item.groupKey),
).size
