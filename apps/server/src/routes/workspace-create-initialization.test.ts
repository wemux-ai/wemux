import assert from 'node:assert/strict'
import test from 'node:test'
import type { AppState, Project, Task, WorkspaceRecord, WorkspaceSession } from '@shared/types'
import { resolveWorkspaceCreateInitialization } from './workspace-management-routes'

const project = {
  id: 'project-1',
  name: 'Project',
  gitUrl: 'https://example.com/project.git',
  defaultBranch: 'main',
  createdAt: '2026-07-20T00:00:00.000Z',
  updatedAt: '2026-07-20T00:00:00.000Z',
} as Project
const workspace = {
  id: 'workspace-1',
  projectId: project.id,
  executorNodeId: 'executor-1',
  name: 'Workspace',
  agentType: 'OpenCode',
} as WorkspaceRecord
const session = {
  id: 'session-1',
  workspaceId: workspace.id,
  title: 'Session',
  agentType: 'OpenCode',
  status: 'active',
  createdAt: '2026-07-20T00:00:00.000Z',
  updatedAt: '2026-07-20T00:00:00.000Z',
} as WorkspaceSession

test('initializes a taskless workspace with a transient session runtime task', () => {
  const result = resolveWorkspaceCreateInitialization({
    state: { tasks: [], taskWorkspaceBindings: [] } as unknown as AppState,
    project,
    workspace,
    session,
  })

  assert.equal(result.task.id, session.id)
  assert.equal(result.task.projectId, project.id)
  assert.equal(result.persistTask, false)
})

test('ignores a stale session-shaped workspace binding when its task does not exist', () => {
  const result = resolveWorkspaceCreateInitialization({
    state: {
      tasks: [],
      taskWorkspaceBindings: [{
        id: 'stale-binding',
        taskId: session.id,
        workspaceId: workspace.id,
        status: 'active',
      }],
    } as unknown as AppState,
    project,
    workspace,
    session,
  })

  assert.equal(result.task.id, session.id)
  assert.equal(result.persistTask, false)
})

test('keeps a real task as the persisted workspace initialization context', () => {
  const task = { id: 'task-1', projectId: project.id } as Task
  const result = resolveWorkspaceCreateInitialization({
    state: { tasks: [task], taskWorkspaceBindings: [] } as unknown as AppState,
    project,
    workspace,
    session,
    persistedTask: task,
  })

  assert.equal(result.task, task)
  assert.equal(result.persistTask, true)
})
