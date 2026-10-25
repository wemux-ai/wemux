import assert from 'node:assert/strict'
import test from 'node:test'

import {
  deriveProjectColor,
  getProjectColor,
  normalizeHexColor,
} from './project-color'

const HEX_COLOR = /^#[0-9a-f]{6}$/

test('normalizeHexColor returns null for missing or blank input', () => {
  assert.equal(normalizeHexColor(null), null)
  assert.equal(normalizeHexColor(undefined), null)
  assert.equal(normalizeHexColor(''), null)
  assert.equal(normalizeHexColor('   '), null)
})

test('normalizeHexColor expands 3-digit hex to 6 digits', () => {
  assert.equal(normalizeHexColor('#abc'), '#aabbcc')
  assert.equal(normalizeHexColor('#ABC'), '#aabbcc')
  assert.equal(normalizeHexColor('#09f'), '#0099ff')
})

test('normalizeHexColor lowercases 6-digit hex and trims whitespace', () => {
  assert.equal(normalizeHexColor('#AbCdEf'), '#abcdef')
  assert.equal(normalizeHexColor('#123456'), '#123456')
  assert.equal(normalizeHexColor('  #ABCDEF  '), '#abcdef')
})

test('normalizeHexColor rejects invalid hex values', () => {
  // wrong digit counts
  assert.equal(normalizeHexColor('#ab'), null)
  assert.equal(normalizeHexColor('#abcd'), null)
  assert.equal(normalizeHexColor('#12345'), null)
  assert.equal(normalizeHexColor('#abcdef0'), null)
  // non-hex characters
  assert.equal(normalizeHexColor('#ggg'), null)
  assert.equal(normalizeHexColor('#12345z'), null)
  assert.equal(normalizeHexColor('red'), null)
  // stray prefix
  assert.equal(normalizeHexColor('##abc'), null)
})

test('deriveProjectColor is deterministic and returns a 6-digit hex color', () => {
  const first = deriveProjectColor('wemux')

  assert.match(first, HEX_COLOR)
  assert.equal(deriveProjectColor('wemux'), first)
})

test('deriveProjectColor gives different names different colors', () => {
  const colors = new Set(['alpha', 'beta', 'gamma', 'wemux', 'Wemux'].map(deriveProjectColor))

  assert.equal(colors.size, 5)
})

test('deriveProjectColor ignores surrounding whitespace and falls back for empty names', () => {
  assert.equal(deriveProjectColor('  wemux  '), deriveProjectColor('wemux'))
  assert.equal(deriveProjectColor(''), deriveProjectColor('project'))
  assert.equal(deriveProjectColor('   '), deriveProjectColor('project'))
})

test('getProjectColor prefers a valid stored color, normalized', () => {
  assert.equal(getProjectColor({ name: 'wemux', color: '#ABC' }), '#aabbcc')
  assert.equal(getProjectColor({ name: 'wemux', color: '#AbCdEf' }), '#abcdef')
})

test('getProjectColor falls back to the name-derived color when stored color is unusable', () => {
  const derived = deriveProjectColor('wemux')

  assert.equal(getProjectColor({ name: 'wemux' }), derived)
  assert.equal(getProjectColor({ name: 'wemux', color: null }), derived)
  assert.equal(getProjectColor({ name: 'wemux', color: '' }), derived)
  assert.equal(getProjectColor({ name: 'wemux', color: 'not-a-color' }), derived)
})
