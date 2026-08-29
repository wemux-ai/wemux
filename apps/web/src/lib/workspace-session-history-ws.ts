import type { WorkspaceSessionHistoryWsServerMessage } from '@shared/workspace-session-history-ws'

export const parseWorkspaceSessionHistoryWsMessage = (raw: string) => {
  return JSON.parse(raw) as WorkspaceSessionHistoryWsServerMessage
}
