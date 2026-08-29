import assert from 'node:assert/strict'
import test from 'node:test'

import { partitionProjectsByScope, resolveProjectScopeKind } from './project-scope'

test('resolveProjectScopeKind marks workspace projects by workspaceId', () => {
  assert.equal(resolveProjectScopeKind({
    workspaceId: 'workspace-alpha',
  }), 'workspace')
})

test('resolveProjectScopeKind marks workspace projects by visibility', () => {
  assert.equal(resolveProjectScopeKind({
    visibility: 'workspace',
  }), 'workspace')
})

test('resolveProjectScopeKind keeps personal projects private', () => {
  assert.equal(resolveProjectScopeKind({
    visibility: 'private',
  }), 'private')
})

test('partitionProjectsByScope separates workspace and private projects', () => {
  const result = partitionProjectsByScope([
    { id: 'project-1', workspaceId: 'workspace-alpha' },
    { id: 'project-2', visibility: 'private' as const },
    { id: 'project-3', visibility: 'workspace' as const },
  ])

  assert.deepEqual(result.workspaceProjects.map((project) => project.id), ['project-1', 'project-3'])
  assert.deepEqual(result.privateProjects.map((project) => project.id), ['project-2'])
  assert.deepEqual(result.sharedWithMeProjects, [])
})

test('partitionProjectsByScope splits shared-with-me personal projects by createdById', () => {
  const result = partitionProjectsByScope(
    [
      { id: 'mine', visibility: 'private' as const, createdById: 'user-a' },
      { id: 'theirs', visibility: 'private' as const, createdById: 'user-b' },
      { id: 'legacy', visibility: 'private' as const },
      { id: 'org-shared', workspaceId: 'workspace-alpha', createdById: 'user-b' },
    ],
    { currentUserId: 'user-a' },
  )

  assert.deepEqual(result.privateProjects.map((project) => project.id), ['mine', 'legacy'])
  assert.deepEqual(result.sharedWithMeProjects.map((project) => project.id), ['theirs'])
  // 协作项目永远不进「共享给我」，即使创建者是别人
  assert.ok(!result.sharedWithMeProjects.some((project) => project.id === 'org-shared'))
})

test('partitionProjectsByScope keeps all personal projects private without currentUserId', () => {
  const result = partitionProjectsByScope([
    { id: 'mine', visibility: 'private' as const, createdById: 'user-a' },
    { id: 'theirs', visibility: 'private' as const, createdById: 'user-b' },
  ])

  assert.deepEqual(result.privateProjects.map((project) => project.id), ['mine', 'theirs'])
  assert.deepEqual(result.sharedWithMeProjects, [])
})
