// [INPUT]: WS 消息输入
// [OUTPUT]: 消息契约
// [POS]: 会话历史 WS 协议
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import type {
  WorkspaceSessionEventRecord,
  WorkspaceSessionRuntimeSnapshot,
} from './workspace-session-history'

export type WorkspaceSessionHistoryWsServerMessage =
  | {
      type: 'workspace_session_history.subscribed'
      sessionId: string
      resumed: boolean
    }
  | {
      type: 'workspace_session_history.snapshot'
      sessionId: string
      runtime: WorkspaceSessionRuntimeSnapshot | null
      events: WorkspaceSessionEventRecord[]
      hasMoreBefore?: boolean
      hasMoreAfter?: boolean
      totalCount?: number
    }
  | {
      type: 'workspace_session_history.event'
      sessionId: string
      event: WorkspaceSessionEventRecord
    }
  | {
      type: 'workspace_session_history.runtime'
      sessionId: string
      runtime: WorkspaceSessionRuntimeSnapshot
    }
  | {
      type: 'workspace_session_history.error'
      message: string
    }
