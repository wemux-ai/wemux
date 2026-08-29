import type { ExecutionModelOption, ExecutorRecord, ModelProfile, Task } from '@shared/types'
import type {
  ApiResponse,
  CodexAccountRecord,
  ModelProfileCreatePayload,
  ModelProfileImportPayload,
  ModelUsageSummaryResponse,
  ModelProfileUpdatePayload,
  WorkerConsolePayload,
  WorkerDoctorPayload,
} from '../types'
import { authFetch, extractErrorMessage, request, resolveApiUrl } from '../client'

type ModelProfileAgentTestPayload = {
  agentType: Task['agentType']
  providerId: string
  baseUrl?: string
  apiToken?: string
  bindingId?: string
  useStoredToken?: boolean
  modelIds: string[]
}

export type ModelProfileAgentTestResult = {
  ok: boolean
  agentType: Task['agentType']
  testedModelId: string
  executionModel: string
  latencyMs?: number
  outputPreview?: string
  message: string
}

const requestModelProfileAgentTest = async (payload: ModelProfileAgentTestPayload): Promise<ModelProfileAgentTestResult> => {
  const response = await authFetch(resolveApiUrl('/api/model-profiles/test-agent'), {
    method: 'POST',
    body: JSON.stringify(payload),
  })
  const contentType = response.headers.get('content-type') ?? ''
  if (!contentType.includes('application/json')) {
    const text = await response.text()
    return {
      ok: false,
      agentType: payload.agentType,
      testedModelId: payload.modelIds[0] ?? '',
      executionModel: '',
      message: extractErrorMessage(text) || `Request failed: ${response.status}`,
    }
  }

  const result = await response.json().catch(() => null) as Partial<ModelProfileAgentTestResult> | null
  return {
    ok: Boolean(response.ok && result?.ok),
    agentType: result?.agentType ?? payload.agentType,
    testedModelId: result?.testedModelId ?? payload.modelIds[0] ?? '',
    executionModel: result?.executionModel ?? '',
    latencyMs: result?.latencyMs,
    outputPreview: result?.outputPreview,
    message: typeof result?.message === 'string' && result.message.trim()
      ? result.message
      : `Request failed: ${response.status}`,
  }
}

export const modelsMethods = {
  getModelUsageSummary: (period?: '7d' | '30d' | 'all', scope?: { taskId?: string; workspaceId?: string; workspaceSessionId?: string }) => {
    const search = new URLSearchParams()
    if (period) {
      search.set('period', period)
    }
    if (scope?.taskId?.trim()) {
      search.set('taskId', scope.taskId.trim())
    }
    if (scope?.workspaceId?.trim()) {
      search.set('workspaceId', scope.workspaceId.trim())
    }
    if (scope?.workspaceSessionId?.trim()) {
      search.set('workspaceSessionId', scope.workspaceSessionId.trim())
    }
    const suffix = search.toString() ? `?${search.toString()}` : ''
    return request<ModelUsageSummaryResponse>(`/api/model-usage${suffix}`)
  },
  listModelProfiles: () => request<{ ok: boolean; profiles: ModelProfile[]; executors: ExecutorRecord[] }>('/api/model-profiles'),
  createModelProfile: (payload: ModelProfileCreatePayload) =>
    request<{ ok: boolean; profile: ModelProfile; message?: string }>('/api/model-profiles', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  updateModelProfile: (id: string, payload: ModelProfileUpdatePayload) =>
    request<{ ok: boolean; profile: ModelProfile; message?: string }>(`/api/model-profiles/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),
  importModelProfiles: (payload: ModelProfileImportPayload) =>
    request<{ ok: boolean; profiles: ModelProfile[]; message?: string }>('/api/model-profiles/import', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  testModelProfile: (payload: {
    providerId: string
    baseUrl?: string
    apiToken?: string
    bindingId?: string
    useStoredToken?: boolean
    compatibility: 'openai' | 'anthropic'
    modelIds: string[]
  }) =>
    request<{
      ok: boolean
      providerId: string
      endpoint: string
      testedModelId: string
      status: number
      latencyMs: number
      message: string
    }>('/api/model-profiles/test', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  testModelProfileAgent: (payload: {
    agentType: Task['agentType']
    providerId: string
    baseUrl?: string
    apiToken?: string
    bindingId?: string
    useStoredToken?: boolean
    modelIds: string[]
  }) =>
    requestModelProfileAgentTest(payload),
  deleteModelProfile: (id: string) =>
    request<ApiResponse>(`/api/model-profiles/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  listModels: () => request<{ ok: boolean; models: ExecutionModelOption[]; defaultModel?: string; message?: string }>('/api/models'),
  listAgentModels: (agentType: Task['agentType'], executorId?: string, options?: { waitRuntime?: boolean }) => {
    const search = new URLSearchParams({ agentType })
    if (executorId?.trim()) {
      search.set('executorId', executorId.trim())
    }
    if (options?.waitRuntime) {
      search.set('waitRuntime', '1')
    }
    return request<{ ok: boolean; models: ExecutionModelOption[]; defaultModel?: string; message?: string; runtimePending?: boolean }>(`/api/agent-models?${search.toString()}`)
  },
  syncOpenCodeModelConfig: () => request<ApiResponse>('/api/models/sync', { method: 'POST' }),
  syncAgentRuntimeConfigToWorkers: () => request<{ ok: boolean; syncedExecutorIds: string[]; message?: string }>('/api/agent-runtime/config/sync-workers', { method: 'POST' }),
  syncOpenCodeConfigToWorkers: () => request<{ ok: boolean; syncedExecutorIds: string[]; message?: string }>('/api/opencode/config/sync-workers', { method: 'POST' }),
  getWorkerConsole: () => request<{ ok: boolean; worker: WorkerConsolePayload }>('/api/worker/console'),
  bootstrapWorkerRuntime: () => request<{ report?: { ok: boolean; message?: string }; doctor: WorkerDoctorPayload }>('/api/worker/bootstrap-runtime', { method: 'POST' }),
  connectWorkerConsole: () => request<{ message?: string }>('/api/worker/connect', { method: 'POST' }),
  disconnectWorkerConsole: () => request<{ message?: string }>('/api/worker/disconnect', { method: 'POST' }),

  // ── ChatGPT 账号（Codex OAuth 设备码，经 server 转发到 worker）──
  startCodexDeviceLogin: (executorId?: string) =>
    request<{
      state: 'pending'
      userCode: string
      verificationUri: string
      startedAt: string
    }>('/api/model-accounts/codex/device/start', {
      method: 'POST',
      body: JSON.stringify({ executorId: executorId?.trim() || undefined }),
    }),
  getCodexDeviceStatus: (executorId?: string) =>
    request<{
      state: 'idle' | 'pending' | 'complete' | 'error'
      userCode?: string
      verificationUri?: string
      startedAt?: string
      account?: CodexAccountRecord
      message?: string
    }>(`/api/model-accounts/codex/device/status?executorId=${encodeURIComponent(executorId?.trim() || '')}`),
  dismissCodexDeviceLogin: (executorId?: string) =>
    request<{ ok: boolean }>('/api/model-accounts/codex/device/dismiss', {
      method: 'POST',
      body: JSON.stringify({ executorId: executorId?.trim() || undefined }),
    }),
  listCodexAccounts: (executorId?: string) =>
    request<{ accounts: CodexAccountRecord[]; activeAccountId: string | null }>(
      `/api/model-accounts/codex/accounts?executorId=${encodeURIComponent(executorId?.trim() || '')}`,
    ),
  selectCodexAccount: (accountId: string, executorId?: string) =>
    request<{ accounts: CodexAccountRecord[]; activeAccountId: string | null }>(
      '/api/model-accounts/codex/accounts/select',
      {
        method: 'POST',
        body: JSON.stringify({ executorId: executorId?.trim() || undefined, accountId }),
      },
    ),
  removeCodexAccount: (accountId: string, executorId?: string) =>
    request<{ accounts: CodexAccountRecord[]; activeAccountId: string | null }>(
      `/api/model-accounts/codex/accounts/${encodeURIComponent(accountId)}?executorId=${encodeURIComponent(executorId?.trim() || '')}`,
      { method: 'DELETE' },
    ),
  importCodexAccountToAllExecutors: (executorId?: string) =>
    request<{
      ok: boolean
      accountEmail?: string
      appliedToAllExecutors: boolean
      registeredModels: string[]
      message?: string
    }>('/api/model-accounts/codex/import', {
      method: 'POST',
      body: JSON.stringify({ executorId: executorId?.trim() || undefined }),
    }),

  // ── Claude 账号（OAuth 粘贴授权码，token 交换在 server 完成）──
  getClaudeAccountStatus: () =>
    request<{ connected: boolean }>('/api/model-accounts/claude/status'),
  getClaudeAuthorizeUrl: () =>
    request<{ authorizeUrl: string }>('/api/model-accounts/claude/authorize-url'),
  // ── OpenRouter 账号（OAuth PKCE 粘贴授权码，code→key 交换在 server 完成）──
  getOpenrouterAccountStatus: () =>
    request<{ connected: boolean }>('/api/model-accounts/openrouter/status'),
  getOpenrouterAuthorizeUrl: () =>
    request<{ authorizeUrl: string }>('/api/model-accounts/openrouter/authorize-url'),
  importOpenrouterAccount: (code: string) =>
    request<{
      ok: boolean
      registeredModels: string[]
      message?: string
    }>('/api/model-accounts/openrouter/import', {
      method: 'POST',
      body: JSON.stringify({ code }),
    }),

  importClaudeAccount: (authCode: string) =>
    request<{
      ok: boolean
      appliedToAllExecutors: boolean
      registeredModels: string[]
      message?: string
    }>('/api/model-accounts/claude/import', {
      method: 'POST',
      body: JSON.stringify({ authCode }),
    }),
}
