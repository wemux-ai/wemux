import assert from 'node:assert/strict'
import test from 'node:test'
import { collectUnackedMentionIds, messageMentionsUserId } from './workspace-group-chat-mentions'

const me = 'user-me'
const peer = 'user-peer'

test('messageMentionsUserId: @用户命中且排除自己发的', () => {
  assert.equal(messageMentionsUserId({
    senderId: peer,
    externalRef: { mentions: [{ targetType: 'user', targetId: me }] },
  }, me), true)
  assert.equal(messageMentionsUserId({
    senderId: me,
    externalRef: { mentions: [{ targetType: 'user', targetId: me }] },
  }, me), false)
  assert.equal(messageMentionsUserId({
    senderId: peer,
    externalRef: { mentions: [{ targetType: 'user', targetId: 'other' }] },
  }, me), false)
})

test('messageMentionsUserId: @所有人算提及，自己发的 @所有人不算', () => {
  assert.equal(messageMentionsUserId({
    senderId: peer,
    externalRef: { mentions: [{ targetType: 'all', targetId: '*' }] },
  }, me), true)
  assert.equal(messageMentionsUserId({
    senderId: me,
    externalRef: { mentions: [{ targetType: 'all', targetId: '*' }] },
  }, me), false)
})

test('collectUnackedMentionIds: 只收 seenUntil 之后的 @我', () => {
  const messages = [
    { id: 'm1', createdAt: '2026-08-01T00:00:00.000Z', senderId: peer, externalRef: { mentions: [{ targetType: 'user', targetId: me }] } },
    { id: 'm2', createdAt: '2026-08-03T00:00:00.000Z', senderId: peer, externalRef: { mentions: [{ targetType: 'user', targetId: me }] } },
    { id: 'm3', createdAt: '2026-08-04T00:00:00.000Z', senderId: peer, externalRef: {} },
  ]
  assert.deepEqual(collectUnackedMentionIds(messages, me, '2026-08-02T00:00:00.000Z'), ['m2'])
  assert.deepEqual(collectUnackedMentionIds(messages, me), ['m1', 'm2'])
})
