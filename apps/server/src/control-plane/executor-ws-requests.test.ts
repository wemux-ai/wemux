import assert from 'node:assert/strict'
import test from 'node:test'
import type { ExecutorWorkspaceOperationEvent } from '@shared/types'
import { buildWorktreeEnsureFailureMessage } from './worktree-ensure-failure-message'

const createOperationEvent = (message: string): ExecutorWorkspaceOperationEvent => ({
  phase: 'worktree.repo.fetch',
  message,
  at: '2026-06-09T07:22:00.000Z',
})

test('buildWorktreeEnsureFailureMessage keeps the base message when there is no operation detail', () => {
  assert.equal(
    buildWorktreeEnsureFailureMessage('执行器准备工作目录超时，请稍后重试。'),
    '执行器准备工作目录超时，请稍后重试。',
  )
})

test('buildWorktreeEnsureFailureMessage appends the latest operation detail', () => {
  assert.equal(
    buildWorktreeEnsureFailureMessage(
      '执行器准备工作目录超时，请稍后重试。',
      createOperationEvent('正在 fetch base 分支：main'),
    ),
    '执行器准备工作目录超时，请稍后重试。 最后进度：正在 fetch base 分支：main',
  )
})
