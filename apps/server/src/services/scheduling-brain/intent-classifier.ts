/**
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 * [INPUT]: 工作区群聊用户消息、群内可见 Agent 目录、群负责人 id、用户实验开关。
 * [OUTPUT]: 调度大脑决策（小模型结构化分类，规则兜底，开关关闭时 disabled）。
 * [POS]: feature 调度大脑——小模型意图识别；纯决策不产生副作用，副作用由 dispatch-brain 承担。
 */
import {
  buildWorkspaceBrainDecisionByRules,
  classifyWorkspaceIntentByRules,
  type BrainAgentOption,
  type WorkspaceBrainDecision,
} from '@shared/scheduling-brain'

const DEEPSEEK_CHAT_COMPLETIONS_URL = 'https://api.deepseek.com/chat/completions'
const DEFAULT_SCHEDULING_BRAIN_MODEL = 'deepseek-chat'
const DEFAULT_TIMEOUT_MS = 10_000

export type BrainClassifierInput = {
  message: string
  agents: readonly BrainAgentOption[]
  orchestratorAgentId?: string
  /** 用户实验开关：关闭时直接返回 disabled 决策，不调用模型。 */
  enabled: boolean
  fetchImpl?: typeof fetch
  timeoutMs?: number
  log?: Pick<typeof console, 'info'>
}

export const resolveSchedulingBrainDeepSeekConfig = () => {
  const apiKey = process.env.DEEPSEEK_API_KEY?.trim() || ''
  const model = process.env.DEEPSEEK_SCHEDULING_BRAIN_MODEL?.trim() || DEFAULT_SCHEDULING_BRAIN_MODEL
  return { apiKey, model }
}

const buildClassifierPrompt = (params: { message: string; agents: readonly BrainAgentOption[] }) => {
  const agentLines = params.agents.length > 0
    ? params.agents.map((agent) => `- ${agent.id} | ${agent.name}${agent.role ? ` | ${agent.role}` : ''}`).join('\n')
    : '（无可用 Agent）'
  return [
    '你是工作区群聊的调度大脑。请对最新一条用户消息做意图识别并决定分发。',
    '',
    '只输出一个 JSON 对象，不要输出其他任何内容，格式：',
    '{"intent":"task_request|agent_request|question|chat|none","targetAgentId":"<agent id 或 null>","confidence":0.0-1.0,"reason":"一句话理由","reply":"<question/chat 时的简短回复，其他意图为 null>"}',
    '',
    '意图定义：',
    '- task_request：用户明确要干活（修复/实现/重构/审查/部署/测试/调试等执行类需求）',
    '- agent_request：用户想让人/Agent 做事但没有 @ 任何人（帮我看看/处理一下/跟进/分析等）',
    '- question：纯提问，不需要执行任何代码或任务',
    '- chat：寒暄、确认、感谢等闲聊',
    '- none：意图不明确或不构成动作',
    '',
    '可用 Agent（id | 名称 | 职责）：',
    agentLines,
    '',
    '分发规则：',
    '- task_request / agent_request：从可用 Agent 中选出最匹配的 targetAgentId；实在无法判断时为 null',
    '- question / chat：targetAgentId 为 null，reply 给出一句简短友好的中文回复',
    '- none：targetAgentId 为 null，reply 为 null',
    '',
    '用户消息：',
    params.message.trim(),
  ].join('\n')
}

const extractDeepSeekOutput = (body: unknown) => {
  if (!body || typeof body !== 'object') {
    return ''
  }
  const firstChoice = (body as { choices?: Array<{ message?: { content?: unknown }; text?: unknown }> }).choices?.[0]
  const content = firstChoice?.message?.content ?? firstChoice?.text
  if (typeof content === 'string') {
    return content
  }
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === 'string') return part
        if (part && typeof part === 'object' && 'text' in part && typeof part.text === 'string') return part.text
        return ''
      })
      .join('')
  }
  return ''
}

const extractDeepSeekError = async (response: Response) => {
  const parsed = await response.json().catch(() => null) as
    | { error?: { message?: string }; message?: string }
    | null
  return parsed?.error?.message || parsed?.message || `DeepSeek 请求失败：${response.status}`
}

const stripJsonFences = (output: string) => output
  .trim()
  .replace(/^```(?:json)?/i, '')
  .replace(/```$/i, '')
  .trim()

const isWorkspaceDispatchIntent = (value: unknown): value is WorkspaceBrainDecision['intent'] => {
  return value === 'task_request' || value === 'agent_request' || value === 'question' || value === 'chat' || value === 'none'
}

const clampConfidence = (value: unknown) => {
  const number = typeof value === 'number' ? value : Number.parseFloat(String(value))
  return Number.isFinite(number) ? Math.max(0, Math.min(1, number)) : 0.5
}

const parseStructuredDecision = (output: string): Omit<WorkspaceBrainDecision, 'model'> | null => {
  try {
    const parsed = JSON.parse(stripJsonFences(output)) as Record<string, unknown>
    const intent = parsed.intent
    if (!isWorkspaceDispatchIntent(intent)) {
      return null
    }
    const targetAgentId = typeof parsed.targetAgentId === 'string' && parsed.targetAgentId.trim()
      ? parsed.targetAgentId.trim()
      : undefined
    const reply = typeof parsed.reply === 'string' && parsed.reply.trim() ? parsed.reply.trim() : undefined
    const reason = typeof parsed.reason === 'string' && parsed.reason.trim() ? parsed.reason.trim() : '小模型识别'
    // run_agent 必须有真实目标；模型未给出时视为非法输出，由调用方回落规则决策
    if ((intent === 'task_request' || intent === 'agent_request') && !targetAgentId) {
      return null
    }
    const action: WorkspaceBrainDecision['action'] = intent === 'task_request' || intent === 'agent_request'
      ? {
          kind: 'run_agent',
          targetAgentId: targetAgentId as string,
          reason,
          confidence: clampConfidence(parsed.confidence),
        }
      : intent === 'question' || intent === 'chat'
        ? {
            kind: 'direct_reply',
            reply: reply || '收到，已记录。',
            reason,
            confidence: clampConfidence(parsed.confidence),
          }
        : { kind: 'none', reason, confidence: clampConfidence(parsed.confidence) }
    return {
      intent,
      action,
      source: 'model' as const,
    }
  } catch {
    return null
  }
}

const classifyByModel = async (params: {
  message: string
  agents: readonly BrainAgentOption[]
  fetchImpl: typeof fetch
  timeoutMs: number
  apiKey: string
  model: string
}): Promise<WorkspaceBrainDecision | null> => {
  const abortController = new AbortController()
  const timeout = setTimeout(() => abortController.abort(), params.timeoutMs)
  try {
    const response = await params.fetchImpl(DEEPSEEK_CHAT_COMPLETIONS_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        Authorization: `Bearer ${params.apiKey}`,
      },
      body: JSON.stringify({
        model: params.model,
        messages: [
          { role: 'system', content: 'You are a concise workspace chat dispatch router. Always output the exact JSON requested.' },
          { role: 'user', content: buildClassifierPrompt({ message: params.message, agents: params.agents }) },
        ],
        temperature: 0,
        max_tokens: 300,
        stream: false,
      }),
      signal: abortController.signal,
    })
    if (!response.ok) {
      throw new Error(await extractDeepSeekError(response))
    }

    const body = await response.json().catch(() => null) as unknown
    const output = extractDeepSeekOutput(body)
    const parsedDecision = parseStructuredDecision(output)
    if (!parsedDecision) {
      return null
    }

    const agents = params.agents
    // 模型给出的目标 id 必须真实存在且可见；否则退化为规则决策（保证绝不路由到群外 Agent）。
    if (parsedDecision.action.kind === 'run_agent') {
      const targetAgentId = parsedDecision.action.targetAgentId
      if (!agents.some((agent) => agent.id === targetAgentId)) {
        return null
      }
    }

    return { ...parsedDecision, model: params.model } as WorkspaceBrainDecision
  } catch {
    return null
  } finally {
    clearTimeout(timeout)
  }
}

const disabledDecision = (): WorkspaceBrainDecision => ({
  intent: 'none',
  action: { kind: 'none', reason: '调度大脑未开启', confidence: 1 },
  source: 'disabled',
})

/**
 * 调度大脑分类入口：
 * 1. 开关关闭 → disabled。
 * 2. 有 DeepSeek key → 小模型结构化分类；失败/超时/非法输出 → 规则兜底。
 * 3. 无 key → 规则分类（不产生 direct_reply 文案，仅分发/记录）。
 */
export const classifyWorkspaceMessageIntent = async (input: BrainClassifierInput): Promise<WorkspaceBrainDecision> => {
  const logger = input.log ?? console
  const message = input.message.trim()
  const agents = input.agents
  if (!input.enabled) {
    return disabledDecision()
  }
  if (!message) {
    return {
      intent: 'none',
      action: { kind: 'none', reason: '消息为空', confidence: 1 },
      source: 'rules',
    }
  }

  const rulesDecision = buildWorkspaceBrainDecisionByRules({
    message,
    agents,
    orchestratorAgentId: input.orchestratorAgentId,
  })
  const config = resolveSchedulingBrainDeepSeekConfig()
  if (!config.apiKey) {
    logger.info('[scheduling-brain] 规则模式（无 DEEPSEEK_API_KEY）', {
      intent: rulesDecision.intent,
      action: rulesDecision.action.kind,
    })
    return rulesDecision
  }

  const modelDecision = await classifyByModel({
    message,
    agents,
    fetchImpl: input.fetchImpl ?? fetch,
    timeoutMs: input.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    apiKey: config.apiKey,
    model: config.model,
  })
  if (modelDecision) {
    logger.info('[scheduling-brain] 模型识别', {
      model: config.model,
      intent: modelDecision.intent,
      action: modelDecision.action.kind,
    })
    return modelDecision
  }

  logger.info('[scheduling-brain] 模型失败，回落规则', {
    fallbackIntent: rulesDecision.intent,
    fallbackAction: rulesDecision.action.kind,
  })
  return rulesDecision
}
