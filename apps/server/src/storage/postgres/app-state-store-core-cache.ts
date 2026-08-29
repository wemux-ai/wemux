import { createAdapters, createExecutionCenter } from '@shared/task-orchestrator'
import type { AppDomainState, AppResources, AppState, AppUiState, TaskRun } from '@shared/types'
import { cloneJson } from './helpers'
import { initialServerState } from './app-state-seed'

export const sortTaskRunsDesc = (left: TaskRun, right: TaskRun) => right.createdAt.localeCompare(left.createdAt)

export const domainStateCache: AppDomainState = cloneJson({
  projects: initialServerState.projects,
  tasks: initialServerState.tasks,
  nodes: initialServerState.nodes,
  projectBindings: initialServerState.projectBindings,
  distributedTasks: initialServerState.distributedTasks,
  taskWorkspaceBindings: initialServerState.taskWorkspaceBindings,
  workspaceSessions: initialServerState.workspaceSessions,
})

export const uiStateCache: AppUiState = cloneJson({
  mainChatSessions: initialServerState.mainChatSessions,
  selectedMainChatSessionId: initialServerState.selectedMainChatSessionId,
  selectedProjectId: initialServerState.selectedProjectId,
  selectedTaskId: initialServerState.selectedTaskId,
  filters: initialServerState.filters,
  config: initialServerState.config,
  adapters: initialServerState.adapters,
  executionCenter: initialServerState.executionCenter,
})

export const metaCache = new Map<string, unknown>()
export const taskRunCache = new Map<string, TaskRun>()

export const defaultMetaState: AppUiState = {
  mainChatSessions: initialServerState.mainChatSessions,
  selectedMainChatSessionId: initialServerState.selectedMainChatSessionId,
  config: initialServerState.config,
  filters: initialServerState.filters,
  selectedProjectId: initialServerState.selectedProjectId,
  selectedTaskId: initialServerState.selectedTaskId,
  adapters: createAdapters(),
  executionCenter: createExecutionCenter(initialServerState.tasks),
}

export const composeState = (): AppState => ({
  ...cloneJson(domainStateCache),
  ...cloneJson(uiStateCache),
})

export const getStateResources = (): AppResources => {
  const state = composeState()
  return {
    projects: state.projects,
    tasks: state.tasks,
    nodes: state.nodes,
    projectBindings: state.projectBindings,
    distributedTasks: state.distributedTasks,
    taskWorkspaceBindings: state.taskWorkspaceBindings,
    workspaceSessions: state.workspaceSessions,
    mainChatSessions: state.mainChatSessions,
  }
}
