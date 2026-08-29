import assert from 'node:assert/strict'
import test from 'node:test'
import { parseInboxStreamEvent, splitInboxStreamBuffer } from './inbox-stream'

test('parseInboxStreamEvent reads event names and multi-line JSON data', () => {
  const parsed = parseInboxStreamEvent('event: inbox.item.created\r\ndata: {"unreadGroups":2,\r\ndata: "itemId":"item-1"}')
  assert.deepEqual(parsed, {
    event: 'inbox.item.created',
    data: { unreadGroups: 2, itemId: 'item-1' },
  })
})

test('parseInboxStreamEvent ignores malformed payloads', () => {
  assert.equal(parseInboxStreamEvent('event: inbox.badge.changed\ndata: nope'), null)
  assert.equal(parseInboxStreamEvent('event: ping'), null)
})

test('splitInboxStreamBuffer keeps an incomplete event for the next chunk', () => {
  const result = splitInboxStreamBuffer('event: ping\r\ndata: {"at":"now"}\r\n\r\nevent: inbox.item')
  assert.deepEqual(result.events, ['event: ping\ndata: {"at":"now"}'])
  assert.equal(result.remainder, 'event: inbox.item')
})
