/**
 * [INPUT]: Project/workspace IDs and task assignment records.
 * [OUTPUT]: Cached collaboration catalogs and canonical human/Agent assignee option IDs, including legacy Squad fallback.
 * [POS]: Web collaboration data adapter shared by Kanban list, cards, and task detail.
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */
import { api, type ProjectAssignee } from './api'
import type { Task } from '@shared/types'
import { createCachedRequestLoader } from './request-cache'

const PROJECT_COLLABORATION_CACHE_TTL_MS = 30_000

const teamProjectLoaders = new Map<string, ReturnType<typeof createCachedRequestLoader<Awaited<ReturnType<typeof api.getTeamProjects>>['projects']>>>()
const projectAssigneeLoaders = new Map<string, ReturnType<typeof createCachedRequestLoader<ProjectAssignee[]>>>()

const normalizeId = (value?: string | null) => value?.trim() || ''

export const getTaskAssigneeOptionId = (task: Pick<Task, 'assigneeId' | 'assigneeAgentId' | 'assigneeAgentGroupId'>) => (
  task.assigneeAgentId
    ? `agent:${task.assigneeAgentId}`
    : task.assigneeId
)

export const loadWorkspaceScopedTeamProjects = (workspaceId: string) => {
  const normalizedWorkspaceId = normalizeId(workspaceId)
  if (!normalizedWorkspaceId) {
    return Promise.resolve([] as Awaited<ReturnType<typeof api.getTeamProjects>>['projects'])
  }

  const existingLoader = teamProjectLoaders.get(normalizedWorkspaceId)
  if (existingLoader) {
    return existingLoader()
  }

  const loader = createCachedRequestLoader({
    ttlMs: PROJECT_COLLABORATION_CACHE_TTL_MS,
    load: async () => {
      const response = await api.getTeamProjects(normalizedWorkspaceId)
      return response.projects
    },
  })
  teamProjectLoaders.set(normalizedWorkspaceId, loader)
  return loader()
}

export const loadProjectAssignees = (projectId: string, options?: { force?: boolean }) => {
  const normalizedProjectId = normalizeId(projectId)
  if (!normalizedProjectId) {
    return Promise.resolve([] as ProjectAssignee[])
  }

  const existingLoader = projectAssigneeLoaders.get(normalizedProjectId)
  if (existingLoader) {
    return existingLoader(options)
  }

  const loader = createCachedRequestLoader({
    ttlMs: PROJECT_COLLABORATION_CACHE_TTL_MS,
    load: async () => {
      const response = await api.getProjectAssignees(normalizedProjectId)
      return response.assignees
    },
  })
  projectAssigneeLoaders.set(normalizedProjectId, loader)
  return loader(options)
}

export const invalidateProjectAssigneeCatalog = () => {
  projectAssigneeLoaders.clear()
}
