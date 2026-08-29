import assert from 'node:assert/strict'
import test from 'node:test'
import {
  decodePreviewTunnelBinaryFrame,
  encodePreviewTunnelBinaryFrame,
  normalizePreviewTunnelChunkBytes,
  PREVIEW_TUNNEL_DEFAULT_CHUNK_BYTES,
  PREVIEW_TUNNEL_MAX_CHUNK_BYTES,
  PREVIEW_TUNNEL_MIN_CHUNK_BYTES,
  type PreviewTunnelBinaryFrameHeader,
} from './preview-tunnel'

test('encodes and decodes preview tunnel binary frames', () => {
  const header: PreviewTunnelBinaryFrameHeader = {
    type: 'preview.http.response.body.binary',
    previewSessionId: 'preview-1',
    streamId: 'stream-1',
    sentAt: '2026-05-15T00:00:00.000Z',
    seq: 3,
  }
  const payload = new Uint8Array([0, 1, 2, 254, 255])

  const frame = encodePreviewTunnelBinaryFrame(header, payload)
  const decoded = decodePreviewTunnelBinaryFrame(frame)

  assert.deepEqual(decoded?.header, header)
  assert.deepEqual(Array.from(decoded?.payload ?? []), Array.from(payload))
})

test('encodes and decodes preview websocket binary data frames', () => {
  const header: PreviewTunnelBinaryFrameHeader = {
    type: 'preview.ws.data.binary',
    previewSessionId: 'preview-1',
    streamId: 'ws-stream-1',
    sentAt: '2026-05-15T00:00:00.000Z',
    seq: 4,
  }
  const payload = new Uint8Array([82, 70, 66, 0, 3, 8])

  const frame = encodePreviewTunnelBinaryFrame(header, payload)
  const decoded = decodePreviewTunnelBinaryFrame(frame)

  assert.deepEqual(decoded?.header, header)
  assert.deepEqual(Array.from(decoded?.payload ?? []), Array.from(payload))
})

test('rejects truncated preview tunnel binary frames', () => {
  assert.equal(decodePreviewTunnelBinaryFrame(new Uint8Array([0, 0, 0])), null)
  assert.equal(decodePreviewTunnelBinaryFrame(new Uint8Array([0, 0, 0, 20])), null)
})

test('rejects preview tunnel binary frames with malformed headers', () => {
  const payload = new Uint8Array([1, 2, 3])

  assert.equal(decodePreviewTunnelBinaryFrame(encodePreviewTunnelBinaryFrame({
    type: 'preview.http.response.body.binary',
    previewSessionId: '',
    streamId: 'stream-1',
    sentAt: '2026-05-15T00:00:00.000Z',
    seq: 0,
  }, payload)), null)

  assert.equal(decodePreviewTunnelBinaryFrame(encodePreviewTunnelBinaryFrame({
    type: 'preview.http.response.body.binary',
    previewSessionId: 'preview-1',
    streamId: 'stream-1',
    sentAt: '2026-05-15T00:00:00.000Z',
    seq: -1,
  }, payload)), null)
})

test('normalizes negotiated preview tunnel chunk sizes into the supported range', () => {
  assert.equal(normalizePreviewTunnelChunkBytes(undefined), PREVIEW_TUNNEL_DEFAULT_CHUNK_BYTES)
  assert.equal(normalizePreviewTunnelChunkBytes(1), PREVIEW_TUNNEL_MIN_CHUNK_BYTES)
  assert.equal(normalizePreviewTunnelChunkBytes(PREVIEW_TUNNEL_MAX_CHUNK_BYTES + 1), PREVIEW_TUNNEL_MAX_CHUNK_BYTES)
  assert.equal(normalizePreviewTunnelChunkBytes(196_608.9), 196_608)
})
