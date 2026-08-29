import assert from 'node:assert/strict'
import test from 'node:test'
import type { ChatTimelineEvent } from './timeline'
import { upsertTimelineEvent } from './timeline'

const buildEvent = (id: string, ts: string, seq = 1): ChatTimelineEvent => ({
  id,
  ts,
  turnId: id,
  seq,
  kind: 'assistant_message',
  messageId: `message-${id}`,
  text: id,
})

test('upsertTimelineEvent appends already ordered realtime events without reordering existing items', () => {
  const first = buildEvent('first', '2026-05-20T00:00:00.000Z')
  const second = buildEvent('second', '2026-05-20T00:00:01.000Z')

  const next = upsertTimelineEvent([first], second)

  assert.deepEqual(next.map((event) => event.id), ['first', 'second'])
})

test('upsertTimelineEvent sorts only when a new event arrives out of order', () => {
  const first = buildEvent('first', '2026-05-20T00:00:00.000Z')
  const third = buildEvent('third', '2026-05-20T00:00:02.000Z')
  const second = buildEvent('second', '2026-05-20T00:00:01.000Z')

  const next = upsertTimelineEvent([first, third], second)

  assert.deepEqual(next.map((event) => event.id), ['first', 'second', 'third'])
})

test('upsertTimelineEvent preserves order when replacing an event in the same position', () => {
  const first = buildEvent('first', '2026-05-20T00:00:00.000Z')
  const second = buildEvent('second', '2026-05-20T00:00:01.000Z')
  const updatedSecond = {
    ...second,
    text: 'updated second',
  }

  const next = upsertTimelineEvent([first, second], updatedSecond)

  assert.deepEqual(next.map((event) => event.id), ['first', 'second'])
  assert.equal(next[1]?.kind, 'assistant_message')
  if (next[1]?.kind !== 'assistant_message') {
    throw new Error('expected an assistant message event')
  }
  assert.equal(next[1]?.text, 'updated second')
})
