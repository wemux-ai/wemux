import assert from 'node:assert/strict'
import test from 'node:test'

import {
  invalidateTtlCache,
  readTtlCache,
  writeTtlCache,
  type TtlCache,
  type TtlCacheEntry,
} from './ttl-cache'

test('readTtlCache returns null for unknown key', () => {
  const cache: TtlCache<string> = new Map()
  assert.equal(readTtlCache(cache, 'missing', 1000, 500), null)
})

test('writeTtlCache then readTtlCache round-trips', () => {
  const cache: TtlCache<string> = new Map()
  writeTtlCache(cache, 'key-a', 'value-a', 1000)

  assert.equal(readTtlCache(cache, 'key-a', 1000, 1500), 'value-a')
})

test('readTtlCache removes expired entries', () => {
  const cache: TtlCache<string> = new Map()
  writeTtlCache(cache, 'expired', 'value', 10)

  assert.equal(readTtlCache(cache, 'expired', 1000, 10 + 1000), null)
  assert.equal(cache.size, 0)
})

test('writeTtlCache evicts the least recently used key', () => {
  const cache: TtlCache<string> = new Map()
  writeTtlCache(cache, 'a', 'value-a', 1, 2)
  writeTtlCache(cache, 'b', 'value-b', 2, 2)

  // 读 a 把 a 挪到末尾（LRU 刷新）。
  assert.equal(readTtlCache(cache, 'a', 1000, 3), 'value-a')
  writeTtlCache(cache, 'c', 'value-c', 4, 2)

  assert.deepEqual([...cache.keys()], ['a', 'c'])
})

test('writeTtlCache replaces the existing key in place', () => {
  const cache: TtlCache<string> = new Map()
  writeTtlCache(cache, 'key-a', 'old', 1000)
  writeTtlCache(cache, 'key-a', 'new', 2000)

  assert.equal(readTtlCache(cache, 'key-a', 5000, 3000), 'new')
  assert.equal(cache.size, 1)
})

test('invalidateTtlCache removes the key', () => {
  const cache: TtlCache<string> = new Map()
  writeTtlCache(cache, 'key-a', 'value-a', 1000)

  invalidateTtlCache(cache, 'key-a')
  assert.equal(readTtlCache(cache, 'key-a', 1000, 2000), null)
})

test('ttl-cache entry shape is internal but stable', () => {
  const cache: TtlCache<string> = new Map()
  writeTtlCache(cache, 'key-a', 'value-a', 1234)

  const entry = cache.get('key-a') as TtlCacheEntry<string>
  assert.equal(entry.value, 'value-a')
  assert.equal(entry.fetchedAt, 1234)
})
