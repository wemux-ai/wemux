import { useEffect, useState } from 'react'
import type { UserNotificationSettings } from '@shared/user-notification-settings'
import {
  requestBrowserNotificationPermission,
  resolveBrowserNotificationPermission,
  shouldRequestBrowserNotificationPermission,
} from './browser-notification-permission'
import {
  getDefaultUserNotificationSettings,
  loadUserNotificationSettings,
} from './user-notification-settings-data'

let browserNotificationPermissionAutoRequested = false

export const useUserNotificationSettings = () => {
  const [settings, setSettings] = useState<UserNotificationSettings>(getDefaultUserNotificationSettings())

  useEffect(() => {
    let cancelled = false

    void loadUserNotificationSettings()
      .then((nextSettings) => {
        if (!cancelled) {
          setSettings(nextSettings)
          if (!browserNotificationPermissionAutoRequested && shouldRequestBrowserNotificationPermission(nextSettings, resolveBrowserNotificationPermission())) {
            browserNotificationPermissionAutoRequested = true
            void requestBrowserNotificationPermission()
          }
        }
      })
      .catch(() => undefined)

    return () => {
      cancelled = true
    }
  }, [])

  return settings
}
