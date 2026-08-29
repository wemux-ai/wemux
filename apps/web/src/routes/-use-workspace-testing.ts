/**
 * [INPUT]: /workspace state, workspace APIs, Preview sessions, and local worker diagnostics.
 * [OUTPUT]: Preview, environment, and browser-testing state plus user actions for a single workspace session.
 * [POS]: Shared workspace orchestration hook; coordinates /workspace and /workspaces UI state without owning worker execution or Preview transport selection.
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */
import { buildSubagentDelegatePrompt, type TaskSubagentObservation } from '@shared/subagent-role'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  createWorkspaceEnvironmentStatusSnapshot,
  getWorkspaceEnvironmentProbeUrl,
  type WorkspaceEnvironmentStatusSnapshot,
} from '@shared/task-environment'
import type { TaskChatSessionSnapshot } from '@shared/task-chat-session'
import type {
  AppState,
  PreviewAccessRoute,
  PreviewSessionDto,
  PreviewViewerAccess,
  Project,
  Task,
  WorkspaceSession,
  Workspace,
} from '@shared/types'
import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import { toast } from 'sonner'
import { api, type ConversationMessageRecord } from '../lib/api'
import { queryClient as appQueryClient } from '../lib/query-client'
import {
  canUseLocalDirectPreview,
  readLocalWorkerExecutor,
} from '../lib/browser-local-network-access'
import type { Language } from '../lib/i18n'
import { workspaceQueryKeys } from '../lib/workspace-query-keys'
import type {
  LocalEnvironmentProbeSnapshot,
  LocalWorkerDiagnosticsSnapshot,
} from '../lib/workspace-local-direct'
import {
  canUseLocalDirectWorkerScope,
  probeLocalEnvironmentUrl,
  readLocalWorkerDiagnostics,
} from '../lib/workspace-local-direct'
import { isWorkspacePreviewConnected } from '../lib/workspace-preview-status'
import { getWorkspaceSessionChatWsPart, parseWorkspaceSessionChatWsMessage } from '../lib/workspace-session-chat-ws'
import { resolveApiWebSocketUrl } from '../lib/runtime-config'
import { useWorkbenchResource } from '../components/workspaces/workbench-resource-registry'
import {
  type WorkspacePanelView,
  WorkspacePrimaryView,
  WorkspaceRouteSearch,
  buildObservationConversationMessage,
  buildRepairPrompt,
  buildRepairSessionTitle,
  getObservationFromConversationMessage,
  hasObservationId,
  text,
} from './-workspace-route-shared'

type Translate = (key: string, options?: Record<string, unknown>) => string

const WORKSPACE_PREVIEW_CONNECTING_REFETCH_INTERVAL_MS = 1_000
const WORKSPACE_PREVIEW_CONNECTED_REFETCH_INTERVAL_MS = 5_000
const WORKSPACE_ENVIRONMENT_STATUS_CACHE_TTL_MS = 2_000

export const buildWorkspacePreviewScopeKey = (params: {
  taskId?: string
  workspaceId?: string
  executorId?: string
}) => `${params.taskId || ''}:${params.workspaceId || ''}:${params.executorId || ''}`

export const shouldReconnectRestoredWorkspacePreview = (preview: PreviewSessionDto | null) => (
  Boolean(
    preview
    && preview.status !== 'closed'
    && preview.status !== 'error'
    && !isWorkspacePreviewConnected(preview),
  )
)

export type WorkspacePreviewExternalOpenOptions = {
  transport?: 'public-direct'
}

export const canOpenWorkspacePreviewInBrowser = (params: {
  preview: PreviewSessionDto | null
  options?: WorkspacePreviewExternalOpenOptions
}) => (
  params.options?.transport === 'public-direct'
  || isWorkspacePreviewConnected(params.preview)
)

const mergePreviewViewerAccess = (
  preview: PreviewSessionDto,
  viewer: PreviewViewerAccess | null,
): PreviewSessionDto => {
  if (!viewer?.additionalSourceAccess?.length) {
    return preview
  }

  const accessByPreviewHost = new Map(viewer.additionalSourceAccess.map((access) => [access.previewHost, access]))
  const accessByAppUrl = new Map(viewer.additionalSourceAccess.map((access) => [access.appUrl, access]))
  return {
    ...preview,
    domainBindings: preview.domainBindings?.map((binding) => {
      const access = accessByPreviewHost.get(binding.previewHost)
      return access
        ? {
            ...binding,
            iframeUrl: access.iframeUrl,
            publicUrl: access.publicUrl,
            previewHost: access.previewHost,
          }
        : binding
    }),
    additionalSourceAppUrls: preview.additionalSourceAppUrls.map((source) => {
      const access = accessByAppUrl.get(source.appUrl)
      return access
        ? {
            ...source,
            iframeUrl: access.iframeUrl,
            publicUrl: access.publicUrl,
            previewHost: access.previewHost,
          }
        : source
    }),
  }
}

type CachedWorkspacePreviewState = {
  preview: PreviewSessionDto
  accessRoute: PreviewAccessRoute | null
  viewer: PreviewViewerAccess | null
  shareUrl: string
}

export const readCachedWorkspacePreviewState = (scopeKey: string) => {
  return appQueryClient.getQueryData<CachedWorkspacePreviewState>(workspaceQueryKeys.previewScope(scopeKey)) ?? null
}

export const writeCachedWorkspacePreviewState = (
  scopeKey: string,
  preview: PreviewSessionDto,
  viewer: PreviewViewerAccess | null,
  accessRoute: PreviewAccessRoute | null,
) => {
  const cached = {
    preview: mergePreviewViewerAccess(preview, viewer),
    accessRoute,
    viewer,
    shareUrl: preview.share.shareUrl || '',
  }
  appQueryClient.setQueryData(workspaceQueryKeys.previewScope(scopeKey), cached)
  return cached
}

export const updateCachedWorkspacePreviewState = (
  scopeKey: string,
  updater: (current: CachedWorkspacePreviewState) => CachedWorkspacePreviewState,
) => {
  const current = readCachedWorkspacePreviewState(scopeKey)
  if (!current) {
    return null
  }
  const next = updater(current)
  appQueryClient.setQueryData(workspaceQueryKeys.previewScope(scopeKey), next)
  return next
}

export const clearCachedWorkspacePreviewState = (scopeKey: string) => {
  appQueryClient.removeQueries({ queryKey: workspaceQueryKeys.previewScope(scopeKey), exact: true })
}

type UseWorkspaceTestingParams = {
  activePrimaryView: WorkspacePrimaryView
  currentWorkspace: Workspace | null
  displayTask: Task | null
  environmentPreview: {
    installCommand?: string
    appUrl?: string
    healthUrl?: string
    logsCommand?: string
    startCommand?: string
    stopCommand?: string
  } | null
  language: Language
  navigate: (options: { to: '/workspace' | '/workspaces'; search: WorkspaceRouteSearch; replace?: boolean }) => Promise<void> | void
  onEnvironmentStatusChange?: (payload: {
    workspaceId: string
    workspaceSessionId: string
    status: WorkspaceEnvironmentStatusSnapshot
  }) => void
  parentWorkspaceSession: WorkspaceSession | null
  project: Project | null
  route: '/workspace' | '/workspaces'
  search: WorkspaceRouteSearch
  setActivePrimaryView: Dispatch<SetStateAction<WorkspacePrimaryView>>
  setState: Dispatch<SetStateAction<AppState>>
  t: Translate
  terminalCwd?: string
  testerWorkspaceSession: WorkspaceSession | null
  workspaceExecutorId?: string
  workspaceSession: WorkspaceSession | null
}

export const useWorkspaceTesting = ({
  activePrimaryView,
  currentWorkspace,
  displayTask,
  environmentPreview,
  language,
  navigate,
  onEnvironmentStatusChange,
  parentWorkspaceSession,
  project,
  route,
  search,
  setActivePrimaryView,
  setState,
  t,
  terminalCwd,
  testerWorkspaceSession,
  workspaceExecutorId,
  workspaceSession,
}: UseWorkspaceTestingParams) => {
  const queryClient = useQueryClient()
  const hasEnvironmentTemplate = Boolean(project?.environmentTemplate)
  const shouldAutoRefreshEnvironmentStatus = activePrimaryView === 'preview'
  const preserveSearch = (patch: Partial<WorkspaceRouteSearch>, panel?: WorkspacePanelView | undefined): WorkspaceRouteSearch => ({
    projectId: patch.projectId ?? search.projectId,
    taskId: patch.taskId ?? search.taskId,
    workspaceId: patch.workspaceId ?? search.workspaceId,
    workspaceSessionId: patch.workspaceSessionId ?? search.workspaceSessionId,
    launchId: patch.launchId ?? search.launchId,
    autoEnvironmentInstall: patch.autoEnvironmentInstall ?? search.autoEnvironmentInstall,
    panel: panel ?? search.panel,
    terminal: patch.terminal ?? search.terminal,
    mobileView: patch.mobileView ?? search.mobileView,
  })
  const [environmentBusyAction, setEnvironmentBusyAction] = useState<null | 'start' | 'stop' | 'logs'>(null)
  const [environmentStatus, setEnvironmentStatus] = useState<WorkspaceEnvironmentStatusSnapshot | null>(null)
  const [environmentStatusLoading, setEnvironmentStatusLoading] = useState(false)
  const [localWorkerDiagnostics, setLocalWorkerDiagnostics] = useState<LocalWorkerDiagnosticsSnapshot | null>(null)
  const [localEnvironmentProbe, setLocalEnvironmentProbe] = useState<LocalEnvironmentProbeSnapshot | null>(null)
  const [previewBusyAction, setPreviewBusyAction] = useState<null | 'open' | 'refresh' | 'stop' | 'share' | 'revoke'>(null)
  const [previewAutoOpenBlocked, setPreviewAutoOpenBlocked] = useState(false)
  const [previewSession, setPreviewSession] = useState<PreviewSessionDto | null>(null)
  const [previewAccessRoute, setPreviewAccessRoute] = useState<PreviewAccessRoute | null>(null)
  const [previewShareUrl, setPreviewShareUrl] = useState('')
  const [previewViewer, setPreviewViewer] = useState<PreviewViewerAccess | null>(null)
  const [localWorkerExecutorId, setLocalWorkerExecutorId] = useState<string>()
  const [testRecordMessages, setTestRecordMessages] = useState<ConversationMessageRecord[]>([])
  const [testRecordLoading, setTestRecordLoading] = useState(false)
  const [testRecordRefreshing, setTestRecordRefreshing] = useState(false)
  const [testRecordLiveStatus, setTestRecordLiveStatus] = useState<'connecting' | 'open' | 'closed' | 'error'>('closed')
  const [repairingObservationId, setRepairingObservationId] = useState<string | null>(null)
  const testRecordSocketRef = useRef<WebSocket | null>(null)
  const testRecordLastEventIdRef = useRef<string | null>(null)
  const testRecordConversationCountRef = useRef<number | null>(null)
  const testRecordLiveStatusRef = useRef<'connecting' | 'open' | 'closed' | 'error'>('closed')
  const environmentTransitionActionRef = useRef<null | 'start' | 'stop'>(null)
  const environmentStatusPollAttemptsRef = useRef(0)
  const [pageVisible, setPageVisible] = useState(() => {
    if (typeof document === 'undefined') {
      return true
    }
    return document.visibilityState === 'visible'
  })
  const currentWorkspaceId = currentWorkspace?.id || ''
  const currentWorkspaceSessionId = workspaceSession?.id || ''
  const previewScopeKey = buildWorkspacePreviewScopeKey({
    taskId: displayTask?.id,
    workspaceId: currentWorkspaceId,
    executorId: workspaceExecutorId,
  })
  const previewScopeRef = useRef(previewScopeKey)
  const previewRestoreAttemptedScopeRef = useRef('')
  const previewRestoreInFlightScopeRef = useRef('')
  previewScopeRef.current = previewScopeKey
  const recordsResourceStatus = useWorkbenchResource({
    resourceKey: `records:${currentWorkspaceId}:${currentWorkspaceSessionId}`,
    type: 'socket',
    active: activePrimaryView === 'records' && pageVisible,
  })

  useEffect(() => {
    if (typeof document === 'undefined') {
      return
    }

    const updatePageVisible = () => {
      setPageVisible(document.visibilityState === 'visible')
    }

    updatePageVisible()
    document.addEventListener('visibilitychange', updatePageVisible)
    window.addEventListener('focus', updatePageVisible)

    return () => {
      document.removeEventListener('visibilitychange', updatePageVisible)
      window.removeEventListener('focus', updatePageVisible)
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    void readLocalWorkerExecutor({
      expectedExecutorId: workspaceExecutorId,
    }).then((localWorker) => {
      if (!cancelled) {
        setLocalWorkerExecutorId(localWorker.executorId)
      }
    })
    return () => {
      cancelled = true
    }
  }, [workspaceExecutorId])

  const isCurrentPreviewScope = useCallback((scopeKey: string) => {
    return previewScopeRef.current === scopeKey
  }, [])

  const applyPreviewState = useCallback((params: {
    scopeKey: string
    preview: PreviewSessionDto
    viewer: PreviewViewerAccess | null
    accessRoute: PreviewAccessRoute | null
  }) => {
    const cached = writeCachedWorkspacePreviewState(params.scopeKey, params.preview, params.viewer, params.accessRoute)
    if (!isCurrentPreviewScope(params.scopeKey)) {
      return cached
    }

    setPreviewSession(cached.preview)
    setPreviewAccessRoute(cached.accessRoute)
    setPreviewViewer(cached.viewer)
    setPreviewShareUrl(cached.shareUrl)
    return cached
  }, [isCurrentPreviewScope])

  const canUseLocalDirectPreviewForWorkspace = canUseLocalDirectPreview({
    sourceAppUrl: environmentPreview?.appUrl,
    workspaceExecutorId,
    localWorkerExecutorId,
  })
  const activePreviewId = previewSession?.previewId ?? ''
  const previewStatusQuery = useQuery({
    queryKey: workspaceQueryKeys.preview(activePreviewId),
    enabled: Boolean(
      activePreviewId
      && activePrimaryView === 'preview'
      && pageVisible
      && previewSession?.status !== 'closed'
      && previewSession?.status !== 'error',
    ),
    queryFn: () => api.getPreview(activePreviewId, localWorkerExecutorId),
    refetchInterval: (query) => {
      const preview = query.state.data?.preview
      if (!preview || isWorkspacePreviewConnected(preview)) {
        return WORKSPACE_PREVIEW_CONNECTED_REFETCH_INTERVAL_MS
      }
      return WORKSPACE_PREVIEW_CONNECTING_REFETCH_INTERVAL_MS
    },
    staleTime: 0,
  })
  const environmentStatusQueryKey = displayTask && currentWorkspace && workspaceSession
    ? workspaceQueryKeys.environmentStatus(displayTask.id, currentWorkspace.id, workspaceSession.id)
    : null
  const environmentStatusQuery = useQuery({
    queryKey: environmentStatusQueryKey ?? workspaceQueryKeys.environmentStatus('', '', ''),
    enabled: false,
    queryFn: async () => {
      if (!displayTask || !currentWorkspace || !workspaceSession) {
        throw new Error('Missing workspace environment scope')
      }
      return api.getTaskEnvironmentStatus(displayTask.id, currentWorkspace.id, workspaceSession.id)
    },
    staleTime: WORKSPACE_ENVIRONMENT_STATUS_CACHE_TTL_MS,
  })

  const setTestRecordLiveStatusIfChanged = useCallback((nextStatus: 'connecting' | 'open' | 'closed' | 'error') => {
    if (testRecordLiveStatusRef.current === nextStatus) {
      return
    }

    testRecordLiveStatusRef.current = nextStatus
    setTestRecordLiveStatus(nextStatus)
  }, [])

  const updateEnvironmentStatus = useCallback((status: WorkspaceEnvironmentStatusSnapshot | null) => {
    setEnvironmentStatus(status)

    if (!status || !currentWorkspaceId || !currentWorkspaceSessionId) {
      return
    }

    onEnvironmentStatusChange?.({
      workspaceId: currentWorkspaceId,
      workspaceSessionId: currentWorkspaceSessionId,
      status,
    })
  }, [currentWorkspaceId, currentWorkspaceSessionId, onEnvironmentStatusChange])

  const applyEnvironmentTransition = useCallback((snapshot: WorkspaceEnvironmentStatusSnapshot) => {
    const transitionAction = environmentTransitionActionRef.current

    if (transitionAction === 'start') {
      if (snapshot.status === 'running') {
        environmentTransitionActionRef.current = null
        environmentStatusPollAttemptsRef.current = 0
        return snapshot
      }

      if (environmentStatusPollAttemptsRef.current < 6) {
        return createWorkspaceEnvironmentStatusSnapshot({
          status: 'starting',
          message: t('workspace.environment.startPending', { defaultValue: '环境启动命令已提交，正在等待地址可访问。' }),
          checkedAt: snapshot.checkedAt,
          url: snapshot.url,
          httpStatus: snapshot.httpStatus,
        })
      }

      environmentTransitionActionRef.current = null
      return snapshot
    }

    if (transitionAction === 'stop') {
      if (snapshot.status !== 'running') {
        environmentTransitionActionRef.current = null
        environmentStatusPollAttemptsRef.current = 0
        return createWorkspaceEnvironmentStatusSnapshot({
          status: 'stopped',
          message: t('workspace.environment.stopDone', { defaultValue: '环境停止命令已执行。' }),
          checkedAt: snapshot.checkedAt,
          url: snapshot.url,
          httpStatus: snapshot.httpStatus,
        })
      }

      if (environmentStatusPollAttemptsRef.current < 4) {
        return createWorkspaceEnvironmentStatusSnapshot({
          status: 'stopping',
          message: t('workspace.environment.stopPending', { defaultValue: '环境停止命令已执行，正在等待地址下线。' }),
          checkedAt: snapshot.checkedAt,
          url: snapshot.url,
          httpStatus: snapshot.httpStatus,
        })
      }

      environmentTransitionActionRef.current = null
    }

    return snapshot
  }, [t])

  useEffect(() => {
    if (!environmentStatusQuery.data?.environmentStatus) {
      return
    }

    updateEnvironmentStatus(applyEnvironmentTransition(environmentStatusQuery.data.environmentStatus))
  }, [applyEnvironmentTransition, environmentStatusQuery.data, updateEnvironmentStatus])

  const refreshEnvironmentStatus = useCallback(async (options?: { silent?: boolean; force?: boolean }) => {
    if (!displayTask || !currentWorkspace || !workspaceSession || !hasEnvironmentTemplate) {
      updateEnvironmentStatus(null)
      setEnvironmentStatusLoading(false)
      return
    }

    const environmentUrl = getWorkspaceEnvironmentProbeUrl(environmentPreview)
    if (!environmentUrl && !environmentTransitionActionRef.current) {
      updateEnvironmentStatus(createWorkspaceEnvironmentStatusSnapshot({
        status: 'unsupported',
        message: t('workspace.environment.noProbeUrl', { defaultValue: '当前环境模板没有可探测的应用地址。' }),
      }))
      setEnvironmentStatusLoading(false)
      return
    }

    if (!options?.silent) {
      setEnvironmentStatusLoading(true)
    }

    const queryKey = workspaceQueryKeys.environmentStatus(displayTask.id, currentWorkspace.id, workspaceSession.id)
    if (options?.force) {
      await queryClient.invalidateQueries({ queryKey, exact: true })
    }

    try {
      const response = await queryClient.fetchQuery({
        queryKey,
        queryFn: () => api.getTaskEnvironmentStatus(displayTask.id, currentWorkspace.id, workspaceSession.id),
        staleTime: options?.force ? 0 : options?.silent ? WORKSPACE_ENVIRONMENT_STATUS_CACHE_TTL_MS : 0,
      })
      updateEnvironmentStatus(applyEnvironmentTransition(response.environmentStatus))
    } catch (error) {
      const message = error instanceof Error ? error.message : t('workspace.environment.statusFailed', { defaultValue: '环境状态检查失败。' })
      updateEnvironmentStatus(applyEnvironmentTransition(createWorkspaceEnvironmentStatusSnapshot({
        status: 'error',
        message,
        url: environmentUrl,
      })))
    } finally {
      setEnvironmentStatusLoading(false)
    }
  }, [applyEnvironmentTransition, currentWorkspace, displayTask, environmentPreview, hasEnvironmentTemplate, queryClient, t, updateEnvironmentStatus, workspaceSession])

  const refreshLocalDirectProbes = useCallback(async () => {
    const normalizedWorkspaceExecutorId = workspaceExecutorId?.trim() || ''
    if (!normalizedWorkspaceExecutorId) {
      setLocalWorkerDiagnostics(null)
      setLocalEnvironmentProbe(null)
      return
    }

    const diagnostics = await readLocalWorkerDiagnostics()
    setLocalWorkerDiagnostics(diagnostics)

    if (
      diagnostics.status !== 'ok'
      || !canUseLocalDirectWorkerScope({
        workspaceExecutorId: normalizedWorkspaceExecutorId,
        localWorkerExecutorId: diagnostics.executorId,
      })
    ) {
      setLocalEnvironmentProbe({
        status: 'error',
        checkedAt: diagnostics.checkedAt,
        url: environmentPreview?.healthUrl || environmentPreview?.appUrl || '-',
        readable: false,
        error: diagnostics.status !== 'ok'
          ? diagnostics.error || 'Local worker diagnostics failed.'
          : t('workspace.environment.localWorkerScopeMismatch', {
            defaultValue: '当前工作区不在这台本机 Worker 上，未启用本地直连探测。',
          }),
      })
      return
    }

    const probe = await probeLocalEnvironmentUrl({
      url: environmentPreview?.healthUrl || environmentPreview?.appUrl,
    })
    setLocalEnvironmentProbe(probe)
  }, [
    environmentPreview?.appUrl,
    environmentPreview?.healthUrl,
    t,
    workspaceExecutorId,
  ])

  const loadTestRecordMessages = useCallback(async (
    options?: {
      refreshing?: boolean
      silent?: boolean
      workspaceSessionId?: string
    },
  ) => {
    const taskId = displayTask?.id
    const workspaceId = currentWorkspace?.id
    const targetWorkspaceSessionId = options?.workspaceSessionId ?? workspaceSession?.id

    if (!taskId || !workspaceId || !targetWorkspaceSessionId) {
      setTestRecordMessages([])
      setTestRecordLoading(false)
      setTestRecordRefreshing(false)
      return
    }

    if (options?.refreshing) {
      setTestRecordRefreshing(true)
    } else {
      setTestRecordLoading(true)
    }

    try {
      const response = await api.getTaskConversation(taskId, workspaceId, targetWorkspaceSessionId)
      setTestRecordMessages(response.messages)
      testRecordConversationCountRef.current = response.messages.length
    } catch (error) {
      setTestRecordMessages([])
      testRecordConversationCountRef.current = 0
      if (!options?.silent) {
        toast.error(error instanceof Error ? error.message : t('workspace.testing.loadFailed', { defaultValue: '加载测试记录失败。' }))
      }
    } finally {
      setTestRecordLoading(false)
      setTestRecordRefreshing(false)
    }
  }, [currentWorkspace?.id, displayTask?.id, language, workspaceSession?.id])

  const appendLiveObservationToTestRecords = useCallback((message: ConversationMessageRecord) => {
    const nextObservation = getObservationFromConversationMessage(message)
    if (!nextObservation || typeof nextObservation !== 'object' || !('id' in nextObservation)) {
      return
    }

    setTestRecordMessages((current) => {
      const exists = current.some((item) => {
        const observation = getObservationFromConversationMessage(item)
        return hasObservationId(observation, nextObservation.id)
      })
      if (exists) {
        return current
      }

      testRecordConversationCountRef.current = (testRecordConversationCountRef.current ?? current.length) + 1
      return [...current, message]
    })
  }, [])

  const handleRunEnvironmentAction = useCallback(async (action: 'start' | 'stop' | 'logs') => {
    if (!displayTask || !currentWorkspace || !workspaceSession) {
      toast.error(t('workspace.currentMissing', { defaultValue: '当前工作区不存在' }))
      return
    }

    const environmentUrl = getWorkspaceEnvironmentProbeUrl(environmentPreview)
    if (action === 'start') {
      environmentTransitionActionRef.current = 'start'
      environmentStatusPollAttemptsRef.current = 0
      updateEnvironmentStatus(createWorkspaceEnvironmentStatusSnapshot({
        status: 'starting',
        message: t('workspace.environment.startPending', { defaultValue: '环境启动命令已提交，正在等待地址可访问。' }),
        url: environmentUrl,
      }))
    } else if (action === 'stop') {
      environmentTransitionActionRef.current = 'stop'
      environmentStatusPollAttemptsRef.current = 0
      updateEnvironmentStatus(createWorkspaceEnvironmentStatusSnapshot({
        status: 'stopping',
        message: t('workspace.environment.stopPending', { defaultValue: '环境停止命令已执行，正在等待地址下线。' }),
        url: environmentUrl,
      }))
    }

    setEnvironmentBusyAction(action)
    try {
      const response = await api.runTaskEnvironmentAction(displayTask.id, action, currentWorkspace.id, workspaceSession.id)
      setState(response.state)
      if (response.environmentStatus) {
        queryClient.setQueryData(
          workspaceQueryKeys.environmentStatus(displayTask.id, currentWorkspace.id, workspaceSession.id),
          {
            ok: true,
            environmentStatus: response.environmentStatus,
            message: response.message,
          },
        )
        updateEnvironmentStatus(applyEnvironmentTransition(response.environmentStatus))
      }

      if (action === 'logs' && response.output?.trim()) {
        console.info('[workspace-environment-logs]', response.output)
        toast.success(response.message || t('workspace.environment.logsReady', { defaultValue: '环境日志已输出到控制台。' }))
      } else {
        toast.success(response.message || t('workspace.environment.actionDone', { defaultValue: '环境命令执行完成。' }))
      }
      void loadTestRecordMessages({ silent: true })
    } catch (error) {
      environmentTransitionActionRef.current = null
      environmentStatusPollAttemptsRef.current = 0
      const message = error instanceof Error ? error.message : t('workspace.environment.actionFailed', { defaultValue: '环境命令执行失败。' })
      updateEnvironmentStatus(createWorkspaceEnvironmentStatusSnapshot({
        status: 'error',
        message,
        url: environmentUrl,
      }))
      toast.error(message)
    } finally {
      setEnvironmentBusyAction(null)
    }
  }, [applyEnvironmentTransition, currentWorkspace, displayTask, environmentPreview, loadTestRecordMessages, queryClient, setState, t, updateEnvironmentStatus, workspaceSession])

  const markEnvironmentTerminalStart = useCallback(() => {
    const environmentUrl = getWorkspaceEnvironmentProbeUrl(environmentPreview)
    environmentTransitionActionRef.current = 'start'
    environmentStatusPollAttemptsRef.current = 0
    updateEnvironmentStatus(createWorkspaceEnvironmentStatusSnapshot({
      status: 'starting',
      message: t('workspace.environment.startPending', { defaultValue: '环境启动命令已提交，正在等待地址可访问。' }),
      url: environmentUrl,
    }))
    void refreshEnvironmentStatus({ silent: true, force: true })
  }, [environmentPreview, refreshEnvironmentStatus, t, updateEnvironmentStatus])

  const markEnvironmentTerminalStop = useCallback(() => {
    const environmentUrl = getWorkspaceEnvironmentProbeUrl(environmentPreview)
    environmentTransitionActionRef.current = 'stop'
    environmentStatusPollAttemptsRef.current = 0
    updateEnvironmentStatus(createWorkspaceEnvironmentStatusSnapshot({
      status: 'stopping',
      message: t('workspace.environment.stopPending', { defaultValue: '环境停止命令已执行，正在等待地址下线。' }),
      url: environmentUrl,
    }))
    void refreshEnvironmentStatus({ silent: true, force: true })
  }, [environmentPreview, refreshEnvironmentStatus, t, updateEnvironmentStatus])

  const markEnvironmentTerminalClosed = useCallback(() => {
    environmentTransitionActionRef.current = null
    environmentStatusPollAttemptsRef.current = 0
    void refreshEnvironmentStatus({ silent: true, force: true })
  }, [refreshEnvironmentStatus])

  useEffect(() => {
    environmentTransitionActionRef.current = null
    environmentStatusPollAttemptsRef.current = 0

    if (!displayTask || !currentWorkspace || !workspaceSession || !hasEnvironmentTemplate) {
      updateEnvironmentStatus(null)
      setEnvironmentStatusLoading(false)
      return
    }

    if (!shouldAutoRefreshEnvironmentStatus) {
      setEnvironmentStatusLoading(false)
      return
    }

    void refreshEnvironmentStatus()
  }, [currentWorkspace?.id, displayTask?.id, hasEnvironmentTemplate, refreshEnvironmentStatus, shouldAutoRefreshEnvironmentStatus, updateEnvironmentStatus, workspaceSession?.id])

  useEffect(() => {
    if (!currentWorkspace?.id || !workspaceSession?.id) {
      setLocalWorkerDiagnostics(null)
      setLocalEnvironmentProbe(null)
      return
    }

    void refreshLocalDirectProbes()
  }, [
    currentWorkspace?.id,
    environmentPreview?.appUrl,
    environmentPreview?.healthUrl,
    refreshLocalDirectProbes,
    workspaceSession?.id,
  ])

  useEffect(() => {
    if (!pageVisible || environmentBusyAction || !displayTask || !currentWorkspace || !workspaceSession) {
      return
    }

    const shouldPoll = environmentTransitionActionRef.current !== null
      || environmentStatus?.status === 'checking'
      || environmentStatus?.status === 'starting'
      || environmentStatus?.status === 'stopping'
    if (!shouldPoll || environmentStatusPollAttemptsRef.current >= 6) {
      return
    }

    const timer = window.setTimeout(() => {
      environmentStatusPollAttemptsRef.current += 1
      void refreshEnvironmentStatus({ silent: true })
    }, environmentTransitionActionRef.current === 'stop' ? 2500 : 3000)

    return () => {
      window.clearTimeout(timer)
    }
  }, [currentWorkspace?.id, displayTask?.id, environmentBusyAction, environmentStatus?.status, pageVisible, refreshEnvironmentStatus, workspaceSession?.id])

  const handleOpenEnvironmentApp = useCallback(async () => {
    if (!environmentPreview?.appUrl) {
      return
    }

    window.open(environmentPreview.appUrl, '_blank', 'noopener,noreferrer')

    if (!displayTask || !currentWorkspace || !workspaceSession) {
      return
    }

    try {
      await api.recordTaskObservation(displayTask.id, {
        workspaceId: currentWorkspace.id,
        workspaceSessionId: workspaceSession.id,
        kind: 'action',
        level: 'info',
        title: t('workspace.testing.openEntry', { defaultValue: '浏览器测试入口已打开' }),
        detail: [
          t('workspace.testing.openEntryDetails.appUrl', { defaultValue: '应用地址: {{value}}', value: environmentPreview.appUrl }),
          environmentPreview.healthUrl
            ? t('workspace.testing.openEntryDetails.healthUrl', { defaultValue: '健康检查: {{value}}', value: environmentPreview.healthUrl })
            : '',
          terminalCwd
            ? t('workspace.testing.openEntryDetails.workingDirectory', { defaultValue: '工作目录: {{value}}', value: terminalCwd })
            : '',
          t('workspace.testing.openEntryDetails.continueRecording', { defaultValue: '可以继续记录 console、network、截图等浏览器观测。' }),
        ].filter(Boolean).join('\n'),
        url: environmentPreview.appUrl,
        metadata: {
          source: 'workspace-open-app',
          healthUrl: environmentPreview.healthUrl,
          cwd: terminalCwd,
        },
      })
      void loadTestRecordMessages({ silent: true })
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('workspace.environment.observationFailed', { defaultValue: '浏览器观测记录失败。' }))
    }
  }, [currentWorkspace, displayTask, environmentPreview, language, loadTestRecordMessages, t, terminalCwd, workspaceSession])

  const handleOpenWorkspacePreview = useCallback(async (options?: {
    source?: 'auto' | 'manual'
  }) => {
    if (!displayTask || !currentWorkspace || !workspaceSession || !environmentPreview?.appUrl) {
      toast.error(t('workspace.currentMissing', { defaultValue: '当前工作区不存在' }))
      return
    }

    const scopeKey = previewScopeKey
    if (options?.source !== 'auto') {
      setPreviewAutoOpenBlocked(false)
    }

    setPreviewBusyAction('open')
    try {
      const response = await api.openTaskPreview(displayTask.id, {
        workspaceId: currentWorkspace.id,
        workspaceSessionId: workspaceSession.id,
        autoStart: true,
        meshSourceExecutorId: localWorkerExecutorId,
      })
      if (!isCurrentPreviewScope(scopeKey)) {
        return
      }

      applyPreviewState({
        scopeKey,
        preview: response.preview,
        viewer: response.viewer,
        accessRoute: response.accessRoute ?? null,
      })
      queryClient.setQueryData(workspaceQueryKeys.preview(response.preview.previewId), response)
      queryClient.setQueryData(
        workspaceQueryKeys.taskPreview(displayTask.id, currentWorkspace.id, undefined, response.preview.executorId),
        response,
      )
      setActivePrimaryView('preview')
      toast.success(response.preview.status === 'active' ? 'Preview 已连接。' : 'Preview 正在建立隧道。')
    } catch (error) {
      if (!isCurrentPreviewScope(scopeKey)) {
        return
      }

      if (options?.source === 'auto') {
        setPreviewAutoOpenBlocked(true)
      }
      toast.error(error instanceof Error ? error.message : '启动 Preview 失败。')
    } finally {
      if (isCurrentPreviewScope(scopeKey)) {
        setPreviewBusyAction(null)
      }
    }
  }, [
    applyPreviewState,
    currentWorkspace,
    displayTask,
    environmentPreview?.appUrl,
    isCurrentPreviewScope,
    localWorkerExecutorId,
    previewScopeKey,
    queryClient,
    setActivePrimaryView,
    t,
    workspaceSession,
  ])

  const handleRefreshWorkspacePreview = useCallback(async () => {
    if (!previewSession) {
      await handleOpenWorkspacePreview()
      return
    }

    const scopeKey = previewScopeKey
    const previewId = previewSession.previewId
    setPreviewBusyAction('refresh')
    try {
      await queryClient.invalidateQueries({ queryKey: workspaceQueryKeys.preview(previewId) })
      const response = await queryClient.fetchQuery({
        queryKey: workspaceQueryKeys.preview(previewId),
        queryFn: () => api.getPreview(previewId, localWorkerExecutorId),
        staleTime: 0,
      })
      if (!isCurrentPreviewScope(scopeKey)) {
        return
      }

      applyPreviewState({
        scopeKey,
        preview: response.preview,
        viewer: response.viewer,
        accessRoute: response.accessRoute ?? null,
      })
      toast.success('Preview 已刷新。')
    } catch (error) {
      if (!isCurrentPreviewScope(scopeKey)) {
        return
      }

      toast.error(error instanceof Error ? error.message : '刷新 Preview 失败。')
    } finally {
      if (isCurrentPreviewScope(scopeKey)) {
        setPreviewBusyAction(null)
      }
    }
  }, [applyPreviewState, handleOpenWorkspacePreview, isCurrentPreviewScope, localWorkerExecutorId, previewScopeKey, previewSession, queryClient])

  const handleStopWorkspacePreview = useCallback(async () => {
    if (!previewSession) {
      return
    }

    const scopeKey = previewScopeKey
    const previewId = previewSession.previewId
    setPreviewBusyAction('stop')
    try {
      const response = await api.stopPreview(previewId)
      if (!isCurrentPreviewScope(scopeKey)) {
        return
      }

      clearCachedWorkspacePreviewState(scopeKey)
      setPreviewSession((current) => current ? {
        ...current,
        status: response.status,
        updatedAt: response.closedAt,
      } : current)
      setPreviewViewer(null)
      setPreviewAccessRoute(null)
      setPreviewShareUrl('')
      queryClient.removeQueries({ queryKey: workspaceQueryKeys.preview(previewId) })
      queryClient.removeQueries({
        queryKey: workspaceQueryKeys.taskPreview(previewSession.taskId, previewSession.workspaceId, undefined, previewSession.executorId),
      })
      toast.success('Preview 已停止。')
    } catch (error) {
      if (!isCurrentPreviewScope(scopeKey)) {
        return
      }

      toast.error(error instanceof Error ? error.message : '停止 Preview 失败。')
    } finally {
      if (isCurrentPreviewScope(scopeKey)) {
        setPreviewBusyAction(null)
      }
    }
  }, [isCurrentPreviewScope, previewScopeKey, previewSession, queryClient])

  const handleShareWorkspacePreview = useCallback(async () => {
    if (!previewSession) {
      return
    }

    const scopeKey = previewScopeKey
    const previewId = previewSession.previewId
    setPreviewBusyAction('share')
    try {
      const response = await api.sharePreview(previewId, {
        expiresInMinutes: 24 * 60,
      })
      if (!isCurrentPreviewScope(scopeKey)) {
        return
      }

      updateCachedWorkspacePreviewState(scopeKey, (current) => ({
        ...current,
        preview: {
          ...current.preview,
          share: {
            enabled: true,
            expiresAt: response.share.expiresAt,
          },
        },
        shareUrl: response.share.shareUrl,
      }))
      setPreviewSession((current) => current ? {
        ...current,
        share: {
          enabled: true,
          expiresAt: response.share.expiresAt,
        },
      } : current)
      setPreviewShareUrl(response.share.shareUrl)
      queryClient.setQueryData(workspaceQueryKeys.preview(previewId), (current: Awaited<ReturnType<typeof api.getPreview>> | undefined) => (
        current
          ? {
              ...current,
              preview: {
                ...current.preview,
                share: {
                  enabled: true,
                  expiresAt: response.share.expiresAt,
                },
              },
            }
          : current
      ))
    } catch (error) {
      if (!isCurrentPreviewScope(scopeKey)) {
        return
      }

      toast.error(error instanceof Error ? error.message : '生成分享链接失败。')
    } finally {
      if (isCurrentPreviewScope(scopeKey)) {
        setPreviewBusyAction(null)
      }
    }
  }, [isCurrentPreviewScope, previewScopeKey, previewSession, queryClient])

  const handleRevokeWorkspacePreviewShare = useCallback(async () => {
    if (!previewSession) {
      return
    }

    const scopeKey = previewScopeKey
    const previewId = previewSession.previewId
    setPreviewBusyAction('revoke')
    try {
      const response = await api.revokePreviewShare(previewId)
      if (!isCurrentPreviewScope(scopeKey)) {
        return
      }

      updateCachedWorkspacePreviewState(scopeKey, (current) => ({
        ...current,
        preview: {
          ...current.preview,
          share: {
            enabled: false,
            revokedAt: response.share.revokedAt,
          },
        },
        shareUrl: '',
      }))
      setPreviewSession((current) => current ? {
        ...current,
        share: {
          enabled: false,
          revokedAt: response.share.revokedAt,
        },
      } : current)
      setPreviewShareUrl('')
      queryClient.setQueryData(workspaceQueryKeys.preview(previewId), (current: Awaited<ReturnType<typeof api.getPreview>> | undefined) => (
        current
          ? {
              ...current,
              preview: {
                ...current.preview,
                share: {
                  enabled: false,
                  revokedAt: response.share.revokedAt,
                },
              },
            }
          : current
      ))
      toast.success('分享链接已撤销。')
    } catch (error) {
      if (!isCurrentPreviewScope(scopeKey)) {
        return
      }

      toast.error(error instanceof Error ? error.message : '撤销分享链接失败。')
    } finally {
      if (isCurrentPreviewScope(scopeKey)) {
        setPreviewBusyAction(null)
      }
    }
  }, [isCurrentPreviewScope, previewScopeKey, previewSession, queryClient])

  const handleOpenWorkspacePreviewInBrowser = useCallback((targetPreviewUrl?: string, options?: WorkspacePreviewExternalOpenOptions) => {
    if (!canOpenWorkspacePreviewInBrowser({ preview: previewSession, options })) {
      toast.error('Preview 还没连通，请稍后刷新后再打开。')
      return
    }

    const targetUrl = targetPreviewUrl || previewViewer?.iframeUrl || previewSession?.publicUrl
    if (!targetUrl) {
      return
    }

    window.open(targetUrl, '_blank', 'noopener,noreferrer')
  }, [previewSession, previewViewer?.iframeUrl])

  const handleBackToParentSession = useCallback(async () => {
    if (!displayTask || !project || !currentWorkspace || !parentWorkspaceSession) {
      return
    }

    setActivePrimaryView(parentWorkspaceSession.sessionRole === 'tester' ? 'records' : 'chat')
    await navigate({
      to: route,
      search: preserveSearch({
        projectId: project.id,
        taskId: displayTask.id,
        workspaceId: currentWorkspace.id,
        workspaceSessionId: parentWorkspaceSession.id,
        launchId: search.launchId,
      }, parentWorkspaceSession.sessionRole === 'tester' ? 'records' : undefined),
    })
  }, [currentWorkspace, displayTask, navigate, parentWorkspaceSession, project, route, search.launchId, setActivePrimaryView])

  const handleCreateRepairSession = useCallback(async (observation: TaskSubagentObservation) => {
    if (!displayTask || !project || !currentWorkspace || !workspaceSession) {
      toast.error(t('workspace.currentMissing', { defaultValue: '当前工作区不存在' }))
      return
    }

    const repairPrompt = buildRepairPrompt(observation, language)
    const delegatedPrompt = buildSubagentDelegatePrompt({
      role: 'general',
      task: {
        title: displayTask.title,
        description: displayTask.description,
      },
      message: repairPrompt,
      environment: environmentPreview ? {
        cwd: terminalCwd,
        startCommand: environmentPreview.startCommand,
        stopCommand: environmentPreview.stopCommand,
        healthUrl: environmentPreview.healthUrl,
        appUrl: environmentPreview.appUrl,
        logsCommand: environmentPreview.logsCommand,
      } : {
        cwd: terminalCwd,
      },
    })

    setRepairingObservationId(observation.id)
    try {
      const bindResponse = await api.bindTaskWorkspace(displayTask.id, currentWorkspace.id, {
        workspaceSessionId: workspaceSession.id,
        createNewSession: true,
        title: buildRepairSessionTitle(observation, language),
        agentInvocationMode: 'delegate',
        sessionKind: 'subagent',
        sessionRole: 'general',
        parentSessionId: workspaceSession.id,
        rootSessionId: workspaceSession.rootSessionId || workspaceSession.id,
        delegatedPrompt,
      })
      setState(bindResponse.state)

      const targetSessionId = bindResponse.workspaceSessionId ?? bindResponse.workspaceSession?.id ?? ''
      if (!targetSessionId) {
        throw new Error(t('workspace.testing.fixSessionCreateFailed', { defaultValue: '修复会话创建失败。' }))
      }

      await api.enqueueTaskChatMessage(displayTask.id, delegatedPrompt, currentWorkspace.id, targetSessionId)
      setActivePrimaryView('chat')
      await navigate({
        to: route,
        search: preserveSearch({
          projectId: project.id,
          taskId: displayTask.id,
          workspaceId: currentWorkspace.id,
          workspaceSessionId: targetSessionId,
          launchId: search.launchId,
        }, undefined),
      })
      toast.success(t('workspace.testing.fixSessionStarted', { defaultValue: '已拉起修复会话并下发异常上下文。' }))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('workspace.testing.fixSessionFailed', { defaultValue: '创建修复会话失败。' }))
    } finally {
      setRepairingObservationId(null)
    }
  }, [
    currentWorkspace,
    displayTask,
    environmentPreview,
    language,
    navigate,
    project,
    route,
    search.launchId,
    setActivePrimaryView,
    setState,
    t,
    terminalCwd,
    workspaceSession,
  ])

  useEffect(() => {
    const cached = readCachedWorkspacePreviewState(previewScopeKey)
    setPreviewBusyAction(null)
    if (
      cached
      && cached.preview.status !== 'closed'
      && cached.preview.status !== 'error'
      && (!workspaceExecutorId || cached.preview.executorId === workspaceExecutorId)
    ) {
      setPreviewAutoOpenBlocked(false)
      setPreviewSession(cached.preview)
      setPreviewAccessRoute(cached.accessRoute)
      setPreviewViewer(cached.viewer)
      setPreviewShareUrl(cached.shareUrl)
      return
    }

    setPreviewAutoOpenBlocked(true)
    setPreviewSession(null)
    setPreviewAccessRoute(null)
    setPreviewViewer(null)
    setPreviewShareUrl('')
  }, [previewScopeKey, workspaceExecutorId])

  useEffect(() => {
    previewRestoreAttemptedScopeRef.current = ''
    previewRestoreInFlightScopeRef.current = ''
  }, [previewScopeKey])

  useEffect(() => {
    if (activePrimaryView !== 'preview' || previewSession || previewBusyAction || !pageVisible) {
      return
    }

    if (!displayTask || !currentWorkspace || !environmentPreview?.appUrl) {
      return
    }

    const scopeKey = previewScopeKey
    if (
      previewRestoreAttemptedScopeRef.current === scopeKey
      || previewRestoreInFlightScopeRef.current === scopeKey
    ) {
      return
    }

    let cancelled = false
    previewRestoreInFlightScopeRef.current = scopeKey

    void (async () => {
      try {
        const scopedPreviewQueryKey = workspaceQueryKeys.taskPreview(displayTask.id, currentWorkspace.id, undefined, workspaceExecutorId)
        const currentPreview = await queryClient.fetchQuery({
          queryKey: scopedPreviewQueryKey,
          queryFn: () => api.getTaskPreview(displayTask.id, currentWorkspace.id, undefined, localWorkerExecutorId, workspaceExecutorId),
          staleTime: 0,
        })
        if (cancelled || !isCurrentPreviewScope(scopeKey)) {
          return
        }

        previewRestoreAttemptedScopeRef.current = scopeKey
        if (!currentPreview.preview || !currentPreview.viewer) {
          setPreviewAutoOpenBlocked(true)
          return
        }

        applyPreviewState({
          scopeKey,
          preview: currentPreview.preview,
          viewer: currentPreview.viewer,
          accessRoute: currentPreview.accessRoute ?? null,
        })
        queryClient.setQueryData(workspaceQueryKeys.preview(currentPreview.preview.previewId), currentPreview)
        setPreviewAutoOpenBlocked(false)

        if (!shouldReconnectRestoredWorkspacePreview(currentPreview.preview)) {
          return
        }

        setPreviewBusyAction('open')
        const reconnectedPreview = await api.openTaskPreview(displayTask.id, {
          workspaceId: currentWorkspace.id,
          workspaceSessionId: currentPreview.preview.workspaceSessionId,
          autoStart: false,
          meshSourceExecutorId: localWorkerExecutorId,
        })
        if (cancelled || !isCurrentPreviewScope(scopeKey)) {
          return
        }

        applyPreviewState({
          scopeKey,
          preview: reconnectedPreview.preview,
          viewer: reconnectedPreview.viewer,
          accessRoute: reconnectedPreview.accessRoute ?? null,
        })
        queryClient.setQueryData(workspaceQueryKeys.preview(reconnectedPreview.preview.previewId), reconnectedPreview)
        queryClient.setQueryData(scopedPreviewQueryKey, reconnectedPreview)
      } catch {
        if (isCurrentPreviewScope(scopeKey)) {
          setPreviewAutoOpenBlocked(true)
        }
      } finally {
        if (previewRestoreInFlightScopeRef.current === scopeKey) {
          previewRestoreInFlightScopeRef.current = ''
        }
        if (isCurrentPreviewScope(scopeKey)) {
          setPreviewBusyAction(null)
        }
      }
    })()

    return () => {
      cancelled = true
    }
  }, [
    activePrimaryView,
    applyPreviewState,
    currentWorkspace,
    displayTask,
    environmentPreview?.appUrl,
    isCurrentPreviewScope,
    localWorkerExecutorId,
    pageVisible,
    previewBusyAction,
    previewScopeKey,
    previewSession,
    queryClient,
    workspaceExecutorId,
  ])

  useEffect(() => {
    if (
      activePrimaryView !== 'preview'
      || previewSession
      || previewBusyAction
      || previewAutoOpenBlocked
      || canUseLocalDirectPreviewForWorkspace
    ) {
      return
    }

    if (!displayTask || !currentWorkspace || !workspaceSession || !environmentPreview?.appUrl) {
      return
    }

    void handleOpenWorkspacePreview({ source: 'auto' })
  }, [
    activePrimaryView,
    currentWorkspace,
    displayTask,
    environmentPreview?.appUrl,
    handleOpenWorkspacePreview,
    canUseLocalDirectPreviewForWorkspace,
    previewAutoOpenBlocked,
    previewBusyAction,
    previewSession,
    workspaceSession,
  ])

  useEffect(() => {
    const response = previewStatusQuery.data
    if (!response) {
      return
    }

    applyPreviewState({
      scopeKey: buildWorkspacePreviewScopeKey({
        taskId: response.preview.taskId,
        workspaceId: response.preview.workspaceId,
        executorId: response.preview.executorId,
      }),
      preview: response.preview,
      viewer: response.viewer,
      accessRoute: response.accessRoute ?? null,
    })
  }, [applyPreviewState, previewStatusQuery.data])

  useEffect(() => {
    if (recordsResourceStatus !== 'active') {
      return
    }

    if (!displayTask || !currentWorkspace || !workspaceSession) {
      setTestRecordMessages([])
      setTestRecordLoading(false)
      setTestRecordRefreshing(false)
      testRecordConversationCountRef.current = null
      return
    }

    void loadTestRecordMessages({ silent: true })
  }, [currentWorkspace?.id, displayTask?.id, loadTestRecordMessages, recordsResourceStatus, workspaceSession?.id])

  useEffect(() => {
    testRecordLastEventIdRef.current = null
    testRecordConversationCountRef.current = null
    setTestRecordLiveStatusIfChanged('closed')
  }, [displayTask?.id, currentWorkspace?.id, setTestRecordLiveStatusIfChanged, workspaceSession?.id])

  useEffect(() => {
    if (recordsResourceStatus !== 'active' || !displayTask || !currentWorkspace || !workspaceSession) {
      return
    }

    let cancelled = false
    let reconnectTimer: number | null = null

    const scheduleReconnect = () => {
      if (cancelled) {
        return
      }

      reconnectTimer = window.setTimeout(() => {
        connect()
      }, 1500)
    }

    const connect = () => {
      const token = typeof window !== 'undefined' ? localStorage.getItem('auth_token') : null
      if (!token) {
        setTestRecordLiveStatusIfChanged('error')
        return
      }

      const baseUrl = resolveApiWebSocketUrl(`/api/tasks/${displayTask.id}/chat-ws`)
      const url = new URL(baseUrl, typeof window !== 'undefined' ? window.location.origin : undefined)
      url.searchParams.set('token', token)
      url.searchParams.set('workspaceId', currentWorkspace.id)
      url.searchParams.set('workspaceSessionId', workspaceSession.id)
      if (testRecordLastEventIdRef.current) {
        url.searchParams.set('lastEventId', testRecordLastEventIdRef.current)
      }

      const socket = new WebSocket(url.toString())
      testRecordSocketRef.current = socket
      setTestRecordLiveStatusIfChanged('connecting')

      socket.addEventListener('open', () => {
        if (cancelled) {
          socket.close()
          return
        }
        setTestRecordLiveStatusIfChanged('open')
      })

      socket.addEventListener('message', (event) => {
        const raw = String(event.data)
        try {
          const message = parseWorkspaceSessionChatWsMessage(raw)
          if (message.type === 'task_chat.event') {
            testRecordLastEventIdRef.current = message.eventId
          }

          const part = getWorkspaceSessionChatWsPart(message)
          if (!part) {
            return
          }

          if (part.type === 'observation') {
            const observationMessage = buildObservationConversationMessage(part.data)
            appendLiveObservationToTestRecords(observationMessage)

            // Auto-switch to desktop view when agent starts Desktop Sandbox
            const obsMeta = part.data.metadata as Record<string, unknown> | undefined
            if (obsMeta?.sandboxEvent === 'started' && obsMeta?.streamUrl) {
              setActivePrimaryView('desktop')
            }

            return
          }

          if (part.type === 'session') {
            const snapshot = part.data as TaskChatSessionSnapshot
            const nextCount = snapshot.conversation.messageCount
            if (typeof nextCount !== 'number') {
              return
            }

            if (testRecordConversationCountRef.current === null) {
              testRecordConversationCountRef.current = nextCount
              return
            }

            if (nextCount !== testRecordConversationCountRef.current) {
              testRecordConversationCountRef.current = nextCount
              void loadTestRecordMessages({ silent: true })
            }
          }
        } catch {
          // ignore malformed ws payload
        }
      })

      socket.addEventListener('close', () => {
        if (testRecordSocketRef.current === socket) {
          testRecordSocketRef.current = null
        }
        if (cancelled) {
          return
        }
        setTestRecordLiveStatusIfChanged('closed')
        scheduleReconnect()
      })

      socket.addEventListener('error', () => {
        if (cancelled) {
          return
        }
        setTestRecordLiveStatusIfChanged('error')
      })
    }

    connect()

    return () => {
      cancelled = true
      if (reconnectTimer) {
        window.clearTimeout(reconnectTimer)
      }
      const socket = testRecordSocketRef.current
      if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
        socket.close()
      }
      if (testRecordSocketRef.current === socket) {
        testRecordSocketRef.current = null
      }
    }
  }, [
    appendLiveObservationToTestRecords,
    currentWorkspace?.id,
    displayTask?.id,
    loadTestRecordMessages,
    recordsResourceStatus,
    setTestRecordLiveStatusIfChanged,
    workspaceSession?.id,
  ])

  return {
    environmentBusyAction,
    localEnvironmentProbe,
    localWorkerDiagnostics,
    environmentStatus,
    environmentStatusLoading,
    handleOpenWorkspacePreview,
    handleOpenWorkspacePreviewInBrowser,
    handleBackToParentSession,
    handleCreateRepairSession,
    handleOpenEnvironmentApp,
    handleRefreshWorkspacePreview,
    handleRevokeWorkspacePreviewShare,
    handleRunEnvironmentAction,
    handleShareWorkspacePreview,
    handleStopWorkspacePreview,
    loadTestRecordMessages,
    markEnvironmentTerminalClosed,
    markEnvironmentTerminalStart,
    markEnvironmentTerminalStop,
    previewBusyAction,
    previewAccessRoute,
    previewSession,
    previewShareUrl,
    previewViewer,
    repairingObservationId,
    refreshEnvironmentStatus,
    refreshLocalDirectProbes,
    testRecordLiveStatus,
    testRecordLoading,
    testRecordMessages,
    testRecordRefreshing,
  }
}
