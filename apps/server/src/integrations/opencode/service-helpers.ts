import { existsSync } from 'node:fs'
import type { WorkspaceTaskExecutionView } from '@shared/task-workspace'
import type { AgentConfig, Project, Task, TaskRuntimeGitIdentity } from '@shared/types'
import { resolveTaskWorktreePath } from '@shared/workspace-paths'
import { resolveProjectExecutionPath } from '../../cluster/project-workspace'
import { executorRegistry } from '../../control-plane/executor-registry'
import { logOpenCodeDebug } from './core'

export const isInteractiveQuestionTool = (toolName: string) => ['question', 'AskUserQuestion'].includes(toolName)

export const hasWorkspaceRuntime = (task: Task | WorkspaceTaskExecutionView): task is WorkspaceTaskExecutionView => {
  return 'workspaceId' in task && 'worktreeId' in task && typeof task.worktreeId === 'string'
}

export const resolveTaskWorkingDirectory = async (
  task: Task | WorkspaceTaskExecutionView,
  project: Project,
  config: Pick<AgentConfig, 'workspaceRoot'>,
  gitIdentity?: TaskRuntimeGitIdentity,
) => {
  const executorWorkspaceRoot = hasWorkspaceRuntime(task) && task.executorNodeId
    ? executorRegistry.listExecutorsWithPresence().find((item) => item.executorId === task.executorNodeId)?.workspaceRoot?.trim()
    : undefined
  const workspaceRoot = executorWorkspaceRoot || config.workspaceRoot
  if (hasWorkspaceRuntime(task)) {
    if (task.workingDirectoryMode !== 'original-dir' && project.versionControl !== 'none') {
      const worktreePath = resolveTaskWorktreePath(workspaceRoot, project, task)
      if (existsSync(worktreePath)) {
        logOpenCodeDebug('task-cwd:worktree', {
          taskId: task.id,
          projectId: project.id,
          workspaceRoot,
          worktreePath,
        })
        return worktreePath
      }

      logOpenCodeDebug('task-cwd:worktree', {
        taskId: task.id,
        projectId: project.id,
        workspaceRoot,
        worktreePath,
      })
    } else {
      logOpenCodeDebug('task-cwd:project-mode', {
        taskId: task.id,
        projectId: project.id,
        workspaceRoot,
        workingDirectoryMode: task.workingDirectoryMode,
        versionControl: project.versionControl,
      })
    }
  }

  const resolvedPath = await resolveProjectExecutionPath(project, { workspaceRoot, gitIdentity })
  logOpenCodeDebug('task-cwd:project', {
    taskId: task.id,
    projectId: project.id,
    workspaceRoot,
    resolvedPath,
  })
  return resolvedPath
}

const createAbortError = () => {
  const error = new Error('Aborted')
  error.name = 'AbortError'
  return error
}

export const throwIfAborted = (signal?: AbortSignal) => {
  if (signal?.aborted) {
    throw createAbortError()
  }
}
