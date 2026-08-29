// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
import assert from 'node:assert/strict'
import test from 'node:test'
import { encryptAesEcb, pickWeixinMediaItem, downloadWeixinMedia } from '../integrations/wechat-ilink/ilink-api'
import {
  buildWechatMediaObjectKey,
  buildWechatMediaToken,
  parseWechatMediaToken,
  WECHAT_MEDIA_TOKEN_TTL_MS,
} from './wechat-media-storage'

test('pickWeixinMediaItem 提取首个媒体 item 与类型/扩展名', () => {
  const image = pickWeixinMediaItem({ item_list: [{ type: 2, image_item: {} }] })
  assert.deepEqual(image && { kind: image.kind, ext: image.ext }, { kind: 'image', ext: 'png' })

  const video = pickWeixinMediaItem({ item_list: [{ type: 1, text_item: { text: 'x' } }, { type: 5, video_item: {} }] })
  assert.equal(video?.kind, 'video')
  assert.equal(video?.ext, 'mp4')

  const file = pickWeixinMediaItem({ item_list: [{ type: 4, file_item: {} }] })
  assert.equal(file?.kind, 'file')

  assert.equal(pickWeixinMediaItem({ item_list: [{ type: 1, text_item: { text: 'hi' } }] }), null)
  assert.equal(pickWeixinMediaItem({}), null)
})

test('downloadWeixinMedia 下载 CDN 密文并 AES 解密还原明文', async () => {
  const originalFetch = globalThis.fetch
  const aesKey = Buffer.from('0123456789abcdef', 'utf-8')
  const plaintext = Buffer.from('inbound-image-bytes')
  const ciphertext = encryptAesEcb(plaintext, aesKey)

  globalThis.fetch = async (input) => {
    const url = String(input)
    assert.ok(url.includes('/download?encrypted_query_param='), url)
    return new Response(new Uint8Array(ciphertext), { status: 200 })
  }

  try {
    const result = await downloadWeixinMedia({
      item: {
        type: 2,
        image_item: {
          media: { encrypt_query_param: 'enc-1', aes_key: aesKey.toString('base64') },
        },
      },
    })
    assert.equal(result?.toString('utf-8'), plaintext.toString('utf-8'))
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('downloadWeixinMedia 优先使用 image_item.aeskey（hex）且可走 full_url', async () => {
  const originalFetch = globalThis.fetch
  const aesKey = Buffer.from('fedcba9876543210', 'utf-8')
  const plaintext = Buffer.from('via-full-url')
  globalThis.fetch = async (input) => {
    assert.equal(String(input), 'https://cdn.example/full/1')
    return new Response(new Uint8Array(encryptAesEcb(plaintext, aesKey)), { status: 200 })
  }

  try {
    const result = await downloadWeixinMedia({
      item: {
        type: 2,
        image_item: {
          aeskey: aesKey.toString('hex'),
          media: { full_url: 'https://cdn.example/full/1' },
        },
      },
    })
    assert.equal(result?.toString('utf-8'), 'via-full-url')
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('downloadWeixinMedia 对缺少 media/密钥的 item 返回 null', async () => {
  assert.equal(await downloadWeixinMedia({ item: { type: 2, image_item: {} } }), null)
})

test('wechat-media-token 生成/解析/篡改/过期', () => {
  const token = buildWechatMediaToken({ agentId: 'agent-1', messageId: 42, ext: 'png' })
  assert.ok(token)
  const parsed = parseWechatMediaToken(token)
  assert.deepEqual(parsed && { agentId: parsed.agentId, messageId: parsed.messageId, ext: parsed.ext }, { agentId: 'agent-1', messageId: 42, ext: 'png' })

  assert.equal(parseWechatMediaToken(token.slice(0, -1) + (token.endsWith('a') ? 'b' : 'a')), null)
  assert.equal(parseWechatMediaToken('garbage'), null)

  const issuedAt = Date.now() - WECHAT_MEDIA_TOKEN_TTL_MS - 1000
  const expired = buildWechatMediaToken({ agentId: 'a', messageId: 1, ext: 'bin', issuedAt })
  assert.equal(parseWechatMediaToken(expired), null)
})

test('buildWechatMediaObjectKey 固定前缀且扩展名白名单', () => {
  assert.equal(buildWechatMediaObjectKey('agent-1', 7, 'png'), 'channel-media/wechat/agent-1/7.png')
  assert.equal(buildWechatMediaObjectKey('agent-1', 7, '../evil'), 'channel-media/wechat/agent-1/7.bin')
})
