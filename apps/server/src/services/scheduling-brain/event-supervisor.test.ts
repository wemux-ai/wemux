import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildWorkspaceBrainReviewOneLiner,
  buildWorkspaceEventHistorySnapshot,
  decideBrainReviewPublish,
  isWorkspaceEventOrphan,
  type WorkspaceBrainReviewContext,
} from './event-supervisor'

const orphanTaskContext = (overrides: Partial<WorkspaceBrainReviewContext['task']> = {}): WorkspaceBrainReviewContext => ({
  kind: 'task.status.changed',
  workspaceId: 'ws-1',
  actor: { type: 'user', id: 'u1' },
  eventKey: 'k1',
  task: {
    id: 'task-1',
    title: '修复登录页',
    status: 'in_progress',
    assigneeAgentId: undefined,
    assigneeAgentGroupId: undefined,
    ...overrides,
  },
})

test('无主判定：任务无负责人 → orphan', () => {
  assert.equal(isWorkspaceEventOrphan(orphanTaskContext()), true)
})

test('无主判定：任务有 assigneeAgentId → 有主，不碰', () => {
  const context = orphanTaskContext({ assigneeAgentId: 'agent-executor' })
  assert.equal(isWorkspaceEventOrphan(context), false)
})

test('无主判定：任务有 assigneeId（人类负责人）→ 有主，不碰', () => {
  const context = orphanTaskContext({ assigneeId: 'user-bob' })
  assert.equal(isWorkspaceEventOrphan(context), false)
})

test('无主判定：任务挂在 Squad 下 → 有主（Squad 负责人处理），不碰', () => {
  const context = orphanTaskContext({ assigneeAgentGroupId: 'group-1' })
  assert.equal(isWorkspaceEventOrphan(context), false)
})

test('无主判定：会话无 customAgentId → orphan', () => {
  const context: WorkspaceBrainReviewContext = {
    kind: 'workspace.session.created',
    workspaceId: 'ws-1',
    actor: { type: 'user', id: 'u1' },
    eventKey: 'k2',
    session: { id: 'session-1', customAgentId: undefined },
  }
  assert.equal(isWorkspaceEventOrphan(context), true)
})

test('无主判定：会话有 Agent 认领 → 有主，不碰', () => {
  const context: WorkspaceBrainReviewContext = {
    kind: 'workspace.session.created',
    workspaceId: 'ws-1',
    actor: { type: 'user', id: 'u1' },
    eventKey: 'k2',
    session: { id: 'session-1', customAgentId: 'agent-x' },
  }
  assert.equal(isWorkspaceEventOrphan(context), false)
})

test('发布决策：任一条件不满足即 skip', () => {
  assert.equal(decideBrainReviewPublish({ workspaceId: 'ws-1', orphan: true, brainEnabled: true, brainAgentId: 'brain-1' }), 'published')
  assert.equal(decideBrainReviewPublish({ workspaceId: '', orphan: true, brainEnabled: true, brainAgentId: 'brain-1' }), 'skipped')
  assert.equal(decideBrainReviewPublish({ workspaceId: 'ws-1', orphan: false, brainEnabled: true, brainAgentId: 'brain-1' }), 'skipped')
  assert.equal(decideBrainReviewPublish({ workspaceId: 'ws-1', orphan: true, brainEnabled: false, brainAgentId: 'brain-1' }), 'skipped')
  assert.equal(decideBrainReviewPublish({ workspaceId: 'ws-1', orphan: true, brainEnabled: true, brainAgentId: null }), 'skipped')
})

test('事件摘要一行话', () => {
  assert.equal(
    buildWorkspaceBrainReviewOneLiner(orphanTaskContext({ status: 'in_review' })),
    '任务「修复登录页」状态变更为 in_review（无负责人）',
  )
  const commentContext = orphanTaskContext()
  commentContext.kind = 'task.comment.created'
  commentContext.comment = { id: 'c1', content: '这个 bug 很紧急', authorType: 'user' }
  assert.equal(
    buildWorkspaceBrainReviewOneLiner(commentContext),
    '任务「修复登录页」收到新评论（无负责人）：这个 bug 很紧急',
  )
  const sessionContext: WorkspaceBrainReviewContext = {
    kind: 'workspace.session.created',
    workspaceId: 'ws-1',
    actor: { type: 'user', id: 'u1' },
    eventKey: 'k3',
    session: { id: 'session-1', title: '会话 1', customAgentId: undefined },
  }
  assert.equal(
    buildWorkspaceBrainReviewOneLiner(sessionContext),
    '新建工作区会话「会话 1」（无 Agent 认领）',
  )
})

test('事件历史快照：活动 + 执行事件 + 工作区维度压缩', () => {
  const snapshot = buildWorkspaceEventHistorySnapshot({
    recentWorkspaceEvents: [
      { eventType: 'executor.task_completed', message: '任务完成', occurredAt: '2026-08-13T09:00:00Z' },
    ],
    recentActivities: [
      { agentName: '执行者', eventType: 'task.started', status: 'running', summaryPreview: '开始修复登录页' },
      { agentName: '审查官', eventType: 'task.comment.mentioned', status: 'completed', summaryPreview: '指出风险' },
    ],
    recentExecutionEvents: [
      { eventType: 'executor.task_started', message: 'worker 已接单', occurredAt: '2026-08-13T10:00:00Z' },
    ],
  })
  assert.ok(snapshot.includes('工作区近期事件'))
  assert.ok(snapshot.includes('executor.task_completed'))
  assert.ok(snapshot.includes('近期 Agent 活动'))
  assert.ok(snapshot.includes('执行者 | task.started | running | 开始修复登录页'))
  assert.ok(snapshot.includes('近期执行事件'))
  assert.ok(snapshot.includes('executor.task_started'))
})

test('事件历史快照：空 → 占位文本', () => {
  const snapshot = buildWorkspaceEventHistorySnapshot({})
  assert.ok(snapshot.includes('暂无近期事件'))
})
