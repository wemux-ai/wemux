/**
 * [INPUT]: 各渠道反馈入口（产品内表单、飞书/Discord webhook、GitHub 反向同步）
 * [OUTPUT]: 统一落库的 FeedbackItem（含 deduped 标记）；非产品来源按 originRef 幂等去重
 * [POS]: 全渠道反馈收件箱唯一 ingest 入口；渠道接入方不得绕过本服务直接写 feedback_items
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */
import type { FeedbackItem, FeedbackOriginRef, FeedbackSource, FeedbackType } from '@shared/types'
import { createFeedbackItem, getFeedbackItemByOriginRef } from '../storage/postgres/feedback-store'
import { normalizeFeedback } from './feedback-normalization-service'

export type FeedbackIngestInput = {
  source: FeedbackSource
  /** 渠道消息锚点；product 来源可省略，其余来源必填（原路回复与幂等去重都依赖它）。 */
  originRef?: FeedbackOriginRef
  type: FeedbackType
  title: string
  body: string
  userId?: string | null
  userEmail?: string | null
  consentPublic?: boolean
}

export type FeedbackIngestResult = {
  item: FeedbackItem
  /** true = 命中同 originRef 的既有条目（webhook 重投递），未重复落库。 */
  deduped: boolean
}

/** 非产品来源必须携带渠道锚点：没有 originRef 就无法回帖也无法幂等去重。 */
const assertOriginRef = (input: FeedbackIngestInput): void => {
  if (input.source !== 'product' && !input.originRef?.channel) {
    throw new Error(`feedback source=${input.source} 必须携带 originRef.channel`)
  }
}

export const ingestFeedback = async (input: FeedbackIngestInput): Promise<FeedbackIngestResult> => {
  assertOriginRef(input)

  // webhook 至少一次投递语义下，同一渠道消息可能到达多次：按 channel+messageId 幂等
  if (input.originRef?.channel && input.originRef.messageId) {
    const existing = await getFeedbackItemByOriginRef(input.originRef.channel, input.originRef.messageId)
    if (existing) {
      return { item: existing, deduped: true }
    }
  }

  const item = await createFeedbackItem({
    id: `feedback:${crypto.randomUUID()}`,
    type: input.type,
    title: input.title,
    body: input.body,
    userId: input.userId ?? null,
    userEmail: input.userEmail ?? null,
    source: input.source,
    originRef: input.originRef,
    consentPublic: input.consentPublic ?? false,
    createdAt: new Date().toISOString(),
  })

  // 入库即跑：纯规则规范化（不调模型，零配额成本）；LLM 增强由 admin 按钮触发
  void normalizeFeedback(item.id, { forceLlm: false }).catch((error: unknown) => {
    console.warn('[feedback-ingest] 自动规范化失败（不影响入库）', error instanceof Error ? error.message : error)
  })

  return { item, deduped: false }
}
