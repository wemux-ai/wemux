import assert from 'node:assert/strict'
import test from 'node:test'

import {
  classifyAgentTaskRunFailure,
  createAgentTaskRunTranscriptCapture,
  mergeAgentTaskRunUsage,
  summarizeAgentTaskRunTranscript,
} from './agent-task-run-service'

test('Agent task run summary uses the latest non-empty assistant output', () => {
  assert.equal(summarizeAgentTaskRunTranscript([
    { id: 'prompt', role: 'user', content: '[Agent Runtime Event]', createdAt: '2026-07-23T00:00:00.000Z' },
    { id: 'assistant-1', role: 'assistant', content: 'Checking files.', createdAt: '2026-07-23T00:00:01.000Z' },
    { id: 'assistant-2', role: 'assistant', content: 'Updated   README.\nTests passed.', createdAt: '2026-07-23T00:00:02.000Z' },
  ]), 'Updated README. Tests passed.')
})

test('Agent task run summary stays absent for prompt and tool-only transcripts', () => {
  assert.equal(summarizeAgentTaskRunTranscript([
    { id: 'prompt', role: 'user', content: '[Agent Runtime Event]', createdAt: '2026-07-23T00:00:00.000Z' },
    {
      id: 'assistant',
      role: 'assistant',
      content: '',
      createdAt: '2026-07-23T00:00:01.000Z',
      toolCalls: [{
        id: 'tool-1',
        name: 'read',
        args: '{"path":"README.md"}',
        result: 'contents',
        startedAt: '2026-07-23T00:00:01.000Z',
        finishedAt: '2026-07-23T00:00:02.000Z',
      }],
    },
  ]), undefined)
})

test('Agent task run usage aggregates multiple prompts in one event attempt', () => {
  assert.deepEqual(mergeAgentTaskRunUsage(
    { inputTokens: 100, outputTokens: 20, reasoningTokens: 5, totalTokens: 125 },
    { inputTokens: 30, outputTokens: 10, cacheReadTokens: 40, totalTokens: 80 },
  ), {
    inputTokens: 130,
    outputTokens: 30,
    reasoningTokens: 5,
    cacheReadTokens: 40,
    cacheWriteTokens: undefined,
    totalTokens: 205,
  })
})

test('Agent task run failures use stable product-facing codes', () => {
  assert.equal(classifyAgentTaskRunFailure({
    message: '当前 Agent 所属用户没有在线执行节点。',
  }), 'infrastructure_unavailable')
  assert.equal(classifyAgentTaskRunFailure({
    message: '执行器已断开连接。',
    retryableInfrastructure: true,
  }), 'infrastructure_interrupted')
  assert.equal(classifyAgentTaskRunFailure({
    message: 'Agent 未通过 task.delivery.report 写入任务状态和交付评论。',
  }), 'delivery_missing')
  assert.equal(classifyAgentTaskRunFailure({
    message: 'context length exceeded',
    poisoned: true,
  }), 'context_poisoned')
})

test('finishing a transcript capture publishes a persisted-change signal', () => {
  let changes = 0
  const capture = createAgentTaskRunTranscriptCapture({
    agentTaskId: 'agent-task-1',
    agentId: 'agent-1',
    agentName: 'Agent',
    prompt: 'Handle the task.',
    startedAt: '2026-07-22T00:00:00.000Z',
    onTranscriptChange: () => { changes += 1 },
  })

  capture.onEvent({ type: 'delta', content: 'Done.' })
  capture.finish()
  assert.equal(changes, 1)
})
