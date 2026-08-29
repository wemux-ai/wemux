// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
import assert from 'node:assert/strict'
import test from 'node:test'
import {
  extractWeixinText,
  extractWeixinVoiceText,
  hasWeixinVoiceTranscription,
  fetchWeixinQrCode,
  getWeixinUpdates,
  pollWeixinQrStatus,
  sendWeixinMessage,
  summarizeWeixinMedia,
  encryptAesEcb,
  aesEcbPaddedSize,
  uploadWeixinMediaToCdn,
  sendWeixinImageMessage,
  ILINK_DEFAULT_BASE_URL,
  type WeixinMessage,
} from './ilink-api'
import { createDecipheriv } from 'node:crypto'

test('fetchWeixinQrCode 请求 iLink 网关并解析二维码', async () => {
  const originalFetch = globalThis.fetch
  const requests: Array<{ url: string; init?: RequestInit }> = []
  globalThis.fetch = async (input, init) => {
    requests.push({ url: String(input), init })
    return new Response(JSON.stringify({ qrcode: 'qr-code-token', qrcode_img_content: 'https://weixin.qq.com/qr' }), { status: 200 })
  }

  try {
    const result = await fetchWeixinQrCode({})
    assert.equal(result.qrcode, 'qr-code-token')
    assert.equal(result.qrcode_img_content, 'https://weixin.qq.com/qr')
    assert.equal(requests.length, 1)
    assert.ok(requests[0].url.startsWith(`${ILINK_DEFAULT_BASE_URL}/ilink/bot/get_bot_qrcode?bot_type=3`), requests[0].url)
    const body = JSON.parse(String(requests[0].init?.body)) as { local_token_list: string[] }
    assert.deepEqual(body.local_token_list, [])
    const headers = requests[0].init?.headers as Record<string, string>
    assert.equal(headers.AuthorizationType, 'ilink_bot_token')
    assert.equal(headers['iLink-App-Id'], 'bot')
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('getWeixinUpdates 携带游标、token 与 base_info', async () => {
  const originalFetch = globalThis.fetch
  let capturedBody: Record<string, unknown> | undefined
  let capturedAuth: string | undefined
  globalThis.fetch = async (input, init) => {
    capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>
    const headers = init?.headers as Record<string, string>
    capturedAuth = headers.Authorization
    return new Response(JSON.stringify({
      ret: 0,
      get_updates_buf: 'cursor-2',
      longpolling_timeout_ms: 35000,
      msgs: [{ message_id: 1, message_type: 1, from_user_id: 'wx-user', item_list: [{ type: 1, text_item: { text: '你好' } }] }],
    }), { status: 200 })
  }

  try {
    const result = await getWeixinUpdates({ baseUrl: ILINK_DEFAULT_BASE_URL, token: 'bot-token', cursor: 'cursor-1' })
    assert.equal(result.ret, 0)
    assert.equal(result.get_updates_buf, 'cursor-2')
    assert.equal(capturedBody?.get_updates_buf, 'cursor-1')
    assert.equal(typeof capturedBody?.channel_version, 'string')
    assert.equal(typeof capturedBody?.bot_agent, 'string')
    assert.equal(capturedAuth, 'Bearer bot-token')
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('pollWeixinQrStatus 网络异常时返回 wait（可继续轮询）', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => {
    throw new Error('fetch failed')
  }

  try {
    const result = await pollWeixinQrStatus({ qrcode: 'qr' })
    assert.equal(result.status, 'wait')
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('pollWeixinQrStatus 解析扫码状态与重定向主机', async () => {
  const originalFetch = globalThis.fetch
  const responses = [
    JSON.stringify({ status: 'scaned_but_redirect', redirect_host: 'idc2.ilinkai.weixin.qq.com' }),
    JSON.stringify({ status: 'confirmed', bot_token: 'bt', ilink_bot_id: 'bid', ilink_user_id: 'wx-u', baseurl: 'https://ilinkai.weixin.qq.com' }),
  ]
  globalThis.fetch = async () => new Response(responses.shift() ?? '{}', { status: 200 })

  try {
    const redirect = await pollWeixinQrStatus({ qrcode: 'qr' })
    assert.equal(redirect.status, 'scaned_but_redirect')
    assert.equal(redirect.redirect_host, 'idc2.ilinkai.weixin.qq.com')
    const confirmed = await pollWeixinQrStatus({ qrcode: 'qr' })
    assert.equal(confirmed.status, 'confirmed')
    assert.equal(confirmed.bot_token, 'bt')
    assert.equal(confirmed.baseurl, 'https://ilinkai.weixin.qq.com')
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('sendWeixinMessage 发送文本并原样回传 context_token', async () => {
  const originalFetch = globalThis.fetch
  let capturedBody: Record<string, unknown> | undefined
  globalThis.fetch = async (_input, init) => {
    capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>
    return new Response(JSON.stringify({ ret: 0, message_id: 42 }), { status: 200 })
  }

  try {
    const result = await sendWeixinMessage({
      baseUrl: ILINK_DEFAULT_BASE_URL,
      token: 'bot-token',
      toUserId: 'wx-peer',
      contextToken: 'ctx-1',
      itemList: [{ type: 1, text_item: { text: '回复内容' } }],
    })
    assert.equal(result.ret, 0)
    const msg = capturedBody?.msg as { to_user_id: string; context_token: string; item_list: Array<{ type: number; text_item: { text: string } }> }
    assert.equal(msg.to_user_id, 'wx-peer')
    assert.equal(msg.context_token, 'ctx-1')
    assert.equal(msg.item_list[0]?.text_item?.text, '回复内容')
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('extractWeixinText 提取首个文本 item，忽略媒体与空文本', () => {
  const withMediaFirst: WeixinMessage = {
    item_list: [
      { type: 2, image_item: {} },
      { type: 1, text_item: { text: '  第二段文本  ' } },
    ],
  }
  assert.equal(extractWeixinText(withMediaFirst), '第二段文本')

  const onlyMedia: WeixinMessage = { item_list: [{ type: 2, image_item: {} }] }
  assert.equal(extractWeixinText(onlyMedia), '')

  const emptyText: WeixinMessage = { item_list: [{ type: 1, text_item: { text: '   ' } }] }
  assert.equal(extractWeixinText(emptyText), '')
})

test('summarizeWeixinMedia 将非文本媒体转成中文提示', () => {
  assert.equal(summarizeWeixinMedia({ item_list: [{ type: 2, image_item: {} }] }), '[收到图片消息]')
  assert.equal(summarizeWeixinMedia({ item_list: [{ type: 5, video_item: {} }, { type: 4, file_item: {} }] }), '[收到视频、文件消息]')
  assert.equal(summarizeWeixinMedia({ item_list: [{ type: 1, text_item: { text: 'hi' } }] }), '')
  assert.equal(summarizeWeixinMedia({}), '')
})

test('extractWeixinVoiceText 提取语音转写文本', () => {
  assert.equal(extractWeixinVoiceText({ item_list: [{ type: 3, voice_item: { text: '  语音转写内容  ' } }] }), '语音转写内容')
  assert.equal(extractWeixinVoiceText({ item_list: [{ type: 3, voice_item: {} }] }), '')
  assert.equal(extractWeixinVoiceText({ item_list: [{ type: 1, text_item: { text: '文本' } }] }), '')
  assert.equal(hasWeixinVoiceTranscription({ item_list: [{ type: 3, voice_item: { text: 'x' } }] }), true)
  assert.equal(hasWeixinVoiceTranscription({ item_list: [{ type: 3, voice_item: {} }] }), false)
})

test('AES-128-ECB 加密可解密回原文且密文大小为 16 字节对齐', () => {
  const key = Buffer.from('0123456789abcdef', 'utf-8')
  const plaintext = Buffer.from('hello wechat iLink media payload')
  const ciphertext = encryptAesEcb(plaintext, key)
  assert.equal(ciphertext.length, aesEcbPaddedSize(plaintext.length))
  const decipher = createDecipheriv('aes-128-ecb', key, null)
  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()])
  assert.equal(decrypted.toString('utf-8'), plaintext.toString('utf-8'))
})

test('uploadWeixinMediaToCdn 走 getuploadurl + CDN 上传并回读 x-encrypted-param', async () => {
  const originalFetch = globalThis.fetch
  const calls: Array<{ url: string; init?: RequestInit }> = []
  globalThis.fetch = async (input, init) => {
    calls.push({ url: String(input), init })
    if (String(input).includes('/ilink/bot/getuploadurl')) {
      return new Response(JSON.stringify({ ret: 0, upload_param: 'enc-param' }), { status: 200 })
    }
    return new Response('ok', { status: 200, headers: { 'x-encrypted-param': 'download-param-1' } })
  }

  try {
    const uploaded = await uploadWeixinMediaToCdn({
      buf: Buffer.from('image-bytes-1234'),
      baseUrl: ILINK_DEFAULT_BASE_URL,
      token: 'bot-token',
      toUserId: 'wx-peer',
      mediaType: 2,
    })
    assert.equal(uploaded.downloadEncryptedQueryParam, 'download-param-1')
    assert.equal(uploaded.fileSize, Buffer.byteLength('image-bytes-1234'))
    assert.ok(calls[0].url.includes('/ilink/bot/getuploadurl'))
    assert.ok(calls[1].url.includes('novac2c.cdn.weixin.qq.com/c2c/upload'))
    // CDN 上传体应为 AES 加密后的密文（非明文）
    const body = calls[1].init?.body as Uint8Array
    assert.equal(Buffer.from(body).includes(Buffer.from('image-bytes-1234')), false)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('sendWeixinImageMessage 上传后构造 image_item 发送', async () => {
  const originalFetch = globalThis.fetch
  const calls: Array<{ url: string; init?: RequestInit }> = []
  globalThis.fetch = async (input, init) => {
    calls.push({ url: String(input), init })
    if (String(input).includes('/ilink/bot/getuploadurl')) {
      return new Response(JSON.stringify({ ret: 0, upload_full_url: 'https://cdn.example/upload' }), { status: 200 })
    }
    if (String(input).includes('cdn.example')) {
      return new Response('ok', { status: 200, headers: { 'x-encrypted-param': 'dl-param' } })
    }
    return new Response(JSON.stringify({ ret: 0, message_id: 7 }), { status: 200 })
  }

  try {
    const result = await sendWeixinImageMessage({
      baseUrl: ILINK_DEFAULT_BASE_URL,
      token: 'bot-token',
      toUserId: 'wx-peer',
      contextToken: 'ctx-9',
      buf: Buffer.from('png-image'),
    })
    assert.equal(result.ret, 0)
    const sendCall = calls.find((call) => call.url.includes('/ilink/bot/sendmessage'))
    assert.ok(sendCall, 'sendmessage should be called')
    const body = JSON.parse(String(sendCall?.init?.body)) as { msg: { item_list: Array<{ type: number; image_item: { media: { encrypt_query_param: string; aes_key: string }; mid_size: number } }> } }
    const item = body.msg.item_list[0]
    assert.equal(item.type, 2)
    assert.equal(item.image_item.media.encrypt_query_param, 'dl-param')
    assert.equal(typeof item.image_item.media.aes_key, 'string')
    assert.ok(item.image_item.mid_size > 0)
  } finally {
    globalThis.fetch = originalFetch
  }
})
