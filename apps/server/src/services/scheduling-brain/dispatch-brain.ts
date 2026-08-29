/**
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 * [INPUT]: 调度大脑决策 + 群聊上下文（可见 Agent 成员）。
 * [OUTPUT]: 事件分发结果——隐式 Agent 集合（并入现有群聊分发循环）或直答文案。
 * [POS]: feature 调度大脑——事件分发；只做「把决策翻译成分发动作」，不产生新的执行路径。
 */
import type { BrainAgentOption, WorkspaceBrainDecision } from '@shared/scheduling-brain'
import { classifyWorkspaceMessageIntent } from './intent-classifier'

export type BrainGroupChatDispatchInput = {
  message: string
  /** 群内用户可见且已入群的 Agent 成员（含 id/name/role）。 */
  availableAgents: readonly BrainAgentOption[]
  /** 群负责人 Agent id（可为空）。 */
  orchestratorAgentId?: string
  /** 用户实验开关。 */
  enabled: boolean
  fetchImpl?: typeof fetch
  timeoutMs?: number
  log?: Pick<typeof console, 'info'>
}

export type BrainGroupChatDispatchResult = {
  decision: WorkspaceBrainDecision
  /** 大脑隐式分发的 Agent id 集合；并入现有 @Agent 分发循环执行。 */
  implicitAgentIds: string[]
  /** 直答文案（direct_reply 时才有），由调用方写入会话消息。 */
  directReply?: string
}

/**
 * 调度大脑分发入口：
 * - run_agent → 目标必须是 availableAgents 之一 → implicitAgentIds=[target]
 * - direct_reply → 返回直答文案
 * - none / disabled → 不产生任何动作（调用方保持「仅记录」现状）
 */
export const resolveBrainGroupChatDispatch = async (
  input: BrainGroupChatDispatchInput,
): Promise<BrainGroupChatDispatchResult> => {
  const decision = await classifyWorkspaceMessageIntent({
    message: input.message,
    agents: input.availableAgents,
    orchestratorAgentId: input.orchestratorAgentId,
    enabled: input.enabled,
    fetchImpl: input.fetchImpl,
    timeoutMs: input.timeoutMs,
    log: input.log,
  })

  if (decision.action.kind === 'run_agent') {
    const targetAgentId = decision.action.targetAgentId
    const targetVisible = input.availableAgents.some((agent) => agent.id === targetAgentId)
    if (!targetVisible) {
      return {
        decision: {
          ...decision,
          action: { kind: 'none', reason: `目标 Agent 不在群内：${targetAgentId}`, confidence: decision.action.confidence },
        },
        implicitAgentIds: [],
      }
    }
    return {
      decision,
      implicitAgentIds: [targetAgentId],
    }
  }

  if (decision.action.kind === 'direct_reply') {
    return {
      decision,
      implicitAgentIds: [],
      directReply: decision.action.reply,
    }
  }

  return { decision, implicitAgentIds: [] }
}
