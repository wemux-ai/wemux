// [INPUT]: mesh 路由请求
// [OUTPUT]: 路由结果
// [POS]: executor mesh 路由
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import { createHmac, randomBytes } from 'node:crypto'
import type {
  ExecutorDescriptor,
  ExecutorPresenceSnapshot,
  PreviewAccessRoute,
  TerminalAccessRoute,
  WorkerMeshPeer,
  WorkerMeshStatus,
} from '@shared/types'
import type { PreviewSessionRecord } from './preview-session-record'
import { executorRegistry } from '../control-plane/executor-registry'
import { resolveExecutorMeshEnrollment } from './executor-mesh-service'

const ROUTE_TTL_MS = 60_000
const PREVIEW_MESH_TOKEN_TTL_MS = 5 * 60_000
type ReadyWorkerMeshStatus = WorkerMeshStatus & { meshIpv4: string }

const nowIso = () => new Date().toISOString()

const isFreshIso = (value: string | undefined, ttlMs = ROUTE_TTL_MS) => {
  if (!value) {
    return false
  }

  const time = new Date(value).getTime()
  return Number.isFinite(time) && Date.now() - time <= ttlMs
}

const isMeshReady = (mesh: WorkerMeshStatus | undefined): mesh is ReadyWorkerMeshStatus => (
  Boolean(
    mesh?.enabled
    && mesh.meshIpv4
    && isFreshIso(mesh.reportedAt)
    && (mesh.status === 'ready' || mesh.status === 'degraded'),
  )
)

const shareMeshScope = (source: ExecutorDescriptor, target: ExecutorDescriptor) => {
  if (source.executorId === target.executorId) {
    return true
  }

  const sourceWorkspaceIds = new Set((source.workspaceIds ?? []).map((value) => value.trim()).filter(Boolean))
  const targetWorkspaceIds = (target.workspaceIds ?? []).map((value) => value.trim()).filter(Boolean)
  if (targetWorkspaceIds.some((workspaceId) => sourceWorkspaceIds.has(workspaceId))) {
    return true
  }

  if (source.teamId?.trim() && source.teamId === target.teamId) {
    return true
  }

  return source.ownerUserId === target.ownerUserId
}

const findPeerRoute = (sourceMesh: WorkerMeshStatus | undefined, targetMesh: WorkerMeshStatus | undefined) => {
  const targetNodeIds = new Set([
    targetMesh?.meshNodeId,
    targetMesh?.meshIpv4,
  ].filter(Boolean))

  return (sourceMesh?.peers ?? []).find((peer) => (
    isFreshIso(peer.lastSeenAt)
    && (
      targetNodeIds.has(peer.meshNodeId)
      || (peer.meshIpv4 ? targetNodeIds.has(peer.meshIpv4) : false)
    )
  ))
}

const resolvePeerMode = (peer: WorkerMeshPeer | undefined, targetMesh: WorkerMeshStatus) => {
  if (!peer) {
    return null
  }

  if (peer?.routeMode === 'direct') {
    return 'mesh-direct' as const
  }

  if (peer.routeMode === 'relayed' || targetMesh.routeMode === 'relayed') {
    return 'mesh-relayed' as const
  }

  return null
}

type MeshPreviewAccessTokenPayload = {
  kind: 'preview-mesh-access'
  previewSessionId: string
  workspaceId: string
  executorId: string
  sourceExecutorId?: string
  exp: number
  iat: number
  nonce: string
}

type MeshTerminalAccessTokenPayload = {
  kind: 'terminal-mesh-access'
  workspaceId: string
  terminalId: string
  executorId: string
  sourceExecutorId?: string
  exp: number
  iat: number
  nonce: string
}

const issueMeshPreviewAccessToken = (params: {
  session: PreviewSessionRecord
  targetExecutorId: string
  sourceExecutorId?: string
  secret: string
}) => {
  const issuedAt = Date.now()
  const payload: MeshPreviewAccessTokenPayload = {
    kind: 'preview-mesh-access',
    previewSessionId: params.session.id,
    workspaceId: params.session.workspaceId,
    executorId: params.targetExecutorId,
    sourceExecutorId: params.sourceExecutorId,
    exp: issuedAt + PREVIEW_MESH_TOKEN_TTL_MS,
    iat: issuedAt,
    nonce: randomBytes(12).toString('base64url'),
  }
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url')
  const signature = createHmac('sha256', params.secret).update(encoded).digest('base64url')
  return {
    token: `${encoded}.${signature}`,
    expiresAt: new Date(payload.exp).toISOString(),
  }
}

const issueMeshTerminalAccessToken = (params: {
  workspaceId: string
  terminalId: string
  targetExecutorId: string
  sourceExecutorId?: string
  secret: string
}) => {
  const issuedAt = Date.now()
  const payload: MeshTerminalAccessTokenPayload = {
    kind: 'terminal-mesh-access',
    workspaceId: params.workspaceId,
    terminalId: params.terminalId,
    executorId: params.targetExecutorId,
    sourceExecutorId: params.sourceExecutorId,
    exp: issuedAt + PREVIEW_MESH_TOKEN_TTL_MS,
    iat: issuedAt,
    nonce: randomBytes(12).toString('base64url'),
  }
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url')
  const signature = createHmac('sha256', params.secret).update(encoded).digest('base64url')
  return {
    token: `${encoded}.${signature}`,
    expiresAt: new Date(payload.exp).toISOString(),
  }
}

const buildMeshPreviewProxyUrl = (params: {
  meshIpv4: string
  port: number
  previewSessionId: string
  basePath?: string
  token: string
}) => {
  const basePath = params.basePath?.trim() || '/'
  const normalizedPath = basePath.startsWith('/') ? basePath : `/${basePath}`
  const proxyPath = `/api/preview-mesh/http/${encodeURIComponent(params.previewSessionId)}${normalizedPath}`
  const url = new URL(`http://${params.meshIpv4}:${params.port}${proxyPath}`)
  url.searchParams.set('vmx_mesh_token', params.token)
  return url.toString()
}

export const resolvePreviewAccessRoute = (params: {
  session: PreviewSessionRecord
  sourceExecutorId?: string
  targetExecutor?: ExecutorDescriptor | null
  targetPresence?: ExecutorPresenceSnapshot | null
  sourceExecutor?: ExecutorDescriptor | null
  sourcePresence?: ExecutorPresenceSnapshot | null
  meshPreviewProxyPort?: number
  targetPreviewProxySecret?: string
  now?: string
}): PreviewAccessRoute => {
  const checkedAt = params.now ?? nowIso()
  const gatewayRoute: PreviewAccessRoute = {
    previewSessionId: params.session.id,
    workspaceId: params.session.workspaceId,
    sourceExecutorId: params.sourceExecutorId,
    targetExecutorId: params.session.executorId,
    mode: 'preview-gateway',
    port: params.session.source.targetPort,
    url: params.session.publicUrl,
    checkedAt,
  }

  if (!params.sourceExecutorId) {
    return gatewayRoute
  }

  const targetExecutor = params.targetExecutor ?? executorRegistry.getExecutor(params.session.executorId)
  const sourceExecutor = params.sourceExecutor ?? executorRegistry.getExecutor(params.sourceExecutorId)
  if (!targetExecutor || !sourceExecutor || !shareMeshScope(sourceExecutor, targetExecutor)) {
    return gatewayRoute
  }

  const targetPresence = params.targetPresence ?? executorRegistry.getPresence(targetExecutor.executorId)
  const sourcePresence = params.sourcePresence ?? executorRegistry.getPresence(sourceExecutor.executorId)
  const targetMesh = targetPresence?.mesh
  const sourceMesh = sourcePresence?.mesh
  if (!isMeshReady(targetMesh) || !isMeshReady(sourceMesh)) {
    return gatewayRoute
  }

  const peer = sourceExecutor.executorId === targetExecutor.executorId
    ? undefined
    : findPeerRoute(sourceMesh, targetMesh)
  const mode = sourceExecutor.executorId === targetExecutor.executorId
    ? 'mesh-direct'
    : resolvePeerMode(peer, targetMesh)
  if (!mode) {
    return gatewayRoute
  }

  const meshPreviewProxyPort = params.meshPreviewProxyPort ?? resolveExecutorMeshEnrollment(targetExecutor)?.previewProxyPort
  const previewProxySecret = params.targetPreviewProxySecret ?? executorRegistry.getPreviewProxySecret(targetExecutor.executorId)
  if (!meshPreviewProxyPort || !previewProxySecret) {
    return gatewayRoute
  }
  const accessToken = issueMeshPreviewAccessToken({
    session: params.session,
    targetExecutorId: targetExecutor.executorId,
    sourceExecutorId: sourceExecutor.executorId,
    secret: previewProxySecret,
  })

  return {
    ...gatewayRoute,
    mode,
    meshIpv4: targetMesh.meshIpv4,
    port: meshPreviewProxyPort,
    url: buildMeshPreviewProxyUrl({
      meshIpv4: targetMesh.meshIpv4,
      port: meshPreviewProxyPort,
      previewSessionId: params.session.id,
      basePath: params.session.source.targetBasePath,
      token: accessToken.token,
    }),
    expiresAt: accessToken.expiresAt,
  }
}

export const resolveTerminalAccessRoute = (params: {
  workspaceId: string
  terminalId: string
  targetExecutorId: string
  sourceExecutorId?: string
  meshPort?: number
  targetExecutor?: ExecutorDescriptor | null
  targetPresence?: ExecutorPresenceSnapshot | null
  sourceExecutor?: ExecutorDescriptor | null
  sourcePresence?: ExecutorPresenceSnapshot | null
  meshTerminalProxyPort?: number
  targetPreviewProxySecret?: string
  now?: string
}): TerminalAccessRoute => {
  const checkedAt = params.now ?? nowIso()
  const fallbackRoute: TerminalAccessRoute = {
    workspaceId: params.workspaceId,
    terminalId: params.terminalId,
    sourceExecutorId: params.sourceExecutorId,
    targetExecutorId: params.targetExecutorId,
    mode: 'control-plane-ws',
    checkedAt,
  }

  if (!params.sourceExecutorId) {
    return fallbackRoute
  }

  const targetExecutor = params.targetExecutor ?? executorRegistry.getExecutor(params.targetExecutorId)
  const sourceExecutor = params.sourceExecutor ?? executorRegistry.getExecutor(params.sourceExecutorId)
  if (!targetExecutor || !sourceExecutor || !shareMeshScope(sourceExecutor, targetExecutor)) {
    return fallbackRoute
  }

  const targetPresence = params.targetPresence ?? executorRegistry.getPresence(targetExecutor.executorId)
  const sourcePresence = params.sourcePresence ?? executorRegistry.getPresence(sourceExecutor.executorId)
  const targetMesh = targetPresence?.mesh
  const sourceMesh = sourcePresence?.mesh
  if (!isMeshReady(targetMesh) || !isMeshReady(sourceMesh)) {
    return fallbackRoute
  }

  const peer = sourceExecutor.executorId === targetExecutor.executorId
    ? undefined
    : findPeerRoute(sourceMesh, targetMesh)
  const mode = sourceExecutor.executorId === targetExecutor.executorId
    ? 'mesh-direct'
    : resolvePeerMode(peer, targetMesh)
  if (!mode) {
    return fallbackRoute
  }

  const meshTerminalProxyPort = params.meshTerminalProxyPort ?? params.meshPort ?? resolveExecutorMeshEnrollment(targetExecutor)?.terminalProxyPort
  const previewProxySecret = params.targetPreviewProxySecret ?? executorRegistry.getPreviewProxySecret(targetExecutor.executorId)
  if (!meshTerminalProxyPort || !previewProxySecret) {
    return fallbackRoute
  }
  const accessToken = issueMeshTerminalAccessToken({
    workspaceId: params.workspaceId,
    terminalId: params.terminalId,
    targetExecutorId: targetExecutor.executorId,
    sourceExecutorId: sourceExecutor.executorId,
    secret: previewProxySecret,
  })
  const url = new URL(`ws://${targetMesh.meshIpv4}:${meshTerminalProxyPort}/api/terminal-mesh/ws`)
  url.searchParams.set('vmx_mesh_token', accessToken.token)

  return {
    ...fallbackRoute,
    mode,
    meshIpv4: targetMesh.meshIpv4,
    port: meshTerminalProxyPort,
    url: url.toString(),
    expiresAt: accessToken.expiresAt,
  }
}
