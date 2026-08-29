// [INPUT]: 工作区选择器输入
// [OUTPUT]: 选择器
// [POS]: 工作区路由选择器
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import { sortWorkspaceSessions } from '@shared/task-workspace'
import type {
  AppState,
  Project,
  ProjectBinding,
  Task,
  TaskWorkspaceBinding,
  WorkspaceSession,
} from '@shared/types'
import type { WorkspaceRouteSearch } from './-workspace-route-shared'

export type WorkspaceRouteIndexes = {
  activeTaskBindingByWorkspaceId: Map<string, TaskWorkspaceBinding>
  projectBindingByProjectAndExecutor: Map<string, ProjectBinding>
  projectsById: Map<string, Project>
  tasksById: Map<string, Task>
  tasksByProjectId: Map<string, Task[]>
  workspaceSessionsByWorkspaceId: Map<string, WorkspaceSession[]>
}

const buildProjectExecutorKey = (projectId: string, executorId: string) => `${projectId}::${executorId}`

export const buildWorkspaceRouteIndexes = (state: AppState): WorkspaceRouteIndexes => {
  const tasksById = new Map<string, Task>()
  const tasksByProjectId = new Map<string, Task[]>()
  for (const task of state.tasks) {
    tasksById.set(task.id, task)
    const projectTasks = tasksByProjectId.get(task.projectId)
    if (projectTasks) {
      projectTasks.push(task)
    } else {
      tasksByProjectId.set(task.projectId, [task])
    }
  }

  const projectsById = new Map<string, Project>()
  for (const project of state.projects) {
    projectsById.set(project.id, project)
  }

  const activeTaskBindingByWorkspaceId = new Map<string, TaskWorkspaceBinding>()
  for (const binding of state.taskWorkspaceBindings) {
    if (binding.status === 'active') {
      activeTaskBindingByWorkspaceId.set(binding.workspaceId, binding)
    }
  }

  const workspaceSessionsByWorkspaceId = new Map<string, WorkspaceSession[]>()
  for (const workspaceSession of state.workspaceSessions) {
    const workspaceSessions = workspaceSessionsByWorkspaceId.get(workspaceSession.workspaceId)
    if (workspaceSessions) {
      workspaceSessions.push(workspaceSession)
    } else {
      workspaceSessionsByWorkspaceId.set(workspaceSession.workspaceId, [workspaceSession])
    }
  }
  for (const [workspaceId, workspaceSessions] of workspaceSessionsByWorkspaceId) {
    workspaceSessionsByWorkspaceId.set(workspaceId, sortWorkspaceSessions(workspaceSessions))
  }

  const projectBindingByProjectAndExecutor = new Map<string, ProjectBinding>()
  for (const binding of state.projectBindings) {
    if (binding.isActive) {
      projectBindingByProjectAndExecutor.set(buildProjectExecutorKey(binding.projectId, binding.nodeId), binding)
    }
  }

  return {
    activeTaskBindingByWorkspaceId,
    projectBindingByProjectAndExecutor,
    projectsById,
    tasksById,
    tasksByProjectId,
    workspaceSessionsByWorkspaceId,
  }
}

export const selectWorkspaceRouteTask = (
  indexes: WorkspaceRouteIndexes,
  search: Pick<WorkspaceRouteSearch, 'taskId'>,
) => {
  return search.taskId ? indexes.tasksById.get(search.taskId) ?? null : null
}

export const selectWorkspaceRouteProject = (
  indexes: WorkspaceRouteIndexes,
  search: Pick<WorkspaceRouteSearch, 'projectId'>,
  task: Task | null,
) => {
  const projectId = search.projectId || task?.projectId
  return projectId ? indexes.projectsById.get(projectId) ?? null : null
}

export const selectWorkspaceSessionsForWorkspace = (
  indexes: WorkspaceRouteIndexes,
  workspaceId?: string,
) => {
  return workspaceId ? indexes.workspaceSessionsByWorkspaceId.get(workspaceId) ?? [] : []
}

export const selectFallbackWorkspaceSession = (
  indexes: WorkspaceRouteIndexes,
  workspaceId?: string,
  workspaceSessionId?: string,
) => {
  const workspaceSessions = selectWorkspaceSessionsForWorkspace(indexes, workspaceId)
  if (workspaceSessionId) {
    return workspaceSessions.find((item) => item.id === workspaceSessionId) ?? workspaceSessions[0] ?? null
  }
  return workspaceSessions[0] ?? null
}

export const selectWorkspaceTask = (
  indexes: WorkspaceRouteIndexes,
  params: {
    fallbackTask: Task | null
    project: Project | null
    workspaceId?: string
  },
) => {
  if (!params.workspaceId || !params.project) {
    return null
  }

  const linkedTaskId = indexes.activeTaskBindingByWorkspaceId.get(params.workspaceId)?.taskId
  if (linkedTaskId) {
    const linkedTask = indexes.tasksById.get(linkedTaskId)
    if (linkedTask?.projectId === params.project.id) {
      return linkedTask
    }
  }

  if (params.fallbackTask?.projectId === params.project.id) {
    return params.fallbackTask
  }

  return indexes.tasksByProjectId.get(params.project.id)?.[0] ?? null
}

export const selectProjectBindingPathHint = (
  indexes: WorkspaceRouteIndexes,
  projectId?: string,
  executorId?: string,
) => {
  if (!projectId || !executorId) {
    return undefined
  }

  return indexes.projectBindingByProjectAndExecutor.get(buildProjectExecutorKey(projectId, executorId))?.pathHint
}
