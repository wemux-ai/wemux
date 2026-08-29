import { defaultUserNotificationSettings, type UserNotificationSettings } from '@shared/user-notification-settings'
import { api } from './api'
import { createCachedRequestLoader } from './request-cache'

const USER_NOTIFICATION_SETTINGS_CACHE_TTL_MS = 30_000

export const loadUserNotificationSettings = createCachedRequestLoader<UserNotificationSettings>({
  ttlMs: USER_NOTIFICATION_SETTINGS_CACHE_TTL_MS,
  load: async () => {
    const response = await api.getMyNotificationSettings()
    return response.settings
  },
})

export const getDefaultUserNotificationSettings = () => defaultUserNotificationSettings()
