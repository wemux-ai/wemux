import assert from 'node:assert/strict'
import test from 'node:test'
import type { ExecutorRecord, Project, Workspace } from '@shared/types'
import { buildWorkspaceProjectRootPath, buildWorkspaceRepoPath } from './workspace-paths'
import { resolveWorkspaceSessionRuntime } from './workspace-session-runtime'

const createExecutor = (overrides: Partial<ExecutorRecord> = {}): ExecutorRecord => ({
  executorId: 'executor-1',
  machineId: 'machine-1',
  machineName: 'Machine 1',
  name: 'Executor 1',
  ownerUserId: 'user-1',
  visibility: 'private',
  status: 'online',
  workspaceRoot: '/home/new/.vibemux-dev/workspace',
  maxConcurrency: 2,
  capabilities: [],
  labels: [],
  createdAt: '2026-05-15T00:00:00.000Z',
  ...overrides,
})

const createProject = (overrides: Partial<Project> = {}): Project => ({
  id: 'project-1',
  name: 'TodoMap',
  gitUrl: 'https://github.com/example/todomap.git',
  rootPath: '/Users/x/work/todoMap',
  versionControl: 'git-remote',
  createdAt: '2026-05-15T00:00:00.000Z',
  updatedAt: '2026-05-15T00:00:00.000Z',
  ...overrides,
} as Project)

const createWorkspace = (overrides: Partial<Workspace> = {}): Workspace => ({
  id: 'workspace-1',
  projectId: 'project-1',
  executorNodeId: 'executor-1',
  executorName: 'Executor 1',
  name: 'Workspace 1',
  source: 'manual',
  status: 'ready',
  repoReady: true,
  agentType: 'OpenCode',
  executorStatus: 'online',
  ownerUserId: 'user-1',
  createdAt: '2026-05-15T00:00:00.000Z',
  updatedAt: '2026-05-15T00:00:00.000Z',
  ...overrides,
} as Workspace)

const expectedRepoPath = (workspaceRoot: string | undefined, project: Project, workspace: Workspace) => (
  buildWorkspaceRepoPath(workspaceRoot, project, workspace.id, workspace.ownerUserId)
)

const expectedProjectRootPath = (workspaceRoot: string | undefined, project: Project, workspace: Workspace) => (
  buildWorkspaceProjectRootPath(workspaceRoot, project, workspace.id, workspace.ownerUserId)
)

test('resolveWorkspaceSessionRuntime prefers the current executor workspace repo path for remote projects', () => {
  const executor = createExecutor()
  const project = createProject()
  const workspace = createWorkspace({
    repoPath: '/Users/x/work/todoMap',
  })

  const runtime = resolveWorkspaceSessionRuntime({
    defaultWorkspaceRoot: '/fallback/workspace',
    executors: [executor],
    project,
    workspace,
  })

  assert.equal(runtime.fileExplorerRootPath, expectedRepoPath(executor.workspaceRoot, project, workspace))
  assert.equal(runtime.terminalCwd, expectedRepoPath(executor.workspaceRoot, project, workspace))
  assert.equal(runtime.candidateCwds[0], expectedRepoPath(executor.workspaceRoot, project, workspace))
})

test('resolveWorkspaceSessionRuntime ignores explicit workspace repo paths for remote projects', () => {
  const executor = createExecutor()
  const project = createProject()
  const workspace = createWorkspace({
    repoPath: '/mnt/repos/todomap',
  })

  const runtime = resolveWorkspaceSessionRuntime({
    defaultWorkspaceRoot: '/fallback/workspace',
    executors: [executor],
    project,
    workspace,
  })

  assert.equal(runtime.fileExplorerRootPath, expectedRepoPath(executor.workspaceRoot, project, workspace))
  assert.equal(runtime.terminalCwd, expectedRepoPath(executor.workspaceRoot, project, workspace))
  assert.equal(runtime.candidateCwds[0], expectedRepoPath(executor.workspaceRoot, project, workspace))
})

test('resolveWorkspaceSessionRuntime uses the project default path for remote original-dir sessions', () => {
  const executor = createExecutor()
  const project = createProject()
  const workspace = createWorkspace({
    repoPath: '/mnt/nodes/executor-1/todomap',
  })

  const runtime = resolveWorkspaceSessionRuntime({
    defaultWorkspaceRoot: '/fallback/workspace',
    executors: [executor],
    project,
    workspace,
    workspaceSession: {
      executorNodeId: 'executor-1',
      runtimeOwnerExecutorId: 'executor-1',
      workingDirectoryMode: 'original-dir',
      worktreeId: 'worktree-1',
      worktreeStatus: 'created',
    },
  })

  assert.equal(runtime.fileExplorerRootPath, expectedRepoPath(executor.workspaceRoot, project, workspace))
  assert.equal(runtime.terminalTargetCwd, expectedRepoPath(executor.workspaceRoot, project, workspace))
  assert.equal(runtime.terminalCwd, expectedRepoPath(executor.workspaceRoot, project, workspace))
  assert.equal(runtime.candidateCwds[0], expectedRepoPath(executor.workspaceRoot, project, workspace))
})

test('resolveWorkspaceSessionRuntime uses the current executor default repo path for remote original-dir without binding', () => {
  const executor = createExecutor()
  const project = createProject()
  const workspace = createWorkspace({
    repoPath: project.rootPath,
    workingDirectoryMode: 'original-dir',
  })

  const runtime = resolveWorkspaceSessionRuntime({
    defaultWorkspaceRoot: '/fallback/workspace',
    executors: [executor],
    project,
    workspace,
    workspaceSession: {
      executorNodeId: 'executor-1',
      runtimeOwnerExecutorId: 'executor-1',
      workingDirectoryMode: 'original-dir',
      worktreeId: 'worktree-1',
      worktreeStatus: 'created',
    },
  })

  assert.equal(runtime.fileExplorerRootPath, expectedRepoPath(executor.workspaceRoot, project, workspace))
  assert.equal(runtime.terminalTargetCwd, expectedRepoPath(executor.workspaceRoot, project, workspace))
  assert.equal(runtime.terminalCwd, expectedRepoPath(executor.workspaceRoot, project, workspace))
  assert.equal(runtime.candidateCwds[0], expectedRepoPath(executor.workspaceRoot, project, workspace))
})

test('resolveWorkspaceSessionRuntime follows the workspace session executor after node switch', () => {
  const workspaceExecutor = createExecutor({
    executorId: 'executor-1',
    workspaceRoot: '/home/workspace/.vibemux-dev/workspace',
  })
  const sessionExecutor = createExecutor({
    executorId: 'executor-2',
    name: 'Executor 2',
    workspaceRoot: '/home/session/.vibemux-dev/workspace',
  })
  const project = createProject()
  const workspace = createWorkspace({
    executorNodeId: 'executor-1',
    repoPath: project.rootPath,
    workingDirectoryMode: 'original-dir',
  })

  const runtime = resolveWorkspaceSessionRuntime({
    defaultWorkspaceRoot: '/fallback/workspace',
    executors: [workspaceExecutor, sessionExecutor],
    project,
    workspace,
    workspaceSession: {
      executorNodeId: 'executor-2',
      runtimeOwnerExecutorId: 'executor-2',
      workingDirectoryMode: 'original-dir',
      worktreeId: 'worktree-1',
      worktreeStatus: 'created',
    },
  })

  assert.equal(runtime.executorId, 'executor-2')
  assert.equal(runtime.fileExplorerRootPath, expectedRepoPath(sessionExecutor.workspaceRoot, project, workspace))
  assert.equal(runtime.terminalTargetCwd, expectedRepoPath(sessionExecutor.workspaceRoot, project, workspace))
  assert.equal(runtime.terminalCwd, expectedRepoPath(sessionExecutor.workspaceRoot, project, workspace))
  assert.equal(runtime.candidateCwds[0], expectedRepoPath(sessionExecutor.workspaceRoot, project, workspace))
})

test('resolveWorkspaceSessionRuntime ignores owner repo and binding paths after session executor switch', () => {
  const workspaceExecutor = createExecutor({
    executorId: 'executor-1',
    workspaceRoot: '/home/workspace/.vibemux-dev/workspace',
  })
  const sessionExecutor = createExecutor({
    executorId: 'executor-2',
    name: 'Executor 2',
    workspaceRoot: '/home/session/.vibemux-dev/workspace',
  })
  const project = createProject()
  const workspace = createWorkspace({
    executorNodeId: 'executor-1',
    repoPath: '/Users/old/work/todoMap',
    workingDirectoryMode: 'original-dir',
  })

  const runtime = resolveWorkspaceSessionRuntime({
    bindingPathHint: '/mnt/executor-1/todomap',
    defaultWorkspaceRoot: '/fallback/workspace',
    executors: [workspaceExecutor, sessionExecutor],
    project,
    workspace,
    workspaceSession: {
      executorNodeId: 'executor-2',
      runtimeOwnerExecutorId: 'executor-2',
      workingDirectoryMode: 'original-dir',
      worktreeId: 'worktree-1',
      worktreeStatus: 'created',
    },
  })

  assert.equal(runtime.executorId, 'executor-2')
  assert.equal(runtime.fileExplorerRootPath, expectedRepoPath(sessionExecutor.workspaceRoot, project, workspace))
  assert.equal(runtime.terminalTargetCwd, expectedRepoPath(sessionExecutor.workspaceRoot, project, workspace))
  assert.equal(runtime.terminalCwd, expectedRepoPath(sessionExecutor.workspaceRoot, project, workspace))
  assert.equal(runtime.candidateCwds[0], expectedRepoPath(sessionExecutor.workspaceRoot, project, workspace))
})

test('resolveWorkspaceSessionRuntime ignores an owner local project root after session executor switch', () => {
  const workspaceExecutor = createExecutor({ executorId: 'executor-1' })
  const sessionExecutor = createExecutor({
    executorId: 'executor-2',
    workspaceRoot: '/home/session/.vibemux-dev/workspace',
  })
  const project = createProject({
    gitUrl: '',
    rootPath: '/Users/owner/work/todoMap',
    versionControl: 'none',
  })
  const workspace = createWorkspace({
    executorNodeId: 'executor-1',
    repoPath: '/Users/owner/work/todoMap',
    workingDirectoryMode: 'original-dir',
  })

  const runtime = resolveWorkspaceSessionRuntime({
    executors: [workspaceExecutor, sessionExecutor],
    project,
    workspace,
    workspaceSession: {
      executorNodeId: 'executor-2',
      runtimeOwnerExecutorId: 'executor-2',
      workingDirectoryMode: 'original-dir',
      worktreeId: 'worktree-1',
      worktreeStatus: 'created',
    },
  })

  assert.equal(runtime.executorId, 'executor-2')
  assert.equal(runtime.fileExplorerRootPath, expectedProjectRootPath(sessionExecutor.workspaceRoot, project, workspace))
})

test('resolveWorkspaceSessionRuntime ignores remote workspace repo paths that only point at the workspace root container', () => {
  const executor = createExecutor()
  const project = createProject()
  const workspace = createWorkspace({
    repoPath: executor.workspaceRoot,
    workingDirectoryMode: 'original-dir',
  })

  const runtime = resolveWorkspaceSessionRuntime({
    defaultWorkspaceRoot: '/fallback/workspace',
    executors: [executor],
    project,
    workspace,
    workspaceSession: {
      executorNodeId: 'executor-1',
      runtimeOwnerExecutorId: 'executor-1',
      workingDirectoryMode: 'original-dir',
      worktreeId: 'worktree-1',
      worktreeStatus: 'created',
    },
  })

  assert.equal(runtime.fileExplorerRootPath, expectedRepoPath(executor.workspaceRoot, project, workspace))
  assert.equal(runtime.terminalTargetCwd, expectedRepoPath(executor.workspaceRoot, project, workspace))
  assert.equal(runtime.terminalCwd, expectedRepoPath(executor.workspaceRoot, project, workspace))
  assert.equal(runtime.candidateCwds[0], expectedRepoPath(executor.workspaceRoot, project, workspace))
})

test('resolveWorkspaceSessionRuntime keeps file explorer on a workspace-scoped project root when no repo path is available yet', () => {
  const executor = createExecutor({
    workspaceRoot: '/Users/x/.vibemux-preview/workspace',
  })
  const project = createProject({
    rootPath: '',
    versionControl: 'git-local',
  })
  const workspace = createWorkspace({
    repoPath: '',
  })

  const runtime = resolveWorkspaceSessionRuntime({
    defaultWorkspaceRoot: '/fallback/workspace',
    executors: [executor],
    project,
    workspace,
  })

  assert.equal(runtime.fileExplorerRootPath, expectedProjectRootPath(executor.workspaceRoot, project, workspace))
  assert.equal(runtime.candidateCwds[0], expectedProjectRootPath(executor.workspaceRoot, project, workspace))
  assert.equal(runtime.candidateCwds.includes('/Users/x/.vibemux-preview'), true)
})

test('resolveWorkspaceSessionRuntime remaps managed local project paths to the runtime executor workspace root', () => {
  const executor = createExecutor({
    workspaceRoot: '/Users/x/.vibemux-dev/workspace',
  })
  const project = createProject({
    gitUrl: '',
    rootPath: '/root/.vibemux-dev/workspace/projects/todomap',
    versionControl: 'none',
  })
  const workspace = createWorkspace({
    repoPath: project.rootPath,
    workingDirectoryMode: 'original-dir',
  })

  const runtime = resolveWorkspaceSessionRuntime({
    defaultWorkspaceRoot: '/fallback/workspace',
    executors: [executor],
    project,
    workspace,
    workspaceSession: {
      executorNodeId: 'executor-1',
      runtimeOwnerExecutorId: 'executor-1',
      workingDirectoryMode: 'original-dir',
      worktreeId: 'worktree-1',
      worktreeStatus: 'created',
    },
  })

  assert.equal(runtime.fileExplorerRootPath, expectedProjectRootPath(executor.workspaceRoot, project, workspace))
  assert.equal(runtime.terminalTargetCwd, expectedProjectRootPath(executor.workspaceRoot, project, workspace))
  assert.equal(runtime.terminalCwd, expectedProjectRootPath(executor.workspaceRoot, project, workspace))
  assert.equal(runtime.candidateCwds[0], expectedProjectRootPath(executor.workspaceRoot, project, workspace))
})

test('resolveWorkspaceSessionRuntime scopes managed binding hints for original-dir local projects', () => {
  const executor = createExecutor({
    workspaceRoot: '/Users/x/.vibemux-dev/workspace',
  })
  const project = createProject({
    gitUrl: '',
    rootPath: '/Users/x/.vibemux-dev/workspace/projects/todomap',
    versionControl: 'none',
  })
  const workspace = createWorkspace({
    repoPath: project.rootPath,
    workingDirectoryMode: 'original-dir',
  })

  const runtime = resolveWorkspaceSessionRuntime({
    bindingPathHint: '/Users/x/.vibemux-dev/workspace/projects/todomap',
    defaultWorkspaceRoot: '/fallback/workspace',
    executors: [executor],
    project,
    workspace,
    workspaceSession: {
      executorNodeId: 'executor-1',
      runtimeOwnerExecutorId: 'executor-1',
      workingDirectoryMode: 'original-dir',
      worktreeId: 'worktree-1',
      worktreeStatus: 'created',
    },
  })

  assert.equal(runtime.fileExplorerRootPath, expectedProjectRootPath(executor.workspaceRoot, project, workspace))
  assert.equal(runtime.terminalTargetCwd, expectedProjectRootPath(executor.workspaceRoot, project, workspace))
  assert.equal(runtime.terminalCwd, expectedProjectRootPath(executor.workspaceRoot, project, workspace))
  assert.equal(runtime.candidateCwds[0], expectedProjectRootPath(executor.workspaceRoot, project, workspace))
})
