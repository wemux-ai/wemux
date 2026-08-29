import assert from 'node:assert/strict'
import test from 'node:test'
import {
  encodePreviewTunnelBinaryFrame,
  type PreviewBindFrame,
  type PreviewTunnelFrame,
} from '@shared/types'
import { previewTunnelManager } from './manager'

type FakeWebSocketEvent = {
  data?: unknown
  code?: number
  reason?: string
}

type FakeWebSocketListener = (event: FakeWebSocketEvent) => void

class FakeWebSocket {
  static instances: FakeWebSocket[] = []

  OPEN = 1
  readyState = 0
  sent: Array<string | Uint8Array> = []
  private listeners = new Map<string, FakeWebSocketListener[]>()

  constructor(public url: string) {
    FakeWebSocket.instances.push(this)
  }

  addEventListener(type: string, listener: FakeWebSocketListener) {
    const listeners = this.listeners.get(type) ?? []
    listeners.push(listener)
    this.listeners.set(type, listeners)
  }

  send(data: string | Uint8Array) {
    this.sent.push(data)
  }

  close(code = 1000, reason = '') {
    this.readyState = 3
    this.emit('close', { code, reason })
  }

  open() {
    this.readyState = this.OPEN
    this.emit('open', {})
  }

  receive(data: unknown) {
    this.emit('message', { data })
  }

  private emit(type: string, event: FakeWebSocketEvent) {
    for (const listener of this.listeners.get(type) ?? []) {
      listener(event)
    }
  }
}

const waitFor = async (predicate: () => boolean) => {
  const deadline = Date.now() + 1000
  while (Date.now() < deadline) {
    if (predicate()) {
      return
    }
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  assert.fail('timed out waiting for preview tunnel manager')
}

test('preview tunnel manager preserves request body frame order before request end', async () => {
  const originalWebSocket = globalThis.WebSocket
  const originalFetch = globalThis.fetch
  FakeWebSocket.instances = []
  let receivedBody = ''

  globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket
  globalThis.fetch = (async (_input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    receivedBody = init?.body
      ? await new Response(init.body as BodyInit).text()
      : ''
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: {
        'content-type': 'application/json',
      },
    })
  }) as typeof fetch

  try {
    const emittedStatuses: string[] = []
    previewTunnelManager.open({
      type: 'preview.tunnel.open',
      previewSessionId: 'preview-post-body-order',
      tunnelUrl: 'ws://127.0.0.1:18989/api/preview-tunnels/ws',
      tunnelToken: 'token',
      targetUrl: 'http://127.0.0.1:3005/',
      at: new Date().toISOString(),
    }, {
      executorId: 'executor-1',
      cloudUrl: 'http://127.0.0.1:18989',
    } as never, (message) => {
      if (message.type === 'preview.tunnel.status') {
        emittedStatuses.push(message.status)
      }
      return true
    })

    const socket = FakeWebSocket.instances[0]
    assert.ok(socket)
    socket.open()

    await waitFor(() => socket.sent.length > 0)
    const bindFrame = JSON.parse(socket.sent[0] as string) as PreviewBindFrame
    assert.equal(bindFrame.type, 'preview.bind')
    assert.equal(bindFrame.preferredChunkBytes, 128 * 1024)
    socket.receive(JSON.stringify({
      type: 'preview.bind.ack',
      previewSessionId: 'preview-post-body-order',
      sentAt: new Date().toISOString(),
      accepted: true,
      reason: 'ok',
      connectionId: 'connection-1',
      maxChunkBytes: 128 * 1024,
      binaryPayloads: true,
    } satisfies PreviewTunnelFrame))
    await waitFor(() => emittedStatuses.includes('open'))

    socket.receive(JSON.stringify({
      type: 'preview.http.request.start',
      previewSessionId: 'preview-post-body-order',
      streamId: 'stream-1',
      sentAt: new Date().toISOString(),
      requestId: 'request-1',
      method: 'POST',
      pathWithQuery: '/api/auth/login',
      headers: [['content-type', 'application/json']],
      hasBody: true,
    } satisfies PreviewTunnelFrame))

    const bodyPayload = new TextEncoder().encode('{"email":"qq@qq.com","password":"secret"}')
    socket.receive(new Blob([
      encodePreviewTunnelBinaryFrame({
        type: 'preview.http.request.body.binary',
        previewSessionId: 'preview-post-body-order',
        streamId: 'stream-1',
        sentAt: new Date().toISOString(),
        seq: 0,
      }, bodyPayload),
    ]))
    socket.receive(JSON.stringify({
      type: 'preview.http.request.end',
      previewSessionId: 'preview-post-body-order',
      streamId: 'stream-1',
      sentAt: new Date().toISOString(),
    } satisfies PreviewTunnelFrame))

    await waitFor(() => receivedBody.includes('qq@qq.com'))
    assert.equal(receivedBody, '{"email":"qq@qq.com","password":"secret"}')
  } finally {
    previewTunnelManager.closeAll('test finished')
    globalThis.WebSocket = originalWebSocket
    globalThis.fetch = originalFetch
  }
})
