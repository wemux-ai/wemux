import { useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import type { AppState, ExecutorAgentSessionDetail, ExecutorAgentSessionSummary, Task, WorkspaceSession } from '@shared/types'
import { api } from '../../lib/api'
import { workspaceQueryKeys } from '../../lib/workspace-query-keys'
import { areRuntimePathsRelated, buildImportAgentSessionKey } from './workspaces-page-helpers'
import type { WorkspaceListItem } from './workspaces-page-utils'

type WorkspaceLocalSessionBrowserOptions = {
  selectedItem: WorkspaceListItem | null
  selectedWorkspaceCandidateCwds: string[]
  selectedWorkspaceExecutorId: string
  selectedWorkspaceSession: WorkspaceSession | null
  selectedWorkspaceTask: Task | null
  t: (key: string, options?: Record<string, unknown>) => string
  onShowChatView: () => void
  clearPendingWorkspaceSessionSelection: () => void
  setSelectedWorkspaceSessionId: (workspaceSessionId: string) => void
  setWorkspacePrimaryViewState: (workspaceId: string | undefined, view: 'chat' | 'records') => void
  updateWorkspaceSearch: (patch: { taskId?: string | undefined; workspaceSessionId?: string | undefined; panel?: 'records' | undefined }) => void
  refreshWorkspaceSessionView: () => Promise<void>
  runMutation: <T extends { state: AppState; message?: string }>(action: () => Promise<T>) => Promise<T | undefined>
}

export function useWorkspacesLocalSessionBrowser({
  selectedItem,
  selectedWorkspaceCandidateCwds,
  selectedWorkspaceExecutorId,
  selectedWorkspaceSession,
  selectedWorkspaceTask,
  t,
  onShowChatView,
  clearPendingWorkspaceSessionSelection,
  setSelectedWorkspaceSessionId,
  setWorkspacePrimaryViewState,
  updateWorkspaceSearch,
  refreshWorkspaceSessionView,
  runMutation,
}: WorkspaceLocalSessionBrowserOptions) {
  const queryClient = useQueryClient()
  const [localSessionsOpen, setLocalSessionsOpen] = useState(false)
  const [localSessionsLoading, setLocalSessionsLoading] = useState(false)
  const [localSessionsRefreshing, setLocalSessionsRefreshing] = useState(false)
  const [localSessionDetailLoading, setLocalSessionDetailLoading] = useState(false)
  const [localSessionImporting, setLocalSessionImporting] = useState(false)
  const [detectedLocalSessions, setDetectedLocalSessions] = useState<ExecutorAgentSessionSummary[]>([])
  const [selectedLocalSessionKey, setSelectedLocalSessionKey] = useState('')
  const [selectedLocalSessionDetail, setSelectedLocalSessionDetail] = useState<ExecutorAgentSessionDetail | null>(null)
  const localSessionListRequestIdRef = useRef(0)
  const localSessionDetailRequestIdRef = useRef(0)

  const visibleLocalSessions = useMemo(
    () => detectedLocalSessions.filter((session) => {
      if (selectedWorkspaceCandidateCwds.length < 1) {
        return false
      }

      return selectedWorkspaceCandidateCwds.some((cwd) => areRuntimePathsRelated(session.cwd, cwd))
    }),
    [detectedLocalSessions, selectedWorkspaceCandidateCwds],
  )

  const selectedLocalSessionSummary = useMemo(
    () => visibleLocalSessions.find((session) => buildImportAgentSessionKey(session) === selectedLocalSessionKey) ?? null,
    [selectedLocalSessionKey, visibleLocalSessions],
  )

  const clearSelectedLocalSessionPreview = useCallback(() => {
    localSessionDetailRequestIdRef.current += 1
    setLocalSessionDetailLoading(false)
    setSelectedLocalSessionKey('')
    setSelectedLocalSessionDetail(null)
  }, [])

  const resetLocalSessionBrowser = useCallback(() => {
    localSessionListRequestIdRef.current += 1
    localSessionDetailRequestIdRef.current += 1
    setLocalSessionsLoading(false)
    setLocalSessionsRefreshing(false)
    setLocalSessionDetailLoading(false)
    setLocalSessionImporting(false)
    setDetectedLocalSessions([])
    setSelectedLocalSessionKey('')
    setSelectedLocalSessionDetail(null)
  }, [])

  const loadLocalSessionDetail = useCallback(async (session: ExecutorAgentSessionSummary) => {
    if (!selectedWorkspaceTask || !selectedItem || !selectedWorkspaceExecutorId) {
      return
    }

    const requestId = localSessionDetailRequestIdRef.current + 1
    localSessionDetailRequestIdRef.current = requestId
    setLocalSessionDetailLoading(true)
    try {
      const response = await queryClient.fetchQuery({
        queryKey: workspaceQueryKeys.importableAgentSession(
          selectedWorkspaceTask.id,
          selectedItem.workspace.id,
          selectedWorkspaceSession?.id,
          selectedWorkspaceExecutorId,
          session.source,
          session.id,
        ),
        queryFn: () => api.getImportableAgentSession(selectedWorkspaceTask.id, {
          workspaceId: selectedItem.workspace.id,
          workspaceSessionId: selectedWorkspaceSession?.id,
          executorId: selectedWorkspaceExecutorId,
          source: session.source,
          sessionId: session.id,
        }),
        staleTime: 5_000,
      })
      if (!response.ok || !response.session) {
        throw new Error(response.message || t('workspace.importAgentSession.detailFailed', { defaultValue: '读取节点聊天记录详情失败。' }))
      }
      if (localSessionDetailRequestIdRef.current !== requestId) {
        return
      }

      setSelectedLocalSessionKey(buildImportAgentSessionKey(session))
      setSelectedLocalSessionDetail(response.session)
    } finally {
      if (localSessionDetailRequestIdRef.current === requestId) {
        setLocalSessionDetailLoading(false)
      }
    }
  }, [queryClient, selectedItem, selectedWorkspaceExecutorId, selectedWorkspaceSession?.id, selectedWorkspaceTask, t])

  const loadLocalSessions = useCallback(async (refresh = false) => {
    if (!selectedWorkspaceTask || !selectedItem || !selectedWorkspaceExecutorId) {
      return
    }

    const requestId = localSessionListRequestIdRef.current + 1
    localSessionListRequestIdRef.current = requestId
    if (refresh) {
      setLocalSessionsRefreshing(true)
    } else {
      setLocalSessionsLoading(true)
    }

    try {
      const queryKey = workspaceQueryKeys.importableAgentSessions(
        selectedWorkspaceTask.id,
        selectedItem.workspace.id,
        selectedWorkspaceSession?.id,
        selectedWorkspaceExecutorId,
      )
      if (refresh) {
        await queryClient.invalidateQueries({ queryKey, exact: true })
      }
      const response = await queryClient.fetchQuery({
        queryKey,
        queryFn: () => api.listImportableAgentSessions(
          selectedWorkspaceTask.id,
          selectedItem.workspace.id,
          selectedWorkspaceSession?.id,
          selectedWorkspaceExecutorId,
        ),
        staleTime: 5_000,
      })
      if (!response.ok) {
        throw new Error(response.message || t('workspace.importAgentSession.listFailed', { defaultValue: '读取节点聊天记录失败。' }))
      }
      if (localSessionListRequestIdRef.current !== requestId) {
        return
      }

      setDetectedLocalSessions(response.sessions)
    } finally {
      if (localSessionListRequestIdRef.current === requestId) {
        setLocalSessionsLoading(false)
        setLocalSessionsRefreshing(false)
      }
    }
  }, [queryClient, selectedItem, selectedWorkspaceExecutorId, selectedWorkspaceSession?.id, selectedWorkspaceTask, t])

  const handleToggleLocalSessions = useCallback(() => {
    const nextOpen = !localSessionsOpen
    setLocalSessionsOpen(nextOpen)
    if (!nextOpen || detectedLocalSessions.length > 0 || localSessionsLoading || localSessionsRefreshing) {
      return
    }

    void loadLocalSessions(false).catch((error) => {
      toast.error(error instanceof Error ? error.message : t('workspace.importAgentSession.listFailed', { defaultValue: '读取节点聊天记录失败。' }))
    })
  }, [detectedLocalSessions.length, loadLocalSessions, localSessionsLoading, localSessionsOpen, localSessionsRefreshing, t])

  const handleSelectLocalSession = useCallback((session: ExecutorAgentSessionSummary) => {
    onShowChatView()
    void loadLocalSessionDetail(session).catch((error) => {
      toast.error(error instanceof Error ? error.message : t('workspace.importAgentSession.detailFailed', { defaultValue: '读取节点聊天记录详情失败。' }))
    })
  }, [loadLocalSessionDetail, onShowChatView, t])

  useEffect(() => {
    setLocalSessionsOpen(false)
    resetLocalSessionBrowser()
  }, [
    resetLocalSessionBrowser,
    selectedItem?.workspace.id,
    selectedWorkspaceExecutorId,
    selectedWorkspaceSession?.id,
    selectedWorkspaceTask?.id,
  ])

  useEffect(() => {
    if (!selectedLocalSessionKey) {
      return
    }

    const stillVisible = visibleLocalSessions.some((session) => buildImportAgentSessionKey(session) === selectedLocalSessionKey)
    if (stillVisible) {
      return
    }

    setSelectedLocalSessionKey('')
    setSelectedLocalSessionDetail(null)
  }, [selectedLocalSessionKey, visibleLocalSessions])

  const handleImportLocalSession = async () => {
    if (!selectedItem || !selectedWorkspaceTask || !selectedWorkspaceExecutorId || !selectedLocalSessionDetail) {
      return
    }

    setLocalSessionImporting(true)
    try {
      const response = await runMutation(() => api.importAgentSessionToWorkspace(selectedWorkspaceTask.id, {
        workspaceId: selectedItem.workspace.id,
        executorId: selectedWorkspaceExecutorId,
        source: selectedLocalSessionDetail.source,
        sessionId: selectedLocalSessionDetail.id,
      }))
      if (!response) {
        return
      }

      clearPendingWorkspaceSessionSelection()
      clearSelectedLocalSessionPreview()
      setSelectedWorkspaceSessionId(response.workspaceSessionId)
      setWorkspacePrimaryViewState(selectedItem.workspace.id, 'chat')
      updateWorkspaceSearch({
        taskId: selectedWorkspaceTask.id,
        workspaceSessionId: response.workspaceSessionId,
        panel: undefined,
      })
      await refreshWorkspaceSessionView()
    } finally {
      setLocalSessionImporting(false)
    }
  }

  return {
    clearSelectedLocalSessionPreview,
    handleImportLocalSession,
    handleSelectLocalSession,
    handleToggleLocalSessions,
    loadLocalSessions,
    localSessionDetailLoading,
    localSessionImporting,
    localSessionsLoading,
    localSessionsOpen,
    localSessionsRefreshing,
    selectedLocalSessionDetail,
    selectedLocalSessionKey,
    selectedLocalSessionSummary,
    setLocalSessionImporting,
    visibleLocalSessions,
  }
}
