import assert from 'node:assert/strict'
import test from 'node:test'
import { resolvePreviewTunnelWsUrl, toPreviewTunnelWsUrl } from './cloud-url'

test('toPreviewTunnelWsUrl builds a preview tunnel websocket from cloud url', () => {
  assert.equal(
    toPreviewTunnelWsUrl('http://127.0.0.1:18989'),
    'ws://127.0.0.1:18989/api/preview-tunnels/ws',
  )
  assert.equal(
    toPreviewTunnelWsUrl('https://wemux.xyz'),
    'wss://wemux.xyz/api/preview-tunnels/ws',
  )
})

test('resolvePreviewTunnelWsUrl prefers the worker cloud url when localtest host is not container-reachable', () => {
  assert.equal(
    resolvePreviewTunnelWsUrl({
      cloudUrl: 'http://host.docker.internal:18989',
      tunnelUrl: 'ws://app.wemux.localtest.me:18989/api/preview-tunnels/ws',
    }),
    'ws://host.docker.internal:18989/api/preview-tunnels/ws',
  )
})

test('resolvePreviewTunnelWsUrl prefers the worker cloud url when the server sends a docker service host', () => {
  assert.equal(
    resolvePreviewTunnelWsUrl({
      cloudUrl: 'http://127.0.0.1:18989',
      tunnelUrl: 'ws://server:18989/api/preview-tunnels/ws',
    }),
    'ws://127.0.0.1:18989/api/preview-tunnels/ws',
  )
})

test('resolvePreviewTunnelWsUrl prefers the worker cloud url when loopback would point at the worker container', () => {
  assert.equal(
    resolvePreviewTunnelWsUrl({
      cloudUrl: 'http://host.docker.internal:18989',
      tunnelUrl: 'ws://127.0.0.1:18989/api/preview-tunnels/ws',
    }),
    'ws://host.docker.internal:18989/api/preview-tunnels/ws',
  )
})

test('resolvePreviewTunnelWsUrl keeps the server-provided public tunnel url', () => {
  assert.equal(
    resolvePreviewTunnelWsUrl({
      cloudUrl: 'http://127.0.0.1:18989',
      tunnelUrl: 'wss://wemux.xyz/api/preview-tunnels/ws',
    }),
    'wss://wemux.xyz/api/preview-tunnels/ws',
  )
})

test('resolvePreviewTunnelWsUrl falls back when the server-provided url is invalid', () => {
  assert.equal(
    resolvePreviewTunnelWsUrl({
      cloudUrl: 'http://127.0.0.1:18989',
      tunnelUrl: 'not-a-url',
    }),
    'ws://127.0.0.1:18989/api/preview-tunnels/ws',
  )
})
