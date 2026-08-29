/**
 * [INPUT]: Fake WebSocket + stubbed window/localStorage/timers。
 * [OUTPUT]: realtime-client 连接管理基础测试：引用计数共享连接、事件分发、断线重连带 lastSeq 游标、退订关闭。
 * [POS]: 统一实时客户端（feature P1）的行为等价回归层。
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { RealtimeClient, type ConversationWsEvent } from './realtime-client'

type WsMessageEvent = { data: string }

class FakeWebSocket {
  static instances: FakeWebSocket[] = []
  url: string
  closed = false
  onopen: (() => void) | null = null
  onmessage: ((event: WsMessageEvent) => void) | null = null
  onclose: (() => void) | null = null

  constructor(url: string) {
    this.url = url
    FakeWebSocket.instances.push(this)
  }

  close() {
    this.closed = true
    this.onclose?.()
  }

  static reset() {
    FakeWebSocket.instances = []
  }
}

const originalGlobals = {
  window: globalThis.window,
  localStorage: globalThis.localStorage,
  WebSocket: globalThis.WebSocket,
  setTimeout: globalThis.setTimeout,
  clearTimeout: globalThis.clearTimeout,
}

const storage = new Map<string, string>()
let pendingTimers: Array<{ fn: () => void; ms: number }> = []

const installTestGlobals = () => {
  storage.clear()
  pendingTimers = []
  FakeWebSocket.reset()

  Object.defineProperty(globalThis, 'window', {
    value: { location: { origin: 'http://localhost:8989', hostname: 'localhost', port: '8989', protocol: 'http:' } },
    configurable: true,
    writable: true,
  })
  Object.defineProperty(globalThis, 'localStorage', {
    value: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => { storage.set(key, value) },
      removeItem: (key: string) => { storage.delete(key) },
      clear: () => storage.clear(),
    },
    configurable: true,
    writable: true,
  })
  Object.defineProperty(globalThis, 'WebSocket', {
    value: FakeWebSocket as unknown as typeof WebSocket,
    configurable: true,
    writable: true,
  })
  Object.defineProperty(globalThis, 'setTimeout', {
    value: ((fn: () => void, ms?: number) => {
      pendingTimers.push({ fn, ms: ms ?? 0 })
      return pendingTimers.length
    }) as typeof setTimeout,
    configurable: true,
    writable: true,
  })
  Object.defineProperty(globalThis, 'clearTimeout', {
    value: () => undefined,
    configurable: true,
    writable: true,
  })

  storage.set('auth_token', 'test-token')
}

const restoreGlobals = () => {
  for (const [key, value] of Object.entries(originalGlobals)) {
    if (value === undefined) {
      delete (globalThis as Record<string, unknown>)[key]
    } else {
      Object.defineProperty(globalThis, key, { value, configurable: true, writable: true })
    }
  }
}

const flushTimers = () => {
  const timers = [...pendingTimers]
  pendingTimers = []
  for (const timer of timers) {
    timer.fn()
  }
}

const buildConversationEvent = (overrides: Partial<ConversationWsEvent> = {}): ConversationWsEvent => ({
  id: 'event-1',
  conversationId: 'c1',
  seq: 1,
  type: 'message.created',
  payload: { message: { id: 'm1', content: 'hello' } },
  createdAt: '2026-08-13T00:00:00.000Z',
  ...overrides,
})

test('subscribeConversation shares one socket across subscribers and closes on last unsubscribe', () => {
  installTestGlobals()
  try {
    const client = new RealtimeClient()
    const events: string[] = []
    const unsubscribeA = client.subscribeConversation('c1', {
      onEvent: () => events.push('a'),
    })
    const unsubscribeB = client.subscribeConversation('c1', {
      onEvent: () => events.push('b'),
    })

    // 两个订阅者共享同一条连接。
    assert.equal(FakeWebSocket.instances.length, 1)

    // 退订一个，连接仍保留。
    unsubscribeA()
    assert.equal(FakeWebSocket.instances[0].closed, false)

    // 最后一个退订 → 连接关闭。
    unsubscribeB()
    assert.equal(FakeWebSocket.instances[0].closed, true)
  } finally {
    restoreGlobals()
  }
})

test('conversation events are delivered to every subscriber', () => {
  installTestGlobals()
  try {
    const client = new RealtimeClient()
    const received: string[] = []
    const messageIdOf = (event: ConversationWsEvent) => (event.payload.message as { id?: string } | undefined)?.id ?? ''
    client.subscribeConversation('c1', { onEvent: (event) => received.push(`a:${messageIdOf(event)}`) })
    client.subscribeConversation('c1', { onEvent: (event) => received.push(`b:${messageIdOf(event)}`) })

    const socket = FakeWebSocket.instances[0]
    socket.onopen?.()
    socket.onmessage?.({ data: JSON.stringify({ type: 'conversation.event', conversationId: 'c1', event: buildConversationEvent() }) })

    assert.deepEqual(received, ['a:m1', 'b:m1'])
  } finally {
    restoreGlobals()
  }
})

test('reconnect reuses the lastSeq cursor on the fresh socket URL', () => {
  installTestGlobals()
  try {
    const client = new RealtimeClient()
    client.subscribeConversation('c1', { onEvent: () => undefined })

    const firstSocket = FakeWebSocket.instances[0]
    firstSocket.onopen?.()
    firstSocket.onmessage?.({ data: JSON.stringify({ type: 'conversation.event', conversationId: 'c1', event: buildConversationEvent({ seq: 7 }) }) })

    // 断线 → 触发定时重连（指数退避 2s 起步）。
    firstSocket.onclose?.()
    assert.equal(pendingTimers.length, 1)
    flushTimers()

    assert.equal(FakeWebSocket.instances.length, 2)
    assert.match(FakeWebSocket.instances[1].url, /lastSeq=7/)
  } finally {
    restoreGlobals()
  }
})

test('resumed=false on reconnect triggers onNeedsRefresh', () => {
  installTestGlobals()
  try {
    const client = new RealtimeClient()
    let refreshCount = 0
    client.subscribeConversation('c1', {
      onEvent: () => undefined,
      onNeedsRefresh: () => { refreshCount += 1 },
    })

    const firstSocket = FakeWebSocket.instances[0]
    firstSocket.onopen?.()
    firstSocket.onmessage?.({ data: JSON.stringify({ type: 'conversation.subscribed', conversationId: 'c1', resumed: true }) })
    assert.equal(refreshCount, 0)

    // 首次连接 resumed=false 不触发兜底（没有游标可比对）。
    firstSocket.onclose?.()
    flushTimers()
    const secondSocket = FakeWebSocket.instances[1]
    secondSocket.onopen?.()
    secondSocket.onmessage?.({ data: JSON.stringify({ type: 'conversation.subscribed', conversationId: 'c1', resumed: false }) })
    assert.equal(refreshCount, 1)
  } finally {
    restoreGlobals()
  }
})

test('subscribeInbox ignores empty auth and still refcounts', () => {
  installTestGlobals()
  try {
    storage.delete('auth_token')
    const client = new RealtimeClient()
    let connectedEvents: boolean[] = []
    const unsubscribe = client.subscribeInbox({
      onConnectedChange: (connected) => { connectedEvents.push(connected) },
    })
    // 无 token：SSE 连接会失败重试，但不崩溃；退订后引用计数归零。
    unsubscribe()
    connectedEvents = []
    assert.equal(connectedEvents.length, 0)
  } finally {
    restoreGlobals()
  }
})
