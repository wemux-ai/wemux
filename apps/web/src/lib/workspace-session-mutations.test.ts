import assert from 'node:assert/strict'
import test from 'node:test'
import type { WorkspaceSession } from '@shared/types'
import {
  resolveCreatedWorkspaceSession,
  resolveWorkspaceSessionRenameRequest,
} from './workspace-session-mutations'

const session = (id: string, workspaceId = 'workspace-1') => ({
  id,
  workspaceId,
  createdAt: '2026-01-01T00:00:00.000Z',
  lastActiveAt: '2026-01-01T00:00:00.000Z',
}) as WorkspaceSession

test('workspace-only session rename reuses the existing workspace session', () => {
  assert.deepEqual(
    resolveWorkspaceSessionRenameRequest({
      workspaceSessionId: 'session-1',
      workspaceId: 'workspace-1',
      title: '  新名字  ',
    }),
    {
      kind: 'update-workspace-session',
      workspaceId: 'workspace-1',
      workspaceSessionId: 'session-1',
      title: '新名字',
    },
  )
})

test('created session resolution prefers the response session', () => {
  const responseSession = session('session-2', 'workspace-2')
  assert.equal(
    resolveCreatedWorkspaceSession({
      workspaceId: 'workspace-1',
      previousSessionIds: new Set(),
      response: {
        state: { workspaceSessions: [responseSession] },
        workspaceSession: responseSession,
      },
    }),
    responseSession,
  )
})

test('created session resolution detects a new session when the response only returns state', () => {
  const previousSession = session('session-1')
  const createdSession = session('session-2')
  assert.equal(
    resolveCreatedWorkspaceSession({
      workspaceId: 'workspace-1',
      previousSessionIds: new Set(['session-1']),
      response: {
        state: { workspaceSessions: [createdSession, previousSession] },
      },
    }),
    createdSession,
  )
})
