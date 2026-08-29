import assert from 'node:assert/strict'
import test from 'node:test'
import type { PreviewTunnelFrame } from '@shared/types'
import { injectPreviewNavigationBridge, localPreviewHttpProxy } from './local-http-proxy'

type SentFrame = PreviewTunnelFrame | Uint8Array

const createTunnelSocket = (sent: SentFrame[]) => ({
  sendControl(data: string | Uint8Array) {
    sent.push(typeof data === 'string' ? JSON.parse(data) as PreviewTunnelFrame : data)
  },
  sendInteractive(data: string | Uint8Array) {
    sent.push(typeof data === 'string' ? JSON.parse(data) as PreviewTunnelFrame : data)
  },
  sendBulk(data: string | Uint8Array) {
    sent.push(typeof data === 'string' ? JSON.parse(data) as PreviewTunnelFrame : data)
  },
})

const waitFor = async (predicate: () => boolean) => {
  const deadline = Date.now() + 1000
  while (Date.now() < deadline) {
    if (predicate()) {
      return
    }
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  assert.fail('timed out waiting for preview tunnel frame')
}

test('local preview proxy strips encoding metadata after fetch decodes upstream bodies', async () => {
  const originalFetch = globalThis.fetch
  const sent: SentFrame[] = []
  let upstreamAcceptEncoding = ''

  globalThis.fetch = (async (_input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    upstreamAcceptEncoding = new Headers(init?.headers).get('accept-encoding') || ''
    return new Response('plain svg', {
    status: 200,
    headers: {
      'content-type': 'image/svg+xml',
      'content-encoding': 'gzip',
      'content-length': '128',
      'cache-control': 'no-cache',
    },
    })
  }) as typeof fetch

  try {
    localPreviewHttpProxy.handleStart({
      frame: {
        type: 'preview.http.request.start',
        previewSessionId: 'preview-encoding',
        streamId: 'stream-encoding',
        sentAt: new Date().toISOString(),
        requestId: 'request-encoding',
        method: 'GET',
        pathWithQuery: '/next.svg',
        targetUrl: 'http://localhost:3000/',
        headers: [],
        hasBody: false,
      },
      socket: createTunnelSocket(sent),
      targetUrl: 'http://localhost:3000/',
      binaryPayloads: false,
    })

    await waitFor(() => sent.some((frame) => !(frame instanceof Uint8Array) && frame.type === 'preview.http.response.start'))
    const startFrame = sent.find((frame) => !(frame instanceof Uint8Array) && frame.type === 'preview.http.response.start')
    assert.ok(startFrame && !(startFrame instanceof Uint8Array))
    assert.equal(startFrame.type, 'preview.http.response.start')

    const headerNames = startFrame.headers.map(([name]) => name.toLowerCase())
    assert.ok(!headerNames.includes('content-encoding'))
    assert.ok(!headerNames.includes('content-length'))
    assert.ok(headerNames.includes('content-type'))
    assert.ok(headerNames.includes('cache-control'))
    assert.equal(upstreamAcceptEncoding, 'identity')
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('local preview proxy forwards post bodies without streaming fetch request bodies', async () => {
  const originalFetch = globalThis.fetch
  const sent: SentFrame[] = []
  let upstreamBody = ''
  let upstreamBodyIsReadableStream = false

  globalThis.fetch = (async (_input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    upstreamBodyIsReadableStream = init?.body instanceof ReadableStream
    upstreamBody = init?.body
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
    const socket = createTunnelSocket(sent)

    localPreviewHttpProxy.handleStart({
      frame: {
        type: 'preview.http.request.start',
        previewSessionId: 'preview-post',
        streamId: 'stream-post',
        sentAt: new Date().toISOString(),
        requestId: 'request-post',
        method: 'POST',
        pathWithQuery: '/api/auth/login',
        targetUrl: 'http://localhost:3005/',
        headers: [['content-type', 'application/json']],
        hasBody: true,
      },
      socket,
      targetUrl: 'http://localhost:3005/',
      binaryPayloads: false,
    })

    localPreviewHttpProxy.handleBody({
      type: 'preview.http.request.body',
      previewSessionId: 'preview-post',
      streamId: 'stream-post',
      sentAt: new Date().toISOString(),
      seq: 0,
      encoding: 'base64',
      data: Buffer.from('{"email":"qq@qq.com"').toString('base64'),
    })
    localPreviewHttpProxy.handleBody({
      type: 'preview.http.request.body',
      previewSessionId: 'preview-post',
      streamId: 'stream-post',
      sentAt: new Date().toISOString(),
      seq: 1,
      encoding: 'base64',
      data: Buffer.from(',"password":"secret"}').toString('base64'),
    })
    localPreviewHttpProxy.handleEnd({
      frame: {
        type: 'preview.http.request.end',
        previewSessionId: 'preview-post',
        streamId: 'stream-post',
        sentAt: new Date().toISOString(),
      },
    })

    await waitFor(() => sent.some((frame) => !(frame instanceof Uint8Array) && frame.type === 'preview.http.response.start'))

    assert.equal(upstreamBody, '{"email":"qq@qq.com","password":"secret"}')
    assert.equal(upstreamBodyIsReadableStream, false)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('local preview proxy preserves conditional request headers and forwards 304 responses without body frames', async () => {
  const originalFetch = globalThis.fetch
  const sent: SentFrame[] = []
  let upstreamIfNoneMatch = ''

  globalThis.fetch = (async (_input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    upstreamIfNoneMatch = new Headers(init?.headers).get('if-none-match') || ''
    return new Response(null, {
      status: 304,
      headers: {
        etag: '"preview-etag"',
        'cache-control': 'public, max-age=60',
      },
    })
  }) as typeof fetch

  try {
    localPreviewHttpProxy.handleStart({
      frame: {
        type: 'preview.http.request.start',
        previewSessionId: 'preview-conditional',
        streamId: 'stream-conditional',
        sentAt: new Date().toISOString(),
        requestId: 'request-conditional',
        method: 'GET',
        pathWithQuery: '/assets/app.js',
        targetUrl: 'http://localhost:3000/',
        headers: [['if-none-match', '"preview-etag"']],
        hasBody: false,
      },
      socket: createTunnelSocket(sent),
      targetUrl: 'http://localhost:3000/',
      binaryPayloads: false,
    })

    await waitFor(() => sent.some((frame) => !(frame instanceof Uint8Array) && frame.type === 'preview.http.response.end'))
    assert.equal(upstreamIfNoneMatch, '"preview-etag"')
    assert.equal(
      sent.filter((frame) => !(frame instanceof Uint8Array) && frame.type === 'preview.http.response.body').length,
      0,
    )
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('injectPreviewNavigationBridge inserts the navigation bridge into html documents only once', () => {
  const html = '<!doctype html><html><head><title>ShopWise</title></head><body><div>hello</div></body></html>'
  const injected = injectPreviewNavigationBridge(html)

  assert.ok(injected.includes('data-vibemux-preview-navigation-bridge'))
  assert.ok(injected.indexOf('data-vibemux-preview-navigation-bridge') < injected.indexOf('</head>'))
  assert.equal(injectPreviewNavigationBridge(injected), injected)
})
