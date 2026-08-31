// [INPUT]: Authenticated runtime/settings requests, task-scoped uploads, object storage, and worker control services.
import { getEnv } from '@shared/env'
// [OUTPUT]: Runtime control APIs plus task image/attachment upload and media streaming endpoints.
// [POS]: Server system-route boundary; comment-purpose uploads store objects without creating task conversation turns.
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
import { loadavg } from 'node:os'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const resolveAppVersion = (): string => {
  const envVersion = process.env.npm_package_version?.trim()
  if (envVersion) return envVersion
  try {
    const pkg = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8')) as { version?: string }
    return pkg.version?.trim() || '0.0.0'
  } catch {
    return '0.0.0'
  }
}
import type { Hono, MiddlewareHandler } from 'hono'
import { z } from 'zod'
import { normalizeAgentConfig } from '@shared/agent-config'
import { VISIBLE_AGENT_TYPES } from '@shared/agent-type'
import { parsePrimaryAgentMcpServers, type McpServerPolicy } from '@shared/mcp'
import { buildAgentExecutionModelId, normalizeModelProviderBaseUrl } from '@shared/model-profile'
import type { AppState, OpenCodeExecutionConfig } from '@shared/types'
import { deriveExecutionCenter } from '@shared/task-orchestrator'
import { TASK_COMMENT_ATTACHMENT_MAX_BYTES } from '@shared/task-chat-attachment'
import { resolveAppBrand } from '../../services/brand'
import { clusterConfig } from '../../cluster/config'
import { checkAdapters, listAvailableModels } from '../../integrations/coding-agent/registry'
import { listVisibleExecutorsForUser } from '../../control-plane/collaboration'
import { executorWsService } from '../../control-plane/executor-ws-service'
import { executorWsRequests } from '../../control-plane/executor-ws-requests'
import { getTaskGitIdentityHealth } from '../../control-plane/task-git-identity'
import { getPrimaryDatabaseStatus, getPrimaryDatabaseMode } from '../../storage/primary/service'
import { getPool, getPostgresHealth } from '../../storage/postgres/db'
import { getStorageChangeListenerHealth, getStorageChangeListenerLag } from '../../storage/postgres/storage-change-listener'
import { getPersistenceFailureCount } from '../../storage/postgres/helpers'
import { getNode, listNodes } from '../../storage/postgres/distributed-task-store'
import { listPersistedExecutors } from '../../storage/postgres/executor-store'
import { getGitCredentialStatus, loadGitCredential, saveGitCredential } from '../../services/git-credential-store'
import {
  buildModelRuntimeEnv,
  createModelProfileForUser,
  deleteVisibleModelProfile,
  findModelProfileByBindingInProfiles,
  findVisibleModelProfileBindingForUser,
  importModelProfilesFromExecutor,
  listVisibleModelProfileExecutors,
  listVisibleModelProfilesForUser,
  updateModelProfileForUser,
} from '../../services/model-profile-service'
import { testModelProfileAvailability } from '../../services/model-profile-availability'
import {
  buildOpenRouterAuthorizeUrl,
  ensureOpenRouterOAuthProfile,
  exchangeOpenRouterCodeForKey,
  generatePkcePair,
  isOpenRouterOAuthProfile,
  listOpenRouterFreeModels,
  rememberOpenRouterVerifier,
  takeOpenRouterVerifier,
} from '../../services/model-gateway/openrouter-oauth'
import { getModelUsageSummaryForUser } from '../../services/model-usage-service'
import { listUserWorkspaces } from '../../repositories/workspace'
import { loadAgentModelOptionsFromExecutor } from '../../services/task-chat-dispatch'
import { isD1Enabled, getLegacyStorageMode } from '../../storage/board-sync'
import { getMeta, loadState, resetState } from '../../storage/app-state-store'
import { appendTaskConversationMessage } from '../../control-plane/conversation-service'
import { ensureWorkspaceMember, getAuthorizedTask, getScopedState, getUserIdFromHeader, settingsSchema, withState } from '../shared'
import {
  parseClaudeCodeConfigContent,
  requestWorkerConsole,
  resolveMainChatImageObjectKey,
  resolveTaskAttachmentObjectKeys,
  resolveTaskImageObjectKeys,
  sanitizeUploadFilename,
  syncSettingsToVisibleExecutors,
} from './helpers'
import { parseOpencodeConfigContent } from '@shared/opencode-config'
import { streamObject, uploadObject } from '../../services/object-storage'
import { SERVER_AGENT_TYPES } from '../../services/server-agent'
import { applyManagedCloudEnvConfig } from '../../services/managed-cloud-env-config'
import { isDevLoginEnabled } from '../../services/dev-auth-service'
import { getManagedCloudGate } from '../../services/gate/managed-cloud-gate'

const serverAgentTypeSchema = z.enum(SERVER_AGENT_TYPES)
const visibleAgentTypeSchema = z.enum(VISIBLE_AGENT_TYPES)

const MODEL_PROFILE_AGENT_TEST_TIMEOUT_MS = 45_000

const isAgentSmokeOutputFailure = (output: string) => {
  const normalized = output.trim().toLowerCase()
  if (!normalized) {
    return true
  }

  return [
    '401',
    '403',
    '404',
    'blocked',
    'invalid api key',
    'unauthorized',
    'forbidden',
    'model not found',
    'not found',
    'permission',
    'auth',
    'api key',
    'your request was blocked',
  ].some((pattern) => normalized.includes(pattern))
}

const sanitizeAgentSmokeOutput = (output: string) => output.replace(/\s+/g, ' ').trim().slice(0, 240)

const buildAgentSmokeOpenCodeProviderOverlay = (binding: {
  providerId: string
  modelId: string
  baseUrl?: string
  apiToken?: string
}): OpenCodeExecutionConfig => {
  const providerId = binding.providerId.trim()
  const modelId = binding.modelId.trim()
  const baseURL = normalizeModelProviderBaseUrl(binding.baseUrl) || undefined
  const apiKey = binding.apiToken?.trim() || undefined

  return {
    model: `${providerId}/${modelId}`,
    provider: {
      [providerId]: {
        npm: '@ai-sdk/openai-compatible',
        models: {
          [modelId]: {
            name: modelId,
          },
        },
        ...(baseURL || apiKey
          ? {
              options: {
                ...(baseURL ? { baseURL } : {}),
                ...(apiKey ? { apiKey } : {}),
              },
            }
          : {}),
      },
    },
  }
}

const canManagePersistedMcpServer = (server: McpServerPolicy, userId: string) => {
  if (server.managedBySystem) {
    return true
  }

  if (!server.ownerUserId) {
    return true
  }

  return server.ownerUserId === userId
}

const sanitizeMcpServerForPersistence = async (
  server: McpServerPolicy,
  userId: string,
  previous?: McpServerPolicy,
) : Promise<McpServerPolicy> => {
  if (server.managedBySystem) {
    return {
      ...server,
      ownerUserId: undefined,
      visibility: undefined,
      workspaceId: undefined,
    }
  }

  const visibility: McpServerPolicy['visibility'] = server.visibility === 'workspace' || server.visibility === 'team'
    ? server.visibility
    : 'private'
  const workspaceId = server.workspaceId?.trim() || undefined

  if (visibility === 'workspace') {
    if (!workspaceId) {
      throw new Error('共享到组织时必须选择组织。')
    }

    if (!(await ensureWorkspaceMember(workspaceId, userId))) {
      throw new Error('你不是该组织成员，不能共享这个 MCP。')
    }
  }

  return {
    ...server,
    visibility,
    workspaceId: visibility === 'workspace' || visibility === 'team' ? workspaceId : undefined,
    ownerUserId: visibility === 'workspace' || visibility === 'team'
      ? previous?.ownerUserId || server.ownerUserId?.trim() || userId
      : undefined,
    managedBySystem: false,
  }
}

const mergePersistedMcpServers = async (params: {
  previous: unknown
  incoming: unknown
  userId: string
}) => {
  const previousServers = parsePrimaryAgentMcpServers({ mcpServers: params.previous })
  const incomingServers = parsePrimaryAgentMcpServers({ mcpServers: params.incoming })
  const previousById = new Map(previousServers.map((server) => [server.id, server]))
  const nextServers: McpServerPolicy[] = []

  for (const previous of previousServers) {
    if (!canManagePersistedMcpServer(previous, params.userId)) {
      nextServers.push(previous)
      continue
    }

    const incoming = incomingServers.find((server) => server.id === previous.id)
    if (!incoming) {
      if (previous.managedBySystem) {
        nextServers.push(previous)
      }
      continue
    }

    nextServers.push(await sanitizeMcpServerForPersistence({
      ...previous,
      ...incoming,
    }, params.userId, previous))
  }

  for (const incoming of incomingServers) {
    if (previousById.has(incoming.id)) {
      continue
    }

    nextServers.push(await sanitizeMcpServerForPersistence(incoming, params.userId))
  }

  return nextServers
}

export const registerRuntimeSystemRoutes = (app: Hono, requireAuth: MiddlewareHandler) => {
  app.get('/api/model-usage', requireAuth, async (c) => {
    const period = (() => {
      const value = c.req.query('period')?.trim()
      return value === '7d' || value === '30d' || value === 'all' ? value : 'all'
    })()
    const scope = {
      taskId: c.req.query('taskId')?.trim() || undefined,
      workspaceId: c.req.query('workspaceId')?.trim() || undefined,
      workspaceSessionId: c.req.query('workspaceSessionId')?.trim() || undefined,
    }
    const userId = getUserIdFromHeader(c)
    if (!userId) {
      return c.json({ ok: false, message: '未登录' }, 401)
    }

    // 用户隔离：只统计当前用户可访问的 workspace / 自有 project 下的用量，
    // 不再返回全站汇总（此前任何登录用户可查看任意 workspace 用量）。
    const accessibleWorkspaces = await listUserWorkspaces(userId)
    const accessibleWorkspaceIds = new Set(accessibleWorkspaces.map((workspace) => workspace.id))
    const accessibleProjectIds = new Set(
      loadState().projects
        .filter((project) => project.createdById === userId)
        .map((project) => project.id),
    )
    return c.json({
      ok: true,
      summary: getModelUsageSummaryForUser({
        userId,
        accessibleWorkspaceIds,
        accessibleProjectIds,
        period,
        scope,
      }),
    })
  })

  app.get('/api/model-profiles', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    const profiles = await listVisibleModelProfilesForUser(userId)
    return c.json({ ok: true, profiles, executors: listVisibleModelProfileExecutors(userId) })
  })

  app.post('/api/model-profiles', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    const payload = z.object({
      name: z.string().trim().min(1),
      description: z.string().trim().optional(),
      visibility: z.enum(['private', 'team', 'workspace']).default('private'),
      teamId: z.string().trim().optional(),
      workspaceId: z.string().trim().optional(),
      bindings: z.array(z.object({
        agentType: serverAgentTypeSchema,
        providerId: z.string().trim().min(1),
        modelId: z.string().trim().min(1),
        label: z.string().trim().optional(),
        baseUrl: z.string().trim().optional(),
        apiToken: z.string().trim().optional(),
        isDefault: z.boolean().optional(),
        runtimeSettings: z.record(z.unknown()).optional(),
      })).min(1),
    }).parse(await c.req.json().catch(() => ({})))

    try {
      const profile = await createModelProfileForUser({
        name: payload.name,
        description: payload.description,
        visibility: payload.visibility,
        ownerUserId: userId,
        teamId: payload.teamId,
        workspaceId: payload.workspaceId,
        bindings: payload.bindings.map((binding) => ({
          agentType: binding.agentType,
          providerId: binding.providerId,
          modelId: binding.modelId,
          label: binding.label?.trim() || `${binding.agentType} · ${binding.providerId}/${binding.modelId}`,
          baseUrl: binding.baseUrl,
          apiToken: binding.apiToken,
          isDefault: binding.isDefault,
          runtimeSettings: binding.runtimeSettings,
        })),
      })
      return c.json({ ok: true, profile, message: '模型已创建。' })
    } catch (error) {
      return c.json({ message: error instanceof Error ? error.message : '创建模型失败。' }, 400)
    }
  })

  app.post('/api/model-profiles/import', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    const payload = z.object({
      executorId: z.string().trim().min(1),
      agentType: serverAgentTypeSchema,
      visibility: z.enum(['private', 'team', 'workspace']).default('private'),
      teamId: z.string().trim().optional(),
      workspaceId: z.string().trim().optional(),
    }).parse(await c.req.json().catch(() => ({})))

    try {
      const profiles = await importModelProfilesFromExecutor({
        userId,
        executorId: payload.executorId,
        agentType: payload.agentType,
        visibility: payload.visibility,
        teamId: payload.teamId,
        workspaceId: payload.workspaceId,
      })
      return c.json({
        ok: true,
        profiles,
        message: profiles.length > 0 ? `已导入 ${profiles.length} 个模型。` : '没有新增模型。',
      })
    } catch (error) {
      return c.json({ message: error instanceof Error ? error.message : '导入模型失败。' }, 400)
    }
  })

  app.post('/api/model-profiles/test', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    const payload = z.object({
      providerId: z.string().trim().min(1),
      baseUrl: z.string().trim().optional(),
      apiToken: z.string().trim().optional(),
      bindingId: z.string().trim().optional(),
      useStoredToken: z.boolean().optional(),
      compatibility: z.enum(['openai', 'anthropic']),
      modelIds: z.array(z.string().trim().min(1)).min(1),
    }).parse(await c.req.json().catch(() => ({})))

    const storedBinding = payload.bindingId
      ? await findVisibleModelProfileBindingForUser(userId, payload.bindingId)
      : null

    const effectiveBaseUrl = payload.baseUrl?.trim() || ''
    const effectiveApiToken = payload.apiToken?.trim()
      || (payload.useStoredToken ? storedBinding?.binding.apiToken?.trim() || '' : '')

    try {
      const result = await testModelProfileAvailability({
        providerId: payload.providerId,
        baseUrl: effectiveBaseUrl,
        apiToken: effectiveApiToken || undefined,
        compatibility: payload.compatibility,
        modelIds: payload.modelIds,
      })

      return c.json(result)
    } catch (error) {
      return c.json({
        ok: false,
        message: error instanceof Error ? error.message : '可用性检测失败。',
      }, 400)
    }
  })

  app.post('/api/model-profiles/test-agent', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    const payload = z.object({
      agentType: visibleAgentTypeSchema,
      providerId: z.string().trim().min(1),
      baseUrl: z.string().trim().optional(),
      apiToken: z.string().trim().optional(),
      bindingId: z.string().trim().optional(),
      useStoredToken: z.boolean().optional(),
      modelIds: z.array(z.string().trim().min(1)).min(1),
    }).parse(await c.req.json().catch(() => ({})))

    const storedBinding = payload.bindingId
      ? await findVisibleModelProfileBindingForUser(userId, payload.bindingId)
      : null

    const testedModelId = payload.modelIds[0]?.trim() || ''
    const effectiveApiToken = payload.apiToken?.trim()
      || (payload.useStoredToken ? storedBinding?.binding.apiToken?.trim() || '' : '')
    const smokeBinding = {
      agentType: payload.agentType,
      providerId: payload.providerId,
      modelId: testedModelId,
      label: `${payload.providerId}/${testedModelId}`,
      baseUrl: payload.baseUrl?.trim() || undefined,
      apiToken: effectiveApiToken || undefined,
    }
    const executionModel = buildAgentExecutionModelId(payload.agentType, smokeBinding)
    const runtimeEnv = buildModelRuntimeEnv(payload.agentType, smokeBinding)
    const executor = listVisibleExecutorsForUser(userId).find((item) => item.status === 'online' && item.workspaceRoot.trim())

    if (!testedModelId) {
      return c.json({ ok: false, message: '请至少填写一个模型 ID。' }, 400)
    }
    if (!executor) {
      return c.json({ ok: false, message: '没有在线执行节点，无法检测 Coding Agent。' }, 400)
    }

    try {
      const startedAt = Date.now()
      const result = await executorWsService.requestAgentPrompt(executor.executorId, {
        agentType: payload.agentType,
        actingUserId: userId,
        cwd: executor.workspaceRoot,
        title: 'Model profile agent availability check',
        prompt: '只回复 ok，不要解释。',
        executionModel,
        runtimeEnv,
        opencodeConfig: payload.agentType === 'OpenCode'
          ? buildAgentSmokeOpenCodeProviderOverlay(smokeBinding)
          : undefined,
        mcpServers: [],
        attachments: [],
        timeoutMs: MODEL_PROFILE_AGENT_TEST_TIMEOUT_MS,
      })
      const latencyMs = Date.now() - startedAt
      const outputPreview = sanitizeAgentSmokeOutput(result.output)

      if (!result.ok || result.aborted || isAgentSmokeOutputFailure(result.output)) {
        return c.json({
          ok: false,
          agentType: payload.agentType,
          testedModelId,
          executionModel,
          latencyMs,
          outputPreview,
          message: outputPreview
            ? `${payload.agentType} 检测失败：${outputPreview}`
            : `${payload.agentType} 检测失败。`,
        }, 400)
      }

      return c.json({
        ok: true,
        agentType: payload.agentType,
        testedModelId,
        executionModel,
        latencyMs,
        outputPreview,
        message: `${payload.agentType} 检测通过：${payload.providerId}/${testedModelId} 可用。`,
      })
    } catch (error) {
      return c.json({
        ok: false,
        agentType: payload.agentType,
        testedModelId,
        executionModel,
        message: error instanceof Error ? error.message : `${payload.agentType} 检测失败。`,
      }, 400)
    }
  })

  app.patch('/api/model-profiles/:id', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    const id = c.req.param('id')
    const payload = z.object({
      name: z.string().trim().min(1),
      description: z.string().trim().optional(),
      visibility: z.enum(['private', 'team', 'workspace']).default('private'),
      teamId: z.string().trim().optional(),
      workspaceId: z.string().trim().optional(),
      bindings: z.array(z.object({
        id: z.string().trim().optional(),
        agentType: serverAgentTypeSchema,
        providerId: z.string().trim().min(1),
        modelId: z.string().trim().min(1),
        label: z.string().trim().optional(),
        baseUrl: z.string().trim().optional(),
        apiToken: z.string().trim().optional(),
        clearApiToken: z.boolean().optional(),
        isDefault: z.boolean().optional(),
        runtimeSettings: z.record(z.unknown()).optional(),
      })).min(1),
    }).parse(await c.req.json().catch(() => ({})))

    try {
      const profile = await updateModelProfileForUser({
        userId,
        profileId: id,
        name: payload.name,
        description: payload.description,
        visibility: payload.visibility,
        teamId: payload.teamId,
        workspaceId: payload.workspaceId,
        bindings: payload.bindings.map((binding) => ({
          id: binding.id,
          agentType: binding.agentType,
          providerId: binding.providerId,
          modelId: binding.modelId,
          label: binding.label?.trim() || `${binding.agentType} · ${binding.providerId}/${binding.modelId}`,
          baseUrl: binding.baseUrl,
          apiToken: binding.apiToken,
          clearApiToken: binding.clearApiToken,
          isDefault: binding.isDefault,
          runtimeSettings: binding.runtimeSettings,
        })),
      })
      return c.json({ ok: true, profile, message: '模型已更新。' })
    } catch (error) {
      return c.json({ message: error instanceof Error ? error.message : '更新模型失败。' }, 400)
    }
  })

  app.delete('/api/model-profiles/:id', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    const id = c.req.param('id')

    try {
      await deleteVisibleModelProfile(userId, id)
      return c.json({ ok: true, message: '模型已删除。' })
    } catch (error) {
      return c.json({ message: error instanceof Error ? error.message : '删除模型失败。' }, 400)
    }
  })

  app.get('/api/agent-models', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    const query = z.object({
      agentType: serverAgentTypeSchema,
      executorId: z.string().trim().optional(),
      waitRuntime: z.enum(['1']).optional(),
    }).parse({
      agentType: c.req.query('agentType'),
      executorId: c.req.query('executorId')?.trim() || undefined,
      waitRuntime: c.req.query('waitRuntime'),
    })

    const result = await loadAgentModelOptionsFromExecutor(userId, query.agentType, query.executorId, undefined, {
      // UI 快速路径：worker 运行时模型未就绪时先返回模型库内容（runtimePending），
      // 客户端稍后带 waitRuntime=1 补拉完整列表；派发链路默认阻塞等待，语义不变。
      allowRuntimePending: query.waitRuntime !== '1',
    })
    if (!result.ok) {
      return c.json({ message: result.message }, result.status)
    }

    return c.json(result)
  })

  app.get('/api/models', async (c) => {
    const state = loadState()
    const result = await listAvailableModels(state.config)
    return c.json(result, result.ok ? 200 : 503)
  })

  app.post('/api/models/sync', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    const state = loadState()
    const result = await listAvailableModels(state.config)

    if (!result.ok) {
      return c.json({ message: result.message || '模型列表加载失败。' }, 503)
    }

    const currentDefaultModel = state.config.defaultModel?.trim() || ''
    const currentStillAvailable = currentDefaultModel
      ? result.models.some((model) => model.id === currentDefaultModel)
      : false

    let nextDefaultModel = currentDefaultModel
    let message = 'OpenCode 模型配置已同步。'

    if (result.defaultModel) {
      nextDefaultModel = result.defaultModel
      message = nextDefaultModel === currentDefaultModel
        ? `OpenCode 默认模型保持为 ${nextDefaultModel}。`
        : `已同步 OpenCode 默认模型：${nextDefaultModel}。`
    } else if (currentStillAvailable) {
      message = `OpenCode 未声明默认模型，已保留当前系统默认模型：${currentDefaultModel}。`
    } else {
      nextDefaultModel = ''
      message = 'OpenCode 未声明默认模型，系统默认模型已清空。'
    }

    const nextState: AppState = {
      ...state,
      config: {
        ...state.config,
        defaultModel: nextDefaultModel,
        agentSettings: {
          ...state.config.agentSettings,
          OpenCode: {
            ...state.config.agentSettings.OpenCode,
            defaultModel: nextDefaultModel,
          },
        },
      },
    }

    return c.json(await withState(nextState, message, userId))
  })

  const syncAgentRuntimeConfigToWorkers: MiddlewareHandler = async (c) => {
    const userId = getUserIdFromHeader(c)!
    const state = loadState()
    const syncedExecutorIds = syncSettingsToVisibleExecutors({
      userId,
      config: state.config,
    })

    return c.json({
      ok: true,
      syncedExecutorIds,
      message: syncedExecutorIds.length > 0
        ? `已向 ${syncedExecutorIds.length} 个在线执行节点同步 Agent 运行时配置。`
        : '当前没有在线执行节点，新的执行节点在连接控制面后会自动获取 Agent 运行时配置。',
    })
  }

  app.post('/api/opencode/config/sync-workers', requireAuth, syncAgentRuntimeConfigToWorkers)
  app.post('/api/agent-runtime/config/sync-workers', requireAuth, syncAgentRuntimeConfigToWorkers)

  // ── ChatGPT 账号（Codex OAuth 设备码）─ 经 executor WS 转发到 worker 本地 codex-oauth 服务 ──
  const forwardCodexOauth = <T>(executorId: string, operation: import('@shared/types').CodexOauthOperation, params: { userId: string, accountId?: string }, timeoutMs?: number) =>
    executorWsRequests.requestCodexOauth(executorId, operation, params, timeoutMs) as Promise<T>

  // 从 codex AuthDotJson 的 id_token 中解析账号邮箱（沙箱重建后 worker 内存态丢失时仍可显示账号）
  const resolveCodexAuthAccountEmail = (authContent: string): string => {
    try {
      const parsed = JSON.parse(authContent) as { tokens?: { id_token?: string } }
      const jwt = parsed.tokens?.id_token
      if (!jwt) {
        return ''
      }
      const payload = jwt.split('.')[1]
      if (!payload) {
        return ''
      }
      const padded = payload.replace(/-/g, '+').replace(/_/g, '/')
      const json = Buffer.from(padded.padEnd(padded.length + ((4 - (padded.length % 4)) % 4), '='), 'base64').toString('utf8')
      const claims = JSON.parse(json) as { email?: string }
      return claims.email?.trim() || ''
    } catch {
      return ''
    }
  }

  const resolveVisibleExecutorId = (c: Parameters<MiddlewareHandler>[0], raw?: string) => {
    const userId = getUserIdFromHeader(c)!
    const executorId = raw?.trim()
    if (!executorId) {
      return { userId, executorId: '' }
    }
    const visible = listVisibleExecutorsForUser(userId).some((executor) => executor.executorId === executorId)
    if (!visible) {
      throw new Error('执行节点不可见或无权限访问。')
    }
    return { userId, executorId }
  }

  app.post('/api/model-accounts/codex/device/start', requireAuth, async (c) => {
    const body = await c.req.json().catch(() => ({})) as { executorId?: string }
    try {
      const { userId, executorId } = resolveVisibleExecutorId(c, body.executorId)
      const result = await forwardCodexOauth<import('@shared/types').CodexDeviceStatus>(executorId, 'device.start', { userId })
      return c.json(result)
    } catch (error) {
      return c.json({ message: error instanceof Error ? error.message : '发起 ChatGPT 登录失败。' }, 400)
    }
  })

  app.get('/api/model-accounts/codex/device/status', requireAuth, async (c) => {
    try {
      const { userId, executorId } = resolveVisibleExecutorId(c, c.req.query('executorId')?.trim())
      const result = await forwardCodexOauth<import('@shared/types').CodexDeviceStatus>(executorId, 'device.status', { userId })
      return c.json(result)
    } catch (error) {
      return c.json({ message: error instanceof Error ? error.message : '查询登录状态失败。' }, 400)
    }
  })

  app.post('/api/model-accounts/codex/device/dismiss', requireAuth, async (c) => {
    const body = await c.req.json().catch(() => ({})) as { executorId?: string }
    try {
      const { userId, executorId } = resolveVisibleExecutorId(c, body.executorId)
      const result = await forwardCodexOauth<{ ok: boolean }>(executorId, 'device.dismiss', { userId })
      return c.json(result)
    } catch (error) {
      return c.json({ message: error instanceof Error ? error.message : '取消失败。' }, 400)
    }
  })

  app.get('/api/model-accounts/codex/accounts', requireAuth, async (c) => {
    try {
      const { userId, executorId } = resolveVisibleExecutorId(c, c.req.query('executorId')?.trim())
      const result = await forwardCodexOauth<import('@shared/types').CodexAccountsIndex>(executorId, 'accounts.list', { userId })
      return c.json(result)
    } catch (error) {
      return c.json({ message: error instanceof Error ? error.message : '读取账号失败。' }, 400)
    }
  })

  app.post('/api/model-accounts/codex/accounts/select', requireAuth, async (c) => {
    const body = await c.req.json().catch(() => ({})) as { executorId?: string, accountId?: string }
    try {
      const { userId, executorId } = resolveVisibleExecutorId(c, body.executorId)
      const result = await forwardCodexOauth<import('@shared/types').CodexAccountsIndex | null>(executorId, 'accounts.select', { userId, accountId: body.accountId?.trim() })
      if (!result) {
        return c.json({ message: '未找到该 ChatGPT 账号。' }, 404)
      }
      return c.json(result)
    } catch (error) {
      return c.json({ message: error instanceof Error ? error.message : '切换账号失败。' }, 400)
    }
  })

  app.delete('/api/model-accounts/codex/accounts/:accountId', requireAuth, async (c) => {
    const accountId = c.req.param('accountId')
    try {
      const { userId, executorId } = resolveVisibleExecutorId(c, c.req.query('executorId')?.trim())
      const result = await forwardCodexOauth<import('@shared/types').CodexAccountsIndex | null>(executorId, 'accounts.remove', { userId, accountId })
      if (!result) {
        return c.json({ message: '未找到该 ChatGPT 账号。' }, 404)
      }
      return c.json(result)
    } catch (error) {
      return c.json({ message: error instanceof Error ? error.message : '删除账号失败。' }, 400)
    }
  })

  // ChatGPT 订阅账号可用模型（Codex 后端消费；OAuth 订阅额度，非 API key）
  const CHATGPT_SUBSCRIPTION_MODELS: Array<{ modelId: string, label: string }> = [
    { modelId: 'gpt-5.6', label: 'GPT-5.6' },
    { modelId: 'gpt-5.6-sol', label: 'GPT-5.6 Sol' },
    { modelId: 'gpt-5.6-terra', label: 'GPT-5.6 Terra' },
    { modelId: 'gpt-5.6-luna', label: 'GPT-5.6 Luna' },
    { modelId: 'gpt-5.5', label: 'GPT-5.5' },
    { modelId: 'gpt-5.4', label: 'GPT-5.4' },
    { modelId: 'gpt-5.2', label: 'GPT-5.2' },
    { modelId: 'gpt-5.1-mini', label: 'GPT-5.1 Mini' },
    { modelId: 'gpt-5-mini', label: 'GPT-5 Mini' },
  ]

  // 把已登录的 ChatGPT 账号应用到所有节点：token 存入平台配置（codexAuthContent）→ 广播 → 幂等登记模型
  app.post('/api/model-accounts/codex/import', requireAuth, async (c) => {
    const body = await c.req.json().catch(() => ({})) as { executorId?: string }
    try {
      const { userId, executorId } = resolveVisibleExecutorId(c, body.executorId)

      // 优先从执行节点导出最新登录态；导出失败/超时时回退用平台已有配置，
      // 避免沙箱重建（旧登录态丢失）后模型登记与账号应用被阻断。
      let exported: import('@shared/types').CodexOauthExportResult | null = null
      try {
        exported = await forwardCodexOauth<import('@shared/types').CodexOauthExportResult>(executorId, 'export', { userId })
      } catch (error) {
        console.warn('[model-accounts][codex-export-failed]', error instanceof Error ? error.message : String(error))
      }
      const authContent = exported?.authContent?.trim() || loadState().config.codexAuthContent?.trim() || ''
      if (!authContent) {
        return c.json({ message: '当前没有已登录的 ChatGPT 账号。' }, 400)
      }

      const state = loadState()
      const nextState: AppState = {
        ...state,
        config: {
          ...state.config,
          codexAuthContent: authContent,
        },
      }
      await withState(nextState, 'ChatGPT 账号已应用到所有执行节点。', userId)
      syncSettingsToVisibleExecutors({ userId, config: nextState.config })

      // 幂等登记 ChatGPT 订阅模型：一个账号一个 profile（显示邮箱），模型挂在 bindings 里
      const accountEmail = exported?.account?.email?.trim()
        || (authContent ? resolveCodexAuthAccountEmail(authContent) : '')
      const created: string[] = []
      try {
        created.push(...await ensureSubscriptionProfileGrouped({
          userId,
          agentType: 'Codex',
          providerId: 'openai',
          profileName: accountEmail ? `ChatGPT 订阅账号 · ${accountEmail}` : 'ChatGPT 订阅账号',
          description: 'ChatGPT 订阅账号模型（OAuth 接入，随账号在所有节点可用）',
          models: CHATGPT_SUBSCRIPTION_MODELS,
        }))
      } catch (error) {
        // 模型登记失败不阻断账号应用
        console.warn('[model-accounts][codex-register-models-failed]', error instanceof Error ? error.message : String(error))
      }

      return c.json({
        ok: true,
        accountEmail,
        appliedToAllExecutors: true,
        registeredModels: created,
        message: accountEmail
          ? `ChatGPT 账号 ${accountEmail} 已应用到所有执行节点${created.length > 0 ? `，并登记了 ${created.join('、')}。` : '。'}`
          : 'ChatGPT 账号已应用到所有执行节点。',
      })
    } catch (error) {
      return c.json({ message: error instanceof Error ? error.message : '应用 ChatGPT 账号失败。' }, 400)
    }
  })

  // ── Claude Code 账号（OAuth 粘贴授权码流程）──
  // 协议已从 @anthropic-ai/claude-code 2.1.224 二进制确认：
  // authorize = platform.claude.com/oauth/authorize；粘贴的 code 用 authorization_code grant 换 token
  const CLAUDE_PLATFORM_BASE = 'https://platform.claude.com'
  const CLAUDE_OAUTH_CLIENT_ID = '22422756-60c9-4084-8eb7-27705fd5cf9a'
  const CLAUDE_OAUTH_REDIRECT_URI = `${CLAUDE_PLATFORM_BASE}/oauth/code/callback`
  const CLAUDE_OAUTH_TOKEN_URL = `${CLAUDE_PLATFORM_BASE}/v1/oauth/token`
  const CLAUDE_SUBSCRIPTION_MODELS: Array<{ modelId: string, label: string }> = [
    { modelId: 'claude-opus-4-6', label: 'Claude Opus 4.6' },
    { modelId: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6' },
    { modelId: 'claude-opus-4-5', label: 'Claude Opus 4.5' },
    { modelId: 'claude-sonnet-4-5', label: 'Claude Sonnet 4.5' },
    { modelId: 'claude-haiku-4-5', label: 'Claude Haiku 4.5' },
  ]

  // 订阅账号模型统一登记为「一个账号一个 profile（显示账号邮箱），模型挂在 bindings 里」。
  // 旧版本按模型拆分出的独立 profile 会被归并删除（仅限纯订阅模型的 manual profile）。
  const ensureSubscriptionProfileGrouped = async (params: {
    userId: string
    agentType: 'Codex' | 'ClaudeCode'
    providerId: 'openai' | 'anthropic'
    profileName: string
    description: string
    models: Array<{ modelId: string, label: string }>
  }): Promise<string[]> => {
    const profiles = await listVisibleModelProfilesForUser(params.userId)
    const knownModelIds = new Set(params.models.map((item) => item.modelId))
    const isSubscriptionProfile = (profile: (typeof profiles)[number]) => (
      profile.description?.trim() === params.description
    )
    const isLegacySplitProfile = (profile: (typeof profiles)[number]) => (
      isSubscriptionProfile(profile)
      && profile.name !== params.profileName
      && profile.source === 'manual'
      && profile.bindings.length > 0
      && profile.bindings.every((binding) => (
        binding.agentType === params.agentType
        && binding.providerId === params.providerId
        && knownModelIds.has(binding.modelId)
      ))
    )

    // 本账号的聚合 profile（name 精确匹配）
    const sameAccount = profiles.filter((profile) => profile.name === params.profileName && isSubscriptionProfile(profile))
    // 旧版本按模型拆分的 profile（归并后删除）
    const legacySplits = profiles.filter(isLegacySplitProfile)
    for (const profile of legacySplits) {
      await deleteVisibleModelProfile(params.userId, profile.id).catch(() => {})
    }

    const mergedBindings = params.models.map((item) => ({
      agentType: params.agentType,
      providerId: params.providerId,
      modelId: item.modelId,
      label: item.label,
    }))

    if (sameAccount.length === 0) {
      await createModelProfileForUser({
        name: params.profileName,
        description: params.description,
        visibility: 'private',
        ownerUserId: params.userId,
        source: 'manual',
        bindings: mergedBindings,
      })
      return params.models.map((item) => item.label)
    }

    // 已有同名聚合 profile：补齐缺失模型
    const primary = sameAccount[0]
    const currentModelIds = new Set(primary.bindings
      .filter((binding) => binding.agentType === params.agentType && binding.providerId === params.providerId)
      .map((binding) => binding.modelId))
    const missing = params.models.filter((item) => !currentModelIds.has(item.modelId))
    if (missing.length > 0 || legacySplits.length > 0) {
      await updateModelProfileForUser({
        userId: params.userId,
        profileId: primary.id,
        name: params.profileName,
        description: params.description,
        visibility: primary.visibility,
        bindings: mergedBindings,
      })
    }
    return missing.map((item) => item.label)
  }

  app.get('/api/model-accounts/claude/status', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    const state = loadState()
    const connected = Boolean(state.config.claudeCodeCredentialsContent?.trim())
    return c.json({ connected })
  })

  app.get('/api/model-accounts/claude/authorize-url', requireAuth, async (c) => {
    const search = new URLSearchParams({
      client_id: CLAUDE_OAUTH_CLIENT_ID,
      redirect_uri: CLAUDE_OAUTH_REDIRECT_URI,
      response_type: 'code',
      state: `wemux-${Math.random().toString(36).slice(2, 10)}`,
    })
    return c.json({ authorizeUrl: `${CLAUDE_PLATFORM_BASE}/oauth/authorize?${search.toString()}` })
  })

  // 用粘贴的授权码换 Claude OAuth token → 存平台配置（claudeCodeCredentialsContent）→ 广播 → 幂等登记模型
  app.post('/api/model-accounts/claude/import', requireAuth, async (c) => {
    const body = await c.req.json().catch(() => ({})) as { authCode?: string }
    const authCode = body.authCode?.trim()
    if (!authCode) {
      return c.json({ message: '请先粘贴 Claude 显示的授权码。' }, 400)
    }
    const userId = getUserIdFromHeader(c)!

    try {
      const tokenBody = new URLSearchParams({
        grant_type: 'authorization_code',
        code: authCode,
        redirect_uri: CLAUDE_OAUTH_REDIRECT_URI,
        client_id: CLAUDE_OAUTH_CLIENT_ID,
      })
      // TODO(calibrate): 授权端点与 client_id 已验证（能打开授权页）；token 交换的精确请求格式
      // 需在第一次真实授权时用真实 code 校准——粘贴的 code 可能是 Claude 自定义编码（base64/JWT 风格），
      // 标准请求目前返回 invalid_request_error / Invalid request format。若首次使用报错，优先核对：
      // 1) code 是否需要先解码/包装后再提交；2) 是否需要 code_verifier（PKCE）或额外 scope。
      const tokenResponse = await fetch(CLAUDE_OAUTH_TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: tokenBody,
        signal: AbortSignal.timeout(15000),
      })
      const tokenPayload = await tokenResponse.json().catch(() => ({})) as {
        access_token?: string
        refresh_token?: string
        expires_in?: number
        scope?: string
        token_type?: string
        error?: string
      }
      if (!tokenResponse.ok || !tokenPayload.access_token || !tokenPayload.refresh_token) {
        return c.json({ message: tokenPayload.error || `授权码交换失败 (${tokenResponse.status})。授权码可能已过期，请重新登录。` }, 400)
      }

      // .credentials.json 结构（对齐 Claude Code：claudeAiOauth）
      const credentials = {
        claudeAiOauth: {
          accessToken: tokenPayload.access_token,
          refreshToken: tokenPayload.refresh_token,
          expiresAt: new Date(Date.now() + (tokenPayload.expires_in ?? 3600) * 1000).toISOString(),
          scopes: tokenPayload.scope?.trim() ? tokenPayload.scope.trim().split(/\s+/) : [],
          tokenType: tokenPayload.token_type || 'Bearer',
        },
      }

      const state = loadState()
      const nextState: AppState = {
        ...state,
        config: {
          ...state.config,
          claudeCodeCredentialsContent: JSON.stringify(credentials),
        },
      }
      await withState(nextState, 'Claude 账号已应用到所有执行节点。', userId)
      syncSettingsToVisibleExecutors({ userId, config: nextState.config })

      // 幂等登记 Claude 订阅模型：一个账号一个 profile，模型挂在 bindings 里
      const created: string[] = []
      try {
        created.push(...await ensureSubscriptionProfileGrouped({
          userId,
          agentType: 'ClaudeCode',
          providerId: 'anthropic',
          profileName: 'Claude 订阅账号',
          description: 'Claude 订阅账号模型（OAuth 接入，随账号在所有节点可用）',
          models: CLAUDE_SUBSCRIPTION_MODELS,
        }))
      } catch (error) {
        // 模型登记失败不阻断账号应用
        console.warn('[model-accounts][claude-register-models-failed]', error instanceof Error ? error.message : String(error))
      }

      return c.json({
        ok: true,
        appliedToAllExecutors: true,
        registeredModels: created,
        message: `Claude 账号已连接到平台并应用到所有执行节点${created.length > 0 ? `，登记了 ${created.join('、')}。` : '。'}`,
      })
    } catch (error) {
      return c.json({ message: error instanceof Error ? error.message : '连接 Claude 账号失败。' }, 400)
    }
  })

  // ── OpenRouter 账号（OAuth PKCE 粘贴授权码，BYOK：key 记在用户自己的 OpenRouter 账户）──

  app.get('/api/model-accounts/openrouter/status', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    const profiles = await listVisibleModelProfilesForUser(userId)
    return c.json({ connected: profiles.some((profile) => isOpenRouterOAuthProfile(profile)) })
  })

  app.get('/api/model-accounts/openrouter/authorize-url', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    const { codeVerifier, codeChallenge } = generatePkcePair()
    rememberOpenRouterVerifier(userId, codeVerifier)
    return c.json({ authorizeUrl: buildOpenRouterAuthorizeUrl(codeChallenge) })
  })

  app.post('/api/model-accounts/openrouter/import', requireAuth, async (c) => {
    const body = await c.req.json().catch(() => ({})) as { code?: string }
    const code = body.code?.trim()
    if (!code) {
      return c.json({ message: '请先粘贴 OpenRouter 授权页显示的授权码。' }, 400)
    }
    const userId = getUserIdFromHeader(c)!
    const codeVerifier = takeOpenRouterVerifier(userId)
    if (!codeVerifier) {
      return c.json({ message: '授权会话已过期，请重新点击「打开授权页面」后再试。' }, 400)
    }

    try {
      const apiKey = await exchangeOpenRouterCodeForKey({ code, codeVerifier })

      let freeModels: Awaited<ReturnType<typeof listOpenRouterFreeModels>> = []
      try {
        freeModels = await listOpenRouterFreeModels()
      } catch (error) {
        // 目录拉取失败不阻断账号连接，用户仍可手动加模型
        console.warn('[model-accounts][openrouter-list-models-failed]', error instanceof Error ? error.message : String(error))
      }

      const created = await ensureOpenRouterOAuthProfile({ userId, apiKey, models: freeModels })
      return c.json({
        ok: true,
        registeredModels: created,
        message: created.length > 0
          ? `OpenRouter 已连接，登记了 ${created.length} 个免费模型（费用记在你自己的 OpenRouter 账户）。`
          : 'OpenRouter 已连接。可在模型列表手动添加模型 ID（免费模型以 :free 结尾）。',
      })
    } catch (error) {
      return c.json({ message: error instanceof Error ? error.message : '连接 OpenRouter 失败。' }, 400)
    }
  })

  app.get('/api/worker/console', requireAuth, async (c) => {
    try {
      const [configPayload, statusPayload, doctorPayload] = await Promise.all([
        requestWorkerConsole<{ config: unknown }>('/api/config'),
        requestWorkerConsole<{ runtime: unknown }>('/api/status'),
        requestWorkerConsole<unknown>('/api/doctor'),
      ])

      return c.json({
        ok: true,
        worker: {
          config: configPayload.config,
          runtime: statusPayload.runtime,
          doctor: doctorPayload,
        },
      })
    } catch (error) {
      return c.json({
        ok: false,
        message: error instanceof Error ? error.message : 'Worker Console 不可用',
      }, 503)
    }
  })

  app.post('/api/worker/bootstrap-runtime', requireAuth, async (c) => {
    try {
      const payload = await requestWorkerConsole('/api/bootstrap-runtime', { method: 'POST' })
      return c.json(payload)
    } catch (error) {
      return c.json({ message: error instanceof Error ? error.message : 'Worker 运行环境准备失败' }, 503)
    }
  })

  app.post('/api/worker/connect', requireAuth, async (c) => {
    try {
      const payload = await requestWorkerConsole('/api/connect', { method: 'POST' })
      return c.json(payload)
    } catch (error) {
      return c.json({ message: error instanceof Error ? error.message : 'Worker 连接失败' }, 503)
    }
  })

  app.post('/api/worker/disconnect', requireAuth, async (c) => {
    try {
      const payload = await requestWorkerConsole('/api/disconnect', { method: 'POST' })
      return c.json(payload)
    } catch (error) {
      return c.json({ message: error instanceof Error ? error.message : 'Worker 断开失败' }, 503)
    }
  })

  app.get('/api/git-identities/config', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    const [status, credential] = await Promise.all([
      getGitCredentialStatus(userId, 'github'),
      loadGitCredential(userId, 'github'),
    ])
    return c.json({
      config: {
        personal: {
          name: status.name || '',
          email: status.email || '',
          hasToken: Boolean(credential?.patToken || credential?.sshPrivateKey),
        },
      },
      health: {
        personal: {
          configured: status.configured,
          hasCredentialToken: Boolean(credential?.patToken || credential?.sshPrivateKey),
        },
      },
    })
  })

  app.put('/api/git-identities/config', requireAuth, async (c) => {
    const payload = z.object({
      personal: z.object({
        name: z.string().optional().default(''),
        email: z.string().optional().default(''),
        token: z.string().optional().default(''),
      }),
    }).parse(await c.req.json())

    const userId = getUserIdFromHeader(c)!
    const current = await loadGitCredential(userId, 'github')

    await saveGitCredential({
      id: current?.id,
      userId,
      label: current?.label ?? '默认 GitHub 身份',
      provider: 'github',
      host: current?.host ?? 'github.com',
      authMode: payload.personal.token ? 'pat' : current?.authMode ?? 'pat',
      name: payload.personal.name,
      email: payload.personal.email,
      patToken: payload.personal.token || current?.patToken,
      sshPublicKey: current?.sshPublicKey,
      sshPrivateKey: current?.sshPrivateKey,
      sshKeyFingerprint: current?.sshKeyFingerprint,
      activatedAt: current?.activatedAt ?? new Date().toISOString(),
      isDefault: current?.isDefault ?? true,
    })

    const [status, credential] = await Promise.all([
      getGitCredentialStatus(userId, 'github'),
      loadGitCredential(userId, 'github'),
    ])
    return c.json({
      ok: true,
      config: {
        personal: {
          name: status.name || '',
          email: status.email || '',
          hasToken: Boolean(credential?.patToken || credential?.sshPrivateKey),
        },
      },
      health: {
        personal: {
          configured: status.configured,
          hasCredentialToken: Boolean(credential?.patToken || credential?.sshPrivateKey),
        },
      },
      message: 'Git 身份配置已保存。',
    })
  })

  app.put('/api/settings', requireAuth, async (c) => {
    try {
      const payload = settingsSchema.parse(await c.req.json())
      const state = loadState()
      const userId = getUserIdFromHeader(c)!
      const mergedMcpServers = await mergePersistedMcpServers({
        previous: state.config.mcpServers,
        incoming: payload.mcpServers,
        userId,
      })
      const nextConfig = applyManagedCloudEnvConfig(normalizeAgentConfig({
        opencodeCommand: state.config.opencodeCommand,
        opencodeConfigContent: payload.opencodeConfigContent,
        codexConfigContent: payload.codexConfigContent,
        codexAuthContent: payload.codexAuthContent,
        claudeCodeConfigContent: payload.claudeCodeConfigContent,
        heartbeatSeconds: state.config.heartbeatSeconds,
        maxRetries: state.config.maxRetries,
        autoCleanupWorktree: state.config.autoCleanupWorktree,
        defaultModel: payload.agentSettings.OpenCode.defaultModel || payload.defaultModel,
        mcpServers: mergedMcpServers,
        workspaceRoot: state.config.workspaceRoot,
        workspaceOpenSettings: payload.workspaceOpenSettings,
        workerUpdateSettings: payload.workerUpdateSettings,
        agentSettings: {
          ...state.config.agentSettings,
          ...payload.agentSettings,
          OpenCode: {
            ...state.config.agentSettings.OpenCode,
            ...payload.agentSettings.OpenCode,
            defaultModel: payload.agentSettings.OpenCode.defaultModel || payload.defaultModel,
          },
        },
        workspaceExecutionDefaults: payload.workspaceExecutionDefaults,
      }))
      parseOpencodeConfigContent(nextConfig.opencodeConfigContent)
      parseClaudeCodeConfigContent(nextConfig.claudeCodeConfigContent)
      const adapters = await checkAdapters(nextConfig, state.adapters)
      const nextState: AppState = {
        ...state,
        config: nextConfig,
        adapters,
      }
      const managedCloudSync = await getManagedCloudGate().reconcileExecutors(nextState.config)
      const syncedExecutorIds = syncSettingsToVisibleExecutors({
        userId,
        config: nextState.config,
      })
      const messageParts = ['Agent 配置已保存。']
      if (managedCloudSync.totalCount > 0) {
        messageParts.push(`已重写 ${managedCloudSync.rewrittenConfigCount} 个官方云节点 worker 配置`)
        if (managedCloudSync.relabeledCount > 0) {
          messageParts.push(`重新分配 ${managedCloudSync.relabeledCount} 个官方云节点 target`)
        }
      }
      if (syncedExecutorIds.length > 0) {
        messageParts.push(`并已同步到 ${syncedExecutorIds.length} 个在线执行节点。`)
      } else {
        messageParts.push('新的执行节点连接后会自动获取最新 MCP 与 OpenCode 配置。')
      }
      if (managedCloudSync.warnings.length > 0) {
        messageParts.push(managedCloudSync.warnings[0])
      }
      const message = messageParts.join('')
      return c.json(await withState(nextState, message, userId))
    } catch (error) {
      return c.json({ message: error instanceof Error ? error.message : 'Agent 配置保存失败。' }, 400)
    }
  })

  app.post('/api/adapters/refresh', requireAuth, async (c) => {
    const state = loadState()
    const adapters = await checkAdapters(state.config, state.adapters)
    const nextState: AppState = {
      ...state,
      adapters,
    }
    return c.json(await withState(nextState, '适配器状态已刷新。', getUserIdFromHeader(c)!))
  })

  app.post('/api/adapters/test', requireAuth, async (c) => {
    const { prompt } = await c.req.json().catch(() => ({ prompt: '' }))

    if (!prompt?.trim()) {
      return c.json({ ok: false, message: '请输入测试提示词' }, 400)
    }

    return c.json({
      ok: false,
      message: 'server 端直连 OpenCode 的代码测试已下线。请改用 worker 自检、模型同步和真实 worker 任务验证执行链路。',
    }, 409)
  })

  app.post('/api/reset', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    resetState()
    return c.json({ state: getScopedState(loadState(), userId), message: '示例数据已重置。' })
  })

  app.post('/api/tasks/:id/images', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    const taskId = c.req.param('id')
    const { image, filename } = await c.req.json().catch(() => ({ image: '', filename: '' }))
    const state = loadState()
    const taskResult = getAuthorizedTask(state, userId, taskId)
    if (!taskResult.task) {
      return c.json({ message: taskResult.message }, taskResult.status)
    }

    if (!image) {
      return c.json({ message: '图片数据不能为空' }, 400)
    }

    const base64Data = image.replace(/^data:image\/\w+;base64,/, '')
    const buffer = Buffer.from(base64Data, 'base64')
    const ext = filename?.split('.').pop() || 'png'
    const imageId = `${taskId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const imageFilename = `${imageId}.${ext}`
    try {
      await uploadObject(`images/tasks/${taskId}/${imageFilename}`, buffer, {
        contentType: `image/${ext === 'jpg' ? 'jpeg' : ext}`,
      })
    } catch (error) {
      return c.json({ message: error instanceof Error ? error.message : '图片上传失败' }, 503)
    }

    const contentType = `image/${ext === 'jpg' ? 'jpeg' : ext}`
    const attachment = {
      id: imageId,
      url: `/uploads/images/${imageFilename}`,
      filename: filename?.trim() || imageFilename,
      contentType,
    }

    appendTaskConversationMessage({
      task: taskResult.task,
      project: taskResult.project,
      role: 'user',
      senderId: userId,
      content: '',
      contentType: 'json',
      externalRef: {
        attachments: [attachment],
      },
    })

    return c.json({ id: imageId, url: attachment.url, contentType })
  })

  app.post('/api/tasks/:id/attachments', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    const taskId = c.req.param('id')
    const { file, filename, contentType, purpose } = await c.req.json().catch(() => ({ file: '', filename: '', contentType: '', purpose: '' }))
    const state = loadState()
    const taskResult = getAuthorizedTask(state, userId, taskId)
    if (!taskResult.task) {
      return c.json({ message: taskResult.message }, taskResult.status)
    }

    if (!file || typeof file !== 'string') {
      return c.json({ message: '附件数据不能为空' }, 400)
    }

    const safeFilename = sanitizeUploadFilename(typeof filename === 'string' ? filename : '', 'attachment')
    const normalizedContentType = typeof contentType === 'string' && contentType.trim()
      ? contentType.trim().split(';')[0]
      : 'application/octet-stream'
    const base64Data = file.replace(/^data:[^;]+;base64,/, '')
    const buffer = Buffer.from(base64Data, 'base64')
    if (buffer.byteLength > TASK_COMMENT_ATTACHMENT_MAX_BYTES) {
      return c.json({ message: '单个附件不能超过 20MB。' }, 413)
    }
    const ext = safeFilename.includes('.') ? safeFilename.split('.').pop() : ''
    const attachmentId = `${taskId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const storedFilename = `${attachmentId}${ext ? `.${ext}` : ''}`

    try {
      await uploadObject(`attachments/tasks/${taskId}/${storedFilename}`, buffer, {
        contentType: normalizedContentType,
      })
    } catch (error) {
      return c.json({ message: error instanceof Error ? error.message : '附件上传失败' }, 503)
    }

    const attachment = {
      id: attachmentId,
      url: `/uploads/attachments/${storedFilename}`,
      filename: safeFilename,
      contentType: normalizedContentType,
    }

    if (purpose !== 'comment') {
      appendTaskConversationMessage({
        task: taskResult.task,
        project: taskResult.project,
        role: 'user',
        senderId: userId,
        content: '',
        contentType: 'json',
        externalRef: {
          attachments: [attachment],
        },
      })
    }

    return c.json(attachment)
  })

  app.post('/api/ai/images', requireAuth, async (c) => {
    const { image, filename } = await c.req.json().catch(() => ({ image: '', filename: '' }))

    if (!image) {
      return c.json({ message: '图片数据不能为空' }, 400)
    }

    const base64Data = image.replace(/^data:image\/\w+;base64,/, '')
    const buffer = Buffer.from(base64Data, 'base64')
    const ext = filename?.split('.').pop() || 'png'
    const imageId = `main-chat-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const imageFilename = `${imageId}.${ext}`
    try {
      await uploadObject(resolveMainChatImageObjectKey(imageFilename), buffer, {
        contentType: `image/${ext === 'jpg' ? 'jpeg' : ext}`,
      })
    } catch (error) {
      return c.json({ message: error instanceof Error ? error.message : '图片上传失败' }, 503)
    }

    return c.json({
      id: imageId,
      url: `/uploads/images/main-chat/${imageFilename}`,
      contentType: `image/${ext === 'jpg' ? 'jpeg' : ext}`,
    })
  })

  app.get('/uploads/images/main-chat/:filename', async (c) => {
    const filename = c.req.param('filename')
    const objectKey = resolveMainChatImageObjectKey(filename)
    if (!objectKey) {
      return c.json({ message: '图片不存在' }, 404)
    }

    try {
      return await streamObject(objectKey)
    } catch (error) {
      return c.json({ message: error instanceof Error ? error.message : '图片读取失败' }, 503)
    }
  })

  app.get('/uploads/images/:filename', async (c) => {
    const filename = c.req.param('filename')
    try {
      for (const objectKey of resolveTaskImageObjectKeys(filename)) {
        const response = await streamObject(objectKey)
        if (response.status !== 404) {
          return response
        }
      }
    } catch (error) {
      return c.json({ message: error instanceof Error ? error.message : '图片读取失败' }, 503)
    }

    return c.json({ message: '图片不存在' }, 404)
  })

  app.get('/uploads/attachments/:filename', async (c) => {
    const filename = c.req.param('filename')
    try {
      for (const objectKey of resolveTaskAttachmentObjectKeys(filename)) {
        const response = await streamObject(objectKey)
        if (response.status !== 404) {
          return response
        }
      }
    } catch (error) {
      return c.json({ message: error instanceof Error ? error.message : '附件读取失败' }, 503)
    }

    return c.json({ message: '附件不存在' }, 404)
  })

  app.get('/api/live', (c) => c.json({
    ok: true,
    nodeId: clusterConfig.nodeId,
  }))

  app.get('/api/ready', async (c) => {
    const postgres = await getPostgresHealth()
    const storageChangeListener = getStorageChangeListenerHealth()
    const ok = postgres.ok && postgres.connected && storageChangeListener.ok

    return c.json({
      ok,
      nodeId: clusterConfig.nodeId,
      postgres,
      storageChangeListener,
    }, ok ? 200 : 503)
  })

  app.get('/api/health', async (c) => {
    const postgres = await getPostgresHealth()
    const pool = getPool()
    const listenerLag = await getStorageChangeListenerLag()
    const currentNode = getNode(clusterConfig.nodeId)
    const heartbeatAgeMs = currentNode?.lastHeartbeatAt      ? Math.max(0, Date.now() - new Date(currentNode.lastHeartbeatAt).getTime())
      : null
    const executorCount = listPersistedExecutors().filter((entry) => entry.executor.connectedNodeId === clusterConfig.nodeId).length

    return c.json({
      ok: true,
      database: getPrimaryDatabaseMode(),
      storage: getPrimaryDatabaseStatus(),
      legacyDatabase: getLegacyStorageMode(),
      d1Enabled: isD1Enabled(),
      adapters: getMeta<AppState['adapters']>('adapters', []),
      executionCenter: getMeta<AppState['executionCenter']>('executionCenter', deriveExecutionCenter([])),
      postgres: {
        ...postgres,
        pool: {
          total: pool.totalCount,
          idle: pool.idleCount,
          waiting: pool.waitingCount,
        },
      },
      storageChangeListener: {
        ...getStorageChangeListenerHealth(),
        lag: listenerLag,
      },
      gitIdentity: getTaskGitIdentityHealth(),
      persistence: {
        fireAndForgetFailures: getPersistenceFailureCount(),
      },
      node: {
        nodeId: clusterConfig.nodeId,
        heartbeatAgeMs,
        heartbeatFresh: heartbeatAgeMs !== null && heartbeatAgeMs <= 120_000,
        executorCount,
      },
      architecture: {
        browserAccess: 'cloud-control-plane-only',
        executorModel: 'independent-worker',
        realtime: 'websocket+postgres-events',
        controlPlane: {
          mode: 'active-active',
          nodeId: clusterConfig.nodeId,
          nodeName: clusterConfig.nodeName,
          nodeRegion: clusterConfig.region || null,
          nodeUrlConfigured: Boolean(clusterConfig.nodeUrl),
          nodeRelayUrlConfigured: Boolean(clusterConfig.nodeRelayUrl),
        },
      },
    })
  })

  // ---- AI 运维诊断端点（/api/health/detailed）----
  // 设计：给 AI/自动化运维使用。配置 WEMUX_HEALTH_TOKEN 后，请求需带 x-health-token 或 ?token= 返回完整诊断；
  // 未配置 token 时同样返回完整信息（自托管默认）。信息分 meta/brand/database/node/resources/security/checks 七块，
  // checks 为扁平检查项列表，AI 可直接逐项判断 ok/warning/error。
  app.get('/api/health/detailed', async (c) => {
    const token = c.req.header('x-health-token') || c.req.query('token')
    const expected = getEnv('WEMUX_HEALTH_TOKEN')?.trim()
    if (expected && token !== expected) {
      return c.json({ ok: false, message: 'unauthorized: missing or invalid x-health-token' }, 401)
    }

    const postgres = await getPostgresHealth()
    const pool = getPool()
    const listenerLag = await getStorageChangeListenerLag()
    const currentNode = getNode(clusterConfig.nodeId)
    const heartbeatAgeMs = currentNode?.lastHeartbeatAt
      ? Math.max(0, Date.now() - new Date(currentNode.lastHeartbeatAt).getTime())
      : null
    const executorCount = listPersistedExecutors().filter((entry) => entry.executor.connectedNodeId === clusterConfig.nodeId).length
    const mem = process.memoryUsage()

    const checks = [
      {
        name: 'postgres',
        status: postgres.ok ? 'ok' : 'error',
        detail: postgres.ok ? `connected (mode=${getPrimaryDatabaseMode()})` : (postgres.message ?? 'unreachable'),
      },
      {
        name: 'storage-change-listener',
        status: listenerLag !== null && listenerLag <= 5000 ? 'ok' : 'warning',
        detail: listenerLag === null ? 'not-started' : `lag=${listenerLag}ms`,
      },
      {
        name: 'node-heartbeat',
        status: heartbeatAgeMs !== null && heartbeatAgeMs <= 120_000 ? 'ok' : 'warning',
        detail: heartbeatAgeMs === null ? 'no-local-node' : `age=${heartbeatAgeMs}ms`,
      },
      {
        name: 'executors',
        status: executorCount > 0 ? 'ok' : 'warning',
        detail: `${executorCount} executor(s) connected to node`,
      },
      {
        name: 'fire-and-forget-persistence',
        status: getPersistenceFailureCount() === 0 ? 'ok' : 'warning',
        detail: `failures=${getPersistenceFailureCount()}`,
      },
    ]
    const degraded = checks.some((check) => check.status === 'error')
    const warnCount = checks.filter((check) => check.status === 'warning').length

    return c.json({
      ok: !degraded,
      degraded,
      warningCount: warnCount,
      summary: degraded ? 'degraded' : warnCount > 0 ? 'warning' : 'healthy',
      meta: {
        name: 'wemux',
        version: resolveAppVersion(),
        environment: process.env.NODE_ENV?.trim() || 'development',
        nodeVersion: process.version,
        platform: `${process.platform}/${process.arch}`,
        uptimeMs: Math.round(process.uptime() * 1000),
        publicBaseUrl: getEnv('WEMUX_PUBLIC_BASE_URL')?.trim() || '',
      },
      brand: resolveAppBrand(),
      database: {
        mode: getPrimaryDatabaseMode(),
        storage: getPrimaryDatabaseStatus(),
        legacyDatabase: getLegacyStorageMode(),
        postgres: {
          ...postgres,
          pool: {
            total: pool.totalCount,
            idle: pool.idleCount,
            waiting: pool.waitingCount,
          },
        },
        storageChangeListener: {
          ...getStorageChangeListenerHealth(),
          lag: listenerLag,
        },
      },
      node: {
        nodeId: clusterConfig.nodeId,
        nodeName: clusterConfig.nodeName,
        nodeRegion: clusterConfig.region || null,
        heartbeatAgeMs,
        heartbeatFresh: heartbeatAgeMs !== null && heartbeatAgeMs <= 120_000,
        executorCount,
      },
      resources: {
        memory: {
          rssBytes: mem.rss,
          heapUsedBytes: mem.heapUsed,
          heapTotalBytes: mem.heapTotal,
        },
        loadAvg: process.platform === 'darwin' || process.platform === 'linux'
          ? loadavg()
          : null,
      },
      security: {
        healthTokenConfigured: Boolean(expected),
        devLoginEnabled: isDevLoginEnabled(),
        turnstileConfigured: Boolean(process.env.TURNSTILE_SITE_KEY && process.env.TURNSTILE_SECRET_KEY),
      },
      checks,
    }, degraded ? 503 : 200)
  })
}
