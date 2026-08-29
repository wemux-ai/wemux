import assert from 'node:assert/strict'
import test from 'node:test'
import type { WorkspaceSession } from '@shared/types'
import { collectWorkspaceSessionCompletionNotifications } from './workspace-session-completion-notifications'

const createSession = (overrides: Partial<WorkspaceSession> = {}): WorkspaceSession => ({
  id: 'session-1',
  workspaceId: 'workspace-1',
  title: 'Ship notification settings',
  titleOrigin: 'manual',
  status: 'active',
  sessionKind: 'primary',
  sessionRole: 'general',
  sessionOrigin: 'manual',
  worktreeId: 'worktree-1',
  branchName: 'feature/notify',
  worktreeStatus: 'created',
  workingDirectoryMode: 'worktree',
  needsHumanConfirm: false,
  agentRunningStatus: 'executing',
  runtimeStatus: 'running',
  runtimeSequence: 1,
  currentStep: '执行中',
  lastActiveAt: '2026-06-01T10:00:00.000Z',
  createdAt: '2026-06-01T10:00:00.000Z',
  updatedAt: '2026-06-01T10:00:00.000Z',
  ...overrides,
})

test('collectWorkspaceSessionCompletionNotifications reports busy to complete transitions', () => {
  const previousSession = createSession()
  const nextSession = createSession({
    agentRunningStatus: 'complete',
    runtimeStatus: 'completed',
    runtimeSequence: 2,
    lastRuntimeEventAt: '2026-06-01T10:05:00.000Z',
    updatedAt: '2026-06-01T10:05:00.000Z',
  })

  const result = collectWorkspaceSessionCompletionNotifications({
    previousSessionsById: {
      [previousSession.id]: previousSession,
    },
    workspaceSessions: [nextSession],
  })

  assert.deepEqual(result.notifications, [{
    sessionId: 'session-1',
    sessionTitle: 'Ship notification settings',
    tone: 'complete',
  }])
})

test('collectWorkspaceSessionCompletionNotifications ignores initial terminal sessions', () => {
  const nextSession = createSession({
    agentRunningStatus: 'complete',
    runtimeStatus: 'completed',
    runtimeSequence: 2,
    lastRuntimeEventAt: '2026-06-01T10:05:00.000Z',
    updatedAt: '2026-06-01T10:05:00.000Z',
  })

  const result = collectWorkspaceSessionCompletionNotifications({
    previousSessionsById: {},
    workspaceSessions: [nextSession],
  })

  assert.deepEqual(result.notifications, [])
})
