// [INPUT]: 用户可见 Agent / 工作区 / 执行节点 / 会话状态
// [OUTPUT]: AgentUniverseGraph（Agent 宇宙图谱：Agent 主节点 + 工作区/机器上下文节点 + 关系边）
// [POS]: Agent 宇宙确定性装配层（feature）；零 LLM；忙碌判定集对齐 web isWorkspaceSessionBusy；
//        边 = belongs_to（Agent→工作区）/ runs_on（Agent→机器）/ collaborates（同工作区协作）；
//        数据范围 = getUserAgents 用户隔离；纯函数 buildAgentUniverseGraph 可单测
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import type { AgentRunningStatus, AgentUniverseGraph, WorkspaceSessionRuntimeStatus } from '@shared/types'
import { readCustomAgentConfig } from '@shared/custom-agent'
import { inArray } from 'drizzle-orm'
import { getDrizzleDb } from '../storage/postgres/drizzle-db'
import { collabWorkspaces } from '../storage/postgres/schema-core'
import { loadState } from '../storage/app-state-store'
import { agentService } from '../integrations/agent/service'
import { listVisibleExecutorsForUser } from '../control-plane/collaboration'

/** 会话忙碌判定输入（workspace session / main chat 共用的最小字段集；main chat 的 agentRunningStatus 可为空） */
export interface UniverseSessionInput {
  customAgentId?: string
  customAgentName?: string
  agentRunningStatus?: AgentRunningStatus
  runtimeStatus?: WorkspaceSessionRuntimeStatus
}

/** 纯函数装配输入：Agent/工作区/机器行的最小投影 */
export interface UniverseAgentInput {
  id: string
  name: string
  status: 'online' | 'offline' | 'error'
  ownerUserId?: string
  config: Record<string, unknown>
}

export interface UniverseWorkspaceInput {
  id: string
  name: string
}

export interface UniverseExecutorInput {
  executorId: string
  machineName: string
  name: string
  platform?: string
  version?: string
  status: string
}

export interface AgentUniverseGraphInput {
  agents: UniverseAgentInput[]
  workspaceSessions: UniverseSessionInput[]
  mainChatSessions: UniverseSessionInput[]
  workspaces: UniverseWorkspaceInput[]
  executors: UniverseExecutorInput[]
  /** 可选：只保留该工作区子图（筛选用） */
  workspaceFilter?: string
}

/** 会话忙碌判定（对齐 apps/web/src/lib/workspace-session-status.ts isWorkspaceSessionBusy）。 */
export const isUniverseSessionBusy = (session: UniverseSessionInput): boolean => {
  if (session.agentRunningStatus === 'complete' || session.agentRunningStatus === 'error') {
    return false
  }
  if (session.runtimeStatus === 'queued') {
    return false
  }
  if (session.runtimeStatus === 'running' || session.runtimeStatus === 'waiting') {
    return true
  }
  return session.agentRunningStatus === 'thinking'
    || session.agentRunningStatus === 'executing'
    || session.agentRunningStatus === 'waiting'
}

/**
 * 按 Agent 聚合正在工作的会话数（workspace session 按 customAgentId，
 * main chat 按 customAgentId；历史会话只有 customAgentName 时回退按名字匹配）。
 */
export const buildAgentBusyCounts = (
  workspaceSessions: UniverseSessionInput[],
  mainChatSessions: UniverseSessionInput[],
  agents: UniverseAgentInput[],
): Map<string, number> => {
  const counts = new Map<string, number>()
  const nameToId = new Map(agents.map((agent) => [agent.name, agent.id]))
  const bump = (session: UniverseSessionInput) => {
    const key = session.customAgentId?.trim() || (session.customAgentName?.trim() ? nameToId.get(session.customAgentName.trim()) : undefined)
    if (!key) return
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  for (const session of workspaceSessions) {
    if (session.customAgentId || session.customAgentName) {
      if (isUniverseSessionBusy(session)) bump(session)
    }
  }
  for (const session of mainChatSessions) {
    if (session.customAgentId || session.customAgentName) {
      if (isUniverseSessionBusy(session)) bump(session)
    }
  }
  return counts
}

/**
 * 纯函数装配 Agent 宇宙图谱：Agent 主节点 + 工作区/机器上下文节点；
 * 边 = belongs_to（Agent→工作区）/ runs_on（Agent→机器）/ executes_on（工作区→机器）/
 * collaborates（同工作区 Agent↔Agent）。
 */
export const buildAgentUniverseGraph = (input: AgentUniverseGraphInput): AgentUniverseGraph => {
  const nodes: AgentUniverseGraph['nodes'] = []
  const edges: AgentUniverseGraph['edges'] = []
  const nodeKeys = new Set<string>()
  const workspaceAgentCount = new Map<string, number>()
  const executorAgentCount = new Map<string, number>()

  const addNode = (node: AgentUniverseGraph['nodes'][number]) => {
    if (nodeKeys.has(node.id)) return
    nodeKeys.add(node.id)
    nodes.push(node)
  }
  const addEdge = (source: string, target: string, type: AgentUniverseGraph['edges'][number]['type']) => {
    edges.push({ source, target, type })
  }

  const workspaceById = new Map(input.workspaces.map((ws) => [ws.id, ws]))
  const executorById = new Map(input.executors.map((executor) => [executor.executorId, executor]))
  const busyCounts = buildAgentBusyCounts(input.workspaceSessions, input.mainChatSessions, input.agents)

  for (const agent of input.agents) {
    const config = readCustomAgentConfig(agent.config)
    const workspaceIds = config.workspaceIds
    const executorId = config.defaultExecutorId?.trim() || undefined
    addNode({
      id: `agent:${agent.id}`,
      type: 'agent',
      label: agent.name,
      agentId: agent.id,
      status: agent.status,
      liveBusyCount: busyCounts.get(agent.id) ?? 0,
      model: config.preferredModel.trim(),
      runtime: config.preferredRuntime,
      executorId,
      avatarUrl: config.avatarUrl.trim(),
      ownerUserId: agent.ownerUserId,
      workspaceCount: workspaceIds.length,
      skillCount: config.skills.length,
    })
    for (const wsId of workspaceIds) {
      const ws = workspaceById.get(wsId)
      if (!ws) continue
      addNode({ id: `workspace:${wsId}`, type: 'workspace', label: ws.name, workspaceId: wsId, agentCount: 0 })
      addEdge(`agent:${agent.id}`, `workspace:${wsId}`, 'belongs_to')
      workspaceAgentCount.set(wsId, (workspaceAgentCount.get(wsId) ?? 0) + 1)
    }
    if (executorId) {
      const executor = executorById.get(executorId)
      if (executor) {
        addNode({
          id: `executor:${executorId}`,
          type: 'executor',
          label: executor.machineName || executor.name,
          executorId,
          machineName: executor.machineName,
          platform: executor.platform,
          version: executor.version,
          status: executor.status,
          agentCount: 0,
        })
        addEdge(`agent:${agent.id}`, `executor:${executorId}`, 'runs_on')
        executorAgentCount.set(executorId, (executorAgentCount.get(executorId) ?? 0) + 1)
      }
    }
  }

  // 工作区 → 绑定执行节点（executes_on）：collab_workspaces 无 executorNodeId 列，
  // V1 不产出该边（Agent→机器 runs_on 已覆盖「执行位置」），保留类型供后续扩展。
  // Agent ↔ Agent 协作（共享 ≥1 个工作区；去重）
  const workspaceAgents = new Map<string, string[]>()
  for (const agent of input.agents) {
    for (const wsId of readCustomAgentConfig(agent.config).workspaceIds) {
      if (!nodeKeys.has(`workspace:${wsId}`)) continue
      const list = workspaceAgents.get(wsId) ?? []
      list.push(agent.id)
      workspaceAgents.set(wsId, list)
    }
  }
  const collaboratorKeys = new Set<string>()
  for (const agentIds of workspaceAgents.values()) {
    for (let i = 0; i < agentIds.length; i++) {
      for (let j = i + 1; j < agentIds.length; j++) {
        const key = [agentIds[i], agentIds[j]].sort().join('|')
        if (collaboratorKeys.has(key)) continue
        collaboratorKeys.add(key)
        addEdge(`agent:${agentIds[i]}`, `agent:${agentIds[j]}`, 'collaborates')
      }
    }
  }

  // 回填工作区/机器的 Agent 计数
  for (const node of nodes) {
    if (node.type === 'workspace') {
      node.agentCount = workspaceAgentCount.get(node.workspaceId) ?? 0
    } else if (node.type === 'executor') {
      node.agentCount = executorAgentCount.get(node.executorId) ?? 0
    }
  }

  let graph: AgentUniverseGraph = { nodes, edges }
  if (input.workspaceFilter) {
    graph = filterAgentUniverseGraph(graph, input.workspaceFilter)
  }
  return graph
}

/** 只保留与目标工作区直接相关的子图（Agent + 工作区 + 直达边 + 机器上下文）。 */
export const filterAgentUniverseGraph = (graph: AgentUniverseGraph, workspaceId: string): AgentUniverseGraph => {
  const workspaceNodeId = `workspace:${workspaceId}`
  const keepNodes = new Set<string>([workspaceNodeId])
  const keptEdges: AgentUniverseGraph['edges'] = []
  for (const edge of graph.edges) {
    if (edge.source === workspaceNodeId || edge.target === workspaceNodeId) {
      keepNodes.add(edge.source)
      keepNodes.add(edge.target)
      keptEdges.push(edge)
    }
  }
  const keptNodeIds = new Set<string>()
  // 保留工作区 + 直接相连的 Agent 与机器；Agent 若无工作区归属则保留机器边
  for (const node of graph.nodes) {
    if (!keepNodes.has(node.id)) continue
    keptNodeIds.add(node.id)
  }
  return {
    nodes: graph.nodes.filter((node) => keptNodeIds.has(node.id)),
    edges: keptEdges,
  }
}

/** 服务入口：加载用户可见数据后装配图谱。 */
export const getAgentUniverseGraph = async (userId: string, workspaceFilter?: string): Promise<AgentUniverseGraph> => {
  const agents = agentService.getUserAgents(userId)
  const configs = agents.map((agent) => ({ agent, config: readCustomAgentConfig(agent.config) }))
  const workspaceIds = Array.from(new Set(configs.flatMap(({ config }) => config.workspaceIds)))

  const [workspaceRows, executors] = await Promise.all([
    workspaceIds.length > 0
      ? getDrizzleDb()
        .select({ id: collabWorkspaces.id, name: collabWorkspaces.name })
        .from(collabWorkspaces)
        .where(inArray(collabWorkspaces.id, workspaceIds))
      : Promise.resolve([] as Array<{ id: string; name: string }>),
    Promise.resolve(listVisibleExecutorsForUser(userId)),
  ])

  const state = loadState()
  return buildAgentUniverseGraph({
    agents: agents.map((agent) => ({
      id: agent.id,
      name: agent.name,
      status: agent.status,
      ownerUserId: agent.ownerUserId,
      config: agent.config,
    })),
    workspaceSessions: state.workspaceSessions,
    mainChatSessions: state.mainChatSessions,
    workspaces: workspaceRows,
    executors: executors.map((executor) => ({
      executorId: executor.executorId,
      machineName: executor.machineName,
      name: executor.name,
      platform: executor.platform,
      version: executor.version,
      status: executor.status,
    })),
    workspaceFilter,
  })
}
