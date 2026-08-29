import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildAgentEventPrompt,
  buildAutomaticAgentEventRetryPayload,
  buildCoalescedAgentEventPayload,
  buildRetriedAgentEventPayload,
  canAgentReceiveEvent,
  canCancelAgentEvent,
  canRetryAgentEvent,
  collectAgentEventCommentIds,
  findPendingAgentCommentTask,
  hasTaskDeliveryReport,
  matchesAgentWaitCondition,
  isActiveAgentEventTask,
  isPoisonedAgentEventFailure,
  isRetryableAgentInfrastructureResponse,
  resolveAgentEventRetrySessionMode,
  resolveAgentEventReplyParentCommentId,
  selectAgentEventTranscriptMessages,
} from './agent-event-runtime'

test('agent wait conditions match event type and scope without encoding a workflow', () => {
  const condition = {
    eventTypes: ['workspace.session.completed', 'workspace.session.failed'],
    match: { taskId: 'task-1', workspaceId: 'workspace-1' },
  }

  assert.equal(matchesAgentWaitCondition(condition, {
    type: 'workspace.session.completed',
    actor: { type: 'system' },
    scope: { taskId: 'task-1', workspaceId: 'workspace-1', workspaceSessionId: 'session-1' },
  }), true)
  assert.equal(matchesAgentWaitCondition(condition, {
    type: 'task.comment.created',
    actor: { type: 'user', id: 'user-1' },
    scope: { taskId: 'task-1', workspaceId: 'workspace-1' },
  }), false)
  assert.equal(matchesAgentWaitCondition(condition, {
    type: 'workspace.session.completed',
    actor: { type: 'system' },
    scope: { taskId: 'task-2', workspaceId: 'workspace-1' },
  }), false)
})

test('targeted workspace events cannot resume another waiting Agent', () => {
  const event = {
    type: 'workspace.session.completed',
    targetAgentId: 'agent-owner',
    actor: { type: 'system' as const },
    scope: { distributedTaskId: 'distributed-1' },
  }

  assert.equal(canAgentReceiveEvent('agent-owner', event), true)
  assert.equal(canAgentReceiveEvent('agent-other', event), false)
  assert.equal(canAgentReceiveEvent('agent-other', { ...event, targetAgentId: undefined }), true)
})

test('task-scoped Agent events require an explicit delivery report', () => {
  const prompt = buildAgentEventPrompt({
    id: 'event-1',
    agentId: 'agent-1',
    type: 'task.assigned',
    payload: {},
    status: 'pending',
    result: null,
    startedAt: null,
    completedAt: null,
    createdAt: '2026-07-12T00:00:00.000Z',
  }, {
    kind: 'agent_event',
    actor: { type: 'user', id: 'user-1' },
    scope: { projectId: 'project-1', taskId: 'task-1' },
    payload: {},
    conversationKey: 'task:task-1',
    attempt: 1,
    retrySource: 'initial',
    autoRetryCount: 0,
  })

  assert.match(prompt, /task\.update_status/)
  assert.match(prompt, /task\.delivery\.report/)
  assert.match(prompt, /工作区原则/)
  assert.match(prompt, /createdBy\.id=agent-1/)
  assert.match(prompt, /workspace\.create.*vibemux__workspace_create/)
  assert.match(prompt, /task\.execute.*vibemux__task_execute/)
  assert.match(prompt, /只复用 createdBy\.type=agent/)
  assert.match(prompt, /~\/\.wemux/)
  assert.match(prompt, /\[Context Capsule\]/)
})

test('scheduled heartbeat ticks guide agents to check inbox and stay token-frugal', () => {
  const prompt = buildAgentEventPrompt({
    id: 'event-heartbeat',
    agentId: 'agent-1',
    type: 'agent.heartbeat.tick',
    payload: {
      kind: 'agent_event',
      scope: { scheduleId: 'cron-1' },
      payload: { name: '定时心跳', cronExpression: '0 0 * * *' },
    },
    status: 'pending',
    result: null,
    startedAt: null,
    completedAt: null,
    createdAt: '2026-08-13T00:00:00.000Z',
  }, {
    kind: 'agent_event',
    actor: { type: 'system' },
    scope: { scheduleId: 'cron-1' },
    payload: { name: '定时心跳', cronExpression: '0 0 * * *' },
    conversationKey: 'agent-heartbeat:agent-1',
    attempt: 1,
    retrySource: 'initial',
    autoRetryCount: 0,
  })

  assert.match(prompt, /agent\.heartbeat\.tick/)
  assert.match(prompt, /agent\.inbox\.list/)
  assert.match(prompt, /不要为心跳创建影子任务/)
  // 心跳无 taskId scope，不应强制交付
  assert.doesNotMatch(prompt, /task\.delivery\.report/)
})

test('workspace Attention requires authoritative execution and transcript reads', () => {
  const prompt = buildAgentEventPrompt({
    id: 'event-completed',
    agentId: 'agent-1',
    type: 'workspace.session.completed',
    payload: {},
    status: 'pending',
    result: null,
    startedAt: null,
    completedAt: null,
    createdAt: '2026-07-23T00:00:00.000Z',
  }, {
    kind: 'agent_event',
    actor: { type: 'system' },
    scope: {
      taskId: 'task-1',
      workspaceId: 'workspace-1',
      workspaceSessionId: 'session-1',
      distributedTaskId: 'distributed-1',
    },
    payload: {},
    conversationKey: 'task:task-1',
    resumesEventId: 'event-assigned',
    attempt: 1,
    retrySource: 'initial',
    autoRetryCount: 0,
  })

  assert.match(prompt, /工作区执行 Attention/)
  assert.match(prompt, /task\.execution\.get/)
  assert.match(prompt, /workspace\.session\.runtime/)
  assert.match(prompt, /实际 Transcript/)
  assert.match(prompt, /一次 Attention 只产生一次最终回复或交付动作/)
})

test('assignment handoff is framed as run-scoped instruction', () => {
  const prompt = buildAgentEventPrompt({
    id: 'event-handoff',
    agentId: 'agent-1',
    type: 'task.assigned',
    payload: {},
    status: 'pending',
    result: null,
    startedAt: null,
    completedAt: null,
    createdAt: '2026-07-21T00:00:00.000Z',
  }, {
    kind: 'agent_event',
    actor: { type: 'user', id: 'user-1' },
    scope: { taskId: 'task-1' },
    payload: { handoffPrompt: '只处理登录回归，不要扩大范围。' },
    conversationKey: 'task:task-1',
    attempt: 1,
    retrySource: 'initial',
    autoRetryCount: 0,
  })

  assert.match(prompt, /\[Assignment Handoff\]/)
  assert.match(prompt, /只处理登录回归/)
  assert.match(prompt, /不要把它当作需要回复的任务评论/)
})

test('Squad assignment tells only the explicit leader to coordinate delivery', () => {
  const prompt = buildAgentEventPrompt({
    id: 'event-squad',
    agentId: 'agent-leader',
    type: 'task.assigned',
    payload: {},
    status: 'pending',
    result: null,
    startedAt: null,
    completedAt: null,
    createdAt: '2026-07-22T00:00:00.000Z',
  }, {
    kind: 'agent_event',
    actor: { type: 'user', id: 'user-1' },
    scope: { taskId: 'task-1' },
    payload: { assigneeAgentGroupId: 'squad-1', assigneeAgentGroupTitle: 'Release Squad' },
    conversationKey: 'task:task-1',
    attempt: 1,
    retrySource: 'initial',
    autoRetryCount: 0,
  })

  assert.match(prompt, /Release Squad/)
  assert.match(prompt, /明确负责人/)
  assert.match(prompt, /不要根据成员顺序推断/)
})

test('queued task payload keeps later comments and their idempotency keys', () => {
  const task = {
    id: 'event-pending',
    agentId: 'agent-1',
    type: 'task.assigned',
    payload: {
      kind: 'agent_event',
      actor: { type: 'user', id: 'user-1' },
      scope: { taskId: 'task-1' },
      payload: { taskTitle: 'Task' },
      conversationKey: 'task:task-1',
      idempotencyKey: 'assignment-1',
    },
    status: 'pending',
    result: null,
    startedAt: null,
    completedAt: null,
    createdAt: '2026-07-21T00:00:00.000Z',
  } as const

  const payload = buildCoalescedAgentEventPayload(task, {
    type: 'task.comment.created',
    actor: { type: 'user', id: 'user-1' },
    scope: { taskId: 'task-1', commentId: 'comment-2' },
    payload: { comment: '再补充：先跑登录回归。', triggerKind: 'assignee' },
  }, 'comment-event-2')

  assert.deepEqual(payload.mergedIdempotencyKeys, ['comment-event-2'])
  assert.deepEqual((payload.payload as Record<string, unknown>).followUpComments, [{
    actor: { type: 'user', id: 'user-1' },
    commentId: 'comment-2',
    parentCommentId: undefined,
    comment: '再补充：先跑登录回归。',
    triggerKind: 'assignee',
  }])
})

test('run audit collects the original and coalesced comment ids once', () => {
  assert.deepEqual(collectAgentEventCommentIds({
    scope: { taskId: 'task-1', commentId: 'comment-1' },
    payload: {
      followUpComments: [
        { commentId: 'comment-2' },
        { commentId: 'comment-1' },
        { comment: 'legacy comment without an id' },
      ],
    },
  }), ['comment-1', 'comment-2'])
})

test('Agent comment replies stay in the triggering task comment thread', () => {
  assert.equal(resolveAgentEventReplyParentCommentId({
    scope: { taskId: 'task-1', commentId: 'comment-root' },
    payload: {},
  }), 'comment-root')
  assert.equal(resolveAgentEventReplyParentCommentId({
    scope: { taskId: 'task-1', commentId: 'comment-reply' },
    payload: { parentCommentId: 'comment-root' },
  }), 'comment-root')
})

test('running comments reserve one follow-up run and later comments merge into that pending run', () => {
  const base = {
    agentId: 'agent-1',
    type: 'task.comment.created',
    payload: {
      kind: 'agent_event',
      actor: { type: 'user', id: 'user-1' },
      scope: { taskId: 'task-1' },
      payload: { comment: 'follow up' },
      conversationKey: 'task:task-1',
    },
    result: null,
    completedAt: null,
    createdAt: '2026-07-21T00:00:00.000Z',
  } as const
  const running = { ...base, id: 'event-running', status: 'running' as const, startedAt: base.createdAt }
  const pending = { ...base, id: 'event-follow-up', status: 'pending' as const, startedAt: null }

  assert.equal(findPendingAgentCommentTask([running], 'task-1', 'task:task-1'), undefined)
  assert.equal(findPendingAgentCommentTask([running, pending], 'task-1', 'task:task-1')?.id, 'event-follow-up')
})

test('task transcript is limited to one Agent event inside a reused conversation', () => {
  const messages = [
    { id: 'prompt-1', role: 'user' as const, content: '[Agent Runtime Event]\neventId: event-1', createdAt: '2026-07-21T00:00:00.000Z' },
    { id: 'answer-1', role: 'assistant' as const, content: 'first answer', createdAt: '2026-07-21T00:01:00.000Z' },
    { id: 'delivery-1', role: 'user' as const, content: '[Task Delivery Required]\neventId: event-1', createdAt: '2026-07-21T00:02:00.000Z' },
    { id: 'answer-2', role: 'assistant' as const, content: 'delivery answer', createdAt: '2026-07-21T00:03:00.000Z' },
    { id: 'prompt-2', role: 'user' as const, content: '[Agent Runtime Event]\neventId: event-2', createdAt: '2026-07-21T00:04:00.000Z' },
    { id: 'answer-3', role: 'assistant' as const, content: 'second run', createdAt: '2026-07-21T00:05:00.000Z' },
  ]

  assert.deepEqual(
    selectAgentEventTranscriptMessages(messages, 'event-1').map((message) => message.id),
    ['prompt-1', 'answer-1', 'delivery-1', 'answer-2'],
  )
})

test('retry removes prior dedupe state and cancel is limited to interruptible states', () => {
  const failedTask = {
    id: 'event-failed',
    agentId: 'agent-1',
    type: 'task.comment.created',
    payload: {
      kind: 'agent_event',
      actingUserId: 'user-old',
      actor: { type: 'user', id: 'user-old' },
      scope: { taskId: 'task-1' },
      payload: { comment: 'please retry' },
      conversationKey: 'task:task-1',
      idempotencyKey: 'old-key',
      mergedIdempotencyKeys: ['merged-key'],
    },
    status: 'failed',
    result: { error: 'offline' },
    startedAt: null,
    completedAt: '2026-07-21T00:02:00.000Z',
    createdAt: '2026-07-21T00:00:00.000Z',
  } as const

  assert.equal(canRetryAgentEvent(failedTask), true)
  assert.equal(canCancelAgentEvent(failedTask), false)
  assert.equal(canCancelAgentEvent({ ...failedTask, status: 'running' }), true)
  assert.equal(canCancelAgentEvent({ ...failedTask, status: 'waiting' }), true)
  assert.deepEqual(buildRetriedAgentEventPayload(failedTask, 'user-new'), {
    kind: 'agent_event',
    actingUserId: 'user-new',
    actor: { type: 'user', id: 'user-old' },
    scope: { taskId: 'task-1' },
    payload: { comment: 'please retry' },
    conversationKey: 'task:task-1',
    retryOfEventId: 'event-failed',
    attempt: 2,
    retrySource: 'manual',
    retrySessionMode: 'resume',
    autoRetryCount: 0,
  })
})

test('poisoned Agent failures force a clean retry session', () => {
  assert.equal(isPoisonedAgentEventFailure('context length exceeded after 200000 tokens'), true)
  assert.equal(isPoisonedAgentEventFailure('context_length_exceeded'), true)
  assert.equal(isPoisonedAgentEventFailure('invalid_request_error: image is too large'), true)
  assert.equal(isPoisonedAgentEventFailure('Codex semantic inactivity timeout after 10m'), true)
  assert.equal(isPoisonedAgentEventFailure('执行器已断开连接。'), false)

  const poisonedTask = {
    id: 'event-poisoned',
    agentId: 'agent-1',
    type: 'task.comment.created',
    payload: {
      kind: 'agent_event',
      actor: { type: 'user', id: 'user-1' },
      scope: { taskId: 'task-1' },
      payload: { comment: 'continue' },
      conversationKey: 'task:task-1',
    },
    status: 'failed',
    result: { error: '上下文窗口溢出，请开启新会话。' },
    startedAt: null,
    completedAt: '2026-07-22T00:01:00.000Z',
    createdAt: '2026-07-22T00:00:00.000Z',
  } as const

  assert.equal(resolveAgentEventRetrySessionMode(poisonedTask, 'resume'), 'fresh')
  assert.equal(buildRetriedAgentEventPayload(poisonedTask, 'user-1', { sessionMode: 'resume' }).retrySessionMode, 'fresh')
})

test('infrastructure retry is delayed, bounded, and keeps each attempt as a separate event', () => {
  const failedTask = {
    id: 'event-attempt-2',
    agentId: 'agent-1',
    type: 'task.comment.created',
    payload: {
      kind: 'agent_event',
      actor: { type: 'user', id: 'user-1' },
      scope: { taskId: 'task-1' },
      payload: { comment: 'continue' },
      conversationKey: 'task:task-1',
      attempt: 2,
      retrySource: 'infrastructure',
      autoRetryCount: 1,
    },
    status: 'failed',
    result: { error: '执行器已断开连接。' },
    startedAt: '2026-07-22T00:00:00.000Z',
    completedAt: '2026-07-22T00:01:00.000Z',
    createdAt: '2026-07-22T00:00:00.000Z',
  } as const

  assert.deepEqual(buildAutomaticAgentEventRetryPayload(failedTask, Date.parse('2026-07-22T00:01:00.000Z')), {
    kind: 'agent_event',
    actor: { type: 'user', id: 'user-1' },
    scope: { taskId: 'task-1' },
    payload: { comment: 'continue' },
    conversationKey: 'task:task-1',
    retryOfEventId: 'event-attempt-2',
    attempt: 3,
    retrySource: 'infrastructure',
    retrySessionMode: 'resume',
    autoRetryCount: 2,
    availableAt: '2026-07-22T00:01:15.000Z',
  })
  assert.equal(buildAutomaticAgentEventRetryPayload({
    ...failedTask,
    payload: { ...failedTask.payload, autoRetryCount: 2 },
  }), null)
  assert.equal(isRetryableAgentInfrastructureResponse({ aborted: true, message: '执行器已断开连接。' }), true)
  assert.equal(isRetryableAgentInfrastructureResponse({ message: 'Agent 未通过 task.delivery.report 写入任务状态和交付评论。' }), false)
})

test('only interruptible or executing Agent events count as active task work', () => {
  const event = {
    id: 'event-active',
    agentId: 'agent-1',
    type: 'task.comment.created',
    payload: {},
    status: 'pending',
    result: null,
    startedAt: null,
    completedAt: null,
    createdAt: '2026-07-21T00:00:00.000Z',
  } as const
  assert.equal(isActiveAgentEventTask(event), true)
  assert.equal(isActiveAgentEventTask({ ...event, status: 'waiting' }), true)
  assert.equal(isActiveAgentEventTask({ ...event, status: 'completed' }), false)
  assert.equal(isActiveAgentEventTask({ ...event, status: 'canceled' }), false)
})

test('delivery guard recognizes the atomic task delivery tool', () => {
  assert.equal(hasTaskDeliveryReport([{ name: 'task.delivery.report' }]), true)
  assert.equal(hasTaskDeliveryReport([{ name: 'mcp.vibemux.task.delivery.report' }]), true)
  assert.equal(hasTaskDeliveryReport([{ name: 'vibemux__task_delivery_report' }]), true)
  assert.equal(hasTaskDeliveryReport([{ name: 'VIBEMUX_TASK_DELIVERY_REPORT' }]), true)
  assert.equal(hasTaskDeliveryReport([{ name: 'task.comment.add' }]), false)
})
