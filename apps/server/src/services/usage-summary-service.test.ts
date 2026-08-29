import assert from 'node:assert/strict'
import test from 'node:test'
import type { UsageEventRecord } from '@shared/usage-events'
import { resolveUsagePeriod, summarizeUsageEvents } from './usage-summary-service'

const createEvent = (id: string, overrides: Partial<UsageEventRecord> = {}): UsageEventRecord => ({
  id,
  runKind: overrides.runKind ?? 'task',
  runId: overrides.runId ?? `run-${id}`,
  userId: overrides.userId ?? 'user-1',
  agentId: overrides.agentId,
  agentName: overrides.agentName,
  conversationId: overrides.conversationId,
  workspaceId: overrides.workspaceId,
  workspaceSessionId: overrides.workspaceSessionId,
  taskId: overrides.taskId,
  projectId: overrides.projectId,
  executorNodeId: overrides.executorNodeId,
  providerId: overrides.providerId,
  modelId: overrides.modelId,
  executionModel: overrides.executionModel,
  inputTokens: overrides.inputTokens ?? 0,
  outputTokens: overrides.outputTokens ?? 0,
  reasoningTokens: overrides.reasoningTokens ?? 0,
  cacheReadTokens: overrides.cacheReadTokens ?? 0,
  cacheWriteTokens: overrides.cacheWriteTokens ?? 0,
  totalTokens: overrides.totalTokens ?? ((overrides.inputTokens ?? 0) + (overrides.outputTokens ?? 0)),
  createdAt: overrides.createdAt ?? '2026-08-08T10:00:00.000Z',
})

test('summarizeUsageEvents aggregates totals and dimension buckets', () => {
  const summary = summarizeUsageEvents([
    createEvent('1', {
      agentId: 'agent-a',
      agentName: 'Agent A',
      executionModel: 'openai/gpt-5',
      providerId: 'openai',
      workspaceId: 'ws-1',
      inputTokens: 1000,
      outputTokens: 500,
      totalTokens: 1500,
    }),
    createEvent('2', {
      agentId: 'agent-a',
      agentName: 'Agent A',
      executionModel: 'openai/gpt-5',
      providerId: 'openai',
      workspaceId: 'ws-1',
      inputTokens: 200,
      outputTokens: 100,
      totalTokens: 300,
    }),
    createEvent('3', {
      agentId: 'agent-b',
      agentName: 'Agent B',
      executionModel: 'anthropic/claude-4',
      providerId: 'anthropic',
      workspaceId: 'ws-2',
      inputTokens: 500,
      outputTokens: 250,
      totalTokens: 750,
    }),
  ], 'all', new Date('2026-08-08T12:00:00.000Z'))

  assert.equal(summary.totals.runCount, 3)
  assert.equal(summary.totals.totalTokens, 2550)
  assert.equal(summary.totals.inputTokens, 1700)
  assert.equal(summary.totals.outputTokens, 850)

  // byAgent 按 token 降序
  assert.deepEqual(summary.byAgent.map((row) => row.agentName), ['Agent A', 'Agent B'])
  assert.equal(summary.byAgent[0]?.totals.totalTokens, 1800)

  // byProvider / byModel / byWorkspace
  assert.equal(summary.byProvider[0]?.providerId, 'openai')
  assert.equal(summary.byProvider[0]?.totals.totalTokens, 1800)
  assert.equal(summary.byModel[0]?.executionModel, 'openai/gpt-5')
  assert.equal(summary.byWorkspace[0]?.workspaceId, 'ws-1')

  // byRunKind
  assert.deepEqual(summary.byRunKind.map((row) => row.runKind), ['task'])
  assert.equal(summary.byRunKind[0]?.totals.runCount, 3)

  // daily 桶（all 周期内只有 1 天）
  assert.equal(summary.daily.length, 1)
  assert.equal(summary.daily[0]?.totalTokens, 2550)
})

test('summarizeUsageEvents respects period window and fills daily buckets', () => {
  const now = new Date('2026-08-08T12:00:00.000Z')
  const summary = summarizeUsageEvents([
    createEvent('recent', { totalTokens: 100, inputTokens: 50, outputTokens: 50, createdAt: '2026-08-07T10:00:00.000Z' }),
    createEvent('old', { totalTokens: 999, inputTokens: 500, outputTokens: 499, createdAt: '2026-07-01T10:00:00.000Z' }),
  ], '7d', now)

  assert.equal(summary.totals.runCount, 1)
  assert.equal(summary.totals.totalTokens, 100)
  assert.equal(summary.daily.length, 7)
  assert.equal(summary.daily[6]?.totalTokens, 0)
})

test('resolveUsagePeriod normalizes query values', () => {
  assert.equal(resolveUsagePeriod('7d'), '7d')
  assert.equal(resolveUsagePeriod('30d'), '30d')
  assert.equal(resolveUsagePeriod('all'), 'all')
  assert.equal(resolveUsagePeriod(undefined), 'all')
  assert.equal(resolveUsagePeriod('90d'), 'all')
})
