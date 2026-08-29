import assert from 'node:assert/strict'
import test from 'node:test'

import type { Task } from '@shared/types'

import type { TaskAgentActivityRecord } from '../../lib/api'
import { buildTaskTimelineEntries } from './task-timeline-model'

const baseTask = (): Task => ({
  id: 'task-1',
  projectId: 'project-1',
  title: 'Timeline task',
  description: 'Build the task Timeline',
  status: 'in_progress',
  priority: 'medium',
  retryCount: 0,
  createdAt: '2026-07-23T09:00:00.000Z',
  updatedAt: '2026-07-23T10:10:00.000Z',
  agentType: 'Codex',
  executionMode: 'auto',
  agentManaged: 'none',
  baseBranch: 'main',
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
})

const waitingActivity = (): TaskAgentActivityRecord => ({
  id: 'event-1',
  agentId: 'agent-1',
  agentName: 'Builder',
  eventType: 'task.comment.mentioned',
  triggerKind: 'mention',
  triggerActorType: 'user',
  triggerActorId: 'user-1',
  triggerActorName: 'Alice',
  includedCommentIds: ['comment-1'],
  coalescedCommentCount: 0,
  attempt: 1,
  retrySource: 'initial',
  status: 'waiting',
  result: null,
  createdAt: '2026-07-23T10:01:00.000Z',
  startedAt: '2026-07-23T10:02:00.000Z',
  completedAt: null,
  updatedAt: '2026-07-23T10:03:00.000Z',
})

test('buildTaskTimelineEntries orders assignment, comment mention, Agent lifecycle, and workspace changes', () => {
  const task = baseTask()
  task.history.push({
    id: 'assignment-1',
    label: '指派给 Builder',
    at: '2026-07-23T10:00:00.000Z',
    kind: 'assignment',
    actor: { type: 'user', id: 'user-1', name: 'Alice' },
    assignee: { type: 'agent', id: 'agent-1', name: 'Builder' },
  })
  task.comments.push({
    id: 'comment-1',
    authorType: 'user',
    authorId: 'user-1',
    authorName: 'Alice',
    content: '@Builder please inspect this',
    mentions: [{ targetType: 'agent', targetId: 'agent-1', targetName: 'Builder' }],
    createdAt: '2026-07-23T10:01:00.000Z',
  })
  task.executionHistory.push({
    id: 'run-1',
    workspaceId: 'workspace-1',
    workspaceSessionId: 'session-1',
    status: 'completed',
    baseBranch: 'main',
    createdAt: '2026-07-23T10:04:00.000Z',
    updatedAt: '2026-07-23T10:05:00.000Z',
    result: {
      taskId: task.id,
      status: 'completed',
      returnMode: 'commit',
      summary: 'done',
      filesChanged: ['apps/web/src/task.tsx'],
      startedAt: '2026-07-23T10:04:00.000Z',
      completedAt: '2026-07-23T10:05:00.000Z',
      durationSec: 60,
      executorNodeId: 'executor-1',
    },
  })

  const entries = buildTaskTimelineEntries({
    task,
    activities: [waitingActivity()],
    workspaces: [{ id: 'workspace-1', name: 'Web', projectId: task.projectId } as never],
    workspaceSessions: [],
  })

  assert.equal(entries[0]?.kind, 'workspace_changed')
  assert.ok(entries.some((entry) => entry.kind === 'assignment' && entry.title.includes('Builder')))
  assert.ok(entries.some((entry) => entry.kind === 'mention' && entry.mentions?.includes('Builder')))
  assert.ok(entries.some((entry) => entry.kind === 'agent_running'))
  assert.ok(entries.some((entry) => entry.kind === 'agent_waiting' && entry.at === '2026-07-23T10:03:00.000Z'))
  assert.equal(entries.find((entry) => entry.kind === 'workspace_queued')?.title, '工作区「Web」已加入执行队列')
  assert.match(entries.find((entry) => entry.kind === 'workspace_queued')?.detail ?? '', /任务「Timeline task」 · 起始分支 main/)
  assert.match(entries.find((entry) => entry.kind === 'workspace_changed')?.detail ?? '', /任务「Timeline task」 · apps\/web\/src\/task\.tsx/)
})

test('buildTaskTimelineEntries excludes delivery comments and does not emit acceptance events', () => {
  const task = baseTask()
  task.comments.push(
    {
      id: 'comment-normal',
      authorType: 'user',
      authorId: 'user-1',
      authorName: 'Alice',
      content: 'Keep going',
      createdAt: '2026-07-23T10:00:00.000Z',
    },
    {
      id: 'comment-delivery',
      authorType: 'agent',
      authorId: 'agent-1',
      authorName: 'Builder',
      idempotencyKey: 'task-delivery:event-1',
      content: 'Delivery report',
      createdAt: '2026-07-23T10:01:00.000Z',
    },
  )

  const entries = buildTaskTimelineEntries({ task, activities: [], workspaces: [], workspaceSessions: [] })

  assert.equal(entries.length, 2)
  assert.equal(entries[0]?.detail, 'Keep going')
  assert.equal(entries.some((entry) => entry.title.includes('验收') || entry.detail?.includes('Delivery report')), false)
})

test('buildTaskTimelineEntries attributes task creation to its persisted creator identity', () => {
  const task = baseTask()
  task.createdBy = {
    type: 'agent',
    id: 'agent-ceo',
    name: 'CEO',
    avatarUrl: '/avatars/ceo.png',
  }

  const entries = buildTaskTimelineEntries({ task, activities: [], workspaces: [], workspaceSessions: [] })
  const created = entries.find((entry) => entry.kind === 'created')

  assert.deepEqual(created, {
    id: 'created:task-1',
    category: 'collaboration',
    kind: 'created',
    at: '2026-07-23T09:00:00.000Z',
    title: 'CEO 创建了任务',
    actor: {
      type: 'agent',
      id: 'agent-ceo',
      name: 'CEO',
      avatarUrl: '/avatars/ceo.png',
    },
  })
})

test('buildTaskTimelineEntries projects legacy task.assigned activity when assignment history is absent', () => {
  const task = baseTask()
  const entries = buildTaskTimelineEntries({
    task,
    activities: [{
      ...waitingActivity(),
      eventType: 'task.assigned',
      triggerKind: 'assignment',
      createdAt: '2026-07-23T10:00:00.000Z',
      startedAt: null,
      updatedAt: '2026-07-23T10:00:00.000Z',
    }],
    workspaces: [],
    workspaceSessions: [],
  })

  assert.equal(entries.filter((entry) => entry.kind === 'assignment').length, 1)
  assert.equal(entries.find((entry) => entry.kind === 'assignment')?.title, 'Alice 指派给 Builder')
})

test('buildTaskTimelineEntries names workspace Attention instead of a generic queue event', () => {
  const task = baseTask()
  const entries = buildTaskTimelineEntries({
    task,
    activities: [{
      ...waitingActivity(),
      eventType: 'workspace.session.completed',
      triggerKind: 'workspace_completed',
      status: 'pending',
      startedAt: null,
      updatedAt: '2026-07-23T10:03:00.000Z',
    }],
    workspaces: [],
    workspaceSessions: [],
  })

  assert.equal(entries.find((entry) => entry.kind === 'agent_queued')?.title, 'Builder 已收到工作区完成通知')
})

test('Agent lifecycle entries keep one activity identity and expose the run summary', () => {
  const task = baseTask()
  const activity: TaskAgentActivityRecord = {
    ...waitingActivity(),
    status: 'completed',
    completedAt: '2026-07-23T10:04:00.000Z',
    summaryPreview: 'Updated README and verified the focused tests.',
    transcriptAvailable: true,
  }
  const entries = buildTaskTimelineEntries({
    task,
    activities: [activity],
    workspaces: [],
    workspaceSessions: [],
  })
  const lifecycleEntries = entries.filter((entry) => entry.activityId === activity.id)

  assert.ok(lifecycleEntries.length >= 3)
  assert.ok(lifecycleEntries.every((entry) => entry.activityId === 'event-1'))
  assert.ok(lifecycleEntries.every((entry) => entry.activityLabel === '评论 @Agent · 第 1 次'))
  assert.equal(
    lifecycleEntries.find((entry) => entry.kind === 'agent_finished')?.detail,
    'Updated README and verified the focused tests.',
  )
})
