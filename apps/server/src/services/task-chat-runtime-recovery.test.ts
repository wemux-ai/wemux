import assert from 'node:assert/strict'
import test from 'node:test'
import type { DistributedTask, Task, TaskWorkspaceBinding, WorkspaceSession } from '@shared/types'
import {
  STALE_TASK_CHAT_RUNTIME_MESSAGE,
  buildTaskChatRuntimeRecoveryPlan,
} from './task-chat-runtime-recovery'

const createTask = (overrides: Partial<Task> = {}): Task => ({
  id: 'task-1',
  projectId: 'project-1',
  title: '修复工作区断线恢复',
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
  createdAt: '2026-05-08T00:00:00.000Z',
  updatedAt: '2026-05-08T00:00:00.000Z',
  ...overrides,
})

const createBinding = (overrides: Partial<TaskWorkspaceBinding> = {}): TaskWorkspaceBinding => ({
  id: 'binding-1',
  taskId: 'task-1',
  workspaceId: 'workspace-1',
  status: 'active',
  createdAt: '2026-05-08T00:00:00.000Z',
  updatedAt: '2026-05-08T00:00:00.000Z',
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
  lastActiveAt: '2026-05-08T00:00:00.000Z',
  createdAt: '2026-05-08T00:00:00.000Z',
  updatedAt: '2026-05-08T00:00:00.000Z',
  ...overrides,
})

test('buildTaskChatRuntimeRecoveryPlan recovers stale workspace chat sessions and tasks', () => {
  const task = createTask({
    agentRunningStatus: 'executing',
    currentStep: '正在生成回复',
  })
  const session = createSession({
    agentRunningStatus: 'executing',
    runtimeStatus: 'running',
    currentStep: '正在生成回复',
  })

  const plan = buildTaskChatRuntimeRecoveryPlan({
    tasks: [task],
    taskWorkspaceBindings: [createBinding()],
    workspaceSessions: [session],
    resolveDistributedTask: () => undefined,
  })

  assert.equal(plan.recoveredTasks.length, 1)
  assert.equal(plan.recoveredSessions.length, 1)
  assert.equal(plan.recoveredTasks[0]?.agentRunningStatus, 'error')
  assert.equal(plan.recoveredSessions[0]?.agentRunningStatus, 'error')
  assert.equal(plan.recoveredTasks[0]?.currentStep, STALE_TASK_CHAT_RUNTIME_MESSAGE)
  assert.equal(plan.recoveredSessions[0]?.currentStep, STALE_TASK_CHAT_RUNTIME_MESSAGE)
})

test('buildTaskChatRuntimeRecoveryPlan skips sessions backed by active distributed tasks', () => {
  const distributedTask: DistributedTask = {
    id: 'dist-1',
    originTaskId: 'task-1',
    projectId: 'project-1',
    repoUrl: 'git@github.com:demo/vibemux.git',
    defaultBranch: 'main',
    baseCommit: 'HEAD',
    description: 'run',
    status: 'executing',
    priority: 'medium',
    timeoutSec: 1800,
    originNodeId: 'node-1',
    returnMode: 'commit',
    syncBackStrategy: 'none',
    agentType: 'OpenCode',
    retryCount: 0,
    createdAt: '2026-05-08T00:00:00.000Z',
    updatedAt: '2026-05-08T00:00:00.000Z',
    idempotencyKey: 'dist-1',
  }

  const plan = buildTaskChatRuntimeRecoveryPlan({
    tasks: [createTask({
      agentRunningStatus: 'executing',
    })],
    taskWorkspaceBindings: [createBinding()],
    workspaceSessions: [createSession({
      agentRunningStatus: 'executing',
      runtimeStatus: 'running',
      lastHeartbeatAt: new Date().toISOString(),
      distributedTaskId: distributedTask.id,
    })],
    resolveDistributedTask: () => distributedTask,
  })

  assert.equal(plan.recoveredTasks.length, 0)
  assert.equal(plan.recoveredSessions.length, 0)
})

test('buildTaskChatRuntimeRecoveryPlan recovers direct workspace chat sessions that fell back to queued after restart', () => {
  const plan = buildTaskChatRuntimeRecoveryPlan({
    tasks: [createTask({
      agentRunningStatus: 'thinking',
      currentStep: '正在处理工作区对话',
    })],
    taskWorkspaceBindings: [createBinding()],
    workspaceSessions: [createSession({
      agentRunningStatus: 'thinking',
      runtimeStatus: 'queued',
      currentStep: '正在处理工作区对话',
      distributedTaskId: undefined,
    })],
    resolveDistributedTask: () => undefined,
  })

  assert.equal(plan.recoveredTasks.length, 1)
  assert.equal(plan.recoveredSessions.length, 1)
  assert.equal(plan.recoveredTasks[0]?.agentRunningStatus, 'error')
  assert.equal(plan.recoveredSessions[0]?.runtimeStatus, 'lost')
  assert.equal(plan.recoveredSessions[0]?.currentStep, STALE_TASK_CHAT_RUNTIME_MESSAGE)
})
