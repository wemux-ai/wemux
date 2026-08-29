import assert from 'node:assert/strict'
import test from 'node:test'

import {
  mapTaskFieldValuesToKeys,
  resolveTaskFieldIdsByKey,
} from './task-field-store'

const definitions = [
  { id: 'field-1', key: 'hours' },
  { id: 'field-2', key: 'labels' },
] as const

test('resolveTaskFieldIdsByKey maps known keys to field ids', () => {
  const { fieldIdByKey, unknownKeys } = resolveTaskFieldIdsByKey(definitions, ['hours', 'labels'])

  assert.deepEqual(fieldIdByKey, { hours: 'field-1', labels: 'field-2' })
  assert.deepEqual(unknownKeys, [])
})

test('resolveTaskFieldIdsByKey reports unknown keys', () => {
  const { fieldIdByKey, unknownKeys } = resolveTaskFieldIdsByKey(definitions, ['hours', 'missing'])

  assert.deepEqual(fieldIdByKey, { hours: 'field-1', labels: 'field-2' })
  assert.deepEqual(unknownKeys, ['missing'])
})

test('mapTaskFieldValuesToKeys maps values back to key names and drops orphan field ids', () => {
  const byKey = mapTaskFieldValuesToKeys(definitions, {
    'field-1': 3,
    'field-2': ['backend', 'api'],
    'orphan-field': 'should-drop',
  })

  assert.deepEqual(byKey, { hours: 3, labels: ['backend', 'api'] })
})

test('mapTaskFieldValuesToKeys returns empty map for empty definitions', () => {
  assert.deepEqual(mapTaskFieldValuesToKeys([], { 'field-1': 3 }), {})
})
