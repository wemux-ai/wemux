import assert from 'node:assert/strict'
import test from 'node:test'
import type { Task, WorkspaceSession, WorkspaceRecord } from '@shared/types'
import { createProjectRecord } from './project-route-shared'
import { buildProjectBinding } from './shared'
import { buildWorkspaceDirectorySessions, createWorkspaceRecord, listProjectWorkspacesForUser, resolveEffectiveWorkspaceWorktreeSession, resolveEffectiveWorkspaceWorktreeSessionFromCandidates, resolveWorkspaceSessionDirectoryView, saveWorkspaceDirectorySessions } from './task-route-support'
import { executorRegistry } from '../control-plane/executor-registry'
import { resetState, saveProject, saveWorkspaceSession } from '../storage/app-state-store'
import { closePostgres } from '../storage/postgres/db'
import { deletePersistedExecutor } from '../storage/postgres/executor-store'
import { listWorkspaces, resetClusterData, saveDistributedTask, saveWorkspace, upsertProjectBinding } from '../storage/distributed-task-store'
import { clearWorkspaceLocalWorktreeStore, getWorkspaceLocalWorktree, saveWorkspaceLocalWorktree } from '../services/workspace-local-worktree-store'

const createTask = (): Task => ({
  id: 'task-1',
  projectId: 'project-1',
  title: 'workspace shared worktree',
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
  createdAt: '2026-05-07T00:00:00.000Z',
  updatedAt: '2026-05-07T00:00:00.000Z',
})

const createSession = (overrides: Partial<WorkspaceSession> = {}): WorkspaceSession => ({
  id: 'session-1',
  workspaceId: 'workspace-1',
  displayOrder: 0,
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
  branchName: 'vibemux/test',
  worktreeStatus: 'planned',
  workingDirectoryMode: 'worktree',
  needsHumanConfirm: false,
  agentRunningStatus: 'idle',
  runtimeStatus: 'idle',
  runtimeSequence: 0,
  currentStep: '',
  lastActiveAt: '2026-05-07T00:00:00.000Z',
  createdAt: '2026-05-07T00:00:00.000Z',
  updatedAt: '2026-05-07T00:00:00.000Z',
  ...overrides,
})

const withSuppressedPostgresErrors = async <T>(action: () => Promise<T> | T) => {
  const originalConsoleError = console.error
  console.error = (...args: unknown[]) => {
    if (typeof args[0] === 'string' && args[0].startsWith('[postgres]')) {
      return
    }
    originalConsoleError(...args)
  }

  try {
    return await action()
  } finally {
    await new Promise((resolve) => setTimeout(resolve, 0))
    console.error = originalConsoleError
  }
}

test.after(async () => {
  await withSuppressedPostgresErrors(async () => {
    resetState()
    resetClusterData()
    clearWorkspaceLocalWorktreeStore()
    await closePostgres()
  })
})

test('user-created workspaces persist the user creator identity separately from ownership', () => {
  const userId = `user-creator-${crypto.randomUUID()}`
  const project = createProjectRecord({
    name: 'Creator identity project',
    gitUrl: '',
    versionControl: 'none',
    defaultBranch: 'main',
  })
  const workspace = createWorkspaceRecord(
    project,
    'executor-1',
    'Executor 1',
    'Creator identity workspace',
    userId,
  )

  assert.deepEqual(workspace.createdBy, {
    type: 'user',
    id: userId,
    name: userId,
    avatarUrl: undefined,
  })
  assert.equal(workspace.ownerUserId, userId)
})

test('buildWorkspaceDirectorySessions mirrors shared worktree state back to the current workspace session', () => {
  const task = createTask()
  const effectiveSession = createSession({
    id: 'session-source',
    worktreeId: 'worktree-source',
    worktreeUniqueId: 7,
    branchName: 'feature/source',
    worktreeStatus: 'planned',
    baseBranch: 'develop',
  })
  const currentSession = createSession({
    id: 'session-fork',
    worktreeId: 'worktree-fork',
    worktreeUniqueId: 11,
    branchName: 'feature/fork',
    sharedWorktreeSourceSessionId: 'session-source',
  })

  const { nextEffectiveSession, nextCurrentSession } = buildWorkspaceDirectorySessions({
    task,
    currentSession,
    effectiveSession,
    patch: {
      worktreeStatus: 'created',
      updatedAt: '2026-05-26T10:00:00.000Z',
    },
  })

  assert.equal(nextEffectiveSession.id, 'session-source')
  assert.equal(nextEffectiveSession.worktreeStatus, 'created')
  assert.equal(nextCurrentSession.id, 'session-fork')
  assert.equal(nextCurrentSession.worktreeStatus, 'created')
  assert.equal(nextCurrentSession.worktreeId, 'worktree-source')
  assert.equal(nextCurrentSession.worktreeUniqueId, 7)
  assert.equal(nextCurrentSession.branchName, 'feature/source')
  assert.equal(nextCurrentSession.baseBranch, 'develop')
})

test('buildWorkspaceDirectorySessions updates only one record when current session owns the worktree', () => {
  const task = createTask()
  const currentSession = createSession({
    id: 'session-owner',
    worktreeStatus: 'planned',
  })

  const { nextEffectiveSession, nextCurrentSession } = buildWorkspaceDirectorySessions({
    task,
    currentSession,
    effectiveSession: currentSession,
    patch: {
      worktreeStatus: 'created',
      updatedAt: '2026-05-26T10:00:00.000Z',
    },
  })

  assert.equal(nextEffectiveSession.id, 'session-owner')
  assert.equal(nextCurrentSession.id, 'session-owner')
  assert.equal(nextCurrentSession.worktreeStatus, 'created')
})

test('saveWorkspaceDirectorySessions mirrors directory state into workspace local worktree cache', async () => {
  await withSuppressedPostgresErrors(() => {
    clearWorkspaceLocalWorktreeStore()
    const task = createTask()
    const workspace: WorkspaceRecord = {
      id: 'workspace-1',
      projectId: task.projectId,
      executorNodeId: 'executor-1',
      agentType: 'OpenCode',
      name: 'Workspace One',
      status: 'ready',
      repoReady: true,
      source: 'manual',
      workingDirectoryMode: 'worktree',
      defaultBranch: 'main',
      codeBaseBranch: 'main',
      codeBranchName: 'workspace/one',
      createdAt: '2026-05-07T00:00:00.000Z',
      updatedAt: '2026-05-07T00:00:00.000Z',
    }
    saveWorkspace(workspace)
    const session = createSession({ branchName: 'legacy/session', worktreeStatus: 'planned' })

    const nextSession = saveWorkspaceDirectorySessions({
      task,
      currentSession: session,
      effectiveSession: session,
      patch: {
        worktreeStatus: 'created',
        updatedAt: '2026-05-26T10:00:00.000Z',
      },
    })

    const localWorktree = getWorkspaceLocalWorktree(workspace.id, workspace.executorNodeId)
    assert.equal(nextSession.worktreeStatus, 'created')
    assert.equal(localWorktree?.workspaceId, workspace.id)
    assert.equal(localWorktree?.executorNodeId, workspace.executorNodeId)
    assert.equal(localWorktree?.codeBranchName, workspace.codeBranchName)
    assert.equal(localWorktree?.status, 'created')
    assert.equal(localWorktree?.sourceWorkspaceSessionId, session.id)
  })
})

test('resolveWorkspaceSessionDirectoryView prefers workspace local worktree cache over legacy session directory fields', () => {
  clearWorkspaceLocalWorktreeStore()
  const workspace: WorkspaceRecord = {
    id: 'workspace-1',
    projectId: 'project-1',
    executorNodeId: 'executor-1',
    agentType: 'OpenCode',
    name: 'Workspace One',
    status: 'ready',
    repoReady: true,
    source: 'manual',
    workingDirectoryMode: 'worktree',
    defaultBranch: 'main',
    codeBaseBranch: 'main',
    codeBranchName: 'workspace/one',
    createdAt: '2026-05-07T00:00:00.000Z',
    updatedAt: '2026-05-07T00:00:00.000Z',
  }
  const session = createSession({
    worktreeId: 'legacy-worktree',
    worktreeStatus: 'planned',
  })
  saveWorkspaceLocalWorktree({
    id: 'workspace-1:executor-1',
    workspaceId: workspace.id,
    executorNodeId: workspace.executorNodeId,
    codeBaseBranch: 'main',
    codeBranchName: 'workspace/one',
    workingDirectoryMode: 'worktree',
    worktreeId: 'cached-worktree',
    worktreeUniqueId: 9,
    status: 'created',
    sourceWorkspaceSessionId: 'session-source',
    createdAt: '2026-05-26T10:00:00.000Z',
    updatedAt: '2026-05-26T10:00:00.000Z',
  })

  const { directory, effectiveSession } = resolveWorkspaceSessionDirectoryView(session, workspace)

  assert.equal(directory.worktreeId, 'cached-worktree')
  assert.equal(directory.worktreeStatus, 'created')
  assert.equal(directory.worktreeUniqueId, 9)
  assert.equal(effectiveSession.worktreeId, 'cached-worktree')
  assert.equal(effectiveSession.worktreeStatus, 'created')
})

test('resolveEffectiveWorkspaceWorktreeSession only reuses created sessions from the target executor', () => {
  const workerASession = createSession({
    id: 'session-worker-a',
    executorNodeId: 'worker-a',
    runtimeOwnerExecutorId: 'worker-a',
    worktreeStatus: 'created',
    worktreeId: 'worktree-worker-a',
  })
  const workerBSession = createSession({
    id: 'session-worker-b',
    executorNodeId: 'worker-b',
    runtimeOwnerExecutorId: undefined,
    worktreeStatus: 'planned',
    worktreeId: 'worktree-worker-b',
  })

  const effectiveSession = resolveEffectiveWorkspaceWorktreeSessionFromCandidates(
    workerBSession,
    [workerASession, workerBSession],
    'worker-b',
  )

  assert.equal(effectiveSession.id, 'session-worker-b')
  assert.equal(effectiveSession.worktreeStatus, 'planned')
})

test('resolveEffectiveWorkspaceWorktreeSession uses workspace sessions instead of task-owned sessions for shared directories', async () => {
  await withSuppressedPostgresErrors(() => {
    resetState()
    const createdWorkspaceSession = createSession({
      id: 'session-created-by-other-task',
      worktreeStatus: 'created',
      worktreeId: 'worktree-created',
    })
    const plannedWorkspaceSession = createSession({
      id: 'session-current-task',
      worktreeStatus: 'planned',
      worktreeId: 'worktree-planned',
    })
    saveWorkspaceSession(createdWorkspaceSession)
    saveWorkspaceSession(plannedWorkspaceSession)

    const effectiveSession = resolveEffectiveWorkspaceWorktreeSession(
      'task-current',
      plannedWorkspaceSession,
      'executor-1',
    )

    assert.equal(effectiveSession.id, createdWorkspaceSession.id)
    assert.equal(effectiveSession.worktreeId, createdWorkspaceSession.worktreeId)
  })
})

test('listProjectWorkspacesForUser returns real workspaces and hides unreferenced workspace-root leftovers', async () => {
  await withSuppressedPostgresErrors(async () => {
    resetState()
    resetClusterData()

    const userId = `user-${crypto.randomUUID()}`
    const project = {
      ...createProjectRecord({
        name: `workspace-list-${Date.now()}`,
        gitUrl: 'https://github.com/example/repo.git',
        versionControl: 'git-remote',
        defaultBranch: 'main',
      }),
      id: `project-${crypto.randomUUID()}`,
      createdById: userId,
    }
    const { executor } = executorRegistry.createManagedExecutor({
      ownerUserId: userId,
      visibility: 'private',
      machineId: `machine-${crypto.randomUUID()}`,
      machineName: 'Test machine',
      name: 'Test executor',
      workspaceRoot: '/tmp/vibemux-test',
      maxConcurrency: 1,
      capabilities: [],
      labels: [],
    })
    executorRegistry.upsertExecutor(executor.executorId, {
      executorSource: 'customer-worker',
      managedBy: 'user',
      runtimeClass: 'user-worker',
      billingClass: 'standard',
    })

    saveProject(project)
    upsertProjectBinding(buildProjectBinding(project, executor.executorId))

    assert.deepEqual(listProjectWorkspacesForUser(userId, project), [])

    const timestamp = new Date().toISOString()
    const leftoverWorkspace: WorkspaceRecord = {
      id: `workspace-root-leftover-${crypto.randomUUID()}`,
      projectId: project.id,
      executorNodeId: executor.executorId,
      agentType: 'OpenCode',
      name: 'Generated leftover',
      status: 'ready',
      repoReady: true,
      repoPath: '/tmp/vibemux-test/workspaces/generated/repos/repo',
      source: 'workspace-root',
      workingDirectoryMode: 'worktree',
      defaultBranch: 'main',
      ownerUserId: userId,
      createdAt: timestamp,
      updatedAt: timestamp,
    }
    const manualWorkspace: WorkspaceRecord = {
      id: `workspace-manual-${crypto.randomUUID()}`,
      projectId: project.id,
      executorNodeId: executor.executorId,
      agentType: 'OpenCode',
      name: 'Real workspace',
      status: 'ready',
      repoReady: true,
      repoPath: '/tmp/vibemux-test/workspaces/manual/repos/repo',
      source: 'manual',
      workingDirectoryMode: 'worktree',
      defaultBranch: 'main',
      ownerUserId: userId,
      createdAt: timestamp,
      updatedAt: timestamp,
    }

    saveWorkspace(leftoverWorkspace)
    saveWorkspace(manualWorkspace)

    const visibleWorkspaces = listProjectWorkspacesForUser(userId, project)
    assert.deepEqual(visibleWorkspaces.map((workspace) => workspace.id), [manualWorkspace.id])
    assert.equal(listWorkspaces().filter((workspace) => workspace.projectId === project.id).length, 2)
  })
})

test('listProjectWorkspacesForUser keeps owned manual workspaces when their executor was deleted', async () => {
  await withSuppressedPostgresErrors(async () => {
    resetState()
    resetClusterData()

    const userId = `user-${crypto.randomUUID()}`
    const project = {
      ...createProjectRecord({
        name: `workspace-missing-executor-${Date.now()}`,
        gitUrl: 'https://github.com/example/repo.git',
        versionControl: 'git-remote',
        defaultBranch: 'main',
      }),
      id: `project-${crypto.randomUUID()}`,
      createdById: userId,
    }
    const { executor } = executorRegistry.createManagedExecutor({
      ownerUserId: userId,
      visibility: 'private',
      machineId: `machine-${crypto.randomUUID()}`,
      machineName: 'Test machine',
      name: 'Deleted executor',
      workspaceRoot: '/tmp/vibemux-test',
      maxConcurrency: 1,
      capabilities: [],
      labels: [],
    })
    executorRegistry.upsertExecutor(executor.executorId, {
      executorSource: 'customer-worker',
      managedBy: 'user',
      runtimeClass: 'user-worker',
      billingClass: 'standard',
    })

    saveProject(project)
    upsertProjectBinding(buildProjectBinding(project, executor.executorId))

    const timestamp = new Date().toISOString()
    const manualWorkspace: WorkspaceRecord = {
      id: `workspace-manual-${crypto.randomUUID()}`,
      projectId: project.id,
      executorNodeId: executor.executorId,
      agentType: 'OpenCode',
      name: 'Real workspace',
      status: 'ready',
      repoReady: true,
      repoPath: '/tmp/vibemux-test/workspaces/manual/repos/repo',
      source: 'manual',
      workingDirectoryMode: 'worktree',
      defaultBranch: 'main',
      ownerUserId: userId,
      createdAt: timestamp,
      updatedAt: timestamp,
    }
    const leftoverWorkspace: WorkspaceRecord = {
      ...manualWorkspace,
      id: `workspace-root-leftover-${crypto.randomUUID()}`,
      name: 'Generated leftover',
      source: 'workspace-root',
    }

    saveWorkspace(manualWorkspace)
    saveWorkspace(leftoverWorkspace)
    executorRegistry.deleteExecutor(executor.executorId)
    deletePersistedExecutor(executor.executorId)

    const visibleWorkspaces = listProjectWorkspacesForUser(userId, project)
    assert.deepEqual(visibleWorkspaces.map((workspace) => workspace.id), [manualWorkspace.id])
    assert.equal(visibleWorkspaces[0]?.executorStatus, 'offline')
    assert.equal(listWorkspaces().filter((workspace) => workspace.projectId === project.id).length, 2)
  })
})
test('listProjectWorkspacesForUser keeps pull request delivery visible when it only exists on a distributed task result', async () => {
  await withSuppressedPostgresErrors(async () => {
    resetState()
    resetClusterData()

    const timestamp = '2026-05-12T00:00:00.000Z'
    const userId = `user-${crypto.randomUUID()}`
    const project = {
      ...createProjectRecord({
        name: `workspace-pr-${Date.now()}`,
        gitUrl: 'https://github.com/example/repo.git',
        versionControl: 'git-remote',
        defaultBranch: 'main',
      }),
      id: `project-${crypto.randomUUID()}`,
      createdById: userId,
    }
    const { executor } = executorRegistry.createManagedExecutor({
      ownerUserId: userId,
      visibility: 'private',
      machineId: `machine-${crypto.randomUUID()}`,
      machineName: 'Test machine',
      name: 'MacBook',
      workspaceRoot: '/tmp/vibemux-test',
      maxConcurrency: 1,
      capabilities: [],
      labels: [],
    })
    executorRegistry.upsertExecutor(executor.executorId, {
      executorSource: 'customer-worker',
      managedBy: 'user',
      runtimeClass: 'user-worker',
      billingClass: 'standard',
    })
    saveProject(project)
    upsertProjectBinding(buildProjectBinding(project, executor.executorId))

    saveWorkspace({
      id: 'workspace-1',
      projectId: project.id,
      executorNodeId: executor.executorId,
      agentType: 'OpenCode',
      name: 'Bridge codex desktop',
      status: 'ready',
      repoReady: true,
      repoPath: '/tmp/vibemux-test/workspaces/workspace-1/repos/repo',
      source: 'manual',
      workingDirectoryMode: 'worktree',
      defaultBranch: 'main',
      ownerUserId: userId,
      createdAt: timestamp,
      updatedAt: timestamp,
    })

    saveDistributedTask({
      id: 'distributed-1',
      originTaskId: 'origin-task-1',
      workspaceId: 'workspace-1',
      workspaceSessionId: 'workspace-session-1',
      projectId: project.id,
      agentType: 'Codex',
      repoUrl: project.gitUrl,
      defaultBranch: 'main',
      baseCommit: 'abc123',
      description: 'Create PR',
      status: 'completed',
      priority: 'medium',
      timeoutSec: 1800,
      originNodeId: executor.executorId,
      executorNodeId: executor.executorId,
      returnMode: 'commit',
      syncBackStrategy: 'pull-branch',
      idempotencyKey: 'distributed-1',
      retryCount: 0,
      createdAt: timestamp,
      updatedAt: '2026-05-12T00:10:00.000Z',
      completedAt: '2026-05-12T00:10:00.000Z',
      result: {
        taskId: 'origin-task-1',
        status: 'completed',
        returnMode: 'commit',
        summary: 'PR created',
        filesChanged: [],
        startedAt: timestamp,
        completedAt: '2026-05-12T00:10:00.000Z',
        durationSec: 600,
        executorNodeId: executor.executorId,
        workspaceId: 'workspace-1',
        workspaceSessionId: 'workspace-session-1',
        delivery: {
          mode: 'commit',
          pullRequest: {
            ready: true,
            remoteReady: true,
            repoUrl: project.gitUrl,
            title: 'Bridge codex desktop',
            description: 'body',
            baseBranch: 'main',
            compareBranch: 'vibemux/4ebf-bridge-codex-desktop',
            number: 40,
            url: 'https://github.com/example/repo/pull/40',
            state: 'open',
          },
        },
      },
    })

    const visibleWorkspace = listProjectWorkspacesForUser(userId, project)[0]
    assert.equal(visibleWorkspace?.deliverySummary?.pullRequest?.number, 40)
    assert.equal(visibleWorkspace?.deliverySummary?.pullRequest?.url, 'https://github.com/example/repo/pull/40')
  })
})
