// [INPUT]: preview 会话数据
// [OUTPUT]: 记录
// [POS]: preview 会话记录
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import type { PreviewAccessMode, PreviewSessionPurpose, PreviewSessionStatus, PreviewTunnelClientStatus } from '@shared/types'

export type PreviewCloseReason =
  | 'stopped_by_user'
  | 'executor_offline'
  | 'tunnel_disconnected'
  | 'share_revoked'
  | 'server_restart'
  | 'replaced_by_public_proxy'
  | 'replaced_by_tunnel'
  | 'unknown'

export type PreviewSource = {
  appUrl: string
  healthUrl?: string
  targetProtocol: 'http' | 'https'
  targetHost: string
  targetPort: number
  targetBasePath: string
}

export type PreviewAdditionalSourceBinding = {
  id?: string
  appUrl: string
  publicHost: string
  publicUrl: string
  port?: number
  note?: string
  domainType?: 'generated' | 'custom'
}

export type PreviewSessionRecord = {
  id: string
  purpose: PreviewSessionPurpose
  projectId: string
  taskId: string
  workspaceId: string
  workspaceSessionId: string
  executorId: string
  ownerUserId: string
  executionSurface: 'private-node' | 'managed-cloud'
  accessMode: PreviewAccessMode
  status: PreviewSessionStatus
  closeReason?: PreviewCloseReason
  source: PreviewSource
  sourceBinding?: PreviewAdditionalSourceBinding
  additionalSources: PreviewSource[]
  additionalSourceBindings: PreviewAdditionalSourceBinding[]
  publicHost: string
  publicUrl: string
  tunnelTokenHash: string
  tunnelConnectedAt?: string
  tunnelDisconnectedAt?: string
  tunnelClientStatus?: PreviewTunnelClientStatus
  tunnelConnectionId?: string
  tunnelConnectedNodeId?: string
  shareTokenHash?: string
  shareUrl?: string
  shareTokenExpiresAt?: string
  shareRevokedAt?: string
  lastShareIssuedAt?: string
  createdAt: string
  updatedAt: string
  lastError?: string
}

// 取 session 的主 sourceBinding(优先 sourceBinding,否则 additionalSourceBindings[0])。
// sourceBinding 携带隧道域名 publicUrl/publicHost + 端口 + 备注,三者同源,
// 是表格/列表展示"预览入口"时应使用的字段(而非内部 loopback 的 source.appUrl)。
export const resolvePrimaryPreviewSourceBinding = (
  session: PreviewSessionRecord,
): PreviewAdditionalSourceBinding | undefined => {
  return session.sourceBinding ?? session.additionalSourceBindings[0]
}

// 取 session 的全部 sourceBinding(主 + 附加),每个对应一个端口及其独立隧道域名。
// 用于列表页端口切换器:每个端口有独立的 publicUrl,切换端口时隧道域名跟着变。
// 返回的每项同时携带对应的 source.appUrl(loopback),供 local-direct/public-direct transport 使用。
export type ResolvedPreviewSourceBindingWithAppUrl = PreviewAdditionalSourceBinding & {
  appUrl: string
}

const normalizePreviewSourceIdentity = (params: {
  appUrl: string
  port?: number
}) => {
  const normalizedAppUrl = params.appUrl.trim()
  if (params.port) {
    return `port:${params.port}`
  }

  try {
    const url = new URL(normalizedAppUrl)
    const port = Number(url.port || (url.protocol === 'https:' ? '443' : '80'))
    return `url:${url.protocol}//${url.hostname}:${port}${url.pathname}`
  } catch {
    return `app:${normalizedAppUrl}`
  }
}

const scorePreviewBinding = (binding: PreviewAdditionalSourceBinding) => {
  let score = 0
  if (binding.domainType === 'custom') {
    score += 8
  }
  if (binding.note?.trim()) {
    score += 2
  }
  if (binding.id?.trim()) {
    score += 1
  }
  return score
}

export const normalizePreviewSessionBindings = (params: {
  source: PreviewSource
  sourceBinding?: PreviewAdditionalSourceBinding
  additionalSources: PreviewSource[]
  additionalSourceBindings: PreviewAdditionalSourceBinding[]
}) => {
  const sourcesByAppUrl = new Map(params.additionalSources.map((source) => [source.appUrl, source]))
  const primaryIdentity = normalizePreviewSourceIdentity({
    appUrl: params.source.appUrl,
    port: params.source.targetPort,
  })
  const primaryBinding = params.sourceBinding
    ? {
        ...params.sourceBinding,
        appUrl: params.source.appUrl,
        port: params.sourceBinding.port ?? params.source.targetPort,
      }
    : undefined
  const uniqueBindings = new Map<string, ResolvedPreviewSourceBindingWithAppUrl>()

  const pushBinding = (binding: ResolvedPreviewSourceBindingWithAppUrl) => {
    const identity = normalizePreviewSourceIdentity({
      appUrl: binding.appUrl,
      port: binding.port,
    })
    const existing = uniqueBindings.get(identity)
    if (!existing || scorePreviewBinding(binding) > scorePreviewBinding(existing)) {
      uniqueBindings.set(identity, binding)
    }
  }

  if (primaryBinding) {
    pushBinding(primaryBinding)
  }

  for (const binding of params.additionalSourceBindings) {
    const source = sourcesByAppUrl.get(binding.appUrl) ?? params.additionalSources.find((item) => item.appUrl === binding.appUrl)
    pushBinding({
      ...binding,
      appUrl: source?.appUrl ?? binding.appUrl,
      port: binding.port ?? source?.targetPort,
    })
  }

  const normalizedBindings = Array.from(uniqueBindings.values())
  const normalizedPrimaryBinding = normalizedBindings.find((binding) => normalizePreviewSourceIdentity({
    appUrl: binding.appUrl,
    port: binding.port,
  }) === primaryIdentity)
    ?? (primaryBinding
      ? normalizedBindings.find((binding) => binding.appUrl === primaryBinding.appUrl && binding.publicUrl === primaryBinding.publicUrl)
      : undefined)
  const normalizedAdditionalBindings = normalizedBindings.filter((binding) => binding !== normalizedPrimaryBinding)
  const normalizedAdditionalSourceIdentities = new Set(normalizedAdditionalBindings.map((binding) => normalizePreviewSourceIdentity({
    appUrl: binding.appUrl,
    port: binding.port,
  })))
  const normalizedAdditionalSources = params.additionalSources.filter((source) => normalizedAdditionalSourceIdentities.has(normalizePreviewSourceIdentity({
    appUrl: source.appUrl,
    port: source.targetPort,
  })))

  return {
    sourceBinding: normalizedPrimaryBinding,
    additionalSourceBindings: normalizedAdditionalBindings.map(({ appUrl, ...binding }) => ({
      ...binding,
      appUrl,
    })),
    additionalSources: normalizedAdditionalSources,
  }
}

export const resolveAllPreviewSourceBindings = (
  session: PreviewSessionRecord,
): ResolvedPreviewSourceBindingWithAppUrl[] => {
  const normalized = normalizePreviewSessionBindings({
    source: session.source,
    sourceBinding: session.sourceBinding,
    additionalSources: session.additionalSources,
    additionalSourceBindings: session.additionalSourceBindings,
  })
  const result: ResolvedPreviewSourceBindingWithAppUrl[] = []

  if (normalized.sourceBinding) {
    result.push({
      ...normalized.sourceBinding,
      appUrl: session.source.appUrl,
      publicHost: session.publicHost,
      publicUrl: session.publicUrl,
      port: normalized.sourceBinding.port ?? session.source.targetPort,
    })
  }

  for (const binding of normalized.additionalSourceBindings) {
    result.push({
      ...binding,
      appUrl: binding.appUrl,
    })
  }

  return result
}


