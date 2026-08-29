import type { CreatorIdentity, WorkspaceSession, Task } from '@shared/types'
import type { AgentMessageResult } from '../../integrations/opencode/task-chat-stream'
import { withState } from '../../routes/shared'
import type { TaskChatContextRef } from '@shared/task-chat-context'

export type TaskMessageResult = AgentMessageResult

export type TaskChatQueueClaim = {
  id: string
  claimId: string
  contextRefs?: TaskChatContextRef[]
  taskRunId?: string
  requestedByAgentId?: string
  sourceAgentEventId?: string
  author?: CreatorIdentity
}

export type ExecuteTaskChatTurnResult = {
  pendingTask: Task
  pendingSession?: WorkspaceSession
  nextTask: Task
  nextSession?: WorkspaceSession
  result: TaskMessageResult
  responseState: Awaited<ReturnType<typeof withState>>
}
