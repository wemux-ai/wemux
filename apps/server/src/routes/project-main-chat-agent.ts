/**
 * [INPUT]: An authenticated user's main-chat session and persisted ordinary Agent records.
 * [OUTPUT]: The enabled owner-matching Agent profile bound to that direct chat session.
 * [POS]: Main Chat Agent identity resolver; it does not provide project/workspace sharing authorization.
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */
import { isCustomAgentEnabled, readCustomAgentConfig, type CustomAgentConfig } from '@shared/custom-agent'
import type { MainChatSession } from '@shared/types'
import { getAgent, type AgentRecord } from '../repositories/agent'

export type ResolvedCustomChatAgent = {
  agent: AgentRecord
  profile: CustomAgentConfig
}

export const resolveCustomChatAgent = (
  session: MainChatSession | null | undefined,
  userId: string,
): ResolvedCustomChatAgent | null => {
  const customAgentId = session?.customAgentId?.trim()
  const normalizedUserId = userId.trim()
  if (!customAgentId || !normalizedUserId) {
    return null
  }

  const agent = getAgent(customAgentId)
  if (
    !agent
    || agent.type.trim().toLowerCase() === 'main'
    || agent.ownerUserId !== normalizedUserId
  ) {
    return null
  }

  const profile = readCustomAgentConfig(agent.config)
  if (!isCustomAgentEnabled(profile)) {
    return null
  }

  return { agent, profile }
}
