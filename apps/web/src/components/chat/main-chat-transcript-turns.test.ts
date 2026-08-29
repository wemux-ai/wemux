import assert from 'node:assert/strict'
import test from 'node:test'
import type { ChatMessage } from '@shared/types'
import { buildMainChatTranscriptTurns, chatMessagesToChatBubbleMessages, filterMainChatTranscriptTurns, formatMainChatTranscriptTurnsForCopy } from './main-chat-transcript-turns'

test('builds one turn with persisted reasoning, tool calls, and the final answer', () => {
  const messages: ChatMessage[] = [
    { id: 'user-1', role: 'user', content: '检查任务', createdAt: '2026-07-21T00:00:00.000Z' },
    {
      id: 'assistant-1',
      role: 'assistant',
      content: '检查完成',
      createdAt: '2026-07-21T00:01:00.000Z',
      reasoning: ['先读取任务'],
      toolCalls: [{
        id: 'tool-1',
        name: 'task.get',
        args: '{}',
        result: '{"ok":true}',
        startedAt: '2026-07-21T00:00:10.000Z',
        finishedAt: '2026-07-21T00:00:11.000Z',
      }],
    },
  ]

  const turns = buildMainChatTranscriptTurns(chatMessagesToChatBubbleMessages(messages))
  assert.equal(turns.length, 1)
  assert.deepEqual(turns[0]?.entries.map((entry) => entry.kind), ['thinking', 'tool', 'assistant'])
  assert.equal(turns[0]?.isCurrent, true)

  const conversation = filterMainChatTranscriptTurns(turns, 'conversation')
  assert.deepEqual(conversation[0]?.entries.map((entry) => entry.kind), ['assistant'])
  assert.equal(conversation[0]?.user?.text, '检查任务')

  const process = filterMainChatTranscriptTurns(turns, 'process')
  assert.deepEqual(process[0]?.entries.map((entry) => entry.kind), ['thinking', 'tool'])
  assert.equal(process[0]?.user, undefined)

  assert.equal(formatMainChatTranscriptTurnsForCopy(turns), [
    '[用户]\n检查任务',
    '[思考]\n先读取任务',
    '[工具] task.get\n参数:\n{}\n结果:\n{"ok":true}',
    '[Agent]\n检查完成',
  ].join('\n\n'))
})

test('process filtering removes turns without reasoning or tools', () => {
  const turns = buildMainChatTranscriptTurns(chatMessagesToChatBubbleMessages([
    { id: 'user-1', role: 'user', content: 'hello', createdAt: '2026-07-21T00:00:00.000Z' },
    { id: 'assistant-1', role: 'assistant', content: 'hi', createdAt: '2026-07-21T00:01:00.000Z' },
  ]))
  assert.deepEqual(filterMainChatTranscriptTurns(turns, 'process'), [])
})

test('carries author identity through to the assistant entry so avatar cards can open', () => {
  const messages: ChatMessage[] = [
    { id: 'user-1', role: 'user', content: '你好', createdAt: '2026-07-21T00:00:00.000Z' },
    {
      id: 'assistant-1',
      role: 'assistant',
      content: '收到',
      createdAt: '2026-07-21T00:01:00.000Z',
      authorType: 'agent',
      authorId: 'agent-01',
      authorName: 'CEO Agent',
    } as ChatMessage,
  ]

  const turns = buildMainChatTranscriptTurns(chatMessagesToChatBubbleMessages(messages))
  const assistantEntry = turns[0]?.entries.find((entry) => entry.kind === 'assistant')
  assert.equal(assistantEntry?.kind, 'assistant')
  assert.equal(assistantEntry?.message.authorType, 'agent')
  assert.equal(assistantEntry?.message.authorId, 'agent-01')
  assert.equal(assistantEntry?.message.authorName, 'CEO Agent')
})

test('chatMessagesToChatBubbleMessages assigns timeline order and clears streaming flags', () => {
  const bubbles = chatMessagesToChatBubbleMessages([
    { id: 'user-1', role: 'user', content: '你好', createdAt: '2026-07-21T00:00:00.000Z' },
    {
      id: 'assistant-1',
      role: 'assistant',
      content: '收到',
      createdAt: '2026-07-21T00:01:00.000Z',
      // 运行时历史消息可能残留 streaming 标记（类型上不属于 ChatMessage），
      // 映射层负责清掉它。
      streaming: true,
      agentRunningStatus: 'complete',
    } as ChatMessage,
  ])

  assert.equal(bubbles.length, 2)
  assert.deepEqual(bubbles.map((bubble) => bubble.timelineOrder), [1, 2])
  assert.deepEqual(bubbles.map((bubble) => bubble.streaming), [false, false])
  assert.equal(bubbles[1]?.agentRunningStatus, 'complete')
})
