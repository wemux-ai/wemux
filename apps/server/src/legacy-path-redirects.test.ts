import assert from 'node:assert/strict'
import test from 'node:test'
import { resolveLegacyPathRedirect } from './legacy-path-redirects'

const cases: Array<[string, string | null]> = [
  ['http://localhost/admin/users', null],
]

test('unknown admin routes are not redirected by the public core', () => {
  for (const [input, expected] of cases) {
    assert.equal(resolveLegacyPathRedirect(input), expected)
  }
})
