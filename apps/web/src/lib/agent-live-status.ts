/**
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 * [INPUT]: AppState 里的主对话会话与工作区会话（含各自 agentRunningStatus）。
 * [OUTPUT]: 按 Agent 聚合的「正在工作」状态（workingCount：正在处理的会话/线程数）。
 * [POS]: 统一 Agent 入口的 live 指示数据源——不管 Agent 在主对话、Agent 详情聊天
 *        还是任务（workspace session）里工作，只要 agentRunningStatus 处于
 *        thinking/executing/waiting 就计入。纯函数 + useApp 薄壳。
 */
import { useMemo } from 'react'
import type { AgentRunningStatus, MainChatSession, WorkspaceSession } from '@shared/types'
import { useApp } from './app-provider'
import { isWorkspaceSessionBusy } from './workspace-session-status'

/** 会话/线程正在被 Agent 处理的运行态（与 isMainChatSessionBusy 同一判定集）。 */
export const isAgentWorkingStatus = (status: AgentRunningStatus | undefined) => {
  return status === 'thinking' || status === 'executing' || status === 'waiting'
}

export interface AgentLiveStatus {
  /** 该 Agent 当前正在处理的会话/线程数量。 */
  workingCount: number
}

const WORKING_STATUSES: ReadonlySet<AgentRunningStatus> = new Set(['thinking', 'executing', 'waiting'])

const bump = (map: Map<string, AgentLiveStatus>, key: string) => {
  const current = map.get(key)
  map.set(key, { workingCount: (current?.workingCount ?? 0) + 1 })
}

/**
 * 聚合所有会话类型（主对话 + 工作区/任务）的进行中状态，按 Agent 键统计。
 * 键优先 customAgentId，缺省回退 customAgentName（历史会话可能只有名字）。
 * 主对话用 agentRunningStatus 判定；工作区会话用工作区自己的
 * isWorkspaceSessionBusy（runtimeStatus 感知），与工作区侧运行显示保持一致。
 */
export const buildAgentLiveStatuses = (
  mainChatSessions: MainChatSession[],
  workspaceSessions: WorkspaceSession[],
): Map<string, AgentLiveStatus> => {
  const result = new Map<string, AgentLiveStatus>()

  for (const session of mainChatSessions) {
    const agentKey = session.customAgentId?.trim()
    if (agentKey && WORKING_STATUSES.has(session.agentRunningStatus as AgentRunningStatus)) {
      bump(result, agentKey)
    }
  }

  for (const session of workspaceSessions) {
    const agentKey = session.customAgentId?.trim() || session.customAgentName?.trim()
    if (agentKey && isWorkspaceSessionBusy(session)) {
      bump(result, agentKey)
    }
  }

  return result
}

/** 按 agent id（或名字回退）取 live 状态。 */
export const getAgentLiveStatus = (
  map: Map<string, AgentLiveStatus>,
  agentId: string,
  agentName = '',
): AgentLiveStatus | undefined => {
  return map.get(agentId) ?? (agentName ? map.get(agentName) : undefined)
}

/**
 * 订阅 AppState 的主对话 + 工作区会话，返回按 Agent 聚合的 live 状态。
 * AppState 广播更新（含 agentRunningStatus）时自动重算。
 */
export function useAgentLiveStatuses(): Map<string, AgentLiveStatus> {
  const { state } = useApp()
  return useMemo(
    () => buildAgentLiveStatuses(state.mainChatSessions, state.workspaceSessions),
    [state.mainChatSessions, state.workspaceSessions],
  )
}
