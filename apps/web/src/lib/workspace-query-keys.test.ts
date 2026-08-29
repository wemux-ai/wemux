import assert from 'node:assert/strict'
import test from 'node:test'

import { buildWorkspaceGitScopeKey, workspaceQueryKeys } from './workspace-query-keys'

test('buildWorkspaceGitScopeKey creates the shared working tree cache scope', () => {
  const scopeKey = buildWorkspaceGitScopeKey({
    taskId: 'task-1',
    workspaceId: 'workspace-1',
    workspaceSessionId: 'session-1',
    compareBranch: 'feature/cache',
    worktreeStatus: 'created',
    baseBranch: 'main',
  })

  assert.deepEqual(
    workspaceQueryKeys.gitWorkingTreeDiff('task-1', 'workspace-1', 'session-1', scopeKey),
    ['workspace', 'git-working-tree-diff', 'task-1', 'workspace-1', 'session-1', scopeKey],
  )
})
