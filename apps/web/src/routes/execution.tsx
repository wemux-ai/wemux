// [INPUT]: 执行中心请求
// [OUTPUT]: 执行中心页
// [POS]: 执行中心页
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import { createFileRoute } from '@tanstack/react-router'
import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { ExecutionPage } from '../components/execution/execution-page'
import { api, type CollaborationWorkspace, type ManagedCloudUsageResponse } from '../lib/api'
import { useApp } from '../lib/app-provider'
import {
  COLLABORATION_WORKSPACE_CHANGE_EVENT,
  getStoredCollaborationWorkspaceId,
  resolveCollaborationWorkspaceId,
} from '../lib/collaboration-workspace'
import { useTranslation } from '../lib/i18n/react'
import { useExecutorRuntimeData } from '../lib/use-executor-runtime-data'
import {
  buildWorkerRunCommand,
  type WorkerLocalInstallTarget,
  type WorkerRunMode,
} from '../lib/worker-connect-command'

export const Route = createFileRoute('/execution')({
  validateSearch: (search: Record<string, unknown>) => ({
    createExecutor: search.createExecutor === '1' ? '1' : undefined,
    editExecutorId: typeof search.editExecutorId === 'string' && search.editExecutorId ? search.editExecutorId : undefined,
    terminalExecutorId: typeof search.terminalExecutorId === 'string' && search.terminalExecutorId ? search.terminalExecutorId : undefined,
    workspaceId: typeof search.workspaceId === 'string' && search.workspaceId ? search.workspaceId : undefined,
    teamId: typeof search.teamId === 'string' && search.teamId ? search.teamId : undefined,
  }),
  component: ExecutionRoute,
})

function ExecutionRoute() {
  const { language } = useTranslation()
  const search = Route.useSearch()
  const navigate = Route.useNavigate()
  const { state, busy, runMutation } = useApp()
  // executors/managedCloudRuntime 复用共享的 react-query 缓存和轮询，
  // 避免和 dashboard、workspaces 页面各自发起独立的 listExecutors/getManagedCloudRuntime 请求。
  const {
    executors,
    executorsLoading,
    managedCloudRuntime,
    refreshExecutors,
    refreshManagedCloudRuntime,
    setExecutorsData,
  } = useExecutorRuntimeData()
  const [workspaces, setWorkspaces] = useState<CollaborationWorkspace[]>([])
  const [managedCloudUsage, setManagedCloudUsage] = useState<ManagedCloudUsageResponse | null>(null)
  const [defaultWorkspaceId, setDefaultWorkspaceId] = useState('')
  const [pairingCode, setPairingCode] = useState('')
  const [pairingExpiresAt, setPairingExpiresAt] = useState('')
  const [pairingVisibility, setPairingVisibility] = useState<'private' | 'workspace'>('private')
  const [pairingWorkspaceId, setPairingWorkspaceId] = useState('')
  const [pairingWorkspaceIds, setPairingWorkspaceIds] = useState<string[]>([])
  const [pairingRunMode, setPairingRunMode] = useState<WorkerRunMode>('local')
  const [pairingInstallTarget, setPairingInstallTarget] = useState<WorkerLocalInstallTarget>('unix')
  const [pairingLabel, setPairingLabel] = useState(() => (language === 'zh' ? '我的 Worker' : 'My Worker'))
  const [pairingBusy, setPairingBusy] = useState(false)
  const searchWorkspaceId = search.workspaceId || search.teamId || ''
  const connectCommand = pairingCode
    ? buildWorkerRunCommand(pairingCode, pairingRunMode, { displayName: pairingLabel, installTarget: pairingInstallTarget })
    : ''
  const installerConnectCommand = pairingCode && pairingRunMode === 'local'
    ? buildWorkerRunCommand(pairingCode, 'local', {
        displayName: pairingLabel,
        installTarget: pairingInstallTarget === 'windows' ? 'unix' : 'windows',
      })
    : ''

  // executors/managedCloudRuntime 由 useExecutorRuntimeData 统一轮询，这里只加载
  // workspaces/managedCloudUsage 这两项该 hook 不覆盖的数据。
  const loadWorkspacesAndUsage = useCallback(async (options?: { silent?: boolean }) => {
    try {
      const [workspaceResponse, managedCloudUsageResponse] = await Promise.all([
        api.listCollaborationWorkspaces().catch(() => ({ workspaces: [] })),
        api.getManagedCloudUsage().catch(() => null),
      ])
      setWorkspaces(workspaceResponse.workspaces)
      setManagedCloudUsage(managedCloudUsageResponse)
      const resolvedWorkspaceId = resolveCollaborationWorkspaceId(
        workspaceResponse.workspaces,
        searchWorkspaceId || getStoredCollaborationWorkspaceId(),
      )
      setDefaultWorkspaceId(resolvedWorkspaceId)
      setPairingWorkspaceId((current) => current || resolvedWorkspaceId)
      setPairingWorkspaceIds((current) => (current.length > 0 ? current : (resolvedWorkspaceId ? [resolvedWorkspaceId] : [])))
    } catch (error) {
      if (!options?.silent) {
        toast.error(error instanceof Error ? error.message : (language === 'zh' ? '加载节点失败' : 'Failed to load executors'))
      }
    }
  }, [language, searchWorkspaceId])

  useEffect(() => {
    if (searchWorkspaceId) {
      setPairingVisibility('workspace')
      setPairingWorkspaceId(searchWorkspaceId)
      setPairingWorkspaceIds([searchWorkspaceId])
    }
  }, [searchWorkspaceId])

  useEffect(() => {
    let cancelled = false
    void loadWorkspacesAndUsage()
    const timer = window.setInterval(() => {
      if (!cancelled) {
        void loadWorkspacesAndUsage({ silent: true })
      }
    }, 8000)

    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [loadWorkspacesAndUsage])

  useEffect(() => {
    const handleWorkspaceChange = (event: Event) => {
      const workspaceId = (event as CustomEvent<{ workspaceId?: string }>).detail?.workspaceId
      const resolvedWorkspaceId = resolveCollaborationWorkspaceId(workspaces, workspaceId || getStoredCollaborationWorkspaceId())
      setDefaultWorkspaceId(resolvedWorkspaceId)
      setPairingWorkspaceId((current) => current || resolvedWorkspaceId)
    }

    window.addEventListener(COLLABORATION_WORKSPACE_CHANGE_EVENT, handleWorkspaceChange)
    return () => {
      window.removeEventListener(COLLABORATION_WORKSPACE_CHANGE_EVENT, handleWorkspaceChange)
    }
  }, [workspaces])

  return (
    <ExecutionPage
      executionCenter={state.executionCenter}
      projects={state.projects}
      tasks={state.tasks}
      nodes={state.nodes}
      projectBindings={state.projectBindings}
      distributedTasks={state.distributedTasks}
      executors={executors}
      managedCloudRuntime={managedCloudRuntime}
      managedCloudUsage={managedCloudUsage}
      workspaces={workspaces}
      defaultWorkspaceId={defaultWorkspaceId}
      pairingCode={pairingCode}
      connectCommand={connectCommand}
      installerConnectCommand={installerConnectCommand}
      pairingExpiresAt={pairingExpiresAt}
      pairingVisibility={pairingVisibility}
      pairingWorkspaceId={pairingWorkspaceId}
      pairingWorkspaceIds={pairingWorkspaceIds}
      pairingLabel={pairingLabel}
      pairingRunMode={pairingRunMode}
      pairingInstallTarget={pairingInstallTarget}
      pairingBusy={pairingBusy}
      autoOpenCreateDialog={search.createExecutor === '1'}
      autoOpenEditExecutorId={search.editExecutorId}
      autoOpenTerminalExecutorId={search.terminalExecutorId}
      executorLoading={executorsLoading}
      busy={busy}
      onPairingVisibilityChange={setPairingVisibility}
      onPairingWorkspaceIdChange={setPairingWorkspaceId}
      onPairingWorkspaceIdsChange={setPairingWorkspaceIds}
      onPairingLabelChange={setPairingLabel}
      onPairingRunModeChange={setPairingRunMode}
      onPairingInstallTargetChange={setPairingInstallTarget}
      onCreatePairingCode={async (payload) => {
        setPairingBusy(true)
        try {
          const response = await api.createExecutorPairingCode({
            visibility: pairingVisibility === 'workspace' ? 'team' : 'private',
            teamId: pairingVisibility === 'workspace' ? pairingWorkspaceIds[0] || pairingWorkspaceId || undefined : undefined,
            workspaceIds: pairingVisibility === 'workspace' ? pairingWorkspaceIds : undefined,
            previewExposureMode: payload.previewExposureMode,
            label: pairingLabel.trim() || (language === 'zh' ? '我的 Worker' : 'My Worker'),
          })
          setPairingCode(response.pairingCode.pairingCode)
          setPairingExpiresAt(response.pairingCode.expiresAt)
          const nextConnectCommand = buildWorkerRunCommand(response.pairingCode.pairingCode, pairingRunMode, {
            displayName: pairingLabel.trim() || (language === 'zh' ? '我的 Worker' : 'My Worker'),
            installTarget: pairingInstallTarget,
          })
          try {
            await navigator.clipboard.writeText(nextConnectCommand)
            toast.success(language === 'zh' ? '连接命令已生成并复制' : 'Connect command generated and copied')
          } catch {
            toast.success(language === 'zh' ? '连接命令已生成' : 'Connect command generated')
          }
        } catch (error) {
          toast.error(error instanceof Error ? error.message : (language === 'zh' ? '生成连接命令失败' : 'Failed to generate connect command'))
        } finally {
          setPairingBusy(false)
        }
      }}
      onCreateDialogOpenChange={(open) => {
        navigate({
          search: (current) => ({
            ...current,
            createExecutor: open ? '1' : undefined,
          }),
          replace: true,
        })
      }}
      onEditDialogOpenChange={(executorId) => {
        navigate({
          search: (current) => ({
            ...current,
            editExecutorId: executorId || undefined,
          }),
          replace: true,
        })
      }}
      onOpenTerminal={(executorId) => {
        navigate({
          search: (current) => ({
            ...current,
            terminalExecutorId: executorId,
          }),
        })
      }}
      onCloseTerminal={() => {
        navigate({
          search: (current) => ({
            ...current,
            terminalExecutorId: undefined,
          }),
          replace: true,
        })
      }}
      onUpdateExecutor={async (executorId, payload) => {
        const response = await api.updateExecutor(executorId, {
          name: payload.name,
          note: payload.note,
          maxConcurrency: payload.maxConcurrency,
          previewExposureMode: payload.previewExposureMode,
          previewIngressPort: payload.previewIngressPort,
          visibility: payload.visibility === 'workspace' ? 'team' : 'private',
          teamId: payload.visibility === 'workspace' ? payload.workspaceIds?.[0] || payload.workspaceId : undefined,
          workspaceIds: payload.visibility === 'workspace' ? payload.workspaceIds : undefined,
        })
        setExecutorsData((current) => current.map((item) => (item.executorId === executorId ? response.executor : item)))
        toast.success(language === 'zh' ? '节点配置已更新' : 'Executor config updated')
      }}
      onRefreshExecutor={async (executorId) => {
        const response = await api.refreshExecutorTelemetry(executorId)
        setExecutorsData((current) => current.map((item) => (item.executorId === executorId ? response.executor : item)))
      }}
      onDeleteExecutor={async (executorId) => {
        const response = await api.deleteExecutor(executorId)
        setExecutorsData((current) => current.filter((item) => item.executorId !== executorId))
        toast.success(response.message || (language === 'zh' ? '节点已删除' : 'Executor deleted'))
      }}
      onShutdownExecutor={async (executorId) => {
        const response = await api.shutdownExecutor(executorId)
        toast.success(response.message || (language === 'zh' ? '已通知节点退出' : 'Executor shutdown requested'))
      }}
      onStartManagedCloudExecutor={async () => {
        const response = await api.ensureManagedCloudExecutor({ autoStart: true })
        void refreshExecutors(true)
        void refreshManagedCloudRuntime(true)
        toast.success(response.message || (language === 'zh' ? '官方云节点已启动' : 'Managed cloud executor started'))
      }}
      onCreateDistributedTask={(payload) => runMutation(() => api.createDistributedTask(payload))}
      onAssignTask={(taskId, nodeId) => runMutation(() => api.assignDistributedTask(taskId, nodeId))}
      onCreatePullRequest={(taskId, payload) => runMutation(() => api.createDistributedTaskPullRequest(taskId, payload))}
      onRefreshPullRequestStatus={(taskId) => runMutation(() => api.refreshDistributedTaskPullRequestStatus(taskId))}
      onCancelTask={(taskId) => runMutation(() => api.cancelDistributedTask(taskId))}
      onRetryTask={(taskId) => runMutation(() => api.retryDistributedTask(taskId))}
      onTakeoverTask={(taskId, nodeId) => runMutation(() => api.takeoverDistributedTask(taskId, nodeId))}
    />
  )
}
