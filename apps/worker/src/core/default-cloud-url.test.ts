import assert from 'node:assert/strict'
import test from 'node:test'
import {
  LEGACY_PREVIEW_CLOUD_URL,
  LEGACY_PRODUCTION_CLOUD_URL,
  WEMUX_PREVIEW_CLOUD_URL,
  WEMUX_PRODUCTION_CLOUD_URL,
  __setReachabilityProbeForTest,
  resolveDefaultCloudUrl,
  warmDefaultCloudUrlFallback,
} from './default-cloud-url'

test('resolveDefaultCloudUrl keeps wemux default when the wemux domain is reachable', async () => {
  __setReachabilityProbeForTest(async () => true)
  try {
    await warmDefaultCloudUrlFallback()
    assert.equal(resolveDefaultCloudUrl(WEMUX_PRODUCTION_CLOUD_URL), WEMUX_PRODUCTION_CLOUD_URL)
    assert.equal(resolveDefaultCloudUrl(WEMUX_PREVIEW_CLOUD_URL), WEMUX_PREVIEW_CLOUD_URL)
  } finally {
    __setReachabilityProbeForTest(null)
  }
})

test('resolveDefaultCloudUrl falls back to vibemux defaults when wemux is unreachable', async () => {
  __setReachabilityProbeForTest(async () => false)
  try {
    await warmDefaultCloudUrlFallback()
    assert.equal(resolveDefaultCloudUrl(WEMUX_PRODUCTION_CLOUD_URL), LEGACY_PRODUCTION_CLOUD_URL)
    assert.equal(resolveDefaultCloudUrl(WEMUX_PREVIEW_CLOUD_URL), LEGACY_PREVIEW_CLOUD_URL)
  } finally {
    __setReachabilityProbeForTest(null)
  }
})

test('resolveDefaultCloudUrl leaves non-default and explicit URLs untouched', async () => {
  __setReachabilityProbeForTest(async () => false)
  try {
    await warmDefaultCloudUrlFallback()
    assert.equal(resolveDefaultCloudUrl('https://custom.example.com'), 'https://custom.example.com')
    assert.equal(resolveDefaultCloudUrl('http://127.0.0.1:8989'), 'http://127.0.0.1:8989')
    assert.equal(resolveDefaultCloudUrl(LEGACY_PRODUCTION_CLOUD_URL), LEGACY_PRODUCTION_CLOUD_URL)
  } finally {
    __setReachabilityProbeForTest(null)
  }
})

test('warmDefaultCloudUrlFallback caches the probe result', async () => {
  let probeCalls = 0
  __setReachabilityProbeForTest(async () => {
    probeCalls += 1
    return false
  })
  try {
    await warmDefaultCloudUrlFallback()
    await warmDefaultCloudUrlFallback()
    assert.equal(probeCalls, 1)
  } finally {
    __setReachabilityProbeForTest(null)
  }
})
