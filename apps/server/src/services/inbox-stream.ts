/**
 * [INPUT]: Authenticated user/Agent subscriptions and local or cross-node inbox mutation signals.
 * [OUTPUT]: Recipient-scoped typed SSE events carrying item invalidations and actionable badge counts.
 * [POS]: Realtime fanout for the shared inbox, bridged through realtime_event_store across control-plane nodes.
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */
import type { InboxItem, InboxRecipientType } from '@shared/inbox'
import { publishRealtimeEvent } from '../storage/postgres/realtime-event-store'

export type InboxEventType = 'inbox.snapshot' | 'inbox.item.created' | 'inbox.item.updated' | 'inbox.badge.changed'

type InboxSubscriber = {
  id: string
  recipientType: InboxRecipientType
  recipientId: string
  controller: ReadableStreamDefaultController<Uint8Array>
  heartbeatId: ReturnType<typeof setInterval>
}

export type InboxChangePayload = {
  item?: InboxItem
  itemId?: string
  unreadGroups: number
}

const encoder = new TextEncoder()
const subscribers = new Map<string, InboxSubscriber>()

export const encodeInboxEvent = (event: string, payload: unknown) => (
  encoder.encode(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`)
)

const cleanupSubscriber = (id: string) => {
  const subscriber = subscribers.get(id)
  if (!subscriber) return
  clearInterval(subscriber.heartbeatId)
  subscribers.delete(id)
}

export const createInboxStream = (
  recipientId: string,
  recipientType: InboxRecipientType = 'user',
) => {
  let subscriberId = ''
  return new ReadableStream<Uint8Array>({
    start(controller) {
      const id = crypto.randomUUID()
      subscriberId = id
      const heartbeatId = setInterval(() => {
        try {
          controller.enqueue(encodeInboxEvent('ping', { at: new Date().toISOString() }))
        } catch {
          cleanupSubscriber(id)
        }
      }, 15_000)
      subscribers.set(id, { id, recipientType, recipientId, controller, heartbeatId })
      controller.enqueue(encodeInboxEvent('inbox.snapshot', { at: new Date().toISOString() }))
    },
    cancel() {
      cleanupSubscriber(subscriberId)
    },
  })
}

export const publishLocalInboxChange = (params: {
  recipientType: InboxRecipientType
  recipientId: string
  eventType: InboxEventType
  payload: InboxChangePayload
}) => {
  const body = { ...params.payload, at: new Date().toISOString() }
  for (const [id, subscriber] of subscribers) {
    if (
      subscriber.recipientType !== params.recipientType
      || subscriber.recipientId !== params.recipientId
    ) continue
    try {
      subscriber.controller.enqueue(encodeInboxEvent(params.eventType, body))
    } catch {
      cleanupSubscriber(id)
    }
  }
}

export const publishInboxChange = (
  recipientId: string,
  payload: InboxChangePayload,
  recipientType: InboxRecipientType = 'user',
) => {
  const eventType: InboxEventType = payload.item
    ? 'inbox.item.created'
    : payload.itemId
      ? 'inbox.item.updated'
      : 'inbox.badge.changed'
  publishLocalInboxChange({ recipientType, recipientId, eventType, payload })
  void publishRealtimeEvent({
    topic: 'inbox.changed',
    eventKey: `inbox:${recipientType}:${recipientId}:${crypto.randomUUID()}`,
    payload: { recipientType, recipientId, eventType, change: payload },
  }).catch((error) => console.error('[inbox-stream] cross-node publish failed', error))
}
