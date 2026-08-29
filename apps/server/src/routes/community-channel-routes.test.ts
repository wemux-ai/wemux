// [INPUT]: 社区渠道配置校验规则
// [OUTPUT]: validateCommunityChannels 判定
// [POS]: 社区渠道（Telegram / 飞书 / 微信群二维码）配置边界

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { validateCommunityChannels } from './community-channel-routes'

test('合法配置：三个渠道均可为空', () => {
  assert.equal(validateCommunityChannels({}), null)
  assert.equal(validateCommunityChannels({ telegramUrl: '', feishuUrl: '', wechatQrUrl: '' }), null)
})

test('Telegram / 飞书必须是 http(s) 链接', () => {
  assert.equal(validateCommunityChannels({ telegramUrl: 'https://t.me/example' }), null)
  assert.equal(validateCommunityChannels({ feishuUrl: 'http://applink.feishu.cn/x' }), null)
  assert.ok(validateCommunityChannels({ telegramUrl: 't.me/example' }))
  assert.ok(validateCommunityChannels({ feishuUrl: 'javascript:alert(1)' }))
  assert.ok(validateCommunityChannels({ feishuUrl: '/relative/path' }))
})

test('微信群二维码允许 http(s) 链接或相对路径，拒绝其它协议', () => {
  assert.equal(validateCommunityChannels({ wechatQrUrl: 'https://cdn.example.com/qr.png' }), null)
  assert.equal(validateCommunityChannels({ wechatQrUrl: '/api/site/community/wechat-qr/1.png' }), null)
  assert.ok(validateCommunityChannels({ wechatQrUrl: 'data:image/png;base64,xxx' }))
  assert.ok(validateCommunityChannels({ wechatQrUrl: 'ftp://x/y.png' }))
})

test('url 前后空白容忍（trim 后校验）', () => {
  assert.equal(validateCommunityChannels({ telegramUrl: '  https://t.me/example  ' }), null)
})
