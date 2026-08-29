import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { ExecutorRecord, Project, ProjectBinding } from '@shared/types'
import { validateProjectExecutorPathAccess } from './project-executor-ownership'

const baseProject: Project = {
  id: 'project-1',
  name: 'Local Project',
  gitUrl: '',
  versionControl: 'git-local',
  rootPath: '/worker-a/project',
  defaultBranch: 'main',
  preferredExecutorId: 'worker-a',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
}

const executors: ExecutorRecord[] = [
  {
    executorId: 'worker-a',
    machineId: 'machine-a',
    machineName: 'machine-a',
    name: 'Worker A',
    ownerUserId: 'user-1',
    visibility: 'private',
    status: 'online',
    workspaceRoot: '/worker-a/workspace',
    maxConcurrency: 5,
    capabilities: [],
    labels: [],
    createdAt: '2026-01-01T00:00:00.000Z',
  },
  {
    executorId: 'worker-b',
    machineId: 'machine-b',
    machineName: 'machine-b',
    name: 'Worker B',
    ownerUserId: 'user-1',
    visibility: 'private',
    status: 'online',
    workspaceRoot: '/worker-b/workspace',
    maxConcurrency: 5,
    capabilities: [],
    labels: [],
    createdAt: '2026-01-01T00:00:00.000Z',
  },
]

const bindings: ProjectBinding[] = [
  {
    projectId: 'project-1',
    nodeId: 'worker-a',
    repoUrl: '',
    defaultBranch: 'main',
    pathHint: '/worker-a/project',
    mode: 'manual',
    isActive: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  },
]

test('git-local projects cannot be reused on a different worker', () => {
  const result = validateProjectExecutorPathAccess({
    project: baseProject,
    executorId: 'worker-b',
    bindings,
    executors,
  })

  assert.equal(result.ok, false)
  assert.match(result.message, /Worker A/)
  assert.match(result.message, /Worker B/)
  assert.match(result.message, /\/worker-a\/project/)
  assert.match(result.message, /Git remote/)
})

test('none projects report source and target worker details when crossing nodes', () => {
  const result = validateProjectExecutorPathAccess({
    project: {
      ...baseProject,
      gitUrl: '',
      versionControl: 'none',
    },
    executorId: 'worker-b',
    bindings,
    executors,
  })

  assert.equal(result.ok, false)
  assert.match(result.message, /Worker A/)
  assert.match(result.message, /Worker B/)
  assert.match(result.message, /\/worker-a\/project/)
  assert.match(result.message, /迁移/)
})

test('git-remote projects may be prepared on another worker', () => {
  const result = validateProjectExecutorPathAccess({
    project: {
      ...baseProject,
      gitUrl: 'https://example.com/repo.git',
      versionControl: 'git-remote',
    },
    executorId: 'worker-b',
    bindings,
    executors,
  })

  assert.equal(result.ok, true)
})
