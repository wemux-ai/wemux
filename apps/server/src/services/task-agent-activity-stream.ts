/**
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 * [INPUT]: Authorized task subscriptions, AgentTask mutations, and persisted transcript changes.
 * [OUTPUT]: Task-scoped activity/transcript SSE invalidation events with heartbeat cleanup.
 * [POS]: Process-local realtime fanout for task Agent execution logs.
 */
type TaskAgentActivitySubscriber = {
  id: string
  taskId: string
  controller: ReadableStreamDefaultController<Uint8Array>
  heartbeatId: ReturnType<typeof setInterval>
}

const encoder = new TextEncoder()
const subscribers = new Map<string, TaskAgentActivitySubscriber>()

export const encodeTaskAgentActivityEvent = (event: string, payload: unknown) => (
  encoder.encode(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`)
)

const cleanupSubscriber = (id: string) => {
  const subscriber = subscribers.get(id)
  if (!subscriber) return
  clearInterval(subscriber.heartbeatId)
  subscribers.delete(id)
}

export const createTaskAgentActivityStream = (taskId: string) => {
  let subscriberId = ''
  return new ReadableStream<Uint8Array>({
    start(controller) {
      const id = crypto.randomUUID()
      subscriberId = id
      const heartbeatId = setInterval(() => {
        try {
          controller.enqueue(encodeTaskAgentActivityEvent('ping', { at: new Date().toISOString() }))
        } catch {
          cleanupSubscriber(id)
        }
      }, 15_000)
      subscribers.set(id, { id, taskId, controller, heartbeatId })
      controller.enqueue(encodeTaskAgentActivityEvent('activity', { taskId, at: new Date().toISOString() }))
    },
    cancel() {
      cleanupSubscriber(subscriberId)
    },
  })
}

// ponytail: process-local fanout matches the existing notification/state SSE;
// bridge through realtime_event_store only when AgentTask mutations span nodes.
export const publishTaskAgentActivityChange = (taskId: string) => {
  for (const [id, subscriber] of subscribers) {
    if (subscriber.taskId !== taskId) continue
    try {
      subscriber.controller.enqueue(encodeTaskAgentActivityEvent('activity', { taskId, at: new Date().toISOString() }))
    } catch {
      cleanupSubscriber(id)
    }
  }
}

export const publishTaskAgentTranscriptChange = (taskId: string, eventId: string) => {
  for (const [id, subscriber] of subscribers) {
    if (subscriber.taskId !== taskId) continue
    try {
      subscriber.controller.enqueue(encodeTaskAgentActivityEvent('transcript', {
        taskId,
        eventId,
        updatedAt: new Date().toISOString(),
      }))
    } catch {
      cleanupSubscriber(id)
    }
  }
}
