import assert from 'node:assert/strict'
import test from 'node:test'
import type { MainChatSession, WorkspaceSession } from '@shared/types'
import { buildAgentLiveStatuses, getAgentLiveStatus, isAgentWorkingStatus } from './agent-live-status'

const mainSession = (overrides: Partial<MainChatSession> = {}): MainChatSession => ({
  id: `main-${overrides.customAgentId ?? 'x'}`,
  title: '主对话',
  agentRunningStatus: 'thinking',
  createdAt: '2026-08-06T00:00:00.000Z',
  updatedAt: '2026-08-06T00:00:00.000Z',
  ...overrides,
})

const workspaceSession = (overrides: Partial<WorkspaceSession> = {}): WorkspaceSession => ({
  id: 'ws-1',
  workspaceId: 'w1',
  title: '工作区会话',
  titleOrigin: 'system',
  status: 'active',
  sessionKind: 'primary',
  sessionRole: 'general',
  sessionOrigin: 'manual',
  worktreeId: 'wt1',
  branchName: 'main',
  worktreeStatus: 'created',
  workingDirectoryMode: 'worktree',
  needsHumanConfirm: false,
  agentRunningStatus: 'executing',
  runtimeStatus: 'running',
  createdAt: '2026-08-06T00:00:00.000Z',
  updatedAt: '2026-08-06T00:00:00.000Z',
  ...overrides,
} as WorkspaceSession)

test('isAgentWorkingStatus covers thinking/executing/waiting only', () => {
  assert.equal(isAgentWorkingStatus('thinking'), true)
  assert.equal(isAgentWorkingStatus('executing'), true)
  assert.equal(isAgentWorkingStatus('waiting'), true)
  assert.equal(isAgentWorkingStatus('complete'), false)
  assert.equal(isAgentWorkingStatus('error'), false)
  assert.equal(isAgentWorkingStatus('idle'), false)
  assert.equal(isAgentWorkingStatus(undefined), false)
})

test('aggregates working main chat and workspace sessions per agent', () => {
  const statuses = buildAgentLiveStatuses(
    [
      mainSession({ customAgentId: 'agent-a' }),
      mainSession({ customAgentId: 'agent-a', agentRunningStatus: 'complete' }),
      mainSession({ customAgentId: 'agent-b', agentRunningStatus: 'waiting' }),
    ],
    [
      workspaceSession({ customAgentId: 'agent-a', agentRunningStatus: 'executing' }),
      workspaceSession({ customAgentId: 'agent-b', agentRunningStatus: 'idle', runtimeStatus: 'idle' }),
    ],
  )

  // agent-a：主对话 1（thinking）+ 工作区 1（executing）= 2
  assert.equal(getAgentLiveStatus(statuses, 'agent-a')?.workingCount, 2)
  // agent-b：主对话 1（waiting），工作区 idle 不计
  assert.equal(getAgentLiveStatus(statuses, 'agent-b')?.workingCount, 1)
})

test('workspace sessions keyed by name fall back when no customAgentId', () => {
  const statuses = buildAgentLiveStatuses([], [
    workspaceSession({ customAgentId: undefined, customAgentName: '老 Agent', agentRunningStatus: 'thinking' }),
  ])

  assert.equal(getAgentLiveStatus(statuses, 'agent-id-missing', '老 Agent')?.workingCount, 1)
})

test('workspace runtimeStatus-driven running counts even when agentRunningStatus is idle', () => {
  // Coding Agent 在工作区执行时以 runtimeStatus 为准（与工作区侧显示一致）。
  const statuses = buildAgentLiveStatuses([], [
    workspaceSession({ customAgentId: 'coder', agentRunningStatus: 'idle', runtimeStatus: 'running' }),
    workspaceSession({ customAgentId: 'coder', agentRunningStatus: 'idle', runtimeStatus: 'queued' }),
  ])

  assert.equal(getAgentLiveStatus(statuses, 'coder')?.workingCount, 1)
})

test('sessions without agent identity are ignored', () => {
  const statuses = buildAgentLiveStatuses(
    [mainSession({ customAgentId: undefined, agentRunningStatus: 'thinking' })],
    [workspaceSession({ customAgentId: undefined, customAgentName: undefined })],
  )
  assert.equal(statuses.size, 0)
})
