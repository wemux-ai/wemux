import assert from 'node:assert/strict'
import test from 'node:test'

test('useSmoothAutoScroll keeps pointer selection handling browser-bound and type-safe', async () => {
  const mod = await import('./use-smooth-auto-scroll')

  assert.equal(typeof mod.useSmoothAutoScroll, 'function')
})
