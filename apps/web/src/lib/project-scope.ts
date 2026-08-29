import type { Project } from '@shared/types'

const normalizeProjectWorkspaceId = (workspaceId?: string | null) => workspaceId?.trim() || ''

export const resolveProjectScopeKind = (
  project: Pick<Project, 'workspaceId' | 'visibility'>,
): 'workspace' | 'private' => {
  if (normalizeProjectWorkspaceId(project.workspaceId) || project.visibility === 'workspace') {
    return 'workspace'
  }

  return 'private'
}

export interface PartitionedProjectsByScope<T> {
  workspaceProjects: T[]
  privateProjects: T[]
  /** 个人项目中 createdBy 不是当前用户的：被 owner 拉入的私有项目 */
  sharedWithMeProjects: T[]
}

export const partitionProjectsByScope = <T extends Pick<Project, 'workspaceId' | 'visibility' | 'createdById'>>(
  projects: readonly T[],
  options?: {
    currentUserId?: string | null
  },
): PartitionedProjectsByScope<T> => {
  const workspaceProjects: T[] = []
  const privateProjects: T[] = []
  const sharedWithMeProjects: T[] = []
  const currentUserId = options?.currentUserId?.trim() || ''

  for (const project of projects) {
    if (resolveProjectScopeKind(project) === 'workspace') {
      workspaceProjects.push(project)
      continue
    }

    const createdById = project.createdById?.trim() || ''
    if (currentUserId && createdById && createdById !== currentUserId) {
      sharedWithMeProjects.push(project)
      continue
    }

    privateProjects.push(project)
  }

  return {
    workspaceProjects,
    privateProjects,
    sharedWithMeProjects,
  }
}
