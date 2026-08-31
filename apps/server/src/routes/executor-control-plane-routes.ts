// [INPUT]: 已鉴权 Hono app，配对/连接路由/本地访问/managed-cloud 请求
// [OUTPUT]: /api/control-plane/executors/* 路由（配对码/pair/connection-route/local-access/managed-cloud）
// [POS]: 执行器控制面 HTTP 协议层（配对/连接/遥测/managed-cloud）
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import { normalizeTaskChatAttachments } from '@shared/task-chat-attachment'
import type { TaskSubagentObservation } from '@shared/subagent-role'
import type { ExecutionEventLayer, ExecutionEventType } from '@shared/types'
import type { Hono, MiddlewareHandler } from 'hono'
import { z } from 'zod'
import { listVisibleExecutorsForUser } from '../control-plane/collaboration'
import { recordAdminOperationAudit } from '../control-plane/governance-service'
import { countExecutorActiveTasks } from '../control-plane/task-dispatch'
import { executorWsService } from '../control-plane/executor-ws-service'
import { ensurePasswordUserProfile, isTeamAdmin } from '../repositories/auth'
import { getUserById } from '../repositories/auth'
import { deactivateProjectBinding, listProjectBindings } from '../storage/distributed-task-store'
import { createExecutionEvent, listExecutionEvents } from '../storage/execution-event-store'
import { loadState, saveProject } from '../storage/app-state-store'
import { ensureTeamMember, getScopedState, getUserIdFromHeader, jsonError } from './shared'
import { executorRegistry } from '../control-plane/executor-registry'
import { uploadObject } from '../services/object-storage'
import { resolveExecutorConnectionRoute } from '../services/executor-connection-route'
import { getManagedCloudGate } from '../services/gate/managed-cloud-gate'
import { recordTaskObservation } from '../services/task-observation-service'
import { getPrimaryAgentMcpServers } from '../services/primary-agent-mcp'
import { resolveUserFeatureFlags } from '../services/user-experimental-settings-service'
import { resolveExecutorMeshEnrollment } from '../services/executor-mesh-service'
import { getUserExperimentalSettings } from '../services/user-experimental-settings-service'
import { buildExecutorLocalAccessPlan } from '../services/executor-local-access-service'
import { resolveTerminalAccessRoute } from '../services/executor-mesh-route-service'
import { resolveWorkspaceRuntimeEnvironment } from '../services/runtime-environment-service'
import { remapManagedWorkspaceProjectPath } from '../services/workspace-repo-path'
import { probeExecutorPreviewIngress } from '../services/preview-public-proxy'
import { getWorkspace } from '../storage/distributed-task-store'
import { getCommercialGate } from '../services/gate/commercial-gate'

const executionEventTypes: ExecutionEventType[] = ['task.assign', 'task.ack', 'task.event', 'task.result', 'heartbeat', 'reconnect', 'disconnect', 'error']
const executionEventLayers: ExecutionEventLayer[] = ['pairing', 'connection', 'repo_prepare', 'opencode', 'git', 'sync_back', 'unknown']

const executionEventFilterSchema = z.object({
  taskId: z.string().trim().optional(),
  executorId: z.string().trim().optional(),
  eventType: z.enum(executionEventTypes as [ExecutionEventType, ...ExecutionEventType[]]).optional(),
  layer: z.enum(executionEventLayers as [ExecutionEventLayer, ...ExecutionEventLayer[]]).optional(),
  failuresOnly: z.union([z.literal('1'), z.literal('true'), z.literal('0'), z.literal('false')]).optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
  cursorOccurredAt: z.string().trim().optional(),
  cursorId: z.string().trim().optional(),
})

const pairingCodeSchema = z.object({
  visibility: z.enum(['private', 'team']).default('private'),
  teamId: z.string().trim().optional(),
  workspaceIds: z.array(z.string().trim().min(1)).optional(),
  previewExposureMode: z.enum(['private', 'public-ingress']).optional(),
  label: z.string().trim().optional(),
})

const pairRequestSchema = z.object({
  pairingCode: z.string().trim().min(1),
  machineId: z.string().trim().min(1),
  machineName: z.string().trim().min(1),
  name: z.string().trim().min(1),
  workspaceRoot: z.string().trim().min(1),
  maxConcurrency: z.number().int().positive().default(5),
  labels: z.array(z.string()).default([]),
  capabilities: z.array(z.string()).default([]),
  platform: z.string().trim().optional(),
  version: z.string().trim().optional(),
})

const managedCloudExecutorSchema = z.object({
  workspaceId: z.string().trim().optional(),
  name: z.string().trim().min(1).max(120).optional(),
  maxConcurrency: z.number().int().positive().max(32).optional(),
  autoStart: z.boolean().optional().default(true),
})

const managedCloudPrewarmSchema = z.object({
  targetIds: z.array(z.string().trim().min(1)).optional(),
})

const updateExecutorSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  note: z.string().trim().max(300).optional(),
  maxConcurrency: z.number().int().positive().max(32).optional(),
  previewExposureMode: z.enum(['private', 'public-ingress']).optional(),
  previewIngressPort: z.number().int().positive().max(65535).optional(),
  visibility: z.enum(['private', 'team']).optional(),
  teamId: z.string().trim().optional(),
  workspaceIds: z.array(z.string().trim().min(1)).optional(),
})

const executorRepoProbeSchema = z.object({
  localPath: z.string().trim().min(1),
})

const executorDirectoryBrowseSchema = z.object({
  directoryPath: z.string().trim().optional(),
})

const executorFileReadSchema = z.object({
  filePath: z.string().trim().min(1),
})

const executorFileWriteSchema = z.object({
  filePath: z.string().trim().min(1),
  content: z.string(),
})

const executorTerminalSchema = z.object({
  command: z.string().trim().min(1),
  cwd: z.string().trim().optional(),
  mode: z.enum(['wait', 'background']).optional(),
})

const terminalSessionListSchema = z.object({
  workspaceId: z.string().trim().optional(),
  scope: z.enum(['workspace', 'executor']).optional(),
})

const terminalSessionCreateSchema = z.object({
  terminalId: z.string().trim().min(1),
  workspaceId: z.string().trim().optional(),
  scope: z.enum(['workspace', 'executor']).default('workspace'),
  title: z.string().trim().optional(),
  cwd: z.string().trim().optional(),
})

const terminalSessionCloseSchema = z.object({
  terminalId: z.string().trim().min(1),
  workspaceId: z.string().trim().optional(),
  scope: z.enum(['workspace', 'executor']).default('workspace'),
})

const terminalLocalAttachTicketSchema = z.object({
  terminalId: z.string().trim().min(1),
  workspaceId: z.string().trim().optional(),
  scope: z.enum(['workspace', 'executor']).default('workspace'),
  cwd: z.string().trim().optional(),
  meshSourceExecutorId: z.string().trim().optional(),
  transport: z.enum(['local-direct', 'mesh', 'public-gateway']).optional(),
})

const buildPublicTerminalWsUrl = (baseUrl?: string) => {
  const trimmed = baseUrl?.trim() || ''
  if (!trimmed) {
    return ''
  }

  try {
    const url = new URL(trimmed)
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
    url.pathname = '/api/terminal-public/ws'
    url.search = ''
    url.hash = ''
    return url.toString()
  } catch {
    return ''
  }
}

const validateTerminalSessionScope = (scope: 'workspace' | 'executor' | undefined, workspaceId?: string) => {
  if (scope === 'workspace' && !workspaceId?.trim()) {
    return 'workspace scope 终端必须提供 workspaceId。'
  }
  return ''
}

const executorObservationSchema = z.object({
  taskId: z.string().trim().min(1),
  workspaceId: z.string().trim().min(1),
  workspaceSessionId: z.string().trim().min(1),
  kind: z.enum(['action', 'terminal', 'browser-console', 'network', 'screenshot']),
  level: z.enum(['info', 'success', 'warning', 'error']).optional(),
  title: z.string().trim().min(1).max(200),
  detail: z.string().trim().max(4000).optional(),
  url: z.string().trim().url().max(2000).optional(),
  attachments: z.unknown().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
})

const executorImageSchema = z.object({
  taskId: z.string().trim().min(1),
  filename: z.string().trim().optional(),
  image: z.string().trim().min(1),
})

const resolveExecutorFromToken = (token?: string | null) => {
  const normalizedToken = token?.trim()
  if (!normalizedToken) {
    return null
  }

  return executorRegistry.authenticateExecutorToken(normalizedToken)
}

export const registerExecutorControlPlaneRoutes = (app: Hono, requireAuth: MiddlewareHandler) => {
  const normalizeExecutorWorkspaceIds = (workspaceIds?: string[], teamId?: string) => {
    const values = workspaceIds ?? (teamId ? [teamId] : [])
    return Array.from(new Set(values.map((value) => value?.trim() || '').filter(Boolean)))
  }

  const canManageExecutor = (userId: string, executor: { ownerUserId: string; visibility: string; teamId?: string }) => {
    if (executor.ownerUserId === userId) {
      return true
    }

    return Boolean(executor.visibility === 'team' && executor.teamId && isTeamAdmin(executor.teamId, userId))
  }

  const resolveAuthorizedWorkspace = (userId: string, workspaceId?: string) => {
    if (!workspaceId) {
      return null
    }

    const workspace = getWorkspace(workspaceId)
    if (!workspace) {
      return null
    }

    const scopedState = getScopedState(loadState(), userId)
    const hasProjectAccess = scopedState.projects.some((project) => project.id === workspace.projectId)
    if (!hasProjectAccess) {
      return null
    }

    return workspace
  }

  app.post('/api/control-plane/executors/pairing-codes', requireAuth, async (c) => {
    const payload = pairingCodeSchema.parse(await c.req.json().catch(() => ({})))
    const userId = getUserIdFromHeader(c)
    if (!userId) {
      return c.json({ message: '未登录' }, 401)
    }

    if (payload.visibility === 'team') {
      const workspaceIds = normalizeExecutorWorkspaceIds(payload.workspaceIds, payload.teamId)
      if (workspaceIds.length === 0) {
        return c.json({ message: 'team 共享执行器必须指定至少一个组织。' }, 400)
      }

      for (const workspaceId of workspaceIds) {
        if (!ensureTeamMember(workspaceId, userId)) {
          return jsonError(c, '无权限为该组织创建共享执行器。', 403)
        }
      }
    }

    const workspaceIds = normalizeExecutorWorkspaceIds(payload.workspaceIds, payload.teamId)
    const pairingCode = await executorRegistry.createPairingCode({
      ownerUserId: userId,
      teamId: workspaceIds[0],
      workspaceIds,
      visibility: payload.visibility,
      previewExposureMode: payload.previewExposureMode,
      label: payload.label,
    })

    return c.json({ pairingCode })
  })

  app.post('/api/control-plane/executors/pair', async (c) => {
    const payload = pairRequestSchema.parse(await c.req.json())
    const result = await executorRegistry.exchangePairingCode(payload)
    if (!result.ok) {
      createExecutionEvent({
        eventType: 'error',
        severity: 'error',
        isFailure: true,
        message: `执行器配对失败：${result.message}`,
        payload: {
          machineId: payload.machineId,
          machineName: payload.machineName,
          name: payload.name,
        },
        ownerUserId: 'ownerUserId' in result ? result.ownerUserId : undefined,
        teamId: 'teamId' in result ? result.teamId : undefined,
        layer: 'pairing',
      })
      return c.json({ message: result.message }, 400)
    }

    return c.json({
      executorId: result.executorId,
      executorToken: result.executorToken,
      executor: result.executor,
    })
  })

  // Dev-only: auto-pair a worker using the standard pairing flow internally.
  // Used by `dev:docker` to automatically connect the worker container on startup.
  app.post('/api/control-plane/executors/auto-pair', async (c) => {
    if (process.env.NODE_ENV === 'production') {
      return c.json({ message: '自动配对仅在开发环境可用。' }, 404)
    }

    const body = await c.req.json().catch(() => ({})) as Record<string, unknown>
    const machineId = typeof body.machineId === 'string' ? body.machineId.trim() : ''
    const machineName = typeof body.machineName === 'string' ? body.machineName.trim() : 'docker-dev-worker'
    const name = typeof body.name === 'string' ? body.name.trim() : 'dev-worker'

    if (!machineId) {
      return c.json({ message: '缺少 machineId。' }, 400)
    }

    // Ensure the demo user exists and use as executor owner
    const demoUser = await ensurePasswordUserProfile({
      email: 'demo@test.com',
      password: '123456',
      name: 'Demo User',
      isInternal: true,
      onboardingCompletedAt: new Date().toISOString(),
      onboardingDismissedAt: null,
      onboardingPath: 'quickstart',
    })

    // Use the standard pairing flow so the executor looks like a normal user-paired node
    const pairingRecord = await executorRegistry.createPairingCode({
      ownerUserId: demoUser.id,
      visibility: 'team',
      label: '开发自动连接测试的 Worker',
    })

    const result = await executorRegistry.exchangePairingCode({
      pairingCode: pairingRecord.pairingCode,
      machineId,
      machineName,
      name: '开发自动连接测试的 Worker',
      workspaceRoot: '/data/wemux-worker',
      maxConcurrency: 5,
      capabilities: ['code-execution', 'git-operations'],
      labels: ['runtime:docker', 'env:development'],
      platform: 'docker',
      version: 'dev',
    })

    return c.json({
      executorId: result.executorId,
      executorToken: result.executorToken,
      executor: result.executor,
    })
  })

  app.get('/api/control-plane/executors/connection-route', async (c) => {
    const token = c.req.query('token') || c.req.header('Authorization')?.replace(/^Bearer\s+/, '')
    if (!token) {
      return c.json({ message: '缺少 executor token。' }, 401)
    }

    if (!executorRegistry.authenticateExecutorToken(token)) {
      return c.json({ message: 'executor token 无效。' }, 401)
    }

    return c.json(resolveExecutorConnectionRoute({
      requestUrl: c.req.url,
      headers: {
        'cf-ipcountry': c.req.header('cf-ipcountry'),
        'cf-ipcontinent': c.req.header('cf-ipcontinent'),
        'x-forwarded-host': c.req.header('x-forwarded-host'),
        'x-forwarded-proto': c.req.header('x-forwarded-proto'),
        host: c.req.header('host'),
      },
    }))
  })

  app.get('/api/control-plane/executors', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)
    if (!userId) {
      return c.json({ message: '未登录' }, 401)
    }

    const executors = listVisibleExecutorsForUser(userId, c.req.query('workspaceId')?.trim() || undefined)

    return c.json({ executors })
  })

  app.get('/api/control-plane/executors/local-access-plan', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)
    if (!userId) {
      return c.json({ message: '未登录' }, 401)
    }

    c.header('Cache-Control', 'no-store')
    return c.json(buildExecutorLocalAccessPlan({
      allowMesh: c.req.query('allowMesh') === '1' || c.req.query('allowMesh') === 'true',
      executors: listVisibleExecutorsForUser(userId),
      targetExecutorId: c.req.query('targetExecutorId'),
      userId,
    }))
  })

  app.get('/api/control-plane/executors/managed-cloud/runtime', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)
    if (!userId) {
      return c.json({ message: '未登录' }, 401)
    }

    if (!getManagedCloudGate().isDevOnlyEnabled()) {
      return c.json({ message: getManagedCloudGate().devOnlyMessage }, 404)
    }

    const state = loadState()
    const executors = listVisibleExecutorsForUser(userId)
    const runtime = await getManagedCloudGate().inspectRuntime(state.config.managedCloud)
    const targets = await getManagedCloudGate().inspectRuntimeTargets(executors, state.config.managedCloud)
    return c.json({ runtime, targets })
  })

  app.get('/api/control-plane/executors/managed-cloud/usage', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)
    if (!userId) {
      return c.json({ message: '未登录' }, 401)
    }

    if (!getManagedCloudGate().isDevOnlyEnabled()) {
      return c.json({ message: getManagedCloudGate().devOnlyMessage }, 404)
    }

    const state = getScopedState(loadState(), userId)
    const billingPolicy = await getCommercialGate().resolveBillingPolicySnapshot(userId)
    return c.json(getManagedCloudGate().buildUsageResponse({ state, userId, billingPlan: billingPolicy.plan }))
  })

  app.post('/api/control-plane/executors/managed-cloud', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)
    if (!userId) {
      return c.json({ message: '未登录' }, 401)
    }

    try {
      getManagedCloudGate().ensureDevOnlyAccess()
    } catch (error) {
      return c.json({ message: error instanceof Error ? error.message : getManagedCloudGate().devOnlyMessage }, 404)
    }

    const payload = managedCloudExecutorSchema.parse(await c.req.json().catch(() => ({})))
    const workspaceId = payload.workspaceId?.trim() || undefined
    if (workspaceId && !ensureTeamMember(workspaceId, userId)) {
      return c.json({ message: '无权限为该组织创建官方云节点。' }, 403)
    }

    try {
      const state = loadState()
      const billingPolicy = await getCommercialGate().resolveBillingPolicySnapshot(userId)
      await getManagedCloudGate().ensureUsageAccess({
        state: getScopedState(state, userId),
        userId,
        billingPlan: billingPolicy.plan,
      })
      const result = await getManagedCloudGate().ensureExecutor({
        config: state.config,
        ownerUserId: userId,
        workspaceId,
        name: payload.name,
        maxConcurrency: payload.maxConcurrency,
        autoStart: payload.autoStart,
        projects: state.projects,
      })

      return c.json({
        ok: true,
        executor: result.executor,
        created: result.created,
        started: result.started,
        message: result.executor.status === 'online'
          ? (result.created ? '官方云节点已创建并启动。' : '官方云节点已就绪。')
          : (result.created ? '官方云节点已创建，正在启动。' : '官方云节点启动中，请稍候刷新状态。'),
      })
    } catch (error) {
      if (getManagedCloudGate().isUsageLimitError(error)) {
        const usageLimit = error as { message?: string; usage?: unknown; statusCode?: number }
        return c.json({ message: usageLimit.message ?? String(error), usage: usageLimit.usage }, usageLimit.statusCode as 402)
      }

      if (getManagedCloudGate().isRuntimeError(error)) {
        const runtimeError = error as { message?: string; statusCode?: number }
        return c.json({ message: runtimeError.message ?? String(error) }, runtimeError.statusCode as 409)
      }

      throw error
    }
  })

  app.post('/api/control-plane/executors/managed-cloud/runtime/prewarm', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)
    if (!userId) {
      return c.json({ message: '未登录' }, 401)
    }

    try {
      getManagedCloudGate().ensureDevOnlyAccess()
    } catch (error) {
      return c.json({ message: error instanceof Error ? error.message : getManagedCloudGate().devOnlyMessage }, 404)
    }

    const user = getUserById(userId)
    if (!user?.isInternal) {
      return c.json({ message: '只有内部运维账号可以预热官方云节点 target。' }, 403)
    }

    const payload = managedCloudPrewarmSchema.parse(await c.req.json().catch(() => ({})))
    const state = loadState()

    try {
      const prewarmed = await getManagedCloudGate().prewarmRuntimeTargets(state.config.managedCloud, payload.targetIds)
      const executors = listVisibleExecutorsForUser(userId)
      const runtime = await getManagedCloudGate().inspectRuntime(state.config.managedCloud)
      const targets = await getManagedCloudGate().inspectRuntimeTargets(executors, state.config.managedCloud)
      const succeeded = prewarmed.filter((item: { ok?: boolean }) => item.ok).length
      const failed = prewarmed.length - succeeded

      recordAdminOperationAudit({
        actorUserId: userId,
        eventType: 'admin.cloud_target.prewarm',
        payload: {
          targetIds: payload.targetIds ?? [],
          succeeded,
          failed,
        },
      })

      return c.json({
        ok: failed === 0,
        runtime,
        targets,
        prewarmed,
        message: failed === 0
          ? `已完成 ${succeeded} 个 managed cloud target 的镜像预热。`
          : `已完成 ${succeeded} 个 managed cloud target 的镜像预热，${failed} 个 target 失败。`,
      })
    } catch (error) {
      if (getManagedCloudGate().isRuntimeError(error)) {
        const runtimeError = error as { message?: string; statusCode?: number }
        return c.json({ message: runtimeError.message ?? String(error) }, runtimeError.statusCode as 409)
      }

      throw error
    }
  })

  app.post('/api/control-plane/executors/managed-cloud/runtime/reconcile', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)
    if (!userId) {
      return c.json({ message: '未登录' }, 401)
    }

    try {
      getManagedCloudGate().ensureDevOnlyAccess()
    } catch (error) {
      return c.json({ message: error instanceof Error ? error.message : getManagedCloudGate().devOnlyMessage }, 404)
    }

    const user = getUserById(userId)
    if (!user?.isInternal) {
      return c.json({ message: '只有内部运维账号可以重平衡官方云节点。' }, 403)
    }

    try {
      const state = loadState()
      const result = await getManagedCloudGate().reconcileExecutors(state.config)
      const executors = listVisibleExecutorsForUser(userId)
      const runtime = await getManagedCloudGate().inspectRuntime(state.config.managedCloud)
      const targets = await getManagedCloudGate().inspectRuntimeTargets(executors, state.config.managedCloud)
      const message = result.warnings.length > 0
        ? `已重写 ${result.rewrittenConfigCount} 个官方云节点配置，重分配 ${result.relabeledCount} 个 target。${result.warnings[0]}`
        : `已重写 ${result.rewrittenConfigCount} 个官方云节点配置，重分配 ${result.relabeledCount} 个 target。`

      recordAdminOperationAudit({
        actorUserId: userId,
        eventType: 'admin.cloud_target.reconcile',
        payload: {
          relabeledCount: result.relabeledCount,
          rewrittenConfigCount: result.rewrittenConfigCount,
          warningCount: result.warnings.length,
          warnings: result.warnings.slice(0, 5),
        },
      })

      return c.json({
        ok: result.warnings.length === 0,
        runtime,
        targets,
        relabeledCount: result.relabeledCount,
        rewrittenConfigCount: result.rewrittenConfigCount,
        warnings: result.warnings,
        message,
      })
    } catch (error) {
      if (getManagedCloudGate().isRuntimeError(error)) {
        const runtimeError = error as { message?: string; statusCode?: number }
        return c.json({ message: runtimeError.message ?? String(error) }, runtimeError.statusCode as 409)
      }

      return c.json({ message: error instanceof Error ? error.message : '重平衡官方云节点失败。' }, 400)
    }
  })

  app.get('/api/control-plane/execution-events', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)
    if (!userId) {
      return c.json({ message: '未登录' }, 401)
    }

    const filters = executionEventFilterSchema.parse(c.req.query())
    const executors = listVisibleExecutorsForUser(userId)
    const scopedState = getScopedState(loadState(), userId)

    const events = await listExecutionEvents({
      taskId: filters.taskId || undefined,
      executorId: filters.executorId || undefined,
      eventType: filters.eventType,
      layer: filters.layer,
      failuresOnly: filters.failuresOnly === '1' || filters.failuresOnly === 'true',
      limit: filters.limit,
      cursor: filters.cursorOccurredAt && filters.cursorId
        ? { occurredAt: filters.cursorOccurredAt, id: filters.cursorId }
        : undefined,
      projectIds: scopedState.projects.map((project) => project.id),
      executorIds: executors.map((executor) => executor.executorId),
      ownerUserId: userId,
    })

    return c.json(events)
  })

  app.put('/api/control-plane/executors/:executorId', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)
    if (!userId) {
      return c.json({ message: '未登录' }, 401)
    }

    const executorId = c.req.param('executorId')?.trim()
    if (!executorId) {
      return c.json({ message: '执行器不存在。' }, 404)
    }
    const executor = executorRegistry.getExecutor(executorId)
    if (!executor) {
      return c.json({ message: '执行器不存在。' }, 404)
    }

    if (!canManageExecutor(userId, executor)) {
      return c.json({ message: '无权限编辑该执行器。' }, 403)
    }

    const payload = updateExecutorSchema.parse(await c.req.json())

    if (payload.visibility === 'team') {
      const requestedWorkspaceIds = normalizeExecutorWorkspaceIds(payload.workspaceIds, payload.teamId)
      if (requestedWorkspaceIds.length === 0) {
        return jsonError(c, '团队共享工作站必须指定至少一个组织。', 400)
      }

      for (const workspaceId of requestedWorkspaceIds) {
        if (!ensureTeamMember(workspaceId, userId)) {
          return jsonError(c, '无权限将该工作站共享给该组织。', 403)
        }
      }
    }

    const currentWorkspaceIds = normalizeExecutorWorkspaceIds(executor.workspaceIds, executor.teamId)
    const nextWorkspaceIds = payload.visibility === 'private'
      ? []
      : payload.workspaceIds !== undefined || payload.teamId !== undefined
        ? normalizeExecutorWorkspaceIds(payload.workspaceIds, payload.teamId)
        : currentWorkspaceIds
    const nextTeamId = payload.visibility === 'private'
      ? undefined
      : nextWorkspaceIds[0]

    if (payload.visibility === 'private' && executor.visibility !== 'private') {
      const quotaAccess = getCommercialGate().buildFreePrivateExecutorQuotaAccess(
        userId,
        executorRegistry.listExecutors(),
        { excludeExecutorId: executorId },
      )
      if (!quotaAccess.allowed) {
        return c.json({ message: quotaAccess.message }, 429)
      }
    }

    const next = executorRegistry.upsertExecutor(executorId, {
      ...(payload.name ? { name: payload.name } : {}),
      note: payload.note ?? executor.note,
      ...(payload.maxConcurrency ? { maxConcurrency: payload.maxConcurrency } : {}),
      previewExposureMode: payload.previewExposureMode ?? executor.previewExposureMode ?? 'private',
      previewIngressPort: payload.previewIngressPort ?? executor.previewIngressPort ?? 38080,
      ...(payload.visibility ? { visibility: payload.visibility } : {}),
      teamId: nextTeamId,
      workspaceIds: nextWorkspaceIds,
      lastSeenAt: new Date().toISOString(),
    })

    if (!next) {
      return c.json({ message: '执行器不存在。' }, 404)
    }

    if (next.status === 'online') {
      const state = loadState()
      executorWsService.dispatchTask(executorId, {
        type: 'config.sync',
        opencodeConfigContent: state.config.opencodeConfigContent,
        codexConfigContent: state.config.codexConfigContent,
        codexAuthContent: state.config.codexAuthContent,
        claudeCodeConfigContent: state.config.claudeCodeConfigContent,
        defaultModel: state.config.defaultModel,
        agentSettings: state.config.agentSettings,
        mcpServers: getPrimaryAgentMcpServers(state.config, next.ownerUserId),
        maxConcurrency: next.maxConcurrency,
        previewExposureMode: next.previewExposureMode,
        previewIngressPort: next.previewIngressPort,
        previewProxySecret: executorRegistry.getPreviewProxySecret(next.executorId),
        meshEnrollment: resolveExecutorMeshEnrollment(next),
        featureFlags: resolveUserFeatureFlags(next.ownerUserId),
        at: new Date().toISOString(),
      })
    }

    let refreshed = next
    if (next.previewExposureMode === 'public-ingress') {
      if (next.previewIngressBaseUrl?.trim()) {
        const probe = await probeExecutorPreviewIngress(executorId)
        refreshed = executorRegistry.upsertExecutor(executorId, {
          previewIngressReachable: probe.reachable,
          previewIngressLastCheckedAt: probe.checkedAt,
          previewIngressLastError: probe.error || undefined,
        }) ?? refreshed
      } else {
        refreshed = executorRegistry.upsertExecutor(executorId, {
          previewIngressReachable: undefined,
          previewIngressLastCheckedAt: new Date().toISOString(),
          previewIngressLastError: 'waiting for worker to report public preview ingress address',
        }) ?? refreshed
      }
    } else {
      refreshed = executorRegistry.upsertExecutor(executorId, {
        previewIngressReachable: undefined,
        previewIngressLastCheckedAt: undefined,
        previewIngressLastError: undefined,
      }) ?? refreshed
    }

    recordAdminOperationAudit({
      actorUserId: userId,
      eventType: 'admin.executor.updated',
      payload: {
        executorId,
        name: next.name,
        maxConcurrency: next.maxConcurrency,
        visibility: next.visibility,
        teamId: next.teamId,
        workspaceIds: next.workspaceIds,
      },
    })

    return c.json({ ok: true, executor: refreshed })
  })

  app.delete('/api/control-plane/executors/:executorId', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)
    if (!userId) {
      return c.json({ message: '未登录' }, 401)
    }

    const executorId = c.req.param('executorId')?.trim()
    if (!executorId) {
      return c.json({ message: '执行器不存在或无权限访问。' }, 404)
    }
    const executor = executorRegistry.getExecutor(executorId)
    if (!executor) {
      return c.json({ message: '执行器不存在。' }, 404)
    }

    if (!canManageExecutor(userId, executor)) {
      return c.json({ message: '无权限删除该执行器。' }, 403)
    }

    const activeTaskCount = countExecutorActiveTasks(executorId)
    if (activeTaskCount > 0) {
      return c.json({ message: '该工作站仍有运行中任务，暂时不能删除。' }, 409)
    }

    for (const binding of listProjectBindings().filter((item) => item.nodeId === executorId)) {
      deactivateProjectBinding(binding.projectId, binding.nodeId)
    }

    for (const project of loadState().projects.filter((item) => item.preferredExecutorId === executorId)) {
      saveProject({
        ...project,
        preferredExecutorId: undefined,
      })
    }

    if (getManagedCloudGate().isManagedExecutor(executor)) {
      await getManagedCloudGate().stopExecutor({
        config: loadState().config,
        executorId,
        cleanup: true,
      })
    } else {
      executorWsService.dispatchTask(executorId, {
        type: 'executor.unpair',
        reason: '工作站已从控制面删除，本地 worker 将自动退出。请重新配对后再连接。',
        shutdown: true,
        at: new Date().toISOString(),
      })
    }

    const deletedExecutor = executorRegistry.deleteExecutor(executorId)
    if (!deletedExecutor) {
      return c.json({ message: '执行器不存在。' }, 404)
    }

    recordAdminOperationAudit({
      actorUserId: userId,
      eventType: 'admin.executor.deleted',
      payload: {
        executorId,
        executorName: executor.name,
        managedCloud: getManagedCloudGate().isManagedExecutor(executor),
      },
    })

    return c.json({
      ok: true,
      executorId,
      message: '工作站已删除。',
    })
  })

  app.post('/api/control-plane/executors/:executorId/shutdown', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)
    if (!userId) {
      return c.json({ message: '未登录' }, 401)
    }

    const executorId = c.req.param('executorId')?.trim()
    if (!executorId) {
      return c.json({ message: '执行器不存在。' }, 404)
    }

    const executor = executorRegistry.getExecutor(executorId)
    if (!executor) {
      return c.json({ message: '执行器不存在。' }, 404)
    }

    if (!canManageExecutor(userId, executor)) {
      return c.json({ message: '无权限操作该执行器。' }, 403)
    }

    const activeTaskCount = countExecutorActiveTasks(executorId)
    if (activeTaskCount > 0) {
      return c.json({ message: '该工作站仍有运行中任务，暂时不能退出。' }, 409)
    }

    if (getManagedCloudGate().isManagedExecutor(executor)) {
      await getManagedCloudGate().stopExecutor({
        config: loadState().config,
        executorId,
      })
      recordAdminOperationAudit({
        actorUserId: userId,
        eventType: 'admin.executor.shutdown',
        payload: {
          executorId,
          executorName: executor.name,
          managedCloud: true,
        },
      })
      return c.json({
        ok: true,
        executorId,
        message: '已停止官方云节点。',
      })
    }

    if (executor.status !== 'online') {
      return c.json({ message: '执行器当前不在线，无法远程退出。' }, 409)
    }

    const dispatched = executorWsService.dispatchTask(executorId, {
      type: 'executor.shutdown',
      reason: '控制面请求 worker 退出；如果由 PM2 托管会自动拉起新进程。',
      at: new Date().toISOString(),
    })

    if (!dispatched) {
      return c.json({ message: '执行器当前不在线，无法远程退出。' }, 409)
    }

    recordAdminOperationAudit({
      actorUserId: userId,
      eventType: 'admin.executor.shutdown',
      payload: {
        executorId,
        executorName: executor.name,
        managedCloud: false,
      },
    })

    return c.json({
      ok: true,
      executorId,
      message: '已通知工作站退出。',
    })
  })

  app.get('/api/control-plane/executors/:executorId/ssh-key', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)
    if (!userId) {
      return c.json({ message: '未登录' }, 401)
    }

    const executorId = c.req.param('executorId')
    const executor = listVisibleExecutorsForUser(userId).find((item) => item.executorId === executorId)
    if (!executor) {
      return c.json({ message: '执行器不存在或无权限访问。' }, 404)
    }

    return c.json({
      executorId,
      sshPubkey: executor.sshPubkey,
    })
  })

  const exportExecutorAgentRuntimeConfig: MiddlewareHandler = async (c) => {
    const userId = getUserIdFromHeader(c)
    if (!userId) {
      return c.json({ message: '未登录' }, 401)
    }

    const executorId = c.req.param('executorId')?.trim()
    if (!executorId) {
      return c.json({ message: '执行器不存在或无权限访问。' }, 404)
    }
    const executor = executorRegistry.getExecutor(executorId)
    if (!executor || executor.ownerUserId !== userId) {
      return c.json({ message: '执行器不存在或无权限访问。' }, 404)
    }

    try {
      const exported = await executorWsService.requestConfigExport(executorId)
      const fallbackAgentSettings = loadState().config.agentSettings
      return c.json({
        ok: true,
        executorId,
        opencodeConfigContent: exported.opencodeConfigContent ?? '',
        codexConfigContent: exported.codexConfigContent ?? '',
        codexAuthContent: exported.codexAuthContent ?? '',
        claudeCodeConfigContent: exported.claudeCodeConfigContent ?? '',
        defaultModel: exported.defaultModel ?? '',
        agentSettings: exported.agentSettings ?? fallbackAgentSettings,
        at: exported.at,
      })
    } catch (error) {
      return c.json({ message: error instanceof Error ? error.message : '执行节点配置导出失败。' }, 503)
    }
  }

  app.post('/api/control-plane/executors/:executorId/opencode-config/export', requireAuth, exportExecutorAgentRuntimeConfig)
  app.post('/api/control-plane/executors/:executorId/agent-config/export', requireAuth, exportExecutorAgentRuntimeConfig)

  app.post('/api/control-plane/executors/:executorId/repo-probe', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)
    if (!userId) {
      return c.json({ message: '未登录' }, 401)
    }

    const executorId = c.req.param('executorId')
    const executor = listVisibleExecutorsForUser(userId).find((item) => item.executorId === executorId)
    if (!executor) {
      return c.json({ message: '执行器不存在或无权限访问。' }, 404)
    }

    const payload = executorRepoProbeSchema.parse(await c.req.json())

    try {
      const result = await executorWsService.requestRepoProbe(executorId, payload.localPath)
      return c.json(result, result.ok ? 200 : 400)
    } catch (error) {
      return c.json({ ok: false, message: error instanceof Error ? error.message : '执行器目录探测失败。' }, 503)
    }
  })

  app.post('/api/control-plane/executors/:executorId/telemetry/refresh', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)
    if (!userId) {
      return c.json({ message: '未登录' }, 401)
    }

    const executorId = c.req.param('executorId')
    const executor = listVisibleExecutorsForUser(userId).find((item) => item.executorId === executorId)
    if (!executor) {
      return c.json({ message: '执行器不存在或无权限访问。' }, 404)
    }

    try {
      await executorWsService.requestTelemetry(executorId)
      const refreshedExecutor = listVisibleExecutorsForUser(userId).find((item) => item.executorId === executorId)
      if (!refreshedExecutor) {
        return c.json({ message: '执行器刷新后不可访问。' }, 404)
      }

      return c.json({
        ok: true,
        executor: refreshedExecutor,
      })
    } catch (error) {
      return c.json({ ok: false, message: error instanceof Error ? error.message : '执行器资源刷新失败。' }, 503)
    }
  })

  app.post('/api/control-plane/executors/:executorId/doctor', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)
    if (!userId) {
      return c.json({ message: '未登录' }, 401)
    }

    const executorId = c.req.param('executorId')
    const executor = listVisibleExecutorsForUser(userId).find((item) => item.executorId === executorId)
    if (!executor) {
      return c.json({ message: '执行器不存在或无权限访问。' }, 404)
    }

    try {
      const doctor = await executorWsService.requestDoctor(executorId)
      return c.json({
        ok: true,
        executorId,
        doctor,
      })
    } catch (error) {
      return c.json({ ok: false, message: error instanceof Error ? error.message : '执行器自检失败。' }, 503)
    }
  })

  app.post('/api/control-plane/executors/:executorId/directory-browse', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)
    if (!userId) {
      return c.json({ message: '未登录' }, 401)
    }

    const executorId = c.req.param('executorId')
    const executor = listVisibleExecutorsForUser(userId).find((item) => item.executorId === executorId)
    if (!executor) {
      return c.json({ message: '执行器不存在或无权限访问。' }, 404)
    }

    const payload = executorDirectoryBrowseSchema.parse(await c.req.json().catch(() => ({})))
    const directoryPath = remapManagedWorkspaceProjectPath(executor.workspaceRoot, payload.directoryPath)

    try {
      const result = await executorWsService.requestDirectoryBrowse(executorId, executor.workspaceRoot, directoryPath)
      return c.json(result, result.ok ? 200 : 400)
    } catch (error) {
      return c.json({ ok: false, message: error instanceof Error ? error.message : '执行器目录浏览失败。' }, 503)
    }
  })

  app.post('/api/control-plane/executors/:executorId/file-read', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)
    if (!userId) {
      return c.json({ message: '未登录' }, 401)
    }

    const executorId = c.req.param('executorId')
    const executor = listVisibleExecutorsForUser(userId).find((item) => item.executorId === executorId)
    if (!executor) {
      return c.json({ message: '执行器不存在或无权限访问。' }, 404)
    }

    const payload = executorFileReadSchema.parse(await c.req.json().catch(() => ({})))
    const filePath = remapManagedWorkspaceProjectPath(executor.workspaceRoot, payload.filePath) || payload.filePath

    try {
      const result = await executorWsService.requestFileRead(executorId, executor.workspaceRoot, filePath)
      return c.json(result, result.ok ? 200 : 400)
    } catch (error) {
      return c.json({ ok: false, message: error instanceof Error ? error.message : '执行器文件读取失败。' }, 503)
    }
  })

  app.post('/api/control-plane/executors/:executorId/file-write', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)
    if (!userId) {
      return c.json({ message: '未登录' }, 401)
    }

    const executorId = c.req.param('executorId')
    const executor = listVisibleExecutorsForUser(userId).find((item) => item.executorId === executorId)
    if (!executor) {
      return c.json({ message: '执行器不存在或无权限访问。' }, 404)
    }

    const payload = executorFileWriteSchema.parse(await c.req.json().catch(() => ({})))
    const filePath = remapManagedWorkspaceProjectPath(executor.workspaceRoot, payload.filePath) || payload.filePath

    try {
      const result = await executorWsService.requestFileWrite(executorId, executor.workspaceRoot, filePath, payload.content)
      return c.json(result, result.ok ? 200 : 400)
    } catch (error) {
      return c.json({ ok: false, message: error instanceof Error ? error.message : '执行器文件写入失败。' }, 503)
    }
  })

  app.post('/api/control-plane/executors/:executorId/terminal', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)
    if (!userId) {
      return c.json({ message: '未登录' }, 401)
    }

    const executorId = c.req.param('executorId')
    const executor = listVisibleExecutorsForUser(userId).find((item) => item.executorId === executorId)
    if (!executor) {
      return c.json({ message: '执行器不存在或无权限访问。' }, 404)
    }

    const payload = executorTerminalSchema.parse(await c.req.json())
    const cwd = remapManagedWorkspaceProjectPath(executor.workspaceRoot, payload.cwd?.trim())

    try {
      const result = await executorWsService.requestTerminalCommand(executorId, payload.command, cwd, {
        mode: payload.mode,
      })
      return c.json({ ok: true, result })
    } catch (error) {
      return c.json({ ok: false, message: error instanceof Error ? error.message : '远程终端执行失败。' }, 503)
    }
  })

  app.get('/api/control-plane/executors/:executorId/terminal-sessions', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)
    if (!userId) {
      return c.json({ message: '未登录' }, 401)
    }

    const executorId = c.req.param('executorId')
    const executor = listVisibleExecutorsForUser(userId).find((item) => item.executorId === executorId)
    if (!executor) {
      return c.json({ message: '执行器不存在或无权限访问。' }, 404)
    }

    const payload = terminalSessionListSchema.parse({
      workspaceId: c.req.query('workspaceId') || undefined,
      scope: c.req.query('scope') || undefined,
    })
    const scopeError = validateTerminalSessionScope(payload.scope, payload.workspaceId)
    if (scopeError) {
      return c.json({ message: scopeError }, 400)
    }
    if (payload.workspaceId && !resolveAuthorizedWorkspace(userId, payload.workspaceId)) {
      return c.json({ message: '工作区不存在或无权访问。' }, 404)
    }

    try {
      const result = await executorWsService.requestTerminalSessionList(executorId, {
        workspaceId: payload.workspaceId,
        scope: payload.scope,
      })
      return c.json(result, result.ok ? 200 : 400)
    } catch (error) {
      return c.json({ ok: false, message: error instanceof Error ? error.message : '终端会话列表读取失败。', sessions: [] }, 503)
    }
  })

  app.post('/api/control-plane/executors/:executorId/terminal-sessions', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)
    if (!userId) {
      return c.json({ message: '未登录' }, 401)
    }

    const executorId = c.req.param('executorId')
    const executor = listVisibleExecutorsForUser(userId).find((item) => item.executorId === executorId)
    if (!executor) {
      return c.json({ message: '执行器不存在或无权限访问。' }, 404)
    }

    const payload = terminalSessionCreateSchema.parse(await c.req.json().catch(() => ({})))
    const scopeError = validateTerminalSessionScope(payload.scope, payload.workspaceId)
    if (scopeError) {
      return c.json({ message: scopeError }, 400)
    }
    const workspace = resolveAuthorizedWorkspace(userId, payload.workspaceId)
    if (payload.workspaceId && !workspace) {
      return c.json({ message: '工作区不存在或无权访问。' }, 404)
    }

    try {
      const runtimeEnvironment = payload.workspaceId
        ? await resolveWorkspaceRuntimeEnvironment(payload.workspaceId).then((result) => result?.payload).catch(() => undefined)
        : undefined
      const result = await executorWsService.requestTerminalSessionCreate(executorId, {
        terminalId: payload.terminalId,
        scope: payload.scope,
        workspaceId: payload.workspaceId,
        title: payload.title,
        cwd: remapManagedWorkspaceProjectPath(executor.workspaceRoot, payload.cwd),
        ownerUserId: userId,
        runtimeEnvironment,
      })
      return c.json(result, result.ok ? 200 : 400)
    } catch (error) {
      return c.json({ ok: false, created: false, message: error instanceof Error ? error.message : '终端会话创建失败。' }, 503)
    }
  })

  app.post('/api/control-plane/executors/:executorId/terminal-local-attach-ticket', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)
    if (!userId) {
      return c.json({ message: '未登录' }, 401)
    }

    const executorId = c.req.param('executorId')
    const executor = listVisibleExecutorsForUser(userId).find((item) => item.executorId === executorId)
    if (!executor) {
      return c.json({ message: '执行器不存在或无权限访问。' }, 404)
    }

    const payload = terminalLocalAttachTicketSchema.parse(await c.req.json().catch(() => ({})))
    const scopeError = validateTerminalSessionScope(payload.scope, payload.workspaceId)
    if (scopeError) {
      return c.json({ message: scopeError }, 400)
    }
    if (payload.workspaceId && !resolveAuthorizedWorkspace(userId, payload.workspaceId)) {
      return c.json({ message: '工作区不存在或无权访问。' }, 404)
    }

    try {
      const requestedTerminalTransport = payload.transport
      const publicTerminalWsUrl = buildPublicTerminalWsUrl(executor.previewIngressBaseUrl)
      if (requestedTerminalTransport === 'public-gateway' && (!publicTerminalWsUrl || executor.previewExposureMode !== 'public-ingress')) {
        return c.json({
          ok: false,
          message: '当前节点未配置公网终端入口。',
        }, 400)
      }

      const sourceExecutor = payload.meshSourceExecutorId
        ? listVisibleExecutorsForUser(userId).find((item) => item.executorId === payload.meshSourceExecutorId)
        : null
      const shouldResolveMeshRoute = requestedTerminalTransport === 'mesh'
        || (!requestedTerminalTransport && sourceExecutor && sourceExecutor.executorId !== executorId)
      const terminalRoute = shouldResolveMeshRoute && sourceExecutor && sourceExecutor.executorId !== executorId && payload.workspaceId
        ? resolveTerminalAccessRoute({
            workspaceId: payload.workspaceId,
            terminalId: payload.terminalId,
            targetExecutorId: executorId,
            sourceExecutorId: sourceExecutor.executorId,
            sourceExecutor,
            targetExecutor: executor,
          })
        : null
      if (shouldResolveMeshRoute && sourceExecutor && sourceExecutor.executorId !== executorId) {
        if (!terminalRoute || (terminalRoute.mode !== 'mesh-direct' && terminalRoute.mode !== 'mesh-relayed') || !terminalRoute.url) {
          return c.json({
            ok: false,
            message: '当前终端没有可用的 Mesh 直连路由。',
          }, 400)
        }
      }

      const result = await executorWsService.requestTerminalLocalAttachTicket(executorId, {
        terminalId: payload.terminalId,
        scope: payload.scope,
        workspaceId: payload.workspaceId,
        cwd: remapManagedWorkspaceProjectPath(executor.workspaceRoot, payload.cwd),
      })
      if (
        result.ok
        && result.ticket
        && terminalRoute
        && (terminalRoute.mode === 'mesh-direct' || terminalRoute.mode === 'mesh-relayed')
      ) {
        result.wsUrl = terminalRoute.url
        result.expiresAt = terminalRoute.expiresAt ?? result.expiresAt
        result.transport = terminalRoute.mode
      } else if (result.ok && result.ticket && requestedTerminalTransport === 'public-gateway' && publicTerminalWsUrl) {
        result.wsUrl = publicTerminalWsUrl
        result.transport = 'terminal-public-gateway'
      } else if (result.ok && result.ticket) {
        result.transport = 'local-direct'
      }
      return c.json(result, result.ok ? 200 : 400)
    } catch (error) {
      return c.json({
        ok: false,
        message: error instanceof Error ? error.message : '本地终端直连票据创建失败。',
      }, 503)
    }
  })

  app.delete('/api/control-plane/executors/:executorId/terminal-sessions', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)
    if (!userId) {
      return c.json({ message: '未登录' }, 401)
    }

    const executorId = c.req.param('executorId')
    const executor = listVisibleExecutorsForUser(userId).find((item) => item.executorId === executorId)
    if (!executor) {
      return c.json({ message: '执行器不存在或无权限访问。' }, 404)
    }

    const payload = terminalSessionCloseSchema.parse(await c.req.json().catch(() => ({})))
    const scopeError = validateTerminalSessionScope(payload.scope, payload.workspaceId)
    if (scopeError) {
      return c.json({ message: scopeError }, 400)
    }
    if (payload.workspaceId && !resolveAuthorizedWorkspace(userId, payload.workspaceId)) {
      return c.json({ message: '工作区不存在或无权访问。' }, 404)
    }

    try {
      const result = await executorWsService.closeTerminalSession({
        executorId,
        terminalId: payload.terminalId,
        scope: payload.scope,
        workspaceId: payload.workspaceId,
      })
      return c.json(result, result.ok ? 200 : 400)
    } catch (error) {
      return c.json({ ok: false, closed: false, message: error instanceof Error ? error.message : '终端会话关闭失败。' }, 503)
    }
  })

  app.post('/api/control-plane/executors/observations', async (c) => {
    const token = c.req.header('Authorization')?.replace(/^Bearer\s+/, '') || c.req.header('x-executor-token')
    const executor = resolveExecutorFromToken(token)
    if (!executor) {
      return c.json({ message: 'executor token 无效。' }, 401)
    }

    const payload = executorObservationSchema.parse(await c.req.json())
    const state = loadState()
    const task = state.tasks.find((item) => item.id === payload.taskId)
    const project = task ? state.projects.find((item) => item.id === task.projectId) : undefined
    const workspaceSession = state.workspaceSessions.find((item) => item.id === payload.workspaceSessionId)
    const binding = state.taskWorkspaceBindings.find((item) => (
      item.taskId === payload.taskId
      && item.workspaceId === payload.workspaceId
      && item.status === 'active'
    ))

    if (
      !task
      || !project
      || !binding
      || !workspaceSession
      || workspaceSession.workspaceId !== payload.workspaceId
    ) {
      return c.json({ message: '目标任务或工作区会话不存在。' }, 404)
    }

    const observation: TaskSubagentObservation = {
      id: crypto.randomUUID(),
      ts: new Date().toISOString(),
      kind: payload.kind,
      level: payload.level ?? 'info',
      title: payload.title,
      detail: payload.detail?.trim() || undefined,
      url: payload.url?.trim() || undefined,
      attachments: normalizeTaskChatAttachments(payload.attachments),
      metadata: {
        ...payload.metadata,
        executorId: executor.executorId,
      },
    }

    recordTaskObservation({
      task,
      project,
      workspaceId: payload.workspaceId,
      workspaceSessionId: payload.workspaceSessionId,
      observation,
    })

    return c.json({ ok: true, executorId: executor.executorId })
  })

  app.post('/api/control-plane/executors/images', async (c) => {
    const token = c.req.header('Authorization')?.replace(/^Bearer\s+/, '') || c.req.header('x-executor-token')
    const executor = resolveExecutorFromToken(token)
    if (!executor) {
      return c.json({ message: 'executor token 无效。' }, 401)
    }

    const payload = executorImageSchema.parse(await c.req.json())
    const state = loadState()
    const task = state.tasks.find((item) => item.id === payload.taskId)
    if (!task) {
      return c.json({ message: '任务不存在。' }, 404)
    }

    const base64Data = payload.image.replace(/^data:image\/\w+;base64,/, '')
    const buffer = Buffer.from(base64Data, 'base64')
    const ext = payload.filename?.split('.').pop() || 'png'
    const imageId = `${payload.taskId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const imageFilename = `${imageId}.${ext}`

    try {
      await uploadObject(`images/tasks/${payload.taskId}/${imageFilename}`, buffer, {
        contentType: `image/${ext === 'jpg' ? 'jpeg' : ext}`,
      })
    } catch (error) {
      return c.json({ message: error instanceof Error ? error.message : '图片上传失败。' }, 503)
    }

    return c.json({
      ok: true,
      executorId: executor.executorId,
      id: imageId,
      url: `/uploads/images/${imageFilename}`,
    })
  })

}
