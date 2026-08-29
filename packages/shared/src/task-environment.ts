// [INPUT]: 任务环境输入
// [OUTPUT]: 环境契约
// [POS]: 任务环境类型
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import type { ExecutorHttpProbeResult } from './types'

export type WorkspaceEnvironmentRuntimeStatus =
  | 'unsupported'
  | 'checking'
  | 'starting'
  | 'running'
  | 'stopping'
  | 'stopped'
  | 'unreachable'
  | 'error'

export interface WorkspaceEnvironmentStatusSnapshot {
  status: WorkspaceEnvironmentRuntimeStatus
  message: string
  checkedAt: string
  url?: string
  httpStatus?: number
}

export const getWorkspaceEnvironmentProbeUrl = (value?: {
  healthUrl?: string | null
  appUrl?: string | null
} | null) => {
  const healthUrl = value?.healthUrl?.trim()
  if (healthUrl) {
    return healthUrl
  }

  const appUrl = value?.appUrl?.trim()
  return appUrl || undefined
}

export const createWorkspaceEnvironmentStatusSnapshot = (params: {
  status: WorkspaceEnvironmentRuntimeStatus
  message: string
  checkedAt?: string
  url?: string
  httpStatus?: number
}): WorkspaceEnvironmentStatusSnapshot => ({
  status: params.status,
  message: params.message,
  checkedAt: params.checkedAt ?? new Date().toISOString(),
  url: params.url,
  httpStatus: params.httpStatus,
})

export const resolveWorkspaceEnvironmentStatusFromProbe = (params: {
  probe: ExecutorHttpProbeResult
  url?: string
  checkedAt?: string
}): WorkspaceEnvironmentStatusSnapshot => {
  const checkedAt = params.checkedAt ?? params.probe.at ?? new Date().toISOString()
  const url = params.url || params.probe.finalUrl || params.probe.url

  if (params.probe.ok && params.probe.reachable) {
    const httpStatus = typeof params.probe.statusCode === 'number' ? params.probe.statusCode : undefined
    const statusText = typeof httpStatus === 'number' ? `HTTP ${httpStatus}` : 'reachable'
    return createWorkspaceEnvironmentStatusSnapshot({
      status: 'running',
      message: `环境地址可访问（${statusText}）。`,
      checkedAt,
      url,
      httpStatus,
    })
  }

  const detail = params.probe.error?.trim()
  return createWorkspaceEnvironmentStatusSnapshot({
    status: 'unreachable',
    message: detail ? `环境地址暂时不可达：${detail}` : '环境地址暂时不可达。',
    checkedAt,
    url,
  })
}
