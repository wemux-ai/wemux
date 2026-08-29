import assert from 'node:assert/strict'
import test from 'node:test'
import {
  resolveCanonicalLoopbackUrlForConfig,
  resolvePreviewEnvironment,
  resolveProductionEnvironment,
  resolveReviewCenterEnvironment,
  shouldUseCurrentOriginForLoopbackConfig,
} from './runtime-config'

test('resolvePreviewEnvironment enables preview for preview hosts', () => {
  assert.equal(resolvePreviewEnvironment({
    currentHostname: 'wemux.xyz',
    appBaseUrl: 'https://app.wemux.ai',
  }), true)

  assert.equal(resolvePreviewEnvironment({
    currentHostname: 'desktop-preview--abc.wemux.xyz',
    appBaseUrl: 'https://app.wemux.ai',
  }), true)
})

test('resolvePreviewEnvironment enables preview when app base url is the preview site', () => {
  assert.equal(resolvePreviewEnvironment({
    appBaseUrl: 'https://wemux.xyz',
  }), true)
})

test('resolvePreviewEnvironment keeps production hidden even if api/auth use preview domains', () => {
  assert.equal(resolvePreviewEnvironment({
    currentHostname: 'app.wemux.ai',
    appBaseUrl: 'https://app.wemux.ai',
  }), false)
})

test('resolveProductionEnvironment detects production hosts', () => {
  assert.equal(resolveProductionEnvironment({
    currentHostname: 'app.wemux.ai',
    appBaseUrl: 'https://wemux.xyz',
  }), true)

  assert.equal(resolveProductionEnvironment({
    appBaseUrl: 'https://wemux.ai',
  }), true)
})

test('resolveProductionEnvironment excludes preview hosts', () => {
  assert.equal(resolveProductionEnvironment({
    currentHostname: 'wemux.xyz',
    appBaseUrl: 'https://wemux.xyz',
  }), false)
})

test('resolveReviewCenterEnvironment only enables dev and preview environments', () => {
  assert.equal(resolveReviewCenterEnvironment({
    dev: true,
    currentHostname: 'app.wemux.ai',
    appBaseUrl: 'https://app.wemux.ai',
  }), true)

  assert.equal(resolveReviewCenterEnvironment({
    currentHostname: 'desktop-preview--abc.wemux.xyz',
    appBaseUrl: 'https://app.wemux.ai',
  }), true)

  assert.equal(resolveReviewCenterEnvironment({
    currentHostname: 'app.wemux.ai',
    appBaseUrl: 'https://app.wemux.ai',
  }), false)
})

test('shouldUseCurrentOriginForLoopbackConfig detects external tunnel over loopback config', () => {
  assert.equal(shouldUseCurrentOriginForLoopbackConfig({
    currentHostname: 'limitation-phones-bbs-thus.trycloudflare.com',
    configuredUrl: 'http://127.0.0.1:18989',
  }), true)
})

test('shouldUseCurrentOriginForLoopbackConfig keeps loopback hybrid hosts canonical', () => {
  assert.equal(shouldUseCurrentOriginForLoopbackConfig({
    currentHostname: '127.0.0.1',
    configuredUrl: 'http://127.0.0.1:18989',
  }), false)

  assert.equal(shouldUseCurrentOriginForLoopbackConfig({
    currentHostname: 'localhost',
    configuredUrl: 'http://127.0.0.1:18989',
  }), false)
})

test('resolveCanonicalLoopbackUrl keeps loopback hybrid pages on loopback when localtest config is stale', () => {
  assert.equal(
    resolveCanonicalLoopbackUrlForConfig({
      currentUrl: 'http://127.0.0.1:15173/login?next=%2Fworkspace',
      configuredBaseUrl: 'http://app.wemux.localtest.me:15173/api/identity',
    }),
    '',
  )
})
