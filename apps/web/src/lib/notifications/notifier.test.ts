import assert from 'node:assert/strict'
import test from 'node:test'
import { defaultUserNotificationSettings } from '@shared/user-notification-settings'
import {
  buildInboxItemNotification,
  coalesceStateCompletionNotifications,
  collectTaskCompletionNotifications,
  type TrackedTaskState,
} from './notifier'
import type { InboxItem } from '@shared/inbox'

const createTask = (overrides: Partial<TrackedTaskState> = {}): TrackedTaskState => ({
  id: 'task-1',
  title: 'Ship realtime notifications',
  agentRunningStatus: 'executing',
  updatedAt: '2026-08-12T10:00:00.000Z',
  executionHistory: [],
  result: undefined,
  ...overrides,
})

const createInboxItem = (overrides: Partial<InboxItem> = {}): InboxItem => ({
  id: 'inbox-1',
  recipientType: 'user',
  recipientId: 'user-1',
  kind: 'mention',
  reason: 'mentioned',
  eventType: 'task.comment.mentioned',
  actorType: 'user',
  actorId: 'user-2',
  actorName: 'Alice',
  title: '任务标题',
  body: '请看一下这个方案',
  scope: {},
  groupKey: 'task:task-1',
  replyTo: { kind: 'task_comment', taskId: 'task-1' },
  traceId: 'trace-1',
  chainStartedAt: '2026-08-12T10:00:00.000Z',
  hopCount: 0,
  dedupeKey: 'task-comment:c1',
  createdAt: '2026-08-12T10:00:00.000Z',
  ...overrides,
})

test('collectTaskCompletionNotifications reports busy to terminal task transitions', () => {
  const previousTasksById: Record<string, TrackedTaskState> = {
    'task-1': createTask(),
  }
  const result = collectTaskCompletionNotifications({
    previousTasksById,
    tasks: [createTask({
      agentRunningStatus: 'complete',
      result: { workspaceSessionId: 'session-9' } as TrackedTaskState['result'],
    })],
  })

  assert.deepEqual(result.notifications, [{
    taskId: 'task-1',
    taskTitle: 'Ship realtime notifications',
    tone: 'complete',
    boundWorkspaceSessionIds: ['session-9'],
  }])
})

test('collectTaskCompletionNotifications ignores non-busy and unchanged transitions', () => {
  const previousTasksById: Record<string, TrackedTaskState> = {
    'task-1': createTask({ agentRunningStatus: 'idle' }),
    'task-2': createTask({ id: 'task-2', agentRunningStatus: 'executing' }),
  }
  const result = collectTaskCompletionNotifications({
    previousTasksById,
    tasks: [
      // idle → complete：从未 busy，不通知
      createTask({ agentRunningStatus: 'complete' }),
      // busy → busy：没有终态，不通知
      createTask({ id: 'task-2', agentRunningStatus: 'thinking' }),
    ],
  })

  assert.deepEqual(result.notifications, [])
})

test('buildInboxItemNotification maps waking inbox items to inboxMention row', () => {
  const mapped = buildInboxItemNotification(createInboxItem())

  assert.deepEqual(mapped && { type: mapped.type, title: mapped.title, tag: mapped.tag }, {
    type: 'inboxMention',
    title: '收件箱：任务标题',
    tag: 'inbox:inbox-1',
  })
})

test('buildInboxItemNotification ignores observe items and maps terminal task items to taskCompletion', () => {
  const observe = buildInboxItemNotification(createInboxItem({ kind: 'observe', reason: 'subscribed' }))
  assert.equal(observe, null)

  const terminal = buildInboxItemNotification(createInboxItem({
    kind: 'handoff',
    reason: 'workspace_completed',
    eventType: 'workspace.session.completed',
    scope: { taskId: 'task-1', workspaceSessionId: 'session-9' },
    title: 'Ship realtime notifications',
  }))
  assert.deepEqual(terminal && { type: terminal.type, title: terminal.title, tag: terminal.tag, tone: terminal.tone }, {
    type: 'taskCompletion',
    title: '任务已完成',
    tag: 'task-complete:task-1',
    tone: 'complete',
  })
})

test('coalesceStateCompletionNotifications prefers task wording for task-bound sessions', () => {
  const settings = defaultUserNotificationSettings()
  const deliveries = coalesceStateCompletionNotifications({
    settings,
    sessionNotifications: [{
      sessionId: 'session-9',
      sessionTitle: 'session-9',
      tone: 'complete',
    }],
    taskNotifications: [{
      taskId: 'task-1',
      taskTitle: 'Ship realtime notifications',
      tone: 'complete',
      boundWorkspaceSessionIds: ['session-9'],
    }],
  })

  assert.equal(deliveries.length, 1)
  assert.equal(deliveries[0].type, 'taskCompletion')
  assert.equal(deliveries[0].title, '任务已完成')
  assert.match(deliveries[0].body, /Ship realtime notifications/)
})

test('coalesceStateCompletionNotifications keeps task and session separate when unbounded', () => {
  const settings = defaultUserNotificationSettings()
  const deliveries = coalesceStateCompletionNotifications({
    settings,
    sessionNotifications: [{
      sessionId: 'session-9',
      sessionTitle: 'session-9',
      tone: 'error',
    }],
    taskNotifications: [{
      taskId: 'task-1',
      taskTitle: 'Ship realtime notifications',
      tone: 'complete',
      boundWorkspaceSessionIds: [],
    }],
  })

  assert.equal(deliveries.length, 2)
  assert.equal(deliveries[0].type, 'taskCompletion')
  assert.equal(deliveries[0].title, '任务已完成')
  assert.equal(deliveries[1].type, 'workspaceSessionCompletion')
  assert.equal(deliveries[1].title, '工作区会话执行出错')
})

test('coalesceStateCompletionNotifications falls back to session wording when task row is off', () => {
  const settings = defaultUserNotificationSettings()
  settings.taskCompletion = { browserEnabled: false, soundEnabled: false }
  const deliveries = coalesceStateCompletionNotifications({
    settings,
    sessionNotifications: [{
      sessionId: 'session-9',
      sessionTitle: 'session-9',
      tone: 'complete',
    }],
    taskNotifications: [{
      taskId: 'task-1',
      taskTitle: 'Ship realtime notifications',
      tone: 'complete',
      boundWorkspaceSessionIds: ['session-9'],
    }],
  })

  assert.equal(deliveries.length, 1)
  assert.equal(deliveries[0].type, 'workspaceSessionCompletion')
  assert.equal(deliveries[0].title, '工作区会话已完成')
})
