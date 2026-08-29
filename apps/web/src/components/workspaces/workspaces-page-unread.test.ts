import assert from 'node:assert/strict'
import test from 'node:test'
import type { Project, Task, TaskWorkspaceBinding, WorkspaceSession, Workspace } from '@shared/types'
import { buildWorkspaceItems } from './workspaces-page-utils'

const createProject = (overrides: Partial<Project> = {}): Project => ({
  id: 'project-1',
  name: 'Vibemux',
  color: '#34d399',
  defaultBranch: 'main',
  createdAt: '2026-05-12T00:00:00.000Z',
  updatedAt: '2026-05-12T00:00:00.000Z',
  ...overrides,
} as Project)

const createWorkspace = (overrides: Partial<Workspace> = {}): Workspace => ({
  id: 'workspace-1',
  projectId: 'project-1',
  name: '原目录',
  source: 'manual',
  workingDirectoryMode: 'original-dir',
  createdAt: '2026-05-12T00:00:00.000Z',
  updatedAt: '2026-05-12T00:00:00.000Z',
  ...overrides,
} as Workspace)

const createTask = (overrides: Partial<Task> = {}): Task => ({
  id: 'task-1',
  projectId: 'project-1',
  title: '修复未读状态',
  updatedAt: '2026-05-12T00:00:00.000Z',
  createdAt: '2026-05-12T00:00:00.000Z',
  ...overrides,
} as Task)

const createBinding = (overrides: Partial<TaskWorkspaceBinding> = {}): TaskWorkspaceBinding => ({
  id: 'binding-1',
  taskId: 'task-1',
  workspaceId: 'workspace-1',
  status: 'active',
  createdAt: '2026-05-12T00:00:00.000Z',
  updatedAt: '2026-05-12T00:00:00.000Z',
  ...overrides,
} as TaskWorkspaceBinding)

const createWorkspaceSession = (overrides: Partial<WorkspaceSession> = {}): WorkspaceSession => ({
  id: 'session-1',
  workspaceId: 'workspace-1',
  title: '会话 1',
  titleOrigin: 'system',
  status: 'active',
  sessionKind: 'primary',
  sessionRole: 'general',
  sessionOrigin: 'manual',
  workingDirectoryMode: 'original-dir',
  worktreeStatus: 'created',
  agentRunningStatus: 'complete',
  runtimeStatus: 'completed',
  runtimeSequence: 3,
  lastRuntimeEventAt: '2026-05-12T01:00:00.000Z',
  lastActiveAt: '2026-05-12T01:00:00.000Z',
  createdAt: '2026-05-12T00:00:00.000Z',
  updatedAt: '2026-05-12T01:00:00.000Z',
  mountedSkillNames: [],
  mountedMcpServerNames: [],
  enabledMcpServerIds: [],
  runtimeContinuations: [],
  agentType: 'OpenCode',
  executorNodeId: 'executor-1',
  executionModel: 'openai/gpt-5',
  gitIdentityMode: 'personal',
  baseBranch: 'main',
  ...overrides,
} as WorkspaceSession)

test('buildWorkspaceItems keeps selected unread workspace sessions in the workspace list count', () => {
  const session = createWorkspaceSession()
  const items = buildWorkspaceItems(
    [createProject()],
    { 'project-1': [createWorkspace()] },
    [createTask()],
    [createBinding()],
    [session],
    'zh',
    {
      selectedWorkspaceSessionId: session.id,
      sessionAttentionById: {
        [session.id]: 'complete:3:2026-05-12T01:00:00.000Z',
      },
    },
  )

  assert.equal(items[0]?.unreadCount, 1)
})
