import assert from 'node:assert/strict'
import test from 'node:test'
import type { PreviewTunnelFrame } from '@shared/types'
import { previewSessionService } from './preview-session-service'
import { previewTunnelService } from './preview-tunnel-service'

type SentTunnelPayload = PreviewTunnelFrame

class FakePreviewTunnelSocket {
  OPEN = 1
  readyState = 1
  bufferedAmount = 1024 * 1024
  sent: SentTunnelPayload[] = []

  send(data: string | Uint8Array | Buffer) {
    if (typeof data !== 'string') {
      assert.fail('expected preview tunnel test frame to be text')
    }
    this.sent.push(JSON.parse(data) as PreviewTunnelFrame)
  }

  close() {
    this.readyState = 3
  }
}

const waitFor = async (predicate: () => boolean) => {
  const deadline = Date.now() + 1_000
  while (Date.now() < deadline) {
    if (predicate()) {
      return
    }
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  assert.fail('timed out waiting for preview tunnel queue')
}

test('preview tunnel service negotiates 128KB chunks and prioritizes control frames ahead of bulk bodies', async () => {
  const originalConsoleError = console.error
  console.error = () => {}

  try {
    const created = previewSessionService.createOrReuseSession({
      previewId: 'preview-tunnel-service-priority',
      projectId: 'project-priority',
      taskId: 'task-priority',
      workspaceId: 'workspace-priority',
      workspaceSessionId: 'workspace-session-priority',
      executorId: 'executor-priority',
      ownerUserId: 'user-priority',
      source: {
        appUrl: 'http://127.0.0.1:4173/',
        targetProtocol: 'http',
        targetHost: '127.0.0.1',
        targetPort: 4173,
        targetBasePath: '/',
      },
      additionalSources: [],
      publicHost: 'priority-preview--preview-tunnel-service-priority.wemux.localtest.me:8989',
      publicUrl: 'http://priority-preview--preview-tunnel-service-priority.wemux.localtest.me:8989/',
    })

    assert.equal(created.created, true)
    previewSessionService.markTunnelConnected(created.session.id, 'connection-priority')

    const tunnelSocket = new FakePreviewTunnelSocket()
    previewTunnelService.registerConnection(created.session.id, 'connection-priority', tunnelSocket, {
      negotiatedChunkBytes: 128 * 1024,
    })

    const requestBody = 'a'.repeat(300_000)
    const responsePromise = previewTunnelService.proxyHttpRequest(
      created.session.id,
      new Request('https://preview.vibemux.local/upload?draft=1', {
        method: 'POST',
        headers: {
          'content-type': 'text/plain',
        },
        body: requestBody,
      }),
    )

    const gatewaySocket = {
      OPEN: 1,
      readyState: 1,
      send() {},
      close() {},
    }
    const wsStreamId = previewTunnelService.openGatewayWebSocket({
      previewSessionId: created.session.id,
      socket: gatewaySocket,
      pathWithQuery: '/hmr',
      headers: [],
      subprotocols: [],
    })
    assert.ok(wsStreamId)

    tunnelSocket.bufferedAmount = 0
    await waitFor(() => tunnelSocket.sent.length >= 6)

    const tunnelPayloadFrames = tunnelSocket.sent.filter((frame) => frame.type !== 'preview.tunnel.ping')
    const requestStartIndex = tunnelPayloadFrames.findIndex((frame) => frame.type === 'preview.http.request.start')
    const wsOpenIndex = tunnelPayloadFrames.findIndex((frame) => frame.type === 'preview.ws.open')
    const firstBodyIndex = tunnelPayloadFrames.findIndex((frame) => frame.type === 'preview.http.request.body')
    const endIndex = tunnelPayloadFrames.findIndex((frame) => frame.type === 'preview.http.request.end')

    assert.equal(requestStartIndex, 0)
    assert.ok(wsOpenIndex >= 0)
    assert.ok(firstBodyIndex > wsOpenIndex)
    assert.ok(endIndex > firstBodyIndex)

    const bodyFrames = tunnelPayloadFrames.filter((frame): frame is Extract<PreviewTunnelFrame, { type: 'preview.http.request.body' }> => (
      frame.type === 'preview.http.request.body'
    ))
    assert.equal(bodyFrames.length, 3)
    assert.ok(bodyFrames.every((frame, index) => frame.seq === index))
    assert.equal(Buffer.from(bodyFrames[0]?.data || '', 'base64').byteLength, 128 * 1024)
    assert.equal(Buffer.from(bodyFrames[1]?.data || '', 'base64').byteLength, 128 * 1024)

    const requestStart = tunnelPayloadFrames.find((frame): frame is Extract<PreviewTunnelFrame, { type: 'preview.http.request.start' }> => (
      frame.type === 'preview.http.request.start'
    ))
    assert.ok(requestStart)

    previewTunnelService.handleFrame({
      type: 'preview.http.response.start',
      previewSessionId: created.session.id,
      streamId: requestStart.streamId,
      sentAt: new Date().toISOString(),
      status: 200,
      headers: [['content-type', 'text/plain; charset=utf-8']],
    })
    previewTunnelService.handleFrame({
      type: 'preview.http.response.end',
      previewSessionId: created.session.id,
      streamId: requestStart.streamId,
      sentAt: new Date().toISOString(),
    })

    const response = await responsePromise
    assert.equal(response.status, 200)

    const dto = previewSessionService.toDto(previewSessionService.getSessionById(created.session.id)!)
    assert.equal(dto.tunnelMetrics?.negotiatedChunkBytes, 128 * 1024)
    assert.equal(dto.tunnelMetrics?.requestCount, 1)
    assert.equal(dto.tunnelMetrics?.requestBytes, 300_000)
    assert.equal(dto.tunnelMetrics?.activeStreams, 1)

    previewTunnelService.unregisterConnection(created.session.id, 'connection-priority', 'test done')
    const afterDisconnect = previewSessionService.toDto(previewSessionService.getSessionById(created.session.id)!)
    assert.equal(afterDisconnect.tunnelMetrics?.activeStreams, 0)
  } finally {
    console.error = originalConsoleError
  }
})
