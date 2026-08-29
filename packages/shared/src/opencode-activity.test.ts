import assert from 'node:assert/strict'
import test from 'node:test'
import { createOpenCodeInactivityTracker } from './opencode-activity'

test('createOpenCodeInactivityTracker resets the timeout window after new activity', () => {
  let now = 1_000
  const tracker = createOpenCodeInactivityTracker(100, () => now)

  now = 1_050
  assert.equal(tracker.hasTimedOut(), false)
  assert.equal(tracker.getRemainingMs(), 50)

  tracker.markActivity()

  now = 1_149
  assert.equal(tracker.hasTimedOut(), false)
  assert.equal(tracker.getElapsedSinceActivity(), 99)

  now = 1_150
  assert.equal(tracker.hasTimedOut(), true)
  assert.equal(tracker.getRemainingMs(), 0)
})

test('createOpenCodeInactivityTracker stays alive across repeated activity beyond the initial timeout window', () => {
  let now = 10_000
  const tracker = createOpenCodeInactivityTracker(120_000, () => now)

  now = 60_000
  tracker.markActivity()
  assert.equal(tracker.hasTimedOut(), false)

  now = 120_000
  tracker.markActivity()
  assert.equal(tracker.hasTimedOut(), false)

  now = 179_999
  tracker.markActivity()
  assert.equal(tracker.hasTimedOut(), false)

  now = 299_998
  assert.equal(tracker.hasTimedOut(), false)

  now = 299_999
  assert.equal(tracker.hasTimedOut(), true)
})
