import assert from 'node:assert/strict'
import test from 'node:test'
import { createPromptQueue, createPromptQueueState } from './prompt-queue'
import { buildPromptExecutionId } from './shared'
import type { ControlPlaneMessageHandlerParams } from './types'

test('cancelled active prompt remains running until the agent process settles', () => {
  const requestId = 'prompt-cancel-1'
  const state = createPromptQueueState()
  const abortController = new AbortController()
  state.pendingPromptAborts.set(requestId, abortController)

  let runningTaskIds = [buildPromptExecutionId(requestId)]
  let queuedTaskIds: string[] = []
  let syncCount = 0
  let drainCount = 0

  const queue = createPromptQueue({
    expectedSocket: {} as WebSocket,
    getConnection: () => null,
    getCurrentSocket: () => undefined,
    send: () => true,
    requestShutdown: () => {},
    openTerminalSession: (() => {}) as unknown as ControlPlaneMessageHandlerParams['openTerminalSession'],
    runTerminalCommand: (() => {}) as unknown as ControlPlaneMessageHandlerParams['runTerminalCommand'],
    terminalSessions: {} as ControlPlaneMessageHandlerParams['terminalSessions'],
    assignedTasks: new Map(),
    activeExecutions: new Map(),
    getConfig: () => ({
      executorId: 'executor-1',
      cloudUrl: 'http://127.0.0.1:8989',
      workspaceRoot: '/tmp/vibemux-test',
      maxConcurrency: 1,
      agentSettings: {},
    } as ReturnType<ControlPlaneMessageHandlerParams['getConfig']>),
    setConfig: () => {},
    getQueuedTaskIds: () => queuedTaskIds,
    setQueuedTaskIds: (next) => {
      queuedTaskIds = next
    },
    getRunningTaskIds: () => runningTaskIds,
    setRunningTaskIds: (next) => {
      runningTaskIds = next
    },
    syncRuntimeState: () => {
      syncCount += 1
    },
    drainExecutionQueue: () => {
      drainCount += 1
    },
    promptQueueState: state,
  })

  queue.handlePromptMessage({
    type: 'executor.agent.prompt.cancel',
    requestId,
    reason: 'user_stop',
    message: '已停止',
  })

  assert.deepEqual(runningTaskIds, [buildPromptExecutionId(requestId)])
  assert.equal(abortController.signal.aborted, true)
  assert.deepEqual(abortController.signal.reason, { reason: 'user_stop', message: '已停止' })
  assert.equal(state.pendingPromptAborts.has(requestId), true)
  assert.equal(syncCount, 0)
  assert.equal(drainCount, 0)
})

test('new prompts are rejected while the worker drains for an update', () => {
  const sent: unknown[] = []
  const state = createPromptQueueState()
  const queue = createPromptQueue({
    expectedSocket: {} as WebSocket,
    getConnection: () => null,
    getCurrentSocket: () => undefined,
    send: (message) => {
      sent.push(message)
      return true
    },
    requestShutdown: () => {},
    openTerminalSession: (() => {}) as unknown as ControlPlaneMessageHandlerParams['openTerminalSession'],
    runTerminalCommand: (() => {}) as unknown as ControlPlaneMessageHandlerParams['runTerminalCommand'],
    terminalSessions: {} as ControlPlaneMessageHandlerParams['terminalSessions'],
    assignedTasks: new Map(),
    activeExecutions: new Map(),
    getConfig: () => ({ executorId: 'executor-1' }) as ReturnType<ControlPlaneMessageHandlerParams['getConfig']>,
    setConfig: () => {},
    getQueuedTaskIds: () => [],
    setQueuedTaskIds: () => {},
    getRunningTaskIds: () => [],
    setRunningTaskIds: () => {},
    isDrainingForUpdate: () => true,
    syncRuntimeState: () => {},
    drainExecutionQueue: () => {},
    promptQueueState: state,
  })

  queue.handlePromptMessage({
    type: 'executor.agent.prompt.request',
    requestId: 'prompt-update-drain',
    agentType: 'Codex',
    cwd: '/tmp/project',
    title: 'test',
    prompt: 'continue',
    at: new Date().toISOString(),
  })

  assert.equal(state.pendingPromptRequests.size, 0)
  assert.deepEqual(sent, [{
    type: 'executor.agent.prompt.response',
    executorId: 'executor-1',
    requestId: 'prompt-update-drain',
    result: {
      ok: false,
      output: 'Worker 正在等待当前任务完成并更新，请稍后重试。',
    },
    at: (sent[0] as { at: string }).at,
  }])
})
