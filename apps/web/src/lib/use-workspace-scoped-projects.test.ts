import assert from 'node:assert/strict'
import test from 'node:test'
import {
  normalizeWorkspaceScopedPinnedProjectIds,
  resolveWorkspaceScopedActiveWorkspaceId,
  resolveWorkspaceScopedVisibleProjectIds,
  resolveWorkspaceScopedWorkspaceId,
} from './use-workspace-scoped-projects'

test('normalizes pinned project ids independently of order and duplicates', () => {
  assert.deepEqual(
    normalizeWorkspaceScopedPinnedProjectIds([' project-b ', 'project-a', 'project-b', '']),
    ['project-a', 'project-b'],
  )
})

test('prefers the route-selected workspace over the stored workspace', () => {
  assert.equal(
    resolveWorkspaceScopedWorkspaceId('workspace-demo', 'workspace-test-lab'),
    'workspace-demo',
  )
})

test('falls back to the stored workspace when no route-selected workspace is present', () => {
  assert.equal(
    resolveWorkspaceScopedWorkspaceId('', 'workspace-test-lab'),
    'workspace-test-lab',
  )
})

test('falls back to the first available collaboration workspace when the preferred id is invalid', () => {
  assert.equal(
    resolveWorkspaceScopedActiveWorkspaceId([
      {
        id: 'workspace-team-a',
        name: 'Team A',
        ownerUserId: 'user-1',
        createdAt: '2026-05-12T00:00:00.000Z',
        updatedAt: '2026-05-12T00:00:00.000Z',
      },
      {
        id: 'workspace-team-b',
        name: 'Team B',
        ownerUserId: 'user-1',
        createdAt: '2026-05-12T00:00:00.000Z',
        updatedAt: '2026-05-12T00:00:00.000Z',
      },
    ], 'task-workspace-id', ''),
    'workspace-team-a',
  )
})

test('falls back to the first available collaboration workspace when no id is selected yet', () => {
  assert.equal(
    resolveWorkspaceScopedActiveWorkspaceId([
      {
        id: 'workspace-team-a',
        name: 'Team A',
        ownerUserId: 'user-1',
        createdAt: '2026-05-12T00:00:00.000Z',
        updatedAt: '2026-05-12T00:00:00.000Z',
      },
      {
        id: 'workspace-team-b',
        name: 'Team B',
        ownerUserId: 'user-1',
        createdAt: '2026-05-12T00:00:00.000Z',
        updatedAt: '2026-05-12T00:00:00.000Z',
      },
    ], '', ''),
    'workspace-team-a',
  )
})

test('does not expose all projects while the collaboration workspace scope is unresolved', () => {
  const visibleProjectIds = resolveWorkspaceScopedVisibleProjectIds([
    {
      id: 'project-personal',
      name: 'Personal',
      gitUrl: '',
      createdAt: '2026-05-12T00:00:00.000Z',
      updatedAt: '2026-05-12T00:00:00.000Z',
    },
    {
      id: 'project-team',
      name: 'Team',
      workspaceId: 'workspace-team',
      visibility: 'workspace',
      gitUrl: '',
      createdAt: '2026-05-12T00:00:00.000Z',
      updatedAt: '2026-05-12T00:00:00.000Z',
    },
  ], null, '', [], { workspaceScopePending: true })

  assert.deepEqual([...visibleProjectIds], [])
})

test('keeps a pinned route project visible while the collaboration workspace scope is unresolved', () => {
  const visibleProjectIds = resolveWorkspaceScopedVisibleProjectIds([
    {
      id: 'project-route',
      name: 'Deep link project',
      workspaceId: 'workspace-team',
      visibility: 'workspace',
      gitUrl: '',
      createdAt: '2026-05-12T00:00:00.000Z',
      updatedAt: '2026-05-12T00:00:00.000Z',
    },
    {
      id: 'project-other',
      name: 'Other project',
      workspaceId: 'workspace-other',
      visibility: 'workspace',
      gitUrl: '',
      createdAt: '2026-05-12T00:00:00.000Z',
      updatedAt: '2026-05-12T00:00:00.000Z',
    },
  ], null, '', [], {
    pinnedProjectIds: ['project-route'],
    workspaceScopePending: true,
  })

  assert.deepEqual([...visibleProjectIds], ['project-route'])
})

test('keeps personal projects out of a regular team workspace', () => {
  const visibleProjectIds = resolveWorkspaceScopedVisibleProjectIds([
    {
      id: 'project-personal',
      name: 'Personal',
      gitUrl: '',
      createdAt: '2026-05-12T00:00:00.000Z',
      updatedAt: '2026-05-12T00:00:00.000Z',
    },
    {
      id: 'project-team',
      name: 'Team',
      workspaceId: 'workspace-team',
      visibility: 'workspace',
      gitUrl: '',
      createdAt: '2026-05-12T00:00:00.000Z',
      updatedAt: '2026-05-12T00:00:00.000Z',
    },
  ], {
    id: 'workspace-team',
    name: 'Team',
    description: '组织',
    ownerUserId: 'user-1',
    createdAt: '2026-05-12T00:00:00.000Z',
    updatedAt: '2026-05-12T00:00:00.000Z',
  }, 'workspace-team', ['project-team'])

  assert.deepEqual([...visibleProjectIds], ['project-team'])
})

test('keeps a pinned route project visible outside the selected collaboration workspace', () => {
  const visibleProjectIds = resolveWorkspaceScopedVisibleProjectIds([
    {
      id: 'project-team',
      name: 'Team',
      workspaceId: 'workspace-team',
      visibility: 'workspace',
      gitUrl: '',
      createdAt: '2026-05-12T00:00:00.000Z',
      updatedAt: '2026-05-12T00:00:00.000Z',
    },
    {
      id: 'project-route',
      name: 'Route target',
      workspaceId: 'workspace-route',
      visibility: 'workspace',
      gitUrl: '',
      createdAt: '2026-05-12T00:00:00.000Z',
      updatedAt: '2026-05-12T00:00:00.000Z',
    },
  ], {
    id: 'workspace-team',
    name: 'Team',
    description: '组织',
    ownerUserId: 'user-1',
    createdAt: '2026-05-12T00:00:00.000Z',
    updatedAt: '2026-05-12T00:00:00.000Z',
  }, 'workspace-team', ['project-team'], {
    pinnedProjectIds: ['project-route'],
  })

  assert.deepEqual([...visibleProjectIds], ['project-team', 'project-route'])
})

test('shows projects explicitly shared to a regular team workspace', () => {
  const visibleProjectIds = resolveWorkspaceScopedVisibleProjectIds([
    {
      id: 'project-shared',
      name: 'Shared',
      visibility: 'private',
      gitUrl: '',
      createdAt: '2026-05-12T00:00:00.000Z',
      updatedAt: '2026-05-12T00:00:00.000Z',
    },
  ], {
    id: 'workspace-team',
    name: 'Team',
    description: '组织',
    ownerUserId: 'user-1',
    createdAt: '2026-05-12T00:00:00.000Z',
    updatedAt: '2026-05-12T00:00:00.000Z',
  }, 'workspace-team', ['project-shared'])

  assert.deepEqual([...visibleProjectIds], ['project-shared'])
})

test('shows legacy personal projects in the default personal workspace', () => {
  const visibleProjectIds = resolveWorkspaceScopedVisibleProjectIds([
    {
      id: 'project-personal',
      name: 'Personal',
      gitUrl: '',
      createdAt: '2026-05-12T00:00:00.000Z',
      updatedAt: '2026-05-12T00:00:00.000Z',
    },
  ], {
    id: 'workspace-personal',
    name: 'Personal',
    description: '个人默认工作区',
    ownerUserId: 'user-1',
    createdAt: '2026-05-12T00:00:00.000Z',
    updatedAt: '2026-05-12T00:00:00.000Z',
  }, 'workspace-personal', [])

  assert.deepEqual([...visibleProjectIds], ['project-personal'])
})
