import assert from 'node:assert/strict'
import test from 'node:test'
import { buildWorkspaceTaskExecutionView, rebindWorkspaceSessionToExecutor } from '@shared/task-workspace'
import type { Task, WorkspaceSession } from '@shared/types'
import { applyRuntimeSelectionToWorkspaceSession } from './runtime-config-apply'

const createTask = (overrides: Partial<Task> = {}): Task => ({
  id: 'task-1',
  projectId: 'project-1',
  title: 'runtime-config executor rebind',
  description: '',
  status: 'todo',
  priority: 'medium',
  retryCount: 0,
  agentType: 'Codex',
  executionModel: 'gpt-5.4-mini',
  opencodeConfig: undefined,
  executionMode: 'auto',
  gitIdentityMode: 'personal',
  agentManaged: 'ai',
  baseBranch: 'master',
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
  createdAt: '2026-05-19T00:00:00.000Z',
  updatedAt: '2026-05-19T00:00:00.000Z',
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
  executorNodeId: 'executor-old',
  runtimeOwnerExecutorId: 'executor-old',
  agentType: 'Codex',
  mountedSkillNames: [],
  mountedMcpServerNames: [],
  enabledMcpServerIds: [],
  executionModel: 'gpt-5.4-mini',
  opencodeConfig: undefined,
  gitIdentityMode: 'personal',
  runtimeContinuations: [
    {
      runtimeId: 'Codex',
      scopeKey: 'runtime=Codex|executor=executor-old|persona=main|model=gpt-5.4-mini|cwd=/root/.vibemux-dev/workspace/repos/todomap',
      nativeSessionId: 'native-session-1',
      executorId: 'executor-old',
      executionModel: 'gpt-5.4-mini',
      cwdHash: '/root/.vibemux-dev/workspace/repos/todomap',
      updatedAt: '2026-05-19T00:00:01.000Z',
    },
  ],
  baseBranch: 'master',
  worktreeId: 'worktree-1',
  worktreeUniqueId: 3,
  branchName: 'vibemux/worktree-1',
  worktreeStatus: 'created',
  workingDirectoryMode: 'worktree',
  needsHumanConfirm: false,
  agentRunningStatus: 'thinking',
  runtimeStatus: 'running',
  runtimeSessionId: 'runtime-1',
  runtimeStartedAt: '2026-05-19T00:00:02.000Z',
  lastHeartbeatAt: '2026-05-19T00:00:03.000Z',
  lastRuntimeEventAt: '2026-05-19T00:00:04.000Z',
  terminalReason: undefined,
  runtimeSequence: 7,
  currentStep: '正在旧节点运行',
  lastActiveAt: '2026-05-19T00:00:04.000Z',
  createdAt: '2026-05-19T00:00:00.000Z',
  updatedAt: '2026-05-19T00:00:04.000Z',
  ...overrides,
})

test('rebindWorkspaceSessionToExecutor clears prepared runtime state for send-time executor switch', () => {
  const task = createTask()
  const session = createSession()

  const rebound = rebindWorkspaceSessionToExecutor(task, session, {
    executorNodeId: 'executor-new',
    currentStep: '已切换执行节点，新工作目录会在下次运行时准备。',
    updatedAt: '2026-05-19T00:00:10.000Z',
    worktreeUniqueId: 9,
  })

  assert.equal(rebound.executorNodeId, 'executor-new')
  assert.equal(rebound.runtimeOwnerExecutorId, 'executor-new')
  assert.equal(rebound.worktreeStatus, 'planned')
  assert.equal(rebound.runtimeStatus, 'idle')
  assert.equal(rebound.agentRunningStatus, 'idle')
  assert.equal(rebound.agentSessionId, undefined)
  assert.equal(rebound.opencodeSessionId, undefined)
  assert.equal(rebound.runtimeSessionId, undefined)
  assert.equal(rebound.runtimeStartedAt, undefined)
  assert.equal(rebound.lastHeartbeatAt, undefined)
  assert.equal(rebound.lastRuntimeEventAt, undefined)
  assert.deepEqual(rebound.runtimeContinuations, [])
  assert.equal(rebound.worktreeUniqueId, 9)
  assert.equal(rebound.currentStep, '已切换执行节点，新工作目录会在下次运行时准备。')
})

test('send-time runtime selection overrides a stale task model for the workspace turn', () => {
  const task = createTask({ executionModel: 'hs/deepseek-v4-flash' })
  const session = createSession({ executionModel: 'hs/deepseek-v4-flash' })

  const selectedSession = applyRuntimeSelectionToWorkspaceSession({
    task,
    session,
    runtimeConfig: {
      agentType: 'Codex',
      executionModel: 'blackai/gpt-5.4',
    },
    updatedAt: '2026-05-19T00:00:10.000Z',
  })
  const scopedTask = buildWorkspaceTaskExecutionView(task, selectedSession)

  assert.equal(selectedSession.executionModel, 'blackai/gpt-5.4')
  assert.equal(scopedTask.executionModel, 'blackai/gpt-5.4')
})
