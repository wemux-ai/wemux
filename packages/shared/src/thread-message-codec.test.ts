import assert from 'node:assert/strict'
import test from 'node:test'
import {
  chatMessageToThreadMessage,
  partsToToolCalls,
  sortMessageParts,
  taskCommentToThreadMessage,
  threadMessageToChatMessage,
  threadMessageToTaskComment,
  toolCallToParts,
} from './thread-message-codec'
import type { MessagePart } from './thread-message'
import type { ChatMessage, TaskComment, ToolCall } from './types'

const THREAD_ID = 'thread-1'

const buildToolCall = (overrides: Partial<ToolCall> = {}): ToolCall => ({
  id: 'tool-1',
  name: 'read',
  args: '{"path":"a.ts"}',
  result: 'ok',
  startedAt: '2026-08-03T00:00:00.000Z',
  finishedAt: '2026-08-03T00:00:01.000Z',
  ...overrides,
})

const roundTripChatMessage = (message: ChatMessage): ChatMessage => {
  const { message: threadMessage, extras } = chatMessageToThreadMessage(message, THREAD_ID)
  return threadMessageToChatMessage(threadMessage, extras)
}

test('toolCallToParts splits a completed tool call into paired call and result parts', () => {
  const parts = toolCallToParts(buildToolCall())

  assert.deepEqual(parts, [
    {
      type: 'tool_call',
      toolCallId: 'tool-1',
      name: 'read',
      args: '{"path":"a.ts"}',
      startedAt: '2026-08-03T00:00:00.000Z',
    },
    {
      type: 'tool_result',
      toolCallId: 'tool-1',
      result: 'ok',
      finishedAt: '2026-08-03T00:00:01.000Z',
    },
  ])
})

test('toolCallToParts omits the result part for a still running tool call', () => {
  const parts = toolCallToParts(buildToolCall({ result: undefined, finishedAt: undefined }))

  assert.equal(parts.length, 1)
  assert.equal(parts[0].type, 'tool_call')
})

test('toolCallToParts preserves workspaceId and metadata through the split', () => {
  const toolCall = buildToolCall({
    workspaceId: 'workspace-1',
    metadata: { resultPreviewKind: 'task_created', resultPreviewTaskId: 'task-9' },
  })

  assert.deepEqual(partsToToolCalls(toolCallToParts(toolCall)), [toolCall])
})

test('partsToToolCalls round-trips a tool call that finished without a result payload', () => {
  const toolCall: ToolCall = {
    id: 'tool-1',
    name: 'read',
    args: '{"path":"a.ts"}',
    startedAt: '2026-08-03T00:00:00.000Z',
    finishedAt: '2026-08-03T00:00:01.000Z',
  }

  assert.deepEqual(partsToToolCalls(toolCallToParts(toolCall)), [toolCall])
})

test('partsToToolCalls drops an orphan tool_result instead of fabricating a call', () => {
  const parts: MessagePart[] = [{ type: 'tool_result', toolCallId: 'missing', result: 'x' }]

  assert.deepEqual(partsToToolCalls(parts), [])
})

test('partsToToolCalls keeps multiple tool calls paired by toolCallId', () => {
  const first = buildToolCall({ id: 'tool-1', name: 'read', result: 'a' })
  const second = buildToolCall({ id: 'tool-2', name: 'bash', result: 'b' })
  const parts = [...toolCallToParts(first), ...toolCallToParts(second)]

  assert.deepEqual(partsToToolCalls(parts), [first, second])
})

test('sortMessageParts applies the canonical order and keeps same-type input order', () => {
  const parts: MessagePart[] = [
    { type: 'text', text: 'answer' },
    { type: 'reasoning', text: 'first' },
    { type: 'reasoning', text: 'second' },
    { type: 'tool_call', toolCallId: 't', name: 'read', args: '{}', startedAt: '2026-08-03T00:00:00.000Z' },
  ]

  assert.deepEqual(sortMessageParts(parts).map((part) => part.type), [
    'reasoning',
    'reasoning',
    'tool_call',
    'text',
  ])
  assert.deepEqual(
    sortMessageParts(parts).flatMap((part) => (part.type === 'reasoning' ? [part.text] : [])),
    ['first', 'second'],
  )
})

test('chatMessageToThreadMessage round-trips a rich assistant message losslessly', () => {
  const message: ChatMessage = {
    id: 'message-1',
    role: 'assistant',
    content: 'done',
    createdAt: '2026-08-03T00:00:02.000Z',
    authorType: 'agent',
    authorId: 'agent-1',
    authorName: 'CEO Agent',
    attachments: [{ id: 'file-1', url: 'https://example.com/a.png', filename: 'a.png' }],
    reasoning: ['think a', 'think b'],
    toolCalls: [buildToolCall()],
    usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 },
    agentRunningStatus: 'idle',
    currentStep: 'finished',
  }

  assert.deepEqual(roundTripChatMessage(message), message)
})

test('chatMessageToThreadMessage round-trips a plain user message losslessly', () => {
  const message: ChatMessage = {
    id: 'message-2',
    role: 'user',
    content: 'hello',
    createdAt: '2026-08-03T00:00:00.000Z',
  }

  assert.deepEqual(roundTripChatMessage(message), message)
})

test('chatMessageToThreadMessage moves usage off the message and onto run extras', () => {
  const { message, extras } = chatMessageToThreadMessage({
    id: 'message-3',
    role: 'assistant',
    content: 'x',
    createdAt: '2026-08-03T00:00:00.000Z',
    usage: { inputTokens: 1, outputTokens: 2, totalTokens: 3 },
  }, THREAD_ID)

  assert.equal('usage' in message, false)
  assert.deepEqual(extras.usage, { inputTokens: 1, outputTokens: 2, totalTokens: 3 })
})

test('chatMessageToThreadMessage emits no text part for empty content', () => {
  const { message } = chatMessageToThreadMessage({
    id: 'message-4',
    role: 'assistant',
    content: '',
    createdAt: '2026-08-03T00:00:00.000Z',
    toolCalls: [buildToolCall()],
  }, THREAD_ID)

  assert.equal(message.parts.some((part) => part.type === 'text'), false)
  assert.equal(threadMessageToChatMessage(message).content, '')
})

test('chatMessageToThreadMessage keeps a proposal payload across the round trip', () => {
  const message: ChatMessage = {
    id: 'message-5',
    role: 'assistant',
    content: 'proposing',
    createdAt: '2026-08-03T00:00:00.000Z',
    taskProposal: { title: 'ship it', description: 'do the thing' } as ChatMessage['taskProposal'],
  }

  assert.deepEqual(roundTripChatMessage(message), message)
})

test('taskCommentToThreadMessage round-trips comment threading, reactions and soft delete', () => {
  const comment: TaskComment = {
    id: 'comment-1',
    authorType: 'user',
    authorId: 'user-1',
    authorName: 'Example Developer',
    parentCommentId: 'comment-0',
    mentions: [{ targetType: 'agent', targetId: 'agent-1', targetName: 'CEO Agent' }],
    reactions: [{ emoji: '👍', userIds: ['user-1', 'user-2'] }],
    attachments: [{ id: 'file-2', url: 'https://example.com/b.png', filename: 'b.png' }],
    content: 'please review',
    createdAt: '2026-08-03T00:00:00.000Z',
    editedAt: '2026-08-03T00:01:00.000Z',
    deletedAt: '2026-08-03T00:02:00.000Z',
    resolvedAt: '2026-08-03T00:03:00.000Z',
    resolvedByUserId: 'user-2',
  }

  assert.deepEqual(threadMessageToTaskComment(taskCommentToThreadMessage(comment, THREAD_ID)), comment)
})

test('taskCommentToThreadMessage maps author type onto the message role', () => {
  const roleFor = (authorType: TaskComment['authorType']) => taskCommentToThreadMessage({
    id: 'comment-2',
    authorType,
    content: 'x',
    createdAt: '2026-08-03T00:00:00.000Z',
  }, THREAD_ID).role

  assert.equal(roleFor('user'), 'user')
  assert.equal(roleFor('agent'), 'assistant')
  assert.equal(roleFor('system'), 'system')
})

test('a comment and a chat message with the same content produce the same text parts', () => {
  const { message: fromChat } = chatMessageToThreadMessage({
    id: 'message-6',
    role: 'user',
    content: 'same text',
    createdAt: '2026-08-03T00:00:00.000Z',
  }, THREAD_ID)
  const fromComment = taskCommentToThreadMessage({
    id: 'comment-3',
    authorType: 'user',
    content: 'same text',
    createdAt: '2026-08-03T00:00:00.000Z',
  }, THREAD_ID)

  assert.deepEqual(fromChat.parts, fromComment.parts)
})
