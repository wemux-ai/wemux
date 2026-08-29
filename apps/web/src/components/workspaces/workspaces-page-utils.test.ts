import assert from 'node:assert/strict'
import test from 'node:test'
import type { ExecutorRecord, Project, Task, TaskWorkspaceBinding, WorkspaceSession, Workspace } from '@shared/types'
import type { WorkspaceListItem } from './workspaces-page-utils'
import {
  buildWorkspacePrimaryViewSearchPatch,
  buildWorkspaceTerminalSearchPatch,
  buildWorkspaceItems,
  reconcileWorkspaceItems,
  resolveCurrentWorkspacePrimaryView,
  resolveCurrentWorkspaceTerminalCollapsed,
  resolveWorkspacesPageMobileView,
  resolveWorkspaceDirectorySelectionLoading,
  resolveWorkspaceListItemDefaultSessionTarget,
  resolveWorkspaceListSelection,
  resolveWorkspacePrimaryViewForWorkspace,
  resolveWorkspaceRouteWorkspaceId,
  resolveWorkspaceTerminalCollapsed,
  shouldReplaceWorkspacesDetailHistoryEntry,
} from './workspaces-page-utils'
import { resolveLinkedWorkspacePullRequestDisplay } from '../../lib/task-pull-request'

const createProject = (overrides: Partial<Project> = {}): Project => ({
  id: 'project-1',
  name: 'Vibemux',
  color: '#34d399',
  defaultBranch: 'main',
  createdAt: '2026-05-12T00:00:00.000Z',
  updatedAt: '2026-05-12T00:00:00.000Z',
  ...overrides,
} as Project)

const createWorkspace = (overrides: Partial<Workspace> = {}): Workspace => ({
  id: 'workspace-1',
  projectId: 'project-1',
  name: '工作区 1',
  source: 'manual',
  workingDirectoryMode: 'original-dir',
  createdAt: '2026-05-12T00:00:00.000Z',
  updatedAt: '2026-05-12T00:00:00.000Z',
  executorName: 'Executor 1',
  executorStatus: 'online',
  agentType: 'OpenCode',
  repoReady: true,
  status: 'ready',
  executorNodeId: 'executor-1',
  ...overrides,
} as Workspace)

const createTask = (overrides: Partial<Task> = {}): Task => ({
  id: 'task-1',
  projectId: 'project-1',
  title: '修复异常状态展示',
  updatedAt: '2026-05-12T00:00:00.000Z',
  createdAt: '2026-05-12T00:00:00.000Z',
  agentType: 'OpenCode',
  executionMode: 'auto',
  gitIdentityMode: 'personal',
  agentManaged: 'ai',
  baseBranch: 'main',
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
  status: 'todo',
  priority: 'medium',
  difficulty: 'medium',
  retryCount: 0,
  description: '',
  acceptanceCriteria: '',
  ...overrides,
} as Task)

const createBinding = (overrides: Partial<TaskWorkspaceBinding> = {}): TaskWorkspaceBinding => ({
  id: 'binding-1',
  taskId: 'task-1',
  workspaceId: 'workspace-1',
  status: 'active',
  createdAt: '2026-05-12T00:00:00.000Z',
  updatedAt: '2026-05-12T00:00:00.000Z',
  ...overrides,
} as TaskWorkspaceBinding)

const createSession = (overrides: Partial<WorkspaceSession> = {}): WorkspaceSession => ({
  id: 'session-1',
  workspaceId: 'workspace-1',
  title: '会话 1',
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
  lastActiveAt: '2026-05-12T00:00:00.000Z',
  createdAt: '2026-05-12T00:00:00.000Z',
  updatedAt: '2026-05-12T00:00:00.000Z',
  ...overrides,
} as WorkspaceSession)

const createExecutor = (overrides: Partial<ExecutorRecord> = {}): ExecutorRecord => ({
  executorId: 'executor-1',
  machineId: 'machine-1',
  machineName: 'Machine 1',
  name: 'Executor 1',
  ownerUserId: 'user-1',
  visibility: 'private',
  status: 'online',
  workspaceRoot: '/tmp/workspaces',
  maxConcurrency: 2,
  capabilities: [],
  labels: [],
  createdAt: '2026-05-12T00:00:00.000Z',
  ...overrides,
} as ExecutorRecord)

test('keeps the route-selected workspace while the workspace directory is still loading', () => {
  assert.deepEqual(
    resolveWorkspaceListSelection({
      filteredWorkspaceIds: [],
      loading: true,
      routeWorkspaceId: 'workspace-b',
      selectedWorkspaceId: 'workspace-b',
    }),
    {
      nextWorkspaceId: 'workspace-b',
      shouldUpdateRoute: false,
    },
  )
})

test('treats an explicit route target as loading while the workspace directory is still refreshing', () => {
  assert.equal(resolveWorkspaceDirectorySelectionLoading({
    loading: false,
    fetching: true,
    routeWorkspaceId: 'workspace-b',
  }), true)
  assert.equal(resolveWorkspaceDirectorySelectionLoading({
    loading: false,
    fetching: true,
    routeWorkspaceId: '',
  }), false)
})

test('opens the mobile workspaces page directly in detail view for a route workspace target', () => {
  assert.equal(resolveWorkspacesPageMobileView({
    panelMode: 'detail',
    routeWorkspaceId: 'workspace-b',
  }), 'detail')
})

test('keeps the mobile workspaces page on list view without a route workspace target', () => {
  assert.equal(resolveWorkspacesPageMobileView({
    panelMode: 'detail',
  }), 'list')
})

test('prioritizes mobile create view over a route workspace target', () => {
  assert.equal(resolveWorkspacesPageMobileView({
    create: '1',
    panelMode: 'detail',
    routeWorkspaceId: 'workspace-b',
    searchMobileView: 'detail',
  }), 'create')
})

test('keeps a mobile workspace list history entry when opening detail view', () => {
  assert.equal(shouldReplaceWorkspacesDetailHistoryEntry({
    isMobile: true,
    nextMobileView: 'detail',
  }), false)
})

test('continues replacing history for desktop and non-detail workspace navigation', () => {
  assert.equal(shouldReplaceWorkspacesDetailHistoryEntry({
    isMobile: false,
    nextMobileView: 'detail',
  }), true)
  assert.equal(shouldReplaceWorkspacesDetailHistoryEntry({
    isMobile: true,
    nextMobileView: 'list',
  }), true)
})

test('keeps the route-selected workspace after the workspace list finishes loading', () => {
  assert.deepEqual(
    resolveWorkspaceListSelection({
      filteredWorkspaceIds: ['workspace-a', 'workspace-b'],
      loading: false,
      routeWorkspaceId: 'workspace-b',
      selectedWorkspaceId: 'workspace-b',
    }),
    {
      nextWorkspaceId: 'workspace-b',
      shouldUpdateRoute: false,
    },
  )
})

test('keeps the route-selected archived workspace when it remains visible', () => {
  assert.deepEqual(
    resolveWorkspaceListSelection({
      filteredWorkspaceIds: ['workspace-active', 'workspace-archived'],
      loading: false,
      routeWorkspaceId: 'workspace-archived',
      selectedWorkspaceId: 'workspace-archived',
    }),
    {
      nextWorkspaceId: 'workspace-archived',
      shouldUpdateRoute: false,
    },
  )
})

test('prefers the route-selected workspace over a stale local selection', () => {
  assert.deepEqual(
    resolveWorkspaceListSelection({
      filteredWorkspaceIds: ['workspace-a', 'workspace-b'],
      loading: false,
      routeWorkspaceId: 'workspace-b',
      selectedWorkspaceId: 'workspace-a',
    }),
    {
      nextWorkspaceId: 'workspace-b',
      shouldUpdateRoute: false,
    },
  )
})

test('falls back to the first visible workspace after loading when the selection is invalid', () => {
  assert.deepEqual(
    resolveWorkspaceListSelection({
      filteredWorkspaceIds: ['workspace-a', 'workspace-b'],
      loading: false,
      routeWorkspaceId: 'workspace-missing',
      selectedWorkspaceId: 'workspace-missing',
    }),
    {
      nextWorkspaceId: 'workspace-a',
      shouldUpdateRoute: true,
    },
  )
})

test('clears the route selection after loading when no visible workspaces remain', () => {
  assert.deepEqual(
    resolveWorkspaceListSelection({
      filteredWorkspaceIds: [],
      loading: false,
      routeWorkspaceId: 'workspace-missing',
      selectedWorkspaceId: 'workspace-missing',
    }),
    {
      nextWorkspaceId: '',
      shouldUpdateRoute: true,
    },
  )
})

test('resolves the route workspace directly when workspaceId is present', () => {
  assert.equal(resolveWorkspaceRouteWorkspaceId({
    routeWorkspaceId: 'workspace-direct',
    routeWorkspaceSessionId: 'session-1',
    routeTaskId: 'task-1',
    taskWorkspaceBindings: [createBinding()],
    workspaceSessions: [createSession()],
  }), 'workspace-direct')
})

test('resolves the route workspace from workspaceSessionId when workspaceId is missing', () => {
  assert.equal(resolveWorkspaceRouteWorkspaceId({
    routeWorkspaceSessionId: 'session-target',
    routeTaskId: 'task-1',
    taskWorkspaceBindings: [createBinding()],
    workspaceSessions: [createSession({
      id: 'session-target',
      workspaceId: 'workspace-target',
    })],
  }), 'workspace-target')
})

test('resolves the route workspace from the active task binding when only taskId is present', () => {
  assert.equal(resolveWorkspaceRouteWorkspaceId({
    routeTaskId: 'task-target',
    taskWorkspaceBindings: [
      createBinding({
        taskId: 'task-target',
        workspaceId: 'workspace-bound',
      }),
    ],
    workspaceSessions: [],
  }), 'workspace-bound')
})

test('resolves a workspace row default session target from the first session preview', () => {
  const items = buildWorkspaceItems(
    [createProject()],
    { 'project-1': [createWorkspace()] },
    [createTask()],
    [createBinding()],
    [
      createSession({
        id: 'session-old',
        title: '旧会话',
        lastActiveAt: '2026-05-12T00:00:00.000Z',
      }),
      createSession({
        id: 'session-latest',
        title: '最近会话',
        lastActiveAt: '2026-05-13T00:00:00.000Z',
      }),
    ],
    'zh',
  )

  assert.deepEqual(resolveWorkspaceListItemDefaultSessionTarget(items[0]!), {
    workspaceId: 'workspace-1',
    workspaceSessionId: 'session-latest',
    taskId: 'task-1',
  })
})

test('leaves workspace rows without session previews on the workspace detail path', () => {
  const items = buildWorkspaceItems(
    [createProject()],
    { 'project-1': [createWorkspace()] },
    [createTask()],
    [createBinding()],
    [],
    'zh',
  )

  assert.equal(resolveWorkspaceListItemDefaultSessionTarget(items[0]!), null)
})

test('maps workspace owner and presence metadata into list items', () => {
  const items = buildWorkspaceItems(
    [createProject()],
    {
      'project-1': [
        createWorkspace({
          ownerUserId: 'user-owner',
          ownerUserName: 'May',
          ownerAvatarUrl: '/uploads/may.png',
        }),
      ],
    },
    [createTask()],
    [createBinding()],
    [],
    'zh',
    {},
    {
      'workspace-1': [
        {
          workspaceId: 'workspace-1',
          userId: 'user-peer',
          name: 'Alex',
          state: 'working',
          lastSeenAt: '2026-05-12T00:01:00.000Z',
          activeWorkspaceSessionId: 'session-peer',
        },
      ],
    },
  )

  assert.deepEqual(items[0]?.creatorProfile, {
    id: 'user-owner',
    type: 'user',
    name: 'May',
    avatarUrl: '/uploads/may.png',
  })
  assert.equal(items[0]?.activePresenceUsers[0]?.userId, 'user-peer')
  assert.equal(items[0]?.activePresenceUsers[0]?.state, 'working')
})

test('prefers an Agent creator over the workspace owner in list items', () => {
  const items = buildWorkspaceItems(
    [createProject()],
    {
      'project-1': [
        createWorkspace({
          ownerUserId: 'user-owner',
          ownerUserName: 'May',
          ownerAvatarUrl: '/uploads/may.png',
          createdBy: {
            type: 'agent',
            id: 'agent-research',
            name: 'Research Agent',
            avatarUrl: '/agents/avatars/agent-research.png',
          },
        }),
      ],
    },
    [createTask()],
    [createBinding()],
    [],
    'zh',
  )

  assert.deepEqual(items[0]?.creatorProfile, {
    id: 'agent-research',
    type: 'agent',
    name: 'Research Agent',
    avatarUrl: '/agents/avatars/agent-research.png',
  })
})

test('defaults a new workspace terminal to collapsed when it has no stored state', () => {
  assert.equal(resolveWorkspaceTerminalCollapsed('workspace-b', {
    'workspace-a': false,
  }), true)
  assert.deepEqual(
    buildWorkspaceTerminalSearchPatch({
      workspaceId: 'workspace-b',
      terminalCollapsedByWorkspaceId: {
        'workspace-a': false,
      },
    }),
    {
      terminal: undefined,
    },
  )
})

test('restores the remembered terminal state for the selected workspace only', () => {
  assert.equal(resolveWorkspaceTerminalCollapsed('workspace-a', {
    'workspace-a': false,
    'workspace-b': true,
  }), false)
  assert.deepEqual(
    buildWorkspaceTerminalSearchPatch({
      workspaceId: 'workspace-a',
      terminalCollapsedByWorkspaceId: {
        'workspace-a': false,
        'workspace-b': true,
      },
    }),
    {
      terminal: '1',
    },
  )
})

test('does not inherit another workspace route terminal state during selection handoff', () => {
  assert.equal(
    resolveCurrentWorkspaceTerminalCollapsed({
      selectedWorkspaceId: 'workspace-b',
      routeWorkspaceId: 'workspace-a',
      routeTerminal: '1',
      terminalCollapsedByWorkspaceId: {
        'workspace-a': false,
      },
    }),
    true,
  )
})

test('uses the route terminal state when the route already points at the selected workspace', () => {
  assert.equal(
    resolveCurrentWorkspaceTerminalCollapsed({
      selectedWorkspaceId: 'workspace-a',
      routeWorkspaceId: 'workspace-a',
      routeTerminal: '1',
      terminalCollapsedByWorkspaceId: {},
    }),
    false,
  )
})

test('defaults a new workspace primary view to chat when it has no stored state', () => {
  assert.equal(resolveWorkspacePrimaryViewForWorkspace('workspace-b', {
    'workspace-a': 'preview',
  }), 'chat')
  assert.deepEqual(
    buildWorkspacePrimaryViewSearchPatch({
      workspaceId: 'workspace-b',
      primaryViewByWorkspaceId: {
        'workspace-a': 'preview',
      },
    }),
    {
      panel: undefined,
    },
  )
})

test('restores the remembered primary view for the selected workspace only', () => {
  assert.equal(resolveWorkspacePrimaryViewForWorkspace('workspace-a', {
    'workspace-a': 'preview',
    'workspace-b': 'files',
  }), 'preview')
  assert.deepEqual(
    buildWorkspacePrimaryViewSearchPatch({
      workspaceId: 'workspace-a',
      primaryViewByWorkspaceId: {
        'workspace-a': 'preview',
        'workspace-b': 'files',
      },
    }),
    {
      panel: 'preview',
    },
  )
})

test('does not inherit another workspace route panel during selection handoff', () => {
  assert.equal(
    resolveCurrentWorkspacePrimaryView({
      selectedWorkspaceId: 'workspace-b',
      routeWorkspaceId: 'workspace-a',
      routePanel: 'preview',
      primaryViewByWorkspaceId: {
        'workspace-a': 'preview',
      },
    }),
    'chat',
  )
})

test('uses the route panel state when the route already points at the selected workspace', () => {
  assert.equal(
    resolveCurrentWorkspacePrimaryView({
      selectedWorkspaceId: 'workspace-a',
      routeWorkspaceId: 'workspace-a',
      routePanel: 'preview',
      primaryViewByWorkspaceId: {},
    }),
    'preview',
  )
})

test('workspace list counts runtime errors even when agent status is stale complete', () => {
  const items = buildWorkspaceItems(
    [createProject()],
    { 'project-1': [createWorkspace()] },
    [createTask()],
    [createBinding()],
    [createSession({ agentRunningStatus: 'complete', runtimeStatus: 'lost' })],
    'zh',
  )

  assert.equal(items[0]?.errorCount, 1)
})

test('workspace list keeps sessions in running count while runtime status is active', () => {
  // PR 合并/交付刷新等路径只写 agentRunningStatus='complete' 而保留 runtimeStatus='running'，
  // 此时 executor 心跳仍认为任务在跑，卡片应保持「运行中」而不是闪没。
  const items = buildWorkspaceItems(
    [createProject()],
    { 'project-1': [createWorkspace()] },
    [createTask()],
    [createBinding()],
    [createSession({ agentRunningStatus: 'complete', runtimeStatus: 'running' })],
    'zh',
  )

  assert.equal(items[0]?.runningCount, 1)
  assert.equal(items[0]?.unreadCount, 0)
  assert.equal(items[0]?.errorCount, 0)
})

test('workspace list clears acknowledged runtime errors from the error count', () => {
  const items = buildWorkspaceItems(
    [createProject()],
    { 'project-1': [createWorkspace()] },
    [createTask()],
    [createBinding()],
    [createSession({ agentRunningStatus: 'complete', runtimeStatus: 'lost' })],
    'zh',
    {
      acknowledgedSessionAttentionById: {
        'session-1': 'error:0:2026-05-12T00:00:00.000Z',
      },
    },
  )

  assert.equal(items[0]?.errorCount, 0)
})

test('workspace list keeps linked tasks scoped to the workspace project', () => {
  const items = buildWorkspaceItems(
    [
      createProject({ id: 'project-1' }),
      createProject({ id: 'project-2', name: 'Other Project' }),
    ],
    {
      'project-1': [createWorkspace({ id: 'workspace-1', projectId: 'project-1' })],
      'project-2': [createWorkspace({ id: 'workspace-2', projectId: 'project-2' })],
    },
    [
      createTask({ id: 'task-1', projectId: 'project-1', title: 'Task A' }),
      createTask({ id: 'task-2', projectId: 'project-2', title: 'Task B' }),
    ],
    [
      createBinding({ id: 'binding-1', workspaceId: 'workspace-1', taskId: 'task-1' }),
      createBinding({ id: 'binding-2', workspaceId: 'workspace-1', taskId: 'task-2' }),
    ],
    [],
    'zh',
  )

  assert.deepEqual(items[0]?.linkedTasks.map((task) => task.id), ['task-1'])
})

test('workspace list ignores legacy session links when the workspace binding is no longer active', () => {
  const items = buildWorkspaceItems(
    [createProject()],
    { 'project-1': [createWorkspace()] },
    [
      createTask({
        result: {
          taskId: 'task-1',
          status: 'completed',
          returnMode: 'commit',
          summary: 'done',
          filesChanged: [],
          startedAt: '2026-05-12T00:00:00.000Z',
          completedAt: '2026-05-12T00:10:00.000Z',
          durationSec: 600,
          executorNodeId: 'executor-1',
          workspaceId: 'workspace-1',
          workspaceSessionId: 'session-1',
          delivery: {
            mode: 'commit',
            pullRequest: {
              ready: true,
              remoteReady: true,
              repoUrl: 'https://github.com/example/repo',
              title: 'PR A',
              description: 'body',
              baseBranch: 'main',
              compareBranch: 'feature/a',
              number: 101,
              url: 'https://github.com/example/repo/pull/101',
              state: 'open',
            },
          },
        },
      }),
    ],
    [
      createBinding({
        status: 'detached',
      }),
    ],
    [
      createSession({
        workspaceId: 'workspace-1',
      }),
    ],
    'zh',
  )

  assert.deepEqual(items[0]?.linkedTasks.map((task) => task.id), [])
  assert.equal(resolveLinkedWorkspacePullRequestDisplay({
    tasks: items[0]?.linkedTasks ?? [],
    workspaceId: 'workspace-1',
  }), null)
})

test('workspace list representative branch fields follow the selected workspace session preview', () => {
  const items = buildWorkspaceItems(
    [createProject()],
    { 'project-1': [createWorkspace({ workingDirectoryMode: 'worktree' })] },
    [createTask()],
    [createBinding()],
    [
      createSession({
        id: 'session-latest',
        title: '最新会话',
        baseBranch: 'main',
        branchName: 'feature/latest',
        worktreeId: 'worktree-latest',
        worktreeStatus: 'created',
        workingDirectoryMode: 'worktree',
        lastActiveAt: '2026-05-13T00:00:00.000Z',
        updatedAt: '2026-05-13T00:00:00.000Z',
      }),
      createSession({
        id: 'session-selected',
        title: '已选会话',
        baseBranch: 'release',
        branchName: 'feature/selected',
        worktreeId: 'worktree-selected',
        worktreeStatus: 'cleaned',
        workingDirectoryMode: 'worktree',
        lastActiveAt: '2026-05-12T00:00:00.000Z',
        updatedAt: '2026-05-12T00:00:00.000Z',
      }),
    ],
    'zh',
    {
      selectedWorkspaceSessionId: 'session-selected',
    },
  )

  assert.equal(items[0]?.sessionPreviews[0]?.id, 'session-selected')
  assert.equal(items[0]?.currentSessionTitle, '已选会话')
  assert.equal(items[0]?.baseBranch, 'release')
  assert.equal(items[0]?.worktreeBranchName, 'feature/selected')
  assert.equal(items[0]?.worktreeLabel, 'feature/selected')
  assert.equal(items[0]?.worktreeStatusLabel, '已清理')
})

test('workspace list summary prefers the representative workspace session before falling back', () => {
  const items = buildWorkspaceItems(
    [createProject()],
    { 'project-1': [createWorkspace({ workingDirectoryMode: 'worktree' })] },
    [createTask()],
    [createBinding()],
    [
      createSession({
        id: 'session-latest',
        title: '最新会话',
        historyProjection: {
          sessionId: 'session-latest',
          taskId: 'task-1',
          workspaceId: 'workspace-1',
          latestEventSeq: 3,
          totalEventCount: 3,
          updatedAt: '2026-05-13T00:00:00.000Z',
          lastEventAt: '2026-05-13T00:00:00.000Z',
          hasPersistedHistory: true,
          latestAssistantMessagePreview: '最新摘要',
          deletedTurnCount: 0,
        },
        lastActiveAt: '2026-05-13T00:00:00.000Z',
        updatedAt: '2026-05-13T00:00:00.000Z',
      }),
      createSession({
        id: 'session-selected',
        title: '已选会话',
        historyProjection: {
          sessionId: 'session-selected',
          taskId: 'task-1',
          workspaceId: 'workspace-1',
          latestEventSeq: 2,
          totalEventCount: 2,
          updatedAt: '2026-05-12T00:00:00.000Z',
          lastEventAt: '2026-05-12T00:00:00.000Z',
          hasPersistedHistory: true,
          latestAssistantMessagePreview: '选中摘要',
          deletedTurnCount: 0,
        },
        lastActiveAt: '2026-05-12T00:00:00.000Z',
        updatedAt: '2026-05-12T00:00:00.000Z',
      }),
    ],
    'zh',
    {
      selectedWorkspaceSessionId: 'session-selected',
    },
  )

  assert.equal(items[0]?.sessionPreviews[0]?.id, 'session-selected')
  assert.equal(items[0]?.summaryText, '选中摘要')
  assert.equal(items[0]?.summaryKind, 'history')
})

test('workspace list exposes the current executor display name from the running workspace session', () => {
  const items = buildWorkspaceItems(
    [createProject()],
    { 'project-1': [createWorkspace({ executorName: 'Fallback Workspace Executor' })] },
    [createTask()],
    [createBinding()],
    [
      createSession({
        agentRunningStatus: 'executing',
        runtimeStatus: 'running',
        runtimeOwnerExecutorId: 'executor-2',
        executorNodeId: 'executor-1',
      }),
    ],
    'zh',
    {
      executors: [
        createExecutor(),
        createExecutor({
          executorId: 'executor-2',
          name: 'Executor 2',
          machineId: 'machine-2',
          machineName: 'Machine 2',
        }),
      ],
    },
  )

  assert.equal(items[0]?.currentExecutorId, 'executor-2')
  assert.equal(items[0]?.currentExecutorDisplayName, 'Executor 2')
})

test('workspace list recent activity prefers workspace session activity over stale workspace updatedAt', () => {
  const items = buildWorkspaceItems(
    [createProject()],
    {
      'project-1': [
        createWorkspace({
          id: 'workspace-stale',
          name: '旧工作区',
          updatedAt: '2026-05-10T00:00:00.000Z',
        }),
        createWorkspace({
          id: 'workspace-fresh',
          name: '新工作区',
          updatedAt: '2026-05-12T00:00:00.000Z',
        }),
      ],
    },
    [
      createTask({
        id: 'task-stale',
        updatedAt: '2026-05-10T00:00:00.000Z',
        createdAt: '2026-05-10T00:00:00.000Z',
      }),
      createTask({
        id: 'task-fresh',
        updatedAt: '2026-05-12T00:00:00.000Z',
        createdAt: '2026-05-12T00:00:00.000Z',
      }),
    ],
    [
      createBinding({
        id: 'binding-stale',
        taskId: 'task-stale',
        workspaceId: 'workspace-stale',
      }),
      createBinding({
        id: 'binding-fresh',
        taskId: 'task-fresh',
        workspaceId: 'workspace-fresh',
      }),
    ],
    [
      createSession({
        id: 'session-stale',
        workspaceId: 'workspace-stale',
        lastActiveAt: '2026-05-13T00:00:00.000Z',
        updatedAt: '2026-05-13T00:00:00.000Z',
      }),
      createSession({
        id: 'session-fresh',
        workspaceId: 'workspace-fresh',
        lastActiveAt: '2026-05-12T00:00:00.000Z',
        updatedAt: '2026-05-12T00:00:00.000Z',
      }),
    ],
    'zh',
  )

  assert.deepEqual(items.map((item) => item.workspace.id), ['workspace-stale', 'workspace-fresh'])
  assert.equal(items[0]?.recentActivityAt, '2026-05-13T00:00:00.000Z')
})

test('reconcileWorkspaceItems preserves references for unchanged rows and replaces changed rows', () => {
  const first = { workspace: { id: 'ws-1' }, sessionCount: 1 } as WorkspaceListItem
  const second = { workspace: { id: 'ws-2' }, sessionCount: 1 } as WorkspaceListItem
  const previous = [first, second]

  const reconciledSame = reconcileWorkspaceItems(previous, [
    { workspace: { id: 'ws-1' }, sessionCount: 1 } as WorkspaceListItem,
    { workspace: { id: 'ws-2' }, sessionCount: 1 } as WorkspaceListItem,
  ])
  assert.equal(reconciledSame, previous)
  assert.equal(reconciledSame[0], first)
  assert.equal(reconciledSame[1], second)

  const reconciledChanged = reconcileWorkspaceItems(previous, [
    { workspace: { id: 'ws-1' }, sessionCount: 1 } as WorkspaceListItem,
    { workspace: { id: 'ws-2' }, sessionCount: 2 } as WorkspaceListItem,
  ])
  assert.notEqual(reconciledChanged, previous)
  assert.equal(reconciledChanged[0], first)
  assert.notEqual(reconciledChanged[1], second)
  assert.equal(reconciledChanged[1]?.sessionCount, 2)
})
