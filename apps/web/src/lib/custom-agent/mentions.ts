import { isCustomAgentEnabled } from '@shared/custom-agent'

import { parseCustomAgentProfile } from './draft'
import type { AgentMentionMatch } from './types'
import type { AgentRecord } from '../api'

export const findMentionedAgents = (message: string, agents: AgentRecord[]) => {
  const matches: AgentMentionMatch[] = []
  for (const agent of agents) {
    const profile = parseCustomAgentProfile(agent)
    if (!isCustomAgentEnabled(profile) || !profile.allowedModes.includes('mention')) {
      continue
    }

    const token = `@${agent.name}`
    let start = message.indexOf(token)
    while (start !== -1) {
      const end = start + token.length
      const leftOk = start === 0 || /\s|[(\[{]/.test(message[start - 1] ?? '')
      const rightOk = end >= message.length || /\s|[.,!?，。！？:：)\]}]/.test(message[end] ?? '')
      if (leftOk && rightOk) {
        matches.push({ agent, profile, token, start, end })
      }
      start = message.indexOf(token, end)
    }
  }

  return matches.sort((left, right) => left.start - right.start)
}

export const resolveMentionQuery = (
  message: string,
  caretIndex: number,
  agents: AgentRecord[],
) => {
  const slice = message.slice(0, caretIndex)
  const match = slice.match(/(?:^|\s)@([^\s@]*)$/)
  if (!match) {
    return null
  }

  const query = match[1]?.trim().toLowerCase() ?? ''
  const start = caretIndex - match[0].length + (match[0].startsWith(' ') ? 1 : 0)
  const options = agents.filter((agent) => {
    const profile = parseCustomAgentProfile(agent)
    if (!isCustomAgentEnabled(profile) || !profile.allowedModes.includes('mention')) {
      return false
    }
    if (!query) {
      return true
    }
    return agent.name.toLowerCase().includes(query) || profile.role.toLowerCase().includes(query)
  })

  return {
    start,
    end: caretIndex,
    query,
    options,
  }
}

export const applyMentionSelection = (
  message: string,
  start: number,
  end: number,
  agentName: string,
) => {
  return `${message.slice(0, start)}@${agentName} ${message.slice(end)}`
}

export const setSelectedAgentId = (agentId: string) => {
  if (typeof window === 'undefined') {
    return
  }

  window.sessionStorage.setItem('vibemux.selectedAgentId', agentId)
}

export const consumeSelectedAgentId = () => {
  if (typeof window === 'undefined') {
    return ''
  }

  return window.sessionStorage.getItem('vibemux.selectedAgentId') ?? ''
}
