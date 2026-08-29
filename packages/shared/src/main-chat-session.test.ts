import assert from 'node:assert/strict'
import test from 'node:test'
import type { AppState, MainChatSession } from './types'
import {
  buildMainChatSessionLatestPreview,
  isMainChatSessionPinned,
  isMainChatSessionVisibleInWorkspace,
  normalizeMainChatSessionState,
  setMainChatSessionPinned,
  sortMainChatSessions,
  summarizeMainChatSession,
  summarizeMainChatSessionsInState,
} from './main-chat-session'

const createSession = (overrides: Partial<MainChatSession>): MainChatSession => ({
  id: overrides.id ?? crypto.randomUUID(),
  title: overrides.title ?? '会话',
  pinnedAt: overrides.pinnedAt,
  customAgentId: overrides.customAgentId,
  executorId: overrides.executorId,
  executionModel: overrides.executionModel,
  messages: overrides.messages ?? [],
  createdAt: overrides.createdAt ?? '2026-05-09T00:00:00.000Z',
  updatedAt: overrides.updatedAt ?? '2026-05-09T00:00:00.000Z',
})

test('sortMainChatSessions keeps pinned sessions first and latest pin first', () => {
  const sessions = [
    createSession({ id: 'session-a' }),
    createSession({ id: 'session-b', pinnedAt: '2026-05-09T10:00:00.000Z' }),
    createSession({ id: 'session-c' }),
    createSession({ id: 'session-d', pinnedAt: '2026-05-09T12:00:00.000Z' }),
  ]

  assert.deepEqual(sortMainChatSessions(sessions).map((session) => session.id), [
    'session-d',
    'session-b',
    'session-a',
    'session-c',
  ])
})

test('setMainChatSessionPinned toggles pin state without rewriting an existing pin timestamp', () => {
  const session = createSession({ id: 'session-a' })
  const pinned = setMainChatSessionPinned(session, true, '2026-05-09T08:00:00.000Z')
  const pinnedAgain = setMainChatSessionPinned(pinned, true, '2026-05-09T09:00:00.000Z')
  const unpinned = setMainChatSessionPinned(pinnedAgain, false)

  assert.equal(isMainChatSessionPinned(session), false)
  assert.equal(pinned.pinnedAt, '2026-05-09T08:00:00.000Z')
  assert.equal(pinnedAgain.pinnedAt, '2026-05-09T08:00:00.000Z')
  assert.equal(unpinned.pinnedAt, null)
})

test('normalizeMainChatSessionState returns sessions in pinned order', () => {
  const sessionA = createSession({ id: 'session-a' })
  const sessionB = createSession({ id: 'session-b', pinnedAt: '2026-05-09T08:00:00.000Z' })
  const state = {
    mainChatSessions: [sessionA, sessionB],
  } satisfies Pick<AppState, 'mainChatSessions'>

  const normalized = normalizeMainChatSessionState(state)

  assert.deepEqual(normalized.mainChatSessions.map((session) => session.id), ['session-b', 'session-a'])
})

test('summarizeMainChatSession keeps only a compact latest-message preview for long sessions', () => {
  const session = createSession({
    id: 'session-long',
    messages: [
      { id: 'message-a', role: 'user', content: 'first', createdAt: '2026-05-09T00:00:00.000Z' },
      {
        id: 'message-b',
        role: 'assistant',
        content: 'x'.repeat(200),
        createdAt: '2026-05-09T00:00:01.000Z',
        reasoning: ['hidden reasoning'],
        toolCalls: [{ id: 'tool-a', name: 'shell', args: 'x', result: 'y', startedAt: '2026-05-09T00:00:01.000Z' }],
      },
    ],
  })

  const summary = summarizeMainChatSession(session, { previewContentLength: 100 })

  assert.equal(summary.messagesLoaded, false)
  assert.equal(summary.messageCount, 2)
  assert.deepEqual(summary.messages?.map((message) => message.id), ['message-b'])
  assert.equal(summary.messages?.[0]?.content.length, 103)
  assert.equal(summary.messages?.[0]?.reasoning, undefined)
  assert.equal(summary.messages?.[0]?.toolCalls, undefined)
})

test('summarizeMainChatSessionsInState summarizes every session independently', () => {
  const sessionA = createSession({
    id: 'session-a',
    messages: [
      { id: 'message-a1', role: 'user', content: 'first', createdAt: '2026-05-09T00:00:00.000Z' },
      { id: 'message-a2', role: 'assistant', content: 'second', createdAt: '2026-05-09T00:00:01.000Z' },
    ],
  })
  const sessionB = createSession({
    id: 'session-b',
    messages: [
      { id: 'message-b1', role: 'user', content: 'other', createdAt: '2026-05-09T00:00:00.000Z' },
    ],
  })

  const summary = summarizeMainChatSessionsInState({
    mainChatSessions: [sessionA, sessionB],
    selectedMainChatSessionId: 'session-a',
  })

  assert.equal(summary.mainChatSessions[0]?.messagesLoaded, false)
  assert.equal(summary.mainChatSessions[1]?.messagesLoaded, true)
  assert.deepEqual(summary.mainChatSessions[0]?.messages?.map((message) => message.id), ['message-a2'])
})

test('summarizeMainChatSessionsInState omits the messages field entirely for preview-free payloads', () => {
  const session = createSession({
    id: 'session-a',
    messages: [
      { id: 'message-a1', role: 'user', content: 'first', createdAt: '2026-05-09T00:00:00.000Z' },
      { id: 'message-a2', role: 'assistant', content: 'second', createdAt: '2026-05-09T00:00:01.000Z' },
    ],
  })

  const summary = summarizeMainChatSessionsInState({
    mainChatSessions: [session],
    selectedMainChatSessionId: session.id,
  }, { previewMessages: 0 })

  assert.equal(summary.mainChatSessions[0]?.messagesLoaded, false)
  assert.equal(summary.mainChatSessions[0]?.messageCount, 2)
  assert.equal('messages' in summary.mainChatSessions[0]!, false)
  assert.equal(summary.mainChatSessions[0]?.latestMessagePreview, 'second')
})

test('buildMainChatSessionLatestPreview collapses whitespace and truncates long content', () => {
  assert.equal(
    buildMainChatSessionLatestPreview(createSession({
      messages: [
        { id: 'm1', role: 'user', content: '你好', createdAt: '2026-05-09T00:00:00.000Z' },
        { id: 'm2', role: 'assistant', content: '  有什么\n\n需要我帮忙的吗？  ', createdAt: '2026-05-09T00:00:01.000Z' },
      ],
    })),
    '有什么 需要我帮忙的吗？',
  )
  assert.equal(
    buildMainChatSessionLatestPreview(createSession({
      messages: [{ id: 'm1', role: 'assistant', content: 'x'.repeat(200), createdAt: '2026-05-09T00:00:00.000Z' }],
    })),
    `${'x'.repeat(140)}...`,
  )
  assert.equal(buildMainChatSessionLatestPreview(createSession({ messages: [] })), '')
  assert.equal(
    buildMainChatSessionLatestPreview(createSession({
      messages: [{ id: 'm1', role: 'assistant', content: '   ', createdAt: '2026-05-09T00:00:00.000Z' }],
    })),
    '',
  )
})

test('summarizeMainChatSession keeps a latest preview when message previews are dropped', () => {
  const session = createSession({
    id: 'session-stripped',
    messages: [
      { id: 'm1', role: 'user', content: '你好', createdAt: '2026-05-09T00:00:00.000Z' },
      { id: 'm2', role: 'assistant', content: '有什么需要我帮忙的吗？', createdAt: '2026-05-09T00:00:01.000Z' },
    ],
  })

  assert.equal(
    summarizeMainChatSession(session, { previewMessages: 0 }).latestMessagePreview,
    '有什么需要我帮忙的吗？',
  )
  assert.equal(
    summarizeMainChatSession(session).latestMessagePreview,
    '有什么需要我帮忙的吗？',
  )
})

test('isMainChatSessionVisibleInWorkspace filters sessions by workspace and keeps legacy sessions global', () => {
  const workspaceSession = { workspaceId: 'ws-1' }
  const otherWorkspaceSession = { workspaceId: 'ws-2' }
  const legacySession = {}

  assert.equal(isMainChatSessionVisibleInWorkspace(workspaceSession, 'ws-1'), true)
  assert.equal(isMainChatSessionVisibleInWorkspace(workspaceSession, 'ws-2'), false)
  assert.equal(isMainChatSessionVisibleInWorkspace(otherWorkspaceSession, 'ws-1'), false)
  // 老数据（无 workspaceId）→ 全局兼容
  assert.equal(isMainChatSessionVisibleInWorkspace(legacySession, 'ws-1'), true)
  assert.equal(isMainChatSessionVisibleInWorkspace(legacySession, undefined), true)
  // 无 workspace 上下文 → 不过滤
  assert.equal(isMainChatSessionVisibleInWorkspace(workspaceSession, undefined), true)
})
