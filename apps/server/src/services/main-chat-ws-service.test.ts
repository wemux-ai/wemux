import assert from 'node:assert/strict'
import test from 'node:test'
import {
  clearMainChatWsStateForTests,
  registerMainChatWsConnection,
  type MainChatWsEvent,
  type MainChatWsServerMessage,
  type MainChatWsSocket,
} from './main-chat-ws-service'

const THREAD = 'test-thread-replay'

const event = (seq: number, type: 'delta' | 'status' = 'delta'): MainChatWsEvent => ({
  id: `e${seq}`,
  threadId: THREAD,
  seq,
  type,
  payload: { content: `chunk-${seq}` },
  createdAt: '2026-08-06T00:00:00.000Z',
})

const fakeSocket = () => {
  const sent: MainChatWsServerMessage[] = []
  const socket = {
    readyState: 1,
    OPEN: 1,
    send: (data: string) => {
      sent.push(JSON.parse(data) as MainChatWsServerMessage)
    },
    close: () => undefined,
  }
  return { socket: socket as unknown as MainChatWsSocket, sent }
}

const eventSeqs = (messages: MainChatWsServerMessage[]) => messages
  .filter((message) => message.type === 'main_chat.event')
  .map((message) => (message.type === 'main_chat.event' ? message.event.seq : -1))

const subscribedResumed = (messages: MainChatWsServerMessage[]) => {
  const subscribed = messages.find((message) => message.type === 'main_chat.subscribed')
  return subscribed?.type === 'main_chat.subscribed' ? subscribed.resumed : undefined
}

test('fresh connection without a cursor receives the full snapshot', () => {
  clearMainChatWsStateForTests()
  const { socket, sent } = fakeSocket()
  registerMainChatWsConnection({
    threadId: THREAD,
    socket,
    initialEvents: [event(1), event(2)],
  })

  assert.equal(sent[0]?.type, 'main_chat.snapshot')
  assert.equal(subscribedResumed(sent), false)
})

test('reconnect with lastSeq replays only the missed events as main_chat.event', () => {
  clearMainChatWsStateForTests()
  const initial = fakeSocket()
  registerMainChatWsConnection({
    threadId: THREAD,
    socket: initial.socket,
    initialEvents: [event(1), event(2), event(3)],
  })

  // 断线期间错过了 e2/e3，重连带 lastSeq=1 → 逐条重放。
  const resumed = fakeSocket()
  registerMainChatWsConnection({
    threadId: THREAD,
    socket: resumed.socket,
    lastSeq: 1,
  })

  assert.deepEqual(eventSeqs(resumed.sent), [2, 3])
  assert.equal(subscribedResumed(resumed.sent), true)
})

test('reconnect with a caught-up cursor falls back to the snapshot', () => {
  clearMainChatWsStateForTests()
  const initial = fakeSocket()
  registerMainChatWsConnection({
    threadId: THREAD,
    socket: initial.socket,
    initialEvents: [event(1), event(2), event(3)],
  })

  const caughtUp = fakeSocket()
  registerMainChatWsConnection({
    threadId: THREAD,
    socket: caughtUp.socket,
    lastSeq: 3,
  })

  assert.equal(caughtUp.sent[0]?.type, 'main_chat.snapshot')
  assert.equal(subscribedResumed(caughtUp.sent), false)
})
