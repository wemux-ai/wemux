// [INPUT]: Agent 画像与工作记录
// [OUTPUT]: Agent 健康评分（0-1）计算与持久化
// [POS]: Agent 画像联动层；评分基于 work_records 完成率，随任务完成触发，也可按需调用
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import { getAgent } from '../storage/postgres/agent-store'
import { listWorkRecords, upsertAgentProfile } from '../repositories/profile-store'

/** 纯函数：基于工作记录计算完成率评分（无数据取中性 0.5） */
export const scoreFromWorkRecords = (records: Array<{ recordType: string }>): number => {
  if (records.length === 0) return 0.5
  const completed = records.filter((record) => record.recordType === 'task_completed').length
  const dispatched = records.filter((record) => record.recordType === 'task_dispatched').length
  if (dispatched === 0) return completed > 0 ? 1 : 0.5
  return Math.min(1, Math.max(0, Number((completed / dispatched).toFixed(2))))
}

/** 基于最近工作记录计算健康评分 */
export const computeAgentHealthScore = async (agentId: string): Promise<number> => {
  const records = await listWorkRecords('agent', agentId, 200)
  return scoreFromWorkRecords(records)
}

/** 计算并写回 agent_profiles.health_score */
export const computeAndPersistAgentHealthScore = async (agentId: string): Promise<number> => {
  const agent = getAgent(agentId)
  if (!agent) return 0.5
  const healthScore = await computeAgentHealthScore(agentId)
  await upsertAgentProfile(agentId, { healthScore, lastActiveAt: new Date().toISOString() })
  return healthScore
}
