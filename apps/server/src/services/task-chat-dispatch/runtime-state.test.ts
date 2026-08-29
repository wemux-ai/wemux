import assert from 'node:assert/strict'
import test from 'node:test'
import { buildTaskChatSessionKey } from '@shared/task-chat-session'
import {
  bindTaskChatExecutionAbortSignal,
  expireStaleTaskChatExecutionSlots,
  isTaskChatExecutionActive,
  isTaskChatRuntimeBusy,
  releaseTaskChatExecutionSlot,
  stopTaskChatExecution,
  tryAcquireTaskChatExecutionSlot,
} from './runtime-state'

test('terminal agent status wins over a stale busy runtime status', () => {
  assert.equal(isTaskChatRuntimeBusy('complete', 'running'), false)
  assert.equal(isTaskChatRuntimeBusy('error', 'waiting'), false)
})

test('active agent status wins over a stale completed runtime status', () => {
  assert.equal(isTaskChatRuntimeBusy('executing', 'completed'), true)
  assert.equal(isTaskChatRuntimeBusy('thinking', 'queued'), false)
})

test('stopTaskChatExecution can abort workspace chat via the original request session key alias', () => {
  const taskId = 'task-1'
  const workspaceId = 'workspace-1'
  const requestedSessionKey = buildTaskChatSessionKey(taskId, workspaceId)
  const effectiveSessionKey = buildTaskChatSessionKey(taskId, workspaceId, 'session-1')
  const binding = bindTaskChatExecutionAbortSignal([requestedSessionKey, effectiveSessionKey])

  assert.equal(stopTaskChatExecution({ taskId, workspaceId }), true)
  assert.equal(binding.signal.aborted, true)

  binding.cleanup()

  assert.equal(stopTaskChatExecution({ taskId, workspaceId }), false)
  assert.equal(stopTaskChatExecution({ taskId, workspaceId, workspaceSessionId: 'session-1' }), false)
})

test('stopTaskChatExecution can abort workspace chat via a stale session id alias', () => {
  const taskId = 'task-2'
  const workspaceId = 'workspace-2'
  const staleSessionKey = buildTaskChatSessionKey(taskId, workspaceId, 'session-stale')
  const effectiveSessionKey = buildTaskChatSessionKey(taskId, workspaceId, 'session-effective')
  const binding = bindTaskChatExecutionAbortSignal([staleSessionKey, effectiveSessionKey])

  assert.equal(stopTaskChatExecution({ taskId, workspaceId, workspaceSessionId: 'session-stale' }), true)
  assert.equal(binding.signal.aborted, true)

  binding.cleanup()
})

test('stopTaskChatExecution keeps the execution slot until the aborted turn settles', () => {
  const taskId = 'task-stop-release'
  const workspaceId = 'workspace-stop-release'
  const workspaceSessionId = 'session-stop-release'
  const sessionKey = buildTaskChatSessionKey(taskId, workspaceId, workspaceSessionId)
  const binding = bindTaskChatExecutionAbortSignal(sessionKey)

  assert.equal(tryAcquireTaskChatExecutionSlot({ taskId, workspaceId, workspaceSessionId }), true)
  assert.equal(stopTaskChatExecution({ taskId, workspaceId, workspaceSessionId }), true)
  assert.equal(binding.signal.aborted, true)
  assert.deepEqual(binding.signal.reason, { reason: 'user_stop', message: '已停止' })
  assert.equal(isTaskChatExecutionActive({ taskId, workspaceId, workspaceSessionId }), true)
  assert.equal(tryAcquireTaskChatExecutionSlot({ taskId, workspaceId, workspaceSessionId }), false)

  releaseTaskChatExecutionSlot({ taskId, workspaceId, workspaceSessionId })
  assert.equal(tryAcquireTaskChatExecutionSlot({ taskId, workspaceId, workspaceSessionId }), true)
  releaseTaskChatExecutionSlot({ taskId, workspaceId, workspaceSessionId })
  binding.cleanup()
})

test('stopTaskChatExecution is delivered when stop wins the controller registration race', () => {
  const taskId = 'task-stop-before-bind'
  const workspaceId = 'workspace-stop-before-bind'
  const workspaceSessionId = 'session-stop-before-bind'

  assert.equal(tryAcquireTaskChatExecutionSlot({ taskId, workspaceId, workspaceSessionId }), true)
  assert.equal(stopTaskChatExecution({ taskId, workspaceId, workspaceSessionId }), true)

  const binding = bindTaskChatExecutionAbortSignal(
    buildTaskChatSessionKey(taskId, workspaceId, workspaceSessionId),
  )
  assert.equal(binding.signal.aborted, true)
  assert.deepEqual(binding.signal.reason, { reason: 'user_stop', message: '已停止' })

  releaseTaskChatExecutionSlot({ taskId, workspaceId, workspaceSessionId })
  binding.cleanup()
})

test('stale execution slots without abort controllers expire so queued messages can drain', () => {
  const taskId = 'task-stale-slot'
  const workspaceId = 'workspace-stale-slot'
  const workspaceSessionId = 'session-stale-slot'

  assert.equal(tryAcquireTaskChatExecutionSlot({ taskId, workspaceId, workspaceSessionId }), true)
  assert.equal(tryAcquireTaskChatExecutionSlot({ taskId, workspaceId, workspaceSessionId }), false)
  assert.equal(isTaskChatExecutionActive({ taskId, workspaceId, workspaceSessionId }), true)

  expireStaleTaskChatExecutionSlots(Date.now() + 3_000)

  assert.equal(isTaskChatExecutionActive({ taskId, workspaceId, workspaceSessionId }), false)
  assert.equal(tryAcquireTaskChatExecutionSlot({ taskId, workspaceId, workspaceSessionId }), true)
  releaseTaskChatExecutionSlot({ taskId, workspaceId, workspaceSessionId })
})
