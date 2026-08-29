import assert from 'node:assert/strict'
import test from 'node:test'
import { normalizeAgentConfig } from '@shared/agent-config'
import { createExecutionCenter } from '@shared/task-orchestrator'
import type { AppState, Project, WorkspaceSession, WorkspaceRecord } from '@shared/types'
import { scheduleWorkspaceDeletionCleanup } from './workspace-deletion-cleanup-service'

const now = '2026-06-08T00:00:00.000Z'

const createState = (): AppState => ({
  projects: [],
  tasks: [],
  nodes: [],
  projectBindings: [],
  distributedTasks: [],
  taskWorkspaceBindings: [],
  workspaceSessions: [],
  messages: [],
  mainChatSessions: [],
  selectedMainChatSessionId: '',
  selectedProjectId: '',
  selectedTaskId: '',
  filters: {
    status: 'all',
    agent: 'all',
  },
  adapters: [],
  executionCenter: createExecutionCenter([]),
  config: normalizeAgentConfig({
    workspaceRoot: '/tmp/vibemux',
  }),
} as AppState)

const createProject = (): Project => ({
  id: 'project-1',
  name: 'Demo',
  gitUrl: 'https://example.com/demo.git',
  defaultBranch: 'main',
  createdAt: now,
  updatedAt: now,
})

const createWorkspace = (): WorkspaceRecord => ({
  id: 'workspace-1',
  projectId: 'project-1',
  executorNodeId: 'executor-1',
  agentType: 'OpenCode',
  name: 'Workspace',
  status: 'ready',
  repoReady: true,
  source: 'manual',
  workingDirectoryMode: 'worktree',
  createdAt: now,
  updatedAt: now,
})

const createSession = (): WorkspaceSession => ({
  id: 'session-1',
  workspaceId: 'workspace-1',
  title: 'Workspace',
  titleOrigin: 'system',
  status: 'active',
  sessionKind: 'primary',
  sessionRole: 'general',
  sessionOrigin: 'manual',
  worktreeId: 'worktree-1',
  worktreeUniqueId: 7,
  branchName: 'vibemux/workspace-7',
  worktreeStatus: 'created',
  workingDirectoryMode: 'worktree',
  needsHumanConfirm: false,
  agentRunningStatus: 'idle',
  runtimeStatus: 'completed',
  runtimeSequence: 0,
  currentStep: '',
  lastActiveAt: now,
  createdAt: now,
  updatedAt: now,
})

test('scheduleWorkspaceDeletionCleanup schedules background cleanup without waiting for it', async () => {
  const steps: string[] = []
  let releaseRuntimeCleanup: (() => void) | undefined
  let markWorktreeStarted: (() => void) | undefined
  const worktreeStarted = new Promise<void>((resolve) => {
    markWorktreeStarted = resolve
  })
  const runtimeCleanupPromise = new Promise<{
    closedPreviewCount: number
    stoppedDesktopCount: number
    closedTerminalCount: number
    warnings: string[]
  }>((resolve) => {
    releaseRuntimeCleanup = () => resolve({
      closedPreviewCount: 0,
      stoppedDesktopCount: 0,
      closedTerminalCount: 0,
      warnings: [],
    })
  })

  scheduleWorkspaceDeletionCleanup({
    state: createState(),
    project: createProject(),
    workspace: createWorkspace(),
    workspaceSessions: [createSession()],
    userId: 'user-1',
  }, {
    schedule: (task) => {
      steps.push('scheduled')
      task()
    },
    cleanupRuntimeResources: async () => {
      steps.push('runtime-start')
      return runtimeCleanupPromise
    },
    cleanupWorktrees: async () => {
      steps.push('worktree-start')
      markWorktreeStarted?.()
      return { ok: true as const }
    },
  })

  assert.deepEqual(steps, ['scheduled', 'runtime-start'])
  releaseRuntimeCleanup?.()
  await worktreeStarted
  assert.deepEqual(steps, ['scheduled', 'runtime-start', 'worktree-start'])
})
