// [INPUT]: 访问请求
// [OUTPUT]: 授权判定
// [POS]: 项目工作区管理访问
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import type { Project, WorkspaceRecord, WorkspaceRole } from '@shared/types'
import { getWorkspaceMemberRole } from '../repositories/workspace'

type WorkspaceRoleResolver = (workspaceId: string, userId: string) => Promise<WorkspaceRole | null>

export const canWorkspaceRoleManageProjectWorkspace = (role: WorkspaceRole | null | undefined) => (
  role === 'owner' || role === 'admin'
)

export const getProjectWorkspaceManagementDeniedMessage = (action: 'archive' | 'restore' | 'delete') => {
  switch (action) {
    case 'archive':
      return '只有工作区创建者或所属组织的所有者/管理员才能归档工作区。'
    case 'restore':
      return '只有工作区创建者或所属组织的所有者/管理员才能恢复工作区。'
    case 'delete':
      return '只有工作区创建者或所属组织的所有者/管理员才能删除工作区。'
  }
}

export const canUserManageProjectWorkspace = async (params: {
  userId: string
  project: Pick<Project, 'workspaceId'>
  workspace: Pick<WorkspaceRecord, 'ownerUserId'>
  resolveWorkspaceRole?: WorkspaceRoleResolver
}) => {
  const userId = params.userId.trim()
  const workspaceOwnerUserId = params.workspace.ownerUserId?.trim()
  if (workspaceOwnerUserId && workspaceOwnerUserId === userId) {
    return true
  }

  const projectWorkspaceId = params.project.workspaceId?.trim()
  if (projectWorkspaceId) {
    const resolveWorkspaceRole = params.resolveWorkspaceRole ?? getWorkspaceMemberRole
    const role = await resolveWorkspaceRole(projectWorkspaceId, userId)
    if (canWorkspaceRoleManageProjectWorkspace(role)) {
      return true
    }
  }

  return !workspaceOwnerUserId && !projectWorkspaceId
}
