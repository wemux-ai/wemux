import assert from 'node:assert/strict'
import test from 'node:test'
import {
  defaultUserNotificationSettings,
  hasAnyBrowserNotificationEnabled,
  normalizeUserNotificationSettings,
} from './user-notification-settings'

test('defaultUserNotificationSettings returns browser notifications on by default except group chat messages', () => {
  assert.deepEqual(defaultUserNotificationSettings(), {
    inboxMention: { browserEnabled: true, soundEnabled: true },
    groupChatMention: { browserEnabled: true, soundEnabled: true },
    groupChatMessage: { browserEnabled: false, soundEnabled: false },
    taskCompletion: { browserEnabled: true, soundEnabled: true },
    workspaceSessionCompletion: {
      browserEnabled: true,
      soundEnabled: true,
      feishuEnabled: false,
    },
    channels: {
      feishuWebhookUrl: '',
    },
  })
})

test('normalizeUserNotificationSettings trims webhook, fills missing defaults, and keeps legacy workspace settings', () => {
  assert.deepEqual(normalizeUserNotificationSettings({
    workspaceSessionCompletion: {
      browserEnabled: false,
    },
    channels: {
      feishuWebhookUrl: '  https://open.feishu.cn/open-apis/bot/v2/hook/demo  ',
    },
  }), {
    inboxMention: { browserEnabled: true, soundEnabled: true },
    groupChatMention: { browserEnabled: true, soundEnabled: true },
    groupChatMessage: { browserEnabled: false, soundEnabled: false },
    taskCompletion: { browserEnabled: true, soundEnabled: true },
    workspaceSessionCompletion: {
      browserEnabled: false,
      soundEnabled: true,
      feishuEnabled: false,
    },
    channels: {
      feishuWebhookUrl: 'https://open.feishu.cn/open-apis/bot/v2/hook/demo',
    },
  })
})

test('normalizeUserNotificationSettings preserves explicitly saved matrix categories', () => {
  assert.deepEqual(normalizeUserNotificationSettings({
    inboxMention: { browserEnabled: false, soundEnabled: true },
    groupChatMention: { browserEnabled: true, soundEnabled: false },
    groupChatMessage: { browserEnabled: true, soundEnabled: false },
    taskCompletion: { browserEnabled: false, soundEnabled: false },
  }), {
    inboxMention: { browserEnabled: false, soundEnabled: true },
    groupChatMention: { browserEnabled: true, soundEnabled: false },
    groupChatMessage: { browserEnabled: true, soundEnabled: false },
    taskCompletion: { browserEnabled: false, soundEnabled: false },
    workspaceSessionCompletion: { browserEnabled: true, soundEnabled: true, feishuEnabled: false },
    channels: { feishuWebhookUrl: '' },
  })
})

test('hasAnyBrowserNotificationEnabled reflects any enabled browser category', () => {
  const settings = defaultUserNotificationSettings()
  assert.equal(hasAnyBrowserNotificationEnabled(settings), true)

  const allOff = {
    ...settings,
    inboxMention: { browserEnabled: false, soundEnabled: true },
    groupChatMention: { browserEnabled: false, soundEnabled: true },
    groupChatMessage: { browserEnabled: false, soundEnabled: true },
    taskCompletion: { browserEnabled: false, soundEnabled: true },
    workspaceSessionCompletion: { browserEnabled: false, soundEnabled: true, feishuEnabled: false },
  }
  assert.equal(hasAnyBrowserNotificationEnabled(allOff), false)
})
