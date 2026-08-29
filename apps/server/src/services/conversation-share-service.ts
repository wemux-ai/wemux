import { createHash, randomBytes } from 'node:crypto'
import { getMainChatSessionById, getWorkspaceSessionById, listTaskWorkspaceBindings, setMainChatSessionVisibility as setMainChatSessionVisibilityInStore } from '../storage/app-state-store'
import { getWorkspace } from '../storage/distributed-task-store'
import {
  getConversation,
  getShare,
  getShareByTokenHash,
  listSharesBySource,
  listSharesByTarget,
  saveConversation,
  saveConversationShare,
  type ConversationRecord,
  type ConversationSharePermission,
  type ConversationShareRecord,
  type ConversationShareSourceKind,
  type ConversationShareTargetType,
  type ConversationVisibility,
} from '../storage/conversation-store'
import type { MainChatSession, WorkspaceSession } from '@shared/types'

const nowIso = () => new Date().toISOString()

const hashToken = (value: string) => createHash('sha256').update(value).digest('hex')

const issueOpaqueToken = () => randomBytes(24).toString('base64url')

const isShareActive = (share: ConversationShareRecord, now: string) => {
  if (share.revokedAt) {
    return false
  }
  if (share.expiresAt && share.expiresAt <= now) {
    return false
  }
  return true
}

export type ShareSessionResult =
  | { ok: true, share: ConversationShareRecord }
  | { ok: false, status: 403 | 404, message: string }

const findExistingShare = (
  sourceKind: ConversationShareSourceKind,
  sourceId: string,
  targetType: ConversationShareTargetType,
  targetId?: string,
) => {
  return listSharesBySource(sourceKind, sourceId).find((share) => (
    share.targetType === targetType && share.targetId === targetId
  ))
}

const sourceExists = (sourceKind: ConversationShareSourceKind, sourceId: string) => {
  if (sourceKind === 'conversation') {
    return !!getConversation(sourceId)
  }
  if (sourceKind === 'workspace_session') {
    return !!getWorkspaceSessionById(sourceId)
  }
  return !!getMainChatSessionById(sourceId)
}

export const shareSession = (params: {
  sourceKind: ConversationShareSourceKind
  sourceId: string
  workspaceId?: string
  targetType: 'user' | 'agent'
  targetId: string
  permission?: ConversationSharePermission
  createdBy: string
}): ShareSessionResult => {
  if (!sourceExists(params.sourceKind, params.sourceId)) {
    return { ok: false, status: 404, message: '会话不存在。' }
  }

  const timestamp = nowIso()
  const existing = findExistingShare(params.sourceKind, params.sourceId, params.targetType, params.targetId)
  const share: ConversationShareRecord = existing
    ? {
        ...existing,
        permission: params.permission ?? existing.permission,
        revokedAt: undefined,
        updatedAt: timestamp,
      }
    : {
        id: crypto.randomUUID(),
        sourceKind: params.sourceKind,
        sourceId: params.sourceId,
        workspaceId: params.workspaceId,
        targetType: params.targetType,
        targetId: params.targetId,
        permission: params.permission ?? 'read',
        createdBy: params.createdBy,
        createdAt: timestamp,
        updatedAt: timestamp,
      }

  saveConversationShare(share)
  return { ok: true, share }
}

export const forwardSessions = (params: {
  sources: Array<{ sourceKind: ConversationShareSourceKind, sourceId: string, workspaceId?: string }>
  targets: Array<{ targetType: 'user' | 'agent', targetId: string }>
  permission?: ConversationSharePermission
  createdBy: string
}) => {
  const results: ShareSessionResult[] = []
  for (const source of params.sources) {
    for (const target of params.targets) {
      results.push(shareSession({
        sourceKind: source.sourceKind,
        sourceId: source.sourceId,
        workspaceId: source.workspaceId,
        targetType: target.targetType,
        targetId: target.targetId,
        permission: params.permission,
        createdBy: params.createdBy,
      }))
    }
  }
  return results
}

export type IssueShareLinkResult =
  | { ok: true, share: ConversationShareRecord, token: string }
  | { ok: false, status: 403 | 404, message: string }

export const issueShareLink = (params: {
  sourceKind: ConversationShareSourceKind
  sourceId: string
  workspaceId?: string
  permission?: ConversationSharePermission
  createdBy: string
  expiresInMinutes?: number
}): IssueShareLinkResult => {
  if (params.sourceKind === 'workspace_session') {
    return { ok: false, status: 403, message: '工作区会话暂不支持生成嵌入链接，请使用复制链接或转发。' }
  }

  if (!sourceExists(params.sourceKind, params.sourceId)) {
    return { ok: false, status: 404, message: '会话不存在。' }
  }

  const timestamp = nowIso()
  const token = issueOpaqueToken()
  const existing = findExistingShare(params.sourceKind, params.sourceId, 'link', undefined)
  const expiresAt = params.expiresInMinutes
    ? new Date(Date.now() + params.expiresInMinutes * 60_000).toISOString()
    : undefined

  const share: ConversationShareRecord = {
    id: existing?.id ?? crypto.randomUUID(),
    sourceKind: params.sourceKind,
    sourceId: params.sourceId,
    workspaceId: params.workspaceId ?? existing?.workspaceId,
    targetType: 'link',
    targetId: undefined,
    permission: params.permission ?? existing?.permission ?? 'read',
    shareTokenHash: hashToken(token),
    createdBy: params.createdBy,
    createdAt: existing?.createdAt ?? timestamp,
    updatedAt: timestamp,
    revokedAt: undefined,
    expiresAt,
  }

  saveConversationShare(share)
  return { ok: true, share, token }
}

export const revokeShare = (shareId: string): ShareSessionResult => {
  const share = getShare(shareId)
  if (!share) {
    return { ok: false, status: 404, message: '分享不存在。' }
  }

  const nextShare: ConversationShareRecord = { ...share, revokedAt: nowIso(), updatedAt: nowIso() }
  saveConversationShare(nextShare)
  return { ok: true, share: nextShare }
}

export const listSharesForSource = (sourceKind: ConversationShareSourceKind, sourceId: string) => {
  const now = nowIso()
  return listSharesBySource(sourceKind, sourceId).filter((share) => isShareActive(share, now))
}

export type SharedWithViewerEntry =
  | { share: ConversationShareRecord, sourceKind: 'conversation', conversation: ConversationRecord }
  | { share: ConversationShareRecord, sourceKind: 'main_chat', mainChatSession: MainChatSession }
  | { share: ConversationShareRecord, sourceKind: 'workspace_session', workspaceSession: WorkspaceSession, workspaceId: string, projectId: string, taskId: string | null }

export const listSharedWithViewer = (targetType: 'user' | 'agent', targetId: string): SharedWithViewerEntry[] => {
  const now = nowIso()
  const entries: SharedWithViewerEntry[] = []
  for (const share of listSharesByTarget(targetType, targetId)) {
    if (!isShareActive(share, now)) {
      continue
    }
    if (share.sourceKind === 'conversation') {
      const conversation = getConversation(share.sourceId)
      if (conversation) {
        entries.push({ share, sourceKind: 'conversation', conversation })
      }
      continue
    }
    if (share.sourceKind === 'workspace_session') {
      const workspaceSession = getWorkspaceSessionById(share.sourceId)
      if (!workspaceSession) {
        continue
      }
      const workspace = getWorkspace(workspaceSession.workspaceId)
      const binding = listTaskWorkspaceBindings().find((item) => item.workspaceId === workspaceSession.workspaceId && item.status === 'active') ?? null
      entries.push({
        share,
        sourceKind: 'workspace_session',
        workspaceSession,
        workspaceId: workspaceSession.workspaceId,
        projectId: workspace?.projectId ?? '',
        taskId: binding?.taskId ?? null,
      })
      continue
    }
    const mainChatSession = getMainChatSessionById(share.sourceId)
    if (mainChatSession) {
      entries.push({ share, sourceKind: 'main_chat', mainChatSession })
    }
  }
  return entries
}

export type ResolveShareTokenResult =
  | { ok: true, share: ConversationShareRecord, sourceKind: 'conversation', conversation: ConversationRecord }
  | { ok: true, share: ConversationShareRecord, sourceKind: 'main_chat', mainChatSession: MainChatSession }
  | { ok: false, status: 403 | 404, message: string }

export const resolveShareToken = (token: string): ResolveShareTokenResult => {
  const share = getShareByTokenHash(hashToken(token))
  if (!share || !isShareActive(share, nowIso())) {
    return { ok: false, status: 404, message: '分享链接不存在或已失效。' }
  }

  if (share.sourceKind === 'main_chat') {
    const mainChatSession = getMainChatSessionById(share.sourceId)
    if (!mainChatSession) {
      return { ok: false, status: 404, message: '会话不存在。' }
    }
    return { ok: true, share, sourceKind: 'main_chat', mainChatSession }
  }

  const conversation = getConversation(share.sourceId)
  if (!conversation) {
    return { ok: false, status: 404, message: '会话不存在。' }
  }

  return { ok: true, share, sourceKind: 'conversation', conversation }
}

export const setConversationVisibility = (conversationId: string, visibility: ConversationVisibility) => {
  const conversation = getConversation(conversationId)
  if (!conversation) {
    return null
  }

  const next: ConversationRecord = { ...conversation, visibility, updatedAt: nowIso() }
  saveConversation(next)
  return next
}

export const setMainChatSessionVisibility = (sessionId: string, visibility: 'public' | 'private') => {
  return setMainChatSessionVisibilityInStore(sessionId, visibility)
}
