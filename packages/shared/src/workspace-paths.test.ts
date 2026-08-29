import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildWorkspacePlaygroundSessionDir,
  buildWorkspaceProjectRootPath,
  buildWorkspaceRepoPath,
  buildWorkspaceWorktreePath,
  generatePlaygroundSuffix,
  isManagedWorkspaceOwnedProjectPath,
  isManagedWorkspaceProjectPath,
  isManagedWorkspaceRepoPath,
} from './workspace-paths'

const createProject = (overrides: Partial<{ name: string; gitUrl: string }> = {}) => ({
  name: overrides.name ?? 'todoMap',
  gitUrl: overrides.gitUrl ?? '',
})

test('isManagedWorkspaceProjectPath matches the configured projects directory', () => {
  assert.equal(
    isManagedWorkspaceProjectPath(
      '/Users/x/custom-vibe/workspaces/workspace-a/projects/todomap',
      createProject(),
      '/Users/x/custom-vibe',
      'workspace-a',
      'user-a',
    ),
    true,
  )
  assert.equal(
    isManagedWorkspaceProjectPath(
      '/Users/x/custom-vibe/projects/todomap',
      createProject(),
      '/Users/x/custom-vibe',
    ),
    false,
  )
})

test('isManagedWorkspaceProjectPath matches legacy home-expanded project roots', () => {
  assert.equal(
    isManagedWorkspaceProjectPath(
      '/Users/x/.vibemux-preview/workspace/projects/todomap',
      createProject(),
      '~/.vibemux-preview/workspace',
    ),
    true,
  )
})

test('isManagedWorkspaceRepoPath matches managed clone directories', () => {
  assert.equal(
    isManagedWorkspaceRepoPath(
      '/Users/x/custom-vibe/workspaces/workspace-a/repos/todomap',
      createProject({ gitUrl: 'https://github.com/acme/todoMap.git' }),
      '/Users/x/custom-vibe',
      'workspace-a',
      'user-a',
    ),
    true,
  )
})

test('workspace-scoped paths include workspace id before managed containers', () => {
  const workspaceRoot = '/Users/x/custom-vibe'
  const project = createProject({ gitUrl: 'https://github.com/acme/todoMap.git' })

  assert.equal(
    buildWorkspaceRepoPath(workspaceRoot, project, 'workspace-a', 'user-a'),
    '/Users/x/custom-vibe/workspaces/workspace-a/repos/todomap',
  )
  assert.equal(
    buildWorkspaceProjectRootPath(workspaceRoot, project, 'workspace-a', 'user-a'),
    '/Users/x/custom-vibe/workspaces/workspace-a/projects/todomap',
  )
  assert.equal(
    buildWorkspaceWorktreePath(workspaceRoot, { ...project, id: 'project-1' }, 'worktree-1', 'workspace-a', 'user-a'),
    '/Users/x/custom-vibe/workspaces/workspace-a/worktrees/worktree-1',
  )
})

test('user-scoped paths omit workspace id when no execution workspace is provided', () => {
  const workspaceRoot = '/Users/x/custom-vibe'
  const project = createProject({ gitUrl: 'https://github.com/acme/todoMap.git' })

  assert.equal(
    buildWorkspaceRepoPath(workspaceRoot, project, undefined, 'user-a'),
    '/Users/x/custom-vibe/users/user-a/repos/todomap',
  )
  assert.equal(
    buildWorkspaceProjectRootPath(workspaceRoot, project, undefined, 'user-a'),
    '/Users/x/custom-vibe/users/user-a/projects/todomap',
  )
  assert.equal(
    buildWorkspaceWorktreePath(workspaceRoot, { ...project, id: 'project-1' }, 'worktree-1', undefined, 'user-a'),
    '/Users/x/custom-vibe/users/user-a/worktrees/worktree-1',
  )
})

test('managed user paths require an explicit non-placeholder user id', () => {
  const workspaceRoot = '/Users/x/custom-vibe'
  const project = createProject({ gitUrl: 'https://github.com/acme/todoMap.git' })

  assert.throws(
    () => buildWorkspaceRepoPath(workspaceRoot, project),
    /userId is required/,
  )
  assert.throws(
    () => buildWorkspaceProjectRootPath(workspaceRoot, project, undefined, 'unknown'),
    /userId is required/,
  )
  assert.throws(
    () => buildWorkspaceProjectRootPath(workspaceRoot, project, 'unknown', 'user-a'),
    /workspaceId is required/,
  )
})

test('managed path checks can target a specific workspace scope', () => {
  const project = createProject({ gitUrl: 'https://github.com/acme/todoMap.git' })

  assert.equal(
    isManagedWorkspaceRepoPath(
      '/Users/x/custom-vibe/workspaces/workspace-a/repos/todomap',
      project,
      '/Users/x/custom-vibe',
      'workspace-a',
      'user-a',
    ),
    true,
  )
  assert.equal(
    isManagedWorkspaceRepoPath(
      '/Users/x/custom-vibe/workspaces/workspace-b/repos/todomap',
      project,
      '/Users/x/custom-vibe',
      'workspace-a',
      'user-a',
    ),
    false,
  )
})

test('isManagedWorkspaceOwnedProjectPath rejects original directories', () => {
  assert.equal(
    isManagedWorkspaceOwnedProjectPath(
      '/Users/x/work/todoMap',
      createProject({ gitUrl: 'https://github.com/acme/todoMap.git' }),
      '/Users/x/custom-vibe',
    ),
    false,
  )
})

test('buildWorkspacePlaygroundSessionDir produces codex-style date/random layout', () => {
  assert.equal(
    buildWorkspacePlaygroundSessionDir('/Users/x/vibe', 'workspace-a', '2026-08-10T12:00:00.000Z', 'k7xq'),
    '/Users/x/vibe/workspaces/workspace-a/playground/2026-08-10/k7xq',
  )
  assert.equal(
    buildWorkspacePlaygroundSessionDir('/Users/x/vibe', 'workspace-a', new Date('2026-08-10T12:00:00.000Z'), 'k7xq'),
    '/Users/x/vibe/workspaces/workspace-a/playground/2026-08-10/k7xq',
  )
})

test('buildWorkspacePlaygroundSessionDir sanitizes suffix and rejects invalid date', () => {
  assert.equal(
    buildWorkspacePlaygroundSessionDir('/Users/x/vibe', 'workspace-a', '2026-08-10T12:00:00.000Z', 'a b/c'),
    '/Users/x/vibe/workspaces/workspace-a/playground/2026-08-10/a-b-c',
  )
  assert.equal(
    buildWorkspacePlaygroundSessionDir('/Users/x/vibe', 'workspace-a', 'not-a-date', 'k7xq'),
    '',
  )
  assert.equal(
    buildWorkspacePlaygroundSessionDir('/Users/x/vibe', 'workspace-a', new Date('2026-08-10T12:00:00.000Z'), '  '),
    '/Users/x/vibe/workspaces/workspace-a/playground/2026-08-10/work',
  )
})

test('generatePlaygroundSuffix always returns an alphanumeric string', () => {
  assert.match(generatePlaygroundSuffix(), /^[a-z0-9]{4}$/)
  assert.match(generatePlaygroundSuffix(6), /^[a-z0-9]{6}$/)
  assert.equal(generatePlaygroundSuffix(0), 'work')
})
