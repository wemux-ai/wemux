import assert from 'node:assert/strict'
import test from 'node:test'

import { resolveTaskExecutionPrompt } from './task-execution-service'

test('task execution uses the current Agent delegation prompt before task description', () => {
  assert.equal(resolveTaskExecutionPrompt({
    taskDescription: '更新 PRD',
    sessionDelegatedPrompt: '阅读最新评论后更新产品文档。',
    delegatedPrompt: '先核对 Git 改动，只更新与飞书渠道相关的 PRD 段落。',
  }), '先核对 Git 改动，只更新与飞书渠道相关的 PRD 段落。')
})

test('task execution reuses the workspace session delegation prompt when a new one is absent', () => {
  assert.equal(resolveTaskExecutionPrompt({
    taskDescription: '更新 PRD',
    sessionDelegatedPrompt: '继续执行已委派的文档更新范围。',
  }), '继续执行已委派的文档更新范围。')
})

test('task execution falls back to the task description without an Agent delegation prompt', () => {
  assert.equal(resolveTaskExecutionPrompt({
    taskDescription: '更新 PRD',
  }), '更新 PRD')
})
