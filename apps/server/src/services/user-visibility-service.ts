/**
 * [INPUT]: 用户对（viewer/target）、目标组织与连接/协作空间事实。
 * [OUTPUT]: 组织范围内用户可见性判定与列表过滤。
 * [POS]: 「飞书式」可见性规则：空间成员 ∪ 本空间已连接好友互见，其余不可见（搜索/私聊/候选）。
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */
import { haveSharedWorkspace, isWorkspaceMember } from '../repositories/workspace'
import { areConnected } from '../storage/postgres/connection-store'

/**
 * viewer 是否能看到 target：自己 / 同协作空间成员 / 已连接好友。
 * 与飞书一致：同一个企业（协作空间）内即使没聊过天也互相可见。
 */
export const canSeeUser = async (viewerId: string, targetUserId: string, workspaceId?: string) => {
  if (!viewerId.trim() || !targetUserId.trim()) return false
  if (viewerId === targetUserId) return true
  const normalizedWorkspaceId = workspaceId?.trim()
  if (normalizedWorkspaceId) {
    const [viewerIsMember, targetIsMember, connected] = await Promise.all([
      isWorkspaceMember(normalizedWorkspaceId, viewerId),
      isWorkspaceMember(normalizedWorkspaceId, targetUserId),
      areConnected(viewerId, targetUserId, normalizedWorkspaceId),
    ])
    return viewerIsMember && (targetIsMember || connected)
  }
  const [shared, connected] = await Promise.all([
    haveSharedWorkspace(viewerId, targetUserId),
    areConnected(viewerId, targetUserId),
  ])
  return shared || connected
}

/** 过滤出 viewer 可见的用户 id 列表。 */
export const filterVisibleUserIds = async (viewerId: string, targetUserIds: string[], workspaceId?: string) => {
  const uniqueIds = [...new Set(targetUserIds.map((id) => id.trim()).filter(Boolean))]
  if (uniqueIds.length === 0) return []
  const visible: string[] = []
  for (const targetId of uniqueIds) {
    if (await canSeeUser(viewerId, targetId, workspaceId)) {
      visible.push(targetId)
    }
  }
  return visible
}
