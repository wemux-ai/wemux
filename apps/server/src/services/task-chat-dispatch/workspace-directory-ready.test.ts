import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildWorkspaceDirectoryNotReadyMessage,
  shouldEnsureWorkspaceDirectoryOnExecutor,
  verifyWorkspaceDirectoryReady,
} from './workspace-directory-ready'

test('verifyWorkspaceDirectoryReady accepts a browsable prepared directory', async () => {
  const result = await verifyWorkspaceDirectoryReady({
    executorId: 'executor-1',
    cwd: '/tmp/worktree',
    browseDirectory: async () => ({
      ok: true,
      path: '/tmp/worktree',
      rootPath: '/tmp/worktree',
      entries: [],
    }),
  })

  assert.deepEqual(result, { ok: true })
})

test('verifyWorkspaceDirectoryReady rejects a missing prepared directory', async () => {
  const result = await verifyWorkspaceDirectoryReady({
    executorId: 'executor-1',
    cwd: '/tmp/missing-worktree',
    browseDirectory: async () => ({
      ok: false,
      path: '/tmp/missing-worktree',
      rootPath: '/tmp/missing-worktree',
      entries: [],
      message: '目录不存在。',
    }),
  })

  assert.deepEqual(result, {
    ok: false,
    message: '工作区目录准备后不可访问：/tmp/missing-worktree（目录不存在。）',
  })
})

test('buildWorkspaceDirectoryNotReadyMessage works without probe detail', () => {
  assert.equal(
    buildWorkspaceDirectoryNotReadyMessage('/tmp/worktree'),
    '工作区目录准备后不可访问：/tmp/worktree',
  )
})

test('shouldEnsureWorkspaceDirectoryOnExecutor probes created worktrees on the target executor', async () => {
  const result = await shouldEnsureWorkspaceDirectoryOnExecutor({
    executorId: 'executor-new',
    cwd: '/tmp/worktree',
    workingDirectoryMode: 'worktree',
    worktreeStatus: 'created',
    browseDirectory: async () => ({
      ok: false,
      path: '/tmp/worktree',
      rootPath: '/tmp/worktree',
      entries: [],
      message: '目录不存在。',
    }),
  })

  assert.equal(result.shouldEnsure, true)
  assert.equal(result.reason, 'directory-missing')
})

test('shouldEnsureWorkspaceDirectoryOnExecutor does not trust browsable worktree paths when status is not created', async () => {
  const result = await shouldEnsureWorkspaceDirectoryOnExecutor({
    executorId: 'executor-new',
    cwd: '/tmp/worktree',
    workingDirectoryMode: 'worktree',
    worktreeStatus: 'planned',
    browseDirectory: async () => ({
      ok: true,
      path: '/tmp/worktree',
      rootPath: '/tmp/worktree',
      entries: [],
    }),
  })

  assert.equal(result.shouldEnsure, true)
  assert.equal(result.reason, 'status-not-created')
})

test('shouldEnsureWorkspaceDirectoryOnExecutor accepts created worktrees only after target executor probe passes', async () => {
  const result = await shouldEnsureWorkspaceDirectoryOnExecutor({
    executorId: 'executor-new',
    cwd: '/tmp/worktree',
    workingDirectoryMode: 'worktree',
    worktreeStatus: 'created',
    browseDirectory: async () => ({
      ok: true,
      path: '/tmp/worktree',
      rootPath: '/tmp/worktree',
      entries: [],
    }),
  })

  assert.equal(result.shouldEnsure, false)
  assert.equal(result.reason, 'directory-ready')
})
