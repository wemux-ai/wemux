// [INPUT]: 无（纯类型定义）
// [OUTPUT]: 工作区共享授权领域类型（WorkspaceShareRecord）
// [POS]: workspace_shares 表共享契约；分享=发链接消息+授权，协作=仅授权；scope 区分整个工作区/所有会话/单个会话
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

/** 共享范围：整个工作区 / 工作区所有会话 / 单个会话 */
export type WorkspaceShareScope = 'workspace' | 'all_sessions' | 'session'

/** 权限三档：查看（只读）/ 可编辑（能发消息）/ 可协助（发送 + 管理操作） */
export type WorkspaceSharePermission = 'read' | 'edit' | 'collaborate'

export type WorkspaceShareTargetType = 'user' | 'agent'

export interface WorkspaceShareRecord {
  id: string
  workspaceId: string
  scope: WorkspaceShareScope
  /** scope='session' 时指定会话 id；其余范围为空 */
  sessionId?: string
  targetType: WorkspaceShareTargetType
  targetId: string
  permission: WorkspaceSharePermission
  createdBy: string
  createdAt: string
  updatedAt: string
  revokedAt?: string
}

export const WORKSPACE_SHARE_PERMISSIONS: readonly WorkspaceSharePermission[] = ['read', 'edit', 'collaborate']

export const WORKSPACE_SHARE_SCOPES: readonly WorkspaceShareScope[] = ['workspace', 'all_sessions', 'session']
