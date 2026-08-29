import type {
  AgentConfig,
  ExecutionEventCursor,
  ExecutionEventLayer,
  ExecutionEventLogRecord,
  ExecutionEventType,
  ExecutorDirectoryBrowseResult,
  ExecutorFileReadResult,
  ExecutorFileWriteResult,
  ExecutorPairingCodeRecord,
  ExecutorRecord,
  LocalPathProbeResult,
  Task,
} from '@shared/types'
import type {
  ApiResponse,
  ManagedCloudExecutorPayload,
  ManagedCloudUsageResponse,
  ManagedCloudRuntimePrewarmResult,
  ManagedCloudRuntimeStatus,
  ManagedCloudRuntimeTargetStatus,
  TeamExecutorRecord,
  WorkerDoctorPayload,
} from '../types'
import { request } from '../client'

export const executorsMethods = {
  listExecutors: (workspaceId?: string) => {
    const suffix = workspaceId?.trim() ? `?workspaceId=${encodeURIComponent(workspaceId.trim())}` : ''
    return request<{ executors: ExecutorRecord[] }>(`/api/control-plane/executors${suffix}`)
  },
  getManagedCloudRuntime: () =>
    request<{ runtime: ManagedCloudRuntimeStatus; targets: ManagedCloudRuntimeTargetStatus[] }>('/api/control-plane/executors/managed-cloud/runtime'),
  getManagedCloudUsage: () =>
    request<ManagedCloudUsageResponse>('/api/control-plane/executors/managed-cloud/usage'),
  reconcileManagedCloudExecutors: () =>
    request<{ ok: boolean; runtime: ManagedCloudRuntimeStatus; targets: ManagedCloudRuntimeTargetStatus[]; relabeledCount: number; rewrittenConfigCount: number; warnings: string[]; message: string }>('/api/control-plane/executors/managed-cloud/runtime/reconcile', {
      method: 'POST',
    }),
  prewarmManagedCloudTargets: (payload?: { targetIds?: string[] }) =>
    request<{ ok: boolean; runtime: ManagedCloudRuntimeStatus; targets: ManagedCloudRuntimeTargetStatus[]; prewarmed: ManagedCloudRuntimePrewarmResult[]; message: string }>('/api/control-plane/executors/managed-cloud/runtime/prewarm', {
      method: 'POST',
      body: JSON.stringify(payload ?? {}),
    }),
  ensureManagedCloudExecutor: (payload?: ManagedCloudExecutorPayload) =>
    request<{ ok: boolean; executor: ExecutorRecord; created: boolean; started: boolean; message: string }>('/api/control-plane/executors/managed-cloud', {
      method: 'POST',
      body: JSON.stringify(payload ?? {}),
    }),
  listExecutionEvents: (params?: { taskId?: string; executorId?: string; eventType?: ExecutionEventType; layer?: ExecutionEventLayer; failuresOnly?: boolean; limit?: number; cursor?: ExecutionEventCursor }) => {
    const search = new URLSearchParams()
    if (params?.taskId) search.set('taskId', params.taskId)
    if (params?.executorId) search.set('executorId', params.executorId)
    if (params?.eventType) search.set('eventType', params.eventType)
    if (params?.layer) search.set('layer', params.layer)
    if (typeof params?.failuresOnly === 'boolean') search.set('failuresOnly', params.failuresOnly ? '1' : '0')
    if (typeof params?.limit === 'number') search.set('limit', String(params.limit))
    if (params?.cursor) {
      search.set('cursorOccurredAt', params.cursor.occurredAt)
      search.set('cursorId', params.cursor.id)
    }
    const suffix = search.toString() ? `?${search.toString()}` : ''
    return request<{ events: ExecutionEventLogRecord[]; nextCursor: ExecutionEventCursor | null }>(`/api/control-plane/execution-events${suffix}`)
  },
  createExecutorPairingCode: (payload: {
    visibility: 'private' | 'team'
    teamId?: string
    workspaceIds?: string[]
    previewExposureMode?: 'private' | 'public-ingress'
    label?: string
  }) =>
    request<{ pairingCode: ExecutorPairingCodeRecord }>('/api/control-plane/executors/pairing-codes', { method: 'POST', body: JSON.stringify(payload) }),
  updateExecutor: (executorId: string, payload: {
    name?: string
    note?: string
    maxConcurrency?: number
    previewExposureMode?: 'private' | 'public-ingress'
    previewIngressPort?: number
    visibility?: 'private' | 'team'
    teamId?: string
    workspaceIds?: string[]
  }) =>
    request<{ ok: boolean; executor: ExecutorRecord }>(`/api/control-plane/executors/${executorId}`, { method: 'PUT', body: JSON.stringify(payload) }),
  addTeamExecutorBindings: (teamId: string, payload: { executorIds: string[] }) =>
    request<{ ok: boolean; executors: TeamExecutorRecord[] }>(`/api/auth/teams/${teamId}/executors`, { method: 'POST', body: JSON.stringify(payload) }),
  removeTeamExecutorBinding: (teamId: string, executorId: string) =>
    request<{ ok: boolean; executors: TeamExecutorRecord[] }>(`/api/auth/teams/${teamId}/executors/${executorId}`, { method: 'DELETE' }),
  deleteExecutor: (executorId: string) =>
    request<{ ok: boolean; executorId: string; message: string }>(`/api/control-plane/executors/${executorId}`, { method: 'DELETE' }),
  shutdownExecutor: (executorId: string) =>
    request<{ ok: boolean; executorId: string; message: string }>(`/api/control-plane/executors/${executorId}/shutdown`, { method: 'POST' }),
  getExecutorSshKey: (executorId: string) =>
    request<{ executorId: string; sshPubkey?: string }>(`/api/control-plane/executors/${executorId}/ssh-key`),
  refreshExecutorTelemetry: (executorId: string) =>
    request<{ ok: boolean; executor: ExecutorRecord }>(`/api/control-plane/executors/${executorId}/telemetry/refresh`, { method: 'POST' }),
  runExecutorDoctor: (executorId: string) =>
    request<{ ok: boolean; executorId: string; doctor: WorkerDoctorPayload }>(`/api/control-plane/executors/${executorId}/doctor`, { method: 'POST' }),
  probeExecutorLocalRepo: (executorId: string, localPath: string) =>
    request<LocalPathProbeResult>(`/api/control-plane/executors/${executorId}/repo-probe`, { method: 'POST', body: JSON.stringify({ localPath }) }),
  browseExecutorDirectory: (executorId: string, directoryPath?: string) =>
    request<ExecutorDirectoryBrowseResult>(`/api/control-plane/executors/${executorId}/directory-browse`, { method: 'POST', body: JSON.stringify({ directoryPath }) }),
  readExecutorFile: (executorId: string, filePath: string) =>
    request<ExecutorFileReadResult>(`/api/control-plane/executors/${executorId}/file-read`, { method: 'POST', body: JSON.stringify({ filePath }) }),
  writeExecutorFile: (executorId: string, filePath: string, content: string) =>
    request<ExecutorFileWriteResult>(`/api/control-plane/executors/${executorId}/file-write`, { method: 'POST', body: JSON.stringify({ filePath, content }) }),
  exportExecutorAgentRuntimeConfig: (executorId: string) =>
    request<{
      ok: boolean
      executorId: string
      opencodeConfigContent: string
      codexConfigContent: string
      codexAuthContent: string
      claudeCodeConfigContent: string
      defaultModel: string
      agentSettings: AgentConfig['agentSettings']
      at: string
    }>(`/api/control-plane/executors/${executorId}/agent-config/export`, { method: 'POST' }),
  exportExecutorOpenCodeConfig: (executorId: string) =>
    request<{ ok: boolean; executorId: string; opencodeConfigContent: string; defaultModel: string; at: string }>(`/api/control-plane/executors/${executorId}/opencode-config/export`, { method: 'POST' }),
  refreshAdapters: () => request<ApiResponse>('/api/adapters/refresh', { method: 'POST' }),
  testAdapter: (agentType: Task['agentType'], prompt: string, model?: string) =>
    request<{ ok: boolean; output?: string; error?: string }>('/api/adapters/test', { method: 'POST', body: JSON.stringify({ agentType, prompt, model }) }),
  reset: () => request<ApiResponse>('/api/reset', { method: 'POST' }),
}
