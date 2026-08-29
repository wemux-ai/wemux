import assert from 'node:assert/strict'
import test from 'node:test'

import { classifyPageError } from './default-catch-boundary'

test('classifyPageError recognizes invalid React child failures', () => {
  assert.equal(
    classifyPageError(new Error('Minified React error #31; visit https://react.dev/errors/31?args[]=object')),
    'invalid-render-data',
  )
})

test('classifyPageError recognizes stale dynamic asset failures', () => {
  assert.equal(
    classifyPageError(new Error('Failed to fetch dynamically imported module: /assets/settings.js')),
    'stale-assets',
  )
})

test('classifyPageError leaves unrelated failures as unexpected', () => {
  assert.equal(classifyPageError(new Error('Request failed: 503')), 'unexpected')
})
