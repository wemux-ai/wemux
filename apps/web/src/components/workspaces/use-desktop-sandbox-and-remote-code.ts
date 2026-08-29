import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import type {
  AppState,
  WorkspaceDesktopSandboxAction,
  WorkspaceDesktopSandboxDisplayProfile,
  WorkspaceDesktopSandboxDto,
  WorkspaceRemoteCodeDto,
  WorkspaceSession,
  Task,
} from '@shared/types'
import { api } from '../../lib/api'
import {
  readDesktopSandboxClientNetworkHint,
  readStoredDesktopSandboxDisplayProfile,
  writeStoredDesktopSandboxDisplayProfile,
} from '../../lib/desktop-sandbox-display-profile'
import { isRemoteCodeTunnelReady, resolveRemoteCodeOpenUrl, waitForRemoteCodeTunnel } from '../../lib/remote-code-open'
import type { WorkspaceListItem } from './workspaces-page-utils'
import type { WorkspacePrimaryView } from '../../routes/-workspace-route-shared'

type RunMutationFn = <T extends { state: AppState; message?: string }>(action: () => Promise<T>) => Promise<T | undefined>

type ArchiveWorkspaceProgress = {
  workspaceId: string
  workspaceName: string
  detail: string
}

type DesktopSandboxAndRemoteCodeOptions = {
  activePrimaryView: WorkspacePrimaryView
  clearPendingWorkspaceSessionSelection: () => void
  clearSelectedLocalSessionPreview: () => void
  clearWorkspaceEnvironmentRunningForWorkspace: (workspaceId: string) => void
  displayTask: Task | null
  markEnvironmentTerminalClosed: () => void
  previewSession: { status?: string } | null
  handleStopWorkspacePreview: () => Promise<void> | void
  runMutation: RunMutationFn
  selectedWorkspaceId: string
  selectedWorkspaceIdRef: React.RefObject<string>
  selectedWorkspaceSession: WorkspaceSession | null
  selectedItem: WorkspaceListItem | null
  setActivePrimaryView: (view: WorkspacePrimaryView) => void
  setTerminalCollapsedState: (collapsed: boolean) => void
  setTerminalMaximized: (maximized: boolean) => void
  setWorkspaceTerminalCollapsedUi: (workspaceId: string, collapsed: boolean) => void
  setWorkspaceTerminalOpen: (workspaceId: string, open: boolean) => void
  setWorkspaceTerminalOpenUi: (workspaceId: string, open: boolean) => void
  setWorkspacePrimaryViewState: (workspaceId: string, view: WorkspacePrimaryView) => void
  setSelectedWorkspaceSessionId: (id: string) => void
  updateWorkspaceDirectoryCache: (updater: (current: any) => any) => void
  updateWorkspaceSearch: (patch: Record<string, unknown>, replace?: boolean) => void
}

export function useDesktopSandboxAndRemoteCode({
  activePrimaryView,
  clearPendingWorkspaceSessionSelection,
  clearSelectedLocalSessionPreview,
  clearWorkspaceEnvironmentRunningForWorkspace,
  displayTask,
  markEnvironmentTerminalClosed,
  previewSession,
  handleStopWorkspacePreview,
  runMutation,
  selectedWorkspaceId,
  selectedWorkspaceIdRef,
  selectedWorkspaceSession,
  selectedItem,
  setActivePrimaryView,
  setTerminalCollapsedState,
  setTerminalMaximized,
  setWorkspaceTerminalCollapsedUi,
  setWorkspaceTerminalOpen,
  setWorkspaceTerminalOpenUi,
  setWorkspacePrimaryViewState,
  setSelectedWorkspaceSessionId,
  updateWorkspaceDirectoryCache,
  updateWorkspaceSearch,
}: DesktopSandboxAndRemoteCodeOptions) {
  const [desktopSandbox, setDesktopSandbox] = useState<WorkspaceDesktopSandboxDto | null>(null)
  const [desktopSandboxBusyAction, setDesktopSandboxBusyAction] = useState<null | 'open' | 'refresh' | 'stop' | 'action' | 'command'>(null)
  const [desktopSandboxDisplayProfile, setDesktopSandboxDisplayProfile] = useState<WorkspaceDesktopSandboxDisplayProfile>(() => readStoredDesktopSandboxDisplayProfile())
  const [remoteCode, setRemoteCode] = useState<WorkspaceRemoteCodeDto | null>(null)
  const [remoteCodeBusyAction, setRemoteCodeBusyAction] = useState<null | 'open' | 'tunnel' | 'refresh' | 'stop'>(null)
  const [archiveWorkspaceBusyId, setArchiveWorkspaceBusyId] = useState('')
  const [archiveWorkspaceProgress, setArchiveWorkspaceProgress] = useState<ArchiveWorkspaceProgress | null>(null)

  const desktopSandboxScope = useMemo(() => ({
    taskId: displayTask?.id || '',
    workspaceId: selectedItem?.workspace.id || '',
    workspaceSessionId: selectedWorkspaceSession?.id || '',
  }), [displayTask?.id, selectedItem?.workspace.id, selectedWorkspaceSession?.id])
  const remoteCodeScope = desktopSandboxScope

  useEffect(() => {
    setDesktopSandbox(null)
    setRemoteCode(null)
  }, [desktopSandboxScope.taskId, desktopSandboxScope.workspaceId, desktopSandboxScope.workspaceSessionId])

  useEffect(() => {
    if (!remoteCodeScope.taskId || !remoteCodeScope.workspaceId) {
      return
    }

    const abortController = new AbortController()
    void api.getTaskRemoteCode(
      remoteCodeScope.taskId,
      remoteCodeScope.workspaceId,
      remoteCodeScope.workspaceSessionId || undefined,
      abortController.signal,
    ).then((response) => {
      if (!abortController.signal.aborted) {
        setRemoteCode(response.remoteCode)
      }
    }).catch(() => undefined)

    return () => abortController.abort()
  }, [remoteCodeScope.taskId, remoteCodeScope.workspaceId, remoteCodeScope.workspaceSessionId])

  useEffect(() => {
    if (activePrimaryView !== 'desktop' || !desktopSandboxScope.taskId || !desktopSandboxScope.workspaceId) {
      return
    }

    let cancelled = false
    setDesktopSandboxBusyAction('refresh')
    void api.getTaskDesktopSandbox(
      desktopSandboxScope.taskId,
      desktopSandboxScope.workspaceId,
      desktopSandboxScope.workspaceSessionId || undefined,
    ).then((response) => {
      if (!cancelled) {
        setDesktopSandbox(response.desktop)
      }
    }).catch((error) => {
      if (!cancelled) {
        toast.error(error instanceof Error ? error.message : '读取 Desktop Sandbox 状态失败')
      }
    }).finally(() => {
      if (!cancelled) {
        setDesktopSandboxBusyAction(null)
      }
    })

    return () => {
      cancelled = true
    }
  }, [
    activePrimaryView,
    desktopSandboxScope.taskId,
    desktopSandboxScope.workspaceId,
    desktopSandboxScope.workspaceSessionId,
  ])

  const resolveDesktopSandboxPayload = useCallback(() => {
    if (!displayTask || !selectedItem) {
      toast.error('当前工作区还没有可用任务，暂时无法启动 Desktop Sandbox。')
      return null
    }

    return {
      taskId: displayTask.id,
      payload: {
        workspaceId: selectedItem.workspace.id,
        workspaceSessionId: selectedWorkspaceSession?.id,
      },
    }
  }, [displayTask, selectedItem, selectedWorkspaceSession?.id])

  const applyDesktopSandboxResponse = useCallback((desktop: WorkspaceDesktopSandboxDto, successMessage?: string) => {
    setDesktopSandbox(desktop)
    if (!desktop.ok) {
      toast.error(desktop.error || desktop.message || 'Desktop Sandbox 操作失败')
      return false
    }
    if (successMessage) {
      toast.success(successMessage)
    }
    return true
  }, [])

  const handleOpenDesktopSandbox = useCallback(async () => {
    const scope = resolveDesktopSandboxPayload()
    if (!scope) {
      return
    }

    setDesktopSandboxBusyAction('open')
    try {
      const response = await api.openTaskDesktopSandbox(scope.taskId, {
        ...scope.payload,
        displayProfile: desktopSandboxDisplayProfile,
        clientNetwork: desktopSandboxDisplayProfile === 'auto'
          ? readDesktopSandboxClientNetworkHint()
          : undefined,
      })
      applyDesktopSandboxResponse(response.desktop, response.desktop.ok ? 'Desktop Sandbox 已启动。' : undefined)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '启动 Desktop Sandbox 失败')
    } finally {
      setDesktopSandboxBusyAction(null)
    }
  }, [applyDesktopSandboxResponse, desktopSandboxDisplayProfile, resolveDesktopSandboxPayload])

  const handleRefreshDesktopSandbox = useCallback(async () => {
    const scope = resolveDesktopSandboxPayload()
    if (!scope) {
      return
    }

    setDesktopSandboxBusyAction('refresh')
    try {
      const response = await api.getTaskDesktopSandbox(scope.taskId, scope.payload.workspaceId, scope.payload.workspaceSessionId)
      applyDesktopSandboxResponse(response.desktop)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '刷新 Desktop Sandbox 失败')
    } finally {
      setDesktopSandboxBusyAction(null)
    }
  }, [applyDesktopSandboxResponse, resolveDesktopSandboxPayload])

  const handleStopDesktopSandbox = useCallback(async () => {
    const scope = resolveDesktopSandboxPayload()
    if (!scope) {
      return
    }

    setDesktopSandboxBusyAction('stop')
    try {
      const response = await api.stopTaskDesktopSandbox(scope.taskId, scope.payload)
      applyDesktopSandboxResponse(response.desktop, response.desktop.ok ? 'Desktop Sandbox 已停止。' : undefined)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '停止 Desktop Sandbox 失败')
    } finally {
      setDesktopSandboxBusyAction(null)
    }
  }, [applyDesktopSandboxResponse, resolveDesktopSandboxPayload])

  const handleRunDesktopSandboxAction = useCallback(async (action: WorkspaceDesktopSandboxAction) => {
    const scope = resolveDesktopSandboxPayload()
    if (!scope) {
      return
    }

    setDesktopSandboxBusyAction('action')
    try {
      const response = await api.runTaskDesktopSandboxAction(scope.taskId, {
        ...scope.payload,
        action,
      })
      applyDesktopSandboxResponse(response.desktop)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '执行 Desktop Sandbox 桌面动作失败')
    } finally {
      setDesktopSandboxBusyAction(null)
    }
  }, [applyDesktopSandboxResponse, resolveDesktopSandboxPayload])

  const handleRunDesktopSandboxCommand = useCallback(async (command: string) => {
    const scope = resolveDesktopSandboxPayload()
    if (!scope) {
      return
    }

    setDesktopSandboxBusyAction('command')
    try {
      const response = await api.runTaskDesktopSandboxCommand(scope.taskId, {
        ...scope.payload,
        command,
      })
      applyDesktopSandboxResponse(response.desktop)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '执行 Desktop Sandbox 命令失败')
    } finally {
      setDesktopSandboxBusyAction(null)
    }
  }, [applyDesktopSandboxResponse, resolveDesktopSandboxPayload])

  const handleOpenDesktopSandboxExternal = useCallback((targetUrl?: string) => {
    const url = targetUrl?.trim() || desktopSandbox?.viewUrl || desktopSandbox?.streamRedirectUrl || desktopSandbox?.streamUrl || desktopSandbox?.controlUrl || ''
    if (!url) {
      toast.error('Desktop Sandbox 还没有可打开的地址。')
      return
    }
    window.open(url, '_blank', 'noopener,noreferrer')
  }, [desktopSandbox?.controlUrl, desktopSandbox?.streamRedirectUrl, desktopSandbox?.streamUrl, desktopSandbox?.viewUrl])

  const handleOpenRemoteCode = useCallback(async () => {
    if (!remoteCodeScope.taskId || !remoteCodeScope.workspaceId) {
      toast.error('当前工作区还没有可用任务，暂时无法打开 Code Server。')
      return
    }

    setRemoteCodeBusyAction('open')
    try {
      const response = await api.openTaskRemoteCode(remoteCodeScope.taskId, {
        workspaceId: remoteCodeScope.workspaceId,
        workspaceSessionId: remoteCodeScope.workspaceSessionId || undefined,
      })
      setRemoteCode(response.remoteCode)
      if (response.passwordOnce) {
        await navigator.clipboard?.writeText(response.passwordOnce).then(() => {
          toast.success('Code Server 密码已复制。')
        }).catch(() => {
          toast.message(`Code Server 密码：${response.passwordOnce}`)
        })
      }
      setRemoteCodeBusyAction('tunnel')
      const readyResponse = isRemoteCodeTunnelReady(response)
        ? response
        : await waitForRemoteCodeTunnel({
            openResponse: response,
            poll: () => api.getTaskRemoteCode(
              remoteCodeScope.taskId,
              remoteCodeScope.workspaceId,
              remoteCodeScope.workspaceSessionId || undefined,
            ),
            onUpdate: (nextResponse) => setRemoteCode(nextResponse.remoteCode),
          })
      setRemoteCode(readyResponse.remoteCode)
      const url = resolveRemoteCodeOpenUrl(readyResponse)
      if (!url) {
        toast.error('Code Server 隧道还没有就绪，请稍后重试。')
        return
      }
      window.open(url, '_blank', 'noopener,noreferrer')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '打开 Code Server 失败')
    } finally {
      setRemoteCodeBusyAction(null)
    }
  }, [remoteCodeScope.taskId, remoteCodeScope.workspaceId, remoteCodeScope.workspaceSessionId])

  const handleStopRemoteCode = useCallback(async () => {
    if (!remoteCodeScope.taskId || !remoteCodeScope.workspaceId) {
      return
    }

    setRemoteCodeBusyAction('stop')
    try {
      const response = await api.stopTaskRemoteCode(remoteCodeScope.taskId, {
        workspaceId: remoteCodeScope.workspaceId,
        workspaceSessionId: remoteCodeScope.workspaceSessionId || undefined,
      })
      setRemoteCode(response.remoteCode)
      toast.success('Code Server 已停止。')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '停止 Code Server 失败')
    } finally {
      setRemoteCodeBusyAction(null)
    }
  }, [remoteCodeScope.taskId, remoteCodeScope.workspaceId, remoteCodeScope.workspaceSessionId])

  const resetArchivedWorkspaceUiState = useCallback((
    workspaceId: string,
    { archived, selected }: { archived: boolean; selected: boolean },
  ) => {
    setWorkspaceTerminalOpen(workspaceId, false)
    setWorkspaceTerminalOpenUi(workspaceId, false)
    setWorkspaceTerminalCollapsedUi(workspaceId, true)
    clearWorkspaceEnvironmentRunningForWorkspace(workspaceId)

    if (!selected) {
      return
    }

    clearSelectedLocalSessionPreview()
    setTerminalCollapsedState(true)
    setTerminalMaximized(false)
    setDesktopSandbox(null)
    markEnvironmentTerminalClosed()
    setWorkspacePrimaryViewState(workspaceId, 'chat')
    updateWorkspaceSearch({
      panel: undefined,
      terminal: undefined,
    }, true)

    if (!archived) {
      return
    }

    clearPendingWorkspaceSessionSelection()
    setSelectedWorkspaceSessionId('')
    updateWorkspaceSearch({
      workspaceSessionId: undefined,
      panel: undefined,
      terminal: undefined,
    }, true)
  }, [
    clearPendingWorkspaceSessionSelection,
    clearSelectedLocalSessionPreview,
    clearWorkspaceEnvironmentRunningForWorkspace,
    markEnvironmentTerminalClosed,
    setSelectedWorkspaceSessionId,
    setWorkspaceTerminalOpen,
    setWorkspacePrimaryViewState,
    setWorkspaceTerminalCollapsedUi,
    setWorkspaceTerminalOpenUi,
    setTerminalCollapsedState,
    setTerminalMaximized,
    updateWorkspaceSearch,
  ])

  const cleanupWorkspaceRuntimeBeforeArchive = useCallback(async (item: WorkspaceListItem) => {
    const workspaceId = item.workspace.id
    const isSelectedWorkspace = selectedWorkspaceIdRef.current === workspaceId
    if (!isSelectedWorkspace) {
      resetArchivedWorkspaceUiState(workspaceId, { archived: false, selected: false })
      return
    }

    if (previewSession && previewSession.status !== 'closed' && previewSession.status !== 'error') {
      setArchiveWorkspaceProgress({
        workspaceId,
        workspaceName: item.workspace.name,
        detail: '正在停止 Preview 连接…',
      })
      try {
        await handleStopWorkspacePreview()
      } catch {
        // Best-effort cleanup only; archiving should continue.
      }
    }

    if (
      remoteCode
      && remoteCode.phase !== 'idle'
      && remoteCode.phase !== 'stopped'
      && remoteCode.phase !== 'error'
    ) {
      setArchiveWorkspaceProgress({
        workspaceId,
        workspaceName: item.workspace.name,
        detail: '正在停止 Code Server…',
      })
      try {
        await handleStopRemoteCode()
      } catch {
        // Best-effort cleanup only; archiving should continue.
      }
    }

    if (
      desktopSandbox
      && desktopSandbox.phase !== 'idle'
      && desktopSandbox.phase !== 'stopped'
      && desktopSandbox.phase !== 'error'
    ) {
      setArchiveWorkspaceProgress({
        workspaceId,
        workspaceName: item.workspace.name,
        detail: '正在停止 Desktop Sandbox…',
      })
      try {
        await handleStopDesktopSandbox()
      } catch {
        // Best-effort cleanup only; archiving should continue.
      }
    }

    setArchiveWorkspaceProgress({
      workspaceId,
      workspaceName: item.workspace.name,
      detail: '正在关闭终端与本地 Review…',
    })
    resetArchivedWorkspaceUiState(workspaceId, { archived: false, selected: true })
  }, [
    desktopSandbox,
    handleStopDesktopSandbox,
    handleStopRemoteCode,
    handleStopWorkspacePreview,
    previewSession,
    remoteCode,
    resetArchivedWorkspaceUiState,
    selectedWorkspaceIdRef,
  ])

  const handleArchiveWorkspace = useCallback(async (item: WorkspaceListItem, archived: boolean) => {
    const workspaceId = item.workspace.id
    const isSelectedWorkspace = selectedWorkspaceId === workspaceId
    setArchiveWorkspaceBusyId(workspaceId)

    if (archived) {
      setArchiveWorkspaceProgress({
        workspaceId,
        workspaceName: item.workspace.name,
        detail: '正在准备归档并清理资源…',
      })
    }

    try {
      if (archived) {
        await cleanupWorkspaceRuntimeBeforeArchive(item)
        setArchiveWorkspaceProgress({
          workspaceId,
          workspaceName: item.workspace.name,
          detail: '正在提交归档状态…',
        })
      }

      const response = await runMutation(() => api.archiveWorkspace(workspaceId, archived))
      if (!response) {
        return
      }

      updateWorkspaceDirectoryCache((current: any) => current
        ? {
            ...current,
            workspacesByProject: {
              ...current.workspacesByProject,
              [item.project.id]: response.workspaces,
            },
          }
        : current)

      if (archived) {
        resetArchivedWorkspaceUiState(workspaceId, { archived: true, selected: isSelectedWorkspace })
      }
    } finally {
      setArchiveWorkspaceBusyId('')
      setArchiveWorkspaceProgress((current) => (
        current?.workspaceId === workspaceId ? null : current
      ))
    }
  }, [cleanupWorkspaceRuntimeBeforeArchive, resetArchivedWorkspaceUiState, runMutation, selectedWorkspaceId, updateWorkspaceDirectoryCache])

  const openDesktopSandboxPanel = useCallback(() => {
    setActivePrimaryView('desktop')
  }, [setActivePrimaryView])

  const handleDesktopSandboxDisplayProfileChange = useCallback((profile: WorkspaceDesktopSandboxDisplayProfile) => {
    setDesktopSandboxDisplayProfile(profile)
    writeStoredDesktopSandboxDisplayProfile(profile)
  }, [])

  return {
    archiveWorkspaceBusyId,
    archiveWorkspaceProgress,
    desktopSandbox,
    desktopSandboxBusyAction,
    desktopSandboxDisplayProfile,
    handleArchiveWorkspace,
    handleDesktopSandboxDisplayProfileChange,
    handleOpenDesktopSandbox,
    handleOpenDesktopSandboxExternal,
    handleOpenRemoteCode,
    handleRefreshDesktopSandbox,
    handleRunDesktopSandboxAction,
    handleRunDesktopSandboxCommand,
    handleStopDesktopSandbox,
    handleStopRemoteCode,
    openDesktopSandboxPanel,
    remoteCode,
    remoteCodeBusyAction,
  }
}
