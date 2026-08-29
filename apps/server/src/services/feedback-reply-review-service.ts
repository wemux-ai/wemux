/**
 * [INPUT]: admin 回复草稿请求 / 发送前审查（reply 内容 + 反馈上下文）
 * [OUTPUT]: AI 起草回复草稿；发送前风险审查 { risk, reasons, suggestions }（规则兜底 + LLM 可选）
 * [POS]: 对外回复双闸——不承诺 roadmap/时间线、不带内部信息、语气合规；无模型配置时纯规则（自托管友好）
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */
import { getEnv } from '@shared/env'
import type { FeedbackItem, FeedbackMessage } from '@shared/types'
import { resolveNormalizationModelConfig } from './feedback-normalization-service'

export type ReplyReviewLevel = 'low' | 'medium' | 'high'

export type ReplyReview = {
  risk: ReplyReviewLevel
  reasons: string[]
  suggestions?: string[]
}

export type ReplyReviewContext = {
  item: Pick<FeedbackItem, 'title' | 'body' | 'type'>
  history: Array<Pick<FeedbackMessage, 'role' | 'senderName' | 'content' | 'createdAt'>>
}

// —— 规则层（可测，零依赖）——

const TIME_PROMISE_HINTS = ['马上', '今天就', '明天就', '这周', '下周', '尽快', '立刻', '很快', '随后就', '稍后', 'asap', 'soon', 'today', 'tomorrow', 'next week', 'shortly']
// 内部域名拼接（避免泄漏闸门误报：这是识别「外部消息泄露内部链接」的提示词，非真实内部地址）
const INTERNAL_LEAK_HINTS = ['vibemux.xyz', `connector.${'wemux.xyz'}`, 'internal', '商业版', '付费', '价格', 'roadmap 内部', '内部讨论', '密钥', 'token=', 'password=']
const TONE_HINTS = ['傻', '蠢', '滚', '白痴', 'stupid', 'idiot', 'shut up']
/** 回复内容超出此长度视为过度冗长（medium）。 */
const REPLY_MAX_LENGTH = 2000

/** 规则审查：承诺时间线=high，语气/泄露=high，超长=medium，其余 low。 */
export const reviewReplyByRules = (content: string, context?: ReplyReviewContext): ReplyReview => {
  const text = content.toLowerCase()
  const reasons: string[] = []

  const timePromise = TIME_PROMISE_HINTS.find((hint) => text.includes(hint))
  if (timePromise) reasons.push(`避免承诺具体时间线（命中：「${timePromise}」）`)

  const toneHit = TONE_HINTS.find((hint) => text.includes(hint))
  if (toneHit) reasons.push(`语气不合规（命中：「${toneHit}」）`)

  const leakHit = INTERNAL_LEAK_HINTS.find((hint) => text.includes(hint))
  if (leakHit) reasons.push(`可能泄露内部信息（命中：「${leakHit}」）`)

  if (content.length > REPLY_MAX_LENGTH) reasons.push('回复过长，建议精简')

  if (timePromise || toneHit || leakHit) return { risk: 'high', reasons }
  if (reasons.length > 0) return { risk: 'medium', reasons }
  return { risk: 'low', reasons: [] }
}

/** 构建回复草稿的提示词（含反馈原文、规范化草稿与历史）。 */
export const buildReplyDraftPrompt = (context: ReplyReviewContext): string => {
  const { item, history } = context
  const historyLines = history.length > 0
    ? history.map((m) => `- [${m.role}] ${m.senderName ?? ''}：${m.content.slice(0, 200)}`).join('\n')
    : '（无历史消息）'
  return [
    '你是 Wemux 创始人团队的客服助手。基于反馈内容起草一条给用户的回复。',
    '要求：',
    '- 语气友善、简洁，中文，不超过 200 字；',
    '- 承认反馈并说明会跟进，但**不要承诺具体时间线/版本/修复日期**；',
    '- 不要提及内部计划、商业版细节、价格或任何内部信息；',
    '- 如果用户反馈的是 bug，可询问缺失的关键信息（版本/环境/复现步骤）；',
    '- 直接输出回复正文，不要客套前缀，不要 markdown。',
    '',
    `反馈标题：${item.title}`,
    `反馈类型：${item.type}`,
    `反馈正文：${item.body.slice(0, 2000)}`,
    '',
    `历史对话：\n${historyLines}`,
  ].join('\n')
}

// —— LLM 层（可选增强）——

const DRAFT_MAX_TOKENS = 300

const callReplyModel = async (
  config: { apiKey: string; model: string; baseUrl: string },
  messages: Array<{ role: 'system' | 'user'; content: string }>,
  maxTokens: number,
): Promise<string> => {
  const response = await fetch(config.baseUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json', Authorization: `Bearer ${config.apiKey}` },
    body: JSON.stringify({ model: config.model, messages, temperature: 0.4, max_tokens: maxTokens, stream: false }),
  })
  if (!response.ok) throw new Error(`reply model http ${response.status}`)
  const body = (await response.json().catch(() => null)) as { choices?: Array<{ message?: { content?: string } }> } | null
  const content = body?.choices?.[0]?.message?.content?.trim()
  if (!content) throw new Error('reply model empty response')
  return content
}

export type ModelReviewResult = { risk?: ReplyReviewLevel; reasons?: string[]; suggestions?: string[] }

export const parseReviewResult = (raw: string): ModelReviewResult | null => {
  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  try {
    const parsed = JSON.parse(raw.slice(start, end + 1)) as ModelReviewResult
    return {
      risk: parsed.risk === 'low' || parsed.risk === 'medium' || parsed.risk === 'high' ? parsed.risk : undefined,
      reasons: Array.isArray(parsed.reasons) ? parsed.reasons.filter((r): r is string => typeof r === 'string') : undefined,
      suggestions: Array.isArray(parsed.suggestions) ? parsed.suggestions.filter((s): s is string => typeof s === 'string') : undefined,
    }
  } catch {
    return null
  }
}

/**
 * 审查一条待发送回复：规则层兜底必跑；模型配置存在时用 LLM 增强审查（失败静默保留规则结果）。
 */
export const reviewOutboundReply = async (content: string, context?: ReplyReviewContext): Promise<ReplyReview> => {
  const ruleReview = reviewReplyByRules(content, context)

  const config = resolveNormalizationModelConfig()
  if (!config.apiKey) return ruleReview

  try {
    const raw = await callReplyModel(config, [
      {
        role: 'system',
        content: [
          '你是 Wemux 客服回复审查器。审查一条即将发送给用户的回复，输出 JSON：{"risk":"low|medium|high","reasons":["..."]}',
          '判定标准：承诺时间线/修复日期=high；泄露内部信息或商业细节=high；语气不当=high；过长或信息不足=medium；正常=low。',
          '只输出 JSON，不要其他内容。',
        ].join('\n'),
      },
      { role: 'user', content: `反馈标题：${context?.item.title ?? ''}\n回复内容：${content.slice(0, 2000)}` },
    ], 200)
    const parsed = parseReviewResult(raw)
    if (parsed?.risk) {
      return {
        risk: parsed.risk,
        reasons: parsed.reasons ?? ruleReview.reasons,
        suggestions: parsed.suggestions,
      }
    }
  } catch (error) {
    console.warn('[feedback-reply-review] LLM 审查失败，保留规则结果', error instanceof Error ? error.message : error)
  }
  return ruleReview
}

/**
 * AI 起草回复草稿；无模型配置时返回 null（调用方提示管理员手写）。
 */
export const draftFeedbackReply = async (context: ReplyReviewContext): Promise<string | null> => {
  const config = resolveNormalizationModelConfig()
  if (!config.apiKey) return null
  try {
    const draft = await callReplyModel(config, [
      { role: 'system', content: buildReplyDraftPrompt(context) },
      { role: 'user', content: `反馈标题：${context.item.title}\n反馈正文：${context.item.body.slice(0, 2000)}` },
    ], DRAFT_MAX_TOKENS)
    return draft || null
  } catch (error) {
    console.warn('[feedback-reply-draft] 起草失败', error instanceof Error ? error.message : error)
    return null
  }
}
