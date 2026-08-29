import assert from 'node:assert/strict'
import test from 'node:test'
import { buildFeishuExternalConversationId, enrichFeishuThreadContext } from './thread-context'

test('enriches an @ reply with the original reply chain and ordered group context', async () => {
  const listCalls: Array<{ containerId: string; containerIdType: string }> = []
  const messages = new Map([
    ['reply-1', {
      message_id: 'reply-1',
      parent_id: 'root-1',
      create_time: '2000',
      sender: { sender_type: 'user' },
      body: { content: JSON.stringify({ text: '请在 dev 分支处理。' }) },
    }],
    ['root-1', {
      message_id: 'root-1',
      create_time: '1000',
      sender: { sender_type: 'user' },
      body: { content: JSON.stringify({ text: 'vibemux 的飞书权限是怎样的？' }) },
    }],
  ])
  const result = await enrichFeishuThreadContext({
    chatId: 'oc_group',
    chatType: 'group',
    createTime: '3000',
    messageId: 'mention-1',
    parentId: 'reply-1',
    rootId: 'root-1',
    senderId: 'ou_user',
    text: '新建任务并看一下。',
  }, {
    getMessage: async (messageId) => {
      const message = messages.get(messageId)
      return message ? { ok: true as const, message } : { ok: false as const }
    },
    listMessages: async (params) => {
      listCalls.push(params)
      return {
        ok: true as const,
        messages: [
          messages.get('reply-1')!,
          { message_id: 'nearby-1', create_time: '1500', sender: { sender_type: 'user' }, body: { content: JSON.stringify({ text: '补充说明。' }) } },
          { message_id: 'mention-1', create_time: '3000', sender: { sender_type: 'user' }, body: { content: JSON.stringify({ text: '新建任务并看一下。' }) } },
        ],
      }
    },
  })

  assert.equal(result.externalConversationId, 'feishu:group:oc_group:thread:root-1')
  assert.equal(result.externalThreadId, 'root-1')
  assert.equal(result.replyInThread, false)
  assert.deepEqual(listCalls, [{
    containerId: 'oc_group',
    containerIdType: 'chat',
    endTime: 3,
    pageSize: 10,
  }])
  assert.ok(result.message.indexOf('补充说明。') < result.message.indexOf('vibemux 的飞书权限是怎样的？'))
  assert.ok(result.message.indexOf('vibemux 的飞书权限是怎样的？') < result.message.indexOf('请在 dev 分支处理。'))
  assert.ok(result.message.indexOf('请在 dev 分支处理。') < result.message.indexOf('[当前消息] 新建任务并看一下。'))
  assert.equal(result.message.match(/新建任务并看一下。/g)?.length, 1)
})

test('isolates a Feishu topic by thread ID and requests thread history', async () => {
  const calls: Array<{ containerId: string; containerIdType: string }> = []
  const input = {
    chatId: 'oc_group',
    chatType: 'group',
    messageId: 'mention-1',
    senderId: 'ou_user',
    text: '继续这个话题。',
    threadId: 'omt_topic',
  }
  const result = await enrichFeishuThreadContext(input, {
    getMessage: async () => ({ ok: false as const }),
    listMessages: async (params) => {
      calls.push(params)
      return { ok: true as const, messages: [] }
    },
  })

  assert.equal(buildFeishuExternalConversationId(input), 'feishu:group:oc_group:thread:omt_topic')
  assert.equal(result.externalThreadId, 'omt_topic')
  assert.equal(result.replyInThread, true)
  assert.deepEqual(calls, [{
    containerId: 'omt_topic',
    containerIdType: 'thread',
    endTime: undefined,
    pageSize: 30,
  }])
})
