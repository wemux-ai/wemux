import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import type { Task, WorkspaceSession } from '@shared/types'
import { api } from '../../lib/api'
import { workspaceQueryKeys } from '../../lib/workspace-query-keys'
import type { WorkspaceListItem } from './workspaces-page-utils'

type UseWorkspaceSessionTokenSummaryOptions = {
  displayTask: Task | null
  enabled: boolean
  searchTask: Task | null
  selectedItem: WorkspaceListItem | null
  selectedWorkspaceSessionId?: string
  selectedWorkspaceSessions: WorkspaceSession[]
  selectedWorkspaceTask: Task | null
}

export function useWorkspaceSessionTokenSummary({
  displayTask,
  enabled,
  searchTask,
  selectedItem,
  selectedWorkspaceSessionId,
  selectedWorkspaceSessions,
  selectedWorkspaceTask,
}: UseWorkspaceSessionTokenSummaryOptions) {
  const queryClient = useQueryClient()
  const [workspaceSessionTokenSummaryById, setWorkspaceSessionTokenSummaryById] = useState<Record<string, string>>({})

  useEffect(() => {
    const targetWorkspaceSessionId = selectedWorkspaceSessionId?.trim() || selectedWorkspaceSessions[0]?.id || ''
    const targetWorkspaceSessions = targetWorkspaceSessionId
      ? selectedWorkspaceSessions.filter((session) => session.id === targetWorkspaceSessionId)
      : []

    if (!enabled || !selectedItem?.workspace.id || targetWorkspaceSessions.length === 0) {
      setWorkspaceSessionTokenSummaryById({})
      return
    }

    let cancelled = false
    void Promise.all(
      targetWorkspaceSessions.map(async (session) => {
        const taskId = selectedWorkspaceTask?.id ?? displayTask?.id ?? searchTask?.id
        const workspaceId = selectedItem.workspace.id
        const response = await queryClient.fetchQuery({
          queryKey: workspaceQueryKeys.modelUsageSummary('all', taskId, workspaceId, session.id),
          queryFn: () => api.getModelUsageSummary('all', {
            taskId,
            workspaceId,
            workspaceSessionId: session.id,
          }),
          staleTime: 30_000,
        }).catch(() => null)

        const totalTokens = response?.summary.totals.totalTokens ?? 0
        const runCount = response?.summary.totals.runCount ?? 0
        return [
          session.id,
          totalTokens > 0 ? `${totalTokens.toLocaleString()} tok · ${runCount}` : '',
        ] as const
      }),
    ).then((entries) => {
      if (cancelled) {
        return
      }

      setWorkspaceSessionTokenSummaryById(
        Object.fromEntries(entries.filter(([, summary]) => Boolean(summary))),
      )
    })

    return () => {
      cancelled = true
    }
  }, [
    displayTask?.id,
    enabled,
    queryClient,
    searchTask?.id,
    selectedItem?.workspace.id,
    selectedWorkspaceSessionId,
    selectedWorkspaceSessions,
    selectedWorkspaceTask?.id,
  ])

  return workspaceSessionTokenSummaryById
}
