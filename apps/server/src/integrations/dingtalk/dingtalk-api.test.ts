// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
import assert from 'node:assert/strict'
import test from 'node:test'
import { parseDingtalkStreamEvent, parseDingtalkRobotMessage, sendDingtalkOtMessage } from './dingtalk-api'

const buildEvent = (data: string, topic = '/v1.0/im/bot/messages/get') => ({
  specVersion: '1.0',
  type: 'EVENT',
  headers: {
    appId: 'ding-app',
    connectionId: 'conn-1',
    contentType: 'application/json',
    messageId: 'msg-1',
    time: '1700000000000',
    topic,
    eventId: 'evt-1',
  },
  data,
})

test('parseDingtalkStreamEvent 解析 EVENT 并忽略非 EVENT', () => {
  const event = parseDingtalkStreamEvent(JSON.stringify(buildEvent('{}')))
  assert.equal(event?.headers.topic, '/v1.0/im/bot/messages/get')
  assert.equal(parseDingtalkStreamEvent(JSON.stringify({ type: 'PING' })), null)
  assert.equal(parseDingtalkStreamEvent('not-json'), null)
})

test('parseDingtalkRobotMessage 解析文本消息并忽略媒体/非机器人 topic', () => {
  const message = JSON.stringify({
    conversationId: 'cid-1',
    chatbotUserId: 'bot-1',
    msgId: 'mid-1',
    senderNick: '张三',
    senderStaffId: 'staff-1',
    msgtype: 'text',
    text: { content: '  你好  ' },
  })
  const parsed = parseDingtalkRobotMessage(buildEvent(message))
  assert.deepEqual(parsed && { text: parsed.text, staffId: parsed.message.senderStaffId }, { text: '你好', staffId: 'staff-1' })

  // 媒体消息无 text
  const imageMessage = JSON.stringify({ msgId: 'mid-2', senderStaffId: 'staff-1', msgtype: 'image' })
  assert.equal(parseDingtalkRobotMessage(buildEvent(imageMessage)), null)

  // 非机器人 topic
  assert.equal(parseDingtalkRobotMessage(buildEvent(message, '/v1.0/card/instances/callback')), null)
})

test('sendDingtalkOtMessage 走 oToMessages/batchSend 并带 token', async () => {
  const originalFetch = globalThis.fetch
  const calls: Array<{ url: string; init?: RequestInit }> = []
  globalThis.fetch = async (input, init) => {
    calls.push({ url: String(input), init })
    if (String(input).includes('/gettoken')) {
      return new Response(JSON.stringify({ errcode: 0, access_token: 'dt-token', expire_in: 7200 }), { status: 200 })
    }
    return new Response(JSON.stringify({ code: '0', message: 'ok' }), { status: 200 })
  }

  try {
    const result = await sendDingtalkOtMessage({
      appKey: 'ding-app',
      appSecret: 'secret',
      robotCode: 'ding-app',
      userIds: ['staff-1'],
      content: 'hi',
    })
    assert.equal(result.ok, true)
    const sendCall = calls.find((call) => call.url.includes('/robot/oToMessages/batchSend'))
    assert.ok(sendCall, 'send endpoint should be called')
    const headers = sendCall?.init?.headers as Record<string, string>
    assert.equal(headers['x-acs-dingtalk-access-token'], 'dt-token')
    const body = JSON.parse(String(sendCall?.init?.body)) as { robotCode: string; userIds: string[]; msgKey: string; msgParam: string }
    assert.deepEqual(body.userIds, ['staff-1'])
    assert.equal(body.msgKey, 'sampleText')
    assert.equal(JSON.parse(body.msgParam).content, 'hi')
  } finally {
    globalThis.fetch = originalFetch
  }
})
