import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildWorkspaceCodeBranchName,
  clearWorkspaceRuntimeSessionId,
  createWorkspaceSession,
  getWorkspaceRuntimeSessionId,
  mergeWorkspaceSession,
  applyWorkspaceCodeStateToSession,
  preserveWorkspaceSessionTitle,
  resolveWorkspaceSessionExecutorId,
  resolveWorkspaceCodeStateView,
  rebindWorkspaceSessionToExecutor,
  resolveNextWorkspaceSessionDisplayOrder,
  resolveWorkspaceDirectoryView,
  resolveWorkspaceExecutionContext,
  resolveWorkspaceExecutionPreference,
  resolveWorkspaceSessionRuntimeView,
  resolveWorkspaceWorkerId,
  resolveWorkspaceSessionBranchName,
  resolveWorkspaceCodeBranchName,
  sortWorkspaceSessions,
  setWorkspaceSessionPinned,
  setWorkspaceRuntimeSessionId,
  stripWorkspaceExecutionFieldsFromTask,
  syncWorkspaceSessionFromTaskExecutionView,
} from './task-workspace'
import { VIBEMUX_MCP_SERVER_ID } from './mcp'
import { createExecutionLog } from './task-orchestrator'
import type { Task, WorkspaceSession, WorkspaceRecord } from './types'

const createTask = (): Task => ({
  id: 'task-1',
  projectId: 'project-1',
  title: '修复工作区会话 handoff',
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

const createSession = (): WorkspaceSession => ({
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
  agentSessionId: undefined,
  opencodeSessionId: undefined,
  runtimeContinuations: [],
  handoffSnapshot: {
    updatedAt: '2026-05-07T00:00:00.000Z',
    messageCount: 2,
    latestUserMessage: '先看切模型链路',
    latestAssistantMessage: '好的，我先查 continuation scope',
    summaryLines: ['较早用户：先看切模型链路'],
    recentMessages: [
      {
        role: 'user',
        content: '先看切模型链路',
        createdAt: '2026-05-07T00:00:00.000Z',
      },
      {
        role: 'assistant',
        content: '好的，我先查 continuation scope',
        createdAt: '2026-05-07T00:00:02.000Z',
      },
    ],
  },
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
})

const createWorkspace = (patch: Partial<WorkspaceRecord> = {}): WorkspaceRecord => ({
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
  suggestedBaseBranch: 'main',
  createdAt: '2026-05-07T00:00:00.000Z',
  updatedAt: '2026-05-07T00:00:00.000Z',
  ...patch,
})

test('getWorkspaceRuntimeSessionId only resumes the matching runtime scope', () => {
  const session = createSession()
  const openCodeScope = {
    runtimeId: 'OpenCode' as const,
    executorId: 'executor-1',
    executionModel: 'openai/gpt-5',
    cwd: '/repo/worktree',
  }
  const persisted = setWorkspaceRuntimeSessionId(session, openCodeScope, 'opencode-session-1')

  const scopedSession = {
    ...session,
    runtimeContinuations: persisted,
  }

  assert.equal(getWorkspaceRuntimeSessionId(scopedSession, openCodeScope), 'opencode-session-1')
  assert.equal(getWorkspaceRuntimeSessionId(scopedSession, {
    ...openCodeScope,
    runtimeId: 'Codex',
  }), undefined)
  assert.equal(getWorkspaceRuntimeSessionId(scopedSession, {
    ...openCodeScope,
    executionModel: 'openai/gpt-4.1',
  }), undefined)
})

test('clearWorkspaceRuntimeSessionId removes only the broken continuation scope', () => {
  const session = createSession()
  const openCodeScope = {
    runtimeId: 'OpenCode' as const,
    executorId: 'executor-1',
    executionModel: 'openai/gpt-5',
    cwd: '/repo/worktree',
  }
  const codexScope = {
    runtimeId: 'Codex' as const,
    executorId: 'executor-1',
    executionModel: 'openai/gpt-5',
    cwd: '/repo/worktree',
  }

  const withOpenCode = {
    ...session,
    runtimeContinuations: setWorkspaceRuntimeSessionId(session, openCodeScope, 'opencode-session-1'),
  }
  const withBoth = {
    ...withOpenCode,
    runtimeContinuations: setWorkspaceRuntimeSessionId(withOpenCode, codexScope, 'codex-session-1'),
  }

  const nextContinuations = clearWorkspaceRuntimeSessionId(withBoth, codexScope)

  assert.equal(nextContinuations.length, 1)
  assert.equal(getWorkspaceRuntimeSessionId({
    ...withBoth,
    runtimeContinuations: nextContinuations,
  }, openCodeScope), 'opencode-session-1')
})

test('applyWorkspaceCodeStateToSession treats workspace code branch as the source of truth', () => {
  const session = createSession()
  const workspace = createWorkspace({
    codeBaseBranch: 'dev',
    codeBranchName: 'vibemux/workspace-code',
  })

  const scopedSession = applyWorkspaceCodeStateToSession(session, workspace)

  assert.equal(scopedSession.baseBranch, 'dev')
  assert.equal(scopedSession.branchName, 'vibemux/workspace-code')
})

test('resolveWorkspaceCodeBranchName uses the base branch for original directory workspaces', () => {
  const workspace = createWorkspace({
    workingDirectoryMode: 'original-dir',
    codeBranchName: undefined,
    defaultBranch: 'main',
  })

  assert.equal(resolveWorkspaceCodeBranchName({
    workspace,
    fallbackBaseBranch: 'dev',
  }), 'dev')
})

test('buildWorkspaceCodeBranchName adds a discriminator for new workspace code baselines', () => {
  assert.equal(
    buildWorkspaceCodeBranchName({
      workspaceId: 'workspace-123456',
      workspaceName: 'Design Lab',
      discriminator: 'dev-mib9',
    }),
    'wemux/work-design-lab-dev-mib9',
  )
})

test('resolveWorkspaceCodeStateView prefers workspace code state over legacy session branch fields', () => {
  const session = createSession()
  const workspace = createWorkspace({
    codeBaseBranch: 'dev',
    codeBranchName: 'vibemux/workspace-code',
  })

  const codeState = resolveWorkspaceCodeStateView({
    workspace,
    session: {
      ...session,
      baseBranch: 'main',
      branchName: 'vibemux/session-branch',
    },
  })

  assert.deepEqual(codeState, {
    workspaceId: workspace.id,
    baseBranch: 'dev',
    branchName: 'vibemux/workspace-code',
    workingDirectoryMode: 'worktree',
  })
})

test('resolveWorkspaceSessionRuntimeView isolates high-churn runtime state from session metadata', () => {
  const session = {
    ...createSession(),
    runtimeOwnerExecutorId: 'executor-runtime',
    runtimeStatus: 'running' as const,
    agentRunningStatus: 'executing' as const,
    runtimeSequence: 4,
    currentStep: '正在执行测试',
  }

  const runtime = resolveWorkspaceSessionRuntimeView(session, 'executor-workspace')

  assert.equal(runtime.workspaceSessionId, session.id)
  assert.equal(runtime.executorId, 'executor-workspace')
  assert.equal(runtime.runtimeOwnerExecutorId, 'executor-runtime')
  assert.equal(runtime.runtimeStatus, 'running')
  assert.equal(runtime.currentStep, '正在执行测试')
})

test('resolveWorkspaceDirectoryView can point a session at a shared directory source', () => {
  const workspace = createWorkspace()
  const currentSession = createSession()
  const sourceSession = {
    ...createSession(),
    id: 'session-source',
    worktreeId: 'worktree-source',
    worktreeStatus: 'created' as const,
    worktreeUniqueId: 7,
  }

  const directory = resolveWorkspaceDirectoryView({
    workspace,
    session: currentSession,
    sourceSession,
  })

  assert.equal(directory.workspaceSessionId, currentSession.id)
  assert.equal(directory.sourceWorkspaceSessionId, sourceSession.id)
  assert.equal(directory.worktreeId, 'worktree-source')
  assert.equal(directory.worktreeStatus, 'created')
  assert.equal(directory.workingDirectoryMode, 'worktree')
})

test('resolveWorkspaceDirectoryView drops worktreeId for original-dir workspaces (incl. playground)', () => {
  for (const projectId of ['__playground__', 'project-1']) {
    const workspace = createWorkspace({
      projectId,
      workingDirectoryMode: 'original-dir',
    })
    const session = {
      ...createSession(),
      worktreeId: '2026-08-10-k7xq',
      worktreeStatus: 'created' as const,
      workingDirectoryMode: 'original-dir' as const,
    }

    const directory = resolveWorkspaceDirectoryView({
      workspace,
      session,
    })

    // playground 目录由 workspace.repoPath 承载（workspace 创建时生成一次），不依赖 worktreeId
    assert.equal(directory.workingDirectoryMode, 'original-dir')
    assert.equal(directory.worktreeId, undefined)
  }
})

test('resolveWorkspaceExecutionContext returns separate code, runtime, and directory views', () => {
  const task = createTask()
  const workspace = createWorkspace({
    codeBaseBranch: 'dev',
    codeBranchName: 'vibemux/workspace-code',
  })
  const session = {
    ...createSession(),
    branchName: 'vibemux/session-branch',
    executionModel: 'openai/gpt-5.1',
    worktreeStatus: 'created' as const,
  }

  const context = resolveWorkspaceExecutionContext({
    task,
    workspace,
    session,
  })

  assert.equal(context.codeState.branchName, 'vibemux/workspace-code')
  assert.equal(context.directory.worktreeId, session.worktreeId)
  assert.equal(context.directory.worktreeStatus, 'created')
  assert.equal(context.runtime?.workspaceSessionId, session.id)
  assert.equal(context.runtimeConfig.agentType, 'OpenCode')
  assert.equal(context.runtimeConfig.executionModel, 'openai/gpt-5.1')
})

test('resolveWorkspaceExecutionContext supports workspace sessions without a task owner', () => {
  const workspace = createWorkspace({
    codeBranchName: 'vibemux/workspace-only',
  })
  const session = {
    ...createSession(),
    executionModel: undefined,
  }

  const context = resolveWorkspaceExecutionContext({
    workspace,
    session,
    fallbackBaseBranch: 'main',
  })

  assert.equal(context.task, undefined)
  assert.equal(context.codeState.branchName, 'vibemux/workspace-only')
  assert.equal(context.runtimeConfig.agentType, workspace.agentType)
  assert.equal(context.runtime?.workspaceSessionId, session.id)
})

test('sortWorkspaceSessions respects manual display order when the workspace has explicit ordering', () => {
  const orderedLater = {
    ...createSession(),
    id: 'session-2',
    displayOrder: 2,
    lastActiveAt: '2026-05-08T00:00:00.000Z',
  }
  const orderedEarlier = {
    ...createSession(),
    id: 'session-3',
    displayOrder: 1,
    lastActiveAt: '2026-05-06T00:00:00.000Z',
  }
  const orderedLast = {
    ...createSession(),
    id: 'session-4',
    displayOrder: 3,
    lastActiveAt: '2026-05-09T00:00:00.000Z',
  }

  const ordered = sortWorkspaceSessions([orderedLater, orderedLast, orderedEarlier])
  assert.deepEqual(ordered.map((session) => session.id), ['session-3', 'session-2', 'session-4'])
})

test('sortWorkspaceSessions keeps pinned sessions first and latest pin first', () => {
  const unpinnedNewer = {
    ...createSession(),
    id: 'session-2',
    displayOrder: 0,
    lastActiveAt: '2026-05-09T00:00:00.000Z',
  }
  const pinnedEarlier = {
    ...createSession(),
    id: 'session-3',
    displayOrder: 2,
    pinnedAt: '2026-05-08T09:00:00.000Z',
  }
  const pinnedLater = {
    ...createSession(),
    id: 'session-4',
    displayOrder: 1,
    pinnedAt: '2026-05-08T10:00:00.000Z',
  }

  const ordered = sortWorkspaceSessions([unpinnedNewer, pinnedEarlier, pinnedLater])
  assert.deepEqual(ordered.map((session) => session.id), ['session-4', 'session-3', 'session-2'])
})

test('setWorkspaceSessionPinned preserves the original pin timestamp until unpinned', () => {
  const session = createSession()

  const pinned = setWorkspaceSessionPinned(session, true, '2026-05-08T08:00:00.000Z')
  const pinnedAgain = setWorkspaceSessionPinned(pinned, true, '2026-05-08T09:00:00.000Z')
  const unpinned = setWorkspaceSessionPinned(pinnedAgain, false)

  assert.equal(pinned.pinnedAt, '2026-05-08T08:00:00.000Z')
  assert.equal(pinnedAgain.pinnedAt, '2026-05-08T08:00:00.000Z')
  assert.equal(unpinned.pinnedAt, undefined)
})

test('resolveNextWorkspaceSessionDisplayOrder prepends newer sessions ahead of the current top item', () => {
  assert.equal(resolveNextWorkspaceSessionDisplayOrder([]), 0)
  assert.equal(resolveNextWorkspaceSessionDisplayOrder([
    { displayOrder: 0 },
    { displayOrder: 1 },
    { displayOrder: 2 },
  ]), -1)
  assert.equal(resolveNextWorkspaceSessionDisplayOrder([
    { displayOrder: -2 },
    { displayOrder: -1 },
    { displayOrder: 0 },
  ]), -3)
})

test('resolveWorkspaceSessionExecutorId uses the workspace executor when provided', () => {
  assert.equal(resolveWorkspaceSessionExecutorId({
    executorNodeId: 'executor-session-record',
    runtimeOwnerExecutorId: 'executor-session-runtime',
  }, 'executor-workspace'), 'executor-workspace')
  assert.equal(resolveWorkspaceSessionExecutorId({
    executorNodeId: 'executor-workspace',
    runtimeOwnerExecutorId: 'executor-session',
  }), 'executor-session')
  assert.equal(resolveWorkspaceSessionExecutorId({
    executorNodeId: 'executor-workspace',
  }), 'executor-workspace')
  assert.equal(resolveWorkspaceSessionExecutorId(undefined, 'executor-fallback'), 'executor-fallback')
})

test('resolveWorkspaceWorkerId reads the unique worker relation from workspace', () => {
  assert.equal(resolveWorkspaceWorkerId(createWorkspace({ executorNodeId: 'worker-1' })), 'worker-1')
  assert.equal(resolveWorkspaceWorkerId(null), '')
})

test('rebindWorkspaceSessionToExecutor resets runtime state for a new executor', () => {
  const task = createTask()
  const session: WorkspaceSession = {
    ...createSession(),
    executorNodeId: 'executor-1',
    runtimeOwnerExecutorId: 'executor-1',
    agentSessionId: 'agent-session-1',
    opencodeSessionId: 'opencode-session-1',
    runtimeContinuations: [
      {
        runtimeId: 'OpenCode',
        scopeKey: 'scope-1',
        nativeSessionId: 'native-session-1',
        updatedAt: '2026-05-07T00:00:01.000Z',
      },
    ],
    distributedTaskId: 'distributed-task-1',
    runtimeSessionId: 'runtime-session-1',
    runtimeStartedAt: '2026-05-07T00:00:01.000Z',
    lastHeartbeatAt: '2026-05-07T00:00:02.000Z',
    lastRuntimeEventAt: '2026-05-07T00:00:03.000Z',
    terminalReason: 'runtime lost',
    baseBranch: 'dev',
    branchName: 'vibemux/workspace-code',
    worktreeStatus: 'created',
    agentRunningStatus: 'thinking',
    runtimeStatus: 'running',
    needsHumanConfirm: true,
    currentStep: '正在旧节点上运行',
  }

  const rebound = rebindWorkspaceSessionToExecutor(task, session, {
    executorNodeId: 'executor-2',
    currentStep: '已切换执行节点，新 worktree 会在下次运行时准备。',
    updatedAt: '2026-05-07T00:00:10.000Z',
    worktreeUniqueId: 4,
  })

  assert.equal(rebound.executorNodeId, 'executor-2')
  assert.equal(rebound.runtimeOwnerExecutorId, 'executor-2')
  assert.equal(rebound.baseBranch, 'dev')
  assert.equal(rebound.branchName, 'vibemux/workspace-code')
  assert.equal(rebound.worktreeUniqueId, 4)
  assert.equal(rebound.worktreeStatus, 'planned')
  assert.equal(rebound.agentRunningStatus, 'idle')
  assert.equal(rebound.runtimeStatus, 'idle')
  assert.equal(rebound.needsHumanConfirm, false)
  assert.equal(rebound.agentSessionId, undefined)
  assert.equal(rebound.opencodeSessionId, undefined)
  assert.deepEqual(rebound.runtimeContinuations, [])
  assert.equal(rebound.distributedTaskId, undefined)
  assert.equal(rebound.runtimeSessionId, undefined)
  assert.equal(rebound.runtimeStartedAt, undefined)
  assert.equal(rebound.lastHeartbeatAt, undefined)
  assert.equal(rebound.lastRuntimeEventAt, undefined)
  assert.equal(rebound.terminalReason, undefined)
  assert.equal(rebound.currentStep, '已切换执行节点，新 worktree 会在下次运行时准备。')
  assert.equal(rebound.updatedAt, '2026-05-07T00:00:10.000Z')
  assert.equal(rebound.lastActiveAt, '2026-05-07T00:00:10.000Z')
})

test('syncWorkspaceSessionFromTaskExecutionView completes stale running workspace runtime', () => {
  const task = createTask()
  const session: WorkspaceSession = {
    ...createSession(),
    agentRunningStatus: 'executing',
    runtimeStatus: 'running',
    currentStep: 'Claude Code 正在执行工具与生成回复',
  }
  const scopedTask: Task = {
    ...task,
    agentRunningStatus: 'complete',
    needsHumanConfirm: true,
    currentStep: '工作区对话已完成',
    updatedAt: '2026-05-07T00:01:00.000Z',
  }

  const synced = syncWorkspaceSessionFromTaskExecutionView(task, session, scopedTask)

  assert.equal(synced.agentRunningStatus, 'complete')
  assert.equal(synced.runtimeStatus, 'completed')
  assert.equal(synced.needsHumanConfirm, true)
  assert.equal(synced.currentStep, '工作区对话已完成')
})

test('syncWorkspaceSessionFromTaskExecutionView preserves queued runtime while agent is thinking', () => {
  const task = createTask()
  const session: WorkspaceSession = {
    ...createSession(),
    agentRunningStatus: 'thinking',
    runtimeStatus: 'queued',
    currentStep: '执行节点执行队列已满，当前会话正在排队。',
  }
  const scopedTask: Task = {
    ...task,
    agentRunningStatus: 'thinking',
    currentStep: '执行节点执行队列已满，当前会话正在排队。',
    updatedAt: '2026-05-07T00:01:00.000Z',
  }

  const synced = syncWorkspaceSessionFromTaskExecutionView(task, session, scopedTask)

  assert.equal(synced.runtimeStatus, 'queued')
})

test('syncWorkspaceSessionFromTaskExecutionView does not touch activity for route hydration snapshots', () => {
  const task = {
    ...createTask(),
    updatedAt: '2026-05-07T00:10:00.000Z',
  }
  const session: WorkspaceSession = {
    ...createSession(),
    updatedAt: '2026-05-07T00:00:00.000Z',
    lastActiveAt: '2026-05-07T00:00:00.000Z',
  }
  const scopedTask: Task = {
    ...task,
    agentRunningStatus: 'idle',
    currentStep: '',
  }

  const synced = syncWorkspaceSessionFromTaskExecutionView(task, session, scopedTask)

  assert.equal(synced.updatedAt, '2026-05-07T00:00:00.000Z')
  assert.equal(synced.lastActiveAt, '2026-05-07T00:00:00.000Z')
})

test('syncWorkspaceSessionFromTaskExecutionView updates activity for real runtime progress', () => {
  const task = createTask()
  const session: WorkspaceSession = {
    ...createSession(),
    updatedAt: '2026-05-07T00:00:00.000Z',
    lastActiveAt: '2026-05-07T00:00:00.000Z',
  }
  const scopedTask: Task = {
    ...task,
    agentRunningStatus: 'thinking',
    currentStep: '正在分析代码',
    updatedAt: '2026-05-07T00:10:00.000Z',
  }

  const synced = syncWorkspaceSessionFromTaskExecutionView(task, session, scopedTask)

  assert.equal(synced.updatedAt, '2026-05-07T00:10:00.000Z')
  assert.equal(synced.lastActiveAt, '2026-05-07T00:10:00.000Z')
})

test('stripWorkspaceExecutionFieldsFromTask preserves scoped task logs', () => {
  const task = createTask()
  const switchLog = createExecutionLog(
    'system',
    '节点切换：旧节点 → 新节点\n分支：vibemux/test\n正在后台准备新节点上的工作目录。',
    'workspace-1',
    'session-1',
  )
  const scopedTask: Task = {
    ...task,
    logs: [...task.logs, switchLog],
    currentStep: '已切换执行节点，正在后台准备新的工作目录。',
  }

  const stripped = stripWorkspaceExecutionFieldsFromTask(task, scopedTask)

  assert.equal(stripped.logs.length, 1)
  assert.deepEqual(stripped.logs[0], switchLog)
})

test('createWorkspaceSession seeds original-dir sessions with the base branch instead of a placeholder worktree branch', () => {
  const task = createTask()
  const session = createWorkspaceSession({
    task: {
      ...task,
      baseBranch: 'dev',
    },
    workspaceId: 'workspace-1',
    workingDirectoryMode: 'original-dir',
  })

  assert.equal(session.branchName, 'dev')
})

test('createWorkspaceSession enables the built-in vibemux MCP by default', () => {
  const session = createWorkspaceSession({
    task: createTask(),
    workspaceId: 'workspace-1',
  })

  assert.deepEqual(session.enabledMcpServerIds, [VIBEMUX_MCP_SERVER_ID])
})

test('createWorkspaceSession defaults remote-capable tasks to pull-request publishing', () => {
  const session = createWorkspaceSession({
    task: createTask(),
    workspaceId: 'workspace-1',
  })

  assert.equal(session.publishPolicy, 'pull-request')
  assert.equal(session.gitAuthPreference, 'project-default')
})

test('createWorkspaceSession disables publishing for local-only tasks by default', () => {
  const session = createWorkspaceSession({
    task: {
      ...createTask(),
      executionMode: 'local',
    },
    workspaceId: 'workspace-1',
  })

  assert.equal(session.publishPolicy, 'none')
  assert.equal(session.gitAuthPreference, 'project-default')
})

test('mergeWorkspaceSession preserves an explicit disabled publish policy', () => {
  const task = createTask()
  const session: WorkspaceSession = {
    ...createSession(),
    publishPolicy: 'none',
  }

  const merged = mergeWorkspaceSession(task, session, {
    currentStep: '同步会话状态',
  })

  assert.equal(merged.publishPolicy, 'none')
})

test('preserveWorkspaceSessionTitle keeps an AI title when a stale runtime write still has the system title', () => {
  const namedSession: WorkspaceSession = {
    ...createSession(),
    title: '修复工作区会话标题',
    titleOrigin: 'ai',
  }
  const staleRuntimeSession: WorkspaceSession = {
    ...createSession(),
    currentStep: '工作区对话已完成',
    updatedAt: '2026-05-07T00:10:00.000Z',
  }

  const persisted = preserveWorkspaceSessionTitle(namedSession, staleRuntimeSession)

  assert.equal(persisted.title, '修复工作区会话标题')
  assert.equal(persisted.titleOrigin, 'ai')
  assert.equal(persisted.currentStep, '工作区对话已完成')
})

test('resolveWorkspaceExecutionPreference uses explicit, current, successful, then user default configuration', () => {
  const completed = {
    ...createSession(),
    id: 'completed-session',
    agentType: 'ClaudeCode' as const,
    executionModel: 'sonnet',
    runtimeStatus: 'completed' as const,
    lastRuntimeEventAt: '2026-05-07T00:05:00.000Z',
  }
  const defaults = {
    executorNodeId: 'executor-1',
    agentType: 'Codex' as const,
    executionModel: 'gpt-5.6-terra',
  }

  assert.deepEqual(resolveWorkspaceExecutionPreference({
    workspaceId: 'workspace-1',
    executorNodeId: 'executor-1',
    sessions: [completed],
    explicitAgentType: 'Pi',
    explicitExecutionModel: 'openai/gpt-5',
    defaults,
  }), { agentType: 'Pi', executionModel: 'openai/gpt-5', source: 'explicit' })

  assert.deepEqual(resolveWorkspaceExecutionPreference({
    workspaceId: 'workspace-1',
    executorNodeId: 'executor-1',
    sessions: [completed],
    currentSession: { ...createSession(), agentType: 'OpenCode', executionModel: 'openai/gpt-5' },
    defaults,
  }), { agentType: 'OpenCode', executionModel: 'openai/gpt-5', source: 'session' })

  assert.deepEqual(resolveWorkspaceExecutionPreference({
    workspaceId: 'workspace-1',
    executorNodeId: 'executor-1',
    sessions: [completed],
    defaults,
  }), { agentType: 'ClaudeCode', executionModel: 'sonnet', source: 'workspace-history' })

  assert.deepEqual(resolveWorkspaceExecutionPreference({
    workspaceId: 'workspace-1',
    executorNodeId: 'executor-1',
    sessions: [],
    defaults,
  }), { agentType: 'Codex', executionModel: 'gpt-5.6-terra', source: 'user-default' })

  assert.equal(resolveWorkspaceExecutionPreference({
    workspaceId: 'workspace-1',
    executorNodeId: 'executor-2',
    sessions: [],
    defaults,
  }), null)
})

test('preserveWorkspaceSessionTitle accepts an explicit manual rename', () => {
  const automaticTitle: WorkspaceSession = {
    ...createSession(),
    title: '修复工作区会话标题',
    titleOrigin: 'ai',
  }
  const manualTitle: WorkspaceSession = {
    ...automaticTitle,
    title: '手动命名',
    titleOrigin: 'manual',
  }

  const persisted = preserveWorkspaceSessionTitle(automaticTitle, manualTitle)

  assert.equal(persisted.title, '手动命名')
  assert.equal(persisted.titleOrigin, 'manual')
})

test('mergeWorkspaceSession normalizes placeholder original-dir branch names back to the task base branch', () => {
  const task = createTask()
  const session: WorkspaceSession = {
    ...createSession(),
    baseBranch: 'dev',
    branchName: 'vibemux/f7a25e10-task',
    workingDirectoryMode: 'original-dir',
  }

  const merged = mergeWorkspaceSession(task, session, {
    currentStep: '同步会话状态',
  })

  assert.equal(merged.branchName, 'dev')
})

test('resolveWorkspaceSessionBranchName preserves a real original-dir branch name', () => {
  const task = createTask()

  assert.equal(resolveWorkspaceSessionBranchName({
    task: {
      ...task,
      baseBranch: 'dev',
    },
    worktreeId: 'worktree-1',
    workingDirectoryMode: 'original-dir',
    currentBranchName: 'feature/fix-original-dir',
  }), 'feature/fix-original-dir')
})

test('resolveWorkspaceSessionBranchName uses short id followed by workspace name', () => {
  const task = createTask()

  assert.equal(resolveWorkspaceSessionBranchName({
    task: {
      ...task,
      title: '工作区对话 · test',
    },
    worktreeId: '2b4054f3-1111-4222-8333-abcdefabcdef',
    workspaceName: '原目录',
    workingDirectoryMode: 'worktree',
  }), 'wemux/2b40-原目录')
})
