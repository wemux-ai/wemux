import assert from 'node:assert/strict'
import http from 'node:http'
import test from 'node:test'
import type { Duplex } from 'node:stream'
import type { WorkerConfig } from '@shared/types'
import { DEFAULT_AGENT_SETTINGS } from '@shared/agent-config'
import { WebSocket, WebSocketServer } from 'ws'
import { previewIngressController, resolveWorkerMeshProxyPort } from './controller'

const withEnv = (patch: Record<string, string | undefined>, run: () => void) => {
  const previous = new Map<string, string | undefined>()
  for (const key of Object.keys(patch)) {
    previous.set(key, process.env[key])
    if (patch[key] === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = patch[key]
    }
  }

  try {
    run()
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) {
        delete process.env[key]
      } else {
        process.env[key] = value
      }
    }
  }
}

const listen = async (server: http.Server, port = 0) => {
  await new Promise<void>((resolve) => server.listen(port, '127.0.0.1', resolve))
  const address = server.address()
  assert.ok(address && typeof address === 'object')
  return address.port
}

const close = async (server: http.Server) => {
  await new Promise<void>((resolve) => server.close(() => resolve()))
}

const reservePort = async () => {
  const server = http.createServer()
  const port = await listen(server)
  await close(server)
  return port
}

const startTerminalDirectTestServer = async () => {
  const terminalServer = http.createServer()
  const terminalWs = new WebSocketServer({ noServer: true })
  const sockets = new Set<WebSocket>()
  let observedOrigin = ''
  let observedTicket = ''

  terminalServer.on('upgrade', (request, socket, head) => {
    terminalWs.handleUpgrade(request, socket as Duplex, head, (clientSocket) => {
      sockets.add(clientSocket)
      clientSocket.on('close', () => sockets.delete(clientSocket))
      const url = new URL(request.url || '/', 'ws://127.0.0.1')
      observedOrigin = String(request.headers.origin || '')
      observedTicket = url.searchParams.get('ticket') || ''
      clientSocket.send('terminal-ready')
    })
  })

  const port = await listen(terminalServer)
  return {
    port,
    getObservedOrigin: () => observedOrigin,
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

const buildWorkerConfig = (patch: Partial<WorkerConfig> = {}): WorkerConfig => ({
  cloudUrl: 'http://127.0.0.1:8989',
  machineId: 'machine-1',
  machineName: 'machine',
  executorId: 'executor-1',
  executorName: 'executor',
  agentSettings: structuredClone(DEFAULT_AGENT_SETTINGS),
  workspaceRoot: '/tmp/vibemux-worker-test',
  maxConcurrency: 1,
  labels: [],
  capabilities: [],
  localServerPort: 48121,
  previewExposureMode: 'private',
  previewProxySecret: 'secret',
  ...patch,
})

test('resolveWorkerMeshProxyPort follows the actual local worker port by default', () => {
  withEnv({
    VIBEMUX_EASYTIER_PREVIEW_PROXY_PORT: undefined,
  }, () => {
    assert.equal(resolveWorkerMeshProxyPort({
      localServerPort: 48121,
      meshEnrollment: {
        enabled: true,
        peers: [],
        previewProxyPort: 39080,
      },
    }), 39121)
  })
})

test('resolveWorkerMeshProxyPort honors an explicit local mesh proxy env override', () => {
  withEnv({
    VIBEMUX_EASYTIER_PREVIEW_PROXY_PORT: '39080',
  }, () => {
    assert.equal(resolveWorkerMeshProxyPort({
      localServerPort: 48121,
      meshEnrollment: {
        enabled: true,
        peers: [],
        previewProxyPort: 39080,
      },
    }), 39080)
  })
})

test('preview ingress controller wires public terminal gateway to local terminal direct', async (t) => {
  const terminal = await startTerminalDirectTestServer()
  t.after(async () => {
    await previewIngressController.shutdown()
    await terminal.close()
  })

  const previousFetch = globalThis.fetch
  t.after(() => {
    globalThis.fetch = previousFetch
  })
  globalThis.fetch = async () => new Response('127.0.0.1')

  const ingressPort = await reservePort()
  const result = await previewIngressController.reconcile(buildWorkerConfig({
    localServerPort: terminal.port,
    previewExposureMode: 'public-ingress',
    previewIngressPort: ingressPort,
    previewProxySecret: 'secret',
  }))
  assert.equal(result.enabled, true)

  const message = await readWebSocketMessage(`ws://127.0.0.1:${ingressPort}/api/terminal-public/ws?ticket=public-ticket`)
  assert.equal(message, 'terminal-ready')
  assert.equal(terminal.getObservedTicket(), 'public-ticket')
  assert.equal(terminal.getObservedOrigin(), `http://127.0.0.1:${terminal.port}`)
})
