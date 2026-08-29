// [INPUT]: 消息分片输入
// [OUTPUT]: 分片契约
// [POS]: 任务对话分片类型
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import type { TaskChatDataParts } from './task-chat'

export type TaskChatPart =
  | {
      type: 'timeline_event'
      data: TaskChatDataParts['timeline_event']
    }
  | {
      type: 'task'
      data: TaskChatDataParts['task']
    }
  | {
      type: 'session'
      data: TaskChatDataParts['session']
    }
  | {
      type: 'notice'
      data: TaskChatDataParts['notice']
    }
  | {
      type: 'observation'
      data: TaskChatDataParts['observation']
    }
