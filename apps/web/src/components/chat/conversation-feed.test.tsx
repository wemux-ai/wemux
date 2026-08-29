import assert from 'node:assert/strict'
import test from 'node:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { ConversationFeed, resolveConversationTurnLogFold } from './conversation-feed'
import type { ConversationTurn } from './conversation-types'

test('ConversationFeed renders a working assistant bubble for streaming replies without text yet', () => {
  const html = renderToStaticMarkup(
    <ConversationFeed
      turns={[
        {
          id: 'turn-1',
          isCurrent: true,
          user: {
            id: 'user-1',
            role: 'user',
            text: '在吗',
          },
          entries: [
            {
              kind: 'assistant',
              id: 'assistant-working',
              message: {
                id: 'assistant-working',
                role: 'assistant',
                text: '',
                streaming: true,
                agentRunningStatus: 'thinking',
                currentStep: 'Agent 系统正在分析需求...',
              },
            },
          ],
        },
      ]}
      isBusy
      assistantLabel="CEO Agent"
      assistantAvatarFallback="CA"
    />,
  )

  assert.match(html, /CEO Agent/)
  assert.match(html, /Agent 系统正在分析需求\.\.\./)
})

test('ConversationFeed keeps the working assistant bubble visible when the current assistant placeholder is empty', () => {
  const html = renderToStaticMarkup(
    <ConversationFeed
      turns={[
        {
          id: 'turn-1',
          isCurrent: true,
          user: {
            id: 'user-1',
            role: 'user',
            text: '在吗',
          },
          status: {
            status: 'thinking',
            step: 'Agent 系统正在分析需求...',
          },
          entries: [
            {
              kind: 'assistant',
              id: 'assistant-placeholder',
              message: {
                id: 'assistant-placeholder',
                role: 'assistant',
                text: '',
                agentRunningStatus: 'thinking',
              },
            },
          ],
        },
      ]}
      isBusy
      assistantLabel="CEO Agent"
      assistantAvatarFallback="CA"
    />,
  )

  assert.match(html, /CEO Agent/)
  assert.match(html, /Agent 系统正在分析需求\.\.\./)
})

test('resolveConversationTurnLogFold hides thinking and tool entries behind the assistant result', () => {
  const turn: ConversationTurn = {
    id: 'turn-log-fold-1',
    isCurrent: true,
    user: { id: 'user-1', role: 'user', text: '帮我改按钮' },
    entries: [
      { kind: 'thinking', id: 'thinking-1', content: '先定位文件' },
      {
        kind: 'tool',
        id: 'tool-1',
        tool: { id: 't1', name: 'read_file', args: '{}', startedAt: '2026-05-12T00:00:00.000Z' },
      },
      { kind: 'assistant', id: 'assistant-1', message: { id: 'm1', role: 'assistant', text: '改好了' } },
    ],
  }

  const fold = resolveConversationTurnLogFold({ turn, enabled: true })

  assert.equal(fold.collapsible, true)
  assert.equal(fold.hiddenEntries.length, 2)
  assert.deepEqual(fold.visibleEntries.map((entry) => entry.kind), ['assistant'])
})

test('resolveConversationTurnLogFold keeps pure conversation turns unfolded', () => {
  const turn: ConversationTurn = {
    id: 'turn-log-fold-2',
    isCurrent: false,
    user: { id: 'user-2', role: 'user', text: '你好' },
    entries: [
      { kind: 'assistant', id: 'assistant-2', message: { id: 'm2', role: 'assistant', text: '在的' } },
    ],
  }

  const fold = resolveConversationTurnLogFold({ turn, enabled: true })

  assert.equal(fold.collapsible, false)
  assert.equal(fold.visibleEntries.length, 1)
})

test('ConversationFeed with hideProcessBehindLog hides tool calls behind a log button', () => {
  const html = renderToStaticMarkup(
    <ConversationFeed
      hideProcessBehindLog
      turns={[
        {
          id: 'turn-log-1',
          isCurrent: false,
          user: { id: 'user-log-1', role: 'user', text: '帮我改按钮' },
          entries: [
            {
              kind: 'tool',
              id: 'tool-log-1',
              tool: { id: 't1', name: 'read_file', args: '{}', startedAt: '2026-05-12T00:00:00.000Z' },
            },
            {
              kind: 'assistant',
              id: 'assistant-log-1',
              message: { id: 'm1', role: 'assistant', text: '改好了。' },
            },
          ],
        },
      ]}
      isBusy={false}
      assistantLabel="CEO Agent"
      assistantAvatarFallback="CA"
    />,
  )

  assert.match(html, /改好了。/)
  assert.match(html, /View work log/)
  assert.doesNotMatch(html, /read_file/)
  assert.doesNotMatch(html, />Log</)
})

test('ConversationFeed renders turn token usage summary when usage is present', () => {
  const html = renderToStaticMarkup(
    <ConversationFeed
      turns={[
        {
          id: 'turn-usage-1',
          isCurrent: false,
          user: {
            id: 'user-usage-1',
            role: 'user',
            text: '统计一下这一轮花了多少 token',
          },
          status: {
            status: 'complete',
            step: '完成',
            startedAt: '2026-05-31T10:00:00.000Z',
            finishedAt: '2026-05-31T10:00:05.000Z',
          },
          usage: {
            inputTokens: 1200,
            outputTokens: 300,
            reasoningTokens: 90,
            cacheReadTokens: 800,
            totalTokens: 2390,
          },
          entries: [
            {
              kind: 'assistant',
              id: 'assistant-usage-1',
              message: {
                id: 'assistant-usage-message-1',
                role: 'assistant',
                text: '这一轮已经统计好了。',
              },
            },
          ],
        },
      ]}
      isBusy={false}
      assistantLabel="CEO Agent"
      assistantAvatarFallback="CA"
    />,
  )

  assert.match(html, /Token 2,390/)
  assert.match(html, /In 1,200/)
  assert.match(html, /Out 300/)
  assert.match(html, /Reason 90/)
  assert.match(html, /Cache Hit 800/)
})

test('ConversationFeed renders @文档 引用 chips (referencedDocs)', () => {
  const html = renderToStaticMarkup(
    <ConversationFeed
      turns={[
        {
          id: 'turn-doc-1',
          isCurrent: true,
          user: {
            id: 'user-doc-1',
            role: 'user',
            text: '看一下 @需求文档',
          },
          referencedDocs: [
            { id: 'drive-1', name: '需求文档.md', workspaceId: null },
            { id: 'drive-2', name: '设计稿.png', workspaceId: 'ws-1' },
          ],
          entries: [],
        },
      ]}
      isBusy={false}
      assistantLabel="CEO Agent"
      assistantAvatarFallback="CA"
    />,
  )

  assert.match(html, /需求文档\.md/)
  assert.match(html, /设计稿\.png/)
  assert.match(html, /References document/)
})
