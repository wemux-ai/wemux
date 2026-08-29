import assert from 'node:assert/strict'
import test from 'node:test'
import {
  isLikelyWorkspaceFileLinkHref,
  listWorkspaceAncestorDirectories,
  pickWorkspaceFileRootPath,
  resolveWorkspaceFileLinkPath,
} from './workspace-file-link'

test('resolveWorkspaceFileLinkPath keeps absolute workspace file links and strips line markers', () => {
  const filePath = resolveWorkspaceFileLinkPath({
    href: '/Users/x/work/Vibemux/apps/web/src/routes/workspace.tsx:1042',
    baseDirectoryPath: '/Users/x/work/Vibemux',
    candidateRootPaths: ['/Users/x/work/Vibemux'],
  })

  assert.equal(filePath, '/Users/x/work/Vibemux/apps/web/src/routes/workspace.tsx')
})

test('resolveWorkspaceFileLinkPath resolves relative file links against the current directory', () => {
  const filePath = resolveWorkspaceFileLinkPath({
    href: 'apps/web/src/components/workspaces/workspace-session-list.tsx#L20',
    baseDirectoryPath: '/Users/x/work/Vibemux',
    candidateRootPaths: ['/Users/x/work/Vibemux', '/Users/x/work'],
  })

  assert.equal(filePath, '/Users/x/work/Vibemux/apps/web/src/components/workspaces/workspace-session-list.tsx')
})

test('resolveWorkspaceFileLinkPath prefers the deepest workspace root when the base directory is too broad', () => {
  const filePath = resolveWorkspaceFileLinkPath({
    href: 'apps/web/src/routes/workspace.tsx',
    baseDirectoryPath: '/Users/x/.vibemux-preview/workspace',
    candidateRootPaths: ['/Users/x/.vibemux-preview/workspace/worktrees/workspace-1'],
  })

  assert.equal(filePath, '/Users/x/.vibemux-preview/workspace/worktrees/workspace-1/apps/web/src/routes/workspace.tsx')
})

test('resolveWorkspaceFileLinkPath supports file protocol links', () => {
  const filePath = resolveWorkspaceFileLinkPath({
    href: 'file:///Users/x/work/Vibemux/apps/web/src/routes/workspace.tsx:12',
    baseDirectoryPath: '/Users/x/work/Vibemux',
    candidateRootPaths: ['/Users/x/work/Vibemux'],
  })

  assert.equal(filePath, '/Users/x/work/Vibemux/apps/web/src/routes/workspace.tsx')
})

test('resolveWorkspaceFileLinkPath expands home-directory links', () => {
  const filePath = resolveWorkspaceFileLinkPath({
    href: '~/work/Vibemux/apps/web/src/routes/workspace.tsx:7',
    baseDirectoryPath: '/Users/x/work/Vibemux',
    candidateRootPaths: ['/Users/x/work/Vibemux'],
  })

  assert.equal(filePath, '/Users/x/work/Vibemux/apps/web/src/routes/workspace.tsx')
})

test('resolveWorkspaceFileLinkPath rejects absolute paths outside the current workspace scope', () => {
  const filePath = resolveWorkspaceFileLinkPath({
    href: '/Users/x/.vibemux-preview/workspace/other-project/src/index.ts',
    baseDirectoryPath: '/Users/x/.vibemux-preview/workspace/worktrees/workspace-1',
    candidateRootPaths: ['/Users/x/.vibemux-preview/workspace/worktrees/workspace-1'],
  })

  assert.equal(filePath, null)
})

test('resolveWorkspaceFileLinkPath rejects relative paths that escape the current workspace scope', () => {
  const filePath = resolveWorkspaceFileLinkPath({
    href: '../../../other-project/src/index.ts',
    baseDirectoryPath: '/Users/x/.vibemux-preview/workspace/worktrees/workspace-1/apps/web',
    candidateRootPaths: ['/Users/x/.vibemux-preview/workspace/worktrees/workspace-1'],
  })

  assert.equal(filePath, null)
})

test('isLikelyWorkspaceFileLinkHref ignores external urls and app routes', () => {
  assert.equal(isLikelyWorkspaceFileLinkHref('https://wemux.xyz'), false)
  assert.equal(isLikelyWorkspaceFileLinkHref('/workspace?taskId=task-1'), false)
  assert.equal(isLikelyWorkspaceFileLinkHref('workspace-session-list.tsx'), true)
})

test('pickWorkspaceFileRootPath prefers the deepest matching root and lists ancestor directories', () => {
  const filePath = '/Users/x/work/Vibemux/worktrees/task-1/apps/web/src/routes/workspace.tsx'
  const rootPath = pickWorkspaceFileRootPath(
    filePath,
    [
      '/Users/x/work',
      '/Users/x/work/Vibemux',
      '/Users/x/work/Vibemux/worktrees/task-1',
    ],
    '/Users/x/work/Vibemux',
  )

  assert.equal(rootPath, '/Users/x/work/Vibemux/worktrees/task-1')
  assert.deepEqual(
    listWorkspaceAncestorDirectories(rootPath, filePath),
    [
      '/Users/x/work/Vibemux/worktrees/task-1/apps',
      '/Users/x/work/Vibemux/worktrees/task-1/apps/web',
      '/Users/x/work/Vibemux/worktrees/task-1/apps/web/src',
      '/Users/x/work/Vibemux/worktrees/task-1/apps/web/src/routes',
    ],
  )
})
