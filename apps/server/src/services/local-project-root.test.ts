import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {
  buildProtectedProjectDeletionRoots,
  getProjectDirectoryDeletionIssue,
  resolveDefaultLocalProjectRootPath,
  resolveManagedPath,
} from './local-project-root'

test('resolveManagedPath expands the home prefix', () => {
  assert.equal(
    resolveManagedPath('~/.vibemux-preview/workspace'),
    path.join(os.homedir(), '.vibemux-preview', 'workspace'),
  )
})

test('resolveDefaultLocalProjectRootPath expands home-relative workspace roots', () => {
  assert.equal(
    resolveDefaultLocalProjectRootPath({
      workspaceRoot: '~/.vibemux-preview/workspace',
      ownerUserId: 'user-a',
      project: {
        name: 'vibetest',
        gitUrl: '',
      },
    }),
    path.join(os.homedir(), '.vibemux-preview', 'users', 'user-a', 'projects', 'vibetest'),
  )
})

test('resolveDefaultLocalProjectRootPath requires an owner user id', () => {
  assert.throws(
    () => resolveDefaultLocalProjectRootPath({
      workspaceRoot: '~/.vibemux-preview/workspace',
      ownerUserId: '',
      project: {
        name: 'vibetest',
        gitUrl: '',
      },
    }),
    /ownerUserId is required/,
  )
})

test('getProjectDirectoryDeletionIssue rejects protected workspace roots and their parents', () => {
  const workspaceRoot = '/tmp/vibemux/workspace'
  const protectedRoots = buildProtectedProjectDeletionRoots([workspaceRoot])

  assert.equal(
    getProjectDirectoryDeletionIssue(workspaceRoot, protectedRoots),
    `不允许删除受保护路径：${workspaceRoot}`,
  )
  assert.equal(
    getProjectDirectoryDeletionIssue('/tmp/vibemux', protectedRoots),
    '不允许删除受保护路径：/tmp/vibemux',
  )
})

test('getProjectDirectoryDeletionIssue allows deleting a concrete project directory', () => {
  const protectedRoots = buildProtectedProjectDeletionRoots(['/tmp/vibemux/workspace'])

  assert.equal(
    getProjectDirectoryDeletionIssue('/tmp/vibemux/workspace/workspaces/workspace-a/projects/demo-app', protectedRoots),
    null,
  )
})

test('buildProtectedProjectDeletionRoots always includes the home directory', () => {
  const protectedRoots = buildProtectedProjectDeletionRoots([])

  assert.ok(protectedRoots.includes(os.homedir()))
})
