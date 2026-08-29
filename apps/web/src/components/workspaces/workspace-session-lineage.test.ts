import assert from 'node:assert/strict'
import test from 'node:test'
import { resolveWorkspaceSessionLineageSummary } from './workspace-session-lineage'

test('resolveWorkspaceSessionLineageSummary labels rewrite fork sessions', () => {
  const summary = resolveWorkspaceSessionLineageSummary({
    sessionOrigin: 'fork',
    forkMode: 'local',
    forkedFromSessionId: 'source-1',
    forkRevision: {
      kind: 'rewrite-user-turn',
      sourceTurnId: 'turn-1',
      sourceUserMessageId: 'message-user-1',
    },
  }, [
    { id: 'source-1', title: '原始会话' },
  ])

  assert.deepEqual(summary, {
    badgeLabel: '改写分叉',
    description: '来源会话「原始会话」的较早用户回合',
  })
})

test('resolveWorkspaceSessionLineageSummary labels retry fork sessions', () => {
  const summary = resolveWorkspaceSessionLineageSummary({
    sessionOrigin: 'fork',
    forkMode: 'worktree',
    forkedFromSessionId: 'source-2',
    forkRevision: {
      kind: 'retry-assistant-turn',
      sourceTurnId: 'turn-2',
      sourceUserMessageId: 'message-user-2',
      sourceAssistantMessageId: 'message-assistant-2',
    },
  }, [
    { id: 'source-2', title: '设计评审' },
  ])

  assert.deepEqual(summary, {
    badgeLabel: '重试分叉',
    description: '来源会话「设计评审」的较早助手回复',
  })
})
