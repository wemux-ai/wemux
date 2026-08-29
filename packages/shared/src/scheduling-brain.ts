/**
 * [INPUT]: 工作区群聊用户消息、群内可见 Agent 目录、群负责人 Agent id。
 * [OUTPUT]: 调度大脑意图分类与分发决策（纯函数，规则兜底）。
 * [POS]: 工作区智能调度大脑（feature）的共享契约；server 端小模型分类器
 *        失败时回落到本模块的规则分类与目标选择。
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */

export type WorkspaceDispatchIntent = 'task_request' | 'agent_request' | 'question' | 'chat' | 'none'

export type WorkspaceBrainAction =
  | { kind: 'run_agent'; targetAgentId: string; reason: string; confidence: number }
  | { kind: 'direct_reply'; reply: string; reason: string; confidence: number }
  | { kind: 'none'; reason: string; confidence: number }

export type WorkspaceBrainSource = 'rules' | 'model' | 'disabled'

export type WorkspaceBrainDecision = {
  intent: WorkspaceDispatchIntent
  action: WorkspaceBrainAction
  source: WorkspaceBrainSource
  model?: string
}

/** 供调度大脑选择目标的最小 Agent 目录项。 */
export type BrainAgentOption = {
  id: string
  name: string
  role?: string
}

// —— 规则分类关键词（中英双语，v1 够用即可，不追求召回率）——

const TASK_REQUEST_KEYWORDS = [
  // 中文：开发/修复类
  '修复', '修一下', '修好', '改成', '改一下', '实现', '开发', '重构', '写一个', '写个',
  '写一下', '加上', '新增', '删除', '去掉', '升级', '迁移', '移植', '优化', '调试', '排查',
  '报错', '出错', '挂了', '崩了', '测试', '验证', '审查', '审核', '部署', '发布',
  '构建', '编译', '跑一下', '跑通', '打通', '联调', '自动化',
  // 英文
  'fix', 'implement', 'refactor', 'develop', 'build', 'add ', 'deploy', 'release', 'review',
  'test', 'debug', 'bug', 'error', 'broken', 'failed', 'feature', 'migrate', 'optimize',
]

const AGENT_REQUEST_KEYWORDS = [
  // 中文：让 Agent 做事但没有 @
  '帮我', '请帮我', '帮我看看', '帮忙', '处理一下', '处理下', '看一下', '看下', '跟进',
  '你去', '你去弄', '你去办', '交给你', '安排', '催一下', '提醒', '分析', '评估', '调研',
  '整理', '总结一下', '整理一下', '检查一下', '检查下', '确认一下', '核实', '对比',
  // 英文
  'please', 'help me', 'take a look', 'check ', 'handle', 'follow up', 'investigate',
  'analyze', 'summarize', 'compare', 'prepare', 'look into',
]

const QUESTION_KEYWORDS = [
  '怎么', '为什么', '如何', '能否', '可以吗', '是什么', '什么是', '哪', '多久', '多少',
  '应该', '对不对', '怎么样', '吗', '呢',
  'how', 'why', 'what', 'where', 'when', 'which', 'can i', 'should i',
]

const CHAT_KEYWORDS = [
  '你好', '您好', '谢谢', '辛苦', '好的', '嗯', '收到', '明白', '没问题', '再见', '拜拜',
  'hi', 'hello', 'thanks', 'thank', 'ok', 'okay', 'bye', 'good',
]

const INCLUDES_CHINESE_QUESTION = /[？?]$/

const hasAnyKeyword = (message: string, keywords: readonly string[]) => {
  const normalized = message.toLowerCase()
  return keywords.some((keyword) => normalized.includes(keyword.toLowerCase()))
}

/**
 * 规则意图分类（纯函数）：task_request > agent_request > question > chat > none。
 * 该顺序刻意优先「要干活」——宁可多发一个 Agent，也不要漏掉用户真正想要的动作。
 */
export const classifyWorkspaceIntentByRules = (message: string): WorkspaceDispatchIntent => {
  const normalized = message.trim()
  if (!normalized) {
    return 'none'
  }

  if (hasAnyKeyword(normalized, TASK_REQUEST_KEYWORDS)) {
    return 'task_request'
  }
  if (hasAnyKeyword(normalized, AGENT_REQUEST_KEYWORDS)) {
    return 'agent_request'
  }
  if (hasAnyKeyword(normalized, QUESTION_KEYWORDS) || INCLUDES_CHINESE_QUESTION.test(normalized)) {
    return 'question'
  }
  if (hasAnyKeyword(normalized, CHAT_KEYWORDS)) {
    return 'chat'
  }
  return 'none'
}

const tokenizeMessage = (message: string) => {
  return message
    .toLowerCase()
    .split(/[\s,，。.;；:：!！?？/\\()[\]{}<>《》【】「」『』、]+/)
    .filter((token) => token.length >= 2)
}

const CJK_RANGE = /[\u4e00-\u9fff]/g

/** 中文无分词器，用 2 字 bigram 近似模糊匹配（对「后端/前端/部署/审查」这类职责词很有效）。 */
const cjkBigrams = (text: string) => {
  const chars = text.toLowerCase().match(CJK_RANGE) ?? []
  const bigrams = new Set<string>()
  for (let index = 0; index < chars.length - 1; index += 1) {
    bigrams.add(`${chars[index]}${chars[index + 1]}`)
  }
  return bigrams
}

/**
 * 规则目标选择（纯函数）：按消息与 Agent 名称/职责的 token + CJK bigram 重叠打分。
 * 都打不出分时回落到群负责人（orchestratorAgentId）；负责人也不可用则返回 null。
 */
export const pickBrainTargetAgentByRules = (params: {
  message: string
  agents: readonly BrainAgentOption[]
  orchestratorAgentId?: string
}): { targetAgentId?: string; reason: string; confidence: number } => {
  const normalizedMessage = params.message.trim()
  if (!normalizedMessage) {
    return { reason: '消息为空', confidence: 0 }
  }

  const messageTokens = tokenizeMessage(normalizedMessage)
  const messageBigrams = cjkBigrams(normalizedMessage)
  let best: { agent: BrainAgentOption; score: number } | null = null
  for (const agent of params.agents) {
    const agentText = `${agent.name} ${agent.role ?? ''}`
    const agentTokens = tokenizeMessage(agentText)
    const tokenOverlap = agentTokens.filter((token) => messageTokens.includes(token)).length
    const nameHit = messageTokens.some((token) => agent.name.toLowerCase().includes(token)) ? 1 : 0
    // 中文职责词匹配：统计消息与 Agent 文本共享的 CJK bigram 数量
    let bigramHits = 0
    for (const bigram of messageBigrams) {
      if (agentText.toLowerCase().includes(bigram)) {
        bigramHits += 1
      }
    }
    const score = tokenOverlap * 2 + nameHit + bigramHits
    if (score > 0 && (best === null || score > best.score)) {
      best = { agent, score }
    }
  }

  if (best && best.score >= 1) {
    return {
      targetAgentId: best.agent.id,
      reason: `消息与 Agent「${best.agent.name}」的职责匹配度最高`,
      confidence: Math.min(0.5 + best.score * 0.05, 0.9),
    }
  }

  const orchestratorId = params.orchestratorAgentId?.trim()
  if (orchestratorId && params.agents.some((agent) => agent.id === orchestratorId)) {
    return {
      targetAgentId: orchestratorId,
      reason: '未匹配到具体 Agent，回落到群负责人',
      confidence: 0.4,
    }
  }

  return { reason: '群内没有可调度的 Agent', confidence: 0 }
}

/**
 * 规则完整决策（纯函数）：意图 + 目标 → 分发动作。
 * - task_request / agent_request：分发到目标 Agent（找不到目标则 none）。
 * - question / chat / none：仅记录（v1 规则模式不产生直答文案，直答交给小模型模式）。
 */
export const buildWorkspaceBrainDecisionByRules = (params: {
  message: string
  agents: readonly BrainAgentOption[]
  orchestratorAgentId?: string
}): WorkspaceBrainDecision => {
  const intent = classifyWorkspaceIntentByRules(params.message)
  if (intent !== 'task_request' && intent !== 'agent_request') {
    return {
      intent,
      action: { kind: 'none', reason: intent === 'none' ? '未能识别有效意图' : '闲聊/提问类消息，仅记录', confidence: 0.6 },
      source: 'rules',
    }
  }

  const target = pickBrainTargetAgentByRules({
    message: params.message,
    agents: params.agents,
    orchestratorAgentId: params.orchestratorAgentId,
  })
  if (!target.targetAgentId) {
    return {
      intent,
      action: { kind: 'none', reason: target.reason, confidence: target.confidence },
      source: 'rules',
    }
  }

  return {
    intent,
    action: { kind: 'run_agent', targetAgentId: target.targetAgentId, reason: target.reason, confidence: target.confidence },
    source: 'rules',
  }
}
