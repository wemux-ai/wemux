import assert from 'node:assert/strict'
import test from 'node:test'
import type { Project } from '@shared/types'
import { buildWorkspaceProjectRootPath, buildWorkspaceRepoPath } from '@shared/workspace-paths'
import { remapManagedWorkspaceProjectPath, resolveProjectRuntimeRootPath, resolveWorkspaceRepoPath } from './workspace-repo-path'

const ownerUserId = 'user-a'

const remoteProject: Project = {
  id: 'project-1',
  name: 'TodoMap',
  gitUrl: 'https://github.com/example/todomap.git',
  versionControl: 'git-remote',
  rootPath: '/Users/old/work/todoMap',
  defaultBranch: 'main',
  recentBaseBranches: [],
  createdById: ownerUserId,
  description: '',
  status: 'active',
  priority: 'medium',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
} as Project

test('resolveWorkspaceRepoPath prefers the current executor workspace repo path for remote worktree mode', () => {
  const workspaceRoot = '/home/new/.vibemux-dev/workspace'
  const staleWorkspaceRepoPath = '/Users/old/work/todoMap'

  const repoPath = resolveWorkspaceRepoPath({
    project: remoteProject,
    workspaceRoot,
    workspace: {
      repoPath: staleWorkspaceRepoPath,
      workingDirectoryMode: 'worktree',
    },
  })

  assert.equal(repoPath, buildWorkspaceRepoPath(workspaceRoot, remoteProject, undefined, ownerUserId))
})

test('resolveWorkspaceRepoPath ignores executor binding paths for remote worktree mode', () => {
  const workspaceRoot = '/home/new/.vibemux-dev/workspace'
  const bindingPathHint = '/mnt/repos/todomap'

  const repoPath = resolveWorkspaceRepoPath({
    project: remoteProject,
    workspaceRoot,
    workspace: {
      repoPath: '/Users/old/work/todoMap',
      workingDirectoryMode: 'worktree',
    },
    bindingPathHint,
  })

  assert.equal(repoPath, buildWorkspaceRepoPath(workspaceRoot, remoteProject, undefined, ownerUserId))
})

test('resolveWorkspaceRepoPath separates the same remote project by workspace id', () => {
  const workspaceRoot = '/home/new/.vibemux-dev/workspace'

  const workspaceARepoPath = resolveWorkspaceRepoPath({
    project: remoteProject,
    workspaceRoot,
    workspace: {
      id: 'workspace-a',
      workingDirectoryMode: 'worktree',
    },
  })
  const workspaceBRepoPath = resolveWorkspaceRepoPath({
    project: remoteProject,
    workspaceRoot,
    workspace: {
      id: 'workspace-b',
      workingDirectoryMode: 'worktree',
    },
  })

  assert.equal(workspaceARepoPath, buildWorkspaceRepoPath(workspaceRoot, remoteProject, 'workspace-a'))
  assert.equal(workspaceBRepoPath, buildWorkspaceRepoPath(workspaceRoot, remoteProject, 'workspace-b'))
  assert.notEqual(workspaceARepoPath, workspaceBRepoPath)
})

test('resolveWorkspaceRepoPath uses user B executor repo path for a remote project created on user A executor', () => {
  const userAWorkspaceRoot = '/Users/a/.vibemux-dev/workspace'
  const userBWorkspaceRoot = '/Users/b/.vibemux-dev/workspace'
  const projectCreatedOnUserA: Project = {
    ...remoteProject,
    rootPath: buildWorkspaceRepoPath(userAWorkspaceRoot, remoteProject, undefined, ownerUserId),
    preferredExecutorId: 'executor-a',
  }

  const repoPath = resolveWorkspaceRepoPath({
    project: projectCreatedOnUserA,
    workspaceRoot: userBWorkspaceRoot,
    workspace: {
      executorNodeId: 'executor-b',
      workingDirectoryMode: 'worktree',
    },
    bindingPathHint: buildWorkspaceRepoPath(userAWorkspaceRoot, remoteProject, undefined, ownerUserId),
  })

  assert.equal(repoPath, buildWorkspaceRepoPath(userBWorkspaceRoot, remoteProject, undefined, ownerUserId))
})

test('resolveWorkspaceRepoPath uses the project default path for remote original-dir sessions', () => {
  const workspaceRoot = '/home/new/.vibemux-dev/workspace'
  const bindingPathHint = '/mnt/nodes/executor-1/todomap'

  const repoPath = resolveWorkspaceRepoPath({
    project: remoteProject,
    workspaceRoot,
    workspace: {
      repoPath: '/Users/old/work/todoMap',
      workingDirectoryMode: 'original-dir',
    },
    bindingPathHint,
  })

  assert.equal(repoPath, buildWorkspaceRepoPath(workspaceRoot, remoteProject, undefined, ownerUserId))
})

test('resolveWorkspaceRepoPath falls back to the current executor default repo path for remote original-dir without binding', () => {
  const workspaceRoot = '/home/new/.vibemux-dev/workspace'

  const repoPath = resolveWorkspaceRepoPath({
    project: remoteProject,
    workspaceRoot,
    workspace: {
      repoPath: remoteProject.rootPath,
      workingDirectoryMode: 'original-dir',
    },
  })

  assert.equal(repoPath, buildWorkspaceRepoPath(workspaceRoot, remoteProject, undefined, ownerUserId))
})

test('resolveWorkspaceRepoPath ignores stale workspace repo paths when current runtime executor has no binding', () => {
  const workspaceRoot = '/home/runtime/.vibemux-dev/workspace'

  const repoPath = resolveWorkspaceRepoPath({
    project: remoteProject,
    workspaceRoot,
    workspace: {
      repoPath: '/Users/old/work/todoMap',
      workingDirectoryMode: 'original-dir',
    },
    session: {
      workingDirectoryMode: 'original-dir',
    },
  })

  assert.equal(repoPath, buildWorkspaceRepoPath(workspaceRoot, remoteProject, undefined, ownerUserId))
})

test('resolveWorkspaceRepoPath ignores owner-node repo paths when the session runs on another executor', () => {
  const workspaceRoot = '/home/session/.vibemux-dev/workspace'
  const localProject: Project = {
    ...remoteProject,
    gitUrl: '',
    rootPath: '',
    versionControl: 'none',
  }

  const repoPath = resolveWorkspaceRepoPath({
    project: localProject,
    workspaceRoot,
    workspace: {
      executorNodeId: 'executor-owner',
      repoPath: '/Users/owner/work/todoMap',
      workingDirectoryMode: 'original-dir',
    },
    session: {
      executorNodeId: 'executor-session',
      runtimeOwnerExecutorId: 'executor-session',
      workingDirectoryMode: 'original-dir',
    },
  })

  assert.equal(repoPath, buildWorkspaceProjectRootPath(workspaceRoot, localProject, undefined, ownerUserId))
})

test('resolveWorkspaceRepoPath separates original-dir local projects by workspace id', () => {
  const workspaceRoot = '/Users/x/.vibemux-dev/workspace'
  const localProject: Project = {
    ...remoteProject,
    gitUrl: '',
    rootPath: '/Users/x/.vibemux-dev/workspace/projects/todomap',
    versionControl: 'none',
  }

  const workspaceARepoPath = resolveWorkspaceRepoPath({
    project: localProject,
    workspaceRoot,
    workspace: {
      id: 'workspace-a',
      workingDirectoryMode: 'original-dir',
    },
  })
  const workspaceBRepoPath = resolveWorkspaceRepoPath({
    project: localProject,
    workspaceRoot,
    workspace: {
      id: 'workspace-b',
      workingDirectoryMode: 'original-dir',
    },
  })

  assert.equal(workspaceARepoPath, buildWorkspaceProjectRootPath(workspaceRoot, localProject, 'workspace-a'))
  assert.equal(workspaceBRepoPath, buildWorkspaceProjectRootPath(workspaceRoot, localProject, 'workspace-b'))
  assert.notEqual(workspaceARepoPath, workspaceBRepoPath)
})

test('resolveWorkspaceRepoPath scopes managed binding hints for original-dir local projects', () => {
  const workspaceRoot = '/Users/x/.vibemux-dev/workspace'
  const localProject: Project = {
    ...remoteProject,
    gitUrl: '',
    rootPath: '/Users/x/.vibemux-dev/workspace/projects/todomap',
    versionControl: 'none',
  }

  const repoPath = resolveWorkspaceRepoPath({
    project: localProject,
    workspaceRoot,
    workspace: {
      id: 'workspace-a',
      workingDirectoryMode: 'original-dir',
    },
    session: {
      workspaceId: 'workspace-a',
      workingDirectoryMode: 'original-dir',
    },
    bindingPathHint: '/Users/x/.vibemux-dev/workspace/projects/todomap',
  })

  assert.equal(repoPath, buildWorkspaceProjectRootPath(workspaceRoot, localProject, 'workspace-a'))
})

test('resolveWorkspaceRepoPath ignores legacy remote repo paths that point at the workspace root container', () => {
  const workspaceRoot = '/home/new/.vibemux-dev/workspace'

  const repoPath = resolveWorkspaceRepoPath({
    project: remoteProject,
    workspaceRoot,
    workspace: {
      repoPath: workspaceRoot,
      workingDirectoryMode: 'original-dir',
    },
  })

  assert.equal(repoPath, buildWorkspaceRepoPath(workspaceRoot, remoteProject, undefined, ownerUserId))
})

test('resolveProjectRuntimeRootPath remaps managed local project paths across executors', () => {
  const workspaceRoot = '/Users/x/.vibemux-dev/workspace'
  const localProject: Project = {
    ...remoteProject,
    gitUrl: '',
    versionControl: 'none',
    rootPath: '/root/.vibemux-dev/workspace/projects/todomap',
  }

  assert.equal(
    resolveProjectRuntimeRootPath(localProject, workspaceRoot),
    buildWorkspaceProjectRootPath(workspaceRoot, localProject, undefined, ownerUserId),
  )
})

test('resolveProjectRuntimeRootPath preserves explicit local project paths', () => {
  const workspaceRoot = '/Users/x/.vibemux-dev/workspace'
  const localProject: Project = {
    ...remoteProject,
    gitUrl: '',
    versionControl: 'none',
    rootPath: '/Users/x/work/todomap',
  }

  assert.equal(resolveProjectRuntimeRootPath(localProject, workspaceRoot), '/Users/x/work/todomap')
})

test('remapManagedWorkspaceProjectPath only remaps managed project paths', () => {
  const workspaceRoot = '/Users/x/.vibemux-dev/workspace'

  assert.equal(
    remapManagedWorkspaceProjectPath(workspaceRoot, '/root/.vibemux-dev/workspace/projects/todomap'),
    '/root/.vibemux-dev/workspace/projects/todomap',
  )
  assert.equal(
    remapManagedWorkspaceProjectPath(workspaceRoot, '/root/.vibemux-dev/workspace/workspaces/workspace-a/projects/todomap'),
    '/Users/x/.vibemux-dev/workspaces/workspace-a/projects/todomap',
  )
  assert.equal(
    remapManagedWorkspaceProjectPath(workspaceRoot, '/root/.vibemux-dev/users/user-a/workspaces/workspace-a/projects/todomap'),
    '/Users/x/.vibemux-dev/workspaces/workspace-a/projects/todomap',
  )
  assert.equal(
    remapManagedWorkspaceProjectPath(workspaceRoot, '/root/.vibemux-dev/workspace/repos/todomap'),
    '/root/.vibemux-dev/workspace/repos/todomap',
  )
  assert.equal(
    remapManagedWorkspaceProjectPath(workspaceRoot, '/Users/x/work/todomap'),
    '/Users/x/work/todomap',
  )
})
