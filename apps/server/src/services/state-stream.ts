/**
 * [INPUT]: Scoped AppState subscribers, state snapshots, and resource invalidation signals.
 * [OUTPUT]: Debounced SSE state snapshots plus lightweight cache invalidation events.
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
}

type StateStreamInvalidation = 'project-workspaces'

const encoder = new TextEncoder()
const subscribers = new Map<string, StreamSubscriber>()
let pendingBroadcastState: AppState | null = null
let pendingBroadcastTimer: ReturnType<typeof setTimeout> | null = null
const pendingInvalidations = new Set<StateStreamInvalidation>()

const encodeEvent = (event: string, payload: unknown) => {
  return encoder.encode(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`)
}

const cleanupSubscriber = (id: string) => {
  const subscriber = subscribers.get(id)
  if (!subscriber) {
    return
  }

  clearInterval(subscriber.heartbeatId)
  subscribers.delete(id)
}

export const createStateStream = (
  selectState: (state: AppState) => AppState,
  getSnapshot: () => AppState,
  options?: {
    lastStateHash?: string
  },
) => {
  let subscriberId = ''

  return new ReadableStream<Uint8Array>({
    start(controller) {
      const id = crypto.randomUUID()
      subscriberId = id
      const heartbeatId = setInterval(() => {
        try {
          controller.enqueue(encodeEvent('ping', { at: new Date().toISOString() }))
        } catch {
          cleanupSubscriber(id)
        }
      }, 15000)

      subscribers.set(id, {
        id,
        controller,
        heartbeatId,
        selectState,
        lastPayload: undefined,
      })

      const snapshot = selectState(getSnapshot())
      const payload = JSON.stringify(snapshot)
      const subscriber = subscribers.get(id)
      if (subscriber) {
        subscriber.lastPayload = payload
      }
      if (!options?.lastStateHash || hashStatePayload(payload) !== options.lastStateHash) {
        controller.enqueue(encodeEvent('state', snapshot))
      }
    },
    cancel() {
      cleanupSubscriber(subscriberId)
    },
  })
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
          subscriber.controller.enqueue(encodeEvent('state', scopedState))
        }

        for (const invalidation of invalidations) {
          subscriber.controller.enqueue(encodeEvent('invalidate', {
            scope: invalidation,
            at: new Date().toISOString(),
          }))
        }
      } catch {
        cleanupSubscriber(id)
      }
    }
  }, 120)

  return
}
