import assert from 'node:assert/strict'
import test from 'node:test'
import { getImportableExecutorAgentSessionEntries, isExecutorAgentSessionBoilerplatePrompt } from './executor-agent-session'

test('isExecutorAgentSessionBoilerplatePrompt matches the injected AGENTS boilerplate', () => {
  assert.equal(
    isExecutorAgentSessionBoilerplatePrompt(`AGENTS.md instructions for /Users/x/work/Vibemux

<INSTRUCTIONS>
# AGENTS.md - Vibemux 项目开发指南`),
    true,
  )
  assert.equal(isExecutorAgentSessionBoilerplatePrompt('先看一下这个 workspace 的结构'), false)
})

test('getImportableExecutorAgentSessionEntries keeps real turns and removes boilerplate or non-chat entries', () => {
  const entries = [
    {
      id: 'entry-1',
      role: 'user' as const,
      text: 'AGENTS.md instructions for /Users/x/work/Vibemux\n<environment_context>',
    },
    {
      id: 'entry-2',
      role: 'assistant' as const,
      text: '我先看一下代码结构。',
    },
    {
      id: 'entry-3',
      role: 'tool' as const,
      text: '调用工具：rg',
    },
    {
      id: 'entry-4',
      role: 'user' as const,
      text: '现在这个导入会话第一句太乱了，帮我处理一下。',
    },
  ]

  assert.deepEqual(
    getImportableExecutorAgentSessionEntries(entries).map((entry) => entry.id),
    ['entry-2', 'entry-4'],
  )
})
