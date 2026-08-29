import type { AppState, Task, TaskWorkspaceBinding, WorkspaceSession } from '@shared/types'
import { getProjectRuntimeSummary, isTaskAwaitingConfirmation } from './runtime-status'
import { getWorkspaceSessionDisplayStatus } from './workspace-session-status'

export type DashboardPendingApprovalItem = {
  id: string
  source: 'task' | 'workspaceSession'
  taskId: string
  taskTitle: string
  workspaceId?: string
  workspaceSessionId?: string
  workspaceSessionTitle?: string
  currentStep: string
  updatedAt: string
}

export const getSelectedProject = (state: AppState, selectedProjectId: string) => {
  return state.projects.find((project) => project.id === selectedProjectId) ?? state.projects[0] ?? null
}

/**
 * 按协作组织过滤任务：项目归属当前 workspace（或无 workspace 归属的老数据全局项目）才计入。
 * 不传 workspaceId 时返回全部（兼容老数据与无空间上下文）。
 */
export const filterTasksForCollaborationWorkspace = (state: AppState, workspaceId?: string) => {
  const normalizedWorkspaceId = workspaceId?.trim()
  if (!normalizedWorkspaceId) {
    return state.tasks
  }

  const workspaceProjectIds = new Set(state.projects
    .filter((project) => !project.workspaceId?.trim() || project.workspaceId?.trim() === normalizedWorkspaceId)
    .map((project) => project.id))
  return state.tasks.filter((task) => workspaceProjectIds.has(task.projectId))
}

export const getDashboardMetrics = (state: AppState, workspaceId?: string) => {
  const tasks = filterTasksForCollaborationWorkspace(state, workspaceId)
  const inProgressTaskCount = tasks.filter((task) => task.status === 'in_progress').length
  const runtimeSummary = Array.from(new Set(tasks.map((task) => task.projectId))).reduce(
    (summary, currentProjectId) => {
      const projectSummary = getProjectRuntimeSummary({
        projectId: currentProjectId,
        tasks: tasks,
        taskWorkspaceBindings: state.taskWorkspaceBindings,
        workspaceSessions: state.workspaceSessions,
      })

      return {
        runningCount: summary.runningCount + projectSummary.runningCount,
        attentionCount: summary.attentionCount + projectSummary.attentionCount,
      }
    },
    { runningCount: 0, attentionCount: 0 },
  )

  return {
    total: tasks.length,
    activeAgents: runtimeSummary.runningCount,
    inProgressTasks: inProgressTaskCount,
    pendingApprovals: runtimeSummary.attentionCount,
    done: tasks.filter((task) => task.status === 'done').length,
    retries: tasks.reduce((sum, task) => sum + task.retryCount, 0),
  }
}

const resolveWorkspaceSessionTask = (params: {
  session: WorkspaceSession
  taskById: Map<string, Task>
  activeBindingsByWorkspaceId: Map<string, TaskWorkspaceBinding[]>
}) => {
  const binding = params.activeBindingsByWorkspaceId.get(params.session.workspaceId)?.[0]

  if (!binding) {
    return null
  }

  return params.taskById.get(binding.taskId) ?? null
}

export const getDashboardPendingApprovalItems = (state: AppState, projectId?: string | null): DashboardPendingApprovalItem[] => {
  const taskById = new Map(state.tasks.map((task) => [task.id, task]))
  const activeBindings = state.taskWorkspaceBindings.filter((binding) => binding.status === 'active')
  const activeBindingsByWorkspaceId = new Map<string, TaskWorkspaceBinding[]>()
  const coveredTaskIds = new Set<string>()
  const items: DashboardPendingApprovalItem[] = []

  for (const binding of activeBindings) {
    const existing = activeBindingsByWorkspaceId.get(binding.workspaceId)
    if (existing) {
      existing.push(binding)
      continue
    }

    activeBindingsByWorkspaceId.set(binding.workspaceId, [binding])
  }

  for (const session of state.workspaceSessions) {
    if (session.status !== 'active') {
      continue
    }

    const task = resolveWorkspaceSessionTask({
      session,
      taskById,
      activeBindingsByWorkspaceId,
    })
    if (!task || (projectId && task.projectId !== projectId)) {
      continue
    }

    coveredTaskIds.add(task.id)
    if (getWorkspaceSessionDisplayStatus(session) !== 'attention') {
      continue
    }

    items.push({
      id: `workspace-session:${session.id}`,
      source: 'workspaceSession',
      taskId: task.id,
      taskTitle: task.title,
      workspaceId: session.workspaceId,
      workspaceSessionId: session.id,
      workspaceSessionTitle: session.title,
      currentStep: session.currentStep.trim() || task.currentStep.trim(),
      updatedAt: session.updatedAt,
    })
  }

  for (const task of state.tasks) {
    if (projectId && task.projectId !== projectId) {
      continue
    }

    if (coveredTaskIds.has(task.id) || !isTaskAwaitingConfirmation(task)) {
      continue
    }

    items.push({
      id: `task:${task.id}`,
      source: 'task',
      taskId: task.id,
      taskTitle: task.title,
      currentStep: task.currentStep.trim(),
      updatedAt: task.updatedAt,
    })
  }

  return items.sort((left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime())
}

export const getFilteredTasks = (state: AppState, projectId: string) => {
  return state.tasks.filter((task) => {
    if (task.projectId !== projectId) return false
    if (state.filters.status !== 'all' && task.status !== state.filters.status) return false
    if (state.filters.agent !== 'all' && task.agentType !== state.filters.agent) return false
    return true
  })
}
