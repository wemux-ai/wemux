// [INPUT]: 作用域输入
// [OUTPUT]: 作用域校验
// [POS]: workspace 作用域
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

export type ResourceScopeType = 'user' | 'workspace'

export interface ResourceScopeRef {
  scopeType: ResourceScopeType
  scopeId: string
}

export type WorkspaceResourceVisibility = 'private' | 'workspace'

/**
 * 资源在组织上下文中的统一可见性判断（模型库 / Skill / MCP 共用）。
 *
 * 语义（组织优先）：
 * 1. 系统级资源（无 owner / 系统托管）→ 全局可见。
 * 2. 用户自己的资源（私有或共享）→ 自己始终可见。
 * 3. workspace 共享 → 必须归属当前 workspace（workspaceId 匹配）。
 * 4. 其余（非自己、非当前 workspace 共享）→ 不可见。
 */
export const isWorkspaceResourceVisible = (
  resource: {
    visibility?: string | null
    workspaceId?: string | null
    ownerUserId?: string | null
    managedBySystem?: boolean
  },
  scope: {
    userId: string
    workspaceId?: string
  },
) => {
  const ownerUserId = resource.ownerUserId?.trim()
  if (!ownerUserId || resource.managedBySystem === true) {
    return true
  }

  const userId = scope.userId.trim()
  if (ownerUserId === userId) {
    return true
  }

  const visibility = resource.visibility ?? 'private'
  if (visibility !== 'workspace') {
    return false
  }

  const workspaceId = resource.workspaceId?.trim()
  return Boolean(workspaceId && scope.workspaceId?.trim() === workspaceId)
}
