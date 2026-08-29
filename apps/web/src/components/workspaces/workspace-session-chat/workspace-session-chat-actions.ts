import type { WorkspaceSessionChatProps } from './workspace-session-chat-types'
import { useTaskChatState } from './workspace-session-chat-state'
import { useTaskChatMessageActions } from './workspace-session-chat-message-actions'
import { useTaskChatSettingsActions } from './workspace-session-chat-settings-actions'

type TaskChatActionsParams = Pick<
  WorkspaceSessionChatProps,
  | 'agentSettings'
  | 'busy'
  | 'launchId'
  | 'mentionProjects'
  | 'onAssignExecutor'
  | 'onWorkspaceSessionChange'
  | 'project'
  | 'task'
  | 'workspaceId'
  | 'workspaceOwnerUserId'
  | 'workspaceRepoPath'
  | 'workspaceRoot'
  | 'workspaceSession'
  | 'workspaceSessionId'
> & {
  state: ReturnType<typeof useTaskChatState>
}

export function useTaskChatActions(params: TaskChatActionsParams) {
  const messageActions = useTaskChatMessageActions(params)
  const settingsActions = useTaskChatSettingsActions({
    agentSettings: params.agentSettings,
    busy: params.busy,
    dispatchAgentScopedMessage: messageActions.dispatchAgentScopedMessage,
    onAssignExecutor: params.onAssignExecutor,
    state: params.state,
    submitPreparedMessage: messageActions.submitPreparedMessage,
    task: params.task,
    workspaceId: params.workspaceId,
    workspaceSessionId: params.workspaceSessionId,
  })

  return {
    ...messageActions,
    ...settingsActions,
  }
}
