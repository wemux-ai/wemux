import assert from 'node:assert/strict'
import test from 'node:test'

import { extractFeishuFeedbackIntent, extractDiscordFeedbackIntent } from './feedback-channel-intents'

test('飞书：私聊文本消息 → 反馈', () => {
  const result = extractFeishuFeedbackIntent({
    header: { event_type: 'im.message.receive_v1' },
    event: {
      message: { message_id: 'om_1', chat_id: 'oc_1', chat_type: 'p2p', content: '{"text":"Worker 经常连不上，怎么回事"}', sender: { id: 'ou_1' } },
    },
  })
  assert.ok(result)
  assert.equal(result?.source, 'feishu')
  assert.equal(result?.originRef.channel, 'oc_1')
  assert.equal(result?.originRef.messageId, 'om_1')
  assert.ok(result?.body.includes('Worker 经常连不上'))
})

test('飞书：群聊无反馈前缀 → null', () => {
  const result = extractFeishuFeedbackIntent({
    header: { event_type: 'im.message.receive_v1' },
    event: {
      message: { message_id: 'om_2', chat_id: 'oc_2', chat_type: 'group', content: '{"text":"今天天气不错"}', sender: { id: 'ou_2' } },
    },
  })
  assert.equal(result, null)
})

test('飞书：群聊带反馈前缀 → 收（前缀去掉）', () => {
  const result = extractFeishuFeedbackIntent({
    header: { event_type: 'im.message.receive_v1' },
    event: {
      message: { message_id: 'om_3', chat_id: 'oc_3', chat_type: 'group', content: '{"text":"反馈：希望加个日历视图"}', sender: { id: 'ou_3' } },
    },
  })
  assert.ok(result)
  assert.ok(result?.body.includes('希望加个日历视图'))
  assert.ok(!result?.body.startsWith('反馈'))
})

test('飞书：非消息事件 → null', () => {
  assert.equal(extractFeishuFeedbackIntent({ header: { event_type: 'app.open' } }), null)
})

test('Discord：/feedback 命令 → 反馈', () => {
  const result = extractDiscordFeedbackIntent({
    type: 2,
    id: 'interaction_1',
    token: 'tok_1',
    member: { user: { username: 'testuser' } },
    data: { name: 'feedback', options: [
      { name: 'title', value: '日历视图' },
      { name: 'body', value: '希望加一个日历视图，方便排期' },
      { name: 'type', value: 'feature' },
    ]},
  })
  assert.ok(result)
  assert.equal(result?.source, 'discord')
  assert.equal(result?.originRef.senderName, 'testuser')
  assert.equal(result?.type, 'feature')
  assert.equal(result?.title, '日历视图')
})

test('Discord：非命令事件 → null', () => {
  assert.equal(extractDiscordFeedbackIntent({ type: 1 }), null)
})

test('Discord：/feedback 缺 body → null', () => {
  assert.equal(extractDiscordFeedbackIntent({ type: 2, data: { name: 'feedback', options: [] } }), null)
})