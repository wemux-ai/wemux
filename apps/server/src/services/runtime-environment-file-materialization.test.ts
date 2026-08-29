import assert from 'node:assert/strict'
import test from 'node:test'
import { executorWsService } from '../control-plane/executor-ws-service'
import { materializeWorkspaceRuntimeEnvironmentFile } from './runtime-environment-file-materialization'

test('workspace runtime environment writes the effective env file into the prepared workspace directory', async (t) => {
  t.mock.method(executorWsService, 'requestDirectoryBrowse', async () => ({
    ok: true,
    path: '/tmp/worktree',
    rootPath: '/tmp/worktree',
    entries: [],
  }))
  const writeFile = t.mock.method(executorWsService, 'requestFileWrite', async () => ({
    ok: true,
    path: '/tmp/worktree/.env',
    rootPath: '/tmp/worktree',
    sizeBytes: 25,
  }))

  const result = await materializeWorkspaceRuntimeEnvironmentFile({
    executorId: 'executor-1',
    cwd: '/tmp/worktree',
    config: {
      mode: 'env-file',
      fileName: '.env',
      content: 'PROJECT=1\nWORKSPACE=2',
    },
  })

  assert.equal(result?.ok, true)
  assert.deepEqual(writeFile.mock.calls[0]?.arguments, [
    'executor-1',
    '/tmp/worktree',
    '/tmp/worktree/.env',
    'PROJECT=1\nWORKSPACE=2',
    12000,
  ])
})

test('workspace runtime environment does not create an unprepared workspace directory', async (t) => {
  t.mock.method(executorWsService, 'requestDirectoryBrowse', async () => ({
    ok: false,
    path: '/tmp/missing-worktree',
    rootPath: '/tmp/missing-worktree',
    entries: [],
    message: '目录不存在。',
  }))
  const writeFile = t.mock.method(executorWsService, 'requestFileWrite', async () => ({
    ok: true,
    path: '/tmp/missing-worktree/.env',
    rootPath: '/tmp/missing-worktree',
    sizeBytes: 0,
  }))

  const result = await materializeWorkspaceRuntimeEnvironmentFile({
    executorId: 'executor-1',
    cwd: '/tmp/missing-worktree',
    config: {
      mode: 'env-file',
      fileName: '.env',
      content: 'KEY=value',
    },
  })

  assert.equal(result?.ok, false)
  assert.equal(writeFile.mock.calls.length, 0)
  assert.match(result?.message ?? '', /目录不存在/)
})
