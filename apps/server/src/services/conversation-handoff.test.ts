import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildConversationHandoffPromptSection,
  buildConversationHandoffSnapshot,
  buildTaskConversationHandoffSnapshot,
  buildUserMessagePromptWithHandoff,
} from './conversation-handoff'

test('buildConversationHandoffSnapshot merges consecutive assistant fragments', () => {
  const snapshot = buildConversationHandoffSnapshot([
    {
      role: 'user',
      content: '请继续修复这个工作区会话。',
      createdAt: '2026-05-07T09:00:00.000Z',
    },
    {
      role: 'assistant',
      content: '我先检查了切模型链路。',
      createdAt: '2026-05-07T09:00:05.000Z',
    },
    {
      role: 'assistant',
      content: '现在开始补 handoff fallback。',
      createdAt: '2026-05-07T09:00:06.000Z',
    },
  ])

  assert.ok(snapshot)
  assert.equal(snapshot.messageCount, 2)
  assert.equal(snapshot.recentMessages.length, 2)
  assert.equal(snapshot.recentMessages[1]?.role, 'assistant')
  assert.match(snapshot.recentMessages[1]?.content ?? '', /补 handoff fallback/)
})

test('buildTaskConversationHandoffSnapshot ignores system events and keeps user agent history', () => {
  const snapshot = buildTaskConversationHandoffSnapshot([
    {
      role: 'user',
      content: 'OpenCode 切到 Codex 后历史断了。',
      createdAt: '2026-05-07T09:10:00.000Z',
    },
    {
      role: 'system',
      content: '正在执行工具：read_file',
      createdAt: '2026-05-07T09:10:02.000Z',
    },
    {
      role: 'assistant',
      content: '问题存在，断点在跨 runtime fallback。',
      createdAt: '2026-05-07T09:10:05.000Z',
    },
  ])

  assert.ok(snapshot)
  assert.equal(snapshot.messageCount, 2)
  assert.equal(snapshot.latestUserMessage, 'OpenCode 切到 Codex 后历史断了。')
  assert.equal(snapshot.latestAssistantMessage, '问题存在，断点在跨 runtime fallback。')
})

test('buildConversationHandoffPromptSection renders summary and recent windows', () => {
  const snapshot = buildConversationHandoffSnapshot([
    {
      role: 'user',
      content: '先看主聊天链路。',
      createdAt: '2026-05-07T09:20:00.000Z',
    },
    {
      role: 'assistant',
      content: '主聊天已经有 handoff snapshot 了。',
      createdAt: '2026-05-07T09:20:03.000Z',
    },
    {
      role: 'user',
      content: '那就把工作区会话也补齐。',
      createdAt: '2026-05-07T09:20:08.000Z',
    },
  ])

  const promptSection = buildConversationHandoffPromptSection(snapshot)
  assert.match(promptSection, /最近对话/)
  assert.match(promptSection, /用户：那就把工作区会话也补齐/)
})

test('buildUserMessagePromptWithHandoff prepends snapshot history before the latest user message', () => {
  const snapshot = buildConversationHandoffSnapshot([
    {
      role: 'user',
      content: '先看为什么 resume 失效。',
      createdAt: '2026-05-07T09:30:00.000Z',
    },
    {
      role: 'assistant',
      content: '原因是 runtime scope 变了。',
      createdAt: '2026-05-07T09:30:03.000Z',
    },
  ])

  const prompt = buildUserMessagePromptWithHandoff('请在 Codex 里继续。', snapshot)
  assert.match(prompt, /最近对话/)
  assert.match(prompt, /助手：原因是 runtime scope 变了/)
  assert.match(prompt, /用户消息：请在 Codex 里继续。/)
})
