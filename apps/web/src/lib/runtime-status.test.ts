import assert from 'node:assert/strict'
import test from 'node:test'
import type { Task, TaskWorkspaceBinding, WorkspaceSession } from '@shared/types'
import { getProjectRuntimeSummary, getProjectWorkspaceUnreadCount, isTaskRunning } from './runtime-status'

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

test('getProjectRuntimeSummary counts active workspace sessions instead of collapsing them into one task', () => {
  const task = createTask({
    status: 'in_progress',
    agentRunningStatus: 'executing',
  })
  const binding = createBinding()
  const sessions = Array.from({ length: 5 }, (_, index) => createSession({
    id: `session-${index + 1}`,
    worktreeId: `worktree-${index + 1}`,
    branchName: `vibemux/worktree-${index + 1}`,
    agentRunningStatus: 'executing',
    runtimeStatus: 'running',
  }))

  const summary = getProjectRuntimeSummary({
    projectId: task.projectId,
    tasks: [task],
    taskWorkspaceBindings: [binding],
    workspaceSessions: sessions,
  })

  assert.equal(summary.phase, 'running')
  assert.equal(summary.runningCount, 5)
  assert.equal(summary.attentionCount, 0)
})

test('Agent-assigned in-progress tasks show as active before a workspace run exists', () => {
  assert.equal(isTaskRunning(createTask({
    status: 'in_progress',
    assigneeAgentId: 'agent-1',
    agentRunningStatus: 'idle',
  })), true)
  assert.equal(isTaskRunning(createTask({
    status: 'in_progress',
    assigneeAgentId: undefined,
    agentRunningStatus: 'idle',
  })), false)
})

test('one-off Agent events mark a task active without changing its assignee or workflow status', () => {
  const task = createTask({ status: 'todo', assigneeAgentId: undefined, agentRunningStatus: 'idle' })
  assert.equal(isTaskRunning(task, true), true)
  assert.equal(isTaskRunning(task, false), false)
})

test('getProjectRuntimeSummary preserves non-workspace task runtime counts as fallback', () => {
  const workspaceTask = createTask({
    id: 'task-1',
    status: 'in_progress',
    agentRunningStatus: 'executing',
  })
  const standaloneTask = createTask({
    id: 'task-2',
    status: 'in_review',
    needsHumanConfirm: true,
  })
  const summary = getProjectRuntimeSummary({
    projectId: 'project-1',
    tasks: [workspaceTask, standaloneTask],
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

  assert.equal(summary.phase, 'attention')
  assert.equal(summary.runningCount, 0)
  assert.equal(summary.attentionCount, 3)
})

test('getProjectWorkspaceUnreadCount follows persisted unread state instead of raw attention state', () => {
  const task = createTask({
    status: 'in_review',
    needsHumanConfirm: true,
  })
  const binding = createBinding()
  const session = createSession({
    agentRunningStatus: 'complete',
    needsHumanConfirm: true,
    runtimeStatus: 'completed',
    runtimeSequence: 5,
    lastRuntimeEventAt: '2026-05-09T01:00:00.000Z',
  })

  const unreadCount = getProjectWorkspaceUnreadCount({
    projectId: task.projectId,
    tasks: [task],
    taskWorkspaceBindings: [binding],
    workspaceSessions: [session],
    unreadOptions: {
      acknowledgedSessionAttentionById: {
        [session.id]: 'attention:5:2026-05-09T01:00:00.000Z',
      },
    },
  })

  assert.equal(unreadCount, 0)
})
