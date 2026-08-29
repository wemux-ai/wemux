import assert from 'node:assert/strict'
import test from 'node:test'
import { resolveBrainGroupChatDispatch } from './dispatch-brain'

const agents = [
  { id: 'agent-frontend', name: '前端小强', role: '前端开发' },
  { id: 'agent-backend', name: '后端老王', role: '后端开发 / 数据库' },
]

test('task_request 且目标可见 → implicitAgentIds 命中', async () => {
  const result = await resolveBrainGroupChatDispatch({
    message: '修一下后端接口超时',
    availableAgents: agents,
    orchestratorAgentId: 'agent-backend',
    enabled: true,
  })
  assert.equal(result.implicitAgentIds.length, 1)
  assert.equal(result.implicitAgentIds[0], 'agent-backend')
  assert.equal(result.directReply, undefined)
})

test('模型 question → directReply 文案', async () => {
  const originalKey = process.env.DEEPSEEK_API_KEY
  process.env.DEEPSEEK_API_KEY = 'test-key'
  try {
    const fetchImpl = (async () => new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({
        intent: 'question',
        targetAgentId: null,
        confidence: 0.9,
        reason: '纯提问',
        reply: '先查一下日志。',
      }) } }],
    }), { status: 200 })) as typeof fetch
    const result = await resolveBrainGroupChatDispatch({
      message: '这是怎么回事？',
      availableAgents: agents,
      enabled: true,
      fetchImpl,
    })
    assert.equal(result.implicitAgentIds.length, 0)
    assert.ok(result.directReply)
    assert.equal(result.directReply, '先查一下日志。')
  } finally {
    if (originalKey === undefined) {
      delete process.env.DEEPSEEK_API_KEY
    } else {
      process.env.DEEPSEEK_API_KEY = originalKey
    }
  }
})

test('聊天类消息 → 不产生任何分发', async () => {
  const result = await resolveBrainGroupChatDispatch({
    message: '好的，谢谢',
    availableAgents: agents,
    enabled: true,
  })
  assert.equal(result.implicitAgentIds.length, 0)
  assert.equal(result.directReply, undefined)
  assert.equal(result.decision.action.kind, 'none')
})

test('模型目标不在群内 → 不产生隐式分发（绝不路由到群外）', async () => {
  const originalKey = process.env.DEEPSEEK_API_KEY
  process.env.DEEPSEEK_API_KEY = 'test-key'
  try {
    const fetchImpl = (async () => new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({
        intent: 'task_request',
        targetAgentId: 'agent-ghost',
        confidence: 0.9,
        reason: 'x',
        reply: null,
      }) } }],
    }), { status: 200 })) as typeof fetch
    const result = await resolveBrainGroupChatDispatch({
      message: '帮我处理一下',
      availableAgents: agents,
      enabled: true,
      fetchImpl,
    })
    assert.equal(result.implicitAgentIds.length, 0)
  } finally {
    if (originalKey === undefined) {
      delete process.env.DEEPSEEK_API_KEY
    } else {
      process.env.DEEPSEEK_API_KEY = originalKey
    }
  }
})
