// [INPUT]: preview 请求
// [OUTPUT]: 会话管理
// [POS]: preview 会话服务
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import { createHash, createHmac, randomBytes } from 'node:crypto'
import type {
  CreatePreviewShareResponse,
  PreviewAdditionalSourceDto,
  PreviewAccessMode,
  PreviewDomainBindingDto,
  PreviewSessionPurpose,
  PreviewSessionDto,
  PreviewShareState,
  PreviewTunnelClientStatus,
  PreviewTunnelMetricsDto,
  PreviewViewerAccess,
} from '@shared/types'
import { normalizePreviewPublicUrl } from './preview-hostname'
import { resolveSharedTokenSecret } from './token-secret'
import { initPreviewSessionStore, listPersistedPreviewSessions, savePersistedPreviewSession } from '../storage/postgres/preview-session-store'
import {
  normalizePreviewSessionBindings,
  type PreviewAdditionalSourceBinding,
  type PreviewCloseReason,
  type PreviewSessionRecord,
  type PreviewSource,
} from './preview-session-record'

type SignedPreviewTokenPayload = {
  kind: 'viewer-bootstrap' | 'preview-access'
  previewId: string
  grantType: 'owner' | 'share'
  exp: number
  iat: number
  nonce: string
}

const VIEWER_BOOTSTRAP_TTL_MS = 5 * 60_000
const OWNER_ACCESS_TTL_MS = 12 * 60 * 60_000
const DEFAULT_PREVIEW_PURPOSE: PreviewSessionPurpose = 'app'

const sessions = new Map<string, PreviewSessionRecord>()
const activePreviewIdsByTaskWorkspacePurpose = new Map<string, string>()
const previewIdsByHost = new Map<string, string>()
const tunnelLatencies = new Map<string, {
  roundTripMs: number
  sampledAt: string
}>()
const tunnelMetrics = new Map<string, PreviewTunnelMetricsDto>()
let hydrated = false

const nowIso = () => new Date().toISOString()

const hashToken = (value: string) => createHash('sha256').update(value).digest('hex')

const issueOpaqueToken = () => randomBytes(24).toString('base64url')

const PREVIEW_TOKEN_SECRET = resolveSharedTokenSecret()

const buildTaskWorkspaceKey = (purpose: PreviewSessionPurpose | undefined, taskId: string, workspaceId: string) => `${purpose ?? DEFAULT_PREVIEW_PURPOSE}:${taskId}:${workspaceId}`

const isExpired = (value?: string) => {
  if (!value) {
    return true
  }

  return new Date(value).getTime() <= Date.now()
}

const buildSignedPreviewToken = (payload: SignedPreviewTokenPayload) => {
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url')
  const signature = createHmac('sha256', PREVIEW_TOKEN_SECRET).update(encoded).digest('base64url')
  return `${encoded}.${signature}`
}

const parseSignedPreviewToken = (
  token: string,
  expectedKind: SignedPreviewTokenPayload['kind'],
): SignedPreviewTokenPayload | null => {
  const dotIndex = token.indexOf('.')
  if (dotIndex === -1) {
    return null
  }

  const encoded = token.slice(0, dotIndex)
  const signature = token.slice(dotIndex + 1)
  const expectedSignature = createHmac('sha256', PREVIEW_TOKEN_SECRET).update(encoded).digest('base64url')
  if (signature !== expectedSignature) {
    return null
  }

  try {
    const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as Partial<SignedPreviewTokenPayload>
    if (
      payload.kind !== expectedKind
      || (payload.grantType !== 'owner' && payload.grantType !== 'share')
      || typeof payload.previewId !== 'string'
      || !payload.previewId.trim()
      || typeof payload.exp !== 'number'
      || typeof payload.iat !== 'number'
      || typeof payload.nonce !== 'string'
      || !payload.nonce
      || payload.exp <= Date.now()
    ) {
      return null
    }

    return {
      kind: payload.kind,
      previewId: payload.previewId,
      grantType: payload.grantType,
      exp: payload.exp,
      iat: payload.iat,
      nonce: payload.nonce,
    }
  } catch {
    return null
  }
}

const toShareState = (session: PreviewSessionRecord): PreviewShareState => {
  if (!session.shareTokenHash || !session.shareTokenExpiresAt || isExpired(session.shareTokenExpiresAt)) {
    return {
      enabled: false,
      revokedAt: session.shareRevokedAt,
    }
  }

  return {
    enabled: true,
    shareUrl: session.shareUrl,
    expiresAt: session.shareTokenExpiresAt,
    revokedAt: session.shareRevokedAt,
  }
}

const toDto = (session: PreviewSessionRecord): PreviewSessionDto => {
  const normalizedSession = normalizePreviewSessionRecord(session)
  const tunnelLatency = tunnelLatencies.get(normalizedSession.id)
  const metrics = tunnelMetrics.get(normalizedSession.id)
  const sourceBindingsByAppUrl = new Map(normalizedSession.additionalSourceBindings.map((binding) => [binding.appUrl, binding]))
  const primaryBinding = normalizedSession.sourceBinding ?? {
    appUrl: normalizedSession.source.appUrl,
    publicUrl: normalizedSession.publicUrl,
    publicHost: normalizedSession.publicHost,
    port: normalizedSession.source.targetPort,
  }
  const domainBindings: PreviewDomainBindingDto[] = [
    {
      id: primaryBinding.id,
      appUrl: normalizedSession.source.appUrl,
      publicUrl: normalizedSession.publicUrl,
      previewHost: normalizedSession.publicHost,
      port: primaryBinding.port ?? normalizedSession.source.targetPort,
      note: primaryBinding.note,
      domainType: primaryBinding.domainType,
      primary: true,
    },
    ...normalizedSession.additionalSourceBindings.map((binding) => ({
      id: binding.id,
      appUrl: binding.appUrl,
      publicUrl: binding.publicUrl,
      previewHost: binding.publicHost,
      port: binding.port,
      note: binding.note,
      domainType: binding.domainType,
      primary: false,
    })),
  ]
  return {
    previewId: normalizedSession.id,
    purpose: normalizedSession.purpose ?? DEFAULT_PREVIEW_PURPOSE,
    projectId: normalizedSession.projectId,
    taskId: normalizedSession.taskId,
    workspaceId: normalizedSession.workspaceId,
    workspaceSessionId: normalizedSession.workspaceSessionId,
    executorId: normalizedSession.executorId,
    executionSurface: normalizedSession.executionSurface,
    accessMode: normalizedSession.accessMode,
    status: normalizedSession.status,
    publicUrl: normalizedSession.publicUrl,
    previewHost: normalizedSession.publicHost,
    sourceAppUrl: normalizedSession.source.appUrl,
    domainBindings,
    additionalSourceAppUrls: normalizedSession.additionalSources.map<PreviewAdditionalSourceDto>((source) => {
      const binding = sourceBindingsByAppUrl.get(source.appUrl)
      return {
        appUrl: source.appUrl,
        healthUrl: source.healthUrl,
        publicUrl: binding?.publicUrl,
        previewHost: binding?.publicHost,
        port: binding?.port ?? source.targetPort,
        note: binding?.note,
        domainType: binding?.domainType,
      }
    }),
    healthUrl: normalizedSession.source.healthUrl,
    createdAt: normalizedSession.createdAt,
    updatedAt: normalizedSession.updatedAt,
    tunnelClientStatus: normalizedSession.tunnelClientStatus,
    tunnelConnectedAt: normalizedSession.tunnelConnectedAt,
    tunnelLatencyMs: tunnelLatency?.roundTripMs,
    tunnelLatencySampledAt: tunnelLatency?.sampledAt,
    tunnelMetrics: metrics ? { ...metrics } : undefined,
    lastError: normalizedSession.lastError,
    share: toShareState(normalizedSession),
  }
}

const clearTunnelLatency = (previewId: string) => {
  tunnelLatencies.delete(previewId)
}

const updateTunnelMetrics = (
  previewId: string,
  updater: (current: PreviewTunnelMetricsDto) => PreviewTunnelMetricsDto,
) => {
  const next = updater({
    ...(tunnelMetrics.get(previewId) ?? {}),
  })
  next.updatedAt = nowIso()
  tunnelMetrics.set(previewId, next)
  return next
}

const resetLiveTunnelMetrics = (previewId: string) => {
  updateTunnelMetrics(previewId, (current) => ({
    ...current,
    activeStreams: 0,
    currentBufferedAmount: 0,
    currentSendQueueDepth: 0,
    currentSendQueueBytes: 0,
  }))
}

const issueViewerBootstrap = (session: PreviewSessionRecord): PreviewViewerAccess => {
  const issuedAt = Date.now()
  const expiresAtMs = issuedAt + VIEWER_BOOTSTRAP_TTL_MS
  const token = buildSignedPreviewToken({
    kind: 'viewer-bootstrap',
    previewId: session.id,
    grantType: 'owner',
    exp: expiresAtMs,
    iat: issuedAt,
    nonce: issueOpaqueToken(),
  })
  const expiresAt = new Date(expiresAtMs).toISOString()

  console.log('[preview-bootstrap-token] issued', {
    previewSessionId: session.id,
    grantType: 'owner',
    expiresAt,
    tokenHash: hashToken(token).slice(0, 8),
  })

  const additionalSourceAccess = session.additionalSourceBindings.map((binding) => ({
    appUrl: binding.appUrl,
    iframeUrl: `${binding.publicUrl}?vmx_viewer_token=${encodeURIComponent(token)}`,
    publicUrl: binding.publicUrl,
    previewHost: binding.publicHost,
    port: binding.port,
    note: binding.note,
    domainType: binding.domainType,
  }))

  return {
    iframeUrl: `${session.publicUrl}?vmx_viewer_token=${encodeURIComponent(token)}`,
    publicUrl: session.publicUrl,
    previewHost: session.publicHost,
    additionalSourceAccess,
    grantType: 'owner',
    expiresAt,
  }
}

const issueAccessToken = (params: {
  previewId: string
  grantType: 'owner' | 'share'
  expiresAt: string
}) => {
  const issuedAt = Date.now()
  return buildSignedPreviewToken({
    kind: 'preview-access',
    previewId: params.previewId,
    grantType: params.grantType,
    exp: new Date(params.expiresAt).getTime(),
    iat: issuedAt,
    nonce: issueOpaqueToken(),
  })
}

const getSessionPublicHosts = (session: Pick<PreviewSessionRecord, 'publicHost' | 'additionalSourceBindings'>) => [
  session.publicHost,
  ...session.additionalSourceBindings.map((binding) => binding.publicHost),
]

const clearIndexedHost = (session: Pick<PreviewSessionRecord, 'id' | 'publicHost' | 'additionalSourceBindings'>) => {
  for (const publicHost of getSessionPublicHosts(session)) {
    const normalizedHost = publicHost.trim().toLowerCase()
    if (previewIdsByHost.get(normalizedHost) === session.id) {
      previewIdsByHost.delete(normalizedHost)
    }
  }
}

const upsertIndexedSession = (session: PreviewSessionRecord) => {
  const previous = sessions.get(session.id)
  if (previous) {
    clearIndexedHost(previous)
  }

  sessions.set(session.id, session)
  for (const publicHost of getSessionPublicHosts(session)) {
    previewIdsByHost.set(publicHost.trim().toLowerCase(), session.id)
  }
}

const markUpdated = (session: PreviewSessionRecord, patch: Partial<PreviewSessionRecord>) => {
  const next = {
    ...session,
    ...patch,
    updatedAt: patch.updatedAt ?? nowIso(),
  }
  upsertIndexedSession(next)
  savePersistedPreviewSession(next)
  return next
}

const setIndexedSession = (session: PreviewSessionRecord) => {
  upsertIndexedSession(session)
}

const clearExpiredShareState = (session: PreviewSessionRecord): PreviewSessionRecord => {
  if (!session.shareTokenHash || !session.shareTokenExpiresAt || !isExpired(session.shareTokenExpiresAt)) {
    return session
  }

  return {
    ...session,
    shareTokenHash: undefined,
    shareUrl: undefined,
    shareTokenExpiresAt: undefined,
  }
}

const normalizeSessionPublicUrl = (session: PreviewSessionRecord): PreviewSessionRecord => {
  const fallbackScheme = session.source.targetProtocol === 'https' ? 'https' : 'http'
  const normalizedPublicUrl = normalizePreviewPublicUrl({
    publicHost: session.publicHost,
    publicUrl: session.publicUrl,
    fallbackScheme,
  })

  if (normalizedPublicUrl === session.publicUrl) {
    return session
  }

  const next = {
    ...session,
    publicUrl: normalizedPublicUrl,
  }
  if (session.shareUrl) {
    try {
      const shareUrl = new URL(session.shareUrl)
      const nextBase = new URL(normalizedPublicUrl)
      nextBase.search = shareUrl.search
      nextBase.hash = shareUrl.hash
      next.shareUrl = nextBase.toString()
    } catch {
      next.shareUrl = undefined
      next.shareTokenHash = undefined
      next.shareTokenExpiresAt = undefined
    }
  }
  return next
}

const normalizePreviewSessionRecord = (session: PreviewSessionRecord): PreviewSessionRecord => {
  const normalizedBindings = normalizePreviewSessionBindings({
    source: session.source,
    sourceBinding: session.sourceBinding,
    additionalSources: session.additionalSources,
    additionalSourceBindings: session.additionalSourceBindings,
  })

  return {
    ...session,
    sourceBinding: normalizedBindings.sourceBinding,
    additionalSources: normalizedBindings.additionalSources,
    additionalSourceBindings: normalizedBindings.additionalSourceBindings,
  }
}

const restoreSessionAfterRestart = (session: PreviewSessionRecord): PreviewSessionRecord => {
  const next = normalizePreviewSessionRecord(normalizeSessionPublicUrl(clearExpiredShareState(session)))
  const lostTunnelState = (
    next.status === 'active'
    || next.status === 'opening'
    || next.status === 'stopping'
    || next.tunnelClientStatus === 'open'
    || Boolean(next.tunnelConnectionId)
  )
  if (!lostTunnelState) {
    return next
  }

  return {
    ...next,
    status: 'waiting_tunnel' as const,
    closeReason: 'server_restart' as const,
    tunnelClientStatus: 'closed' as const,
    tunnelConnectionId: undefined,
    tunnelConnectedNodeId: undefined,
    tunnelDisconnectedAt: nowIso(),
    lastError: next.lastError || 'Preview tunnel was interrupted by server restart. Reopen preview to reconnect.',
    updatedAt: nowIso(),
  }
}

export const previewSessionService = {
  async bootstrap() {
    if (hydrated) {
      return
    }

    await initPreviewSessionStore()
    sessions.clear()
    activePreviewIdsByTaskWorkspacePurpose.clear()
    previewIdsByHost.clear()
    tunnelLatencies.clear()

    const persistedSessions = listPersistedPreviewSessions()
    const restoredSessions = persistedSessions
      .map((session) => ({
        original: session,
        restored: restoreSessionAfterRestart(session),
      }))
      .sort((left, right) => right.restored.updatedAt.localeCompare(left.restored.updatedAt) || right.restored.createdAt.localeCompare(left.restored.createdAt))

    for (const entry of restoredSessions) {
      setIndexedSession(entry.restored)
      if (entry.restored.status !== 'closed') {
        const taskWorkspaceKey = buildTaskWorkspaceKey(entry.restored.purpose, entry.restored.taskId, entry.restored.workspaceId)
        if (!activePreviewIdsByTaskWorkspacePurpose.has(taskWorkspaceKey)) {
          activePreviewIdsByTaskWorkspacePurpose.set(taskWorkspaceKey, entry.restored.id)
        }
      }
    }

    for (const entry of restoredSessions) {
      if (JSON.stringify(entry.original) !== JSON.stringify(entry.restored)) {
        savePersistedPreviewSession(entry.restored)
      }
    }

    hydrated = true
  },

  async refreshPersistentSessions() {
    await initPreviewSessionStore()
    sessions.clear()
    activePreviewIdsByTaskWorkspacePurpose.clear()
    previewIdsByHost.clear()

    const persistedSessions = listPersistedPreviewSessions()
      .map(normalizePreviewSessionRecord)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || right.createdAt.localeCompare(left.createdAt))

    for (const session of persistedSessions) {
      setIndexedSession(session)
      if (session.status === 'closed') {
        continue
      }

      const taskWorkspaceKey = buildTaskWorkspaceKey(session.purpose, session.taskId, session.workspaceId)
      if (!activePreviewIdsByTaskWorkspacePurpose.has(taskWorkspaceKey)) {
        activePreviewIdsByTaskWorkspacePurpose.set(taskWorkspaceKey, session.id)
      }
    }
  },

  createOrReuseSession(input: {
    previewId: string
    purpose?: PreviewSessionPurpose
    projectId: string
    taskId: string
    workspaceId: string
    workspaceSessionId: string
    executorId: string
    ownerUserId: string
    source: PreviewSource
    sourceBinding?: PreviewAdditionalSourceBinding
    additionalSources: PreviewSource[]
    additionalSourceBindings?: PreviewAdditionalSourceBinding[]
    publicHost: string
    publicUrl: string
    accessMode?: PreviewAccessMode
  }): { session: PreviewSessionRecord; created: false } | { session: PreviewSessionRecord; created: true; tunnelToken: string } {
    const purpose = input.purpose ?? DEFAULT_PREVIEW_PURPOSE
    const normalizedBindings = normalizePreviewSessionBindings({
      source: input.source,
      sourceBinding: input.sourceBinding,
      additionalSources: input.additionalSources,
      additionalSourceBindings: input.additionalSourceBindings ?? [],
    })
    const taskWorkspaceKey = buildTaskWorkspaceKey(purpose, input.taskId, input.workspaceId)
    const existingId = activePreviewIdsByTaskWorkspacePurpose.get(taskWorkspaceKey)
    const existing = existingId ? sessions.get(existingId) : undefined

    if (
      existing
      && existing.executorId === input.executorId
      && existing.accessMode === (input.accessMode ?? existing.accessMode)
      && existing.source.appUrl === input.source.appUrl
      && existing.status !== 'closed'
      && existing.status !== 'error'
    ) {
      const refreshed = markUpdated(existing, normalizePreviewSessionRecord({
        ...existing,
        workspaceId: input.workspaceId,
        workspaceSessionId: input.workspaceSessionId,
        source: input.source,
        sourceBinding: normalizedBindings.sourceBinding ?? existing.sourceBinding,
        additionalSources: normalizedBindings.additionalSources,
        accessMode: input.accessMode ?? existing.accessMode,
        additionalSourceBindings: normalizedBindings.additionalSourceBindings,
        publicUrl: normalizeSessionPublicUrl(existing).publicUrl,
      }))
      return {
        session: refreshed,
        created: false,
      }
    }

    const id = input.previewId
    const tunnelToken = issueOpaqueToken()
    const createdAt = nowIso()
    const session: PreviewSessionRecord = normalizePreviewSessionRecord({
      id,
      purpose,
      projectId: input.projectId,
      taskId: input.taskId,
      workspaceId: input.workspaceId,
      workspaceSessionId: input.workspaceSessionId,
      executorId: input.executorId,
      ownerUserId: input.ownerUserId,
      executionSurface: 'private-node',
      accessMode: input.accessMode ?? 'tunnel',
      status: 'waiting_tunnel',
      source: input.source,
      sourceBinding: normalizedBindings.sourceBinding,
      additionalSources: normalizedBindings.additionalSources,
      additionalSourceBindings: normalizedBindings.additionalSourceBindings,
      publicHost: input.publicHost,
      publicUrl: input.publicUrl,
      tunnelTokenHash: hashToken(tunnelToken),
      tunnelConnectedNodeId: undefined,
      createdAt,
      updatedAt: createdAt,
    })

    setIndexedSession(session)
    activePreviewIdsByTaskWorkspacePurpose.set(taskWorkspaceKey, id)
    savePersistedPreviewSession(session)
    return {
      session,
      created: true,
      tunnelToken,
    }
  },

  getSessionById(previewId: string) {
    return sessions.get(previewId) ?? null
  },

  getOwnerSession(previewId: string, ownerUserId: string) {
    const session = sessions.get(previewId)
    if (!session || session.ownerUserId !== ownerUserId) {
      return null
    }

    return session
  },

  getOwnerSessionForTaskWorkspace(input: {
    taskId: string
    workspaceId: string
    ownerUserId: string
    purpose?: PreviewSessionPurpose
    executorId?: string
  }) {
    const purpose = input.purpose ?? DEFAULT_PREVIEW_PURPOSE
    const expectedExecutorId = input.executorId?.trim()
    const previewId = activePreviewIdsByTaskWorkspacePurpose.get(
      buildTaskWorkspaceKey(purpose, input.taskId, input.workspaceId),
    )
    const indexedSession = previewId ? sessions.get(previewId) : undefined
    if (
      indexedSession
      && indexedSession.ownerUserId === input.ownerUserId
      && (indexedSession.purpose ?? DEFAULT_PREVIEW_PURPOSE) === purpose
      && indexedSession.status !== 'closed'
      && (!expectedExecutorId || indexedSession.executorId === expectedExecutorId)
    ) {
      return indexedSession
    }

    const fallbackSession = Array.from(sessions.values())
      .filter((session) => (
        session.taskId === input.taskId
        && session.workspaceId === input.workspaceId
        && session.ownerUserId === input.ownerUserId
        && (session.purpose ?? DEFAULT_PREVIEW_PURPOSE) === purpose
        && session.status !== 'closed'
        && (!expectedExecutorId || session.executorId === expectedExecutorId)
      ))
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || right.createdAt.localeCompare(left.createdAt))[0]
    if (fallbackSession) {
      activePreviewIdsByTaskWorkspacePurpose.set(
        buildTaskWorkspaceKey(purpose, input.taskId, input.workspaceId),
        fallbackSession.id,
      )
      return fallbackSession
    }

    return null
  },

  getSessionByHost(host: string) {
    const previewId = previewIdsByHost.get(host.trim().toLowerCase())
    if (!previewId) {
      return null
    }

    return sessions.get(previewId) ?? null
  },

  // 工作区目录页批量取每个 workspace 当前 active 的 preview session(共享语义,
  // 不按 ownerUserId 过滤 —— 预览域名是 workspace 级共享资源,与 getSessionByHost 一致)。
  // 每个 workspace 只取 updatedAt 最新的一条非 closed session。
  listActiveSessionsForWorkspaces(workspaceIds: string[]): Map<string, PreviewSessionRecord> {
    if (!workspaceIds.length) {
      return new Map()
    }

    const wanted = new Set(workspaceIds)
    const latestByWorkspace = new Map<string, PreviewSessionRecord>()
    for (const session of sessions.values()) {
      if (session.status === 'closed' || !wanted.has(session.workspaceId)) {
        continue
      }
      const current = latestByWorkspace.get(session.workspaceId)
      if (!current || session.updatedAt.localeCompare(current.updatedAt) > 0) {
        latestByWorkspace.set(session.workspaceId, session)
      }
    }

    return latestByWorkspace
  },

  issueViewerAccess(previewId: string) {
    const session = sessions.get(previewId)
    if (!session || session.status === 'closed') {
      return null
    }

    return issueViewerBootstrap(session)
  },

  createShare(previewId: string, expiresInMinutes: number): CreatePreviewShareResponse | null {
    const session = sessions.get(previewId)
    if (!session || session.status === 'closed') {
      return null
    }

    const shareToken = issueOpaqueToken()
    const expiresAt = new Date(Date.now() + expiresInMinutes * 60_000).toISOString()
    const next = markUpdated(session, {
      shareTokenHash: hashToken(shareToken),
      shareUrl: `${session.publicUrl}?share_token=${encodeURIComponent(shareToken)}`,
      shareTokenExpiresAt: expiresAt,
      shareRevokedAt: undefined,
      lastShareIssuedAt: nowIso(),
    })

    return {
      previewId: previewId,
      share: {
        enabled: true,
        shareUrl: next.shareUrl!,
        expiresAt,
      },
    }
  },

  revokeShare(previewId: string) {
    const session = sessions.get(previewId)
    if (!session) {
      return null
    }

    const revokedAt = nowIso()
    markUpdated(session, {
      shareTokenHash: undefined,
      shareUrl: undefined,
      shareTokenExpiresAt: undefined,
      shareRevokedAt: revokedAt,
    })
    return revokedAt
  },

  close(previewId: string, reason: PreviewCloseReason) {
    const session = sessions.get(previewId)
    if (!session) {
      return null
    }

    const revokedAt = nowIso()
    const closed = markUpdated(session, {
      status: 'closed',
      closeReason: reason,
      tunnelConnectionId: undefined,
      tunnelConnectedNodeId: undefined,
      tunnelClientStatus: 'closed',
      tunnelDisconnectedAt: nowIso(),
      shareTokenHash: undefined,
      shareUrl: undefined,
      shareTokenExpiresAt: undefined,
      shareRevokedAt: revokedAt,
    })
    clearTunnelLatency(previewId)
    activePreviewIdsByTaskWorkspacePurpose.delete(buildTaskWorkspaceKey(session.purpose, session.taskId, session.workspaceId))
    return closed
  },

  markError(previewId: string, message: string) {
    const session = sessions.get(previewId)
    if (!session) {
      return null
    }

    clearTunnelLatency(previewId)
    return markUpdated(session, {
      status: 'error',
      lastError: message,
    })
  },

  markActive(
    previewId: string,
    executionSurface?: PreviewSessionRecord['executionSurface'],
    accessMode?: PreviewSessionRecord['accessMode'],
  ) {
    const session = sessions.get(previewId)
    if (!session) {
      return null
    }

    return markUpdated(session, {
      status: session.status === 'closed' ? 'closed' : 'active',
      executionSurface: executionSurface ?? session.executionSurface,
      accessMode: accessMode ?? session.accessMode,
      lastError: undefined,
    })
  },

  validateTunnelToken(previewId: string, tunnelToken: string) {
    const session = sessions.get(previewId)
    if (!session || session.status === 'closed') {
      return null
    }

    return session.tunnelTokenHash === hashToken(tunnelToken) ? session : null
  },

  rotateTunnelToken(previewId: string) {
    const session = sessions.get(previewId)
    if (!session || session.status === 'closed') {
      return null
    }

    const tunnelToken = issueOpaqueToken()
    clearTunnelLatency(previewId)
    markUpdated(session, {
      status: 'waiting_tunnel',
      tunnelTokenHash: hashToken(tunnelToken),
      tunnelConnectionId: undefined,
      tunnelConnectedNodeId: undefined,
      tunnelClientStatus: 'connecting',
      lastError: undefined,
    })
    updateTunnelMetrics(previewId, (current) => ({
      ...current,
      activeStreams: 0,
      currentBufferedAmount: 0,
      currentSendQueueDepth: 0,
      currentSendQueueBytes: 0,
    }))
    return tunnelToken
  },

  markTunnelConnected(previewId: string, connectionId: string, nodeId?: string) {
    const session = sessions.get(previewId)
    if (!session) {
      return null
    }
    if (session.tunnelConnectionId && session.tunnelConnectionId !== connectionId) {
      return null
    }

    clearTunnelLatency(previewId)
    resetLiveTunnelMetrics(previewId)
    return markUpdated(session, {
      status: session.status === 'closed' ? 'closed' : 'active',
      tunnelConnectionId: connectionId,
      tunnelClientStatus: 'open',
      tunnelConnectedAt: nowIso(),
      tunnelDisconnectedAt: undefined,
      tunnelConnectedNodeId: nodeId?.trim() || session.tunnelConnectedNodeId,
      lastError: undefined,
    })
  },

  markTunnelDisconnected(previewId: string, connectionId?: string, message?: string) {
    const session = sessions.get(previewId)
    if (!session) {
      return null
    }
    if (connectionId && session.tunnelConnectionId && session.tunnelConnectionId !== connectionId) {
      return session
    }

    if (session.status === 'closed' || session.status === 'stopping') {
      clearTunnelLatency(previewId)
      resetLiveTunnelMetrics(previewId)
      return markUpdated(session, {
        tunnelConnectionId: undefined,
        tunnelConnectedNodeId: undefined,
        tunnelClientStatus: 'closed',
        tunnelDisconnectedAt: nowIso(),
      })
    }

    clearTunnelLatency(previewId)
    resetLiveTunnelMetrics(previewId)
    return markUpdated(session, {
      status: 'waiting_tunnel',
      closeReason: 'tunnel_disconnected',
      tunnelConnectionId: undefined,
      tunnelConnectedNodeId: undefined,
      tunnelClientStatus: 'closed',
      tunnelDisconnectedAt: nowIso(),
      lastError: message,
    })
  },

  applyTunnelClientStatus(previewId: string, status: PreviewTunnelClientStatus, message?: string) {
    const session = sessions.get(previewId)
    if (!session) {
      return null
    }

    if (status === 'connecting') {
      clearTunnelLatency(previewId)
      resetLiveTunnelMetrics(previewId)
      return markUpdated(session, {
        status: session.status === 'closed' ? 'closed' : 'waiting_tunnel',
        tunnelClientStatus: status,
        lastError: undefined,
      })
    }

    if (status === 'open') {
      return markUpdated(session, {
        status: session.status === 'closed' ? 'closed' : 'active',
        tunnelClientStatus: status,
        tunnelConnectedAt: session.tunnelConnectedAt ?? nowIso(),
        lastError: undefined,
      })
    }

    if (status === 'error') {
      clearTunnelLatency(previewId)
      resetLiveTunnelMetrics(previewId)
      return markUpdated(session, {
        status: 'error',
        tunnelClientStatus: status,
        lastError: message || session.lastError,
      })
    }

    if (session.status === 'closed' || session.status === 'stopping') {
      clearTunnelLatency(previewId)
      resetLiveTunnelMetrics(previewId)
      return markUpdated(session, {
        tunnelClientStatus: status,
        tunnelDisconnectedAt: nowIso(),
      })
    }

    clearTunnelLatency(previewId)
    resetLiveTunnelMetrics(previewId)
    return markUpdated(session, {
      status: 'waiting_tunnel',
      tunnelClientStatus: status,
      tunnelDisconnectedAt: nowIso(),
      lastError: message,
    })
  },

  updateTunnelLatency(previewId: string, roundTripMs: number) {
    const session = sessions.get(previewId)
    if (!session || session.tunnelClientStatus !== 'open') {
      return null
    }

    tunnelLatencies.set(previewId, {
      roundTripMs: Math.max(0, Math.round(roundTripMs)),
      sampledAt: nowIso(),
    })
    return this.toDto(session)
  },

  updateTunnelMetrics(previewId: string, patch: Partial<PreviewTunnelMetricsDto>) {
    const session = sessions.get(previewId)
    if (!session) {
      return null
    }

    updateTunnelMetrics(previewId, (current) => ({
      ...current,
      ...patch,
    }))
    return this.toDto(session)
  },

  getTunnelMetrics(previewId: string) {
    const metrics = tunnelMetrics.get(previewId)
    return metrics ? { ...metrics } : null
  },

  incrementTunnelMetric(previewId: string, metric: keyof PreviewTunnelMetricsDto, delta = 1) {
    const session = sessions.get(previewId)
    if (!session) {
      return null
    }

    updateTunnelMetrics(previewId, (current) => ({
      ...current,
      [metric]: typeof current[metric] === 'number'
        ? Number(current[metric]) + delta
        : delta,
    }))
    return this.toDto(session)
  },

  exchangeBootstrapToken(token: string) {
    const tokenHashPrefix = hashToken(token).slice(0, 8)
    const payload = parseSignedPreviewToken(token, 'viewer-bootstrap')
    if (!payload) {
      console.log('[preview-bootstrap-token] exchange rejected', {
        tokenHash: tokenHashPrefix,
        reason: 'missing_or_expired',
      })
      return null
    }

    const session = sessions.get(payload.previewId)
    if (!session || session.status === 'closed') {
      console.log('[preview-bootstrap-token] exchange rejected', {
        tokenHash: tokenHashPrefix,
        previewSessionId: payload.previewId,
        reason: session ? 'session_closed' : 'session_missing',
      })
      return null
    }
    if (payload.grantType === 'share') {
      if (!session.shareTokenHash || !session.shareTokenExpiresAt || isExpired(session.shareTokenExpiresAt)) {
        console.log('[preview-bootstrap-token] exchange rejected', {
          tokenHash: tokenHashPrefix,
          previewSessionId: payload.previewId,
          reason: 'share_expired',
        })
        return null
      }
      if (session.shareRevokedAt) {
        console.log('[preview-bootstrap-token] exchange rejected', {
          tokenHash: tokenHashPrefix,
          previewSessionId: payload.previewId,
          reason: 'share_revoked',
        })
        return null
      }
    }

    const expiresAt = payload.grantType === 'share'
      ? session.shareTokenExpiresAt!
      : new Date(Date.now() + OWNER_ACCESS_TTL_MS).toISOString()
    const accessToken = issueAccessToken({
      previewId: payload.previewId,
      grantType: payload.grantType,
      expiresAt,
    })

    console.log('[preview-bootstrap-token] exchanged', {
      tokenHash: tokenHashPrefix,
      previewSessionId: payload.previewId,
      grantType: payload.grantType,
      expiresAt,
    })

    return {
      session,
      accessToken,
      expiresAt,
      grantType: payload.grantType,
    }
  },

  exchangeShareToken(token: string) {
    const tokenHash = hashToken(token)
    const session = Array.from(sessions.values()).find((item) => item.shareTokenHash === tokenHash)
    if (!session || session.status === 'closed' || !session.shareTokenExpiresAt || isExpired(session.shareTokenExpiresAt) || session.shareRevokedAt) {
      return null
    }

    const accessToken = issueAccessToken({
      previewId: session.id,
      grantType: 'share',
      expiresAt: session.shareTokenExpiresAt,
    })
    return {
      session,
      accessToken,
      expiresAt: session.shareTokenExpiresAt,
      grantType: 'share' as const,
    }
  },

  verifyAccessToken(token: string, previewId: string) {
    const payload = parseSignedPreviewToken(token, 'preview-access')
    if (!payload || payload.previewId !== previewId) {
      return null
    }

    const session = sessions.get(payload.previewId)
    if (!session || session.status === 'closed') {
      return null
    }

    if (payload.grantType === 'share') {
      if (!session.shareTokenExpiresAt || isExpired(session.shareTokenExpiresAt)) {
        return null
      }
      if (session.shareRevokedAt && payload.iat <= new Date(session.shareRevokedAt).getTime()) {
        return null
      }
    }

    return {
      session,
      grantType: payload.grantType,
    }
  },

  toDto,
}
