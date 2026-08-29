import assert from 'node:assert/strict'
import test from 'node:test'

import { FEEDBACK_ESCALATION_MS, isFeedbackAwaitingAdminReply } from './feedback-escalation-service'

const now = new Date('2026-08-26T12:00:00.000Z')

test('only an overdue final user message requires an Admin reply', () => {
  assert.equal(isFeedbackAwaitingAdminReply([
    { role: 'user', createdAt: new Date(now.getTime() - FEEDBACK_ESCALATION_MS).toISOString() },
  ], now), true)
  assert.equal(isFeedbackAwaitingAdminReply([
    { role: 'user', createdAt: new Date(now.getTime() - FEEDBACK_ESCALATION_MS + 1).toISOString() },
  ], now), false)
  assert.equal(isFeedbackAwaitingAdminReply([
    { role: 'user', createdAt: new Date(now.getTime() - FEEDBACK_ESCALATION_MS * 2).toISOString() },
    { role: 'assistant', createdAt: new Date(now.getTime() - FEEDBACK_ESCALATION_MS).toISOString() },
  ], now), false)
})
