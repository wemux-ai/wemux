import type { ExecutorRecord, GitHubResourceBinding, Project, ProjectPullRequestReviewSummary, Task, Workspace } from '@shared/types'
import type { ProjectAssignee, TaskAssignmentOptions } from '../../lib/api'
import type { CreateTaskFormPayload } from './create-task-modal'

export interface TaskDetailPanelProps {
  project: Project | null
  task: Task
  tasks: Task[]
  projectPullRequests: ProjectPullRequestReviewSummary[]
  projectPullRequestBindings: GitHubResourceBinding[]
  assignees: ProjectAssignee[]
  executors: ExecutorRecord[]
  open: boolean
  onClose: () => void
  onCleanup: () => void
  onDelete: (payload: { deleteTask: boolean; deleteTaskWorkspaces: boolean }) => Promise<unknown>
  onSendMessage: (msg: string) => Promise<void>
  onAssignExecutor: (taskId: string, executorNodeId: string) => void
  onOpenWorkspaceSession: (workspaceId: string, workspaceSessionId?: string, launchId?: string, initialPrompt?: string, baseBranch?: string, autoEnvironmentInstall?: boolean) => void
  onTaskUpdate: (task: Task) => void
  onAssignTask: (taskId: string, assigneeId?: string, options?: TaskAssignmentOptions) => Promise<unknown>
  onExecuteTask: (taskId: string, payload: { workspaceId: string; baseBranch?: string; returnMode: 'summary' | 'branch' | 'commit'; gitIdentityMode: 'personal' }) => Promise<void>
  onBindTaskWorkspace: (taskId: string, workspaceId: string) => Promise<void>
  onCreateSubtask: (taskId: string, payload: CreateTaskFormPayload) => Promise<void>
  busy: boolean
}

const DEFAULT_BRANCH_FALLBACK = 'main'

export const resolveTaskBranchSelectionState = (params: {
  branches: string[]
  currentBranch?: string
  preferredBranches?: string[]
  defaultBranch?: string
  fallbackBranch?: string
  message?: string
}) => {
  const normalizedDefaultBranch = params.defaultBranch?.trim()
    || params.fallbackBranch?.trim()
    || DEFAULT_BRANCH_FALLBACK
  const branchOptions = params.branches.length > 0
    ? params.branches
    : [normalizedDefaultBranch]
  const candidates = [
    params.currentBranch?.trim(),
    ...(params.preferredBranches ?? []).map((branch) => branch.trim()).filter(Boolean),
    normalizedDefaultBranch,
  ]
  const selectedBranch = candidates.find((branch) => branch && branchOptions.includes(branch)) || branchOptions[0] || ''
  const fallbackMessage = params.branches.length === 0
    ? `暂时无法读取远端分支，先按默认分支 ${normalizedDefaultBranch} 继续；稍后准备工作区时会自动 clone。`
    : ''

  return {
    branchOptions,
    selectedBranch,
    branchMessage: params.message?.trim() || fallbackMessage,
  }
}

export function resolvePreferredExecutorId(params: {
  project: Project | null
  taskExecutorId?: string
  workspaces: Workspace[]
  executors: ExecutorRecord[]
}) {
  const availableExecutorIds = new Set(params.executors.map((executor) => executor.executorId))
  const candidates = [
    params.taskExecutorId,
    params.project?.preferredExecutorId,
    params.workspaces.find((workspace) => workspace.repoReady)?.executorNodeId,
    params.workspaces[0]?.executorNodeId,
    params.executors[0]?.executorId,
  ]

  return candidates.find((executorId) => executorId && availableExecutorIds.has(executorId)) ?? ''
}
