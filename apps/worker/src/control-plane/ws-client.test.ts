import assert from 'node:assert/strict'
import test from 'node:test'
import { normalizeAgentSettings } from '@shared/agent-config'
import type { WorkerConfig } from '@shared/types'
import { connectWorkerWebSocket } from './ws-client'

class FakeWebSocket {
  static CONNECTING = 0
  static OPEN = 1
  static CLOSING = 2
  static CLOSED = 3

  readonly url: string
  readyState = FakeWebSocket.CONNECTING
  readonly sent: string[] = []
  private readonly listeners = new Map<string, Array<(event: unknown) => void>>()

  constructor(url: string) {
    this.url = url
  }

  addEventListener(type: string, listener: (event: unknown) => void) {
    const listeners = this.listeners.get(type) ?? []
    listeners.push(listener)
    this.listeners.set(type, listeners)
  }

  send(payload: string) {
    if (this.readyState !== FakeWebSocket.OPEN) {
      throw new DOMException('Sent before connected.', 'InvalidStateError')
    }

    this.sent.push(payload)
  }

  emit(type: string, event: unknown = {}) {
    const listeners = this.listeners.get(type) ?? []
    for (const listener of listeners) {
      listener(event)
    }
  }
}

const createWorkerConfig = (): WorkerConfig => ({
  cloudUrl: 'https://wemux.xyz',
  machineId: 'machine-1',
  machineName: 'worker-test',
  executorId: 'executor-1',
  executorToken: 'token-1',
  agentSettings: normalizeAgentSettings(),
  workspaceRoot: '/tmp/vibemux-worker-test',
  maxConcurrency: 1,
  labels: [],
  capabilities: [],
  localServerPort: 4310,
})

test('connectWorkerWebSocket skips sends until the socket is open', () => {
  const originalWebSocket = globalThis.WebSocket
  const sockets: FakeWebSocket[] = []
  const PatchedWebSocket = class extends FakeWebSocket {
    constructor(url: string) {
      super(url)
      sockets.push(this)
    }
  }

  globalThis.WebSocket = PatchedWebSocket as unknown as typeof WebSocket

  try {
    const errors: string[] = []
    const connection = connectWorkerWebSocket(createWorkerConfig(), {
      onError(message) {
        errors.push(message)
      },
    })

    const sent = connection.send({
      type: 'task.ack',
      taskId: 'task-1',
      idempotencyKey: 'task-1',
      executorId: 'executor-1',
      accepted: true,
    })

    assert.equal(sent, false)
    assert.deepEqual(errors, [])
    assert.equal(sockets[0]?.sent.length, 0)
  } finally {
    globalThis.WebSocket = originalWebSocket
  }
})

test('connectWorkerWebSocket sends after the socket opens', () => {
  const originalWebSocket = globalThis.WebSocket
  const sockets: FakeWebSocket[] = []
  const PatchedWebSocket = class extends FakeWebSocket {
    constructor(url: string) {
      super(url)
      sockets.push(this)
    }
  }

  globalThis.WebSocket = PatchedWebSocket as unknown as typeof WebSocket

  try {
    const connection = connectWorkerWebSocket(createWorkerConfig(), {})
    const socket = sockets[0]
    assert.ok(socket)

    socket.readyState = FakeWebSocket.OPEN
    socket.emit('open')

    const sent = connection.send({
      type: 'task.ack',
      taskId: 'task-1',
      idempotencyKey: 'task-1',
      executorId: 'executor-1',
      accepted: true,
    })

    assert.equal(sent, true)
    assert.equal(socket.sent.length, 1)
  } finally {
    globalThis.WebSocket = originalWebSocket
  }
})
