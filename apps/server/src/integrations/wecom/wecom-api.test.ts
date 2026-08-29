// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
import assert from 'node:assert/strict'
import test from 'node:test'
import { createHash } from 'node:crypto'
import {
  buildWecomCallbackSignature,
  decryptWecomCallbackPayload,
  encryptWecomCallbackPayload,
  decryptWecomEchoStr,
  extractWecomEncrypt,
  parseWecomCallbackMessage,
  normalizeWecomEncodingAesKey,
  getWecomAccessToken,
  sendWecomAppMessage,
} from './wecom-api'

// 43 位 base64（去 = 的标准 EncodingAESKey，如企业微信官方文档测试向量）
const ENCODING_KEY = 'jWmYm7qr5nMoAUwZRjGtBxmz3KA1tkAj3ykkR6q2B2C'
const CORP_ID = 'ww1234567890abcdef'

test('normalizeWecomEncodingAesKey 校验 43 位并还原 32 字节 key', () => {
  const key = normalizeWecomEncodingAesKey(ENCODING_KEY)
  assert.ok(key)
  assert.equal(key?.length, 32)
  assert.equal(normalizeWecomEncodingAesKey('short'), null)
  assert.equal(normalizeWecomEncodingAesKey('jWmYm7qr5nMoAUwZRjGtBxmz3KA1tkAj3ykkR6q2B2CD'), null)
})

test('AES-256-CBC 加密解密回环还原消息与 corpid', () => {
  const message = '<xml><ToUserName><![CDATA[ww-test]]></ToUserName></xml>'
  const encrypted = encryptWecomCallbackPayload(ENCODING_KEY, message, CORP_ID)
  assert.equal(encrypted.ok, true)
  const decrypted = decryptWecomCallbackPayload(ENCODING_KEY, encrypted.encrypted || '', CORP_ID)
  if ('error' in decrypted) {
    assert.fail(decrypted.error)
  }
  assert.equal(decrypted.message, message)
  assert.equal(decrypted.corpId, CORP_ID)
})

test('decryptWecomEchoStr 用于 URL 验证', () => {
  const encrypted = encryptWecomCallbackPayload(ENCODING_KEY, 'echostr-plaintext', CORP_ID)
  assert.equal(encrypted.ok, true)
  const result = decryptWecomEchoStr(ENCODING_KEY, encrypted.encrypted || '', CORP_ID)
  assert.equal(result.ok, true)
  assert.equal(result.echostr, 'echostr-plaintext')
})

test('buildWecomCallbackSignature 按排序拼接做 SHA1', () => {
  const sig = buildWecomCallbackSignature('token', 'timestamp', 'nonce', 'encrypted')
  assert.equal(sig.length, 40)
  // 排序 = nonce, token, timestamp, encrypted → 'encryptednoncetimestamptoken' 的 sha1
  const expected = 'encryptednoncetimestamptoken'
  assert.equal(sig, createHash('sha1').update(expected, 'utf8').digest('hex'))
})

test('extractWecomEncrypt / parseWecomCallbackMessage 解析回调 XML', () => {
  const xml = '<xml><ToUserName><![CDATA[ww-1]]></ToUserName><Encrypt><![CDATA[encrypted-content]]></Encrypt></xml>'
  assert.equal(extractWecomEncrypt(xml), 'encrypted-content')

  const msgXml = '<xml><ToUserName><![CDATA[ww-1]]></ToUserName><FromUserName><![CDATA[zhangsan]]></FromUserName><CreateTime>1700000000</CreateTime><MsgType><![CDATA[text]]></MsgType><Content><![CDATA[你好]]></Content><MsgId>12345</MsgId></xml>'
  const parsed = parseWecomCallbackMessage(msgXml)
  assert.deepEqual(parsed && { fromUserName: parsed.fromUserName, msgType: parsed.msgType, content: parsed.content, msgId: parsed.msgId }, {
    fromUserName: 'zhangsan',
    msgType: 'text',
    content: '你好',
    msgId: '12345',
  })
  assert.equal(parseWecomCallbackMessage('<xml></xml>'), null)
})

test('getWecomAccessToken 缓存 token 且 sendWecomAppMessage 走 message/send', async () => {
  const originalFetch = globalThis.fetch
  const calls: string[] = []
  globalThis.fetch = async (input) => {
    const url = String(input)
    calls.push(url)
    if (url.includes('/gettoken')) {
      return new Response(JSON.stringify({ errcode: 0, access_token: 'tok-1', expires_in: 7200 }), { status: 200 })
    }
    return new Response(JSON.stringify({ errcode: 0 }), { status: 200 })
  }

  try {
    const token = await getWecomAccessToken('corp-1', 'secret-1')
    assert.equal(token.ok, true)
    assert.equal(token.token, 'tok-1')
    // 二次调用命中缓存，不重复请求
    await getWecomAccessToken('corp-1', 'secret-1')
    assert.equal(calls.filter((url) => url.includes('/gettoken')).length, 1)

    const sent = await sendWecomAppMessage({ corpId: 'corp-1', agentId: '1000002', secret: 'secret-1', touser: 'zhangsan', content: 'hi' })
    assert.equal(sent.ok, true)
    assert.ok(calls.some((url) => url.includes('/message/send')))
  } finally {
    globalThis.fetch = originalFetch
  }
})
