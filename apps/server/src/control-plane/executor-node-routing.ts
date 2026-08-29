// [INPUT]: executor 连接上下文与路由选择输入
// [OUTPUT]: 节点路由选择结果
// [POS]: 执行器节点路由选择逻辑
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import type {
  ExecutorDescriptor,
  ExecutorTerminalResult,
  ExecutorTerminalSessionCloseResult,
  ExecutorTerminalSessionCreateResult,
  ExecutorTerminalSessionsResult,
  LocalPathProbeResult,
  PatVerificationResult,
  SshVerificationResult,
  ExecutorTelemetrySnapshot,
  WorkerDoctorPayload,
} from '@shared/types'
import type { RuntimeEnvironmentExecutionPayload } from '@shared/runtime-environment'
import { clusterConfig } from '../cluster/config'
import * as distributedTaskStore from '../storage/postgres/distributed-task-store'
import * as executorStore from '../storage/postgres/executor-store'
import { executorRegistry, isClusterNodeHeartbeatFresh } from './executor-registry'

const trimTrailingSlash = (value: string) => value.trim().replace(/\/+$/, '')

type ExecutorRequestUnavailableReason =
  | 'not-found'
  | 'offline'
  | 'node-unassigned'
  | 'local-socket-unavailable'
  | 'node-relay-url-missing'
  | 'owning-node-offline'

export type ExecutorRequestTarget =
  | {
      mode: 'local'
      executor: ExecutorDescriptor
      nodeId: string
    }
  | {
      mode: 'remote'
      executor: ExecutorDescriptor
      nodeId: string
      relayUrl: string
    }
  | {
      mode: 'unavailable'
      executor: ExecutorDescriptor | null
      nodeId?: string
      reason: ExecutorRequestUnavailableReason
    }

export type InternalClusterExecutorRequest =
  | {
      operation: 'repo-probe'
      localPath: string
      timeoutMs?: number
    }
  | {
      operation: 'pat-verification'
      provider: 'github' | 'gitlab'
      host: string
      patToken: string
      timeoutMs?: number
    }
  | {
      operation: 'ssh-verification'
      host: string
      sshPrivateKey: string
      repoUrl?: string
      sshUser?: string
      timeoutMs?: number
    }
  | {
      operation: 'telemetry'
      timeoutMs?: number
    }
  | {
      operation: 'doctor'
      timeoutMs?: number
    }
  | {
      operation: 'terminal-command'
      command: string
      cwd?: string
      mode?: 'wait' | 'background'
      runtimeEnvironment?: RuntimeEnvironmentExecutionPayload
      timeoutMs?: number
    }
  | {
      operation: 'terminal-session-list'
      scope?: 'workspace' | 'executor'
      workspaceId?: string
      timeoutMs?: number
    }
  | {
      operation: 'terminal-session-create'
      terminalId: string
      scope: 'workspace' | 'executor'
      workspaceId?: string
      title?: string
      cwd?: string
      cols?: number
      rows?: number
      ownerUserId?: string
      runtimeEnvironment?: RuntimeEnvironmentExecutionPayload
      timeoutMs?: number
    }
  | {
      operation: 'terminal-session-close'
      terminalId: string
      scope: 'workspace' | 'executor'
      workspaceId?: string
      timeoutMs?: number
    }

export const executorRequestRoutingDeps = {
  getLocalSocket: (executorId: string) => executorRegistry.getSocket(executorId),
  getLocalExecutor: (executorId: string) => executorRegistry.getExecutor(executorId),
  getPersistedExecutorFresh: (executorId: string) => executorStore.getPersistedExecutorFresh(executorId),
  getNodeFresh: (nodeId: string) => distributedTaskStore.getNodeFresh(nodeId),
}

const buildClusterHeaders = () => {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
  }
  if (clusterConfig.sharedToken) {
    headers['x-cluster-token'] = clusterConfig.sharedToken
  }
  return headers
}

export const resolveExecutorRequestTarget = async (executorId: string): Promise<ExecutorRequestTarget> => {
  const localSocket = executorRequestRoutingDeps.getLocalSocket(executorId)
  const localExecutor = executorRequestRoutingDeps.getLocalExecutor(executorId)
  if (localSocket && localExecutor) {
    return {
      mode: 'local',
      executor: localExecutor,
      nodeId: clusterConfig.nodeId,
    }
  }

  const persisted = await executorRequestRoutingDeps.getPersistedExecutorFresh(executorId)
  const executor = persisted?.executor ?? null
  if (!executor) {
    return {
      mode: 'unavailable',
      executor: null,
      reason: 'not-found',
    }
  }

  if (executor.status !== 'online') {
    return {
      mode: 'unavailable',
      executor,
      nodeId: executor.connectedNodeId,
      reason: 'offline',
    }
  }

  const connectedNodeId = executor.connectedNodeId?.trim()
  if (!connectedNodeId) {
    return {
      mode: 'unavailable',
      executor,
      reason: 'node-unassigned',
    }
  }

  if (connectedNodeId === clusterConfig.nodeId) {
    return {
      mode: 'unavailable',
      executor,
      nodeId: connectedNodeId,
      reason: 'local-socket-unavailable',
    }
  }

  const node = await executorRequestRoutingDeps.getNodeFresh(connectedNodeId)
  if (!node || !isClusterNodeHeartbeatFresh(node)) {
    return {
      mode: 'unavailable',
      executor,
      nodeId: connectedNodeId,
      reason: 'owning-node-offline',
    }
  }
  const relayUrl = trimTrailingSlash(node?.relayUrl || node?.url || '')
  if (!relayUrl) {
    return {
      mode: 'unavailable',
      executor,
      nodeId: connectedNodeId,
      reason: 'node-relay-url-missing',
    }
  }

  return {
    mode: 'remote',
    executor,
    nodeId: connectedNodeId,
    relayUrl,
  }
}

export const forwardExecutorClusterRequest = async <T>(params: {
  executorId: string
  request: InternalClusterExecutorRequest
  target: Extract<ExecutorRequestTarget, { mode: 'remote' }>
}) => {
  const requestTimeoutMs = params.request.timeoutMs ?? 15000
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), requestTimeoutMs + 2000)
  const response = await fetch(
    `${params.target.relayUrl}/api/internal/cluster/executors/${encodeURIComponent(params.executorId)}/request`,
    {
      method: 'POST',
      headers: buildClusterHeaders(),
      body: JSON.stringify(params.request),
      signal: controller.signal,
    },
  ).finally(() => clearTimeout(timer))

  const payload = await response.json().catch(() => null) as
    | {
        message?: string
        result?: T
      }
    | null

  if (!response.ok) {
    throw new Error(payload?.message || '跨节点执行器请求失败。')
  }

  return payload?.result as T
}

export type InternalClusterExecutorRequestResult =
  | LocalPathProbeResult
  | PatVerificationResult
  | SshVerificationResult
  | ExecutorTelemetrySnapshot
  | WorkerDoctorPayload
  | ExecutorTerminalResult
  | ExecutorTerminalSessionsResult
  | ExecutorTerminalSessionCreateResult
  | ExecutorTerminalSessionCloseResult
