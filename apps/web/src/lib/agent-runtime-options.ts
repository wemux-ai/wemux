import { VISIBLE_AGENT_TYPES, getRuntimeDescriptor, type AgentType } from '@shared/agent-type'

export interface TaskAgentOption {
  value: AgentType
  label: string
  description: string
  badgeLabel?: string
  disabled?: boolean
}

const getTaskAgentDescription = (_agentType: AgentType) => {
  return ''
}

export const buildTaskAgentOptions = (): TaskAgentOption[] => {
  return VISIBLE_AGENT_TYPES.map((agentType) => {
    const descriptor = getRuntimeDescriptor(agentType)
    return {
      value: agentType,
      label: descriptor.label,
      description: getTaskAgentDescription(agentType),
    }
  })
}
