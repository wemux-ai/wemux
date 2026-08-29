import assert from 'node:assert/strict'
import test from 'node:test'

import type { CreatorIdentity, Project } from '@shared/types'
import { createTaskRecord, findTaskByOrigin } from './task-creation-service'

const project = {
  id: 'project-1',
  name: 'Vibemux',
  gitUrl: 'git@example.com:vibemux.git',
  rootPath: '',
  versionControl: 'git-remote',
  defaultBranch: 'dev',
  recentBaseBranches: ['feature/latest'],
} as Project

const creator: CreatorIdentity = {
  type: 'agent',
  id: 'agent-1',
  name: 'Product Agent',
  avatarUrl: '/avatars/product.png',
}

test('shared task creation preserves trusted creator and quick-create origin', () => {
  const task = createTaskRecord({
    project,
    actingUserId: 'user-1',
    creator,
    title: 'Create from Agent',
    description: 'Create one task from a natural-language request.',
    priority: 'high',
    status: 'todo',
    originType: 'agent_quick_create',
    originId: 'event-1',
  })

  assert.equal(task.projectId, project.id)
  assert.deepEqual(task.createdBy, creator)
  assert.equal(task.originType, 'agent_quick_create')
  assert.equal(task.originId, 'event-1')
  assert.equal(task.priority, 'high')
  assert.equal(task.baseBranchHint, 'feature/latest')
  assert.equal(findTaskByOrigin([task], 'agent_quick_create', 'event-1')?.id, task.id)
})

test('requirements are normalized into backlog by the shared creation service', () => {
  const task = createTaskRecord({
    project,
    actingUserId: 'user-1',
    creator,
    description: 'Future requirement',
    requirementType: 'requirement',
    status: 'todo',
  })

  assert.equal(task.requirementType, 'requirement')
  assert.equal(task.status, 'backlog')
})
