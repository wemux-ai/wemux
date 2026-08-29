import { resolveWorkspaceSessionHistoryLatestPreviewText } from '@shared/workspace-session-history'
import type { WorkspaceSession } from '@shared/types'
import { resolveWorkspaceSessionLineageSummary } from './workspace-session-lineage'

export type WorkspaceSessionDisplaySummary = {
  kind: 'history' | 'lineage'
  text: string
  badgeLabel?: string
}

type WorkspaceSessionDisplaySummarySource = Pick<
  WorkspaceSession,
  'id' | 'title' | 'sessionOrigin' | 'forkMode' | 'forkedFromSessionId' | 'forkRevision' | 'historyProjection'
>

export const resolveWorkspaceSessionDisplaySummary = (
  session: WorkspaceSessionDisplaySummarySource,
  workspaceSessions: Pick<WorkspaceSession, 'id' | 'title'>[],
  options: {
    preferLineage?: boolean
  } = {},
): WorkspaceSessionDisplaySummary | null => {
  const lineageSummary = resolveWorkspaceSessionLineageSummary(session, workspaceSessions)
  const historyPreview = resolveWorkspaceSessionHistoryLatestPreviewText(session.historyProjection)?.trim() || ''

  if (options.preferLineage && lineageSummary) {
    return {
      kind: 'lineage',
      text: lineageSummary.description,
      badgeLabel: lineageSummary.badgeLabel,
    }
  }

  if (historyPreview) {
    return {
      kind: 'history',
      text: historyPreview,
    }
  }

  if (lineageSummary) {
    return {
      kind: 'lineage',
      text: lineageSummary.description,
      badgeLabel: lineageSummary.badgeLabel,
    }
  }

  return null
}
