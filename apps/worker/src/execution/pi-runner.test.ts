import assert from 'node:assert/strict'
import test from 'node:test'
import type { McpServerPolicy } from '@shared/mcp'
import { buildPiSessionToolNames, extractPiAssistantUsage, parsePiSkillPaths, repairPiAssistantMessageForToolCalls, repairPiAssistantStream, resolvePiMcpServers, resolvePiPromptOutput, waitForPiSessionSettled } from './pi-runner'

test('buildPiSessionToolNames keeps MCP tools enabled alongside built-in tools', () => {
  assert.deepEqual(
    buildPiSessionToolNames(['vibemux__project_list', 'vibemux__workspace_list', 'vibemux__project_list']),
    ['read', 'bash', 'edit', 'write', 'grep', 'find', 'ls', 'vibemux__project_list', 'vibemux__workspace_list'],
  )
})

test('resolvePiMcpServers falls back to the worker configuration only when a request has no MCP override', () => {
  const workerMcpServers = [{
    id: 'mcp-vibemux',
    name: 'vibemux',
    target: 'built-in://vibemux',
    transport: 'http',
    enabled: true,
    capabilityMode: 'resources+tools',
  }] satisfies McpServerPolicy[]

  assert.equal(resolvePiMcpServers(undefined, workerMcpServers), workerMcpServers)
  assert.deepEqual(resolvePiMcpServers([], workerMcpServers), [])
})

test('parsePiSkillPaths supports Windows delimiter and legacy newline lists', () => {
  assert.deepEqual(
    parsePiSkillPaths('C:\\skills\\one;D:\\skills\\two\nE:\\skills\\three', ';'),
    ['C:\\skills\\one', 'D:\\skills\\two', 'E:\\skills\\three'],
  )
})

test('resolvePiPromptOutput only returns assistant text produced in the current turn', () => {
  const messages = [
    {
      role: 'assistant',
      content: [{ type: 'text', text: '我是一个由 OpenAI 驱动的 AI 编程助手。' }],
    },
    {
      role: 'user',
      content: [{ type: 'text', text: '你现在在哪个目录？' }],
    },
  ]

  const output = resolvePiPromptOutput(messages, 1, {
    activeAssistantMessageId: 'pi:1',
    assistantCounter: 1,
    reasoningParts: new Map(),
    textParts: new Map(),
  })

  assert.equal(output, '')
})

test('resolvePiPromptOutput falls back to streamed text for the current turn', () => {
  const output = resolvePiPromptOutput([], 0, {
    activeAssistantMessageId: 'pi:2',
    assistantCounter: 2,
    reasoningParts: new Map(),
    textParts: new Map([
      [0, '当前目录是 /Users/x/work/Vibemux'],
    ]),
  })

  assert.equal(output, '当前目录是 /Users/x/work/Vibemux')
})

test('resolvePiPromptOutput uses the assistant message captured from current turn events', () => {
  const output = resolvePiPromptOutput([], 0, {
    activeAssistantMessageId: 'pi:3',
    assistantCounter: 3,
    latestAssistantMessage: {
      role: 'assistant',
      content: [{ type: 'text', text: '我是当前会话里的 Pi。' }],
    },
    reasoningParts: new Map(),
    textParts: new Map(),
  })

  assert.equal(output, '我是当前会话里的 Pi。')
})

test('resolvePiPromptOutput returns current-turn Pi error messages instead of empty output', () => {
  const output = resolvePiPromptOutput([
    {
      role: 'user',
      content: [{ type: 'text', text: '看看这是一个什么项目' }],
    },
    {
      role: 'assistant',
      content: [],
      stopReason: 'error',
      errorMessage: "400 Invalid 'input[6].call_id': empty string.",
    },
  ], 0, {
    activeAssistantMessageId: 'pi:4',
    assistantCounter: 4,
    reasoningParts: new Map(),
    textParts: new Map(),
  })

  assert.equal(output, "400 Invalid 'input[6].call_id': empty string.")
})

test('waitForPiSessionSettled waits for the sdk event queue to drain', async () => {
  let queueResolved = false
  let releaseQueue: (() => void) | undefined
  const queue = new Promise<void>((resolve) => {
    releaseQueue = () => {
      queueResolved = true
      resolve()
    }
  })

  let waitForIdleCalls = 0
  const settled = waitForPiSessionSettled({
    agent: {
      waitForIdle: async () => {
        waitForIdleCalls += 1
      },
    },
    _agentEventQueue: queue,
  })

  await Promise.resolve()

  assert.equal(waitForIdleCalls, 1)
  assert.equal(queueResolved, false)

  releaseQueue?.()
  await settled

  assert.equal(queueResolved, true)
})

test('waitForPiSessionSettled follows queue extensions scheduled during drain', async () => {
  let secondQueueResolved = false
  let releaseSecondQueue: (() => void) | undefined
  const secondQueue = new Promise<void>((resolve) => {
    releaseSecondQueue = () => {
      secondQueueResolved = true
      resolve()
    }
  })

  const session: {
    agent: { waitForIdle: () => Promise<void> }
    _agentEventQueue?: Promise<unknown>
  } = {
    agent: {
      waitForIdle: async () => undefined,
    },
  }

  session._agentEventQueue = Promise.resolve().then(() => {
    session._agentEventQueue = secondQueue
  })

  const settled = waitForPiSessionSettled(session)
  await Promise.resolve()
  assert.equal(secondQueueResolved, false)

  releaseSecondQueue?.()
  await settled

  assert.equal(secondQueueResolved, true)
})

test('repairPiAssistantMessageForToolCalls merges split Pi tool-call argument blocks', () => {
  const message = repairPiAssistantMessageForToolCalls({
    role: 'assistant',
    content: [
      { type: 'toolCall', id: 'call_ls', name: 'ls', arguments: {} },
      { type: 'toolCall', id: '', name: '', arguments: { path: '.', limit: 200 } },
      { type: 'text', text: 'done' },
    ],
  })

  assert.deepEqual(message.content, [
    { type: 'toolCall', id: 'call_ls', name: 'ls', arguments: { path: '.', limit: 200 } },
    { type: 'text', text: 'done' },
  ])
})

test('repairPiAssistantStream exposes repaired final messages before result is read', async () => {
  const events = [
    {
      type: 'start',
      partial: {
        role: 'assistant',
        content: [],
      },
    },
    {
      type: 'done',
      message: {
        role: 'assistant',
        content: [
          { type: 'toolCall', id: 'call_read', name: 'read', arguments: {} },
          { type: 'toolCall', id: '', name: '', arguments: { path: 'README.md' } },
        ],
      },
    },
  ]
  const finalMessage = {
    role: 'assistant',
    content: [
      { type: 'toolCall', id: 'call_read', name: 'read', arguments: {} },
      { type: 'toolCall', id: '', name: '', arguments: { path: 'README.md' } },
    ],
  }
  const source = {
    async *[Symbol.asyncIterator]() {
      for (const event of events) {
        yield event
      }
    },
    result: async () => finalMessage,
  }
  const stream = repairPiAssistantStream(source)
  const seen = []

  for await (const event of stream) {
    seen.push(event)
    if (event.type === 'done') {
      assert.deepEqual(await stream.result?.(), {
        role: 'assistant',
        content: [
          { type: 'toolCall', id: 'call_read', name: 'read', arguments: { path: 'README.md' } },
        ],
      })
    }
  }

  assert.equal(seen.length, 2)
})

test('extractPiAssistantUsage maps Pi SDK usage to ModelTokenUsage', () => {
  assert.deepEqual(
    extractPiAssistantUsage({
      role: 'assistant',
      usage: {
        input: 2100,
        output: 480,
        cacheRead: 300,
        cacheWrite: 60,
        totalTokens: 2580,
      },
    }),
    {
      inputTokens: 2100,
      outputTokens: 480,
      reasoningTokens: undefined,
      cacheReadTokens: 300,
      cacheWriteTokens: 60,
      // 优先采用 Pi SDK 官方 totalTokens。
      totalTokens: 2580,
    },
  )
})

test('extractPiAssistantUsage falls back to input + output and handles missing usage', () => {
  assert.deepEqual(
    extractPiAssistantUsage({ role: 'assistant', usage: { input: 100, output: 50 } }),
    {
      inputTokens: 100,
      outputTokens: 50,
      reasoningTokens: undefined,
      cacheReadTokens: undefined,
      cacheWriteTokens: undefined,
      totalTokens: 150,
    },
  )
  assert.equal(extractPiAssistantUsage(undefined), undefined)
  assert.equal(extractPiAssistantUsage({ role: 'user', content: 'hi' }), undefined)
})
