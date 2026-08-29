import assert from 'node:assert/strict'
import test from 'node:test'
import type { AppState, Task, TaskWorkspaceBinding, WorkspaceSession } from '@shared/types'
import { initialState } from '../data/mock'
import { getDashboardMetrics, filterTasksForCollaborationWorkspace, getDashboardPendingApprovalItems } from './app-helpers'

const createTask = (overrides: Partial<Task> = {}): Task => ({
  id: 'task-1',
  projectId: 'project-1',
  title: '修复状态同步',
  description: '',
  status: 'todo',
  priority: 'medium',
  retryCount: 0,
  agentType: 'OpenCode',
  executionModel: 'openai/gpt-5',
  opencodeConfig: undefined,
  executionMode: 'auto',
  gitIdentityMode: 'personal',
  agentManaged: 'ai',
  baseBranch: 'main',
  acceptanceCriteria: '',
  comments: [],
  logs: [],
  toolCalls: [],
  executionHistory: [],
  history: [],
  orchestration: [],
  validationChecks: [],
  currentStep: '',
  needsHumanConfirm: false,
  agentRunningStatus: 'idle',
  createdAt: '2026-05-09T00:00:00.000Z',
  updatedAt: '2026-05-09T00:00:00.000Z',
  ...overrides,
})

const createBinding = (overrides: Partial<TaskWorkspaceBinding> = {}): TaskWorkspaceBinding => ({
  id: 'binding-1',
  taskId: 'task-1',
  workspaceId: 'workspace-1',
  status: 'active',
  createdAt: '2026-05-09T00:00:00.000Z',
  updatedAt: '2026-05-09T00:00:00.000Z',
  ...overrides,
})

const createSession = (overrides: Partial<WorkspaceSession> = {}): WorkspaceSession => ({
  id: 'session-1',
  workspaceId: 'workspace-1',
  title: '默认会话',
  titleOrigin: 'system',
  status: 'active',
  sessionKind: 'primary',
  sessionRole: 'general',
  sessionOrigin: 'manual',
  executorNodeId: 'executor-1',
  agentType: 'OpenCode',
  mountedSkillNames: [],
  mountedMcpServerNames: [],
  enabledMcpServerIds: [],
  executionModel: 'openai/gpt-5',
  gitIdentityMode: 'personal',
  runtimeContinuations: [],
  baseBranch: 'main',
  worktreeId: 'worktree-1',
  branchName: 'vibemux/worktree-1',
  worktreeStatus: 'created',
  workingDirectoryMode: 'worktree',
  needsHumanConfirm: false,
  agentRunningStatus: 'idle',
  runtimeStatus: 'idle',
  runtimeSequence: 0,
  currentStep: '',
  lastActiveAt: '2026-05-09T00:00:00.000Z',
  createdAt: '2026-05-09T00:00:00.000Z',
  updatedAt: '2026-05-09T00:00:00.000Z',
  ...overrides,
})

const createState = (overrides: Partial<AppState> = {}): AppState => ({
  ...initialState,
  projects: [
    {
      id: 'project-1',
      name: 'Vibemux Core',
      gitUrl: 'git@github.com:demo/vibemux-core.git',
      createdAt: '2026-05-09T00:00:00.000Z',
      updatedAt: '2026-05-09T00:00:00.000Z',
    },
  ],
  tasks: [],
  taskWorkspaceBindings: [],
  workspaceSessions: [],
  selectedProjectId: 'project-1',
  selectedTaskId: '',
  ...overrides,
})

test('getDashboardMetrics counts active workspace sessions for in-progress metrics', () => {
  const task = createTask({
    status: 'in_progress',
    agentRunningStatus: 'executing',
  })
  const state = createState({
    tasks: [task],
    selectedTaskId: task.id,
    taskWorkspaceBindings: [createBinding()],
    workspaceSessions: Array.from({ length: 5 }, (_, index) => createSession({
      id: `session-${index + 1}`,
      worktreeId: `worktree-${index + 1}`,
      branchName: `vibemux/worktree-${index + 1}`,
      agentRunningStatus: 'executing',
      runtimeStatus: 'running',
    })),
  })

  const metrics = getDashboardMetrics(state)

  assert.equal(metrics.total, 1)
  assert.equal(metrics.activeAgents, 5)
  assert.equal(metrics.inProgressTasks, 1)
  assert.equal(metrics.pendingApprovals, 0)
  assert.equal(metrics.done, 0)
})

test('getDashboardMetrics counts pending confirmations from workspace sessions and standalone tasks', () => {
  const workspaceTask = createTask({
    id: 'task-1',
    status: 'in_review',
    needsHumanConfirm: true,
    agentRunningStatus: 'complete',
  })
  const standaloneTask = createTask({
    id: 'task-2',
    status: 'in_review',
    needsHumanConfirm: true,
  })
  const state = createState({
    tasks: [workspaceTask, standaloneTask],
    selectedTaskId: workspaceTask.id,
    taskWorkspaceBindings: [createBinding()],
    workspaceSessions: [
      createSession({
        agentRunningStatus: 'complete',
        needsHumanConfirm: true,
        runtimeStatus: 'completed',
      }),
      createSession({
        id: 'session-2',
        worktreeId: 'worktree-2',
        branchName: 'vibemux/worktree-2',
        agentRunningStatus: 'complete',
        needsHumanConfirm: true,
        runtimeStatus: 'completed',
      }),
    ],
  })

  const metrics = getDashboardMetrics(state)

  assert.equal(metrics.total, 2)
  assert.equal(metrics.activeAgents, 0)
  assert.equal(metrics.inProgressTasks, 0)
  assert.equal(metrics.pendingApprovals, 3)
})

test('getDashboardMetrics aggregates dashboard totals across all projects', () => {
  const vibemuxTask = createTask({
    id: 'task-vibemux',
    projectId: 'project-1',
    status: 'in_review',
    needsHumanConfirm: true,
    agentRunningStatus: 'complete',
  })
  const shoppingTask = createTask({
    id: 'task-shopping',
    projectId: 'project-2',
    status: 'in_progress',
    agentRunningStatus: 'executing',
  })

  const state = createState({
    projects: [
      {
        id: 'project-1',
        name: 'Vibemux Core',
        gitUrl: 'git@github.com:demo/vibemux-core.git',
        createdAt: '2026-05-09T00:00:00.000Z',
        updatedAt: '2026-05-09T00:00:00.000Z',
      },
      {
        id: 'project-2',
        name: 'shopping_agent',
        gitUrl: 'git@github.com:demo/shopping-agent.git',
        createdAt: '2026-05-09T00:00:00.000Z',
        updatedAt: '2026-05-09T00:00:00.000Z',
      },
    ],
    tasks: [vibemuxTask, shoppingTask],
    selectedProjectId: 'project-1',
    selectedTaskId: vibemuxTask.id,
    taskWorkspaceBindings: [
      createBinding({
        id: 'binding-vibemux',
        taskId: vibemuxTask.id,
        workspaceId: 'workspace-vibemux',
      }),
      createBinding({
        id: 'binding-shopping',
        taskId: shoppingTask.id,
        workspaceId: 'workspace-shopping',
      }),
    ],
    workspaceSessions: [
      createSession({
        id: 'session-vibemux',
        workspaceId: 'workspace-vibemux',
        needsHumanConfirm: true,
        agentRunningStatus: 'complete',
        runtimeStatus: 'completed',
      }),
      createSession({
        id: 'session-shopping',
        workspaceId: 'workspace-shopping',
        agentRunningStatus: 'executing',
        runtimeStatus: 'running',
      }),
    ],
  })

  const metrics = getDashboardMetrics(state)

  assert.equal(metrics.total, 2)
  assert.equal(metrics.activeAgents, 1)
  assert.equal(metrics.inProgressTasks, 1)
  assert.equal(metrics.pendingApprovals, 1)
  assert.equal(metrics.done, 0)
  assert.equal(metrics.retries, 0)
})

test('getDashboardPendingApprovalItems mirrors pending confirmation sources for the selected project', () => {
  const workspaceTask = createTask({
    id: 'task-workspace',
    projectId: 'project-1',
    title: '对齐仪表盘统计',
    status: 'in_review',
    needsHumanConfirm: true,
    agentRunningStatus: 'complete',
    currentStep: '等待确认 diff',
    updatedAt: '2026-05-11T03:00:00.000Z',
  })
  const standaloneTask = createTask({
    id: 'task-standalone',
    projectId: 'project-1',
    title: '补充回归测试',
    status: 'in_review',
    needsHumanConfirm: true,
    agentRunningStatus: 'complete',
    currentStep: '等待确认测试结果',
    updatedAt: '2026-05-11T02:00:00.000Z',
  })
  const otherProjectTask = createTask({
    id: 'task-other',
    projectId: 'project-2',
    title: 'shopping follow-up',
    status: 'in_review',
    needsHumanConfirm: true,
    agentRunningStatus: 'complete',
    updatedAt: '2026-05-11T04:00:00.000Z',
  })

  const state = createState({
    projects: [
      {
        id: 'project-1',
        name: 'Vibemux Core',
        gitUrl: 'git@github.com:demo/vibemux-core.git',
        createdAt: '2026-05-09T00:00:00.000Z',
        updatedAt: '2026-05-09T00:00:00.000Z',
      },
      {
        id: 'project-2',
        name: 'shopping_agent',
        gitUrl: 'git@github.com:demo/shopping-agent.git',
        createdAt: '2026-05-09T00:00:00.000Z',
        updatedAt: '2026-05-09T00:00:00.000Z',
      },
    ],
    tasks: [workspaceTask, standaloneTask, otherProjectTask],
    selectedProjectId: 'project-1',
    selectedTaskId: workspaceTask.id,
    taskWorkspaceBindings: [
      createBinding({
        id: 'binding-workspace',
        taskId: workspaceTask.id,
        workspaceId: 'workspace-1',
      }),
      createBinding({
        id: 'binding-other',
        taskId: otherProjectTask.id,
        workspaceId: 'workspace-2',
      }),
    ],
    workspaceSessions: [
      createSession({
        id: 'session-workspace',
        workspaceId: 'workspace-1',
        title: 'Reviewer',
        needsHumanConfirm: true,
        agentRunningStatus: 'complete',
        runtimeStatus: 'completed',
        currentStep: '等待确认 diff',
        updatedAt: '2026-05-11T03:30:00.000Z',
      }),
      createSession({
        id: 'session-other',
        workspaceId: 'workspace-2',
        title: 'Other project',
        needsHumanConfirm: true,
        agentRunningStatus: 'complete',
        runtimeStatus: 'completed',
        updatedAt: '2026-05-11T05:00:00.000Z',
      }),
    ],
  })

  const items = getDashboardPendingApprovalItems(state, 'project-1')

  assert.deepEqual(
    items.map((item) => ({
      id: item.id,
      source: item.source,
      taskId: item.taskId,
      workspaceSessionTitle: item.workspaceSessionTitle,
      currentStep: item.currentStep,
    })),
    [
      {
        id: 'workspace-session:session-workspace',
        source: 'workspaceSession',
        taskId: 'task-workspace',
        workspaceSessionTitle: 'Reviewer',
        currentStep: '等待确认 diff',
      },
      {
        id: 'task:task-standalone',
        source: 'task',
        taskId: 'task-standalone',
        workspaceSessionTitle: undefined,
        currentStep: '等待确认测试结果',
      },
    ],
  )
})

test('filterTasksForCollaborationWorkspace scopes tasks to the workspace projects', () => {
  const projectA = { id: 'project-a', name: 'A', gitUrl: '', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', workspaceId: 'ws-1' }
  const projectB = { id: 'project-b', name: 'B', gitUrl: '', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', workspaceId: 'ws-2' }
  const legacyProject = { id: 'project-legacy', name: 'Legacy', gitUrl: '', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' }
  const state = createState({
    projects: [projectA, projectB, legacyProject],
    tasks: [
      { ...createTask({ id: 't1', projectId: 'project-a' }) },
      { ...createTask({ id: 't2', projectId: 'project-b' }) },
      { ...createTask({ id: 't3', projectId: 'project-legacy' }) },
    ],
  })

  const ws1Tasks = filterTasksForCollaborationWorkspace(state, 'ws-1')
  assert.deepEqual(ws1Tasks.map((task) => task.id).sort(), ['t1', 't3'])

  const ws2Tasks = filterTasksForCollaborationWorkspace(state, 'ws-2')
  assert.deepEqual(ws2Tasks.map((task) => task.id).sort(), ['t2', 't3'])

  // 无 workspace 上下文 → 全部
  assert.equal(filterTasksForCollaborationWorkspace(state, undefined).length, 3)

  // metrics 跟随过滤
  const metrics = getDashboardMetrics(state, 'ws-1')
  assert.equal(metrics.total, 2)
  const metricsAll = getDashboardMetrics(state)
  assert.equal(metricsAll.total, 3)
})
