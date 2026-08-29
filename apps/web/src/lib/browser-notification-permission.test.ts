import assert from 'node:assert/strict'
import test from 'node:test'
import { defaultUserNotificationSettings } from '@shared/user-notification-settings'
import {
  shouldRequestBrowserNotificationPermission,
  type BrowserNotificationPermission,
} from './browser-notification-permission'

const createSettings = (browserEnabled: boolean) => ({
  ...defaultUserNotificationSettings(),
  inboxMention: { browserEnabled, soundEnabled: true },
  groupChatMention: { browserEnabled, soundEnabled: true },
  groupChatMessage: { browserEnabled: false, soundEnabled: false },
  taskCompletion: { browserEnabled, soundEnabled: true },
  workspaceSessionCompletion: {
    ...defaultUserNotificationSettings().workspaceSessionCompletion,
    browserEnabled,
  },
})

test('shouldRequestBrowserNotificationPermission asks when browser notifications are enabled and undecided', () => {
  assert.equal(
    shouldRequestBrowserNotificationPermission(createSettings(true), 'default'),
    true,
  )
})

test('shouldRequestBrowserNotificationPermission skips disabled or settled permissions', () => {
  const settledPermissions: BrowserNotificationPermission[] = ['granted', 'denied', 'unsupported']

  assert.equal(
    shouldRequestBrowserNotificationPermission(createSettings(false), 'default'),
    false,
  )

  for (const permission of settledPermissions) {
    assert.equal(
      shouldRequestBrowserNotificationPermission(createSettings(true), permission),
      false,
    )
  }
})
