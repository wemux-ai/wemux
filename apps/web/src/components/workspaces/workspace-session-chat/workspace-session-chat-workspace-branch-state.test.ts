import assert from 'node:assert/strict'
import test from 'node:test'
import { resolveDisplayedWorkspaceBranchName } from './workspace-session-chat-workspace-branch-state'

test('resolveDisplayedWorkspaceBranchName uses the real repo branch when available', () => {
  assert.equal(resolveDisplayedWorkspaceBranchName({
    workingDirectoryMode: 'original-dir',
    currentRepoBranch: 'dev',
    workspaceSessionBranchName: 'feature/original-dir',
  }), 'dev')

  assert.equal(resolveDisplayedWorkspaceBranchName({
    workingDirectoryMode: 'worktree',
    currentRepoBranch: 'main',
    workspaceSessionBranchName: 'dev',
  }), 'main')

  assert.equal(resolveDisplayedWorkspaceBranchName({
    workingDirectoryMode: 'original-dir',
    currentRepoBranch: '',
    workspaceSessionBranchName: 'feature/original-dir',
  }), 'feature/original-dir')
})

test('resolveDisplayedWorkspaceBranchName hides stale branch labels when the project has no git', () => {
  assert.equal(resolveDisplayedWorkspaceBranchName({
    versionControl: 'none',
    workingDirectoryMode: 'original-dir',
    currentRepoBranch: '',
    workspaceSessionBranchName: 'main',
  }), '')
})

test('resolveDisplayedWorkspaceBranchName falls back to the stored session branch', () => {
  assert.equal(resolveDisplayedWorkspaceBranchName({
    workingDirectoryMode: 'worktree',
    currentRepoBranch: '',
    workspaceSessionBranchName: 'vibemux/f7a25e10-task',
  }), 'vibemux/f7a25e10-task')
})
