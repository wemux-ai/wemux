import assert from 'node:assert/strict'
import test from 'node:test'
import type { ProjectPullRequestReviewSummary, Workspace } from '@shared/types'
import {
  loadWorkspacesPageReviewPullRequests,
  normalizeWorkspacesPageDirectoryCache,
  resolvePreferredWorkspacesPageDirectoryData,
  resolveWorkspacesPageDirectoryLoadOrder,
  resolveWorkspacesPageDirectoryLoading,
  resolveWorkspacesPageDirectoryProjectIdsKey,
  resolveWorkspacesPageDirectoryProjectIds,
  resolveWorkspacesPageDirectoryRefetchInterval,
  workspacesPageQueryKeys,
  type WorkspacesPageDirectoryData,
} from './workspaces-page-queries'

const createPullRequest = (number: number): ProjectPullRequestReviewSummary => ({
  id: `pr-${number}`,
  provider: 'github',
  projectId: 'project-a',
  repoHost: 'github.com',
  repoOwner: 'example',
  repoName: 'repo',
  repoFullName: 'example/repo',
  repoUrl: 'https://github.com/example/repo',
  number,
  url: `https://github.com/example/repo/pull/${number}`,
  title: `PR ${number}`,
  body: '',
  state: 'open',
  merged: false,
  draft: false,
  baseBranch: 'main',
  compareBranch: `feature/${number}`,
  additions: 0,
  deletions: 0,
  changedFiles: 0,
  files: [],
  syncedAt: '2026-07-24T00:00:00.000Z',
})

test('resolveWorkspacesPageDirectoryProjectIds prioritizes routed and selected projects', () => {
  assert.deepEqual(resolveWorkspacesPageDirectoryProjectIds({
    projects: [{ id: 'project-a' }, { id: 'project-b' }, { id: 'project-c' }],
    routeProjectId: 'project-b',
    selectedProjectId: 'project-c',
    routeTaskId: undefined,
    routeWorkspaceId: undefined,
    tasks: [],
    taskWorkspaceBindings: [],
    workspaceSessions: [],
  }), ['project-b', 'project-c', 'project-a'])
})

test('resolveWorkspacesPageDirectoryProjectIds resolves route workspace project from local session state', () => {
  assert.deepEqual(resolveWorkspacesPageDirectoryProjectIds({
    projects: [{ id: 'project-a' }, { id: 'project-b' }],
    routeProjectId: undefined,
    selectedProjectId: undefined,
    routeTaskId: undefined,
    routeWorkspaceId: 'workspace-b',
    tasks: [
      { id: 'task-a', projectId: 'project-a' },
      { id: 'task-b', projectId: 'project-b' },
    ],
    taskWorkspaceBindings: [
      { id: 'binding-a', taskId: 'task-a', workspaceId: 'workspace-a', status: 'active' },
      { id: 'binding-b', taskId: 'task-b', workspaceId: 'workspace-b', status: 'active' },
    ],
    workspaceSessions: [
      { workspaceId: 'workspace-b' },
    ],
  }), ['project-b', 'project-a'])
})

test('resolveWorkspacesPageDirectoryLoadOrder keeps priority projects first and includes every visible project', () => {
  assert.deepEqual(resolveWorkspacesPageDirectoryLoadOrder(
    [{ id: 'project-a' }, { id: 'project-b' }, { id: 'project-c' }, { id: 'project-d' }],
    ['project-c', 'project-a', 'missing-project'],
  ), ['project-c', 'project-a', 'project-b', 'project-d'])
})

test('resolveWorkspacesPageDirectoryProjectIdsKey ignores order and duplicate ids', () => {
  assert.equal(
    resolveWorkspacesPageDirectoryProjectIdsKey([' project-b ', 'project-a', 'project-b']),
    'project-a|project-b',
  )
})

test('review pull request query key is scoped by visible project ids', () => {
  assert.deepEqual(
    workspacesPageQueryKeys.reviewPullRequests('project-a|project-b'),
    ['workspaces', 'github-pull-requests', 'project-a|project-b'],
  )
})

test('loads every review pull request page for workspace card matching', async () => {
  const requestedCursors: Array<string | undefined> = []
  const pullRequests = await loadWorkspacesPageReviewPullRequests(
    ['project-a'],
    async ({ cursor, limit, projectIds, scope }) => {
      requestedCursors.push(cursor)
      assert.equal(limit, 100)
      assert.deepEqual(projectIds, ['project-a'])
      assert.equal(scope, 'summary')

      return cursor
        ? {
            pullRequests: [createPullRequest(22)],
            hasMore: false,
          }
        : {
            pullRequests: [createPullRequest(21)],
            nextCursor: 'next-page',
            hasMore: true,
          }
    },
  )

  assert.deepEqual(requestedCursors, [undefined, 'next-page'])
  assert.deepEqual(pullRequests.map((pullRequest) => pullRequest.number), [21, 22])
})

test('resolveWorkspacesPageDirectoryRefetchInterval disables polling for hidden tabs', () => {
  assert.equal(resolveWorkspacesPageDirectoryRefetchInterval(false, true), false)
  assert.equal(resolveWorkspacesPageDirectoryRefetchInterval(true, true), false)
})

test('resolveWorkspacesPageDirectoryRefetchInterval keeps active polling cadence for visible tabs', () => {
  assert.equal(resolveWorkspacesPageDirectoryRefetchInterval(true, false), 5_000)
  assert.equal(resolveWorkspacesPageDirectoryRefetchInterval(false, false), 30_000)
})

test('resolveWorkspacesPageDirectoryLoading keeps loading while workspace project scope settles', () => {
  assert.equal(resolveWorkspacesPageDirectoryLoading({
    workspaceScopeLoading: true,
    directoryLoading: false,
  }), true)
  assert.equal(resolveWorkspacesPageDirectoryLoading({
    workspaceScopeLoading: false,
    directoryLoading: false,
  }), false)
})

test('prefers active directory data until archived directory payload is loaded', () => {
  const activeWorkspace = {
    id: 'workspace-active',
    projectId: 'project-a',
    executorNodeId: 'executor-a',
    agentType: 'OpenCode',
    name: 'Active workspace',
    status: 'ready',
    repoReady: false,
    source: 'manual',
    workingDirectoryMode: 'worktree',
    executorName: 'Executor A',
    executorStatus: 'offline',
    createdAt: '2026-07-09T00:00:00.000Z',
    updatedAt: '2026-07-09T00:00:00.000Z',
  } satisfies Partial<Workspace> as Workspace
  const activeDirectoryData: WorkspacesPageDirectoryData = {
    archivedWorkspaceCountByProject: { 'project-a': 1 },
    executors: [],
    managedCloudRuntime: null,
    presenceByWorkspaceId: {},
    previewByWorkspaceId: {},
    updatedProjects: [],
    workspacesByProject: {
      'project-a': [activeWorkspace],
    },
  }
  const archivedDirectoryData: WorkspacesPageDirectoryData = {
    archivedWorkspaceCountByProject: { 'project-a': 1 },
    executors: [],
    managedCloudRuntime: null,
    presenceByWorkspaceId: {},
    previewByWorkspaceId: {},
    updatedProjects: [],
    workspacesByProject: {
      'project-a': [],
    },
  }

  assert.equal(resolvePreferredWorkspacesPageDirectoryData({
    activeDirectoryData,
    archivedDirectoryData,
    archivedDirectoryLoaded: false,
  }), activeDirectoryData)
  assert.equal(resolvePreferredWorkspacesPageDirectoryData({
    activeDirectoryData,
    archivedDirectoryData,
    archivedDirectoryLoaded: true,
  }), archivedDirectoryData)
})

test('normalizeWorkspacesPageDirectoryCache preserves archived counts for active-only cache', () => {
  const activeWorkspace = {
    id: 'workspace-active',
    projectId: 'project-a',
    executorNodeId: 'executor-a',
    agentType: 'OpenCode',
    name: 'Active workspace',
    status: 'ready',
    repoReady: false,
    source: 'manual',
    workingDirectoryMode: 'worktree',
    executorName: 'Executor A',
    executorStatus: 'offline',
    createdAt: '2026-07-09T00:00:00.000Z',
    updatedAt: '2026-07-09T00:00:00.000Z',
  } satisfies Partial<Workspace> as Workspace
  const directoryData: WorkspacesPageDirectoryData = {
    archivedWorkspaceCountByProject: { 'project-a': 3 },
    executors: [],
    managedCloudRuntime: null,
    presenceByWorkspaceId: {},
    previewByWorkspaceId: {},
    updatedProjects: [],
    workspacesByProject: {
      'project-a': [activeWorkspace],
    },
  }

  const normalized = normalizeWorkspacesPageDirectoryCache(directoryData, false)

  assert.equal(normalized.archivedWorkspaceCountByProject['project-a'], 3)
  assert.deepEqual(normalized.workspacesByProject['project-a'], [activeWorkspace])
})
