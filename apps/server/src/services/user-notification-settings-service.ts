// [INPUT]: 通知设置输入
// [OUTPUT]: 存取
// [POS]: 用户通知设置
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import {
  defaultUserNotificationSettings,
  normalizeUserNotificationSettings,
  type UserNotificationSettings,
} from '@shared/user-notification-settings'
import { getMeta, saveMeta } from '../storage/app-state-store'

const USER_NOTIFICATION_SETTINGS_META_KEY_PREFIX = 'user_notification_settings:'

const buildUserNotificationSettingsMetaKey = (userId: string) => {
  return `${USER_NOTIFICATION_SETTINGS_META_KEY_PREFIX}${userId}`
}

export const getUserNotificationSettings = (
  userId: string,
): UserNotificationSettings => {
  return normalizeUserNotificationSettings(
    getMeta<UserNotificationSettings | null>(
      buildUserNotificationSettingsMetaKey(userId),
      defaultUserNotificationSettings(),
    ),
  )
}

export const saveUserNotificationSettings = (
  userId: string,
  settings: unknown,
): UserNotificationSettings => {
  const normalizedSettings = normalizeUserNotificationSettings(settings)
  saveMeta(buildUserNotificationSettingsMetaKey(userId), normalizedSettings)
  return normalizedSettings
}
