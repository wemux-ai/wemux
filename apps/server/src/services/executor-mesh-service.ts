// [INPUT]: mesh 请求
import { getEnv } from '@shared/env'
// [OUTPUT]: 网格操作
// [POS]: executor mesh 服务
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import { createHash } from 'node:crypto'
import { deriveMeshProxyPortFromLocalServerPort, deriveMeshProxyPortFromStableId } from '@shared/easytier-ports'
import type { ExecutorDescriptor, WorkerMeshEnrollmentConfig } from '@shared/types'

const truthyEnvValues = new Set(['1', 'true', 'yes', 'on'])

const splitEnvList = (value?: string) => (value ?? '')
  .split(/[,\n]/)
  .map((item) => item.trim())
  .filter(Boolean)

const sanitizeNetworkSegment = (value: string) => value
  .trim()
  .toLowerCase()
  .replace(/[^a-z0-9-]+/g, '-')
  .replace(/^-+|-+$/g, '')
  .slice(0, 48)

export const buildExecutorMeshScope = (executor: ExecutorDescriptor) => {
  const workspaceIds = Array.from(new Set(
    (executor.workspaceIds ?? [])
      .map((value) => value.trim())
      .filter(Boolean),
  )).sort((left, right) => left.localeCompare(right))
  if (workspaceIds.length > 0) {
    return `workspace-${workspaceIds[0]}`
  }

  if (executor.teamId?.trim()) {
    return `team-${executor.teamId.trim()}`
  }

  return `user-${executor.ownerUserId.trim()}`
}

export const buildExecutorMeshNetworkName = (executor: ExecutorDescriptor) => {
  const configuredNetworkName = getEnv('WEMUX_EASYTIER_NETWORK_NAME')?.trim()
  if (configuredNetworkName) {
    return sanitizeNetworkSegment(configuredNetworkName) || 'vmx-default'
  }

  const prefix = getEnv('WEMUX_EASYTIER_NETWORK_PREFIX')?.trim() || 'vmx'
  const scope = buildExecutorMeshScope(executor)
  return sanitizeNetworkSegment(`${prefix}-${scope}`) || 'vmx-default'
}

const hashToOctet = (value: string, min: number, max: number) => {
  const range = max - min + 1
  const hash = createHash('sha256').update(value).digest()
  return min + (hash[0] % range)
}

const parseIpv4Prefix = (value: string) => value
  .replace(/\/\d+$/, '')
  .split('.')
  .map((item) => Number(item.trim()))
  .filter((item) => Number.isInteger(item) && item >= 0 && item <= 255)

export const buildExecutorMeshIpv4 = (executor: ExecutorDescriptor) => {
  const configuredPrefix = getEnv('WEMUX_EASYTIER_IPV4_PREFIX')?.trim() || '10.144'
  const prefix = parseIpv4Prefix(configuredPrefix)
  const first = prefix[0] ?? 10
  const second = prefix[1] ?? 144
  const third = prefix.length >= 3
    ? prefix[2]
    : hashToOctet(buildExecutorMeshNetworkName(executor), 1, 254)
  const fourth = hashToOctet(executor.executorId, 2, 254)
  return `${first}.${second}.${third}.${fourth}`
}

export const resolveExecutorMeshPreviewProxyPort = (executor?: Pick<ExecutorDescriptor, 'executorId' | 'localServerPort'> | null) => {
  const configured = Number(getEnv('WEMUX_EASYTIER_PREVIEW_PROXY_PORT') || '')
  if (Number.isInteger(configured) && configured > 0 && configured <= 65535) {
    return configured
  }

  if (executor?.localServerPort) {
    return deriveMeshProxyPortFromLocalServerPort(executor.localServerPort)
  }

  return deriveMeshProxyPortFromStableId(executor?.executorId)
}

export const resolveExecutorMeshTerminalProxyPort = (executor?: Pick<ExecutorDescriptor, 'executorId' | 'localServerPort'> | null) => {
  const configured = Number(getEnv('WEMUX_EASYTIER_TERMINAL_PROXY_PORT') || getEnv('WEMUX_EASYTIER_PREVIEW_PROXY_PORT') || '')
  if (Number.isInteger(configured) && configured > 0 && configured <= 65535) {
    return configured
  }

  if (executor?.localServerPort) {
    return deriveMeshProxyPortFromLocalServerPort(executor.localServerPort)
  }

  return deriveMeshProxyPortFromStableId(executor?.executorId)
}

export const resolveExecutorMeshEnrollment = (
  executor: ExecutorDescriptor | null | undefined,
): WorkerMeshEnrollmentConfig | undefined => {
  if (!executor) {
    return undefined
  }

  const enabled = truthyEnvValues.has(getEnv('WEMUX_MESH_ENABLED')?.trim().toLowerCase() || '')
  if (!enabled) {
    return {
      enabled: false,
      peers: [],
    }
  }

  const networkSecret = getEnv('WEMUX_EASYTIER_NETWORK_SECRET')?.trim()
  const peers = splitEnvList(getEnv('WEMUX_EASYTIER_PEERS'))
  if (!networkSecret || peers.length === 0) {
    return {
      enabled: true,
      networkName: buildExecutorMeshNetworkName(executor),
      peers,
      ipv4: buildExecutorMeshIpv4(executor),
      hostname: executor.name || executor.executorId,
      previewProxyPort: resolveExecutorMeshPreviewProxyPort(executor),
      terminalProxyPort: resolveExecutorMeshTerminalProxyPort(executor),
    }
  }

  return {
    enabled: true,
    networkName: buildExecutorMeshNetworkName(executor),
    networkSecret,
    peers,
    ipv4: buildExecutorMeshIpv4(executor),
    hostname: executor.name || executor.executorId,
    previewProxyPort: resolveExecutorMeshPreviewProxyPort(executor),
    terminalProxyPort: resolveExecutorMeshTerminalProxyPort(executor),
  }
}
