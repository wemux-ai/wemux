import assert from 'node:assert/strict'
import test from 'node:test'
import type { AppState, Project, Task, WorkspaceSession, WorkspaceRecord } from '@shared/types'
import {
  applyWorkspaceSessionCreatePayload,
  buildForkWorkspaceSessionTitle,
  canAutoRenameWorkspaceSessionTitle,
  ensureWorkspaceExecutorSwitchPreparationTarget,
  resolveDefaultWorkspaceExecutorId,
  resolveInitialWorkspaceSessionTitleOrigin,
  resolveWorkspaceEnvironmentTemplateImportTarget,
  resolveWorkspaceExecutorSwitchPreparationTarget,
  runWorkspaceCreateInstallCommand,
} from './workspace-management-routes'
import { resetState } from '../storage/app-state-store'

const now = '2026-06-08T00:00:00.000Z'

const createProject = (environmentTemplate?: Project['environmentTemplate']): Project => ({
  id: 'project-1',
  name: 'Demo',
  gitUrl: 'https://example.com/demo.git',
  defaultBranch: 'main',
  environmentTemplate,
  createdAt: now,
  updatedAt: now,
})

const createTask = (): Task => ({
  id: 'task-1',
  projectId: 'project-1',
  title: 'AI 对话',
  description: 'workspace chat',
  status: 'todo',
  priority: 'medium',
  retryCount: 0,
  agentType: 'OpenCode',
  executionMode: 'auto',
  agentManaged: 'none',
  needsHumanConfirm: false,
  agentRunningStatus: 'idle',
  currentStep: '',
  executionHistory: [],
  comments: [],
  toolCalls: [],
  logs: [],
  history: [],
  orchestration: [],
  validationChecks: [],
  createdAt: now,
  updatedAt: now,
})

const createWorkspace = (): WorkspaceRecord => ({
  id: 'workspace-1',
  projectId: 'project-1',
  executorNodeId: 'executor-1',
  agentType: 'OpenCode',
  name: 'Workspace',
  status: 'ready',
  repoReady: true,
  source: 'workspace-root',
  workingDirectoryMode: 'worktree',
  createdAt: now,
  updatedAt: now,
})

const createSession = (overrides: Partial<WorkspaceSession> = {}): WorkspaceSession => ({
  id: 'session-1',
  workspaceId: 'workspace-1',
  title: 'Workspace',
  titleOrigin: 'system',
  status: 'active',
  sessionKind: 'primary',
  sessionRole: 'general',
  sessionOrigin: 'manual',
  worktreeId: 'worktree-1',
  worktreeUniqueId: 7,
  branchName: 'vibemux/workspace-7',
  worktreeStatus: 'created',
  workingDirectoryMode: 'worktree',
  needsHumanConfirm: false,
  agentRunningStatus: 'idle',
  runtimeStatus: 'completed',
  runtimeSequence: 0,
  currentStep: '',
  lastActiveAt: now,
  createdAt: now,
  updatedAt: now,
  ...overrides,
})

const createBoundSession = (overrides: Partial<WorkspaceSession> = {}): WorkspaceSession => ({
  ...createSession(),
  ...overrides,
})

test('workspace create install command starts rendered install template in background', async () => {
  const terminalCalls: Array<{
    executorId: string
    command: string
    cwd?: string
    options?: {
      mode?: 'wait' | 'background'
      timeoutMs?: number
    }
  }> = []
  const systemMessages: string[] = []

  const result = await runWorkspaceCreateInstallCommand(
    {
      project: createProject({
        source: 'manual',
        installCommand: 'pnpm --dir {{worktree.path}} install',
      }),
      task: createTask(),
      workspace: createWorkspace(),
      session: createSession(),
      cwd: '/tmp/demo/worktree',
      executorId: 'executor-1',
    },
    {
      getWorkspaceEnvironmentTemplate: async () => null,
      requestTerminalCommand: async (executorId, command, cwd, options) => {
        terminalCalls.push({ executorId, command, cwd, options })
        return {
          command,
          cwd,
          stdout: '',
          stderr: '',
          exitCode: 0,
          mode: options?.mode ?? 'wait',
          detached: true,
          at: now,
        }
      },
      recordSystemMessage: (_scope, message) => {
        systemMessages.push(message)
      },
    },
  )

  assert.deepEqual(result, { skipped: false, ok: true, command: 'pnpm --dir /tmp/demo/worktree install', detached: true })
  assert.equal(terminalCalls.length, 1)
  assert.equal(terminalCalls[0]?.executorId, 'executor-1')
  assert.equal(terminalCalls[0]?.command, 'pnpm --dir /tmp/demo/worktree install')
  assert.equal(terminalCalls[0]?.cwd, '/tmp/demo/worktree')
  assert.equal(terminalCalls[0]?.options?.mode, 'background')
  assert.equal(terminalCalls[0]?.options?.timeoutMs, 600000)
  assert.deepEqual(systemMessages, [
    '开始自动执行安装命令：pnpm --dir /tmp/demo/worktree install',
    '自动安装已在后台启动：pnpm --dir /tmp/demo/worktree install',
  ])
})

test('workspace create install command still reports synchronous completion when terminal does not detach', async () => {
  const systemMessages: string[] = []

  const result = await runWorkspaceCreateInstallCommand(
    {
      project: createProject({
        source: 'manual',
        installCommand: 'pnpm --dir {{worktree.path}} install',
      }),
      task: createTask(),
      workspace: createWorkspace(),
      session: createSession(),
      cwd: '/tmp/demo/worktree',
      executorId: 'executor-1',
    },
    {
      getWorkspaceEnvironmentTemplate: async () => null,
      requestTerminalCommand: async (_executorId, command, cwd, options) => ({
        command,
        cwd,
        stdout: 'installed',
        stderr: '',
        exitCode: 0,
        mode: options?.mode ?? 'wait',
        detached: false,
        at: now,
      }),
      recordSystemMessage: (_scope, message) => {
        systemMessages.push(message)
      },
    },
  )

  assert.deepEqual(result, { skipped: false, ok: true, command: 'pnpm --dir /tmp/demo/worktree install' })
  assert.deepEqual(systemMessages, [
    '开始自动执行安装命令：pnpm --dir /tmp/demo/worktree install',
    '自动安装完成：pnpm --dir /tmp/demo/worktree install\n\n最后输出：\ninstalled',
  ])
})

test('workspace create install command skips when template has no install command', async () => {
  let terminalCallCount = 0
  const result = await runWorkspaceCreateInstallCommand(
    {
      project: createProject({ source: 'manual', startCommandTemplate: 'pnpm dev' }),
      task: createTask(),
      workspace: createWorkspace(),
      session: createSession(),
      cwd: '/tmp/demo/worktree',
      executorId: 'executor-1',
    },
    {
      getWorkspaceEnvironmentTemplate: async () => null,
      requestTerminalCommand: async () => {
        terminalCallCount += 1
        throw new Error('unexpected terminal call')
      },
    },
  )

  assert.deepEqual(result, { skipped: true })
  assert.equal(terminalCallCount, 0)
})

test('resolveWorkspaceExecutorSwitchPreparationTarget prefers requested workspace session', () => {
  const task = createTask()
  const sessionA = createBoundSession({ id: 'session-a' })
  const sessionB = createBoundSession({ id: 'session-b' })
  const taskIdByWorkspaceId = new Map([
    ['workspace-1', task.id],
  ])
  const taskById = new Map([[task.id, task]])

  const result = resolveWorkspaceExecutorSwitchPreparationTarget({
    workspaceId: 'workspace-1',
    requestedWorkspaceSessionId: 'session-b',
    taskIdByWorkspaceId,
    taskById,
    sessions: [sessionA, sessionB],
  })

  assert.equal(result?.session.id, 'session-b')
  assert.equal(result?.task.id, task.id)
})

test('resolveWorkspaceExecutorSwitchPreparationTarget falls back to requested task when session is missing', () => {
  const taskA = createTask()
  const taskB = { ...createTask(), id: 'task-2' }
  const sessionA = createBoundSession({ id: 'session-a' })
  const sessionB = createBoundSession({ id: 'session-b', displayOrder: 2 })
  const taskIdByWorkspaceId = new Map([
    ['workspace-1', taskA.id],
  ])
  const taskById = new Map([
    [taskA.id, taskA],
    [taskB.id, taskB],
  ])

  const result = resolveWorkspaceExecutorSwitchPreparationTarget({
    workspaceId: 'workspace-1',
    requestedTaskId: taskB.id,
    requestedWorkspaceSessionId: 'missing-session',
    taskIdByWorkspaceId,
    taskById,
    sessions: [sessionA, sessionB],
  })

  assert.equal(result?.session.id, 'session-b')
  assert.equal(result?.task.id, taskB.id)
})

test('resolveWorkspaceExecutorSwitchPreparationTarget supports workspace-only session ids', () => {
  const session = createSession({ id: 'session-workspace-only' })
  const task = {
    ...createTask(),
    id: session.id,
  }
  const taskById = new Map([[task.id, task]])

  const result = resolveWorkspaceExecutorSwitchPreparationTarget({
    workspaceId: 'workspace-1',
    requestedTaskId: task.id,
    requestedWorkspaceSessionId: session.id,
    taskIdByWorkspaceId: new Map(),
    taskById,
    sessions: [session],
  })

  assert.equal(result?.session.id, session.id)
  assert.equal(result?.task.id, task.id)
})

test('ensureWorkspaceExecutorSwitchPreparationTarget keeps its session independent from the workspace task binding', () => {
  resetState()
  const task = createTask()
  const workspace = createWorkspace()

  const result = ensureWorkspaceExecutorSwitchPreparationTarget({
    task,
    workspace,
    executorNodeId: 'executor-2',
    updatedAt: now,
  })

  assert.equal(result?.task.id, task.id)
  assert.equal(result?.session.workspaceId, workspace.id)
  assert.equal(result?.session.executorNodeId, 'executor-2')
  assert.equal(result?.session && 'bindingId' in result.session, false)
})

test('resolveWorkspaceEnvironmentTemplateImportTarget prefers workspace session worktree cwd', () => {
  resetState()
  const project = createProject()
  const workspace = {
    ...createWorkspace(),
    repoPath: '/tmp/vibemux/workspaces/workspace-1/repos/demo',
  }
  const session = createSession()

  const result = resolveWorkspaceEnvironmentTemplateImportTarget({
    state: {
      config: { workspaceRoot: '/tmp/vibemux' } as AppState['config'],
      workspaceSessions: [session],
    },
    project,
    workspace,
    requestedWorkspaceSessionId: session.id,
  })

  assert.equal(result.executorId, workspace.executorNodeId)
  assert.equal(result.workspaceSessionId, session.id)
  assert.equal(result.importPath, '/tmp/vibemux/workspaces/workspace-1/worktrees/worktree-1')
})

test('buildForkWorkspaceSessionTitle uses explicit title or derives from the source session', () => {
  const session = createSession()

  assert.equal(buildForkWorkspaceSessionTitle(session, '  Custom fork  '), 'Custom fork')
  assert.equal(buildForkWorkspaceSessionTitle(session), 'Workspace · 分叉')
  assert.equal(buildForkWorkspaceSessionTitle({ ...session, title: '   ' }), '会话 · 分叉')
})

test('resolveInitialWorkspaceSessionTitleOrigin keeps the first session auto-renameable', () => {
  assert.equal(resolveInitialWorkspaceSessionTitleOrigin('system'), 'system')
  assert.equal(resolveInitialWorkspaceSessionTitleOrigin('ai'), 'system')
  assert.equal(resolveInitialWorkspaceSessionTitleOrigin('manual'), 'system')
  assert.equal(resolveInitialWorkspaceSessionTitleOrigin(undefined), 'system')
})

test('canAutoRenameWorkspaceSessionTitle only allows the first system-titled message window', () => {
  const session = createSession()

  assert.equal(canAutoRenameWorkspaceSessionTitle({ session, userMessageCount: 0 }), true)
  assert.equal(canAutoRenameWorkspaceSessionTitle({ session, userMessageCount: 1 }), true)
  assert.equal(canAutoRenameWorkspaceSessionTitle({ session, userMessageCount: 2 }), false)
  assert.equal(canAutoRenameWorkspaceSessionTitle({
    session: { ...session, titleOrigin: 'manual' },
    userMessageCount: 1,
  }), false)
  assert.equal(canAutoRenameWorkspaceSessionTitle({
    session: { ...session, titleOrigin: 'ai' },
    userMessageCount: 1,
  }), false)
})

test('applyWorkspaceSessionCreatePayload applies manual title updates to existing workspace-only sessions', () => {
  const nextSession = applyWorkspaceSessionCreatePayload({
    session: createSession({
      title: '旧名称',
      titleOrigin: 'system',
      baseBranch: 'main',
    }),
    workspace: createWorkspace(),
    project: createProject(),
    now,
    payload: {
      title: '新名称',
      titleOrigin: 'manual',
    },
  })

  assert.equal(nextSession.title, '新名称')
  assert.equal(nextSession.titleOrigin, 'manual')
  assert.equal(nextSession.baseBranch, 'main')
})

test('applyWorkspaceSessionCreatePayload preserves existing session fields without a task template', () => {
  const nextSession = applyWorkspaceSessionCreatePayload({
    session: createSession({
      title: '已有会话',
      titleOrigin: 'ai',
      baseBranch: 'release',
    }),
    workspace: createWorkspace(),
    project: createProject(),
    now,
    payload: {},
  })

  assert.equal(nextSession.title, '已有会话')
  assert.equal(nextSession.titleOrigin, 'ai')
  assert.equal(nextSession.baseBranch, 'release')
})

type DefaultExecutorCandidate = Parameters<typeof resolveDefaultWorkspaceExecutorId>[0]['visibleExecutors'][number]

const createExecutor = (overrides: Partial<DefaultExecutorCandidate> = {}): DefaultExecutorCandidate => ({
  executorId: 'executor-1',
  status: 'online',
  executorSource: undefined,
  managedBy: undefined,
  ...overrides,
})

test('resolveDefaultWorkspaceExecutorId prefers the first online local executor', () => {
  assert.equal(resolveDefaultWorkspaceExecutorId({
    visibleExecutors: [
      createExecutor({ executorId: 'local-a' }),
      createExecutor({ executorId: 'local-b', status: 'offline' }),
    ],
  }), 'local-a')
})

test('resolveDefaultWorkspaceExecutorId matches preferredExecutorId first regardless of order', () => {
  assert.equal(resolveDefaultWorkspaceExecutorId({
    visibleExecutors: [
      createExecutor({ executorId: 'local-a' }),
      createExecutor({ executorId: 'preferred-node' }),
    ],
    preferredExecutorId: 'preferred-node',
  }), 'preferred-node')
})

test('resolveDefaultWorkspaceExecutorId skips offline, managed-cloud and missing preferred executors', () => {
  assert.equal(resolveDefaultWorkspaceExecutorId({
    visibleExecutors: [
      createExecutor({ executorId: 'cloud', executorSource: 'managed-cloud', managedBy: 'vibemux' }),
      createExecutor({ executorId: 'cloud-paired', status: 'paired' }),
      createExecutor({ executorId: 'offline-local', status: 'offline' }),
    ],
    preferredExecutorId: 'missing-preferred',
  }), null)
})

test('resolveDefaultWorkspaceExecutorId falls back to the first online local when preferred is not online', () => {
  assert.equal(resolveDefaultWorkspaceExecutorId({
    visibleExecutors: [
      createExecutor({ executorId: 'preferred-offline', status: 'offline' }),
      createExecutor({ executorId: 'local-a' }),
    ],
    preferredExecutorId: 'preferred-offline',
  }), 'local-a')
})

test('resolveDefaultWorkspaceExecutorId returns null when only cloud executors are visible', () => {
  assert.equal(resolveDefaultWorkspaceExecutorId({
    visibleExecutors: [
      createExecutor({ executorId: 'cloud', executorSource: 'managed-cloud', managedBy: 'vibemux', status: 'online' }),
    ],
  }), null)
})
