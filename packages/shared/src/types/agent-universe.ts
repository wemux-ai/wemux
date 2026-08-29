// [INPUT]: 用户可见 Agent / 工作区 / 执行节点（机器）数据
// [OUTPUT]: Agent 宇宙图谱契约（节点/边/图），供 server 装配服务与 web 宇宙视图消费
// [POS]: Agent 宇宙（feature）共享契约；节点=Agent（主）/工作区/机器；边=归属/执行/协作；
//        可见性由路由层控制（getUserAgents 用户隔离），本层只定义数据形态
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

/** 宇宙图谱节点类型：Agent 主节点 + 工作区/机器上下文节点 */
export type AgentUniverseNodeType = 'agent' | 'workspace' | 'executor'

/** 宇宙图谱边类型：归属 / 执行 / 工作区绑定机器 / 同工作区协作 */
export type AgentUniverseEdgeType = 'belongs_to' | 'runs_on' | 'executes_on' | 'collaborates'

/** Agent 主节点：状态着色 + 模型/机器/忙碌数等 hover 详情字段 */
export interface AgentUniverseAgentNode {
  id: string
  type: 'agent'
  label: string
  agentId: string
  /** Agent 注册心跳状态（agent-store） */
  status: 'online' | 'offline' | 'error'
  /** 当前正在工作的会话/线程数（workspace session + main chat 聚合） */
  liveBusyCount: number
  /** 配置首选模型（preferredModel，可能为空串） */
  model: string
  /** 配置首选 runtime（preferredRuntime） */
  runtime: string
  /** 默认执行节点（defaultExecutorId，可能为空） */
  executorId?: string
  avatarUrl: string
  ownerUserId?: string
  /** 归属工作区数（config.workspaceIds 长度） */
  workspaceCount: number
  /** 已配置 skills 数 */
  skillCount: number
}

/** 工作区上下文节点 */
export interface AgentUniverseWorkspaceNode {
  id: string
  type: 'workspace'
  label: string
  workspaceId: string
  /** 该工作区内的 Agent 数 */
  agentCount: number
}

/** 机器（执行节点）上下文节点 */
export interface AgentUniverseExecutorNode {
  id: string
  type: 'executor'
  label: string
  executorId: string
  machineName: string
  platform?: string
  version?: string
  /** ExecutorConnectionStatus（online/offline/…） */
  status: string
  /** 使用该机器的 Agent 数 */
  agentCount: number
}

export type AgentUniverseNode = AgentUniverseAgentNode | AgentUniverseWorkspaceNode | AgentUniverseExecutorNode

/** 宇宙图谱边（source/target 为节点 id，格式 `type:id`） */
export interface AgentUniverseEdge {
  source: string
  target: string
  type: AgentUniverseEdgeType
}

/** Agent 宇宙图谱（全局、跨工作区） */
export interface AgentUniverseGraph {
  nodes: AgentUniverseNode[]
  edges: AgentUniverseEdge[]
}
