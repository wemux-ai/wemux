import assert from 'node:assert/strict'
import test, { afterEach } from 'node:test'
import { Hono } from 'hono'
import type { MiddlewareHandler } from 'hono'
import type { Project, Task, WorkspaceRecord, WorkspaceSession } from '@shared/types'
import { addUserProject, createToken } from '../repositories/auth'
import { resetState, saveProject, saveTask, saveWorkspaceSession } from '../storage/app-state-store'
import { resetClusterData, saveWorkspace } from '../storage/distributed-task-store'
import { closePostgres } from '../storage/postgres/db'
import { getDrizzleDb } from '../storage/postgres/drizzle-db'
import { taskChatQueueItems } from '../storage/postgres/schema'
import { getTaskConversationWithMessages } from '../control-plane/conversation-service'
import { listWorkspaceSessionEvents } from '../storage/postgres/workspace-session-history-store'
import { registerTaskInteractionRoutes } from './task-interaction-routes'
import { resolveQueuedTaskChatDrainContext } from '../services/task-chat-dispatch/turn-execution'

afterEach(async () => {
  // 清理 chat-queue 测试插入的队列条目（多节点 P0 表化后队列在 Postgres，防同文件测试间污染）
  try {
    const { like } = await import('drizzle-orm')
    await getDrizzleDb().delete(taskChatQueueItems).where(like(taskChatQueueItems.sessionKey, 'task:%'))
  } catch { /* 无 DB 时忽略 */ }
})

const requireAuth: MiddlewareHandler = async (_c, next) => {
  await next()
}

const createApp = () => {
  const app = new Hono()
  registerTaskInteractionRoutes(app, requireAuth)
  return app
}

const now = '2026-06-26T00:00:00.000Z'

const createProject = (): Project => ({
  id: 'project-queue-defer',
  name: 'Queue defer',
  gitUrl: 'https://example.com/demo.git',
  versionControl: 'git-remote',
  defaultBranch: 'main',
  createdAt: now,
  updatedAt: now,
})

const createTask = (): Task => ({
  id: 'task-queue-defer',
  projectId: 'project-queue-defer',
  title: '创建 Next.js 项目',
  description: '',
  status: 'todo',
  priority: 'medium',
  retryCount: 0,
  agentType: 'OpenCode',
  executionMode: 'auto',
  agentManaged: 'none',
  needsHumanConfirm: false,
  agentRunningStatus: 'idle',
  currentStep: '',
  executionHistory: [],
  comments: [],
  toolCalls: [],
  logs: [],
  history: [],
  orchestration: [],
  validationChecks: [],
  createdAt: now,
  updatedAt: now,
})

const createWorkspace = (ownerUserId: string): WorkspaceRecord => ({
  id: 'workspace-queue-defer',
  projectId: 'project-queue-defer',
  executorNodeId: 'executor-queue-defer',
  agentType: 'OpenCode',
  name: 'Workspace',
  status: 'pending_repo',
  repoReady: false,
  source: 'manual',
  ownerUserId,
  workingDirectoryMode: 'worktree',
  createdAt: now,
  updatedAt: now,
})

const createSession = (): WorkspaceSession => ({
  id: 'session-queue-defer',
  workspaceId: 'workspace-queue-defer',
  title: 'Workspace',
  titleOrigin: 'system',
  status: 'active',
  sessionKind: 'primary',
  sessionRole: 'general',
  sessionOrigin: 'manual',
  worktreeId: 'worktree-queue-defer',
  worktreeUniqueId: 1,
  branchName: 'vibemux/workspace-1',
  worktreeStatus: 'planned',
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

const withSuppressedPostgresErrors = async <T>(action: () => Promise<T> | T) => {
  const originalConsoleError = console.error
  console.error = (...args: unknown[]) => {
    if (typeof args[0] === 'string' && args[0].startsWith('[postgres]')) {
      return
    }
    originalConsoleError(...args)
  }

  try {
    return await action()
  } finally {
    await new Promise((resolve) => setTimeout(resolve, 0))
    console.error = originalConsoleError
  }
}

test.after(async () => {
  await withSuppressedPostgresErrors(async () => {
    resetState()
    resetClusterData()
    await closePostgres()
  })
})

test('deferred task chat queue message is persisted into the workspace transcript while waiting for worktree readiness', async () => {
  await withSuppressedPostgresErrors(async () => {
    resetState()
    resetClusterData()

    const userId = `user-${crypto.randomUUID()}`
    const project = createProject()
    const task = createTask()
    const workspace = createWorkspace(userId)
    const session = createSession()

    saveProject(project)
    saveTask(task)
    saveWorkspace(workspace)
    saveWorkspaceSession(session)
    addUserProject(userId, project.id)

    const app = createApp()
    const response = await app.request(`/api/tasks/${task.id}/chat-queue`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${createToken(userId)}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        message: '创建一个 nextjs 项目',
        workspaceId: workspace.id,
        workspaceSessionId: session.id,
        deferUntilWorkspaceReady: true,
      }),
    })

    assert.equal(response.status, 200)
    const payload = await response.json() as {
      snapshot: {
        conversation: { messageCount: number }
        queue: { items: Array<{ id: string }> }
      }
      message: string
    }

    assert.equal(payload.snapshot.conversation.messageCount, 1)
    assert.deepEqual(payload.snapshot.queue.items, [])
    assert.ok(payload.message.length > 0)

    const conversation = getTaskConversationWithMessages(task, project, workspace.id, session.id)
    assert.equal(conversation.messages.length, 1)
    assert.equal(conversation.messages[0]?.role, 'user')
    assert.equal(conversation.messages[0]?.content, '创建一个 nextjs 项目')
    try {
      const history = await listWorkspaceSessionEvents({
        sessionId: session.id,
        visibility: 'transcript',
      })
      assert.equal(history.events.length, 1)
      assert.equal(history.events[0]?.kind, 'user_message')
      if (history.events[0]?.kind !== 'user_message') {
        throw new Error('expected queued workspace prompt to be persisted as a user message')
      }
      assert.equal(history.events[0].payload.text, '创建一个 nextjs 项目')
      assert.equal(history.events[0].turnId, conversation.messages[0]?.externalRef?.turnId)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (!message.includes('Postgres is required')) {
        throw error
      }
    }
  })
})

test('workspace session ids are accepted as task chat ids (session-as-chat-entry)', async () => {
  await withSuppressedPostgresErrors(async () => {
    resetState()
    resetClusterData()

    const userId = `user-${crypto.randomUUID()}`
    const project = createProject()
    const workspace = createWorkspace(userId)
    const session = createSession()

    saveProject(project)
    saveWorkspace(workspace)
    saveWorkspaceSession(session)
    addUserProject(userId, project.id)

    const app = createApp()
    const response = await app.request(`/api/tasks/${session.id}/chat-queue`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${createToken(userId)}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        message: '继续执行这个工作区',
        workspaceId: workspace.id,
        workspaceSessionId: session.id,
        deferUntilWorkspaceReady: true,
      }),
    })

    assert.equal(response.status, 200)
    // 队列 drain 内部细节由 task-chat-queue 专项测试覆盖（多节点 P0 表化后）
  })
})
