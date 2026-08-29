import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { ensureWorkspaceLayout, getTaskWorktreePath } from './workspace'

test('ensureWorkspaceLayout creates the standard worker workspace directories', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'vibemux-worker-layout-'))
  const workspaceRoot = path.join(root, 'workspace')

  try {
    const layout = ensureWorkspaceLayout(workspaceRoot)

    assert.equal(layout.root, workspaceRoot)
    assert.equal(layout.nodeDir, path.join(workspaceRoot, 'node'))
    assert.equal(layout.nodeRuntimeDir, path.join(workspaceRoot, 'node', 'runtime'))
    assert.equal(layout.nodeCacheDir, path.join(workspaceRoot, 'node', 'cache'))
    assert.equal(layout.usersDir, path.join(workspaceRoot, 'users'))
    assert.equal(layout.workspacesDir, path.join(workspaceRoot, 'workspaces'))
    assert.equal(existsSync(path.join(workspaceRoot, 'node', 'runtime')), true)
    assert.equal(existsSync(path.join(workspaceRoot, 'node', 'cache')), true)
    assert.equal(existsSync(path.join(workspaceRoot, 'users')), true)
    assert.equal(existsSync(path.join(workspaceRoot, 'workspaces')), true)
    assert.equal(existsSync(path.join(workspaceRoot, 'repos')), false)
    assert.equal(existsSync(path.join(workspaceRoot, 'worktrees')), false)
    assert.equal(existsSync(path.join(workspaceRoot, 'projects')), false)
    assert.equal(existsSync(path.join(workspaceRoot, 'artifacts')), false)
    assert.equal(existsSync(path.join(workspaceRoot, 'cache')), false)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('getTaskWorktreePath uses user scope unless an execution workspace is provided', () => {
  const workspaceRoot = '/Users/x/.vibemux-dev'

  assert.equal(
    getTaskWorktreePath(workspaceRoot, 'task-1', undefined, 'user-a'),
    '/Users/x/.vibemux-dev/users/user-a/worktrees/task-1',
  )
  assert.equal(
    getTaskWorktreePath(workspaceRoot, 'task-1', 'workspace-a', 'user-a'),
    '/Users/x/.vibemux-dev/workspaces/workspace-a/worktrees/task-1',
  )
  assert.equal(
    getTaskWorktreePath(
      workspaceRoot,
      'distributed-task-1',
      'workspace-a',
      'user-a',
      '/Users/x/.vibemux-dev/workspaces/workspace-a/worktrees/session-worktree',
    ),
    '/Users/x/.vibemux-dev/workspaces/workspace-a/worktrees/session-worktree',
  )
})
