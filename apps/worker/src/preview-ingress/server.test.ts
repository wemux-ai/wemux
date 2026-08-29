import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import http from 'node:http'
import test from 'node:test'
import type { Duplex } from 'node:stream'
import { WebSocket, WebSocketServer } from 'ws'
import { previewIngressRegistry } from './registry'
import { startPreviewIngressServer } from './server'

const listen = async (server: http.Server, port = 0) => {
  await new Promise<void>((resolve) => server.listen(port, '127.0.0.1', resolve))
  const address = server.address()
  assert.ok(address && typeof address === 'object')
  return address.port
}

const close = async (server: http.Server) => {
  await new Promise<void>((resolve) => server.close(() => resolve()))
}

const requestText = async (params: {
  port: number
  path: string
  host?: string
  headers?: http.OutgoingHttpHeaders
}) => {
  return await new Promise<{ statusCode: number; body: string; headers: http.IncomingHttpHeaders }>((resolve, reject) => {
    const request = http.request({
      hostname: '127.0.0.1',
      port: params.port,
      path: params.path,
      method: 'GET',
      headers: {
        ...(params.host ? { host: params.host } : {}),
        ...(params.headers ?? {}),
      },
    }, (response) => {
      const chunks: Buffer[] = []
      response.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)))
      response.on('end', () => {
        resolve({
          statusCode: response.statusCode ?? 0,
          body: Buffer.concat(chunks).toString('utf8'),
          headers: response.headers,
        })
      })
    })
    request.on('error', reject)
    request.end()
  })
}

const startTerminalDirectTestServer = async () => {
  const terminalServer = http.createServer()
  const terminalWs = new WebSocketServer({ noServer: true })
  const sockets = new Set<WebSocket>()
  let observedTicket = ''
  terminalServer.on('upgrade', (request, socket, head) => {
    terminalWs.handleUpgrade(request, socket as Duplex, head, (clientSocket) => {
      sockets.add(clientSocket)
      clientSocket.on('close', () => sockets.delete(clientSocket))
      const url = new URL(request.url || '/', 'ws://127.0.0.1')
      observedTicket = url.searchParams.get('ticket') || ''
      clientSocket.send('terminal-ready')
    })
  })
  const port = await listen(terminalServer)
  return {
    port,
    sockets,
    getObservedTicket: () => observedTicket,
    close: async () => {
      for (const socket of sockets) {
        ;(socket as unknown as { terminate: () => void }).terminate()
      }
      await new Promise<void>((resolve) => {
        ;(terminalWs as unknown as { close: (callback: () => void) => void }).close(resolve)
      })
      await close(terminalServer)
    },
  }
}

const readWebSocketMessage = (url: string) => new Promise<string>((resolve, reject) => {
  const socket = new WebSocket(url)
  socket.on('message', (payload) => {
    resolve(String(payload))
    socket.close()
  })
  socket.on('error', reject)
})

const issueMeshPreviewAccessToken = (params: {
  previewSessionId: string
  workspaceId: string
  executorId: string
  secret: string
}) => {
  const payload = {
    kind: 'preview-mesh-access',
    previewSessionId: params.previewSessionId,
    workspaceId: params.workspaceId,
    executorId: params.executorId,
    exp: Date.now() + 60_000,
    iat: Date.now(),
    nonce: 'nonce',
  }
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url')
  const signature = createHmac('sha256', params.secret).update(encoded).digest('base64url')
  return `${encoded}.${signature}`
}

const issueMeshTerminalAccessToken = (params: {
  workspaceId: string
  terminalId: string
  executorId: string
  secret: string
}) => {
  const payload = {
    kind: 'terminal-mesh-access',
    workspaceId: params.workspaceId,
    terminalId: params.terminalId,
    executorId: params.executorId,
    exp: Date.now() + 60_000,
    iat: Date.now(),
    nonce: 'nonce',
  }
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url')
  const signature = createHmac('sha256', params.secret).update(encoded).digest('base64url')
  return `${encoded}.${signature}`
}

test('public Host requests are not served directly by worker ingress', async () => {
  const upstream = http.createServer((request, response) => {
    response.setHeader('content-type', 'text/plain')
    response.end(`upstream:${request.url}`)
  })
  const upstreamPort = await listen(upstream)
  const ingress = startPreviewIngressServer({
    port: 0,
    sharedSecret: 'secret',
    listenHost: '127.0.0.1',
  })
  const ingressPort = await new Promise<number>((resolve) => {
    ingress.on('listening', () => {
      const address = ingress.address()
      assert.ok(address && typeof address === 'object')
      resolve(address.port)
    })
  })

  previewIngressRegistry.register({
    previewSessionId: 'preview-direct-host',
    publicHost: 'shop-preview--abc.wemux.xyz',
    targetUrl: `http://127.0.0.1:${upstreamPort}`,
    transport: 'gateway-public-proxy',
  })

  try {
    const response = await requestText({
      port: ingressPort,
      path: '/catalog?sku=42',
      host: 'shop-preview--abc.wemux.xyz',
    })

    assert.equal(response.statusCode, 404)
    assert.match(response.body, /preview ingress endpoint not found/)
  } finally {
    previewIngressRegistry.unregister('preview-direct-host')
    await close(ingress)
    await close(upstream)
  }
})

test('gateway preview ingress api proxies registered targets with shared secret', async () => {
  const upstream = http.createServer((request, response) => {
    response.end(`upstream:${request.url}`)
  })
  const upstreamPort = await listen(upstream)
  const ingress = startPreviewIngressServer({
    port: 0,
    sharedSecret: 'secret',
    listenHost: '127.0.0.1',
  })
  const ingressPort = await new Promise<number>((resolve) => {
    ingress.on('listening', () => {
      const address = ingress.address()
      assert.ok(address && typeof address === 'object')
      resolve(address.port)
    })
  })

  previewIngressRegistry.register({
    previewSessionId: 'preview-public-proxy',
    targetUrl: `http://127.0.0.1:${upstreamPort}`,
    transport: 'gateway-public-proxy',
  })

  try {
    const response = await requestText({
      port: ingressPort,
      path: '/api/preview-ingress/http/preview-public-proxy',
      headers: {
        authorization: 'Bearer secret',
        'x-vibemux-preview-path': '/catalog?sku=42',
      },
    })

    assert.equal(response.statusCode, 200)
    assert.equal(response.body, 'upstream:/catalog?sku=42')
  } finally {
    previewIngressRegistry.unregister('preview-public-proxy')
    await close(ingress)
    await close(upstream)
  }
})

test('gateway preview ingress api remains protected by shared secret', async () => {
  const ingress = startPreviewIngressServer({
    port: 0,
    sharedSecret: 'secret',
    listenHost: '127.0.0.1',
  })
  const ingressPort = await new Promise<number>((resolve) => {
    ingress.on('listening', () => {
      const address = ingress.address()
      assert.ok(address && typeof address === 'object')
      resolve(address.port)
    })
  })

  try {
    const response = await requestText({
      port: ingressPort,
      path: '/api/preview-ingress/http/preview-1',
      headers: {
        'x-vibemux-preview-path': '/',
      },
    })

    assert.equal(response.statusCode, 401)
  } finally {
    await close(ingress)
  }
})

test('mesh preview proxy validates signed scoped token before proxying', async () => {
  const upstream = http.createServer((request, response) => {
    response.end(`mesh-upstream:${request.url}`)
  })
  const upstreamPort = await listen(upstream)
  const ingress = startPreviewIngressServer({
    port: 0,
    sharedSecret: 'secret',
    listenHost: '127.0.0.1',
  })
  const ingressPort = await new Promise<number>((resolve) => {
    ingress.on('listening', () => {
      const address = ingress.address()
      assert.ok(address && typeof address === 'object')
      resolve(address.port)
    })
  })

  previewIngressRegistry.register({
    previewSessionId: 'preview-mesh',
    workspaceId: 'workspace-1',
    executorId: 'executor-b',
    targetUrl: `http://127.0.0.1:${upstreamPort}/base`,
    transport: 'mesh-preview-proxy',
  })

  const token = issueMeshPreviewAccessToken({
    previewSessionId: 'preview-mesh',
    workspaceId: 'workspace-1',
    executorId: 'executor-b',
    secret: 'secret',
  })

  try {
    const response = await requestText({
      port: ingressPort,
      path: `/api/preview-mesh/http/preview-mesh/catalog?sku=42&vmx_mesh_token=${encodeURIComponent(token)}`,
    })

    assert.equal(response.statusCode, 200)
    assert.equal(response.body, 'mesh-upstream:/base/catalog?sku=42')

    const rejected = await requestText({
      port: ingressPort,
      path: '/api/preview-mesh/http/preview-mesh/catalog?vmx_mesh_token=bad',
    })
    assert.equal(rejected.statusCode, 401)
  } finally {
    previewIngressRegistry.unregister('preview-mesh')
    await close(ingress)
    await close(upstream)
  }
})

test('mesh terminal proxy validates signed token and relays to local terminal direct websocket', async () => {
  const terminal = await startTerminalDirectTestServer()

  const ingress = startPreviewIngressServer({
    port: 0,
    sharedSecret: 'secret',
    listenHost: '127.0.0.1',
    executorId: 'executor-b',
    terminalDirectWsUrl: `ws://127.0.0.1:${terminal.port}/api/terminal-direct/ws`,
  })
  const ingressPort = await new Promise<number>((resolve) => {
    ingress.on('listening', () => {
      const address = ingress.address()
      assert.ok(address && typeof address === 'object')
      resolve(address.port)
    })
  })
  const token = issueMeshTerminalAccessToken({
    workspaceId: 'workspace-1',
    terminalId: 'terminal-1',
    executorId: 'executor-b',
    secret: 'secret',
  })

  try {
    const message = await readWebSocketMessage(`ws://127.0.0.1:${ingressPort}/api/terminal-mesh/ws?ticket=ticket-1&vmx_mesh_token=${encodeURIComponent(token)}`)

    assert.equal(message, 'terminal-ready')
    assert.equal(terminal.getObservedTicket(), 'ticket-1')
  } finally {
    await close(ingress)
    await terminal.close()
  }
})

test('public terminal proxy relays ticket to local terminal direct websocket', async () => {
  const terminal = await startTerminalDirectTestServer()
  const ingress = startPreviewIngressServer({
    port: 0,
    sharedSecret: 'secret',
    listenHost: '127.0.0.1',
    executorId: 'executor-public',
    terminalDirectWsUrl: `ws://127.0.0.1:${terminal.port}/api/terminal-direct/ws`,
  })
  const ingressPort = await new Promise<number>((resolve) => {
    ingress.on('listening', () => {
      const address = ingress.address()
      assert.ok(address && typeof address === 'object')
      resolve(address.port)
    })
  })

  try {
    const message = await readWebSocketMessage(`ws://127.0.0.1:${ingressPort}/api/terminal-public/ws?ticket=ticket-public`)
    assert.equal(message, 'terminal-ready')
    assert.equal(terminal.getObservedTicket(), 'ticket-public')

    await assert.rejects(
      () => readWebSocketMessage(`ws://127.0.0.1:${ingressPort}/api/terminal-public/ws`),
    )
  } finally {
    await close(ingress)
    await terminal.close()
  }
})
