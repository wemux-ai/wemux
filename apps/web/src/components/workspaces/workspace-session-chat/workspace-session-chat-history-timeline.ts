import {
  mapWorkspaceSessionHistoryEventsToTimeline,
} from '../../../lib/workspace-session-chat-ui'
import type { WorkspaceSessionEventRecord } from '@shared/workspace-session-history'

export const buildWorkspaceHistoryTimeline = (params: {
  events: WorkspaceSessionEventRecord[]
  deletedTurnIds?: ReadonlySet<string>
}) => {
  const deletedTurnIds = params.deletedTurnIds ?? new Set<string>()
  return mapWorkspaceSessionHistoryEventsToTimeline(params.events)
    .filter((event) => !deletedTurnIds.has(event.turnId))
}
