// [INPUT]: Agent 执行产生的 token usage（各链路调用统一入口）。
// [OUTPUT]: usage_events 唯一权威事件 + 幂等去重。
// [POS]: 统一 usage 事件服务；task / main_chat / workspace_turn / agent_event 全部走 recordUsageEvent。
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
import { parseExecutionModelId } from '@shared/model-profile'
import type { ModelTokenUsage } from '@shared/types'
import { toUsageEventTokenCounts, type UsageEventRunKind } from '@shared/usage-events'
import { persistUsageEvent, type UsageEventQuery } from '../storage/postgres/usage-event-store'
import { listUsageEvents as listStoredUsageEvents } from '../storage/postgres/usage-event-store'

export type RecordUsageEventParams = {
  runKind: UsageEventRunKind
  runId: string
  userId: string
  agentId?: string
  agentName?: string
  conversationId?: string
  workspaceId?: string
  workspaceSessionId?: string
  taskId?: string
  projectId?: string
  executorNodeId?: string
  executionModel?: string
  usage?: ModelTokenUsage | null
  createdAt?: string
}

/**
 * 统一入口：所有 Agent 执行的 token 消耗都通过本函数落 usage_events。
 * 无有效 token 消耗（total/input/output 均为 0）时不落事件，避免空记录。
 */
export const recordUsageEvent = async (params: RecordUsageEventParams): Promise<boolean> => {
  const counts = toUsageEventTokenCounts(params.usage)
  if (counts.totalTokens <= 0 && counts.inputTokens <= 0 && counts.outputTokens <= 0) {
    return false
  }

  const parsed = parseExecutionModelId(params.executionModel?.trim() || '')
  const createdAt = params.createdAt ?? new Date().toISOString()
  await persistUsageEvent({
    id: `usage:${params.runKind}:${params.runId}`,
    runKind: params.runKind,
    runId: params.runId,
    userId: params.userId,
    agentId: params.agentId,
    agentName: params.agentName,
    conversationId: params.conversationId,
    workspaceId: params.workspaceId,
    workspaceSessionId: params.workspaceSessionId,
    taskId: params.taskId,
    projectId: params.projectId,
    executorNodeId: params.executorNodeId,
    providerId: parsed?.providerId,
    modelId: parsed?.modelId || params.executionModel?.trim() || undefined,
    executionModel: params.executionModel?.trim() || undefined,
    ...counts,
    createdAt,
  })
  return true
}

export const listUsageEvents = async (query: UsageEventQuery = {}) => {
  return listStoredUsageEvents(query)
}
