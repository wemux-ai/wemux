import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import type { ChatMessage, MainChatSession } from '@shared/types'
import { groupAgentSessions, isAgentSessionEmpty } from './agent-session-grouping'

const buildMessage = (overrides: Partial<ChatMessage> = {}): ChatMessage => ({
  id: 'm1',
  role: 'assistant',
  content: '',
  createdAt: '2026-07-01T00:00:00.000Z',
  ...overrides,
} as ChatMessage)

const buildSession = (overrides: Partial<MainChatSession> = {}): MainChatSession => ({
  id: 's1',
  title: '会话',
  messages: [],
  createdAt: '2026-07-01T00:00:00.000Z',
  updatedAt: '2026-07-01T00:00:00.000Z',
  ...overrides,
})

describe('isAgentSessionEmpty', () => {
  test('treats a session with no messages as empty', () => {
    assert.equal(isAgentSessionEmpty(buildSession()), true)
  })

  test('treats a session with a user message as non-empty', () => {
    const session = buildSession({ messages: [buildMessage({ role: 'user', content: '你好' })] })
    assert.equal(isAgentSessionEmpty(session), false)
  })

  test('treats blank assistant messages as empty', () => {
    const session = buildSession({ messages: [buildMessage({ content: '   ' })] })
    assert.equal(isAgentSessionEmpty(session), true)
  })

  test('treats an assistant message with content as non-empty', () => {
    const session = buildSession({ messages: [buildMessage({ content: '任务已创建' })] })
    assert.equal(isAgentSessionEmpty(session), false)
  })

  test('treats an unloaded session with a zero messageCount as empty', () => {
    // 不再依赖 messagesLoaded：懒加载占位下，是否为空由 messageCount 判断。
    const session = buildSession({ messages: [], messagesLoaded: false })
    assert.equal(isAgentSessionEmpty(session), true)
  })

  test('does NOT treat an unloaded session with a positive messageCount as empty', () => {
    const session = buildSession({ messages: [], messagesLoaded: false, messageCount: 3 })
    assert.equal(isAgentSessionEmpty(session), false)
  })

  test('does NOT treat a session with a positive messageCount as empty', () => {
    const session = buildSession({ messages: [], messageCount: 7 })
    assert.equal(isAgentSessionEmpty(session), false)
  })

  test('treats an attachment-only message as non-empty', () => {
    const session = buildSession({
      messages: [buildMessage({ attachments: [{ id: 'a', url: 'u' }] as ChatMessage['attachments'] })],
    })
    assert.equal(isAgentSessionEmpty(session), false)
  })
})

describe('groupAgentSessions', () => {
  const withContent = buildSession({ id: 'has-content', title: '更新 README', messages: [buildMessage({ role: 'user', content: '你去 test 新建任务' })] })
  const blank = buildSession({ id: 'blank', title: '[Agent Runtime Event] a' })
  const blankTwo = buildSession({ id: 'blank-2', title: '[Agent Runtime Event] b' })

  test('splits substantive sessions from empty ones', () => {
    const result = groupAgentSessions({ sessions: [withContent, blank, blankTwo] })
    assert.deepEqual(result.substantive.map((item) => item.session.id), ['has-content'])
    assert.deepEqual(result.empty.map((item) => item.session.id), ['blank', 'blank-2'])
    assert.equal(result.totalMatched, 3)
  })

  test('keeps the active session out of the empty group', () => {
    const result = groupAgentSessions({ sessions: [blank], activeSessionId: 'blank' })
    assert.equal(result.empty.length, 0)
    assert.deepEqual(result.substantive.map((item) => item.session.id), ['blank'])
  })

  test('keeps pinned sessions out of the empty group', () => {
    const pinned = buildSession({ id: 'pinned', pinnedAt: '2026-07-01T00:00:00.000Z' })
    const result = groupAgentSessions({ sessions: [pinned] })
    assert.equal(result.empty.length, 0)
    assert.deepEqual(result.substantive.map((item) => item.session.id), ['pinned'])
  })

  test('filters by source channel', () => {
    const feishu = buildSession({ id: 'feishu', sourceChannel: 'feishu' })
    const result = groupAgentSessions({ sessions: [withContent, feishu], sourceFilter: 'feishu' })
    assert.equal(result.totalMatched, 1)
    assert.deepEqual(result.empty.map((item) => item.session.id), ['feishu'])
  })

  test('resolves web as the default source kind', () => {
    const result = groupAgentSessions({ sessions: [withContent] })
    assert.equal(result.substantive[0].sourceKind, 'web')
  })

  test('resolves non-telegram/feishu external channels as the channel kind', () => {
    for (const sourceChannel of ['wechat', 'discord', 'slack', 'wecom', 'whatsapp', 'dingtalk'] as const) {
      const session = buildSession({ id: sourceChannel, sourceChannel })
      const result = groupAgentSessions({ sessions: [session], sourceFilter: 'channel' })
      assert.equal(result.totalMatched, 1, sourceChannel)
      assert.equal(result.empty[0].sourceKind, 'channel', sourceChannel)
    }
  })

  test('matches the query against the title', () => {
    const result = groupAgentSessions({ sessions: [withContent, blank], query: 'readme' })
    assert.equal(result.totalMatched, 1)
    assert.deepEqual(result.substantive.map((item) => item.session.id), ['has-content'])
    assert.equal(result.hasQuery, true)
  })

  test('matches the query against message content', () => {
    const result = groupAgentSessions({ sessions: [withContent, blank], query: '新建任务' })
    assert.deepEqual(result.substantive.map((item) => item.session.id), ['has-content'])
  })

  test('returns nothing matched when the query excludes everything', () => {
    const result = groupAgentSessions({ sessions: [withContent, blank], query: 'zzzz' })
    assert.equal(result.totalMatched, 0)
  })

  test('exposes the last non-blank message as the preview', () => {
    const session = buildSession({
      id: 'preview',
      messages: [buildMessage({ content: '第一条' }), buildMessage({ id: 'm2', content: '最后一条' }), buildMessage({ id: 'm3', content: '  ' })],
    })
    const result = groupAgentSessions({ sessions: [session] })
    assert.equal(result.substantive[0].preview, '最后一条')
  })

  test('returns an empty preview when there is no content', () => {
    const result = groupAgentSessions({ sessions: [blank] })
    assert.equal(result.empty[0].preview, '')
  })

  test('preserves input order within each group', () => {
    const result = groupAgentSessions({ sessions: [blank, withContent, blankTwo] })
    assert.deepEqual(result.empty.map((item) => item.session.id), ['blank', 'blank-2'])
  })
})
