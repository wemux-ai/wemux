// [INPUT]: Agent/Runtime 类型输入
// [OUTPUT]: Runtime 描述（transport/modelIdStrategy）
// [POS]: Agent/Runtime 类型契约
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

export const AGENT_TYPES = ['Pi', 'OpenCode', 'Codex', 'ClaudeCode'] as const

export type AgentType = (typeof AGENT_TYPES)[number]

export const VISIBLE_AGENT_TYPES = ['Pi', 'OpenCode', 'Codex', 'ClaudeCode'] as const satisfies readonly AgentType[]

export const DEFAULT_AGENT_TYPE: AgentType = 'OpenCode'

export const RUNTIME_IDS = [...AGENT_TYPES] as const

/** @deprecated Use AgentType instead. RuntimeId is structurally identical to AgentType. */
export type RuntimeId = AgentType

export type RuntimeTransport = 'STDIO' | 'SDK' | 'RPC'
export type RuntimeModelIdStrategy = 'canonical' | 'native'

export interface RuntimeDescriptor {
  id: RuntimeId
  label: string
  transport: RuntimeTransport
  modelIdStrategy: RuntimeModelIdStrategy
  workerOnly: boolean
  agentType: AgentType
}

const AGENT_TYPE_SET = new Set<string>(AGENT_TYPES)
const RUNTIME_ID_SET = new Set<string>(RUNTIME_IDS)

export const RUNTIME_DESCRIPTORS: Record<RuntimeId, RuntimeDescriptor> = {
  OpenCode: {
    id: 'OpenCode',
    label: 'OpenCode',
    transport: 'SDK',
    modelIdStrategy: 'canonical',
    workerOnly: true,
    agentType: 'OpenCode',
  },
  Codex: {
    id: 'Codex',
    label: 'Codex',
    transport: 'STDIO',
    modelIdStrategy: 'native',
    workerOnly: true,
    agentType: 'Codex',
  },
  ClaudeCode: {
    id: 'ClaudeCode',
    label: 'Claude Code',
    transport: 'STDIO',
    modelIdStrategy: 'native',
    workerOnly: true,
    agentType: 'ClaudeCode',
  },
  Pi: {
    id: 'Pi',
    label: 'Pi',
    transport: 'SDK',
    modelIdStrategy: 'canonical',
    workerOnly: true,
    agentType: 'Pi',
  },
}

export const isAgentType = (value: string | undefined | null): value is AgentType => {
  return typeof value === 'string' && AGENT_TYPE_SET.has(value)
}

export const coerceAgentType = (value: string | undefined | null): AgentType => {
  if (value === 'CodexDesktop') {
    return 'Codex'
  }

  return isAgentType(value) ? value : DEFAULT_AGENT_TYPE
}

export const isRuntimeId = (value: string | undefined | null): value is RuntimeId => {
  return typeof value === 'string' && RUNTIME_ID_SET.has(value)
}

export const getRuntimeDescriptor = (runtimeId: RuntimeId) => {
  return RUNTIME_DESCRIPTORS[runtimeId]
}

/** @deprecated RuntimeId is now an alias for AgentType. Use agentType directly. */
export const resolveRuntimeIdForAgentType = (agentType: AgentType): RuntimeId => {
  return agentType
}

/** @deprecated RuntimeId is now an alias for AgentType. Use agentType directly. */
export const resolveAgentTypeForRuntimeId = (runtimeId: RuntimeId): AgentType | null => {
  return RUNTIME_DESCRIPTORS[runtimeId].agentType ?? null
}
