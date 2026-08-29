import type { McpServerPolicy } from '@shared/mcp'
import type { TaskChatAttachment } from '@shared/task-chat-attachment'
import type { TaskChatContextRef } from '@shared/task-chat-context'
import type {
  AgentSettings,
  AppState,
  CreatorIdentity,
  ExecutorRecord,
  Project,
  Task,
  WorkspaceSession,
  Workspace,
} from '@shared/types'
import type { AgentRecord } from '../../../lib/api'

export interface WorkspaceSessionChatProps {
  task: Task
  allTasks?: Task[]
  executors: ExecutorRecord[]
  agentSettings?: AgentSettings
  mcpServers?: McpServerPolicy[]
  project?: Project | null
  mentionProjects?: Project[]
  chrome?: 'card' | 'flush'
  hideHeader?: boolean
  inlineSessionTokenSummary?: string
  open: boolean
  preparingWorkspace?: boolean
  onTaskUpdate: (task: Task) => void
  onWorkspaceSessionChange?: (payload: {
    workspaceSessionId: string
    state: AppState
    task: Task
  }) => void
  onAssignExecutor: (
    taskId: string,
    executorNodeId: string,
    workspaceId?: string,
    workspaceSessionId?: string,
  ) => Promise<string | undefined> | string | undefined | void
  busy: boolean
  initialInput?: string
  launchId?: string
  workspaceId?: string
  workspaceSessionId?: string
  workspaceSession?: WorkspaceSession | null
  workspaceSessions?: WorkspaceSession[]
  workspaceWorkingDirectoryMode?: Workspace['workingDirectoryMode']
  workspaceBranchName?: string
  workspaceBaseBranch?: string
  workspaceCreatedBy?: CreatorIdentity
  workspaceOwnerUserId?: string
  workspaceRoot?: string
  workspaceRepoPath?: string
  activeExecutorId?: string
  activeExecutorName?: string
  onOpenWorkspaceFileLink?: (href: string) => boolean
  onForkFromMessage?: (messageId: string, mode: 'local' | 'worktree') => Promise<void>
  forkingMessageId?: string | null
  onReviseTurn?: (payload: WorkspaceSessionChatRevisionAction) => Promise<void>
  revisingTurnId?: string | null
}

export interface WorkspaceSessionKnownCollaborator {
  id: string
  name: string
  avatarUrl?: string
}

export type WorkspaceSessionChatDraftPayload = {
  text: string
  attachments?: TaskChatAttachment[]
  contextRefs?: TaskChatContextRef[]
}

export type WorkspaceSessionSelectedContextItem = {
  key: string
  kind: TaskChatContextRef['kind']
  label: string
  meta: string
  accentColor?: string
  ref: TaskChatContextRef
}

export interface WorkspaceSessionChatHandle {
  canSend: boolean
  prefillMessage: (text: string) => void
  prepareDraft: (payload: WorkspaceSessionChatDraftPayload) => void
  sendPreparedMessage: (payload: string | WorkspaceSessionChatDraftPayload) => Promise<boolean>
  refreshSessionView: (options?: {
    mode?: 'append-after-latest' | 'replace-latest'
    preserveMessagesOnError?: boolean
    limit?: number
  }) => Promise<void>
}

export type WorkspaceSessionChatRevisionAction =
  | {
      kind: 'rewrite-user-turn'
      turnId: string
      sourceMessageId: string
      text: string
      attachments: TaskChatAttachment[]
      mode: 'local' | 'worktree'
    }
  | {
      kind: 'retry-assistant-turn'
      turnId: string
      sourceMessageId: string
      userMessageId: string
      assistantMessageId?: string
      text: string
      attachments: TaskChatAttachment[]
      mode: 'local' | 'worktree'
    }

export type PendingAgentDispatch = {
  agent: AgentRecord
  mode: 'mention' | 'delegate'
  rawMessage: string
}

export interface ChatImage extends TaskChatAttachment {
  previewUrl?: string
  uploadState?: 'uploading' | 'failed'
  uploadProgress?: number
  uploadError?: string
}

export type WorkspaceSessionChatDraftMessage = {
  id: string
  content: string
  attachments: ChatImage[]
  createdAt: string
  editedAt?: string
}
