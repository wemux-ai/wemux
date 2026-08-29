/**
 * [INPUT]: workspace_shares 存储层 + 工作区/会话/用户实体
 * [OUTPUT]: 授权/撤销/列表/对方视角共享列表 + 鉴权解析（读/发消息共用）
 * [POS]: 分享与协作业务层；分享=授权+发链接消息（消息发送在 conversation 链路），协作=仅授权
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */
import type {
  WorkspaceSharePermission,
  WorkspaceShareRecord,
  WorkspaceShareScope,
  WorkspaceShareTargetType,
} from '@shared/types'
import { getWorkspaceById, listUserWorkspaces } from '../repositories/workspace'
import { getAgent } from '../repositories/agent'
import { getUserById } from '../storage/postgres/auth-store'
import { listWorkspaceSessions, loadState } from '../storage/app-state-store'
import { listWorkspaces } from '../storage/distributed-task-store'
import {
  grantWorkspaceShare as grantShareRecord,
  initWorkspaceShareStore,
  listActiveWorkspaceSharesForWorkspace,
  listSharedSessionsForTarget,
  listSharedWorkspacesForTarget as listSharedWorkspacesForTargetRecords,
  listWorkspaceShareRecords,
  resolveWorkspaceShareAccess,
  revokeWorkspaceShare as revokeShareRecord,
} from '../storage/postgres/workspace-share-store'

export type GrantWorkspaceShareInput = {
  workspaceId: string
  scope: WorkspaceShareScope
  sessionId?: string
  targetType: WorkspaceShareTargetType
  targetId: string
  permission: WorkspaceSharePermission
  createdBy: string
}

export type GrantWorkspaceShareResult =
  | { ok: true, share: WorkspaceShareRecord }
  | { ok: false, status: 400 | 403 | 404, message: string }

export const grantWorkspaceShare = async (input: GrantWorkspaceShareInput): Promise<GrantWorkspaceShareResult> => {
  const workspaceId = input.workspaceId.trim()
  if (!workspaceId) {
    return { ok: false, status: 400, message: '缺少工作区。' }
  }

  const workspace = await getWorkspaceById(workspaceId)
  if (!workspace) {
    return { ok: false, status: 404, message: '工作区不存在。' }
  }

  if (input.scope === 'session' && !input.sessionId?.trim()) {
    return { ok: false, status: 400, message: '会话级共享需要指定会话。' }
  }
  if (input.scope !== 'session' && input.sessionId?.trim()) {
    return { ok: false, status: 400, message: '非会话级共享不应携带会话。' }
  }

  const share = await grantShareRecord({
    workspaceId,
    scope: input.scope,
    sessionId: input.scope === 'session' ? input.sessionId?.trim() : undefined,
    targetType: input.targetType,
    targetId: input.targetId.trim(),
    permission: input.permission,
    createdBy: input.createdBy,
  })
  return { ok: true, share }
}

export const revokeWorkspaceShare = async (shareId: string) => {
  return revokeShareRecord(shareId)
}

/** 某工作区生效中的授权（成员可见，用于管理列表） */
export const listWorkspaceShares = (workspaceId: string): WorkspaceShareRecord[] => {
  return listActiveWorkspaceSharesForWorkspace(workspaceId)
}

export type SharedWorkspaceEntry = {
  share: WorkspaceShareRecord
  workspace: {
    id: string
    name: string
    description?: string
    avatarUrl?: string
    ownerUserId: string
  } | null
  sessionTitle?: string
  /** 跳转 /workspace 所需参数（共享协作人视角） */
  route?: {
    projectId?: string
    workspaceId?: string
    workspaceSessionId?: string
  }
}

/** 对方视角：共享给我的工作区（整个工作区/所有会话）与会话级条目 */
export const listSharedWorkspacesForTarget = async (
  targetType: WorkspaceShareTargetType,
  targetId: string,
): Promise<SharedWorkspaceEntry[]> => {
  const workspaceShares = listSharedWorkspacesForTargetRecords(targetType, targetId)
  const sessionShares = listSharedSessionsForTarget(targetType, targetId)
  const entries: SharedWorkspaceEntry[] = []

  for (const share of [...workspaceShares, ...sessionShares]) {
    const workspace = await getWorkspaceById(share.workspaceId)
    const session = share.scope === 'session' && share.sessionId
      ? await resolveSessionTitle(share.sessionId)
      : undefined
    entries.push({
      share,
      workspace: workspace
        ? {
            id: workspace.id,
            name: workspace.name,
            description: workspace.description,
            avatarUrl: workspace.avatarUrl,
            ownerUserId: workspace.ownerUserId,
          }
        : null,
      sessionTitle: session,
      route: await resolveSharedWorkspaceRoute(share),
    })
  }
  return entries
}

/** 解析共享条目可跳转的 /workspace 路由参数（collab workspace → 执行 project/workspace/session） */
const resolveSharedWorkspaceRoute = async (share: WorkspaceShareRecord): Promise<SharedWorkspaceEntry['route']> => {
  if (share.scope === 'session' && share.sessionId) {
    const session = listWorkspaceSessions().find((item) => item.id === share.sessionId)
    if (session) {
      const workspace = listWorkspaces().find((item) => item.id === session.workspaceId)
      return {
        projectId: workspace?.projectId,
        workspaceId: session.workspaceId,
        workspaceSessionId: session.id,
      }
    }
    return undefined
  }

  // 整个工作区/所有会话：找到关联该 collab workspace 的执行工作区（取第一个）
  const state = loadState()
  const projectIds = state.projects
    .filter((item) => item.workspaceId === share.workspaceId)
    .map((item) => item.id)
  const workspace = listWorkspaces().find((item) => projectIds.includes(item.projectId))
  if (!workspace) {
    return undefined
  }
  return {
    projectId: workspace.projectId,
    workspaceId: workspace.id,
  }
}

const resolveSessionTitle = async (sessionId: string): Promise<string | undefined> => {
  const session = listWorkspaceSessions().find((item) => item.id === sessionId)
  return session?.title ?? session?.id
}

/** 用户是否对该工作区有生效授权（鉴权消费方共用） */
export const resolveUserWorkspaceShareAccess = (
  userId: string,
  workspaceId: string,
  sessionId?: string,
) => {
  return resolveWorkspaceShareAccess(userId, workspaceId, sessionId)
}

/** 用户通过共享授权可见的工作区 id 集合（scope=workspace/all_sessions） */
export const listSharedWorkspaceIdsForUser = (userId: string): string[] => {
  const ids = new Set<string>()
  for (const share of listWorkspaceShareRecords()) {
    if (share.targetType === 'user' && share.targetId === userId && !share.revokedAt && share.scope !== 'session') {
      ids.add(share.workspaceId)
    }
  }
  return [...ids]
}

/** 用户通过共享授权可见的会话 id 集合（scope=session） */
export const listSharedSessionIdsForUser = (userId: string): string[] => {
  const ids = new Set<string>()
  for (const share of listWorkspaceShareRecords()) {
    if (share.targetType === 'user' && share.targetId === userId && !share.revokedAt && share.scope === 'session' && share.sessionId) {
      ids.add(share.sessionId)
    }
  }
  return [...ids]
}

/** 校验目标用户是否为真实用户（授权前） */
export const isWorkspaceShareTargetUserValid = (targetId: string) => {
  return Boolean(getUserById(targetId))
}

/** 校验目标 Agent 是否存在 */
export const isWorkspaceShareTargetAgentValid = (targetId: string) => {
  return Boolean(getAgent(targetId))
}

/** 分享目标所在工作区成员（用于「共享给我的」列表里判定当前用户是否可访问） */
export const isUserWorkspaceMember = async (workspaceId: string, userId: string) => {
  const workspaces = await listUserWorkspaces(userId)
  return workspaces.some((workspace) => workspace.id === workspaceId)
}
