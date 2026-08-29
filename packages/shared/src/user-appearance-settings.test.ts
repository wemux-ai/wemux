import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizeUserAppearanceSettings } from './user-appearance-settings'

test('normalizes supported theme preferences and defaults invalid values to dark', () => {
  assert.deepEqual(normalizeUserAppearanceSettings({ theme: 'dark' }), {
    theme: 'dark',
    glass: { opacity: 68, blur: 36, saturation: 125, borderOpacity: 8 },
  })
  assert.equal(normalizeUserAppearanceSettings({ theme: 'light' }).theme, 'light')
  assert.equal(normalizeUserAppearanceSettings({ theme: 'invalid' }).theme, 'dark')
})

test('normalizes and clamps glass effect settings', () => {
  assert.deepEqual(normalizeUserAppearanceSettings({
    glass: { opacity: 100, blur: -4, saturation: 170, borderOpacity: 2.4 },
  }).glass, {
    opacity: 90,
    blur: 0,
    saturation: 160,
    borderOpacity: 2,
  })
})
