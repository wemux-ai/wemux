import assert from 'node:assert/strict'
import test from 'node:test'
import { writeCustomAgentConfig } from '@shared/custom-agent'
import type { AgentCron } from '../repositories/agent'
import {
  buildHeartbeatConversationDayKey,
  buildHeartbeatIdempotencyKey,
  HEARTBEAT_MIN_INTERVAL_MINUTES,
  isHeartbeatInActiveWindow,
  readHeartbeatActiveWindow,
  readHeartbeatDailyLimit,
  resolveTimeInZone,
  selectDueHeartbeatSchedules,
  startUtcDayIso,
  validateHeartbeatCronFrequency,
} from './agent-heartbeat-scheduler'

const makeCron = (overrides: Partial<AgentCron> = {}): AgentCron => ({
  id: 'cron-1',
  agentId: 'agent-1',
  name: '定时心跳',
  cronExpression: '0 * * * *',
  payload: {},
  enabled: true,
  lastRunAt: null,
  nextRunAt: '2026-08-13T09:00:00.000Z',
  createdAt: '2026-08-13T00:00:00.000Z',
  ...overrides,
})

const makeAgent = (id: string, overrides: { enabled?: boolean; archived?: boolean } = {}) => ({
  id,
  type: 'custom',
  config: writeCustomAgentConfig({}, {
    enabled: overrides.enabled ?? true,
    archived: overrides.archived ?? false,
  }),
})

test('selectDueHeartbeatSchedules picks enabled custom agents without active heartbeat events', () => {
  const cron = makeCron()
  const selected = selectDueHeartbeatSchedules(
    [cron],
    [makeAgent('agent-1')],
    () => false,
  )
  assert.equal(selected.length, 1)
  assert.equal(selected[0]!.cron.id, 'cron-1')
  assert.equal(selected[0]!.slot, cron.nextRunAt)
})

test('selectDueHeartbeatSchedules skips missing, disabled, or archived agents', () => {
  const crons = [
    makeCron({ id: 'cron-missing', agentId: 'agent-missing' }),
    makeCron({ id: 'cron-disabled', agentId: 'agent-disabled' }),
    makeCron({ id: 'cron-archived', agentId: 'agent-archived' }),
    makeCron({ id: 'cron-ok', agentId: 'agent-ok' }),
  ]
  const agents = [
    makeAgent('agent-disabled', { enabled: false }),
    makeAgent('agent-archived', { archived: true }),
    makeAgent('agent-ok'),
  ]
  const selected = selectDueHeartbeatSchedules(crons, agents, () => false)
  assert.deepEqual(selected.map((item) => item.cron.id), ['cron-ok'])
})

test('selectDueHeartbeatSchedules skips agents with an active heartbeat event (no overlap)', () => {
  const selected = selectDueHeartbeatSchedules(
    [makeCron()],
    [makeAgent('agent-1')],
    (agentId) => agentId === 'agent-1',
  )
  assert.equal(selected.length, 0)
})

test('selectDueHeartbeatSchedules deduplicates the same schedule/slot via published keys', () => {
  const published = new Set([buildHeartbeatIdempotencyKey('cron-1', '2026-08-13T09:00:00.000Z')])
  const selected = selectDueHeartbeatSchedules(
    [makeCron()],
    [makeAgent('agent-1')],
    () => false,
    published,
  )
  assert.equal(selected.length, 0)
})

test('idempotency key is stable for the same schedule and slot', () => {
  assert.equal(
    buildHeartbeatIdempotencyKey('cron-1', '2026-08-13T09:00:00.000Z'),
    buildHeartbeatIdempotencyKey('cron-1', '2026-08-13T09:00:00.000Z'),
  )
  assert.notEqual(
    buildHeartbeatIdempotencyKey('cron-1', '2026-08-13T09:00:00.000Z'),
    buildHeartbeatIdempotencyKey('cron-1', '2026-08-13T10:00:00.000Z'),
  )
  assert.notEqual(
    buildHeartbeatIdempotencyKey('cron-1', '2026-08-13T09:00:00.000Z'),
    buildHeartbeatIdempotencyKey('cron-2', '2026-08-13T09:00:00.000Z'),
  )
})

test('heartbeat frequency guard accepts low-frequency crons and rejects abusive ones', () => {
  assert.equal(validateHeartbeatCronFrequency('0 0 * * *'), null)
  assert.equal(validateHeartbeatCronFrequency('0 */6 * * *'), null)
  assert.equal(validateHeartbeatCronFrequency('bad expression'), 'Cron expression must have exactly 5 fields, got 2')
  assert.ok(validateHeartbeatCronFrequency('* * * * *')?.includes(`${HEARTBEAT_MIN_INTERVAL_MINUTES} 分钟`))
  assert.ok(validateHeartbeatCronFrequency('*/2 * * * *')?.includes('间隔'))
  // 恰好等于最低间隔（5 分钟）允许
  assert.equal(validateHeartbeatCronFrequency('*/5 * * * *'), null)
})

test('heartbeat conversation day key rotates by UTC date (session bounded per day)', () => {
  const now = Date.parse('2026-08-14T16:00:00.000Z')
  // 过去的槽位：按槽位自身日期（跨天即换新会话）
  assert.equal(buildHeartbeatConversationDayKey('2026-08-13T08:00:00.000Z', now), '2026-08-13')
  assert.equal(buildHeartbeatConversationDayKey('2026-08-14T00:00:00.000Z', now), '2026-08-14')
  // 槽位缺失/未来：回退当前日期
  assert.equal(buildHeartbeatConversationDayKey('', now), '2026-08-14')
  assert.equal(buildHeartbeatConversationDayKey('2026-08-15T00:00:00.000Z', now), '2026-08-14')
})

test('active window parsing rejects invalid configs and resolves zoned time', () => {
  assert.equal(readHeartbeatActiveWindow({}), null)
  assert.equal(readHeartbeatActiveWindow({ activeWindow: { start: '09:00', end: '09:00' } }), null) // start >= end
  assert.equal(readHeartbeatActiveWindow({ activeWindow: { start: '9:00', end: '21:00' } }), null) // 格式非法
  const parsed = readHeartbeatActiveWindow({ activeWindow: { start: '09:00', end: '21:00', timezone: 'Asia/Shanghai' } })
  assert.deepEqual(parsed, { start: '09:00', end: '21:00', timezone: 'Asia/Shanghai' })
  // 未知时区回退 UTC
  assert.equal(readHeartbeatActiveWindow({ activeWindow: { start: '09:00', end: '21:00', timezone: 'Mars/Olympus' } })?.timezone, 'UTC')
  assert.equal(resolveTimeInZone('2026-08-14T00:30:00.000Z', 'Asia/Shanghai'), '08:30')
})

test('heartbeat is skipped outside the active window', () => {
  const window = { start: '09:00', end: '21:00', timezone: 'Asia/Shanghai' }
  // 08:00 CST 窗口外
  assert.equal(isHeartbeatInActiveWindow('2026-08-14T00:00:00.000Z', window), false)
  // 09:30 CST 窗口内
  assert.equal(isHeartbeatInActiveWindow('2026-08-14T01:30:00.000Z', window), true)
  // 21:00 CST 边界（end 不含）
  assert.equal(isHeartbeatInActiveWindow('2026-08-14T13:00:00.000Z', window), false)
})

test('daily limit parsing caps at 1000 and ignores non-positive values', () => {
  assert.equal(readHeartbeatDailyLimit({}), null)
  assert.equal(readHeartbeatDailyLimit({ dailyLimit: 0 }), null)
  assert.equal(readHeartbeatDailyLimit({ dailyLimit: -3 }), null)
  assert.equal(readHeartbeatDailyLimit({ dailyLimit: 24 }), 24)
  assert.equal(readHeartbeatDailyLimit({ dailyLimit: 5000 }), 1000)
})

test('utc day boundary anchor is midnight', () => {
  const now = Date.parse('2026-08-14T16:30:00.000Z')
  assert.equal(startUtcDayIso(now), '2026-08-14T00:00:00.000Z')
})
