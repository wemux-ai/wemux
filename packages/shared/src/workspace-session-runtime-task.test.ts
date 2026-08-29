import assert from 'node:assert/strict'
import test from 'node:test'
import type { Project } from './types'
import { buildWorkspaceSessionRuntimeTask } from './workspace-session-runtime-task'

test('builds a transient runtime task from the workspace session identity', () => {
  const task = buildWorkspaceSessionRuntimeTask({
    project: {
      id: 'project-1',
      name: 'Vibemux',
      defaultBranch: 'dev',
    } as Project,
    sessionId: 'session-1',
    title: '工作区会话',
  })

  assert.equal(task.id, 'session-1')
  assert.equal(task.projectId, 'project-1')
  assert.equal(task.title, '工作区会话')
  assert.equal(task.baseBranch, 'dev')
})
