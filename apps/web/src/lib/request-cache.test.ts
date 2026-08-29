import assert from 'node:assert/strict'
import test from 'node:test'
import { createCachedRequestLoader, createCachedRequestLoaderMap } from './request-cache'

test('createCachedRequestLoader shares pending requests even when forced', async () => {
  let calls = 0
  let resolveValue: (value: string) => void = () => {}
  const loader = createCachedRequestLoader({
    ttlMs: 1_000,
    load: async () => {
      calls += 1
      return new Promise<string>((resolve) => {
        resolveValue = resolve
      })
    },
  })

  const first = loader({ force: true })
  const second = loader({ force: true })
  resolveValue('ok')

  assert.equal(await first, 'ok')
  assert.equal(await second, 'ok')
  assert.equal(calls, 1)
})

test('createCachedRequestLoaderMap isolates cache entries by key while sharing pending requests', async () => {
  let calls = 0
  const resolvers = new Map<string, (value: string) => void>()
  const loader = createCachedRequestLoaderMap({
    ttlMs: 1_000,
    load: async (key: string) => {
      calls += 1
      return new Promise<string>((resolve) => {
        resolvers.set(key, resolve)
      })
    },
  })

  const firstAlpha = loader('alpha')
  const secondAlpha = loader('alpha')
  const beta = loader('beta')

  resolvers.get('alpha')?.('A')
  resolvers.get('beta')?.('B')

  assert.equal(await firstAlpha, 'A')
  assert.equal(await secondAlpha, 'A')
  assert.equal(await beta, 'B')
  assert.equal(calls, 2)
})
