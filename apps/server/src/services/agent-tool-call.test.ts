import assert from 'node:assert/strict'
import test from 'node:test'

import { buildToolCall } from './agent-tool-call'

test('buildToolCall keeps command args as a single-line preview', () => {
  const toolCall = buildToolCall({
    id: 'call-shell',
    tool: 'shell',
    state: {
      status: 'completed',
      raw: 'pnpm exec tsx --test apps/server/src/services/agent-tool-call.test.ts',
      output: 'line 1\nline 2\nline 3',
      time: { start: 1, end: 2 },
    },
  })

  assert.equal(toolCall.args, 'pnpm exec tsx --test apps/server/src/services/agent-tool-call.test.ts')
  assert.equal(toolCall.result, undefined)
})

test('buildToolCall extracts path and query details without storing large content', () => {
  const toolCall = buildToolCall({
    id: 'call-read',
    tool: 'read',
    state: {
      status: 'completed',
      input: {
        path: 'apps/web/src/routes/workspace.tsx',
        query: 'ToolCallRow',
        content: 'x'.repeat(1000),
      },
      output: 'ok',
    },
  })

  assert.equal(toolCall.args, 'path: apps/web/src/routes/workspace.tsx - query: ToolCallRow')
  assert.equal(toolCall.result, 'ok')
})

test('buildToolCall truncates error details but keeps useful failure text', () => {
  const toolCall = buildToolCall({
    id: 'call-fail',
    tool: 'shell',
    state: {
      status: 'error',
      raw: 'pnpm typecheck',
      error: `Type error\n${'x'.repeat(1000)}`,
    },
  })

  assert.equal(toolCall.args, 'pnpm typecheck')
  assert.match(toolCall.result ?? '', /^Type error x+/)
  assert.ok((toolCall.result ?? '').length <= 500)
})

test('buildToolCall preserves task creation result preview metadata', () => {
  const toolCall = buildToolCall({
    id: 'call-task-create',
    tool: 'task.create',
    state: {
      status: 'completed',
      input: {
        title: '切换工作区节点时保留 agent 原生会话续接',
      },
      output: JSON.stringify({
        ok: true,
        task: {
          id: 'task-created-1',
          title: '切换工作区节点时保留 agent 原生会话续接',
          status: 'todo',
          projectName: 'Vibemux',
        },
      }),
    },
  })

  assert.equal(toolCall.metadata?.resultPreviewKind, 'task_created')
  assert.equal(toolCall.metadata?.resultPreviewTaskId, 'task-created-1')
  assert.match(toolCall.result ?? '', /taskId=task-created-1/)
})
