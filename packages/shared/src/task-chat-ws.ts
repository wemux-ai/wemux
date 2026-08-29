// [INPUT]: WS 消息输入
// [OUTPUT]: 消息契约
// [POS]: 任务对话 WS 协议
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import type { TaskChatPart } from './task-chat-part'
import type { TaskChatAttachment } from './task-chat-attachment'
import type { TaskChatContextRef } from './task-chat-context'
import type { TaskChatMessageRuntimeConfig } from './task-chat-session'

export type TaskChatWsClientMessage =
  | {
      type: 'task_chat.send'
      requestId: string
      message: string
      attachments?: TaskChatAttachment[]
      contextRefs?: TaskChatContextRef[]
      runtimeConfig?: TaskChatMessageRuntimeConfig
      launchId?: string
      turnId?: string
    }
  | {
      type: 'task_chat.stop'
      requestId: string
    }
  | {
      type: 'task_chat.queue.remove'
      requestId: string
      queueId: string
    }
  | {
      type: 'task_chat.message.delete'
      requestId: string
      messageId: string
    }
  | {
      type: 'task_chat.ping'
      requestId?: string
    }

export type TaskChatWsServerMessage =
  | {
      type: 'task_chat.subscribed'
      sessionKey: string
      resumed: boolean
    }
  | {
      type: 'task_chat.snapshot'
      sessionKey: string
      part: TaskChatPart
    }
  | {
      type: 'task_chat.event'
      sessionKey: string
      eventId: string
      sentAt: string
      part: TaskChatPart
    }
  | {
      type: 'task_chat.ack'
      requestId: string
      action: 'send' | 'stop' | 'queue.remove' | 'message.delete' | 'ping'
      status: 'accepted' | 'queued' | 'noop' | 'error'
      message?: string
    }
  | {
      type: 'task_chat.pong'
      requestId?: string
      at: string
    }
  | {
      type: 'task_chat.error'
      message: string
      requestId?: string
    }
