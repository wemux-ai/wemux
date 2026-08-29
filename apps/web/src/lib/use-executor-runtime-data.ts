import type { ExecutorRecord } from '@shared/types'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useMemo } from 'react'
import { api, type ManagedCloudRuntimeStatus } from './api'
import { isManagedCloudDevOnlyEnabled } from './runtime-config'
import { workspaceQueryKeys } from './workspace-query-keys'

const EXECUTORS_CACHE_TTL_MS = 30_000
const MANAGED_CLOUD_RUNTIME_CACHE_TTL_MS = 15_000

const loadExecutors = async () => {
  const response = await api.listExecutors()
  return response.executors
}

const loadManagedCloudRuntime = async () => {
  if (!isManagedCloudDevOnlyEnabled()) {
    return null
  }

  const response = await api.getManagedCloudRuntime()
  return response.runtime
}

export const useExecutorRuntimeData = () => {
  const queryClient = useQueryClient()
  const managedCloudEnabled = isManagedCloudDevOnlyEnabled()
  const executorsQueryKey = useMemo(() => workspaceQueryKeys.executors(), [])
  const managedCloudRuntimeQueryKey = useMemo(() => workspaceQueryKeys.managedCloudRuntime(), [])
  const executorsQuery = useQuery<ExecutorRecord[]>({
    queryKey: executorsQueryKey,
    staleTime: EXECUTORS_CACHE_TTL_MS,
    // 所有消费方共享这一份缓存和轮询，避免 dashboard/execution/workspaces 页面各自发起
    // 独立的 listExecutors 轮询请求（同时挂载时请求量会翻 3-4 倍）。
    refetchInterval: EXECUTORS_CACHE_TTL_MS,
    placeholderData: (previousData) => previousData,
    queryFn: loadExecutors,
  })
  const managedCloudRuntimeQuery = useQuery<ManagedCloudRuntimeStatus | null>({
    queryKey: managedCloudRuntimeQueryKey,
    enabled: managedCloudEnabled,
    staleTime: MANAGED_CLOUD_RUNTIME_CACHE_TTL_MS,
    placeholderData: (previousData) => previousData,
    queryFn: loadManagedCloudRuntime,
  })

  const refreshExecutors = useCallback(async (force = false) => {
    if (force) {
      await queryClient.invalidateQueries({ queryKey: executorsQueryKey })
    }

    return queryClient.fetchQuery({
      queryKey: executorsQueryKey,
      queryFn: loadExecutors,
      staleTime: force ? 0 : EXECUTORS_CACHE_TTL_MS,
    }).catch(() => queryClient.getQueryData<ExecutorRecord[]>(executorsQueryKey) ?? [])
  }, [executorsQueryKey, queryClient])

  const setExecutorsData = useCallback((updater: (current: ExecutorRecord[]) => ExecutorRecord[]) => {
    queryClient.setQueryData<ExecutorRecord[]>(executorsQueryKey, (current) => updater(current ?? []))
  }, [executorsQueryKey, queryClient])

  const refreshManagedCloudRuntime = useCallback(async (force = false) => {
    if (!managedCloudEnabled) {
      queryClient.setQueryData(managedCloudRuntimeQueryKey, null)
      return null
    }

    if (force) {
      await queryClient.invalidateQueries({ queryKey: managedCloudRuntimeQueryKey })
    }

    return queryClient.fetchQuery({
      queryKey: managedCloudRuntimeQueryKey,
      queryFn: loadManagedCloudRuntime,
      staleTime: force ? 0 : MANAGED_CLOUD_RUNTIME_CACHE_TTL_MS,
    }).catch(() => queryClient.getQueryData<ManagedCloudRuntimeStatus | null>(managedCloudRuntimeQueryKey) ?? null)
  }, [managedCloudEnabled, managedCloudRuntimeQueryKey, queryClient])

  return {
    executors: executorsQuery.data ?? [],
    executorsLoading: executorsQuery.isLoading,
    managedCloudRuntime: managedCloudEnabled ? managedCloudRuntimeQuery.data ?? null : null,
    refreshExecutors,
    refreshManagedCloudRuntime,
    setExecutorsData,
  }
}
