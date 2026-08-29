import assert from 'node:assert/strict'
import test from 'node:test'
import type { Task, WorkspaceSession } from '@shared/types'
import {
  applyTaskMessageResult,
  applyWorkspaceMessageResult,
  buildFailedWorkspaceMessageResult,
  buildPendingWorkspaceSession,
  ensureWorkspaceResultAssistantTimeline,
  markAgentCreatedPullRequestResult,
} from './result-utils'
import type { TaskMessageResult } from './types'

const createTask = (overrides: Partial<Task> = {}): Task => ({
  id: 'task-1',
  projectId: 'project-1',
  title: '修复 workspace chat 停止按钮',
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
  createdAt: '2026-05-10T00:00:00.000Z',
  updatedAt: '2026-05-10T00:00:00.000Z',
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
  runtimeOwnerExecutorId: 'executor-1',
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
  lastActiveAt: '2026-05-10T00:00:00.000Z',
  createdAt: '2026-05-10T00:00:00.000Z',
  updatedAt: '2026-05-10T00:00:00.000Z',
  ...overrides,
})

const createProject = () => ({
  id: 'project-1',
  name: 'Vibemux',
  gitUrl: 'https://github.com/wemux-ai/wemux.git',
  defaultBranch: 'main',
  createdAt: '2026-05-10T00:00:00.000Z',
  updatedAt: '2026-05-10T00:00:00.000Z',
})

test('buildPendingWorkspaceSession marks workspace chat runtime as running immediately', () => {
  const pending = buildPendingWorkspaceSession(
    createTask(),
    createSession(),
    '2026-05-10T08:00:00.000Z',
  )

  assert.equal(pending.agentRunningStatus, 'thinking')
  assert.equal(pending.runtimeStatus, 'running')
  assert.equal(pending.runtimeStartedAt, '2026-05-10T08:00:00.000Z')
  assert.equal(pending.lastRuntimeEventAt, '2026-05-10T08:00:00.000Z')
  assert.equal(pending.runtimeSequence, 1)
  assert.equal(pending.currentStep, '正在处理工作区对话')
  assert.equal(pending.terminalReason, undefined)
})

test('buildPendingWorkspaceSession can pin runtime owner to the workspace executor', () => {
  const pending = buildPendingWorkspaceSession(
    createTask(),
    createSession({
      executorNodeId: 'executor-old',
      runtimeOwnerExecutorId: 'executor-old',
    }),
    '2026-05-10T08:00:00.000Z',
    'executor-workspace',
  )

  assert.equal(pending.executorNodeId, 'executor-old')
  assert.equal(pending.runtimeOwnerExecutorId, 'executor-workspace')
})

test('buildPendingWorkspaceSession keeps the current runtime owner when no override is provided', () => {
  const pending = buildPendingWorkspaceSession(
    createTask(),
    createSession({
      executorNodeId: 'executor-workspace',
      runtimeOwnerExecutorId: 'executor-session',
    }),
    '2026-05-10T08:01:00.000Z',
  )

  assert.equal(pending.executorNodeId, 'executor-workspace')
  assert.equal(pending.runtimeOwnerExecutorId, 'executor-session')
})

test('buildPendingWorkspaceSession resets runtime start time for each queued turn', () => {
  const pending = buildPendingWorkspaceSession(
    createTask(),
    createSession({
      runtimeStartedAt: '2026-05-10T08:00:00.000Z',
      lastRuntimeEventAt: '2026-05-10T08:05:00.000Z',
      runtimeSequence: 4,
    }),
    '2026-05-10T09:00:00.000Z',
  )

  assert.equal(pending.runtimeStartedAt, '2026-05-10T09:00:00.000Z')
  assert.equal(pending.lastRuntimeEventAt, '2026-05-10T09:00:00.000Z')
  assert.equal(pending.runtimeSequence, 5)
})

test('applyWorkspaceMessageResult marks successful workspace chat runtime completed', () => {
  const result: TaskMessageResult = {
    ok: true,
    output: '已完成修复。',
    agentRunningStatus: 'complete',
    currentStep: '工作区对话已完成',
  }

  const completed = applyWorkspaceMessageResult(
    createTask(),
    createSession({
      agentRunningStatus: 'executing',
      runtimeStatus: 'running',
      runtimeSequence: 2,
      runtimeStartedAt: '2026-05-10T08:00:00.000Z',
      lastHeartbeatAt: '2026-05-10T08:00:01.000Z',
    }),
    result,
  )

  assert.equal(completed.agentRunningStatus, 'complete')
  assert.equal(completed.runtimeStatus, 'completed')
  assert.equal(completed.runtimeSequence, 3)
  assert.equal(completed.currentStep, '工作区对话已完成')
  assert.equal(completed.terminalReason, undefined)
  assert.equal(completed.lastHeartbeatAt, '2026-05-10T08:00:01.000Z')
  assert.match(completed.lastRuntimeEventAt ?? '', /^\d{4}-\d{2}-\d{2}T/)
})

test('applyWorkspaceMessageResult marks failed workspace chat runtime error', () => {
  const result: TaskMessageResult = {
    ok: false,
    output: 'executor disconnected',
    agentRunningStatus: 'error',
    currentStep: '工作区对话失败',
  }

  const failed = applyWorkspaceMessageResult(
    createTask(),
    createSession({
      agentRunningStatus: 'executing',
      runtimeStatus: 'running',
      runtimeSequence: 4,
    }),
    result,
  )

  assert.equal(failed.agentRunningStatus, 'error')
  assert.equal(failed.runtimeStatus, 'error')
  assert.equal(failed.runtimeSequence, 5)
  assert.equal(failed.terminalReason, 'executor disconnected')
  assert.match(failed.lastRuntimeEventAt ?? '', /^\d{4}-\d{2}-\d{2}T/)
})

test('applyWorkspaceMessageResult keeps user-stopped workspace chat idle instead of error', () => {
  const result: TaskMessageResult = {
    ok: false,
    output: '已停止',
    agentRunningStatus: 'idle',
    currentStep: '已停止',
  }

  const stopped = applyWorkspaceMessageResult(
    createTask(),
    createSession({
      agentRunningStatus: 'executing',
      runtimeStatus: 'running',
      runtimeSequence: 4,
    }),
    result,
  )

  assert.equal(stopped.agentRunningStatus, 'idle')
  assert.equal(stopped.runtimeStatus, 'idle')
  assert.equal(stopped.runtimeSequence, 5)
  assert.equal(stopped.terminalReason, undefined)
  assert.equal(stopped.currentStep, '已停止')
})

test('applyTaskMessageResult moves successful workspace chat tasks into review', () => {
  const result: TaskMessageResult = {
    ok: true,
    output: 'PR 已创建。',
    agentRunningStatus: 'complete',
    currentStep: '工作区对话已完成',
  }

  const completed = applyTaskMessageResult(
    createTask({
      status: 'in_progress',
      history: [],
    }),
    result,
    'workspace-1',
  )

  assert.equal(completed.status, 'in_review')
  assert.equal(completed.needsHumanConfirm, true)
  assert.equal(completed.agentRunningStatus, 'complete')
  assert.equal(completed.currentStep, '工作区对话已完成')
  assert.equal(completed.history.at(-1)?.label, '审核中')
})

test('buildFailedWorkspaceMessageResult keeps the raw workspace error in the timeline', () => {
  const rawError = 'Cannot use simple-git on a directory that does not exist'
  const result = buildFailedWorkspaceMessageResult(rawError, 'turn-1')

  assert.equal(result.ok, false)
  assert.equal(result.output, rawError)
  assert.equal(result.turnId, 'turn-1')
  assert.equal(result.agentRunningStatus, 'error')
  assert.equal(result.currentStep, '工作区对话失败')
  assert.deepEqual(result.conversationTimeline?.map((event) => event.kind), ['status', 'error'])
  assert.equal(result.conversationTimeline?.[1] && 'message' in result.conversationTimeline[1] ? result.conversationTimeline[1].message : '', rawError)
})

test('ensureWorkspaceResultAssistantTimeline adds final output when runtime only reported status', () => {
  const result = ensureWorkspaceResultAssistantTimeline({
    ok: true,
    output: '403 Your request was blocked.',
    turnId: 'turn-pi',
    agentSessionId: 'pi-session-1',
    executionModel: 'blackai/gpt-5.4',
    agentRunningStatus: 'complete',
    currentStep: '工作区对话已完成',
    conversationTimeline: [{
      id: 'turn:turn-pi:status:complete:工作区对话已完成',
      ts: '2026-07-07T09:02:00.000Z',
      turnId: 'turn-pi',
      seq: 1,
      kind: 'status',
      status: 'complete',
      step: '工作区对话已完成',
    }],
  }, 'PI')

  assert.deepEqual(result.conversationTimeline?.map((event) => event.kind), ['status', 'assistant_message'])
  const assistantEvent = result.conversationTimeline?.[1]
  assert.equal(assistantEvent?.kind, 'assistant_message')
  if (assistantEvent?.kind === 'assistant_message') {
    assert.equal(assistantEvent.text, '403 Your request was blocked.')
    assert.equal(assistantEvent.authorName, 'PI')
    assert.equal(assistantEvent.executionModel, 'blackai/gpt-5.4')
  }
})

test('markAgentCreatedPullRequestResult records agent-created pull request delivery', () => {
  const marked = markAgentCreatedPullRequestResult({
    task: createTask(),
    project: createProject(),
    session: createSession({
      branchName: 'vibemux/3876-workspace-message',
    }),
    result: {
      ok: true,
      output: 'PR 已创建：https://github.com/wemux-ai/wemux/pull/57',
      turnId: 'turn-1',
      agentRunningStatus: 'complete',
      currentStep: '工作区对话已完成',
    },
  })

  assert.equal(marked.result.delivery?.pullRequest?.url, 'https://github.com/wemux-ai/wemux/pull/57')
  assert.equal(marked.result.delivery?.pullRequest?.number, 57)
  assert.equal(marked.result.delivery?.pullRequest?.compareBranch, 'vibemux/3876-workspace-message')
  assert.equal(marked.deliverySummary?.pullRequest?.workspaceSessionId, 'session-1')
  assert.equal(marked.deliverySummary?.pullRequest?.number, 57)
  assert.equal(marked.result.conversationTimeline?.at(-1)?.kind, 'delivery_result')
  const deliveryEvent = marked.result.conversationTimeline?.at(-1)
  assert.equal(deliveryEvent?.kind === 'delivery_result' ? deliveryEvent.delivery?.pullRequest?.number : undefined, 57)
})
