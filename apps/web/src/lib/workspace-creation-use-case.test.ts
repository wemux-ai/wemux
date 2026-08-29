import assert from 'node:assert/strict'
import test from 'node:test'
import { DEFAULT_AGENT_SETTINGS } from '@shared/agent-config'
import {
  resolveDefaultWorkspaceCreationExecutorId,
  resolveWorkspaceCreationAgentSettings,
  resolveWorkspaceCreationCloneBlockReason,
  runWorkspaceCreationUseCase,
} from './workspace-creation-use-case'

const workspace = { id: 'workspace-1' } as never
const state = { workspaceSessions: [] } as never

test('workspace creation creates a missing session and queues uploaded attachments', async () => {
  const steps: string[] = []
  const result = await runWorkspaceCreationUseCase({
    createWorkspace: async () => ({ workspace, workspaces: [workspace], message: 'ok' }),
    createSession: async () => ({ state, taskId: 'task-1', workspaceSessionId: 'session-1' }),
    images: [{ id: 'image-1', filename: 'screen.png' }],
    initialPrompt: 'start',
    uploadImage: async (_taskId, image) => ({ id: image.id, filename: image.filename, url: '/screen.png' }),
    enqueueInitialMessage: async (input) => {
      steps.push(`${input.taskId}:${input.workspaceSessionId}:${input.attachments.length}`)
      return { snapshot: {} as never }
    },
    onSessionCreate: () => steps.push('session'),
  })

  assert.equal(result.taskId, 'task-1')
  assert.equal(result.workspaceSessionId, 'session-1')
  assert.deepEqual(steps, ['session', 'task-1:session-1:1'])
})

test('workspace creation exposes the persisted session before uploads and initial queueing finish', async () => {
  const steps: string[] = []
  const sessionState = { workspaceSessions: [{ id: 'session-1' }] } as never

  await runWorkspaceCreationUseCase({
    createWorkspace: async () => {
      steps.push('workspace')
      return {
        state: sessionState,
        taskId: 'task-1',
        workspace,
        workspaces: [workspace],
        workspaceSessionId: 'session-1',
        message: 'ok',
      }
    },
    createSession: async () => {
      throw new Error('existing session should be reused')
    },
    images: [{ id: 'image-1', filename: 'screen.png' }],
    initialPrompt: 'start',
    onWorkspaceCreated: () => {
      steps.push('listed')
    },
    onWorkspaceSessionReady: () => {
      steps.push('visible')
    },
    uploadImage: async (_taskId, image) => {
      steps.push('upload')
      return { id: image.id, filename: image.filename, url: '/screen.png' }
    },
    enqueueInitialMessage: async () => {
      steps.push('queued')
      return { snapshot: {} as never }
    },
  })

  assert.deepEqual(steps, ['workspace', 'listed', 'visible', 'upload', 'queued'])
})

test('workspace creation reuses a session returned by create workspace', async () => {
  let createSessionCalled = false
  const result = await runWorkspaceCreationUseCase({
    createWorkspace: async () => ({
      state,
      taskId: 'task-1',
      workspace,
      workspaces: [workspace],
      workspaceSessionId: 'session-1',
      message: 'ok',
    }),
    createSession: async () => {
      createSessionCalled = true
      return { state }
    },
  })

  assert.equal(createSessionCalled, false)
  assert.equal(result.workspaceSessionId, 'session-1')
})

test('taskless workspace creation uses the session runtime identity for its initial prompt', async () => {
  let enqueueCalled = false
  const result = await runWorkspaceCreationUseCase({
    createWorkspace: async () => ({ workspace, workspaces: [workspace], message: 'ok' }),
    createSession: async () => ({ state, workspaceSessionId: 'session-taskless' }),
    initialPrompt: 'start',
    enqueueInitialMessage: async (input) => {
      enqueueCalled = true
      assert.equal(input.taskId, 'session-taskless')
      assert.equal(input.workspaceSessionId, 'session-taskless')
      return { snapshot: {} as never }
    },
  })

  assert.equal(result.taskId, 'session-taskless')
  assert.equal(result.workspaceSessionId, 'session-taskless')
  assert.equal(enqueueCalled, true)
})

test('workspace creation executor selection prefers the project executor when usable', () => {
  const executors = [
    { executorId: 'local-online', status: 'online' },
    { executorId: 'preferred', status: 'paired' },
  ] as never
  const project = { preferredExecutorId: 'preferred' } as never

  assert.equal(resolveDefaultWorkspaceCreationExecutorId(project, executors), 'preferred')
})

test('workspace creation executor selection prefers the configured workspace default', () => {
  const executors = [
    { executorId: 'configured', status: 'online' },
    { executorId: 'preferred', status: 'online' },
  ] as never
  const project = { preferredExecutorId: 'preferred' } as never

  assert.equal(resolveDefaultWorkspaceCreationExecutorId(project, executors, {
    executorNodeId: 'configured',
    agentType: 'Codex',
    executionModel: 'gpt-5.6-terra',
  }), 'configured')
})

test('workspace creation executor selection prefers an online local node over the cloud node', () => {
  const executors = [
    { executorId: 'cloud', executorSource: 'managed-cloud', managedBy: 'vibemux', status: 'online' },
    { executorId: 'local-online', status: 'online' },
  ] as never

  assert.equal(resolveDefaultWorkspaceCreationExecutorId(null, executors), 'local-online')
})

test('workspace creation executor selection falls back to the cloud node without online local nodes', () => {
  const executors = [
    { executorId: 'local-offline', status: 'offline' },
    { executorId: 'cloud', executorSource: 'managed-cloud', managedBy: 'vibemux', status: 'online' },
  ] as never

  assert.equal(resolveDefaultWorkspaceCreationExecutorId(null, executors), 'cloud')
})

test('workspace creation clone blocking preserves failed clone detail', () => {
  const project = { repositoryCloneStatus: 'failed', repositoryCloneMessage: 'authentication failed' } as never
  const t = (key: string, options?: Record<string, unknown>) => `${key}:${options?.message ?? ''}`

  assert.equal(
    resolveWorkspaceCreationCloneBlockReason(project, t),
    'workspace.createPanel.cloneBlock.failedWithMessage:authentication failed',
  )
})

test('workspace creation sends the visible global runtime defaults when no scoped override exists', () => {
  assert.deepEqual(resolveWorkspaceCreationAgentSettings({
    agentType: 'Codex',
    globalAgentSettings: DEFAULT_AGENT_SETTINGS,
  }), DEFAULT_AGENT_SETTINGS.Codex)
})

test('workspace creation merges a scoped permission choice over the global runtime defaults', () => {
  assert.deepEqual(resolveWorkspaceCreationAgentSettings({
    agentType: 'Codex',
    globalAgentSettings: DEFAULT_AGENT_SETTINGS,
    scopedAgentSettings: {
      ...DEFAULT_AGENT_SETTINGS.Codex,
      sandbox: 'read-only',
    },
  }), {
    ...DEFAULT_AGENT_SETTINGS.Codex,
    sandbox: 'read-only',
  })
})
