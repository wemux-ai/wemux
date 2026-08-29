import assert from 'node:assert/strict'
import test from 'node:test'

;(globalThis as typeof globalThis & {
  __APP_BUILD_ID__?: string
  __APP_VERSION__?: string
}).__APP_BUILD_ID__ = '0.2.81-oldbuild'
;(globalThis as typeof globalThis & {
  __APP_BUILD_ID__?: string
  __APP_VERSION__?: string
}).__APP_VERSION__ = '0.2.81'

const { isRemoteBuildUpdateAvailable } = await import('./register-service-worker')

test('isRemoteBuildUpdateAvailable detects a newer deployed build id', () => {
  assert.equal(isRemoteBuildUpdateAvailable({ buildId: '0.2.81-newbuild' }, '0.2.81-oldbuild'), true)
})

test('isRemoteBuildUpdateAvailable ignores the current build id', () => {
  assert.equal(isRemoteBuildUpdateAvailable({ buildId: '0.2.81-oldbuild' }, '0.2.81-oldbuild'), false)
})

test('isRemoteBuildUpdateAvailable ignores missing or blank remote build ids', () => {
  assert.equal(isRemoteBuildUpdateAvailable({}, '0.2.81-oldbuild'), false)
  assert.equal(isRemoteBuildUpdateAvailable({ buildId: '  ' }, '0.2.81-oldbuild'), false)
})
