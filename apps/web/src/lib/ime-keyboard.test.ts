import assert from 'node:assert/strict'
import test from 'node:test'

import { isImeComposingKeyboardEvent } from './ime-keyboard'

test('detects keyboard events that are still inside IME composition', () => {
  assert.equal(isImeComposingKeyboardEvent({ isComposing: true, key: 'Enter' }), true)
  assert.equal(isImeComposingKeyboardEvent({ key: 'Process' }), true)
  assert.equal(isImeComposingKeyboardEvent({ keyCode: 229, key: 'Enter' }), true)
  assert.equal(isImeComposingKeyboardEvent({ nativeEvent: { isComposing: true }, key: 'Enter' }), true)
  assert.equal(isImeComposingKeyboardEvent({ nativeEvent: { keyCode: 229 }, key: 'Enter' }), true)
})

test('ignores plain keyboard events after composition finishes', () => {
  assert.equal(isImeComposingKeyboardEvent({ key: 'Enter' }), false)
  assert.equal(isImeComposingKeyboardEvent({ key: 'Escape', nativeEvent: { keyCode: 27 } }), false)
})
