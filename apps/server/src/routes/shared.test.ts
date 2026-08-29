import assert from 'node:assert/strict'
import test from 'node:test'
import { createWorkspaceSession } from '@shared/task-workspace'
import { getScopedState, validateHeartbeatPayload } from './shared'
import { createWorkspaceRecord } from './task-route-support'
import { addUserProject } from '../repositories/auth'
import { saveWorkspace } from '../storage/distributed-task-store'
import { initialState } from '../../../web/src/data/mock'

test('heartbeat payload validation accepts valid cost guards and rejects malformed ones', () => {
  assert.equal(validateHeartbeatPayload({ kind: 'heartbeat', instructions: '检查收件箱' }), null)
  assert.equal(validateHeartbeatPayload({
    kind: 'heartbeat',
    timezone: 'Asia/Shanghai',
    activeWindow: { start: '09:00', end: '21:00', timezone: 'Asia/Shanghai' },
    dailyLimit: 24,
  }), null)
  // 非法时间格式
  assert.ok(validateHeartbeatPayload({ activeWindow: { start: '9:00', end: '21:00' } }))
  // start >= end 由调度器读取层拒绝；这里结构合法但语义由运行时处理
  assert.equal(validateHeartbeatPayload({ activeWindow: { start: '21:00', end: '09:00', timezone: 'UTC' } }), null)
  // 未知时区 / 非法 dailyLimit
  assert.ok(validateHeartbeatPayload({ timezone: 'Mars/Olympus' }))
  assert.ok(validateHeartbeatPayload({ dailyLimit: 0 }))
  assert.ok(validateHeartbeatPayload({ dailyLimit: 5000 }))
  // 未知字段允许（passthrough 兼容非 heartbeat payload）
  assert.equal(validateHeartbeatPayload({ anyCustomKey: 'x' }), null)
})

test('getScopedState returns projects sorted by displayOrder', () => {
  const userId = `user-${crypto.randomUUID()}`
  const baseState = {
    ...initialState,
    projects: [
      {
        ...initialState.projects[1],
        id: 'project-c',
        name: 'C',
        updatedAt: '2026-01-03T00:00:00.000Z',
        displayOrder: 2,
      },
      {
        ...initialState.projects[0],
        id: 'project-a',
        name: 'A',
        updatedAt: '2026-01-05T00:00:00.000Z',
        displayOrder: 0,
      },
      {
        ...initialState.projects[1],
        id: 'project-b',
        name: 'B',
        updatedAt: '2026-01-04T00:00:00.000Z',
        displayOrder: 1,
      },
    ],
    tasks: [],
    projectBindings: [],
    distributedTasks: [],
    taskWorkspaceBindings: [],
    workspaceSessions: [],
    selectedProjectId: 'project-c',
    selectedTaskId: '',
  }
  addUserProject(userId, 'project-a')
  addUserProject(userId, 'project-b')
  addUserProject(userId, 'project-c')

  const scopedState = getScopedState(baseState, userId)
  assert.deepEqual(scopedState.projects.map((project) => project.id), ['project-a', 'project-b', 'project-c'])
  assert.equal(scopedState.selectedProjectId, 'project-c')
})

test('getScopedState omits execution nodes from workspaces scope', () => {
  const userId = `user-${crypto.randomUUID()}`
  const project = initialState.projects[0]
  const baseState = {
    ...initialState,
    projects: [project],
    tasks: [],
    nodes: [{
      nodeId: 'node-1',
      name: 'Node 1',
      status: 'online' as const,
      capabilities: ['terminal'],
      activeTasks: 0,
      maxConcurrentTasks: 2,
      lastHeartbeatAt: '2026-06-09T00:00:00.000Z',
    }],
    projectBindings: [],
    distributedTasks: [],
    taskWorkspaceBindings: [],
    workspaceSessions: [],
    selectedProjectId: project.id,
    selectedTaskId: '',
  }
  addUserProject(userId, project.id)

  const scopedState = getScopedState(baseState, userId, {
    mainChat: 'summary',
    scope: 'workspaces',
  })
  assert.deepEqual(scopedState.nodes, [])
})

test('getScopedState omits main chat and execution nodes from kanban scope while preserving task detail', () => {
  const userId = `user-${crypto.randomUUID()}`
  const project = initialState.projects[0]
  const task = {
    ...initialState.tasks[0],
    id: 'task-kanban-detail',
    projectId: project.id,
    acceptanceCriteria: 'Keep full task details on the kanban page.',
    comments: [{
      id: 'comment-1',
      content: 'Do not drop comments for kanban detail panels.',
      createdAt: '2026-06-09T00:00:00.000Z',
    }],
  }
  const baseState = {
    ...initialState,
    projects: [project],
    tasks: [task],
    nodes: [{
      nodeId: 'node-1',
      name: 'Node 1',
      status: 'online' as const,
      capabilities: ['terminal'],
      activeTasks: 0,
      maxConcurrentTasks: 2,
      lastHeartbeatAt: '2026-06-09T00:00:00.000Z',
    }],
    messages: [{
      id: 'main-chat-message',
      role: 'assistant' as const,
      content: 'This should not be in kanban bootstrap.',
      createdAt: '2026-06-09T00:00:00.000Z',
    }],
    mainChatSessions: [{
      id: 'main-chat-session',
      title: 'Main chat',
      messages: [{
        id: 'main-chat-message',
        role: 'assistant' as const,
        content: 'This should not be in kanban bootstrap.',
        createdAt: '2026-06-09T00:00:00.000Z',
      }],
      createdAt: '2026-06-09T00:00:00.000Z',
      updatedAt: '2026-06-09T00:00:00.000Z',
    }],
    selectedMainChatSessionId: 'main-chat-session',
    projectBindings: [],
    distributedTasks: [],
    taskWorkspaceBindings: [],
    workspaceSessions: [],
    selectedProjectId: project.id,
    selectedTaskId: task.id,
  }
  addUserProject(userId, project.id)

  const scopedState = getScopedState(baseState, userId, {
    mainChat: 'summary',
    scope: 'kanban',
  })

  assert.deepEqual(scopedState.nodes, [])
  assert.deepEqual(scopedState.mainChatSessions, [])
  assert.equal(scopedState.selectedMainChatSessionId, '')
  assert.equal(scopedState.tasks[0]?.acceptanceCriteria, task.acceptanceCriteria)
  assert.equal(scopedState.tasks[0]?.comments.length, 1)
})

test('getScopedState trims task execution details from workspaces scope', () => {
  const userId = `user-${crypto.randomUUID()}`
  const project = initialState.projects[0]
  const task = {
    ...initialState.tasks[0],
    id: 'task-with-result',
    projectId: project.id,
    acceptanceCriteria: 'Long acceptance criteria',
    opencodeConfig: {
      model: 'opencode-model',
      mcpServers: [{
        id: 'server-1',
        name: 'Server 1',
        target: 'https://example.test/mcp',
        transport: 'http' as const,
        enabled: true,
        capabilityMode: 'resources+tools' as const,
      }],
    },
    result: {
      taskId: 'task-with-result',
      status: 'completed' as const,
      returnMode: 'commit' as const,
      summary: 'Finished the task.',
      output: 'Full terminal output that should not be in the workspaces bootstrap payload.',
      filesChanged: ['src/a.ts', 'src/b.ts'],
      commitShas: ['abc123'],
      startedAt: '2026-06-09T00:00:00.000Z',
      completedAt: '2026-06-09T00:01:00.000Z',
      durationSec: 60,
      executorNodeId: 'node-1',
      delivery: {
        mode: 'commit' as const,
        pullRequest: {
          ready: true,
          remoteReady: true,
          repoUrl: 'https://github.com/example/repo',
          title: 'PR title',
          description: 'Long PR body',
          baseBranch: 'main',
          compareBranch: 'feature/workspaces',
          number: 12,
          url: 'https://github.com/example/repo/pull/12',
          state: 'open',
        },
      },
    },
    executionHistory: [{
      id: 'run-1',
      status: 'completed' as const,
      createdAt: '2026-06-09T00:00:00.000Z',
      updatedAt: '2026-06-09T00:01:00.000Z',
      result: {
        taskId: 'task-with-result',
        status: 'completed' as const,
        returnMode: 'commit' as const,
        summary: 'Run summary',
        output: 'Run output',
        filesChanged: ['src/run.ts'],
        commitShas: ['def456'],
        startedAt: '2026-06-09T00:00:00.000Z',
        completedAt: '2026-06-09T00:01:00.000Z',
        durationSec: 60,
        executorNodeId: 'node-1',
        delivery: {
          mode: 'commit' as const,
          pullRequest: {
            ready: true,
            remoteReady: true,
            repoUrl: 'https://github.com/example/repo',
            title: 'Run PR title',
            description: 'Run PR body',
            baseBranch: 'main',
            compareBranch: 'feature/workspaces',
            number: 12,
            url: 'https://github.com/example/repo/pull/12',
            state: 'open',
          },
        },
      },
    }],
  }
  const baseState = {
    ...initialState,
    projects: [project],
    tasks: [task],
    nodes: [],
    projectBindings: [],
    distributedTasks: [],
    taskWorkspaceBindings: [],
    workspaceSessions: [],
    selectedProjectId: project.id,
    selectedTaskId: task.id,
  }
  addUserProject(userId, project.id)

  const scopedState = getScopedState(baseState, userId, { mainChat: 'summary', scope: 'workspaces' })
  const scopedTask = scopedState.tasks[0]
  assert.equal(scopedTask.acceptanceCriteria, undefined)
  assert.equal(scopedTask.opencodeConfig, undefined)
  assert.equal(scopedTask.result?.output, undefined)
  assert.deepEqual(scopedTask.result?.filesChanged, [])
  assert.equal(scopedTask.result?.commitShas, undefined)
  assert.equal(scopedTask.result?.delivery?.pullRequest?.repoUrl, '')
  assert.equal(scopedTask.result?.delivery?.pullRequest?.title, '')
  assert.equal(scopedTask.result?.delivery?.pullRequest?.description, '')
  assert.equal(scopedTask.result?.delivery?.pullRequest?.compareBranch, 'feature/workspaces')
  assert.deepEqual(scopedTask.executionHistory, [])
})

test('getScopedState keeps focused workspaces task detail and slims list tasks', () => {
  const userId = `user-${crypto.randomUUID()}`
  const project = initialState.projects[0]
  const focusedTask = {
    ...initialState.tasks[0],
    id: 'task-focused',
    projectId: project.id,
    description: 'focused task description '.repeat(30),
    executionHistory: [{
      id: 'focused-run',
      status: 'completed' as const,
      createdAt: '2026-06-09T00:00:00.000Z',
      updatedAt: '2026-06-09T00:01:00.000Z',
    }],
  }
  const listTask = {
    ...initialState.tasks[0],
    id: 'task-list',
    projectId: project.id,
    description: 'list task description '.repeat(30),
    executionHistory: [{
      id: 'list-run',
      status: 'completed' as const,
      createdAt: '2026-06-09T00:00:00.000Z',
      updatedAt: '2026-06-09T00:01:00.000Z',
    }],
  }
  const baseState = {
    ...initialState,
    projects: [project],
    tasks: [focusedTask, listTask],
    nodes: [],
    projectBindings: [],
    distributedTasks: [],
    taskWorkspaceBindings: [],
    workspaceSessions: [],
    selectedProjectId: project.id,
    selectedTaskId: focusedTask.id,
  }
  addUserProject(userId, project.id)

  const scopedState = getScopedState(baseState, userId, {
    mainChat: 'summary',
    scope: 'workspaces',
    focus: {
      taskId: focusedTask.id,
    },
  })
  const scopedFocusedTask = scopedState.tasks.find((task) => task.id === focusedTask.id)
  const scopedListTask = scopedState.tasks.find((task) => task.id === listTask.id)

  assert.equal(scopedFocusedTask?.executionHistory.length, 1)
  assert.equal(scopedListTask?.executionHistory.length, 0)
  assert.ok((scopedFocusedTask?.description.length ?? 0) > (scopedListTask?.description.length ?? 0))
})

test('getScopedState slims non-focused workspaces session history projections', () => {
  const userId = `user-${crypto.randomUUID()}`
  const project = initialState.projects[0]
  const task = initialState.tasks[0]
  const focusedWorkspace = createWorkspaceRecord(project, 'executor-1', 'Executor 1', 'Focused workspace')
  const listWorkspace = createWorkspaceRecord(project, 'executor-1', 'Executor 1', 'List workspace')
  saveWorkspace(focusedWorkspace)
  saveWorkspace(listWorkspace)
  const focusedSession = createWorkspaceSession({
    task,
    workspaceId: focusedWorkspace.id,
    title: 'Focused session',
  })
  const listSession = createWorkspaceSession({
    task,
    workspaceId: listWorkspace.id,
    title: 'List session',
  })
  const sessionHistoryProjection = {
    sessionId: focusedSession.id,
    taskId: task.id,
    workspaceId: focusedSession.workspaceId,
    latestTurnId: 'turn-1',
    latestEventKind: 'assistant_message' as const,
    latestEventSeq: 12,
    totalEventCount: 18,
    lastEventAt: '2026-06-09T00:00:00.000Z',
    latestUserMessageId: 'message-user',
    latestUserMessagePreview: 'user preview '.repeat(30),
    latestAssistantMessageId: 'message-assistant',
    latestAssistantMessagePreview: 'assistant preview '.repeat(30),
    lastPersistedTurnStartedAt: '2026-06-09T00:00:00.000Z',
    lastPersistedTurnFinishedAt: '2026-06-09T00:01:00.000Z',
    lastPersistedTurnStatus: 'completed' as const,
    deletedTurnCount: 0,
    updatedAt: '2026-06-09T00:01:00.000Z',
    hasPersistedHistory: true,
    latestPreviewText: 'latest preview '.repeat(30),
  }
  const baseState = {
    ...initialState,
    projects: [project],
    tasks: [task],
    nodes: [],
    projectBindings: [],
    distributedTasks: [],
    taskWorkspaceBindings: [],
    workspaceSessions: [
      { ...focusedSession, historyProjection: sessionHistoryProjection },
      {
        ...listSession,
        historyProjection: {
          ...sessionHistoryProjection,
          sessionId: listSession.id,
          workspaceId: listSession.workspaceId,
        },
      },
    ],
    selectedProjectId: project.id,
    selectedTaskId: task.id,
  }
  addUserProject(userId, project.id)

  const scopedState = getScopedState(baseState, userId, {
    mainChat: 'summary',
    scope: 'workspaces',
    focus: {
      workspaceSessionId: focusedSession.id,
    },
  })
  const scopedFocusedSession = scopedState.workspaceSessions.find((session) => session.id === focusedSession.id)
  const scopedListSession = scopedState.workspaceSessions.find((session) => session.id === listSession.id)
  const listProjection = scopedListSession?.historyProjection as Record<string, unknown> | undefined

  assert.equal(scopedFocusedSession?.historyProjection?.sessionId, focusedSession.id)
  assert.equal(listProjection?.sessionId, undefined)
  assert.equal(listProjection?.taskId, undefined)
  assert.equal(listProjection?.workspaceId, undefined)
  assert.equal(listProjection?.latestTurnId, undefined)
  assert.equal(listProjection?.latestUserMessageId, undefined)
  assert.equal(listProjection?.latestAssistantMessageId, undefined)
  assert.equal(scopedListSession?.historyProjection?.latestEventKind, 'assistant_message')
  assert.equal(scopedListSession?.historyProjection?.lastEventAt, '2026-06-09T00:00:00.000Z')
  assert.ok((scopedListSession?.historyProjection?.latestPreviewText?.length ?? 0) < sessionHistoryProjection.latestPreviewText.length)
})
