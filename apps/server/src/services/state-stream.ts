/**
 * [INPUT]: Scoped AppState subscribers, state snapshots, and resource invalidation signals.
 * [OUTPUT]: Debounced SSE state snapshots with bounded queues and disconnect cleanup.
 * [POS]: Server realtime fanout for application state; resource payloads stay in their dedicated APIs.
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */
import type { AppState } from '@shared/types'
import { hashStatePayload } from '@shared/state-payload-hash'

type StreamSubscriber = {
  id: string
  controller: ReadableStreamDefaultController<Uint8Array>
  heartbeatId: ReturnType<typeof setInterval>
  selectState: (state: AppState) => AppState
  lastPayload?: string
  removeAbortListener?: () => void
}

type StateStreamInvalidation = 'project-workspaces'

const encoder = new TextEncoder()
const MAX_BUFFERED_BYTES = 8 * 1024 * 1024
const subscribers = new Map<string, StreamSubscriber>()
let pendingBroadcastState: AppState | null = null
let pendingBroadcastTimer: ReturnType<typeof setTimeout> | null = null
const pendingInvalidations = new Set<StateStreamInvalidation>()

const encodeEvent = (event: string, payload: unknown) => {
  return encoder.encode(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`)
}

const cleanupSubscriber = (id: string, error?: Error) => {
  const subscriber = subscribers.get(id)
  if (!subscriber) {
    return
  }

  clearInterval(subscriber.heartbeatId)
  subscriber.removeAbortListener?.()
  subscribers.delete(id)
  // Closing drains the backlog; erroring discards it immediately.
  if (error) subscriber.controller.error(error)
}

const enqueueEvent = (subscriber: StreamSubscriber, event: string, payload: unknown) => {
  const chunk = encodeEvent(event, payload)
  if (chunk.byteLength > (subscriber.controller.desiredSize ?? 0)) {
    console.warn('[state-stream] disconnected slow consumer', JSON.stringify({ event, frameBytes: chunk.byteLength }))
    cleanupSubscriber(subscriber.id, new Error('State stream consumer is too slow; reconnect for the latest state.'))
    return false
  }
  subscriber.controller.enqueue(chunk)
  return true
}

export const createStateStream = (
  selectState: (state: AppState) => AppState,
  getSnapshot: () => AppState,
  options?: {
    lastStateHash?: string
    signal?: AbortSignal
  },
) => {
  let subscriberId = ''

  return new ReadableStream<Uint8Array>({
    start(controller) {
      if (options?.signal?.aborted) {
        controller.error(new Error('State stream request aborted.'))
        return
      }
      const id = crypto.randomUUID()
      subscriberId = id
      const heartbeatId = setInterval(() => {
        try {
          const subscriber = subscribers.get(id)
          if (subscriber) enqueueEvent(subscriber, 'ping', { at: new Date().toISOString() })
        } catch {
          cleanupSubscriber(id, new Error('State stream heartbeat failed.'))
        }
      }, 15000)

      const abort = () => cleanupSubscriber(id, new Error('State stream request aborted.'))
      options?.signal?.addEventListener('abort', abort, { once: true })
      const subscriber: StreamSubscriber = {
        id,
        controller,
        heartbeatId,
        selectState,
        lastPayload: undefined,
        removeAbortListener: () => options?.signal?.removeEventListener('abort', abort),
      }
      subscribers.set(id, subscriber)

      try {
        const snapshot = selectState(getSnapshot())
        const payload = JSON.stringify(snapshot)
        subscriber.lastPayload = payload
        if (!options?.lastStateHash || hashStatePayload(payload) !== options.lastStateHash) {
          enqueueEvent(subscriber, 'state', snapshot)
        }
      } catch {
        cleanupSubscriber(id, new Error('State stream snapshot failed.'))
      }
    },
    cancel() {
      cleanupSubscriber(subscriberId)
    },
  }, { highWaterMark: MAX_BUFFERED_BYTES, size: (chunk) => chunk.byteLength })
}

export const broadcastState = (
  state: AppState,
  options?: {
    invalidation?: StateStreamInvalidation
  },
) => {
  pendingBroadcastState = state
  if (options?.invalidation) {
    pendingInvalidations.add(options.invalidation)
  }
  if (pendingBroadcastTimer) {
    return
  }

  pendingBroadcastTimer = setTimeout(() => {
    const nextState = pendingBroadcastState
    const invalidations = [...pendingInvalidations]
    pendingBroadcastState = null
    pendingBroadcastTimer = null
    pendingInvalidations.clear()
    if (!nextState) {
      return
    }

    for (const [id, subscriber] of subscribers.entries()) {
      try {
        const scopedState = subscriber.selectState(nextState)
        const payload = JSON.stringify(scopedState)
        if (subscriber.lastPayload !== payload) {
          subscriber.lastPayload = payload
          if (!enqueueEvent(subscriber, 'state', scopedState)) continue
        }

        for (const invalidation of invalidations) {
          if (!enqueueEvent(subscriber, 'invalidate', {
            scope: invalidation,
            at: new Date().toISOString(),
          })) break
        }
      } catch {
        cleanupSubscriber(id, new Error('State stream broadcast failed.'))
      }
    }
  }, 120)

  return
}
