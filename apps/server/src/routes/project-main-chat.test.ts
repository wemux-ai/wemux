import assert from 'node:assert/strict'
import test from 'node:test'
import type { AppState, MainChatSession } from '@shared/types'
import {
  buildMainChatMissingWorkingDirectoryMessage,
  removeMainChatSessionsForDeletedAgent,
  resolveFallbackOnlineExecutor,
  validateMainChatSessionCwdOnExecutor,
} from './project-main-chat'

test('resolveFallbackOnlineExecutor picks the first online executor', () => {
  const executors = [
    { executorId: 'e1', status: 'offline' as const },
    { executorId: 'e2', status: 'online' as const },
    { executorId: 'e3', status: 'online' as const },
  ]
  assert.equal(resolveFallbackOnlineExecutor(executors)?.executorId, 'e2')
})

test('resolveFallbackOnlineExecutor returns null when nothing is online', () => {
  const executors = [
    { executorId: 'e1', status: 'offline' as const },
    { executorId: 'e2', status: 'paired' as const },
  ]
  assert.equal(resolveFallbackOnlineExecutor(executors), null)
  assert.equal(resolveFallbackOnlineExecutor([]), null)
})

test('removeMainChatSessionsForDeletedAgent clears deleted Agent sessions and selects a remaining session', () => {
  const deletedSession = {
    id: 'session-deleted',
    title: 'Deleted Agent session',
    customAgentId: 'agent-deleted',
    messages: [{ id: 'deleted-message', role: 'assistant', content: 'old', createdAt: '2026-07-22T00:00:00.000Z' }],
    createdAt: '2026-07-22T00:00:00.000Z',
    updatedAt: '2026-07-22T00:00:00.000Z',
  } as MainChatSession
  const retainedSession = {
    id: 'session-retained',
    title: 'Retained Agent session',
    customAgentId: 'agent-retained',
    messages: [{ id: 'retained-message', role: 'assistant', content: 'keep', createdAt: '2026-07-22T00:01:00.000Z' }],
    createdAt: '2026-07-22T00:01:00.000Z',
    updatedAt: '2026-07-22T00:01:00.000Z',
  } as MainChatSession
  const state = {
    mainChatSessions: [deletedSession, retainedSession],
    selectedMainChatSessionId: deletedSession.id,
  } as AppState

  const nextState = removeMainChatSessionsForDeletedAgent(state, 'agent-deleted')

  assert.deepEqual(nextState.mainChatSessions.map((session) => session.id), [retainedSession.id])
  assert.equal(nextState.selectedMainChatSessionId, retainedSession.id)
})

test('validateMainChatSessionCwdOnExecutor skips validation when the session is not bound to a cwd', async () => {
  const result = await validateMainChatSessionCwdOnExecutor({
    executorName: 'executor-1',
    browseDirectory: async () => ({ ok: true }),
  })

  assert.deepEqual(result, { ok: true })
})

test('validateMainChatSessionCwdOnExecutor returns a helpful message when the bound cwd is missing', async () => {
  const result = await validateMainChatSessionCwdOnExecutor({
    boundCwd: '/tmp/project',
    executorName: 'executor-2',
    browseDirectory: async () => ({ ok: false, message: '目录不存在。' }),
  })

  assert.equal(result.ok, false)
  assert.match(result.message, /executor-2/)
  assert.match(result.message, /\/tmp\/project/)
  assert.match(result.message, /clone 或准备这个项目目录/)
  assert.match(result.message, /目录不存在/)
})

test('buildMainChatMissingWorkingDirectoryMessage includes the recovery hint', () => {
  const message = buildMainChatMissingWorkingDirectoryMessage({
    cwd: '/tmp/demo',
    executorName: 'executor-3',
    detail: '目录不存在。',
  })

  assert.match(message, /当前会话绑定的工作目录/)
  assert.match(message, /请先在该节点准备仓库/)
})
