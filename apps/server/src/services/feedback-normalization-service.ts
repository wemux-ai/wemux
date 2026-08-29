/**
 * [INPUT]: 反馈条目（admin 手动触发或 ingest 后异步）、env 模型配置（WEMUX_FEEDBACK_NORMALIZATION_*）
 * [OUTPUT]: FeedbackNormalized 写入（rule 规则兜底 / llm 大模型增强）
 * [POS]: AI 加工层——口语反馈 → 结构化迷你 PRD；分类/查重/草稿；无模型配置时降级纯规则（自托管友好）
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */
import { getEnv } from '@shared/env'
import type { FeedbackItem, FeedbackNormalized } from '@shared/types'
import { getFeedbackItem, setFeedbackNormalized } from '../storage/postgres/feedback-store'

const DEFAULT_NORMALIZATION_MODEL = 'deepseek-chat'
const DEFAULT_NORMALIZATION_BASE_URL = 'https://api.deepseek.com/chat/completions'

export type NormalizationModelConfig = {
  apiKey: string
  model: string
  baseUrl: string
}

/** 模型配置：独立 env 优先，回退到调度大脑的 DEEPSEEK_* 变量；baseUrl 可指向任意 OpenAI 兼容端点（插拔）。 */
export const resolveNormalizationModelConfig = (): NormalizationModelConfig => {
  const apiKey = getEnv('WEMUX_FEEDBACK_NORMALIZATION_API_KEY')?.trim()
    || process.env.DEEPSEEK_API_KEY?.trim() || ''
  const model = getEnv('WEMUX_FEEDBACK_NORMALIZATION_MODEL')?.trim()
    || process.env.DEEPSEEK_SCHEDULING_BRAIN_MODEL?.trim() || DEFAULT_NORMALIZATION_MODEL
  const baseUrl = getEnv('WEMUX_FEEDBACK_NORMALIZATION_BASE_URL')?.trim() || DEFAULT_NORMALIZATION_BASE_URL
  return { apiKey, model, baseUrl }
}

// —— 纯函数层（可测，不依赖 DB/网络）——

const BUG_HINTS = ['bug', 'error', '失败', '报错', '崩溃', '闪退', '坏了', '不对', '异常', '无法', '不能', 'broken', 'crash', 'fail']
const FEATURE_HINTS = ['建议', '希望', '想要', '能不能加', 'feature', 'request', '想法', 'improve', 'better', '加个']
const CHAT_HINTS = ['你好', '在吗', 'hi', 'hello', '请问', '问一下', '怎么用', '如何']

/** 规则兜底分类：bug 优先，其次 feature，无命中归 chat。仅作 fallback，不覆盖用户/渠道预设 type。 */
export const classifyFeedbackRuleBased = (title: string, body: string): 'bug' | 'feature' | 'chat' => {
  const text = `${title}\n${body}`.toLowerCase()
  if (BUG_HINTS.some((hint) => text.includes(hint))) return 'bug'
  if (FEATURE_HINTS.some((hint) => text.includes(hint))) return 'feature'
  if (CHAT_HINTS.some((hint) => text.includes(hint))) return 'chat'
  return 'chat'
}

type ParsedNormalization = {
  type?: 'bug' | 'feature' | 'chat'
  draft?: FeedbackNormalized['draft']
  duplicateOfId?: string | null
}

/** 从 LLM 输出中容错提取 JSON（容忍 markdown fence 与前后多余文本）。 */
export const parseNormalizationResult = (raw: string): ParsedNormalization | null => {
  const text = raw.trim()
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  const candidate = fenced ? fenced[1]! : text
  const start = candidate.indexOf('{')
  const end = candidate.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  try {
    const parsed = JSON.parse(candidate.slice(start, end + 1)) as Partial<ParsedNormalization>
    if (parsed.draft !== undefined && (typeof parsed.draft !== 'object' || parsed.draft === null)) return null
    const draft = parsed.draft ?? {}
    return {
      type: parsed.type,
      draft: {
        background: typeof draft.background === 'string' ? draft.background : undefined,
        scenario: typeof draft.scenario === 'string' ? draft.scenario : undefined,
        expectation: typeof draft.expectation === 'string' ? draft.expectation : undefined,
        acceptance: Array.isArray(draft.acceptance)
          ? draft.acceptance.filter((line): line is string => typeof line === 'string')
          : undefined,
      },
      duplicateOfId: typeof parsed.duplicateOfId === 'string' ? parsed.duplicateOfId : null,
    }
  } catch {
    return null
  }
}

const buildNormalizationPrompt = (item: Pick<FeedbackItem, 'title' | 'body'>): string => {
  const acceptanceLines = ['能明确验收的行为，用 - [ ] 列出；无则给空数组']
  return [
    '你是 Wemux 社区反馈规范化器。把一条用户反馈整理成结构化迷你 PRD，只输出一个 JSON 对象，不要输出其他任何内容。',
    '格式：{"type":"bug|feature|chat","draft":{"background":"背景","scenario":"使用场景","expectation":"期望行为","acceptance":["验收1"]},"duplicateOfId":null}',
    '规则：',
    '- background/scenario/expectation 每项不超过 80 字；acceptance 最多 5 条，每条不超过 40 字；',
    '- 不要编造原文没有的信息；原文含糊时按最合理推断并保持简洁；',
    '- duplicateOfId 只在你认为这条与已知重复时才填；本调用固定为 null；',
    '- 用户没给场景时相关字段给空字符串。',
    '',
    `标题：${item.title}`,
    `正文：${item.body.slice(0, 3000)}`,
  ].join('\n')
}

const callNormalizationModel = async (
  config: NormalizationModelConfig,
  item: Pick<FeedbackItem, 'title' | 'body'>,
): Promise<string> => {
  const response = await fetch(config.baseUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json', Authorization: `Bearer ${config.apiKey}` },
    body: JSON.stringify({
      model: config.model,
      messages: [
        { role: 'system', content: buildNormalizationPrompt(item) },
        { role: 'user', content: `标题：${item.title}\n正文：${item.body.slice(0, 3000)}` },
      ],
      temperature: 0,
      max_tokens: 800,
      stream: false,
    }),
  })
  if (!response.ok) {
    throw new Error(`normalization model http ${response.status}`)
  }
  const body = (await response.json().catch(() => null)) as { choices?: Array<{ message?: { content?: string } }> } | null
  const content = body?.choices?.[0]?.message?.content?.trim()
  if (!content) throw new Error('normalization model empty response')
  return content
}

/**
 * 规范化一条反馈：规则兜底必写；有模型配置时用 LLM 增强（失败静默保留规则结果）。
 * forceLlm=false（默认自动模式）下无模型配置时纯规则，自托管零依赖可用。
 */
export const normalizeFeedback = async (id: string, opts?: { forceLlm?: boolean }): Promise<FeedbackItem | null> => {
  const item = await getFeedbackItem(id)
  if (!item) return null

  const ruleDraft: FeedbackNormalized = {
    at: new Date().toISOString(),
    method: 'rule',
    draft: {},
    duplicateOfId: undefined,
  }

  const config = resolveNormalizationModelConfig()
  if (config.apiKey && opts?.forceLlm !== false) {
    try {
      const raw = await callNormalizationModel(config, item)
      const parsed = parseNormalizationResult(raw)
      if (parsed) {
        return await setFeedbackNormalized(id, {
          at: new Date().toISOString(),
          method: 'llm',
          draft: parsed.draft ?? {},
          duplicateOfId: parsed.duplicateOfId ?? undefined,
        })
      }
      console.warn('[feedback-normalization] LLM 输出无法解析，保留规则结果', raw.slice(0, 120))
    } catch (error) {
      console.warn('[feedback-normalization] LLM 规范化失败，保留规则结果', error instanceof Error ? error.message : error)
    }
  }

  return await setFeedbackNormalized(id, ruleDraft)
}
