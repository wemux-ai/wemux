// [INPUT]: 纯函数输入（时间范围）
// [OUTPUT]: 时间范围纯函数行为断言
// [POS]: 组织服务纯函数测试（resolveRangeStart）；不连数据库
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import assert from 'node:assert/strict'
import test from 'node:test'
import { resolveRangeStart } from './timeline-service'

test('resolveRangeStart：today 为本地自然日 0 点', () => {
  const now = new Date('2026-08-11T18:30:00+08:00')
  const from = resolveRangeStart('today', now)
  // 期望 = 运行环境本地时区的当日 0 点（与实现同基准，避免 TZ 敏感）
  const localMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  assert.equal(from, localMidnight.toISOString())
})

test('resolveRangeStart：7d 为 6 天前 0 点（含今天共 7 天）', () => {
  const now = new Date('2026-08-11T10:00:00+08:00')
  const from = resolveRangeStart('7d', now)
  const localMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const sixDaysAgoMidnight = new Date(localMidnight.getTime() - 6 * 24 * 60 * 60 * 1000)
  assert.equal(from, sixDaysAgoMidnight.toISOString())
})
