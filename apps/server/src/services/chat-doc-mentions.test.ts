import { test } from 'node:test'
import assert from 'node:assert/strict'
import { collectMentionNameTokens } from './chat-doc-mentions'

test('collectMentionNameTokens 提取完整 @名字 token（中文/英文/数字）', () => {
  assert.deepEqual(
    collectMentionNameTokens('看一下 @需求文档 和 @spec-v2'),
    ['需求文档', 'spec-v2'],
  )
})

test('collectMentionNameTokens 忽略邮箱与紧邻空白', () => {
  assert.deepEqual(
    collectMentionNameTokens('联系 @alice 或 foo@bar.com'),
    ['alice'],
  )
})

test('collectMentionNameTokens 忽略紧邻标点后的空 token', () => {
  assert.deepEqual(
    collectMentionNameTokens('@, 开头标点不取'),
    [],
  )
})

test('collectMentionNameTokens 消息开头 @ 可识别', () => {
  assert.deepEqual(
    collectMentionNameTokens('@老板 这个方案如何'),
    ['老板'],
  )
})

test('collectMentionNameTokens 多个 @ 与中文标点分隔', () => {
  assert.deepEqual(
    collectMentionNameTokens('@A，@B。@C！'),
    ['A', 'B', 'C'],
  )
})

test('collectMentionNameTokens 无 @ 返回空', () => {
  assert.deepEqual(collectMentionNameTokens('普通消息没有提及'), [])
})
