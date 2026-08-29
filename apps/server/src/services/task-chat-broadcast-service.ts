// [INPUT]: 任务对话广播事件
// [OUTPUT]: 广播分发
// [POS]: 任务对话广播服务
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import type { TaskChatPart } from '@shared/task-chat-part'
import { publishTaskChatWsPart } from './task-chat-ws-service'
import { publishRealtimeEvent } from '../storage/postgres/realtime-event-store'

export const publishTaskChatPart = (sessionKey: string, part: TaskChatPart) => {
  publishTaskChatWsPart(sessionKey, part)
  void publishRealtimeEvent({
    topic: 'task-chat.part',
    eventKey: `task-chat:${crypto.randomUUID()}`,
    payload: { sessionKey, part },
  }).catch((error) => {
    console.error('[task-chat] failed to persist realtime event', error)
  })
}
