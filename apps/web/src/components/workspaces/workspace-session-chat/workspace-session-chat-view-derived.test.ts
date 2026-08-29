import assert from 'node:assert/strict'
import test from 'node:test'
import type { TaskChatSessionSnapshot } from '@shared/task-chat-session'
import type { ExecutorRecord } from '@shared/types'
import {
  resolveVisibleWorkspaceSessionSystemLogs,
  resolveWorkspaceSessionChatViewRuntime,
  resolveWorkspaceSessionQueuePending,
  resolveWorkspaceSessionQueueStatusMessage,
} from './workspace-session-chat-view-derived'

const buildWorkspaceSnapshot = (
  runtime: Partial<TaskChatSessionSnapshot['runtime']> = {},
  queue: Partial<TaskChatSessionSnapshot['queue']> = {},
): TaskChatSessionSnapshot => ({
  protocol: {
    version: 'v1alpha1',
    stream: 'task-chat-ws',
    history: 'conversation-http',
    queue: 'http-resource',
  },
  scope: {
    mode: 'workspace',
    taskId: 'task-1',
    workspaceId: 'workspace-1',
    workspaceSessionId: 'session-1',
    sessionKey: 'task:task-1:workspace:workspace-1::session-1',
  },
  runtime: {
    agentRunningStatus: 'complete',
    runtimeStatus: 'completed',
    currentStep: '工作区对话已完成',
    needsHumanConfirm: false,
    executorNodeId: 'executor-1',
    ...runtime,
  },
  conversation: {
    conversationId: 'conversation-1',
    messageCount: 2,
    latestMessageAt: '2026-05-11T07:00:00.000Z',
  },
  queue: {
    sessionKey: 'task:task-1:workspace:workspace-1::session-1',
    status: 'empty',
    items: [],
    ...queue,
  },
})

const buildExecutor = (status: ExecutorRecord['status']): ExecutorRecord => ({
  executorId: 'executor-1',
  machineId: 'machine-1',
  name: 'Local executor',
  machineName: 'mac',
  workspaceRoot: '/tmp/workspace',
  status,
  version: '0.0.0',
  maxConcurrency: 1,
  capabilities: [],
  labels: [],
  lastSeenAt: '2026-05-11T07:00:00.000Z',
  createdAt: '2026-05-11T07:00:00.000Z',
  ownerUserId: 'user-1',
  visibility: 'private',
})

test('resolveWorkspaceSessionChatViewRuntime trusts a terminal remote snapshot over stale live executing status', () => {
  const resolved = resolveWorkspaceSessionChatViewRuntime({
    liveStatus: 'executing',
    liveStep: '正在执行工具',
    remoteSessionStatus: 'complete',
    remoteRuntimeStatus: 'completed',
    remoteStep: '已完成',
  })

  assert.deepEqual(resolved, {
    agentRunningStatus: 'complete',
    runtimeStatus: 'completed',
    currentStep: '已完成',
  })
})

test('resolveWorkspaceSessionChatViewRuntime lets queued runtime suppress live waiting status', () => {
  const resolved = resolveWorkspaceSessionChatViewRuntime({
    liveStatus: 'waiting',
    liveStep: '等待执行',
    remoteSessionStatus: 'thinking',
    remoteRuntimeStatus: 'queued',
    remoteStep: '消息等待处理中',
  })

  assert.deepEqual(resolved, {
    agentRunningStatus: 'thinking',
    runtimeStatus: 'queued',
    currentStep: '消息等待处理中',
  })
})

test('resolveWorkspaceSessionChatViewRuntime still prefers live executing state over non-terminal remote runtime', () => {
  const resolved = resolveWorkspaceSessionChatViewRuntime({
    liveStatus: 'executing',
    liveStep: '正在继续处理',
    remoteSessionStatus: 'thinking',
    remoteRuntimeStatus: 'running',
    remoteStep: '远端快照还没追上',
  })

  assert.deepEqual(resolved, {
    agentRunningStatus: 'executing',
    runtimeStatus: undefined,
    currentStep: '正在继续处理',
  })
})

test('resolveVisibleWorkspaceSessionSystemLogs keeps logs scoped to the active workspace session', () => {
  const logs = resolveVisibleWorkspaceSessionSystemLogs({
    workspaceId: 'workspace-1',
    workspaceSessionId: 'session-active',
    logs: [
      {
        id: 'active-switch',
        role: 'system',
        content: '节点切换：MBP → 我的 Worker\n分支：vibemux/current\n正在后台准备新节点上的工作目录。',
        createdAt: '2026-05-15T03:10:00.000Z',
        workspaceId: 'workspace-1',
        workspaceSessionId: 'session-active',
      },
      {
        id: 'old-prepare',
        role: 'system',
        content: '正在创建 worktree：/tmp/old，分支 vibemux/old',
        createdAt: '2026-05-15T03:11:00.000Z',
        workspaceId: 'workspace-1',
        workspaceSessionId: 'session-old',
      },
      {
        id: 'workspace-wide',
        role: 'system',
        content: '已关联工作区 Demo。',
        createdAt: '2026-05-15T03:12:00.000Z',
        workspaceId: 'workspace-1',
      },
      {
        id: 'superseded',
        role: 'system',
        content: '针对节点 old-node 的后台准备已停止，已由更新的节点切换替代。',
        createdAt: '2026-05-15T03:13:00.000Z',
        workspaceId: 'workspace-1',
        workspaceSessionId: 'session-active',
      },
    ],
  })

  assert.deepEqual(logs.map((log) => log.id), ['active-switch'])
})

test('resolveWorkspaceSessionQueueStatusMessage explains offline executor queues even after runtime completed', () => {
  const session = buildWorkspaceSnapshot(undefined, {
    status: 'queued',
    items: [{
      id: 'queue-1',
      sessionKey: 'task:task-1:workspace:workspace-1::session-1',
      taskId: 'task-1',
      workspaceId: 'workspace-1',
      workspaceSessionId: 'session-1',
      message: 'queued message',
      createdAt: '2026-05-11T07:00:01.000Z',
    }],
  })

  assert.equal(
    resolveWorkspaceSessionQueueStatusMessage({
      chatSession: session,
      displayStep: '工作区对话已完成',
      executors: [buildExecutor('offline')],
      remoteRuntimeStatus: 'completed',
    }),
    '执行器当前离线，消息已保留在队列中，等待恢复后自动发送。',
  )
})

test('resolveWorkspaceSessionQueueStatusMessage keeps runtime queued message first', () => {
  assert.equal(
    resolveWorkspaceSessionQueueStatusMessage({
      chatSession: buildWorkspaceSnapshot({
        runtimeStatus: 'queued',
        currentStep: '执行节点执行队列已满',
      }),
      displayStep: '执行节点执行队列已满',
      executors: [buildExecutor('offline')],
      remoteRuntimeStatus: 'queued',
    }),
    '执行节点执行队列已满',
  )
})

test('resolveWorkspaceSessionQueuePending ignores raw session queue state when no visible queue items remain', () => {
  assert.equal(resolveWorkspaceSessionQueuePending({
    preparingWorkspace: false,
    queuedMessages: [],
  }), false)
  assert.equal(resolveWorkspaceSessionQueuePending({
    preparingWorkspace: true,
    queuedMessages: [],
  }), true)
})

test('resolveWorkspaceSessionQueueStatusMessage ignores stale raw queue entries hidden from the visible queue', () => {
  const session = buildWorkspaceSnapshot(undefined, {
    status: 'queued',
    items: [{
      id: 'queue-1',
      sessionKey: 'task:task-1:workspace:workspace-1::session-1',
      taskId: 'task-1',
      workspaceId: 'workspace-1',
      workspaceSessionId: 'session-1',
      message: 'already visible in transcript',
      createdAt: '2026-05-11T07:00:01.000Z',
    }],
  })

  assert.equal(
    resolveWorkspaceSessionQueueStatusMessage({
      chatSession: session,
      displayStep: '工作区对话已完成',
      executors: [buildExecutor('offline')],
      queuedMessages: [],
      remoteRuntimeStatus: 'completed',
    }),
    '',
  )
})
