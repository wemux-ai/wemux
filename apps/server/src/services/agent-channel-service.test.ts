// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
import assert from 'node:assert/strict'
import test from 'node:test'
import { sendWechatWithAttachments } from './agent-channel-service'

test('sendWechatWithAttachments 图片附件走 CDN 上传发送 + 文本兜底', async () => {
  const originalFetch = globalThis.fetch
  const calls: Array<{ url: string; init?: RequestInit }> = []
  globalThis.fetch = async (input, init) => {
    calls.push({ url: String(input), init })
    const url = String(input)
    if (url.startsWith('/api/attachments')) {
      // 附件下载（相对 URL）
      return new Response(new Uint8Array(Buffer.from('png-bytes')), { status: 200 })
    }
    if (url.includes('/ilink/bot/getuploadurl')) {
      return new Response(JSON.stringify({ ret: 0, upload_full_url: 'https://cdn.example/upload' }), { status: 200 })
    }
    if (url.includes('cdn.example')) {
      return new Response('ok', { status: 200, headers: { 'x-encrypted-param': 'dl-param' } })
    }
    return new Response(JSON.stringify({ ret: 0, message_id: 9 }), { status: 200 })
  }

  try {
    const result = await sendWechatWithAttachments({
      baseUrl: 'https://ilinkai.weixin.qq.com',
      token: 'bot-token',
      toUserId: 'wx-peer',
      message: '图片来了',
      attachments: [{
        id: 'att-1',
        url: '/api/attachments/1.png',
        filename: '1.png',
        contentType: 'image/png',
      }],
    })
    assert.equal(result.ok, true)
    const sendCalls = calls.filter((call) => call.url.includes('/ilink/bot/sendmessage'))
    // 图片消息 + 文本消息两次 sendmessage
    assert.equal(sendCalls.length, 2)
    const imageBody = JSON.parse(String(sendCalls[0].init?.body)) as { msg: { item_list: Array<{ type: number }> } }
    const textBody = JSON.parse(String(sendCalls[1].init?.body)) as { msg: { item_list: Array<{ type: number; text_item: { text: string } }> } }
    assert.equal(imageBody.msg.item_list[0].type, 2)
    assert.equal(textBody.msg.item_list[0].text_item.text, '图片来了')
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('sendWechatWithAttachments 附件下载失败时明确报错', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => new Response('not found', { status: 404 })

  try {
    const result = await sendWechatWithAttachments({
      baseUrl: 'https://ilinkai.weixin.qq.com',
      token: 'bot-token',
      toUserId: 'wx-peer',
      message: 'x',
      attachments: [{ id: 'a', url: '/api/attachments/x.png', filename: 'x.png' }],
    })
    assert.equal(result.ok, false)
    assert.match(result.message || '', /附件下载失败/)
  } finally {
    globalThis.fetch = originalFetch
  }
})
