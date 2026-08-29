import assert from 'node:assert/strict'
import test from 'node:test'
import type { AgentRecord } from '../../lib/api'
import type { MainChatSession } from '@shared/types'
import type { ChatBubbleMessage, ChatTimelineEntry } from './chat-route-types'
import {
  buildMainChatAgentSessionDigests,
  buildMainChatTranscriptTurns,
  buildMessagesFromSession,
  formatChatListTimestamp,
  getMainChatSessionPreview,
  getMainChatSessionActivityState,
  getVisibleMainChatSessions,
  isMainChatSessionBusy,
  resolveAvailableChatAgentId,
  resolveAgentDefaultExecutorId,
  resolveEffectiveMainChatExecutorId,
  resolveHistoricalAgentName,
} from './chat-route-helpers'

test('getVisibleMainChatSessions removes sessions bound to deleted Agents', () => {
  const sessions = [
    { id: 'session-live', title: 'Live', customAgentId: 'agent-live', messages: [], createdAt: '', updatedAt: '' },
    { id: 'session-deleted', title: 'Deleted', customAgentId: 'agent-deleted', messages: [], createdAt: '', updatedAt: '' },
    { id: 'session-primary', title: 'Primary', messages: [], createdAt: '', updatedAt: '' },
  ] as MainChatSession[]

  const visible = getVisibleMainChatSessions(sessions, [{ id: 'agent-live' } as AgentRecord])

  assert.deepEqual(visible.map((session) => session.id), ['session-live', 'session-primary'])
})

test('getVisibleMainChatSessions keeps owned sessions even when bound to an unknown Agent (G1)', () => {
  const sessions = [
    { id: 'session-external', title: '来自 E2E Agent X 的消息', customAgentId: 'agent-x', ownerUserId: 'user-b', messages: [], createdAt: '', updatedAt: '' },
    { id: 'session-other', title: 'Other', customAgentId: 'agent-x', ownerUserId: 'user-a', messages: [], createdAt: '', updatedAt: '' },
    { id: 'session-deleted', title: 'Deleted', customAgentId: 'agent-deleted', ownerUserId: 'user-b', messages: [], createdAt: '', updatedAt: '' },
  ] as MainChatSession[]

  // 不传 viewer：未知 Agent 会话全部过滤
  assert.deepEqual(getVisibleMainChatSessions(sessions, []).map((session) => session.id), [])
  // viewer=user-b：自己拥有的未知 Agent 会话可见（含 deleted Agent 会话）；他人会话（user-a）不可见
  assert.deepEqual(
    getVisibleMainChatSessions(sessions, [], 'user-b').map((session) => session.id),
    ['session-external', 'session-deleted'],
  )
})

test('resolveHistoricalAgentName 从会话标题提取 Agent 名，取不到回落 agentId', () => {
  const sessions = [
    { id: 's1', title: '来自 E2E Agent X 的消息', customAgentId: 'agent-x', messages: [], createdAt: '', updatedAt: '' },
    { id: 's2', title: '普通会话', customAgentId: 'agent-y', messages: [], createdAt: '', updatedAt: '' },
  ] as MainChatSession[]
  assert.equal(resolveHistoricalAgentName(sessions, 'agent-x'), 'E2E Agent X')
  assert.equal(resolveHistoricalAgentName(sessions, 'agent-x'), 'E2E Agent X')
  assert.equal(resolveHistoricalAgentName([], 'agent-zzz'), 'agent-zzz')
})

test('resolveAvailableChatAgentId replaces a deleted persisted target with the active Agent', () => {
  assert.equal(
    resolveAvailableChatAgentId('agent-deleted', ['agent-ceo', 'agent-design'], 'agent-ceo'),
    'agent-ceo',
  )
  assert.equal(
    resolveAvailableChatAgentId('agent-deleted', ['agent-ceo'], 'agent-deleted'),
    'agent-ceo',
  )
})

test('buildMainChatTranscriptTurns hides the temporary assistant bubble when timeline chunks already represent it', () => {
  const messages: ChatBubbleMessage[] = [
    {
      id: 'user-1',
      role: 'user',
      content: '你好',
      createdAt: '2026-05-09T09:18:00.000Z',
      timelineOrder: 1,
    },
    {
      id: 'assistant-temp',
      role: 'assistant',
      content: '有什么可以帮你的？',
      createdAt: '2026-05-09T09:18:01.000Z',
      timelineOrder: 2,
      streaming: true,
    },
  ]

  const timelineEntries: ChatTimelineEntry[] = [
    {
      id: 'assistant:assistant-temp:0',
      kind: 'assistant',
      createdAt: '2026-05-09T09:18:01.500Z',
      timelineOrder: 3,
      messageId: 'assistant-temp',
      text: '有什么可以帮你的？',
    },
  ]

  const turns = buildMainChatTranscriptTurns(messages, timelineEntries)

  assert.equal(turns.length, 1)
  assert.equal(turns[0]?.entries.filter((entry) => entry.kind === 'assistant').length, 1)
  const assistantEntry = turns[0]?.entries.find((entry) => entry.kind === 'assistant')
  assert.equal(assistantEntry?.kind, 'assistant')
  if (assistantEntry?.kind === 'assistant') {
    assert.equal(assistantEntry.message.text, '有什么可以帮你的？')
  }
})

test('buildMainChatTranscriptTurns keeps the optimistic assistant working bubble before reply text starts', () => {
  const messages: ChatBubbleMessage[] = [
    {
      id: 'user-1',
      role: 'user',
      content: '在吗',
      createdAt: '2026-05-15T02:35:00.000Z',
      timelineOrder: 1,
    },
    {
      id: 'assistant-working',
      role: 'assistant',
      content: '',
      createdAt: '2026-05-15T02:35:01.000Z',
      timelineOrder: 2,
      streaming: true,
      agentRunningStatus: 'thinking',
      currentStep: 'Agent 系统正在分析需求...',
    },
  ]

  const turns = buildMainChatTranscriptTurns(messages, [])

  assert.equal(turns.length, 1)
  const assistantEntry = turns[0]?.entries.find((entry) => entry.kind === 'assistant')
  assert.equal(assistantEntry?.kind, 'assistant')
  if (assistantEntry?.kind === 'assistant') {
    assert.equal(assistantEntry.message.streaming, true)
    assert.equal(assistantEntry.message.agentRunningStatus, 'thinking')
    assert.equal(assistantEntry.message.currentStep, 'Agent 系统正在分析需求...')
    assert.equal(assistantEntry.message.text, '')
  }
})

test('buildMessagesFromSession clears persisted streaming flags for reopened main chat history', () => {
  const messages = buildMessagesFromSession({
    id: 'session-1',
    title: '历史会话',
    messages: [
      {
        id: 'assistant-1',
        role: 'assistant',
        content: '已经结束的回复',
        createdAt: '2026-05-15T02:35:01.000Z',
        agentRunningStatus: 'complete',
        currentStep: 'Agent 系统对话已完成',
      },
    ],
    createdAt: '2026-05-15T02:35:00.000Z',
    updatedAt: '2026-05-15T02:35:01.000Z',
  })

  assert.equal(messages.length, 1)
  assert.equal(messages[0]?.streaming, false)
})

test('buildMainChatTranscriptTurns rehydrates persisted reasoning and tool calls from main chat messages', () => {
  const messages: ChatBubbleMessage[] = [
    {
      id: 'user-1',
      role: 'user',
      content: '帮我改一下按钮',
      createdAt: '2026-05-12T06:58:00.000Z',
      timelineOrder: 1,
    },
    {
      id: 'assistant-1',
      role: 'assistant',
      content: '已经改好了。',
      createdAt: '2026-05-12T06:58:03.000Z',
      timelineOrder: 2,
      reasoning: ['先定位路由文件。', '再替换展开收起图标。'],
      toolCalls: [
        {
          id: 'tool-1',
          name: 'read_file',
          args: '{\"path\":\"apps/web/src/routes/workspace.tsx\"}',
          startedAt: '2026-05-12T06:58:01.000Z',
          finishedAt: '2026-05-12T06:58:01.200Z',
        },
      ],
    },
  ]

  const turns = buildMainChatTranscriptTurns(messages, [])

  assert.equal(turns.length, 1)
  assert.equal(turns[0]?.entries[0]?.kind, 'thinking')
  assert.equal(turns[0]?.entries[1]?.kind, 'thinking')
  assert.equal(turns[0]?.entries[2]?.kind, 'tool')
  assert.equal(turns[0]?.entries[3]?.kind, 'assistant')
})

test('busy main chat sessions stay in running state even without local sidebar memory', () => {
  assert.equal(isMainChatSessionBusy({ agentRunningStatus: 'executing' }), true)
  assert.equal(
    getMainChatSessionActivityState({
      session: { agentRunningStatus: 'executing' },
    }),
    'running',
  )
})

test('completed local sidebar state wins after the stream reports a terminal event', () => {
  assert.equal(
    getMainChatSessionActivityState({
      session: { agentRunningStatus: 'idle' },
      localActivity: 'completed',
    }),
    'completed',
  )
  assert.equal(
    getMainChatSessionActivityState({
      session: { agentRunningStatus: 'thinking' },
      localActivity: 'completed',
    }),
    'completed',
  )
})

test('terminal assistant message clears stale busy main chat session state', () => {
  assert.equal(
    getMainChatSessionActivityState({
      session: {
        agentRunningStatus: 'executing',
        messages: [
          {
            id: 'assistant-1',
            role: 'assistant',
            content: '已完成',
            createdAt: '2026-05-12T03:59:00.000Z',
            agentRunningStatus: 'complete',
            currentStep: '工作区对话已完成',
          },
        ],
      },
    }),
    undefined,
  )
})

test('resolveAgentDefaultExecutorId reads the configured default executor from custom agent config', () => {
  assert.equal(resolveAgentDefaultExecutorId(null), '')
  assert.equal(resolveAgentDefaultExecutorId({
    config: { customAgent: { defaultExecutorId: ' executor-a ' } },
  }), 'executor-a')
})

test('formatChatListTimestamp switches between clock, day name, and date', () => {
  const now = new Date(2026, 7, 4, 14, 30)
  const at = (year: number, month: number, day: number, hour = 9, minute = 5) => {
    return new Date(year, month, day, hour, minute).toISOString()
  }

  assert.equal(formatChatListTimestamp(at(2026, 7, 4, 9, 5), 'zh', now), '09:05')
  assert.equal(formatChatListTimestamp(at(2026, 7, 3), 'zh', now), '昨天')
  assert.equal(formatChatListTimestamp(at(2026, 7, 3), 'en', now), 'Yesterday')
  assert.equal(formatChatListTimestamp(at(2026, 7, 1), 'zh', now), '周六')
  assert.equal(formatChatListTimestamp(at(2026, 7, 1), 'en', now), 'Sat')
  assert.equal(formatChatListTimestamp(at(2026, 6, 2), 'zh', now), '7/2')
  assert.equal(formatChatListTimestamp(at(2025, 11, 24), 'zh', now), '2025/12/24')
  assert.equal(formatChatListTimestamp('', 'zh', now), '')
  assert.equal(formatChatListTimestamp('not-a-date', 'zh', now), '')
})

test('getMainChatSessionPreview falls back to the derived preview when list payloads drop messages', () => {
  assert.equal(
    getMainChatSessionPreview({
      messages: [],
      latestMessagePreview: '有什么需要我帮忙的吗？',
    }),
    '有什么需要我帮忙的吗？',
  )
  assert.equal(
    getMainChatSessionPreview({
      messages: [{ id: 'm1', role: 'assistant', content: ' 实时\n内容 ', createdAt: '' }],
      latestMessagePreview: '过期预览',
    } as Parameters<typeof getMainChatSessionPreview>[0]),
    '实时 内容',
  )
  assert.equal(getMainChatSessionPreview({ messages: [] }), '')
})

test('buildMainChatAgentSessionDigests summarizes the newest session per Agent', () => {
  const sessions = [
    {
      id: 'session-old',
      title: '旧会话',
      customAgentId: 'agent-ceo',
      messages: [{ id: 'm1', role: 'user', content: '早上好', createdAt: '' }],
      createdAt: '2026-08-01T00:00:00.000Z',
      updatedAt: '2026-08-01T00:00:00.000Z',
    },
    {
      id: 'session-new',
      title: '你好',
      customAgentId: 'agent-ceo',
      messages: [
        { id: 'm2', role: 'user', content: '你好', createdAt: '' },
        { id: 'm3', role: 'assistant', content: '有什么需要我帮忙的吗？', createdAt: '' },
      ],
      createdAt: '2026-08-03T00:00:00.000Z',
      updatedAt: '2026-08-04T02:00:00.000Z',
    },
    {
      id: 'session-primary',
      title: '空会话',
      messages: [],
      createdAt: '2026-08-02T00:00:00.000Z',
      updatedAt: '2026-08-02T00:00:00.000Z',
    },
  ] as MainChatSession[]

  const digests = buildMainChatAgentSessionDigests(sessions)

  assert.deepEqual(digests['agent-ceo'], {
    sessionCount: 2,
    summary: '有什么需要我帮忙的吗？',
    updatedAt: '2026-08-04T02:00:00.000Z',
  })
  assert.deepEqual(digests.__primary_agent__, {
    sessionCount: 1,
    summary: '空会话',
    updatedAt: '2026-08-02T00:00:00.000Z',
  })
})

test('resolveEffectiveMainChatExecutorId prefers session binding over agent default', () => {
  const agent = { config: { customAgent: { defaultExecutorId: 'agent-default' } } }

  assert.equal(resolveEffectiveMainChatExecutorId(
    { executorId: 'session-executor' } as Parameters<typeof resolveEffectiveMainChatExecutorId>[0],
    agent,
  ), 'session-executor')
  assert.equal(resolveEffectiveMainChatExecutorId(
    { executorId: '' } as Parameters<typeof resolveEffectiveMainChatExecutorId>[0],
    agent,
  ), 'agent-default')
})
