// [INPUT]: 概览页展示所需的纯逻辑输入（完成率样本、时间范围、记录时间）
// [OUTPUT]: 概览页纯函数：完成率 tooltip、时间范围起算、记录是否在范围内
// [POS]: 组织概览页纯逻辑层；与 UI 解耦便于 node:test
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

export const RANGE_OPTIONS = [
  ['today', '今天'],
  ['7d', '近 7 天'],
  ['30d', '近 30 天'],
] as const

export type RangeKey = (typeof RANGE_OPTIONS)[number][0]

/** 时间范围起算点（毫秒）：今天 = 当日零点；7d/30d = now 往前推 */
export const computeRangeStart = (range: RangeKey, now = Date.now()): number => {
  if (range === 'today') {
    const startOfToday = new Date(now)
    startOfToday.setHours(0, 0, 0, 0)
    return startOfToday.getTime()
  }
  return now - (range === '7d' ? 7 : 30) * 86_400_000
}

/** 记录是否落在时间范围内 */
export const isRecordInRange = (occurredAt: string, rangeStart: number): boolean =>
  new Date(occurredAt).getTime() >= rangeStart

export type HealthSample = { completed: number; dispatched: number } | null

/** Agent 完成率 tooltip：分数 + 样本量（无数据显示「暂无数据」） */
export const buildHealthTitle = (score: number | null, sample: HealthSample): string => {
  if (score == null || sample == null) return '暂无数据'
  const pct = Math.round(score * 100)
  if (sample.dispatched === 0) return `完成率 ${pct}% · 已完成 ${sample.completed} 项`
  return `完成率 ${pct}% · ${sample.completed}/${sample.dispatched}`
}
