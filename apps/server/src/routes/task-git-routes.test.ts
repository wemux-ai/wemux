import assert from 'node:assert/strict'
import test from 'node:test'
import type { Task, WorkspaceSession } from '@shared/types'
import { buildWorkspaceSessionPullRequestDeliverySummary } from './task-git-routes'

test('persists a created pull request on its workspace session', () => {
  const task = {
    id: 'task-1',
    updatedAt: '2026-07-24T00:00:00.000Z',
    result: {
      workspaceId: 'workspace-1',
      workspaceSessionId: 'session-1',
      delivery: {
        pullRequest: {
          number: 57,
          url: 'https://github.com/example/repo/pull/57',
          state: 'open',
          compareBranch: 'vibemux/prd-update-v2',
        },
      },
    },
  } as Task
  const session = {
    id: 'session-1',
    workspaceId: 'workspace-1',
    updatedAt: '2026-07-24T00:00:00.000Z',
    lastActiveAt: '2026-07-24T00:00:00.000Z',
  } as WorkspaceSession

  assert.deepEqual(
    buildWorkspaceSessionPullRequestDeliverySummary(task, session)?.pullRequest,
    {
      state: 'open',
      updatedAt: '2026-07-24T00:00:00.000Z',
      number: 57,
      url: 'https://github.com/example/repo/pull/57',
      compareBranch: 'vibemux/prd-update-v2',
      workspaceId: 'workspace-1',
      workspaceSessionId: 'session-1',
    },
  )
})
