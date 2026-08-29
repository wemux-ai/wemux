import assert from 'node:assert/strict'
import test from 'node:test'
import { executorRegistry } from './executor-registry'
import { executorWsService } from './executor-ws-service'
import {
  pendingAgentSessionLists,
  pendingAgentSessionReads,
  pendingConfigExports,
  pendingDesktopSandboxRequests,
  pendingRemoteCodeRequests,
  pendingRepoProbes,
  pendingTerminalLocalAttachTickets,
  type ExecutorSocket,
} from './executor-ws-service-state'

const createSocket = (): ExecutorSocket => ({
  OPEN: 1,
  readyState: 1,
  send() {},
  close() {},
})

test('socket replacement rejects old requests and stale close preserves new requests', () => {
  const executorId = 'executor-replaced-socket-test'
  const staleSocket = createSocket()
  const currentSocket = createSocket()
  const oldRequestId = 'request-on-stale-socket'
  const newRequestId = 'request-on-current-socket'
  let currentRegisteredSocket = staleSocket
  let oldRejected = false
  let newRejected = false
  const shouldHandleSocketCloseMock = test.mock.method(
    executorRegistry,
    'shouldHandleSocketClose',
    (candidate: ExecutorSocket) => candidate === currentRegisteredSocket,
  )

  pendingRepoProbes.set(oldRequestId, {
    executorId,
    resolve() {},
    reject() {
      oldRejected = true
    },
    timer: setTimeout(() => {}, 60_000),
  })

  try {
    executorWsService.onClose(executorId, staleSocket, { replacement: true })
    assert.equal(oldRejected, true)
    assert.equal(pendingRepoProbes.has(oldRequestId), false)

    currentRegisteredSocket = currentSocket
    pendingRepoProbes.set(newRequestId, {
      executorId,
      resolve() {},
      reject() {
        newRejected = true
      },
      timer: setTimeout(() => {}, 60_000),
    })
    executorWsService.onClose(executorId, staleSocket)
    assert.equal(newRejected, false)
    assert.equal(pendingRepoProbes.has(newRequestId), true)
  } finally {
    const pending = pendingRepoProbes.get(newRequestId)
    if (pending) clearTimeout(pending.timer)
    pendingRepoProbes.delete(oldRequestId)
    pendingRepoProbes.delete(newRequestId)
    shouldHandleSocketCloseMock.mock.restore()
  }
})

test('disconnect cleanup rejects every previously omitted request category', () => {
  type Pending = {
    executorId: string
    resolve: (value: never) => void
    reject: (reason?: unknown) => void
    timer: ReturnType<typeof setTimeout>
  }
  const executorId = 'executor-complete-cleanup-test'
  const pendingMaps = [
    pendingConfigExports,
    pendingAgentSessionLists,
    pendingAgentSessionReads,
    pendingDesktopSandboxRequests,
    pendingRemoteCodeRequests,
    pendingTerminalLocalAttachTickets,
  ] as Array<Map<string, Pending>>
  let rejected = 0

  for (const [index, pendingMap] of pendingMaps.entries()) {
    pendingMap.set(`omitted-request-${index}`, {
      executorId,
      resolve() {},
      reject() {
        rejected += 1
      },
      timer: setTimeout(() => {}, 60_000),
    })
  }

  executorWsService.onClose(executorId, createSocket(), { replacement: true })

  assert.equal(rejected, pendingMaps.length)
  for (const pendingMap of pendingMaps) {
    assert.equal(pendingMap.size, 0)
  }
})
