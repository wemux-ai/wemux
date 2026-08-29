import assert from 'node:assert/strict'
import test from 'node:test'
import {
  formatInboxRelativeTime,
  parseInboxPageSection,
  resolveInboxSnoozeUntil,
  toInboxSection,
} from './inbox-model'

test('parseInboxPageSection accepts the four global Inbox sections', () => {
  assert.equal(parseInboxPageSection('all'), 'all')
  assert.equal(parseInboxPageSection('action'), 'action')
  assert.equal(parseInboxPageSection('following'), 'following')
  assert.equal(parseInboxPageSection('archived'), 'archived')
  // snoozed 没有独立 tab：未知值回退到「全部」。
  assert.equal(parseInboxPageSection('snoozed'), 'all')
  assert.equal(parseInboxPageSection('requests'), 'all')
  assert.equal(parseInboxPageSection(undefined), 'all')
})

test('toInboxSection maps every section to a server-side query scope', () => {
  assert.equal(toInboxSection('all'), 'all')
  assert.equal(toInboxSection('action'), 'action')
  assert.equal(toInboxSection('following'), 'following')
  assert.equal(toInboxSection('archived'), 'archived')
})

test('resolveInboxSnoozeUntil builds stable preset dates', () => {
  const now = new Date('2026-07-26T08:15:00.000Z')
  assert.equal(resolveInboxSnoozeUntil('hour', now), '2026-07-26T09:15:00.000Z')
  assert.equal(new Date(resolveInboxSnoozeUntil('tomorrow', now)).getHours(), 9)
  assert.equal(new Date(resolveInboxSnoozeUntil('week', now)).getDate(), new Date('2026-08-02T08:15:00.000Z').getDate())
})

test('formatInboxRelativeTime formats compact English and Chinese times', () => {
  const now = new Date('2026-07-26T12:00:00.000Z').getTime()
  assert.equal(formatInboxRelativeTime('2026-07-26T11:55:00.000Z', 'en', now), '5m')
  assert.equal(formatInboxRelativeTime('2026-07-26T10:00:00.000Z', 'zh', now), '2 小时前')
})
