import type { PoolClient } from 'pg'

import { getPool } from './db'

const STORAGE_CHANGE_CHANNEL = 'vibemux_storage_changes'
const RECONNECT_DELAY_MS = 1_000
const POLL_INTERVAL_MS = 5_000
const DRAIN_BATCH_SIZE = 1_000

export type StorageChangeEvent = {
  id: number
  tableName: string
  operation: 'INSERT' | 'UPDATE' | 'DELETE'
  eventKey?: string
  sourceNodeId?: string
  payload?: Record<string, unknown>
}

type StorageChangeListenerOptions = {
  onEvents: (events: StorageChangeEvent[]) => Promise<void>
}

let activeClient: PoolClient | null = null
let reconnectTimer: ReturnType<typeof setTimeout> | null = null
let pollTimer: ReturnType<typeof setInterval> | null = null
let stopped = true
let listening = false
let lastSeenEventId = 0
let drainPromise: Promise<void> | null = null
let drainRequested = false

const readLatestEventId = async (client: PoolClient) => {
  const result = await client.query<{ id: string }>(
    'SELECT COALESCE(MAX(id), 0)::text AS id FROM storage_change_events',
  )
  return Number(result.rows[0]?.id ?? 0)
}

const readEventBatch = async (client: PoolClient) => {
  const result = await client.query<{
    id: string
    table_name: string
    operation: StorageChangeEvent['operation']
    event_key: string | null
    source_node_id: string | null
    payload_json: Record<string, unknown> | null
  }>(
    `SELECT id::text, table_name, operation, event_key, source_node_id, payload_json
     FROM storage_change_events
     WHERE id > $1
     ORDER BY id ASC
     LIMIT $2`,
    [lastSeenEventId, DRAIN_BATCH_SIZE],
  )

  return result.rows.map((row) => ({
    id: Number(row.id),
    tableName: row.table_name,
    operation: row.operation,
    eventKey: row.event_key ?? undefined,
    sourceNodeId: row.source_node_id ?? undefined,
    payload: row.payload_json ?? undefined,
  }))
}

const releaseActiveClient = () => {
  const client = activeClient
  activeClient = null
  listening = false
  if (!client) {
    return
  }

  client.removeAllListeners('notification')
  client.removeAllListeners('error')
  client.removeAllListeners('end')
  client.release(true)
}

const requestDrain = (options: StorageChangeListenerOptions) => {
  drainRequested = true
  if (drainPromise || !activeClient || stopped) {
    return
  }

  drainPromise = (async () => {
    while (drainRequested && activeClient && !stopped) {
      drainRequested = false
      while (activeClient && !stopped) {
        const events = await readEventBatch(activeClient)
        if (events.length === 0) {
          break
        }

        await options.onEvents(events)
        lastSeenEventId = events.at(-1)?.id ?? lastSeenEventId
        if (events.length < DRAIN_BATCH_SIZE) {
          break
        }
      }
    }
  })()
    .catch((error) => {
      console.error('[storage-change] drain failed', error)
      scheduleReconnect(options)
    })
    .finally(() => {
      drainPromise = null
      if (drainRequested) {
        requestDrain(options)
      }
    })
}

const scheduleReconnect = (options: StorageChangeListenerOptions) => {
  if (stopped || reconnectTimer) {
    return
  }

  releaseActiveClient()
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null
    void connect(options)
  }, RECONNECT_DELAY_MS)
  reconnectTimer.unref?.()
}

const connect = async (options: StorageChangeListenerOptions) => {
  if (stopped || activeClient) {
    return
  }

  try {
    const client = await getPool().connect()
    activeClient = client
    client.on('notification', (message) => {
      if (message.channel === STORAGE_CHANGE_CHANNEL) {
        requestDrain(options)
      }
    })
    client.on('error', (error) => {
      console.error('[storage-change] listener connection failed', error)
      scheduleReconnect(options)
    })
    client.on('end', () => scheduleReconnect(options))
    await client.query(`LISTEN ${STORAGE_CHANGE_CHANNEL}`)
    listening = true

    if (lastSeenEventId === 0) {
      lastSeenEventId = await readLatestEventId(client)
    } else {
      requestDrain(options)
    }
    console.log(`[storage-change] listening after event ${lastSeenEventId}`)
  } catch (error) {
    console.error('[storage-change] listener startup failed', error)
    scheduleReconnect(options)
  }
}

export const startStorageChangeListener = async (options: StorageChangeListenerOptions) => {
  if (!stopped) {
    return
  }

  stopped = false
  await connect(options)
  pollTimer = setInterval(() => requestDrain(options), POLL_INTERVAL_MS)
  pollTimer.unref?.()
}

export const stopStorageChangeListener = async () => {
  stopped = true
  listening = false
  drainRequested = false
  if (reconnectTimer) {
    clearTimeout(reconnectTimer)
    reconnectTimer = null
  }
  if (pollTimer) {
    clearInterval(pollTimer)
    pollTimer = null
  }

  const client = activeClient
  activeClient = null
  if (client) {
    client.removeAllListeners('notification')
    client.removeAllListeners('error')
    client.removeAllListeners('end')
    await client.query(`UNLISTEN ${STORAGE_CHANGE_CHANNEL}`).catch(() => undefined)
    client.release()
  }
}

export const getStorageChangeListenerHealth = () => ({
  ok: !stopped && listening && activeClient !== null,
  running: !stopped,
  connected: listening && activeClient !== null,
  lastSeenEventId,
})

// listener lag = 库里最新事件 id - 本节点已处理 id（0 表示完全追上；>0 说明积压）。
export const getStorageChangeListenerLag = async (): Promise<number | null> => {
  try {
    const result = await getPool().query<{ latest: string | number }>('SELECT COALESCE(MAX(id), 0) AS latest FROM storage_change_events')
    const latest = Number(result.rows[0]?.latest ?? 0)
    return Math.max(0, latest - lastSeenEventId)
  } catch {
    return null
  }
}
