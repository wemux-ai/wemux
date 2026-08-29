import assert from 'node:assert/strict'
import test from 'node:test'
import type { ExecutorRecord } from '@shared/types'
import { findAgentChannelSession, resolveAgentChannelActingUserId, resolveAgentChannelExecutorId } from './agent-channel-session-service'

const executor = (executorId: string, status: ExecutorRecord['status']) => ({ executorId, status })

test('keeps a preferred channel executor while it is visible and online', () => {
  assert.equal(resolveAgentChannelExecutorId([
    executor('executor-default', 'online'),
    executor('executor-preferred', 'online'),
  ], ['executor-preferred']), 'executor-preferred')
})

test('falls back to a visible online executor when the saved executor is stale', () => {
  assert.equal(resolveAgentChannelExecutorId([
    executor('executor-online', 'online'),
  ], ['executor-removed']), 'executor-online')
})

test('replaces an offline preferred executor when another visible executor is online', () => {
  assert.equal(resolveAgentChannelExecutorId([
    executor('executor-offline', 'offline'),
    executor('executor-online', 'online'),
  ], ['executor-offline']), 'executor-online')
})

test('clears a stale binding when the owner has no visible executors', () => {
  assert.equal(resolveAgentChannelExecutorId([], ['executor-removed']), undefined)
})

test('uses the configured executor owner when the stale Agent owner cannot access that executor', () => {
  assert.equal(resolveAgentChannelActingUserId({
    agentOwnerUserId: 'legacy-agent-owner',
    defaultExecutorOwnerUserId: 'current-executor-owner',
    fallbackUserId: 'fallback-user',
    ownerCanUseDefaultExecutor: false,
  }), 'current-executor-owner')
})

test('keeps the Agent owner when it can access the configured executor', () => {
  assert.equal(resolveAgentChannelActingUserId({
    agentOwnerUserId: 'agent-owner',
    defaultExecutorOwnerUserId: 'shared-executor-owner',
    fallbackUserId: 'fallback-user',
    ownerCanUseDefaultExecutor: true,
  }), 'agent-owner')
})

test('findAgentChannelSession isolates channel sessions by workspace', () => {
  const now = '2026-08-07T00:00:00.000Z'
  const base = { title: '会话', createdAt: now, updatedAt: now }
  const sessions = [
    { id: 's1', ...base, customAgentId: 'agent-1', sourceChannel: 'telegram' as const, externalConversationId: 'telegram:100', workspaceId: 'ws-1' },
    { id: 's2', ...base, customAgentId: 'agent-1', sourceChannel: 'telegram' as const, externalConversationId: 'telegram:100', workspaceId: 'ws-2' },
    { id: 's3', ...base, customAgentId: 'agent-1', sourceChannel: 'telegram' as const, externalConversationId: 'telegram:100' },
  ]

  assert.equal(findAgentChannelSession(sessions, {
    agentId: 'agent-1',
    sourceChannel: 'telegram',
    externalConversationId: 'telegram:100',
    workspaceId: 'ws-1',
  })?.id, 's1')
  assert.equal(findAgentChannelSession(sessions, {
    agentId: 'agent-1',
    sourceChannel: 'telegram',
    externalConversationId: 'telegram:100',
    workspaceId: 'ws-2',
  })?.id, 's2')
  // 老 URL（无 workspaceId）只命中全局会话，不与 workspace 会话串
  assert.equal(findAgentChannelSession(sessions, {
    agentId: 'agent-1',
    sourceChannel: 'telegram',
    externalConversationId: 'telegram:100',
  })?.id, 's3')
})
