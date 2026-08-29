// [INPUT]: 通知设置输入
// [OUTPUT]: 设置契约
// [POS]: 用户通知设置（实时通知矩阵：收件箱 @/指派、群聊 @你、群聊新消息、任务完成、工作区会话完成）
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

/**
 * 浏览器通知 + 提示音开关。
 * browserEnabled=false 时不弹系统通知（站内 badge/toast 不受影响）；
 * soundEnabled=false 时不播提示音。
 */
export interface UserNotificationCategorySettings {
  browserEnabled: boolean
  soundEnabled: boolean
}

export interface UserWorkspaceSessionCompletionNotificationSettings {
  browserEnabled: boolean
  soundEnabled: boolean
  feishuEnabled: boolean
}

export interface UserNotificationChannels {
  feishuWebhookUrl: string
}

export interface UserNotificationSettings {
  /** 收件箱 @/指派：新 inbox item（directive/mention/handoff，群聊 @ 除外）。 */
  inboxMention: UserNotificationCategorySettings
  /** 群聊 @你：保留设置分类（历史遗留）；聊天中的 @ 不进收件箱，改由消息页内红色「有人 @ 你」提示。 */
  groupChatMention: UserNotificationCategorySettings
  /** 群聊新消息（非 @，默认关，防刷屏）。 */
  groupChatMessage: UserNotificationCategorySettings
  /** 任务完成/失败：task 终态（P1 客户端状态推导；P2 服务端 task 事件经 inbox 后自动生效）。 */
  taskCompletion: UserNotificationCategorySettings
  /** 工作区会话完成/失败（既有设置，保留 feishu 通道）。 */
  workspaceSessionCompletion: UserWorkspaceSessionCompletionNotificationSettings
  channels: UserNotificationChannels
}

export const defaultUserNotificationSettings = (): UserNotificationSettings => ({
  inboxMention: {
    browserEnabled: true,
    soundEnabled: true,
  },
  groupChatMention: {
    browserEnabled: true,
    soundEnabled: true,
  },
  groupChatMessage: {
    browserEnabled: false,
    soundEnabled: false,
  },
  taskCompletion: {
    browserEnabled: true,
    soundEnabled: true,
  },
  workspaceSessionCompletion: {
    browserEnabled: true,
    soundEnabled: true,
    feishuEnabled: false,
  },
  channels: {
    feishuWebhookUrl: '',
  },
})

const toTrimmedString = (value: unknown) => {
  return typeof value === 'string' ? value.trim() : ''
}

const toBoolean = (value: unknown, fallback: boolean) => {
  return typeof value === 'boolean' ? value : fallback
}

const readCategory = (record: Record<string, unknown> | undefined, key: string, fallback: UserNotificationCategorySettings): UserNotificationCategorySettings => {
  const category = record?.[key] && typeof record[key] === 'object'
    ? record[key] as Record<string, unknown>
    : {}
  return {
    browserEnabled: toBoolean(category.browserEnabled, fallback.browserEnabled),
    soundEnabled: toBoolean(category.soundEnabled, fallback.soundEnabled),
  }
}

export const normalizeUserNotificationSettings = (
  value: unknown,
): UserNotificationSettings => {
  const defaults = defaultUserNotificationSettings()
  const record = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  const workspaceSessionCompletion = record.workspaceSessionCompletion
    && typeof record.workspaceSessionCompletion === 'object'
    ? record.workspaceSessionCompletion as Record<string, unknown>
    : {}
  const channels = record.channels
    && typeof record.channels === 'object'
    ? record.channels as Record<string, unknown>
    : {}

  return {
    inboxMention: readCategory(record, 'inboxMention', defaults.inboxMention),
    groupChatMention: readCategory(record, 'groupChatMention', defaults.groupChatMention),
    groupChatMessage: readCategory(record, 'groupChatMessage', defaults.groupChatMessage),
    taskCompletion: readCategory(record, 'taskCompletion', defaults.taskCompletion),
    workspaceSessionCompletion: {
      browserEnabled: toBoolean(workspaceSessionCompletion.browserEnabled, defaults.workspaceSessionCompletion.browserEnabled),
      soundEnabled: toBoolean(workspaceSessionCompletion.soundEnabled, defaults.workspaceSessionCompletion.soundEnabled),
      feishuEnabled: toBoolean(workspaceSessionCompletion.feishuEnabled, defaults.workspaceSessionCompletion.feishuEnabled),
    },
    channels: {
      feishuWebhookUrl: toTrimmedString(channels.feishuWebhookUrl),
    },
  }
}

/** 任一浏览器通知类别开启时即需要浏览器通知权限（权限引导用）。 */
export const hasAnyBrowserNotificationEnabled = (settings: UserNotificationSettings): boolean => {
  return (
    settings.inboxMention.browserEnabled
    || settings.groupChatMention.browserEnabled
    || settings.groupChatMessage.browserEnabled
    || settings.taskCompletion.browserEnabled
    || settings.workspaceSessionCompletion.browserEnabled
  )
}
