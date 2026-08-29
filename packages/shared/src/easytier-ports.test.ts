import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildEasyTierListenUrls,
  deriveMeshProxyPortFromLocalServerPort,
  deriveMeshProxyPortFromStableId,
  getEasyTierRpcPortal,
  resolveEasyTierPortProfile,
} from './easytier-ports'

test('resolveEasyTierPortProfile uses explicit profile first', () => {
  assert.equal(resolveEasyTierPortProfile({
    explicitProfile: 'dev',
    releaseChannel: 'production',
    publicBaseUrl: 'https://vibemux.com',
  }), 'development')
})

test('resolveEasyTierPortProfile infers preview and production from channel or URL', () => {
  assert.equal(resolveEasyTierPortProfile({ releaseChannel: 'preview' }), 'preview')
  assert.equal(resolveEasyTierPortProfile({ publicBaseUrl: 'https://wemux.xyz' }), 'preview')
  assert.equal(resolveEasyTierPortProfile({ cloudUrl: 'https://wemux.ai' }), 'production')
  // 兼容窗口：旧域名仍然识别
  assert.equal(resolveEasyTierPortProfile({ publicBaseUrl: 'https://vibemux.xyz' }), 'preview')
  assert.equal(resolveEasyTierPortProfile({ cloudUrl: 'https://vibemux.com' }), 'production')
})

test('resolveEasyTierPortProfile treats local development as development', () => {
  assert.equal(resolveEasyTierPortProfile({ nodeEnv: 'development' }), 'development')
})

test('buildEasyTierListenUrls returns separated environment defaults', () => {
  assert.deepEqual(buildEasyTierListenUrls('development'), [
    'tcp://0.0.0.0:11030',
    'udp://0.0.0.0:11030',
    'ws://0.0.0.0:11031',
    'wss://0.0.0.0:11032',
  ])
  assert.deepEqual(buildEasyTierListenUrls('preview'), [
    'tcp://0.0.0.0:11010',
    'udp://0.0.0.0:11010',
    'ws://0.0.0.0:11011',
    'wss://0.0.0.0:11012',
  ])
  assert.deepEqual(buildEasyTierListenUrls('production'), [
    'tcp://0.0.0.0:11020',
    'udp://0.0.0.0:11020',
    'ws://0.0.0.0:11021',
    'wss://0.0.0.0:11022',
  ])
})

test('getEasyTierRpcPortal returns separated worker-local defaults', () => {
  assert.equal(getEasyTierRpcPortal('development'), '127.0.0.1:15890')
  assert.equal(getEasyTierRpcPortal('preview'), '127.0.0.1:15888')
  assert.equal(getEasyTierRpcPortal('production'), '127.0.0.1:15889')
})

test('deriveMeshProxyPortFromLocalServerPort keeps mesh proxy ports stable per worker console port', () => {
  assert.equal(deriveMeshProxyPortFromLocalServerPort(48100), 39100)
  assert.equal(deriveMeshProxyPortFromLocalServerPort(48121), 39121)
  assert.equal(deriveMeshProxyPortFromLocalServerPort(48123), 39123)
  assert.equal(deriveMeshProxyPortFromLocalServerPort(undefined), 39080)
})

test('deriveMeshProxyPortFromStableId keeps mesh proxy ports stable per executor id', () => {
  assert.equal(deriveMeshProxyPortFromStableId('executor-a'), deriveMeshProxyPortFromStableId('executor-a'))
  assert.notEqual(deriveMeshProxyPortFromStableId('executor-a'), deriveMeshProxyPortFromStableId('executor-b'))
  assert.equal(deriveMeshProxyPortFromStableId(''), 39080)
})
