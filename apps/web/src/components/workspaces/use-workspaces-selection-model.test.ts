import assert from 'node:assert/strict'
import test from 'node:test'
import type { Project, Task, Workspace } from '@shared/types'
import type { WorkspaceListItem } from './workspaces-page-utils'
import { resolveSelectedWorkspaceTask } from './use-workspaces-selection-model'

const task = { id: 'task-1', projectId: 'project-1' } as Task
const item = {
  workspace: { id: 'workspace-1', projectId: 'project-1' } as Workspace,
  project: { id: 'project-1' } as Project,
  activeTask: task,
  linkedTasks: [task],
} as WorkspaceListItem

test('uses only the workspace-level active task binding', () => {
  assert.equal(resolveSelectedWorkspaceTask(item), task)
  assert.equal(resolveSelectedWorkspaceTask({ ...item, activeTask: null }), null)
})
