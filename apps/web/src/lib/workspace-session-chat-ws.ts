import type { TaskChatPart } from '@shared/task-chat-part'
import type { TaskChatWsServerMessage } from '@shared/task-chat-ws'

export const parseWorkspaceSessionChatWsMessage = (raw: string) => {
  return JSON.parse(raw) as TaskChatWsServerMessage
}

export const getWorkspaceSessionChatWsPart = (message: TaskChatWsServerMessage): TaskChatPart | null => {
  if (message.type === 'task_chat.event' || message.type === 'task_chat.snapshot') {
    return message.part
  }

  return null
}
