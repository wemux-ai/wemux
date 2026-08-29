import assert from 'node:assert/strict'
import test from 'node:test'
import { getNumberFlag, getStringFlag, hasFlag, parseCliArgs, parseCliFlags } from './cli-flags'

test('parseCliFlags keeps adjacent short flags separate', () => {
  const flags = parseCliFlags(['-f', '-n', '500', '--name', 'office-worker'])

  assert.equal(hasFlag(flags, 'f'), true)
  assert.equal(getNumberFlag(flags, 'n', 100), 500)
  assert.equal(getStringFlag(flags, 'name'), 'office-worker')
})

test('parseCliFlags treats valueless long flags as booleans', () => {
  const flags = parseCliFlags(['--check', '--errors-only'])

  assert.equal(hasFlag(flags, 'check'), true)
  assert.equal(hasFlag(flags, 'errors-only'), true)
})

test('parseCliArgs separates flags from positional text', () => {
  const parsed = parseCliArgs([
    'task-1',
    'fix',
    'the',
    'overflow',
    '--workspace=workspace-1',
    '--json',
  ])

  assert.deepEqual(parsed.positionals, ['task-1', 'fix', 'the', 'overflow'])
  assert.equal(getStringFlag(parsed.flags, 'workspace'), 'workspace-1')
  assert.equal(hasFlag(parsed.flags, 'json'), true)
})

test('parseCliArgs supports positional values after the option terminator', () => {
  const parsed = parseCliArgs(['task-1', '--', '--keep-this-in-the-message'])

  assert.deepEqual(parsed.positionals, ['task-1', '--keep-this-in-the-message'])
  assert.equal(parsed.flags.size, 0)
})
