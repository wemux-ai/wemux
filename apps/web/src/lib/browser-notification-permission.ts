import { hasAnyBrowserNotificationEnabled, type UserNotificationSettings } from '@shared/user-notification-settings'
import { isNativeClient } from './native-client'

export type BrowserNotificationPermission = NotificationPermission | 'unsupported'

let browserNotificationPermissionRequest: Promise<NotificationPermission> | null = null

export const resolveBrowserNotificationPermission = (): BrowserNotificationPermission => {
  // 原生客户端（WKWebView/WebView）无浏览器 Notification API，改走系统通知，视为已授权
  if (isNativeClient()) {
    return 'granted'
  }
  if (typeof window === 'undefined' || typeof Notification === 'undefined') {
    return 'unsupported'
  }

  return Notification.permission
}

export const shouldRequestBrowserNotificationPermission = (
  settings: UserNotificationSettings,
  permission: BrowserNotificationPermission,
) => {
  return hasAnyBrowserNotificationEnabled(settings) && permission === 'default'
}

export const requestBrowserNotificationPermission = async (): Promise<BrowserNotificationPermission> => {
  // 原生客户端无需浏览器权限（系统通知由 OS 管理）
  if (isNativeClient()) {
    return 'granted'
  }
  if (typeof window === 'undefined' || typeof Notification === 'undefined') {
    return 'unsupported'
  }

  if (Notification.permission !== 'default') {
    return Notification.permission
  }

  if (!browserNotificationPermissionRequest) {
    browserNotificationPermissionRequest = Notification.requestPermission()
      .catch(() => Notification.permission)
      .finally(() => {
        browserNotificationPermissionRequest = null
      })
  }

  return browserNotificationPermissionRequest
}
