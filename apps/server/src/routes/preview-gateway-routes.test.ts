import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildClusterPreviewGatewayRelayWebSocketUrl,
  buildClusterPreviewHttpRelayUrl,
  buildPreviewBootstrapRedirectUrl,
} from './preview-gateway-routes'

test('buildClusterPreviewHttpRelayUrl targets internal preview relay endpoint on the owning node', () => {
  assert.equal(
    buildClusterPreviewHttpRelayUrl({
      relayUrl: 'https://relay.example.com',
      previewSessionId: 'preview-1',
    }),
    'https://relay.example.com/api/internal/cluster/preview-sessions/preview-1/http-relay',
  )
})

test('buildClusterPreviewGatewayRelayWebSocketUrl upgrades node url to websocket relay endpoint', () => {
  assert.equal(
    buildClusterPreviewGatewayRelayWebSocketUrl({
      relayUrl: 'https://relay.example.com',
      previewSessionId: 'preview-1',
    }),
    'wss://relay.example.com/api/internal/cluster/preview-sessions/preview-1/gateway-relay/ws',
  )
})

test('buildPreviewBootstrapRedirectUrl keeps the current binding host for additional preview ports', () => {
  assert.equal(
    buildPreviewBootstrapRedirectUrl({
      publicUrl: 'http://mastra-shopping--preview--b5dfdk.wemux.localtest.me:18989/',
    } as any, 'http://mastra-shopping--preview--b5dfdk-4111.wemux.localtest.me:18989/?vmx_viewer_token=token-4111&tab=playground#top'),
    'http://mastra-shopping--preview--b5dfdk-4111.wemux.localtest.me:18989/?tab=playground#top',
  )
})
