import assert from 'node:assert/strict'
import test from 'node:test'
import { buildHealthTitle, computeRangeStart, isRecordInRange } from './workspace-overview-shared'

test('computeRangeStart today 取当日零点，早于该时刻的时间戳不算今日', () => {
  const now = new Date('2025-08-16T14:30:00+08:00').getTime()
  const start = computeRangeStart('today', now)
  // 期望 = 运行环境本地时区的当日 0 点（与实现同基准，避免 TZ 敏感）
  const localMidnight = new Date(new Date(now).getFullYear(), new Date(now).getMonth(), new Date(now).getDate()).getTime()
  assert.equal(start, localMidnight)
  const todayNoon = new Date(new Date(now).getFullYear(), new Date(now).getMonth(), new Date(now).getDate(), 12).toISOString()
  assert.equal(isRecordInRange(todayNoon, start), true)
  const yesterdayLate = new Date(localMidnight - 1).toISOString()
  assert.equal(isRecordInRange(yesterdayLate, start), false)
})

test('computeRangeStart 7d / 30d 从 now 往前推', () => {
  const now = new Date('2025-08-16T14:30:00+08:00').getTime()
  assert.equal(computeRangeStart('7d', now), now - 7 * 86_400_000)
  assert.equal(computeRangeStart('30d', now), now - 30 * 86_400_000)
})

test('isRecordInRange 边界：恰好等于起算点算在范围内', () => {
  assert.equal(isRecordInRange(new Date('2025-08-09T14:30:00+08:00').toISOString(), computeRangeStart('7d', new Date('2025-08-16T14:30:00+08:00').getTime())), true)
})

test('buildHealthTitle 无数据显示「暂无数据」', () => {
  assert.equal(buildHealthTitle(null, null), '暂无数据')
  assert.equal(buildHealthTitle(0.5, null), '暂无数据')
})

test('buildHealthTitle 常规样本展示分数与 完成/派发', () => {
  assert.equal(buildHealthTitle(0.92, { completed: 23, dispatched: 25 }), '完成率 92% · 23/25')
  assert.equal(buildHealthTitle(1, { completed: 5, dispatched: 5 }), '完成率 100% · 5/5')
})

test('buildHealthTitle 无派发记录时不展示 0/0', () => {
  assert.equal(buildHealthTitle(1, { completed: 2, dispatched: 0 }), '完成率 100% · 已完成 2 项')
})
