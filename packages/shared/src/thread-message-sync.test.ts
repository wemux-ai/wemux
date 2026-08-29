import assert from 'node:assert/strict'
import test from 'node:test'
import { isEmptyThreadMirrorPlan, planThreadMirror } from './thread-message-sync'
import type { ChatMessage, MainChatSession } from './types'

const buildMessage = (overrides: Partial<ChatMessage> = {}): ChatMessage => ({
  id: 'message-1',
  role: 'user',
  content: 'hello',
  createdAt: '2026-08-03T00:00:00.000Z',
  ...overrides,
})

const buildSession = (overrides: Partial<MainChatSession> = {}): MainChatSession => ({
  id: 'session-1',
  title: '默认会话',
  messages: [buildMessage()],
  createdAt: '2026-08-03T00:00:00.000Z',
  updatedAt: '2026-08-03T00:00:00.000Z',
  ...overrides,
})

test('planThreadMirror emits every thread and message on the first pass', () => {
  const plan = planThreadMirror([buildSession()])

  assert.deepEqual(plan.threads.map((thread) => thread.threadId), ['session-1'])
  assert.deepEqual(plan.messages.map((item) => item.message.id), ['message-1'])
  assert.equal(plan.messages[0].message.threadId, 'session-1')
})

test('planThreadMirror writes nothing when state is re-saved unchanged', () => {
  const sessions = [buildSession()]
  const first = planThreadMirror(sessions)
  const second = planThreadMirror(sessions, first.snapshot)

  assert.equal(isEmptyThreadMirrorPlan(second), true)
})

test('planThreadMirror only writes the changed session when another session is untouched', () => {
  const stable = buildSession({ id: 'session-stable' })
  const changing = buildSession({ id: 'session-changing' })
  const first = planThreadMirror([stable, changing])

  const second = planThreadMirror([
    stable,
    {
      ...changing,
      updatedAt: '2026-08-03T00:05:00.000Z',
      messages: [...(changing.messages ?? []), buildMessage({ id: 'message-2', content: 'second' })],
    },
  ], first.snapshot)

  assert.deepEqual(second.threads.map((thread) => thread.threadId), ['session-changing'])
  assert.deepEqual(second.messages.map((item) => item.message.id), ['message-2'])
})

test('planThreadMirror rewrites a message whose content grew during streaming', () => {
  const streaming = buildSession({
    messages: [buildMessage({ id: 'message-1', role: 'assistant', content: 'par' })],
  })
  const first = planThreadMirror([streaming])

  const second = planThreadMirror([{
    ...streaming,
    updatedAt: '2026-08-03T00:00:01.000Z',
    messages: [buildMessage({ id: 'message-1', role: 'assistant', content: 'partial answer' })],
  }], first.snapshot)

  assert.deepEqual(second.messages.map((item) => item.message.id), ['message-1'])
})

test('planThreadMirror rewrites a message when only its part count changed', () => {
  const base = buildMessage({ id: 'message-1', role: 'assistant', content: 'same' })
  const first = planThreadMirror([buildSession({ messages: [base] })])

  const second = planThreadMirror([buildSession({
    messages: [{
      ...base,
      toolCalls: [{ id: 'tool-1', name: 'read', args: '{}', startedAt: '2026-08-03T00:00:00.000Z' }],
    }],
  })], first.snapshot)

  assert.deepEqual(second.messages.map((item) => item.message.id), ['message-1'])
})

test('planThreadMirror rewrites a message when only its finishReason changed', () => {
  // 用户停止时最后一段增量常已落库，只有 finishReason 从 undefined 变成 'aborted'。
  // 不进指纹就会被差分判成「无变化」，片段标记永远写不进关系表。
  const base = buildMessage({ id: 'message-1', role: 'assistant', content: 'partial answer' })
  const first = planThreadMirror([buildSession({ messages: [base] })])

  const second = planThreadMirror([buildSession({
    messages: [{ ...base, finishReason: 'aborted' }],
  })], first.snapshot)

  assert.deepEqual(second.messages.map((item) => item.message.id), ['message-1'])
  assert.equal(second.messages[0]?.extras.finishReason, 'aborted')
})

test('planThreadMirror writes nothing when finishReason is unchanged', () => {
  const base = buildMessage({ id: 'message-1', role: 'assistant', content: 'done', finishReason: 'end_turn' })
  const first = planThreadMirror([buildSession({ messages: [base] })])
  const second = planThreadMirror([buildSession({ messages: [base] })], first.snapshot)

  assert.deepEqual(second.messages, [])
})

test('planThreadMirror reports removed sessions and messages as deletions', () => {
  const first = planThreadMirror([
    buildSession({ id: 'session-1', messages: [buildMessage({ id: 'message-1' }), buildMessage({ id: 'message-2' })] }),
    buildSession({ id: 'session-2' }),
  ])

  const second = planThreadMirror([
    buildSession({
      id: 'session-1',
      updatedAt: '2026-08-03T00:09:00.000Z',
      messages: [buildMessage({ id: 'message-1' })],
    }),
  ], first.snapshot)

  assert.deepEqual(second.deletedThreadIds, ['session-2'])
  assert.deepEqual(second.deletedMessageIds, ['message-2'])
})

test('planThreadMirror does not treat an unloaded session as an emptied one', () => {
  const loaded = buildSession({ messages: [buildMessage({ id: 'message-1' })] })
  const first = planThreadMirror([loaded])

  const second = planThreadMirror([{
    ...loaded,
    messages: [],
    messagesLoaded: false,
  }], first.snapshot)

  assert.deepEqual(second.deletedMessageIds, [])
  assert.deepEqual(second.messages, [])
})

test('planThreadMirror carries agent, executor and external channel identity onto the thread', () => {
  const plan = planThreadMirror([buildSession({
    customAgentId: 'agent-1',
    executorId: 'executor-1',
    executionModel: 'claude-opus-4-8',
    sourceChannel: 'telegram',
    externalChatId: 'chat-1',
    pinnedAt: '2026-08-03T00:00:00.000Z',
  })])

  assert.deepEqual(plan.threads[0], {
    threadId: 'session-1',
    title: '默认会话',
    customAgentId: 'agent-1',
    executorId: 'executor-1',
    executionModel: 'claude-opus-4-8',
    sourceChannel: 'telegram',
    externalChatId: 'chat-1',
    pinnedAt: '2026-08-03T00:00:00.000Z',
    createdAt: '2026-08-03T00:00:00.000Z',
    updatedAt: '2026-08-03T00:00:00.000Z',
  })
})

test('planThreadMirror projects parts back to plain text for the content column', () => {
  const plan = planThreadMirror([buildSession({
    messages: [buildMessage({
      id: 'message-1',
      role: 'assistant',
      content: 'the answer',
      reasoning: ['thinking'],
    })],
  })])

  assert.equal(plan.messages[0].contentProjection, 'the answer')
})

test('planThreadMirror marks new messages with isNew=true', () => {
  // 主对话会在同一 tick 创建用户消息与 assistant 占位消息，createdAt 完全相同。
  const sameTs = '2026-08-04T00:00:00.000Z'
  const plan = planThreadMirror([buildSession({
    messages: [
      buildMessage({ id: 'zzz-user', role: 'user', content: '提问', createdAt: sameTs }),
      buildMessage({ id: 'aaa-assistant', role: 'assistant', content: '回答', createdAt: sameTs }),
    ],
  })])

  assert.deepEqual(
    plan.messages.map((item) => ({ id: item.message.id, isNew: item.isNew })),
    [{ id: 'zzz-user', isNew: true }, { id: 'aaa-assistant', isNew: true }],
  )
})

test('planThreadMirror rewrites messages whose order changed but content did not', () => {
  const first = buildMessage({ id: 'm1', content: 'a' })
  const second = buildMessage({ id: 'm2', content: 'b' })
  const initial = planThreadMirror([buildSession({ messages: [first, second] })])

  const reordered = planThreadMirror([buildSession({
    updatedAt: '2026-08-04T00:01:00.000Z',
    messages: [second, first],
  })], initial.snapshot)

  // 顺序变化时，m2 的 previousMessageId 从 undefined 变为 m1，m1 的从 m2 变为 undefined，
  // 因此两者都被标记为需要重写。isExisting=false 表示需要数据库分配 seq。
  assert.deepEqual(
    reordered.messages.map((item) => ({ id: item.message.id, isNew: item.isNew })),
    [{ id: 'm2', isNew: false }, { id: 'm1', isNew: false }],
  )
})

test('planThreadMirror keeps a re-added message id out of the deletion list', () => {
  const first = planThreadMirror([buildSession({ messages: [buildMessage({ id: 'message-1' })] })])
  const second = planThreadMirror([buildSession({
    updatedAt: '2026-08-03T00:07:00.000Z',
    messages: [buildMessage({ id: 'message-1' }), buildMessage({ id: 'message-2' })],
  })], first.snapshot)

  assert.deepEqual(second.deletedMessageIds, [])
  assert.deepEqual(second.messages.map((item) => item.message.id), ['message-2'])
})
