import assert from 'node:assert/strict'
import test from 'node:test'
import type { WorkspaceSession } from '@shared/types'
import { listWorkspaceSessionsForWorkspace, resolveWorkspaceSessionForWorkspace } from './workspace-session-scope'

const createWorkspaceSession = (overrides: Partial<WorkspaceSession> = {}): WorkspaceSession => ({
  id: 'session-1',
  workspaceId: 'workspace-1',
  title: 'AI 对话',
  titleOrigin: 'system',
  status: 'active',
  sessionKind: 'primary',
  sessionRole: 'general',
  sessionOrigin: 'manual',
  worktreeId: 'worktree-1',
  branchName: 'main',
  worktreeStatus: 'planned',
  workingDirectoryMode: 'original-dir',
  needsHumanConfirm: false,
  agentRunningStatus: 'idle',
  runtimeStatus: 'idle',
  runtimeSequence: 0,
  currentStep: '',
  lastActiveAt: '2026-06-02T00:00:00.000Z',
  createdAt: '2026-06-02T00:00:00.000Z',
  updatedAt: '2026-06-02T00:00:00.000Z',
  ...overrides,
} as WorkspaceSession)

test('lists all workspace sessions even when a task id is provided', () => {
  const sessions = listWorkspaceSessionsForWorkspace({
    workspaceId: 'workspace-1',
    workspaceSessions: [
      createWorkspaceSession({ id: 'session-workspace-only' }),
      createWorkspaceSession({ id: 'session-second', lastActiveAt: '2026-06-02T01:00:00.000Z' }),
      createWorkspaceSession({ id: 'session-other-workspace', workspaceId: 'workspace-2' }),
    ],
  })

  assert.deepEqual(sessions.map((session) => session.id), ['session-second', 'session-workspace-only'])
})

test('returns no sessions without a workspace id', () => {
  const sessions = listWorkspaceSessionsForWorkspace({
    workspaceId: undefined,
    workspaceSessions: [
      createWorkspaceSession({ id: 'session-1' }),
    ],
  })

  assert.deepEqual(sessions, [])
})

test('resolves the requested workspace session within the workspace scope', () => {
  const session = resolveWorkspaceSessionForWorkspace({
    workspaceId: 'workspace-1',
    workspaceSessionId: 'session-2',
    workspaceSessions: [
      createWorkspaceSession({ id: 'session-1', lastActiveAt: '2026-06-02T00:00:00.000Z' }),
      createWorkspaceSession({ id: 'session-2', lastActiveAt: '2026-06-02T01:00:00.000Z' }),
    ],
  })

  assert.equal(session?.id, 'session-2')
})

test('falls back to the latest workspace session when the requested session id is stale', () => {
  const session = resolveWorkspaceSessionForWorkspace({
    workspaceId: 'workspace-1',
    workspaceSessionId: 'session-stale',
    workspaceSessions: [
      createWorkspaceSession({ id: 'session-1', lastActiveAt: '2026-06-02T00:00:00.000Z' }),
      createWorkspaceSession({ id: 'session-2', lastActiveAt: '2026-06-02T01:00:00.000Z' }),
    ],
  })

  assert.equal(session?.id, 'session-2')
})
