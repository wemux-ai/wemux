import assert from 'node:assert/strict'
import test from 'node:test'

import { findCommercialServerExtensionEntry } from './commercial-extension-loader'

test('selects the built commercial extension before the source entry', () => {
  const built = '/tmp/enterprise/index.js'
  const source = '/tmp/enterprise/index.ts'
  assert.equal(
    findCommercialServerExtensionEntry([built, source], (entry) => entry === built),
    built,
  )
})

test('returns null when the commercial extension is absent', () => {
  assert.equal(findCommercialServerExtensionEntry(['/tmp/missing.ts'], () => false), null)
})
