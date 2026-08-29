import assert from 'node:assert/strict'
import test from 'node:test'
import {
  addFeishuMessageReaction,
  deleteFeishuMessageReaction,
  getFeishuAppContextMessage,
  getFeishuBotOpenId,
  listFeishuAppContextMessages,
  patchFeishuAppInteractiveCard,
  replyFeishuAppInteractiveCard,
  replyFeishuAppTextMessage,
} from './index'
import { buildFeishuReplyCard } from './reply-card'

test('replies to the original Feishu message and adds the working reaction', async () => {
  const originalFetch = globalThis.fetch
  const requests: Array<{ url: string; body: Record<string, unknown> }> = []
  globalThis.fetch = async (input, init) => {
    const url = String(input)
    if (url.includes('/auth/v3/app_access_token/internal')) {
      return new Response(JSON.stringify({ app_access_token: 'token' }), { status: 200 })
    }

    requests.push({
      url,
      body: JSON.parse(String(init?.body)) as Record<string, unknown>,
    })
    return new Response(JSON.stringify({ code: 0, data: { message_id: 'om_reply' } }), { status: 200 })
  }

  try {
    const config = { appId: 'cli_test', appSecret: 'secret' }
    const reaction = await addFeishuMessageReaction(config, { messageId: 'om_source', emojiType: 'Typing' })
    const reply = await replyFeishuAppTextMessage(config, { messageId: 'om_source', text: '正在处理。' })

    assert.equal(reaction.ok, true)
    assert.equal(reply.ok, true)
    assert.deepEqual(requests, [
      {
        url: 'https://open.feishu.cn/open-apis/im/v1/messages/om_source/reactions',
        body: { reaction_type: { emoji_type: 'Typing' } },
      },
      {
        url: 'https://open.feishu.cn/open-apis/im/v1/messages/om_source/reply',
        body: { msg_type: 'text', content: JSON.stringify({ text: '正在处理。' }) },
      },
    ])
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('resolves and caches the Feishu bot open ID', async () => {
  const originalFetch = globalThis.fetch
  const requests: string[] = []
  globalThis.fetch = async (input) => {
    const url = String(input)
    requests.push(url)
    if (url.includes('/auth/v3/app_access_token/internal')) {
      return new Response(JSON.stringify({ app_access_token: 'token' }), { status: 200 })
    }

    return new Response(JSON.stringify({ code: 0, bot: { open_id: 'ou_bot' } }), { status: 200 })
  }

  try {
    const config = { appId: 'cli_bot_info_test', appSecret: 'secret' }
    const first = await getFeishuBotOpenId(config)
    const second = await getFeishuBotOpenId(config)

    assert.deepEqual(first, { ok: true, openId: 'ou_bot' })
    assert.deepEqual(second, { ok: true, openId: 'ou_bot' })
    assert.deepEqual(requests, [
      'https://open.feishu.cn/open-apis/auth/v3/app_access_token/internal',
      'https://open.feishu.cn/open-apis/bot/v3/info',
    ])
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('returns the working reaction ID and deletes it after processing', async () => {
  const originalFetch = globalThis.fetch
  const requests: Array<{ url: string; method: string; body?: Record<string, unknown> }> = []
  globalThis.fetch = async (input, init) => {
    const url = String(input)
    if (url.includes('/auth/v3/app_access_token/internal')) {
      return new Response(JSON.stringify({ app_access_token: 'token' }), { status: 200 })
    }

    requests.push({
      url,
      method: String(init?.method),
      body: init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : undefined,
    })
    const payload = init?.method === 'POST'
      ? { code: 0, data: { reaction_id: 're_working' } }
      : { code: 0 }
    return new Response(JSON.stringify(payload), { status: 200 })
  }

  try {
    const config = { appId: 'cli_reaction_test', appSecret: 'secret' }
    const reaction = await addFeishuMessageReaction(config, { messageId: 'om_source', emojiType: 'Typing' })
    assert.equal(reaction.ok, true)
    assert.equal(reaction.reactionId, 're_working')

    const removed = await deleteFeishuMessageReaction(config, {
      messageId: 'om_source',
      reactionId: reaction.reactionId || '',
    })
    assert.equal(removed.ok, true)
    assert.deepEqual(requests, [
      {
        url: 'https://open.feishu.cn/open-apis/im/v1/messages/om_source/reactions',
        method: 'POST',
        body: { reaction_type: { emoji_type: 'Typing' } },
      },
      {
        url: 'https://open.feishu.cn/open-apis/im/v1/messages/om_source/reactions/re_working',
        method: 'DELETE',
        body: undefined,
      },
    ])
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('reads a parent message and bounded thread history for inbound context', async () => {
  const originalFetch = globalThis.fetch
  const requests: Array<{ url: string; method: string }> = []
  globalThis.fetch = async (input, init) => {
    const url = String(input)
    if (url.includes('/auth/v3/app_access_token/internal')) {
      return new Response(JSON.stringify({ app_access_token: 'token' }), { status: 200 })
    }

    requests.push({ url, method: String(init?.method || 'GET') })
    return new Response(JSON.stringify({
      code: 0,
      data: {
        items: [{
          message_id: 'om_parent',
          msg_type: 'text',
          body: { content: JSON.stringify({ text: '原问题' }) },
        }],
      },
    }), { status: 200 })
  }

  try {
    const config = { appId: 'cli_context_test', appSecret: 'secret' }
    const parent = await getFeishuAppContextMessage(config, 'om_parent')
    const thread = await listFeishuAppContextMessages(config, {
      containerId: 'omt_topic',
      containerIdType: 'thread',
      endTime: 123,
      pageSize: 99,
    })

    assert.equal(parent.ok, true)
    assert.equal(parent.message.body?.content, JSON.stringify({ text: '原问题' }))
    assert.equal(thread.ok, true)
    assert.equal(thread.messages.length, 1)
    assert.deepEqual(requests, [
      {
        url: 'https://open.feishu.cn/open-apis/im/v1/messages/om_parent?user_id_type=open_id',
        method: 'GET',
      },
      {
        url: 'https://open.feishu.cn/open-apis/im/v1/messages?container_id_type=thread&container_id=omt_topic&sort_type=ByCreateTimeDesc&page_size=50&user_id_type=open_id&end_time=123',
        method: 'GET',
      },
    ])
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('replies with an updatable card and patches the same Feishu message', async () => {
  const originalFetch = globalThis.fetch
  const requests: Array<{ url: string; method: string; body: Record<string, unknown> }> = []
  globalThis.fetch = async (input, init) => {
    const url = String(input)
    if (url.includes('/auth/v3/app_access_token/internal')) {
      return new Response(JSON.stringify({ app_access_token: 'token' }), { status: 200 })
    }

    requests.push({
      url,
      method: String(init?.method),
      body: JSON.parse(String(init?.body)) as Record<string, unknown>,
    })
    return new Response(JSON.stringify({ code: 0, data: { message_id: 'om_card' } }), { status: 200 })
  }

  try {
    const config = { appId: 'cli_card_test', appSecret: 'secret' }
    const initial = buildFeishuReplyCard({ status: 'thinking' })
    const final = buildFeishuReplyCard({ status: 'complete', content: '处理完成。' })
    const reply = await replyFeishuAppInteractiveCard(config, { messageId: 'om_source', card: initial, replyInThread: true })
    const update = await patchFeishuAppInteractiveCard(config, { messageId: 'om_card', card: final })

    assert.equal(reply.ok, true)
    assert.equal(reply.messageId, 'om_card')
    assert.equal(update.ok, true)
    assert.deepEqual(requests, [
      {
        url: 'https://open.feishu.cn/open-apis/im/v1/messages/om_source/reply',
        method: 'POST',
        body: { msg_type: 'interactive', content: JSON.stringify(initial), reply_in_thread: true },
      },
      {
        url: 'https://open.feishu.cn/open-apis/im/v1/messages/om_card',
        method: 'PATCH',
        body: { content: JSON.stringify(final) },
      },
    ])
    assert.deepEqual(initial.config, { wide_screen_mode: true, update_multi: true })
    assert.deepEqual(final.config, { wide_screen_mode: true, update_multi: true })
  } finally {
    globalThis.fetch = originalFetch
  }
})
