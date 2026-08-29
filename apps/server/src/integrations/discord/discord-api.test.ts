// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
import assert from 'node:assert/strict'
import test from 'node:test'
import { extractDiscordClientId, buildDiscordInviteUrl, parseDiscordMessageCreate, sendDiscordMessage } from './discord-api'

test('extractDiscordClientId 从 bot token 解出 client id', () => {
  const token = `${Buffer.from('123456789012345678', 'utf8').toString('base64url')}.abc.def`
  assert.equal(extractDiscordClientId(token), '123456789012345678')
  assert.equal(extractDiscordClientId('garbage'), '')
})

test('buildDiscordInviteUrl 生成 OAuth 一键邀请链接', () => {
  const token = `${Buffer.from('123456789012345678', 'utf8').toString('base64url')}.abc.def`
  const url = buildDiscordInviteUrl(token, 'guild-1')
  assert.ok(url.startsWith('https://discord.com/oauth2/authorize?'))
  assert.ok(url.includes('client_id=123456789012345678'))
  assert.ok(url.includes('guild_id=guild-1'))
  assert.ok(url.includes('scope=bot'))
  assert.equal(buildDiscordInviteUrl('bad'), '')
})

test('parseDiscordMessageCreate 解析 DM/频道消息并忽略 bot', () => {
  const dm = parseDiscordMessageCreate({
    id: 'm1',
    channel_id: 'ch-1',
    author: { id: 'u1', username: 'alice' },
    content: '  你好  ',
  })
  assert.deepEqual(dm && { channelId: dm.channelId, authorId: dm.authorId, text: dm.text, isDm: dm.isDm }, {
    channelId: 'ch-1',
    authorId: 'u1',
    text: '你好',
    isDm: true,
  })

  const guild = parseDiscordMessageCreate({
    id: 'm2',
    channel_id: 'ch-2',
    guild_id: 'g-1',
    author: { id: 'u2', username: 'bob', bot: true },
    content: 'bot msg',
  })
  assert.equal(guild, null)

  assert.equal(parseDiscordMessageCreate({ id: 'm3', channel_id: 'ch', content: '   ' }), null)
  assert.equal(parseDiscordMessageCreate({}), null)
})

test('sendDiscordMessage 走 REST 并带 Bot 鉴权', async () => {
  const originalFetch = globalThis.fetch
  let captured: { url: string; init?: RequestInit } | undefined
  globalThis.fetch = async (input, init) => {
    captured = { url: String(input), init }
    return new Response(JSON.stringify({ id: 'msg-1' }), { status: 200 })
  }

  try {
    const result = await sendDiscordMessage({ botToken: 'bot-token', channelId: 'ch-1', content: 'hi' })
    assert.equal(result.ok, true)
    assert.equal(captured?.url, 'https://discord.com/api/v10/channels/ch-1/messages')
    const headers = captured?.init?.headers as Record<string, string>
    assert.equal(headers.Authorization, 'Bot bot-token')
    const body = JSON.parse(String(captured?.init?.body)) as { content: string }
    assert.equal(body.content, 'hi')
  } finally {
    globalThis.fetch = originalFetch
  }
})
