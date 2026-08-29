// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
import assert from 'node:assert/strict'
import test from 'node:test'
import { parseWhatsappWebhookPayload, verifyWhatsappWebhook, sendWhatsappTextMessage } from './whatsapp-api'

test('parseWhatsappWebhookPayload 解析文本消息回调并忽略媒体/状态', () => {
  const messages = parseWhatsappWebhookPayload({
    entry: [{
      changes: [{
        value: {
          contacts: [{ profile: { name: 'Alice' } }],
          messages: [
            { from: '8613800000000', id: 'wamid-1', type: 'text', text: { body: '  你好  ' } },
            { from: '8613800000000', id: 'wamid-2', type: 'image' },
            { from: '8613800000000', id: 'wamid-3', type: 'text', text: { body: '  ' } },
          ],
        },
      }],
    }],
  })
  assert.equal(messages.length, 1)
  assert.deepEqual(messages[0], { from: '8613800000000', messageId: 'wamid-1', text: '你好', messageType: 'text', profileName: 'Alice' })
  assert.deepEqual(parseWhatsappWebhookPayload({ entry: [] }), [])
})

test('verifyWhatsappWebhook 校验 mode/verify_token 并返回 challenge', () => {
  const ok = verifyWhatsappWebhook({ verifyToken: 'vt-1', mode: 'subscribe', token: 'vt-1', challenge: 'ch-123' })
  assert.deepEqual(ok, { ok: true, challenge: 'ch-123' })
  assert.equal(verifyWhatsappWebhook({ verifyToken: 'vt-1', mode: 'unsubscribe', token: 'vt-1', challenge: 'x' }).ok, false)
  assert.equal(verifyWhatsappWebhook({ verifyToken: 'vt-1', mode: 'subscribe', token: 'wrong', challenge: 'x' }).ok, false)
  assert.equal(verifyWhatsappWebhook({ verifyToken: 'vt-1', mode: 'subscribe', token: 'vt-1' }).ok, false)
})

test('sendWhatsappTextMessage 走 Graph API 并带 Bearer 鉴权', async () => {
  const originalFetch = globalThis.fetch
  let captured: { url: string; init?: RequestInit } | undefined
  globalThis.fetch = async (input, init) => {
    captured = { url: String(input), init }
    return new Response(JSON.stringify({ messages: [{ id: 'wamid-out' }] }), { status: 200 })
  }

  try {
    const result = await sendWhatsappTextMessage({
      phoneNumberId: '123456789',
      accessToken: 'ea-token',
      to: '8613800000000',
      text: 'hi',
    })
    assert.equal(result.ok, true)
    assert.equal(captured?.url, 'https://graph.facebook.com/v21.0/123456789/messages')
    const headers = captured?.init?.headers as Record<string, string>
    assert.equal(headers.Authorization, 'Bearer ea-token')
    const body = JSON.parse(String(captured?.init?.body)) as { messaging_product: string; to: string; type: string; text: { body: string } }
    assert.deepEqual(body, { messaging_product: 'whatsapp', to: '8613800000000', type: 'text', text: { body: 'hi' } })
  } finally {
    globalThis.fetch = originalFetch
  }
})
