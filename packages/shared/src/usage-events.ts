// [INPUT]: Agent 执行产生的 token usage 事件（worker runtime → server 落点）。
// [OUTPUT]: 统一的 usage 事件记录契约、幂等键与 token 计数归一化。
// [POS]: 跨端共享的 token 用量事件模型；server 以 usage_events 表为唯一权威落点。
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import type { ModelTokenUsage } from './types/task-domain'

/**
 * 产生 usage 的执行入口类型。
 * - `task`：分布式任务执行（TaskRun）
 * - `main_chat`：主聊天 / 直接 Agent 会话（/chat）
 * - `workspace_turn`：工作区会话 turn（含派生子会话）
 * - `agent_event`：Agent 事件 / 收件箱任务执行
 * - `direct_chat` / `group_chat`：Agent 直聊 / 群聊（预留，走会话模型）
 */
export type UsageEventRunKind = 'task' | 'main_chat' | 'workspace_turn' | 'agent_event' | 'direct_chat' | 'group_chat'

/**
 * 用量事件的积分结算状态（Phase 2 官方模型扣费）。
 * - `none`：默认（BYOK 用量或尚未识别为官方托管）
 * - `hosted_pending`：已识别为官方托管、待结算（预留中间态）
 * - `hosted_settled`：已按价目表结算为积分消费
 */
export type UsageEventBillingStatus = 'none' | 'hosted_pending' | 'hosted_settled'

export type UsageEventRecord = {
  id: string
  runKind: UsageEventRunKind
  /** 来源执行 id（taskRunId / turnId / messageId / agentTaskRunId），与 runKind 组合保证幂等。 */
  runId: string
  /** 发起人 / 消费方（谁触发消耗算谁）。 */
  userId: string
  agentId?: string
  agentName?: string
  conversationId?: string
  workspaceId?: string
  workspaceSessionId?: string
  taskId?: string
  projectId?: string
  executorNodeId?: string
  providerId?: string
  modelId?: string
  executionModel?: string
  inputTokens: number
  outputTokens: number
  reasoningTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  totalTokens: number
  createdAt: string
  /** 积分结算状态（缺省 none）；仅官方托管（hosted）用量会被结算。 */
  billingStatus?: UsageEventBillingStatus
}

export type UsageEventTokenCounts = Pick<
  UsageEventRecord,
  'inputTokens' | 'outputTokens' | 'reasoningTokens' | 'cacheReadTokens' | 'cacheWriteTokens' | 'totalTokens'
>

const normalizeTokenCount = (value: number | undefined) => (
  typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.round(value) : 0
)

/** 从 ModelTokenUsage 归一化出六项 token 计数（缺省为 0），保证事件表列非空。 */
export const toUsageEventTokenCounts = (usage?: ModelTokenUsage | null): UsageEventTokenCounts => ({
  inputTokens: normalizeTokenCount(usage?.inputTokens),
  outputTokens: normalizeTokenCount(usage?.outputTokens),
  reasoningTokens: normalizeTokenCount(usage?.reasoningTokens),
  cacheReadTokens: normalizeTokenCount(usage?.cacheReadTokens),
  cacheWriteTokens: normalizeTokenCount(usage?.cacheWriteTokens),
  totalTokens: normalizeTokenCount(usage?.totalTokens),
})

export const usageEventDedupeKey = (record: Pick<UsageEventRecord, 'runKind' | 'runId'>) => (
  `${record.runKind}:${record.runId}`
)
