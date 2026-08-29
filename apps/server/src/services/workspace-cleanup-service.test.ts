import assert from 'node:assert/strict'
import test from 'node:test'
import type { AppState, Project, WorkspaceSession, WorkspaceRecord } from '@shared/types'
import { executorRegistry } from '../control-plane/executor-registry'
import { executorWsService } from '../control-plane/executor-ws-service'
import { cleanupWorkspaceWorktrees } from './workspace-cleanup-service'

const buildProject = (): Project => ({
  id: 'project-1',
  name: 'Demo Project',
  description: '',
  workspaceId: '',
  ownerUserId: 'user-1',
  gitUrl: 'https://example.com/demo.git',
  defaultBranch: 'main',
  createdAt: '2026-06-03T00:00:00.000Z',
  updatedAt: '2026-06-03T00:00:00.000Z',
  status: 'active',
  visibility: 'private',
  versionControl: 'git-remote',
}) as Project

const buildWorkspace = (overrides: Partial<WorkspaceRecord> = {}): WorkspaceRecord => ({
  id: 'workspace-1',
  projectId: 'project-1',
  executorNodeId: 'executor-1',
  executorName: 'Node A',
  ownerUserId: 'user-1',
  name: 'Workspace A',
  status: 'ready',
  source: 'manual',
  repoPath: '/tmp/project',
  repoReady: true,
  workingDirectoryMode: 'worktree',
  agentType: 'OpenCode',
  autoCommitEnabled: false,
  defaultBranch: 'main',
  suggestedBaseBranch: 'main',
  createdAt: '2026-06-03T00:00:00.000Z',
  updatedAt: '2026-06-03T00:00:00.000Z',
  ...overrides,
}) as WorkspaceRecord

const buildSession = (): WorkspaceSession => ({
  id: 'session-1',
  workspaceId: 'workspace-1',
  title: 'Session A',
  titleOrigin: 'system',
  sessionKind: 'primary',
  sessionRole: 'general',
  sessionOrigin: 'manual',
  branchName: 'vibemux/demo',
  worktreeId: 'worktree-1',
  worktreeStatus: 'created',
  workingDirectoryMode: 'worktree',
  needsHumanConfirm: false,
  agentRunningStatus: 'idle',
  runtimeStatus: 'idle',
  runtimeSequence: 0,
  currentStep: '',
  lastActiveAt: '2026-06-03T00:00:00.000Z',
  status: 'active',
  createdAt: '2026-06-03T00:00:00.000Z',
  updatedAt: '2026-06-03T00:00:00.000Z',
})

const buildState = (): AppState => ({
  config: {
    workspaceRoot: '/tmp/vibemux',
  },
  taskWorkspaceBindings: [{
    id: 'binding-1',
    taskId: 'task-1',
    workspaceId: 'workspace-1',
    status: 'active',
    createdAt: '2026-06-03T00:00:00.000Z',
    updatedAt: '2026-06-03T00:00:00.000Z',
  }],
}) as AppState

test('cleanupWorkspaceWorktrees skips cleanup when workspace executor id is missing', async () => {
  const result = await cleanupWorkspaceWorktrees({
    state: buildState(),
    project: buildProject(),
    workspace: buildWorkspace({ executorNodeId: '' }),
    sessions: [buildSession()],
    userId: 'user-1',
  })

  assert.deepEqual(result, {
    ok: true,
    detail: '原执行节点记录已丢失，已跳过本地隔离目录清理。',
  })
})

test('cleanupWorkspaceWorktrees skips cleanup when workspace executor has been deleted', async () => {
  const getExecutorRestore = test.mock.method(executorRegistry, 'getExecutor', () => null)

  const result = await cleanupWorkspaceWorktrees({
    state: buildState(),
    project: buildProject(),
    workspace: buildWorkspace(),
    sessions: [buildSession()],
    userId: 'user-1',
  })

  getExecutorRestore.mock.restore()
  assert.deepEqual(result, {
    ok: true,
    detail: '原执行节点已不存在，已跳过本地隔离目录清理。',
  })
})

test('cleanupWorkspaceWorktrees skips cleanup when workspace executor is offline', async () => {
  const getExecutorRestore = test.mock.method(executorRegistry, 'getExecutor', () => ({
    executorId: 'executor-1',
    workspaceRoot: '/tmp/vibemux',
  }))
  const requestCleanupRestore = test.mock.method(
    executorWsService,
    'requestWorktreeCleanup',
    async () => Promise.reject(new Error('执行器当前未在线，无法清理工作目录。')),
  )

  const result = await cleanupWorkspaceWorktrees({
    state: buildState(),
    project: buildProject(),
    workspace: buildWorkspace(),
    sessions: [buildSession()],
    userId: 'user-1',
  })

  requestCleanupRestore.mock.restore()
  getExecutorRestore.mock.restore()
  assert.deepEqual(result, {
    ok: true,
    detail: '原执行节点当前不可用，已跳过本地隔离目录清理。',
  })
})

test('cleanupWorkspaceWorktrees still fails for non-availability cleanup errors', async () => {
  const getExecutorRestore = test.mock.method(executorRegistry, 'getExecutor', () => ({
    executorId: 'executor-1',
    workspaceRoot: '/tmp/vibemux',
  }))
  const requestCleanupRestore = test.mock.method(
    executorWsService,
    'requestWorktreeCleanup',
    async () => Promise.reject(new Error('git worktree remove failed')),
  )

  const result = await cleanupWorkspaceWorktrees({
    state: buildState(),
    project: buildProject(),
    workspace: buildWorkspace(),
    sessions: [buildSession()],
    userId: 'user-1',
  })

  requestCleanupRestore.mock.restore()
  getExecutorRestore.mock.restore()
  assert.deepEqual(result, {
    ok: false,
    message: '清理本地隔离目录失败：git worktree remove failed',
  })
})
