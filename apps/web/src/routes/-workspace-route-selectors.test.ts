import assert from 'node:assert/strict'
import test from 'node:test'
import type { AppState, Project, Task, TaskWorkspaceBinding, WorkspaceSession } from '@shared/types'
import {
  buildWorkspaceRouteIndexes,
  selectFallbackWorkspaceSession,
  selectProjectBindingPathHint,
  selectWorkspaceRouteProject,
  selectWorkspaceRouteTask,
  selectWorkspaceTask,
} from './-workspace-route-selectors'

const baseProject: Project = {
  id: 'project-1',
  name: 'Project 1',
  rootPath: '/repo',
  gitUrl: '',
  defaultBranch: 'main',
  createdAt: '2026-05-20T00:00:00.000Z',
  updatedAt: '2026-05-20T00:00:00.000Z',
  versionControl: 'git-local',
}

const createTask = (id: string, projectId = 'project-1'): Task => ({
  id,
  projectId,
  title: id,
  description: '',
  acceptanceCriteria: '',
  status: 'todo',
  priority: 'medium',
  retryCount: 0,
  agentType: 'Codex',
  executionMode: 'auto',
  agentManaged: 'ai',
  needsHumanConfirm: false,
  agentRunningStatus: 'idle',
  currentStep: '',
  logs: [],
  comments: [],
  history: [],
  orchestration: [],
  toolCalls: [],
  validationChecks: [],
  executionHistory: [],
  createdAt: '2026-05-20T00:00:00.000Z',
  updatedAt: '2026-05-20T00:00:00.000Z',
})

const createWorkspaceSession = (
  id: string,
  patch: Partial<WorkspaceSession> = {},
): WorkspaceSession => ({
  id,
  workspaceId: 'workspace-1',
  title: id,
  titleOrigin: 'manual',
  status: 'active',
  sessionKind: 'primary',
  sessionRole: 'general',
  sessionOrigin: 'manual',
  worktreeId: `worktree-${id}`,
  branchName: `branch-${id}`,
  worktreeStatus: 'created',
  workingDirectoryMode: 'worktree',
  agentRunningStatus: 'idle',
  runtimeStatus: 'idle',
  runtimeSequence: 0,
  currentStep: '',
  needsHumanConfirm: false,
  lastActiveAt: '2026-05-20T00:00:00.000Z',
  createdAt: '2026-05-20T00:00:00.000Z',
  updatedAt: '2026-05-20T00:00:00.000Z',
  ...patch,
})

const createBinding = (patch: Partial<TaskWorkspaceBinding> = {}): TaskWorkspaceBinding => ({
  id: 'binding-1',
  taskId: 'task-linked',
  workspaceId: 'workspace-1',
  status: 'active',
  createdAt: '2026-05-20T00:00:00.000Z',
  updatedAt: '2026-05-20T00:00:00.000Z',
  ...patch,
})

const createState = (patch: Partial<AppState> = {}): AppState => ({
  config: {
    workspaceRoot: '/workspace-root',
    workspaceOpenSettings: {
      defaultTarget: 'vscode',
      customCommand: '',
    },
  },
  projects: [baseProject],
  tasks: [createTask('task-1'), createTask('task-linked')],
  nodes: [],
  projectBindings: [],
  distributedTasks: [],
  taskWorkspaceBindings: [],
  workspaceSessions: [],
  messages: [],
  mainChatSessions: [],
  selectedMainChatSessionId: '',
  selectedProjectId: '',
  selectedTaskId: '',
  sidebarCollapsed: false,
  ...patch,
} as AppState)

test('selects route task and project from route search', () => {
  const indexes = buildWorkspaceRouteIndexes(createState())
  const task = selectWorkspaceRouteTask(indexes, { taskId: 'task-1' })
  const project = selectWorkspaceRouteProject(indexes, { projectId: undefined }, task)

  assert.equal(task?.id, 'task-1')
  assert.equal(project?.id, 'project-1')
})

test('workspace active binding wins over fallback route task', () => {
  const indexes = buildWorkspaceRouteIndexes(createState({
    taskWorkspaceBindings: [createBinding()],
  }))

  const task = selectWorkspaceTask(indexes, {
    fallbackTask: createTask('task-1'),
    project: baseProject,
    workspaceId: 'workspace-1',
  })

  assert.equal(task?.id, 'task-linked')
})

test('falls back to the selected workspace session or first session', () => {
  const firstSession = createWorkspaceSession('session-1', { createdAt: '2026-05-20T00:00:01.000Z' })
  const secondSession = createWorkspaceSession('session-2', { createdAt: '2026-05-20T00:00:02.000Z' })
  const indexes = buildWorkspaceRouteIndexes(createState({
    workspaceSessions: [secondSession, firstSession],
  }))

  assert.equal(
    selectFallbackWorkspaceSession(indexes, 'workspace-1', 'session-2')?.id,
    'session-2',
  )
  assert.equal(
    selectFallbackWorkspaceSession(indexes, 'workspace-1', 'missing-session')?.id,
    'session-2',
  )
})

test('selects active project binding path hint by project and executor', () => {
  const indexes = buildWorkspaceRouteIndexes(createState({
    projectBindings: [{
      projectId: 'project-1',
      nodeId: 'executor-1',
      repoUrl: '',
      defaultBranch: 'main',
      pathHint: '/repo-on-executor',
      isActive: true,
      createdAt: '2026-05-20T00:00:00.000Z',
      updatedAt: '2026-05-20T00:00:00.000Z',
    }],
  }))

  assert.equal(
    selectProjectBindingPathHint(indexes, 'project-1', 'executor-1'),
    '/repo-on-executor',
  )
})
