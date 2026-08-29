import assert from 'node:assert/strict'
import test from 'node:test'
import { getWorkspaceBranchSwitchBlockedMessage, shouldSkipGitCleanupForProject } from './task-worktree-routes'

test('shouldSkipGitCleanupForProject skips cleanup for local directory projects', () => {
  assert.equal(shouldSkipGitCleanupForProject({ versionControl: 'none' }), true)
  assert.equal(shouldSkipGitCleanupForProject({ versionControl: 'git-local' }), false)
  assert.equal(shouldSkipGitCleanupForProject({ versionControl: 'git-remote' }), false)
})

test('getWorkspaceBranchSwitchBlockedMessage blocks branch switching for local directory projects only', () => {
  assert.match(getWorkspaceBranchSwitchBlockedMessage({ versionControl: 'none' }), /本地目录模式运行/)
  assert.equal(getWorkspaceBranchSwitchBlockedMessage({ versionControl: 'git-local' }), '')
  assert.equal(getWorkspaceBranchSwitchBlockedMessage({ versionControl: 'git-remote' }), '')
})
