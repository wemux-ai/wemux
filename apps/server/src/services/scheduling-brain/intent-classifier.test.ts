import assert from 'node:assert/strict'
import test from 'node:test'
import { classifyWorkspaceMessageIntent } from './intent-classifier'

const agents = [
  { id: 'agent-frontend', name: '前端小强', role: '前端开发' },
  { id: 'agent-backend', name: '后端老王', role: '后端开发 / 数据库' },
]

const withEnv = async (env: Record<string, string | undefined>, run: () => Promise<void>) => {
  const previous = new Map<string, string | undefined>()
  for (const [key, value] of Object.entries(env)) {
    previous.set(key, process.env[key])
    if (value === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = value
    }
  }
  try {
    await run()
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) {
        delete process.env[key]
      } else {
        process.env[key] = value
      }
    }
  }
}

test('开关关闭 → disabled 决策，不调用模型', async () => {
  let fetchCalled = false
  const decision = await classifyWorkspaceMessageIntent({
    message: '修一下登录页 bug',
    agents,
    enabled: false,
    fetchImpl: (async () => {
      fetchCalled = true
      return new Response('{}', { status: 200 })
    }) as typeof fetch,
  })
  assert.equal(decision.source, 'disabled')
  assert.equal(decision.action.kind, 'none')
  assert.equal(fetchCalled, false)
})

test('无 DEEPSEEK_API_KEY → 规则模式仍能分发 task_request', async () => {
  await withEnv({ DEEPSEEK_API_KEY: undefined }, async () => {
    const decision = await classifyWorkspaceMessageIntent({
      message: '修一下后端接口超时',
      agents,
      enabled: true,
      orchestratorAgentId: 'agent-backend',
    })
    assert.equal(decision.source, 'rules')
    assert.equal(decision.intent, 'task_request')
    assert.equal(decision.action.kind, 'run_agent')
    if (decision.action.kind === 'run_agent') {
      assert.equal(decision.action.targetAgentId, 'agent-backend')
    }
  })
})

test('模型成功 → 结构化决策', async () => {
  await withEnv({ DEEPSEEK_API_KEY: 'test-key' }, async () => {
    const fetchImpl = (async () => new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({
        intent: 'task_request',
        targetAgentId: 'agent-frontend',
        confidence: 0.9,
        reason: '前端任务',
        reply: null,
      }) } }],
    }), { status: 200 })) as typeof fetch
    const decision = await classifyWorkspaceMessageIntent({
      message: '改一下前端样式',
      agents,
      enabled: true,
      fetchImpl,
    })
    assert.equal(decision.source, 'model')
    assert.equal(decision.intent, 'task_request')
    assert.equal(decision.action.kind, 'run_agent')
    if (decision.action.kind === 'run_agent') {
      assert.equal(decision.action.targetAgentId, 'agent-frontend')
    }
    assert.equal(decision.model, 'deepseek-chat')
  })
})

test('模型返回群外 Agent → 视为非法，回落规则', async () => {
  await withEnv({ DEEPSEEK_API_KEY: 'test-key' }, async () => {
    const fetchImpl = (async () => new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({
        intent: 'task_request',
        targetAgentId: 'agent-evil-outside',
        confidence: 0.9,
        reason: 'hack',
        reply: null,
      }) } }],
    }), { status: 200 })) as typeof fetch
    const decision = await classifyWorkspaceMessageIntent({
      message: '修一下前端样式',
      agents,
      enabled: true,
      fetchImpl,
    })
    assert.equal(decision.source, 'rules')
    assert.equal(decision.action.kind, 'run_agent')
  })
})

test('模型输出非 JSON → 规则兜底', async () => {
  await withEnv({ DEEPSEEK_API_KEY: 'test-key' }, async () => {
    const fetchImpl = (async () => new Response(JSON.stringify({
      choices: [{ message: { content: '好的，我明白了' } }],
    }), { status: 200 })) as typeof fetch
    const decision = await classifyWorkspaceMessageIntent({
      message: '部署一下',
      agents,
      enabled: true,
      fetchImpl,
    })
    assert.equal(decision.source, 'rules')
    assert.equal(decision.intent, 'task_request')
  })
})

test('模型 HTTP 失败 → 规则兜底', async () => {
  await withEnv({ DEEPSEEK_API_KEY: 'test-key' }, async () => {
    const fetchImpl = (async () => new Response('{"error":{"message":"rate limit"}}', { status: 429 })) as typeof fetch
    const decision = await classifyWorkspaceMessageIntent({
      message: '部署一下',
      agents,
      enabled: true,
      fetchImpl,
    })
    assert.equal(decision.source, 'rules')
    assert.equal(decision.intent, 'task_request')
  })
})

test('模型超时 → 规则兜底', async () => {
  await withEnv({ DEEPSEEK_API_KEY: 'test-key' }, async () => {
    const fetchImpl = (async () => {
      await new Promise((resolve) => setTimeout(resolve, 200))
      return new Response('{}', { status: 200 })
    }) as typeof fetch
    const decision = await classifyWorkspaceMessageIntent({
      message: '部署一下',
      agents,
      enabled: true,
      fetchImpl,
      timeoutMs: 20,
    })
    assert.equal(decision.source, 'rules')
  })
})

test('模型 question → direct_reply 直答', async () => {
  await withEnv({ DEEPSEEK_API_KEY: 'test-key' }, async () => {
    const fetchImpl = (async () => new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({
        intent: 'question',
        targetAgentId: null,
        confidence: 0.95,
        reason: '纯提问',
        reply: '这个接口慢一般是数据库查询没加索引导致的。',
      }) } }],
    }), { status: 200 })) as typeof fetch
    const decision = await classifyWorkspaceMessageIntent({
      message: '接口为什么慢？',
      agents,
      enabled: true,
      fetchImpl,
    })
    assert.equal(decision.source, 'model')
    assert.equal(decision.action.kind, 'direct_reply')
    if (decision.action.kind === 'direct_reply') {
      assert.ok(decision.action.reply.length > 0)
    }
  })
})
