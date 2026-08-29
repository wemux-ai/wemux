// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
import assert from 'node:assert/strict'
import test from 'node:test'
import { parseSlackEventEnvelope, sendSlackMessage } from './slack-api'

test('parseSlackEventEnvelope 解析 events_api 消息并忽略 bot/编辑', () => {
  const event = parseSlackEventEnvelope({
    type: 'events_api',
    payload: {
      event: {
        type: 'message',
        channel: 'C123',
        user: 'U456',
        text: '  你好  ',
        ts: '1700000000.000001',
      },
    },
  })
  assert.deepEqual(event && { channelId: event.channelId, userId: event.userId, text: event.text, ts: event.ts }, {
    channelId: 'C123',
    userId: 'U456',
    text: '你好',
    ts: '1700000000.000001',
  })

  // bot 消息
  assert.equal(parseSlackEventEnvelope({
    type: 'events_api',
    payload: { event: { type: 'message', channel: 'C1', text: 'x', bot_id: 'B1' } },
  }), null)

  // 编辑/删除子类型
  assert.equal(parseSlackEventEnvelope({
    type: 'events_api',
    payload: { event: { type: 'message', subtype: 'message_changed', channel: 'C1', text: 'x' } },
  }), null)

  // 非 events_api
  assert.equal(parseSlackEventEnvelope({ type: 'hello' }), null)
})

test('sendSlackMessage 走 chat.postMessage 并带 Bearer 鉴权', async () => {
  const originalFetch = globalThis.fetch
  let captured: { url: string; init?: RequestInit } | undefined
  globalThis.fetch = async (input, init) => {
    captured = { url: String(input), init }
    return new Response(JSON.stringify({ ok: true, ts: '1.2' }), { status: 200 })
  }

  try {
    const result = await sendSlackMessage({ botToken: 'xoxb-token', channelId: 'C1', text: 'hi', threadTs: '1.0' })
    assert.equal(result.ok, true)
    assert.equal(captured?.url, 'https://slack.com/api/chat.postMessage')
    const headers = captured?.init?.headers as Record<string, string>
    assert.equal(headers.Authorization, 'Bearer xoxb-token')
    const body = JSON.parse(String(captured?.init?.body)) as { channel: string; text: string; thread_ts: string }
    assert.deepEqual(body, { channel: 'C1', text: 'hi', thread_ts: '1.0' })
  } finally {
    globalThis.fetch = originalFetch
  }
})
