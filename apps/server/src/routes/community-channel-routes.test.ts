// [INPUT]: 社区渠道配置校验规则
// [OUTPUT]: validateCommunityChannels 判定
// [POS]: 社区渠道（Discord / 微信群二维码）配置边界

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { validateCommunityChannels } from './community-channel-routes'

test('合法配置：两个渠道均可为空', () => {
  assert.equal(validateCommunityChannels({}), null)
  assert.equal(validateCommunityChannels({ discordUrl: '', wechatQrUrl: '' }), null)
})

test('Discord 必须是 http(s) 链接', () => {
  assert.equal(validateCommunityChannels({ discordUrl: 'https://discord.gg/example' }), null)
  assert.equal(validateCommunityChannels({ discordUrl: 'http://discord.com/invite/example' }), null)
  assert.ok(validateCommunityChannels({ discordUrl: 'discord.gg/example' }))
  assert.ok(validateCommunityChannels({ discordUrl: 'javascript:alert(1)' }))
  assert.ok(validateCommunityChannels({ discordUrl: '/relative/path' }))
})

test('微信群二维码允许 http(s) 链接或相对路径，拒绝其它协议', () => {
  assert.equal(validateCommunityChannels({ wechatQrUrl: 'https://cdn.example.com/qr.png' }), null)
  assert.equal(validateCommunityChannels({ wechatQrUrl: '/api/site/community/wechat-qr/1.png' }), null)
  assert.ok(validateCommunityChannels({ wechatQrUrl: 'data:image/png;base64,xxx' }))
  assert.ok(validateCommunityChannels({ wechatQrUrl: 'ftp://x/y.png' }))
})

test('url 前后空白容忍（trim 后校验）', () => {
  assert.equal(validateCommunityChannels({ discordUrl: '  https://discord.gg/example  ' }), null)
})
