import assert from 'node:assert/strict'
import test from 'node:test'
import {
  aggregateTimelineForDisplay,
  isAutoRenameableWorkspaceSessionTitleOrigin,
  isTaskChatSocketNotReadyError,
  isRenderableWorkspaceAssistantMessage,
  prependNotice,
  removeTaskChatTurnEvents,
  resolveWorkspaceSessionScopedRuntimeConfig,
  replaceOptimisticTaskChatTurnStatus,
  resolveTaskChatQueueStatusMessage,
  shouldAttemptAutoRenameWorkspaceSession,
  shouldShowTaskChatNotice,
  upsertOptimisticTaskChatTurn,
  type NoticeItem,
} from './workspace-session-chat-helpers'
import type { ChatTimelineEvent } from '../../../lib/workspace-session-chat-ui'
import type { Task, WorkspaceSession } from '@shared/types'

const buildNotice = (message: string, level: NoticeItem['level'] = 'info'): NoticeItem => ({
  id: message,
  level,
  message,
})

test('shouldShowTaskChatNotice hides only redundant queue enqueue info notices', () => {
  assert.equal(shouldShowTaskChatNotice(buildNotice('消息已入队。')), false)
  assert.equal(shouldShowTaskChatNotice(buildNotice('实时连接暂不可用，已通过备用通道加入消息队列。')), false)
  assert.equal(shouldShowTaskChatNotice(buildNotice('委派消息已进入独立工作区会话队列。')), false)
  assert.equal(shouldShowTaskChatNotice(buildNotice('官方云节点正在启动，消息已进入队列，准备完成后会自动发送。')), false)
  assert.equal(shouldShowTaskChatNotice(buildNotice('执行器当前离线，消息已保留在队列中，等待恢复后自动发送。')), true)
  assert.equal(shouldShowTaskChatNotice(buildNotice('消息入队失败', 'error')), true)
})

test('prependNotice ignores hidden queue notices but preserves visible notices', () => {
  const existing = [buildNotice('已有提示')]

  assert.deepEqual(
    prependNotice(existing, buildNotice('消息已入队。')),
    existing,
  )

  assert.deepEqual(
    prependNotice(existing, buildNotice('真正需要显示的提示')),
    [buildNotice('真正需要显示的提示'), ...existing],
  )
})

test('isAutoRenameableWorkspaceSessionTitleOrigin only allows system titles', () => {
  assert.equal(isAutoRenameableWorkspaceSessionTitleOrigin('system'), true)
  assert.equal(isAutoRenameableWorkspaceSessionTitleOrigin(undefined), true)
  assert.equal(isAutoRenameableWorkspaceSessionTitleOrigin(null), true)
  assert.equal(isAutoRenameableWorkspaceSessionTitleOrigin('manual'), false)
  assert.equal(isAutoRenameableWorkspaceSessionTitleOrigin('ai'), false)
})

test('shouldAttemptAutoRenameWorkspaceSession requires session scope and system title origin', () => {
  const onWorkspaceSessionChange = () => undefined
  const workspaceSession = {
    id: 'workspace-session-1',
    workspaceId: 'workspace-1',
    title: '新会话',
    titleOrigin: 'system',
  } as WorkspaceSession

  assert.equal(shouldAttemptAutoRenameWorkspaceSession({
    onWorkspaceSessionChange,
    targetWorkspaceId: 'workspace-1',
    targetWorkspaceSessionId: 'workspace-session-1',
    workspaceSession,
  }), true)

  assert.equal(shouldAttemptAutoRenameWorkspaceSession({
    onWorkspaceSessionChange,
    targetWorkspaceId: 'workspace-1',
    targetWorkspaceSessionId: 'workspace-session-1',
    workspaceSession: {
      ...workspaceSession,
      titleOrigin: 'manual',
    },
  }), false)

  assert.equal(shouldAttemptAutoRenameWorkspaceSession({
    onWorkspaceSessionChange,
    targetWorkspaceId: 'workspace-1',
    targetWorkspaceSessionId: 'workspace-session-1',
    workspaceSession: {
      ...workspaceSession,
      titleOrigin: 'ai',
    },
  }), false)

  assert.equal(shouldAttemptAutoRenameWorkspaceSession({
    onWorkspaceSessionChange: undefined,
    targetWorkspaceId: 'workspace-1',
    targetWorkspaceSessionId: 'workspace-session-1',
    workspaceSession,
  }), false)

  assert.equal(shouldAttemptAutoRenameWorkspaceSession({
    onWorkspaceSessionChange,
    targetWorkspaceId: 'workspace-1',
    targetWorkspaceSessionId: undefined,
    workspaceSession,
  }), false)
})

test('resolveWorkspaceSessionScopedRuntimeConfig prefers workspace session runtime overrides', () => {
  const task = {
    id: 'task-1',
    agentType: 'Codex',
    executionModel: 'openai/gpt-5',
    agentSettings: {
      reasoningEffort: 'medium',
      reasoningSummary: 'auto',
      approval: 'never',
    },
    enabledMcpServerIds: ['global-server'],
  } as unknown as Task

  const workspaceSession = {
    id: 'workspace-session-1',
    workspaceId: 'workspace-1',
    title: 'Session',
    titleOrigin: 'manual',
    status: 'active',
    sessionKind: 'primary',
    sessionRole: 'general',
    sessionOrigin: 'manual',
    worktreeId: 'worktree-1',
    branchName: 'feature/test',
    worktreeStatus: 'created',
    workingDirectoryMode: 'worktree',
    needsHumanConfirm: false,
    agentRunningStatus: 'idle',
    runtimeStatus: 'idle',
    runtimeSequence: 1,
    currentStep: '',
    createdAt: '2026-05-26T00:00:00.000Z',
    updatedAt: '2026-05-26T00:00:00.000Z',
    agentType: 'Codex',
    executionModel: 'openai/gpt-5.1',
    agentSettings: {
      reasoningEffort: 'high',
      reasoningSummary: 'detailed',
      approval: 'never',
    },
    enabledMcpServerIds: ['workspace-server'],
  } as unknown as WorkspaceSession

  assert.deepEqual(
    resolveWorkspaceSessionScopedRuntimeConfig(task, workspaceSession),
    {
      agentType: 'Codex',
      executionModel: 'openai/gpt-5.1',
      agentSettings: {
        reasoningEffort: 'high',
        reasoningSummary: 'detailed',
        approval: 'never',
      },
      enabledMcpServerIds: ['workspace-server'],
    },
  )
})

test('aggregateTimelineForDisplay collapses duplicate assistant events in the same turn', () => {
  const timeline: ChatTimelineEvent[] = [
    {
      id: 'turn-1-user',
      ts: '2026-05-09T09:33:00.000Z',
      turnId: 'turn-1',
      seq: 1,
      kind: 'user_message',
      messageId: 'user-1',
      text: '你好',
    },
    {
      id: 'turn-1-assistant-a',
      ts: '2026-05-09T09:33:01.000Z',
      turnId: 'turn-1',
      seq: 2,
      kind: 'assistant_message',
      messageId: 'assistant-a',
      text: '有什么我可以帮你的吗？',
      authorName: 'CLAUDE CODE',
    },
    {
      id: 'turn-1-assistant-b',
      ts: '2026-05-09T09:33:02.000Z',
      turnId: 'turn-1',
      seq: 3,
      kind: 'assistant_message',
      messageId: 'assistant-b',
      text: '有什么我可以帮你的吗？',
      authorName: 'CLAUDE CODE',
    },
  ]

  const turns = aggregateTimelineForDisplay(timeline, false)
  assert.equal(turns.length, 1)
  assert.equal(turns[0]?.entries.length, 1)
  assert.equal(turns[0]?.entries[0]?.kind, 'assistant')
  if (turns[0]?.entries[0]?.kind === 'assistant') {
    assert.equal(turns[0].entries[0].message.id, 'assistant-b')
    assert.equal(turns[0].entries[0].message.text, '有什么我可以帮你的吗？')
  }
})

test('isRenderableWorkspaceAssistantMessage hides OpenCode missing-output placeholders', () => {
  assert.equal(isRenderableWorkspaceAssistantMessage({
    text: 'OpenCode 未返回文本输出。',
  }), false)
  assert.equal(isRenderableWorkspaceAssistantMessage({
    text: 'OpenCode 已处理完成，但没有返回文本输出。',
  }), false)
  assert.equal(isRenderableWorkspaceAssistantMessage({
    text: 'OpenCode 未生成有效文本回复，请重试。',
  }), false)
  assert.equal(isRenderableWorkspaceAssistantMessage({
    text: '真实回复',
  }), true)
  assert.equal(isRenderableWorkspaceAssistantMessage({
    text: '',
    attachments: [{ id: 'attachment-1' }],
  }), true)
})

test('upsertOptimisticTaskChatTurn creates an immediate current turn for workspace chat', () => {
  const timeline = upsertOptimisticTaskChatTurn([], {
    turnId: 'turn-optimistic',
    text: '帮我总结一下这个工作区',
    status: 'thinking',
    step: '正在提交消息',
    ts: '2026-05-15T03:11:00.000Z',
    attachments: [
      {
        id: 'image-1',
        url: 'https://example.com/image.png',
        filename: 'image.png',

        contentType: 'image/png',
      },
    ],
  })

  assert.equal(timeline.length, 2)
  assert.equal(timeline[0]?.id, 'turn:turn-optimistic:user:user:turn-optimistic')
  assert.equal(timeline[1]?.id, 'turn:turn-optimistic:status:thinking:正在提交消息')

  const turns = aggregateTimelineForDisplay(timeline, true)
  assert.equal(turns.length, 1)
  assert.equal(turns[0]?.isCurrent, true)
  assert.equal(turns[0]?.user?.text, '帮我总结一下这个工作区')
  assert.equal(turns[0]?.user?.attachments?.length, 1)
  assert.equal(turns[0]?.status?.status, 'thinking')
  assert.equal(turns[0]?.status?.step, '正在提交消息')
})

test('replaceOptimisticTaskChatTurnStatus upgrades queued state and removeTaskChatTurnEvents rolls back the turn', () => {
  const optimisticTimeline = upsertOptimisticTaskChatTurn([], {
    turnId: 'turn-queue',
    text: '继续处理',
    status: 'thinking',
    step: '正在提交消息',
    ts: '2026-05-15T03:11:00.000Z',
  })

  const queuedTimeline = replaceOptimisticTaskChatTurnStatus(optimisticTimeline, {
    turnId: 'turn-queue',
    status: 'waiting',
    step: '消息已入队。',
    ts: '2026-05-15T03:11:01.000Z',
  })

  assert.equal(queuedTimeline.filter((event) => event.kind === 'status').length, 1)
  const queuedTurns = aggregateTimelineForDisplay(queuedTimeline, true)
  assert.equal(queuedTurns[0]?.status?.status, 'waiting')
  assert.equal(queuedTurns[0]?.status?.step, '消息已入队。')

  assert.deepEqual(removeTaskChatTurnEvents(queuedTimeline, 'turn-queue'), [])
})

test('aggregateTimelineForDisplay removes replayed assistant history from the start of a later turn', () => {
  const timeline: ChatTimelineEvent[] = [
    {
      id: 'turn-1-user',
      ts: '2026-05-15T03:10:00.000Z',
      turnId: 'turn-1',
      seq: 1,
      kind: 'user_message',
      messageId: 'user-1',
      text: '在啊',
    },
    {
      id: 'turn-1-assistant-a',
      ts: '2026-05-15T03:10:01.000Z',
      turnId: 'turn-1',
      seq: 2,
      kind: 'assistant_message',
      messageId: 'assistant-a',
      text: '你好。你要我帮你处理什么？',
    },
    {
      id: 'turn-1-assistant-b',
      ts: '2026-05-15T03:10:02.000Z',
      turnId: 'turn-1',
      seq: 3,
      kind: 'assistant_message',
      messageId: 'assistant-b',
      text: '在。你直接说需求，我来处理。',
    },
    {
      id: 'turn-2-user',
      ts: '2026-05-15T03:11:00.000Z',
      turnId: 'turn-2',
      seq: 1,
      kind: 'user_message',
      messageId: 'user-2',
      text: '你会什么',
    },
    {
      id: 'turn-2-assistant-a',
      ts: '2026-05-15T03:11:01.000Z',
      turnId: 'turn-2',
      seq: 2,
      kind: 'assistant_message',
      messageId: 'assistant-c',
      text: '你好。你要我帮你处理什么？',
    },
    {
      id: 'turn-2-assistant-b',
      ts: '2026-05-15T03:11:02.000Z',
      turnId: 'turn-2',
      seq: 3,
      kind: 'assistant_message',
      messageId: 'assistant-d',
      text: '在。你直接说需求，我来处理。',
    },
    {
      id: 'turn-2-assistant-c',
      ts: '2026-05-15T03:11:03.000Z',
      turnId: 'turn-2',
      seq: 4,
      kind: 'assistant_message',
      messageId: 'assistant-e',
      text: '我可以帮你读代码、改代码、跑测试。',
    },
  ]

  const turns = aggregateTimelineForDisplay(timeline, false)

  assert.equal(turns.length, 2)
  assert.deepEqual(
    turns[1]?.entries.map((entry) => entry.kind === 'assistant' ? entry.message.text : ''),
    ['我可以帮你读代码、改代码、跑测试。'],
  )
})

test('aggregateTimelineForDisplay collapses duplicate thinking events in the same turn', () => {
  const timeline: ChatTimelineEvent[] = [
    {
      id: 'turn-1-user',
      ts: '2026-05-09T09:33:00.000Z',
      turnId: 'turn-1',
      seq: 1,
      kind: 'user_message',
      messageId: 'user-1',
      text: '你好',
    },
    {
      id: 'turn-1-thinking-a',
      ts: '2026-05-09T09:33:01.000Z',
      turnId: 'turn-1',
      seq: 2,
      kind: 'thinking',
      partId: 'reasoning-a',
      text: 'Analyzing Git Commits',
    },
    {
      id: 'turn-1-thinking-b',
      ts: '2026-05-09T09:33:02.000Z',
      turnId: 'turn-1',
      seq: 3,
      kind: 'thinking',
      partId: 'reasoning-b',
      text: 'Analyzing Git Commits',
    },
  ]

  const turns = aggregateTimelineForDisplay(timeline, false)
  assert.equal(turns.length, 1)
  assert.equal(turns[0]?.entries.length, 1)
  assert.equal(turns[0]?.entries[0]?.kind, 'thinking')
  if (turns[0]?.entries[0]?.kind === 'thinking') {
    assert.equal(turns[0].entries[0].content, 'Analyzing Git Commits')
  }
})

test('aggregateTimelineForDisplay preserves the latest terminal status after the run completes', () => {
  const timeline: ChatTimelineEvent[] = [
    {
      id: 'turn-1-user',
      ts: '2026-05-15T03:10:00.000Z',
      turnId: 'turn-1',
      seq: 1,
      kind: 'user_message',
      messageId: 'user-1',
      text: '继续处理',
    },
    {
      id: 'turn-1-status-thinking',
      ts: '2026-05-15T03:10:01.000Z',
      turnId: 'turn-1',
      seq: 2,
      kind: 'status',
      status: 'thinking',
      step: '正在处理消息',
    },
    {
      id: 'turn-1-status-complete',
      ts: '2026-05-15T03:10:20.000Z',
      turnId: 'turn-1',
      seq: 3,
      kind: 'status',
      status: 'complete',
      step: '工作区对话已完成',
    },
  ]

  const turns = aggregateTimelineForDisplay(timeline, false)
  assert.equal(turns.length, 1)
  assert.equal(turns[0]?.status?.status, 'complete')
  assert.equal(turns[0]?.status?.step, '工作区对话已完成')
})

test('aggregateTimelineForDisplay keeps delivery result entries separate from assistant messages', () => {
  const timeline: ChatTimelineEvent[] = [
    {
      id: 'turn-1-user',
      ts: '2026-05-15T03:10:00.000Z',
      turnId: 'turn-1',
      seq: 1,
      kind: 'user_message',
      messageId: 'user-1',
      text: '继续处理',
    },
    {
      id: 'turn-1-assistant',
      ts: '2026-05-15T03:10:05.000Z',
      turnId: 'turn-1',
      seq: 2,
      kind: 'assistant_message',
      messageId: 'assistant-1',
      text: '我已经处理好了主要改动。',
    },
    {
      id: 'turn-1-delivery',
      ts: '2026-05-15T03:10:06.000Z',
      turnId: 'turn-1',
      seq: 3,
      kind: 'delivery_result',
      message: '已推送远端分支 vibemux/test-delivery-result。',
      remoteBranchName: 'vibemux/test-delivery-result',
      commitShas: ['abcdef1234567890'],
      delivery: {
        mode: 'commit',
        pullRequest: {
          ready: true,
          remoteReady: true,
          repoUrl: 'https://github.com/example/repo.git',
          baseBranch: 'main',
          compareBranch: 'vibemux/test-delivery-result',
          number: 57,
          url: 'https://github.com/example/repo/pull/57',
          state: 'open',
        },
      },
    },
  ]

  const turns = aggregateTimelineForDisplay(timeline, false)
  assert.equal(turns.length, 1)
  assert.equal(turns[0]?.entries.length, 2)
  assert.equal(turns[0]?.entries[0]?.kind, 'assistant')
  assert.equal(turns[0]?.entries[1]?.kind, 'delivery_result')
  if (turns[0]?.entries[1]?.kind === 'delivery_result') {
    assert.equal(turns[0].entries[1].message, '已推送远端分支 vibemux/test-delivery-result。')
    assert.equal(turns[0].entries[1].remoteBranchName, 'vibemux/test-delivery-result')
    assert.equal(turns[0].entries[1].delivery?.pullRequest?.number, 57)
  }
})

test('aggregateTimelineForDisplay keeps pending interactions as visible turn entries', () => {
  const timeline: ChatTimelineEvent[] = [
    {
      id: 'turn-1-user',
      ts: '2026-05-15T03:20:00.000Z',
      turnId: 'turn-1',
      seq: 1,
      kind: 'user_message',
      messageId: 'user-1',
      text: '帮我创建 GitHub 仓库',
    },
    {
      id: 'turn-1-interaction',
      ts: '2026-05-15T03:20:02.000Z',
      turnId: 'turn-1',
      seq: 2,
      kind: 'interaction',
      interaction: {
        id: 'question-1',
        type: 'question',
        status: 'pending',
        title: '需要 GitHub 仓库地址',
        prompt: '请提供一个空仓库 URL。',
        provider: 'Codex',
        toolName: 'requestUserInput',
      },
    },
    {
      id: 'turn-1-status',
      ts: '2026-05-15T03:20:02.000Z',
      turnId: 'turn-1',
      seq: 3,
      kind: 'status',
      status: 'waiting',
      step: '等待用户回答问题',
    },
  ]

  const turns = aggregateTimelineForDisplay(timeline, true)
  assert.equal(turns.length, 1)
  assert.equal(turns[0]?.status?.status, 'waiting')
  assert.equal(turns[0]?.entries.length, 1)
  assert.equal(turns[0]?.entries[0]?.kind, 'interaction')
  if (turns[0]?.entries[0]?.kind === 'interaction') {
    assert.equal(turns[0].entries[0].interaction.title, '需要 GitHub 仓库地址')
    assert.equal(turns[0].entries[0].interaction.provider, 'Codex')
  }
})

test('resolveTaskChatQueueStatusMessage keeps queued session messaging visible', () => {
  assert.equal(
    resolveTaskChatQueueStatusMessage('queued', '执行节点执行队列已满，当前会话正在排队。'),
    '执行节点执行队列已满，当前会话正在排队。',
  )
  assert.equal(
    resolveTaskChatQueueStatusMessage('queued', ''),
    '执行节点执行队列已满，当前会话正在排队，等待空闲槽位后自动开始。',
  )
  assert.equal(resolveTaskChatQueueStatusMessage('running', 'ignored'), '')
})

test('isTaskChatSocketNotReadyError matches the transient realtime connection guard', () => {
  assert.equal(
    isTaskChatSocketNotReadyError(new Error('实时连接尚未建立，请稍后重试。')),
    true,
  )
  assert.equal(
    isTaskChatSocketNotReadyError(new Error('发送请求超时，请检查实时连接后重试。')),
    false,
  )
  assert.equal(
    isTaskChatSocketNotReadyError(new Error('实时连接已断开，请重试。')),
    true,
  )
  assert.equal(
    isTaskChatSocketNotReadyError('实时连接尚未建立，请稍后重试。'),
    false,
  )
})
