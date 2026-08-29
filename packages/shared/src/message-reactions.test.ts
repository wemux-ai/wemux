import { test } from 'node:test'
import assert from 'node:assert/strict'
import { hasMessageReaction, toggleMessageReaction } from './message-reactions'
import type { MessageReaction } from './thread-message'

test('toggleMessageReaction 添加新 emoji reaction', () => {
  const next = toggleMessageReaction([], '👍', 'user-1', true)
  assert.deepEqual(next, [{ emoji: '👍', userIds: ['user-1'] }])
})

test('toggleMessageReaction 添加已存在 emoji 的第二个用户（不重复）', () => {
  const base: MessageReaction[] = [{ emoji: '👍', userIds: ['user-1'] }]
  const next = toggleMessageReaction(base, '👍', 'user-2', true)
  assert.deepEqual(next, [{ emoji: '👍', userIds: ['user-1', 'user-2'] }])
  // 幂等：同一用户再点一次不重复
  const again = toggleMessageReaction(next, '👍', 'user-2', true)
  assert.deepEqual(again, [{ emoji: '👍', userIds: ['user-1', 'user-2'] }])
})

test('toggleMessageReaction 移除单个用户', () => {
  const base: MessageReaction[] = [{ emoji: '👍', userIds: ['user-1', 'user-2'] }]
  const next = toggleMessageReaction(base, '👍', 'user-1', false)
  assert.deepEqual(next, [{ emoji: '👍', userIds: ['user-2'] }])
})

test('toggleMessageReaction 空 reaction 剔除', () => {
  const base: MessageReaction[] = [{ emoji: '👍', userIds: ['user-1'] }]
  const next = toggleMessageReaction(base, '👍', 'user-1', false)
  assert.deepEqual(next, [])
})

test('toggleMessageReaction 不修改入参', () => {
  const base: MessageReaction[] = [{ emoji: '❤️', userIds: ['user-1'] }]
  toggleMessageReaction(base, '❤️', 'user-2', true)
  assert.deepEqual(base, [{ emoji: '❤️', userIds: ['user-1'] }])
})

test('toggleMessageReaction 空 emoji/userId 忽略', () => {
  assert.deepEqual(toggleMessageReaction(undefined, '  ', 'user-1', true), [])
  assert.deepEqual(toggleMessageReaction([], '👍', ' ', true), [])
})

test('hasMessageReaction 判断用户是否已点', () => {
  const reactions: MessageReaction[] = [{ emoji: '👀', userIds: ['user-1'] }]
  assert.equal(hasMessageReaction(reactions, '👀', 'user-1'), true)
  assert.equal(hasMessageReaction(reactions, '👀', 'user-2'), false)
  assert.equal(hasMessageReaction(undefined, '👀', 'user-1'), false)
})
