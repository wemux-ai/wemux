import { useQueryClient } from '@tanstack/react-query'
import { useCallback, useMemo, useRef, useState } from 'react'
import { type WorkspaceEnvironmentStatusSnapshot } from '@shared/task-environment'
import type { WorkspaceSession } from '@shared/types'
import { toast } from 'sonner'
import {
  shouldRunEnvironmentStartInTerminal,
  shouldShowEnvironmentStopCommand,
} from '../../routes/-workspace-route-shared'
import { api } from '../../lib/api'
import { workspaceQueryKeys } from '../../lib/workspace-query-keys'
import {
  clearWorkspaceTerminalRunning,
  setWorkspaceTerminalOpen as setWorkspaceTerminalOpenUi,
} from './workspaces-page-ui-store'
import { pickWorkspaceEnvironmentStatus } from './workspaces-page-helpers'
import type { WorkspaceTerminalCommandRequest } from './workspace-terminal-panel'
import type { WorkspaceListItem } from './workspaces-page-utils'

type EnvironmentPreview = {
  appUrl?: string
  logsCommand?: string
  startCommand?: string
  stopCommand?: string
} | null

type UseWorkspaceEnvironmentTerminalControllerOptions = {
  currentWorkspaceTerminalCollapsed: boolean
  environmentPreview: EnvironmentPreview
  isMobile: boolean
  persistentTerminalOpenPanelKeys: Record<string, boolean>
  searchWorkspaceSessionId?: string
  selectedItem: WorkspaceListItem | null
  selectedWorkspaceExecutorId: string
  selectedWorkspaceSession: WorkspaceSession | null
  setTerminalCollapsed: (collapsed: boolean) => void
  setWorkspaceTerminalOpen: (workspaceId: string, open: boolean) => void
  t: (key: string, options?: Record<string, unknown>) => string
  terminalOpenWorkspaceIds: Record<string, boolean>
  workspaceSessions: WorkspaceSession[]
}

export function useWorkspaceEnvironmentTerminalController({
  currentWorkspaceTerminalCollapsed,
  environmentPreview,
  isMobile,
  persistentTerminalOpenPanelKeys,
  searchWorkspaceSessionId,
  selectedItem,
  selectedWorkspaceExecutorId,
  selectedWorkspaceSession,
  setTerminalCollapsed,
  setWorkspaceTerminalOpen,
  t,
  terminalOpenWorkspaceIds,
  workspaceSessions,
}: UseWorkspaceEnvironmentTerminalControllerOptions) {
  const queryClient = useQueryClient()
  const [environmentStartCommandRunningWorkspaceSessionIds, setEnvironmentStartCommandRunningWorkspaceSessionIds] = useState<Record<string, boolean>>({})
  const [workspaceEnvironmentStatusesByWorkspaceSessionId, setWorkspaceEnvironmentStatusesByWorkspaceSessionId] = useState<Record<string, WorkspaceEnvironmentStatusSnapshot>>({})
  const [terminalCommandRequest, setTerminalCommandRequest] = useState<WorkspaceTerminalCommandRequest | null>(null)
  const terminalPresenceRequestIdRef = useRef(0)

  const environmentStartInTerminal = shouldRunEnvironmentStartInTerminal(environmentPreview)
  const shouldShowEnvironmentStop = shouldShowEnvironmentStopCommand(environmentPreview)
  const canOpenEnvironmentPreview = Boolean(environmentPreview?.appUrl)
  const selectedWorkspaceTerminalOpen = selectedItem
    ? Boolean((isMobile ? terminalOpenWorkspaceIds : persistentTerminalOpenPanelKeys)[selectedItem.workspace.id])
    : false
  const selectedWorkspaceTerminalKeptAlive = selectedWorkspaceTerminalOpen && currentWorkspaceTerminalCollapsed
  const selectedWorkspaceTerminalActive = selectedWorkspaceTerminalOpen || !currentWorkspaceTerminalCollapsed
  const shouldRenderSelectedWorkspaceTerminal = Boolean(selectedItem && selectedWorkspaceTerminalActive)
  const selectedWorkspaceEnvironmentSessionId = selectedWorkspaceSession?.id || searchWorkspaceSessionId || ''
  const selectedWorkspaceStartCommandRunning = Boolean(
    selectedWorkspaceEnvironmentSessionId
    && environmentStartCommandRunningWorkspaceSessionIds[selectedWorkspaceEnvironmentSessionId],
  )
  const canStopEnvironment = Boolean(environmentPreview?.stopCommand?.trim()) || selectedWorkspaceStartCommandRunning

  const handleToggleSelectedWorkspaceTerminal = useCallback(() => {
    if (!selectedItem) {
      return
    }

    const nextCollapsed = !currentWorkspaceTerminalCollapsed
    const workspaceId = selectedItem.workspace.id

    if (selectedWorkspaceTerminalOpen || !nextCollapsed) {
      setWorkspaceTerminalOpen(workspaceId, true)
      setWorkspaceTerminalOpenUi(workspaceId, true)
    }

    setTerminalCollapsed(nextCollapsed)
  }, [
    currentWorkspaceTerminalCollapsed,
    selectedItem,
    selectedWorkspaceTerminalOpen,
    setTerminalCollapsed,
    setWorkspaceTerminalOpen,
  ])

  const handleWorkspaceEnvironmentStatusChange = useCallback((payload: {
    workspaceId: string
    workspaceSessionId: string
    status: WorkspaceEnvironmentStatusSnapshot
  }) => {
    const { workspaceSessionId, status } = payload
    if (!workspaceSessionId) {
      return
    }

    setWorkspaceEnvironmentStatusesByWorkspaceSessionId((current) => {
      const previous = current[workspaceSessionId]
      if (
        previous
        && previous.status === status.status
        && previous.message === status.message
        && previous.checkedAt === status.checkedAt
        && previous.url === status.url
        && previous.httpStatus === status.httpStatus
      ) {
        return current
      }

      return {
        ...current,
        [workspaceSessionId]: status,
      }
    })

    if (
      status.status === 'stopping'
      || status.status === 'stopped'
      || status.status === 'error'
      || status.status === 'unreachable'
    ) {
      setEnvironmentStartCommandRunningWorkspaceSessionIds((current) => (
        current[workspaceSessionId]
          ? {
              ...current,
              [workspaceSessionId]: false,
            }
          : current
      ))
    }
  }, [])

  const environmentStartCommandRunningWorkspaceIds = useMemo(() => {
    const next: Record<string, boolean> = {}
    for (const workspaceSession of workspaceSessions) {
      if (environmentStartCommandRunningWorkspaceSessionIds[workspaceSession.id]) {
        next[workspaceSession.workspaceId] = true
      }
    }
    return next
  }, [environmentStartCommandRunningWorkspaceSessionIds, workspaceSessions])

  const workspaceEnvironmentStatusesByWorkspaceId = useMemo(() => {
    const next: Record<string, WorkspaceEnvironmentStatusSnapshot> = {}
    for (const workspaceSession of workspaceSessions) {
      const status = workspaceEnvironmentStatusesByWorkspaceSessionId[workspaceSession.id]
      if (!status) {
        continue
      }

      next[workspaceSession.workspaceId] = pickWorkspaceEnvironmentStatus(
        next[workspaceSession.workspaceId],
        status,
      )
    }
    return next
  }, [workspaceEnvironmentStatusesByWorkspaceSessionId, workspaceSessions])

  const clearWorkspaceEnvironmentRunningForWorkspace = useCallback((workspaceId: string) => {
    clearWorkspaceTerminalRunning(
      workspaceSessions,
      workspaceId,
      setEnvironmentStartCommandRunningWorkspaceSessionIds,
    )
  }, [workspaceSessions])

  const syncSelectedWorkspaceTerminalPresence = useCallback(() => {
    if (!selectedItem?.workspace.id || !selectedWorkspaceExecutorId) {
      return () => {}
    }

    const workspaceId = selectedItem.workspace.id
    const requestId = terminalPresenceRequestIdRef.current + 1
    terminalPresenceRequestIdRef.current = requestId
    let cancelled = false

    const syncWorkspaceTerminalPresence = async () => {
      try {
        const terminalSessionsQueryKey = workspaceQueryKeys.terminalSessions(
          selectedWorkspaceExecutorId,
          workspaceId,
          'workspace',
        )
        const response = await queryClient.fetchQuery({
          queryKey: terminalSessionsQueryKey,
          queryFn: () => api.listExecutorTerminalSessions(selectedWorkspaceExecutorId, {
            workspaceId,
            scope: 'workspace',
          }),
          staleTime: 5_000,
        })
        if (cancelled || terminalPresenceRequestIdRef.current !== requestId) {
          return
        }

        const hasTerminalSessions = (response.sessions?.length ?? 0) > 0
        setWorkspaceTerminalOpenUi(workspaceId, hasTerminalSessions)
        setWorkspaceTerminalOpen(workspaceId, hasTerminalSessions)
        if (!hasTerminalSessions) {
          clearWorkspaceEnvironmentRunningForWorkspace(workspaceId)
        }
      } catch {
        if (cancelled || terminalPresenceRequestIdRef.current !== requestId) {
          return
        }
      }
    }

    void syncWorkspaceTerminalPresence()

    return () => {
      cancelled = true
    }
  }, [
    clearWorkspaceEnvironmentRunningForWorkspace,
    queryClient,
    selectedItem?.workspace.id,
    selectedWorkspaceExecutorId,
    setWorkspaceTerminalOpen,
  ])

  const startSelectedWorkspaceEnvironment = () => {
    const startCommand = environmentPreview?.startCommand?.trim()
    if (!startCommand || !selectedItem || !selectedWorkspaceEnvironmentSessionId) {
      return
    }

    setEnvironmentStartCommandRunningWorkspaceSessionIds((current) => ({
      ...current,
      [selectedWorkspaceEnvironmentSessionId]: true,
    }))

    setTerminalCollapsed(false)
    setTerminalCommandRequest({
      id: crypto.randomUUID(),
      kind: 'command',
      bindingKey: 'environment',
      workspaceId: selectedItem.workspace.id,
      command: startCommand,
      successMessage: t('workspace.environment.startedInTerminal', {
        defaultValue: '已在终端启动环境。日志会直接输出到终端，停止请用 Ctrl+C。',
      }),
    })
  }

  const stopSelectedWorkspaceEnvironment = (canStopSelectedEnvironment: boolean) => {
    if (!selectedItem || !selectedWorkspaceEnvironmentSessionId || !canStopSelectedEnvironment) {
      return
    }

    setEnvironmentStartCommandRunningWorkspaceSessionIds((current) => ({
      ...current,
      [selectedWorkspaceEnvironmentSessionId]: false,
    }))

    const stopCommand = environmentPreview?.stopCommand?.trim()

    setTerminalCollapsed(false)
    if (stopCommand) {
      setTerminalCommandRequest({
        id: crypto.randomUUID(),
        kind: 'command',
        bindingKey: 'environment',
        workspaceId: selectedItem.workspace.id,
        command: stopCommand,
        successMessage: t('workspace.environment.stopCommandStartedInTerminal', {
          defaultValue: '已在终端执行环境停止命令。',
        }),
      })
      return
    }

    setTerminalCommandRequest({
      id: crypto.randomUUID(),
      kind: 'interrupt',
      bindingKey: 'environment',
      workspaceId: selectedItem.workspace.id,
      successMessage: t('workspace.environment.stopSentToTerminal', {
        defaultValue: '已向环境终端发送 Ctrl+C。',
      }),
    })
  }

  const openSelectedWorkspaceEnvironmentLogs = () => {
    const logsCommand = environmentPreview?.logsCommand?.trim()

    setTerminalCollapsed(false)
    if (logsCommand) {
      setTerminalCommandRequest({
        id: crypto.randomUUID(),
        kind: 'command',
        bindingKey: 'environment',
        workspaceId: selectedItem?.workspace.id,
        command: logsCommand,
        successMessage: t('workspace.environment.logsCommandStartedInTerminal', {
          defaultValue: '已在终端执行环境日志命令。',
        }),
      })
      return
    }

    setTerminalCommandRequest({
      id: crypto.randomUUID(),
      kind: 'focus',
      bindingKey: 'environment',
      workspaceId: selectedItem?.workspace.id,
    })
    toast.message(t('workspace.environment.logsInTerminal', {
      defaultValue: '环境日志会直接输出到下方终端。',
    }))
  }

  const setEnvironmentTerminalCommand = useCallback((request: WorkspaceTerminalCommandRequest) => {
    setTerminalCommandRequest(request)
  }, [])

  return {
    canOpenEnvironmentPreview,
    canStopEnvironment,
    clearWorkspaceEnvironmentRunningForWorkspace,
    environmentStartCommandRunningWorkspaceIds,
    environmentStartInTerminal,
    handleToggleSelectedWorkspaceTerminal,
    handleWorkspaceEnvironmentStatusChange,
    openSelectedWorkspaceEnvironmentLogs,
    selectedWorkspaceTerminalActive,
    selectedWorkspaceTerminalKeptAlive,
    selectedWorkspaceTerminalOpen,
    selectedWorkspaceStartCommandRunning,
    setEnvironmentTerminalCommand,
    shouldRenderSelectedWorkspaceTerminal,
    shouldShowEnvironmentStop,
    startSelectedWorkspaceEnvironment,
    stopSelectedWorkspaceEnvironment,
    syncSelectedWorkspaceTerminalPresence,
    terminalCommandRequest,
    workspaceEnvironmentStatusesByWorkspaceId,
  }
}
