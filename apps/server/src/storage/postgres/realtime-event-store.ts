import { sql } from 'drizzle-orm'

import { clusterConfig } from '../../cluster/config'
import { withDrizzleTransaction } from './drizzle-db'
import { storageChangeEvents } from './schema'

export type RealtimeEventTopic =
  | 'task-chat.part'
  | 'workspace-history.event'
  | 'workspace-history.runtime'
  | 'inbox.changed'
  | 'main-chat.event'
  | 'conversation.event'

export const publishRealtimeEvent = async (params: {
  topic: RealtimeEventTopic
  eventKey: string
  payload: Record<string, unknown>
}) => {
  await withDrizzleTransaction(async (tx) => {
    const inserted = await tx
      .insert(storageChangeEvents)
      .values({
        tableName: 'realtime_events',
        operation: 'INSERT',
        eventKey: params.eventKey,
        sourceNodeId: clusterConfig.nodeId,
        payloadJson: {
          topic: params.topic,
          ...params.payload,
        },
      })
      .onConflictDoNothing({ target: storageChangeEvents.eventKey })
      .returning({ id: storageChangeEvents.id })

    const eventId = inserted[0]?.id
    if (eventId) {
      await tx.execute(sql`SELECT pg_notify('vibemux_storage_changes', ${String(eventId)})`)
    }
  })
}
