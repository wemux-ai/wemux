import type { Hono, MiddlewareHandler } from 'hono'
import { basename } from 'node:path'
import { readFileSync } from 'node:fs'
import { z } from 'zod'
import { createCustomAgentTransferPackage, isCustomAgentVisibleInWorkspace, parseCustomAgentTransferPackage, readCustomAgentConfig, writeCustomAgentConfig } from '@shared/custom-agent'
import { randomBuiltInAgentAvatarUrl } from '@shared/agent-avatars'
import type { AppState } from '@shared/types'
import { executorWsService } from '../../control-plane/executor-ws-service'
import { agentService } from '../../integrations/agent/service'
import { isWorkspaceMember } from '../../repositories/workspace'
import { streamAgentAvatar, uploadAgentAvatar } from '../../services/avatar-storage'
import { cleanupAgentWorkdirRuntime,
  ensureAgentWorkdir,
  getAgentWorkdirSummary,
  listAgentWorkdirFiles,
  readAgentWorkdirFileContent,
  removeAgentWorkdirFile,
  resolveAgentWorkdirFile,
  touchAgentWorkdirSession,
} from '../../services/agent-workdir-service'
import { ensureAgentMindFiles, readAgentMindFile, readAgentMindFiles, writeAgentMindFile } from '../../services/agent-mind-files'
import { triggerHeartbeatScheduleNow, validateHeartbeatCronFrequency } from '../../services/agent-heartbeat-scheduler'
import { validateCron } from '../../services/automation-cron'
import { loadState } from '../../storage/app-state-store'
import { agentSchema, agentUpdateSchema, aiChatSchema, cronSchema, cronUpdateSchema, getUserIdFromHeader, validateHeartbeatPayload, withState } from '../shared'
import {
  createCustomAgentChatSession,
  ensureMainChatState,
  loadMainChatModelOptions,
  removeMainChatSessionsForDeletedAgent,
  streamMainChatResponse,
  validateMainChatModel,
} from '../project-main-chat'
import { resolveNewCustomAgentChatSessionDefaults } from '../project-main-chat-session'
import {
  findConflictingAgentName,
  normalizeAgentMutationPayload,
  resolveImportedAgentName,
  syncAgentChannelBindings,
} from './helpers'
import { listVisibleExecutorsForUser } from '../../control-plane/collaboration'
import {
  listAgentInboxAttempts,
  listAgentInboxGroupItems,
  listAgentInboxGroups,
} from '../../services/agent-inbox-service'
import { createInboxStream } from '../../services/inbox-stream'
import { INBOX_QUERY_SCOPES, type InboxQueryScope } from '@shared/inbox'
import { getCommercialGate } from '../../services/gate/commercial-gate'

/** 未识别的 section 回落到 action，保持「打开就看待办」的默认。 */
const readAgentInboxScope = (value?: string): InboxQueryScope => (
  INBOX_QUERY_SCOPES.includes(value as InboxQueryScope) ? value as InboxQueryScope : 'action'
)

export const registerAgentSystemRoutes = (app: Hono, requireAuth: MiddlewareHandler) => {
  const mainChatSessionCreateSchema = z.object({
    title: z.string().trim().optional(),
    executorId: z.string().trim().optional(),
    executionModel: z.string().trim().optional(),
    workspaceId: z.string().trim().optional(),
  })

  const resolveVisibleExecutor = (userId: string, executorId?: string | null) => {
    const normalizedExecutorId = executorId?.trim()
    if (!normalizedExecutorId) {
      return null
    }

    return listVisibleExecutorsForUser(userId).find((executor) => executor.executorId === normalizedExecutorId) ?? null
  }

  const getRequestedExecutor = (
    userId: string,
    executorId?: string | null,
    options?: { fallbackToLocalWhenUnavailable?: boolean },
  ) => {
    const executor = resolveVisibleExecutor(userId, executorId)
    const fallbackToLocalWhenUnavailable = options?.fallbackToLocalWhenUnavailable === true
    if (!executorId?.trim()) {
      return { ok: true as const, executor: null }
    }

    if (!executor) {
      if (fallbackToLocalWhenUnavailable) {
        return {
          ok: true as const,
          executor: null,
          message: '当前执行节点不可见，已自动切换到默认 Agent 工作目录视图。',
        }
      }
      return { ok: false as const, message: '当前执行节点不可见或无权限访问。' }
    }

    if (executor.status !== 'online') {
      if (fallbackToLocalWhenUnavailable) {
        return {
          ok: true as const,
          executor: null,
          message: '当前执行节点未在线，已自动切换到默认 Agent 工作目录视图。',
        }
      }
      return { ok: false as const, message: '当前执行节点未在线，暂时无法访问它的 Agent 工作目录。' }
    }

    return { ok: true as const, executor }
  }

  const getOwnedAgent = (userId: string, agentId: string) => {
    const agent = agentService.getAgent(agentId)
    return agent?.ownerUserId === userId ? agent : null
  }

  /** 记忆入口鉴权：owner 或「共享 workspace 成员」（跟随 Agent 可见性，私有 Agent 仅 owner） */
  const resolveAgentMindAccess = async (userId: string, agentId: string) => {
    const agent = agentService.getAgent(agentId)
    if (!agent) return null
    if (agent.ownerUserId === userId) return agent
    const config = readCustomAgentConfig(agent.config)
    if (config.visibility !== 'workspace') return null
    for (const workspaceId of config.workspaceIds) {
      if (await isWorkspaceMember(workspaceId, userId)) return agent
    }
    return null
  }

  const ownsAgentCron = (userId: string, cronId: string) => {
    return agentService.getUserAgents(userId)
      .some((agent) => agentService.getAgentCrons(agent.id).some((cron) => cron.id === cronId))
  }

  const findOwnedAgentCron = (userId: string, cronId: string) => {
    for (const agent of agentService.getUserAgents(userId)) {
      const cron = agentService.getAgentCrons(agent.id).find((item) => item.id === cronId)
      if (cron) return cron
    }
    return null
  }

  app.get('/api/agents', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    const workspaceId = c.req.query('workspaceId')?.trim() || ''
    const agents = agentService.getUserAgents(userId)
    if (!workspaceId) {
      return c.json({ agents })
    }

    const visibleAgents = agents.filter((agent) => isCustomAgentVisibleInWorkspace(
      readCustomAgentConfig(agent.config),
      {
        userId,
        ownerUserId: agent.ownerUserId,
        workspaceId,
      },
    ))
    return c.json({ agents: visibleAgents })
  })

  app.post('/api/agents', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    const rawPayload = await c.req.json()
    const payload = agentSchema.parse(rawPayload)
    const workspaceId = typeof rawPayload.workspaceId === 'string' ? rawPayload.workspaceId.trim() : ''
    const normalized = normalizeAgentMutationPayload(payload)
    // 默认头像：未传 avatarUrl 时随机分配一个内置头像（落库稳定，不再显示首字母渐变占位）
    const normalizedAvatarConfig = readCustomAgentConfig(normalized.config)
    if (!normalizedAvatarConfig.avatarUrl.trim()) {
      normalized.config = writeCustomAgentConfig(normalized.config, {
        ...normalizedAvatarConfig,
        avatarUrl: randomBuiltInAgentAvatarUrl(),
      })
    }
    if (workspaceId) {
      const config = readCustomAgentConfig(normalized.config)
      if (!config.workspaceIds.includes(workspaceId)) {
        normalized.config = writeCustomAgentConfig(normalized.config, {
          ...config,
          workspaceIds: [...config.workspaceIds, workspaceId],
        })
      }
    }
    const conflicting = findConflictingAgentName(normalized.name, userId)
    if (conflicting) {
      return c.json({ message: 'Agent 名称已存在，请换一个。' }, 409)
    }

    const agent = agentService.registerAgent(normalized.name, normalized.type, normalized.endpoint, normalized.config, userId)
    ensureAgentWorkdir(agent.id)
    // Agent 灵魂与个人记忆文件：在云盘个人域落 mind/ 模板（soul.md + memory/USER.md + MEMORY.md + MEMORY_INDEX.md）
    await ensureAgentMindFiles({
      agentId: agent.id,
      agentName: agent.name,
      userId,
      config: agent.config,
    }).catch((error) => {
      // 记忆文件初始化失败不阻断 Agent 创建（Agent 仍可用，后续可在设置页补建）
      console.error('[agent-mind] 初始化 Agent 记忆文件失败：', error)
    })
    if (agent.type.trim().toLowerCase() === 'custom') {
      const profile = readCustomAgentConfig(agent.config)
      const syncStatus = await syncAgentChannelBindings({
        requestUrl: c.req.url,
        agentId: agent.id,
        workspaceId: workspaceId || undefined,
        profile,
      })
      return c.json({
        agent,
        syncStatus,
      })
    }

    return c.json({ agent })
  })

  app.get('/api/agents/:id', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    const id = c.req.param('id')
    const agent = getOwnedAgent(userId, id)
    if (!agent) {
      return c.json({ message: 'Agent not found' }, 404)
    }
    return c.json({ agent })
  })

  // Agent 灵魂与个人记忆（云盘文件）读取
  app.get('/api/agents/:id/mind', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    const id = c.req.param('id')
    const agent = await resolveAgentMindAccess(userId, id)
    if (!agent) {
      return c.json({ message: 'Agent not found' }, 404)
    }
    // 文件在 owner 个人域，始终以 owner 身份读
    const ownerUserId = agent.ownerUserId ?? userId
    const requestedFile = c.req.query('file')
    if (requestedFile) {
      if (requestedFile !== 'soul' && requestedFile !== 'user' && requestedFile !== 'memory') {
        return c.json({ message: 'file 必须是 soul / user / memory。' }, 400)
      }
      const mindFile = await readAgentMindFile({ userId: ownerUserId, agentId: id, file: requestedFile })
      return c.json({ mind: { [requestedFile]: mindFile } })
    }
    const mind = await readAgentMindFiles({ userId: ownerUserId, agentId: id })
    return c.json({ mind })
  })

  // Agent 灵魂与个人记忆（云盘文件）写回
  app.put('/api/agents/:id/mind', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    const id = c.req.param('id')
    const agent = await resolveAgentMindAccess(userId, id)
    if (!agent) {
      return c.json({ message: 'Agent not found' }, 404)
    }
    const payload = await c.req.json() as { file: string; content: string }
    const file = typeof payload?.file === 'string' ? payload.file : ''
    const content = typeof payload?.content === 'string' ? payload.content : ''
    if (!file || !(file === 'soul' || file === 'user' || file === 'memory')) {
      return c.json({ message: 'file 必须是 soul / user / memory。' }, 400)
    }
    const ownerUserId = agent.ownerUserId ?? userId
    const mind = await readAgentMindFiles({ userId: ownerUserId, agentId: id })
    const fileId = file === 'soul' ? mind.soul.fileId : file === 'user' ? mind.user.fileId : mind.memory.fileId
    if (!fileId) {
      return c.json({ message: '记忆文件尚未初始化。' }, 404)
    }
    await writeAgentMindFile({ ownerUserId, actorUserId: userId, fileId, content })
    return c.json({ ok: true, message: '记忆已保存。' })
  })

  app.get('/api/agents/:id/workdir', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    const agentId = c.req.param('id')
    const agent = getOwnedAgent(userId, agentId)
    if (!agent) {
      return c.json({ message: 'Agent not found' }, 404)
    }

    const workspaceId = c.req.query('workspaceId')?.trim() || undefined
    const executorAccess = getRequestedExecutor(userId, c.req.query('executorId'), { fallbackToLocalWhenUnavailable: true })
    if (!executorAccess.ok) {
      return c.json({ message: executorAccess.message }, 403)
    }

    if (executorAccess.executor) {
      const result = await executorWsService.requestAgentWorkdir(executorAccess.executor.executorId, {
        agentId,
        action: 'summary',
        workspaceId,
      })
      if (!result.ok) {
        return c.json({ message: result.message || '加载 Agent 工作目录失败。' }, 400)
      }
      return c.json({ workdir: result.workdir, message: executorAccess.message })
    }

    return c.json({ workdir: getAgentWorkdirSummary(agentId, workspaceId), message: executorAccess.message })
  })

  app.post('/api/agents/:id/workdir/ensure', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    const agentId = c.req.param('id')
    const agent = getOwnedAgent(userId, agentId)
    if (!agent) {
      return c.json({ message: 'Agent not found' }, 404)
    }

    const workspaceId = c.req.query('workspaceId')?.trim() || undefined
    const executorAccess = getRequestedExecutor(userId, c.req.query('executorId'), { fallbackToLocalWhenUnavailable: true })
    if (!executorAccess.ok) {
      return c.json({ message: executorAccess.message }, 403)
    }

    if (executorAccess.executor) {
      const result = await executorWsService.requestAgentWorkdir(executorAccess.executor.executorId, {
        agentId,
        action: 'ensure',
        workspaceId,
      })
      if (!result.ok) {
        return c.json({ message: result.message || 'Agent 工作目录初始化失败。' }, 400)
      }
      return c.json({
        workdir: result.workdir,
        files: result.files,
        message: executorAccess.message || result.message,
      })
    }

    const result = ensureAgentWorkdir(agentId, workspaceId)
    return c.json({
      workdir: result.summary,
      files: result.files,
      message: executorAccess.message || 'Agent 工作目录已初始化。',
    })
  })

  app.post('/api/agents/:id/workdir/rescan', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    const agentId = c.req.param('id')
    const agent = getOwnedAgent(userId, agentId)
    if (!agent) {
      return c.json({ message: 'Agent not found' }, 404)
    }

    const workspaceId = c.req.query('workspaceId')?.trim() || undefined
    const executorAccess = getRequestedExecutor(userId, c.req.query('executorId'), { fallbackToLocalWhenUnavailable: true })
    if (!executorAccess.ok) {
      return c.json({ message: executorAccess.message }, 403)
    }

    if (executorAccess.executor) {
      const result = await executorWsService.requestAgentWorkdir(executorAccess.executor.executorId, {
        agentId,
        action: 'rescan',
        workspaceId,
      })
      if (!result.ok) {
        return c.json({ message: result.message || 'Agent 工作目录索引刷新失败。' }, 400)
      }
      return c.json({
        workdir: result.workdir,
        files: result.files,
        message: executorAccess.message || result.message,
      })
    }

    const result = listAgentWorkdirFiles(agentId, true, workspaceId)
    return c.json({
      workdir: result.summary,
      files: result.files,
      message: executorAccess.message || 'Agent 工作目录索引已刷新。',
    })
  })

  app.get('/api/agents/:id/workdir/files', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    const agentId = c.req.param('id')
    const refresh = c.req.query('refresh') === '1'
    const agent = getOwnedAgent(userId, agentId)
    if (!agent) {
      return c.json({ message: 'Agent not found' }, 404)
    }

    const workspaceId = c.req.query('workspaceId')?.trim() || undefined
    const executorAccess = getRequestedExecutor(userId, c.req.query('executorId'), { fallbackToLocalWhenUnavailable: true })
    if (!executorAccess.ok) {
      return c.json({ message: executorAccess.message }, 403)
    }

    if (executorAccess.executor) {
      const result = await executorWsService.requestAgentWorkdir(executorAccess.executor.executorId, {
        agentId,
        action: 'list',
        refresh,
        workspaceId,
      })
      if (!result.ok) {
        return c.json({ message: result.message || '加载 Agent 工作目录文件失败。' }, 400)
      }
      return c.json({ workdir: result.workdir, files: result.files, message: executorAccess.message })
    }

    const result = listAgentWorkdirFiles(agentId, refresh, workspaceId)
    return c.json({ workdir: result.summary, files: result.files, message: executorAccess.message })
  })

  app.delete('/api/agents/:id/workdir/files', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    const agentId = c.req.param('id')
    const agent = getOwnedAgent(userId, agentId)
    if (!agent) {
      return c.json({ message: 'Agent not found' }, 404)
    }

    const workspaceId = c.req.query('workspaceId')?.trim() || undefined
    const executorAccess = getRequestedExecutor(userId, c.req.query('executorId'), { fallbackToLocalWhenUnavailable: true })
    if (!executorAccess.ok) {
      return c.json({ message: executorAccess.message }, 403)
    }

    try {
      if (executorAccess.executor) {
        const result = await executorWsService.requestAgentWorkdir(executorAccess.executor.executorId, {
          agentId,
          action: 'delete',
          relativePath: c.req.query('path') || '',
          workspaceId,
        })
        if (!result.ok) {
          return c.json({ message: result.message || '文件删除失败。' }, 400)
        }
        return c.json({
          workdir: result.workdir,
          files: result.files,
          message: executorAccess.message || result.message,
        })
      }

      const result = removeAgentWorkdirFile(agentId, c.req.query('path') || '', workspaceId)
      return c.json({
        workdir: result.summary,
        files: result.files,
        message: executorAccess.message || '文件已删除。',
      })
    } catch (error) {
      return c.json({ message: error instanceof Error ? error.message : '文件删除失败。' }, 400)
    }
  })

  app.post('/api/agents/:id/workdir/cleanup', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    const agentId = c.req.param('id')
    const agent = getOwnedAgent(userId, agentId)
    if (!agent) {
      return c.json({ message: 'Agent not found' }, 404)
    }

    const workspaceId = c.req.query('workspaceId')?.trim() || undefined
    const executorAccess = getRequestedExecutor(userId, c.req.query('executorId'), { fallbackToLocalWhenUnavailable: true })
    if (!executorAccess.ok) {
      return c.json({ message: executorAccess.message }, 403)
    }

    if (executorAccess.executor) {
      const result = await executorWsService.requestAgentWorkdir(executorAccess.executor.executorId, {
        agentId,
        action: 'cleanup',
        workspaceId,
      })
      if (!result.ok) {
        return c.json({ message: result.message || '清理 Agent 工作目录失败。' }, 400)
      }
      return c.json({ workdir: result.workdir, message: executorAccess.message || result.message })
    }

    return c.json({
      workdir: cleanupAgentWorkdirRuntime(agentId, workspaceId),
      message: executorAccess.message || '已清理 Agent 系统临时目录。',
    })
  })

  app.get('/api/agents/:id/workdir/download', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    const agentId = c.req.param('id')
    const agent = getOwnedAgent(userId, agentId)
    if (!agent) {
      return c.json({ message: 'Agent not found' }, 404)
    }

    const workspaceId = c.req.query('workspaceId')?.trim() || undefined
    try {
      const executorAccess = getRequestedExecutor(userId, c.req.query('executorId'), { fallbackToLocalWhenUnavailable: true })
      if (!executorAccess.ok) {
        return c.json({ message: executorAccess.message }, 403)
      }

      if (executorAccess.executor) {
        const result = await executorWsService.requestAgentWorkdirDownload(executorAccess.executor.executorId, {
          agentId,
          relativePath: c.req.query('path') || '',
          workspaceId,
        })
        if (!result.ok || !result.contentBase64) {
          return c.json({ message: result.message || '文件下载失败。' }, 400)
        }
        c.header('Content-Type', 'application/octet-stream')
        c.header('Content-Disposition', `attachment; filename="${result.filename || basename(result.relativePath)}"`)
        return c.body(Buffer.from(result.contentBase64, 'base64'))
      }

      const resolved = resolveAgentWorkdirFile(agentId, c.req.query('path') || '', workspaceId)
      c.header('Content-Type', 'application/octet-stream')
      c.header('Content-Disposition', `attachment; filename="${basename(resolved.relativePath)}"`)
      return c.body(readFileSync(resolved.absolutePath))
    } catch (error) {
      return c.json({ message: error instanceof Error ? error.message : '文件下载失败。' }, 400)
    }
  })

  app.get('/api/agents/:id/workdir/read', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    const agentId = c.req.param('id')
    const agent = getOwnedAgent(userId, agentId)
    if (!agent) {
      return c.json({ message: 'Agent not found' }, 404)
    }

    const relativePath = c.req.query('path') || ''
    const workspaceId = c.req.query('workspaceId')?.trim() || undefined

    try {
      const executorAccess = getRequestedExecutor(userId, c.req.query('executorId'), { fallbackToLocalWhenUnavailable: true })
      if (!executorAccess.ok) {
        return c.json({ message: executorAccess.message }, 403)
      }

      if (executorAccess.executor) {
        const result = await executorWsService.requestAgentWorkdirRead(executorAccess.executor.executorId, {
          agentId,
          relativePath,
          workspaceId,
        })
        return c.json(result, result.ok ? 200 : 400)
      }

      const result = readAgentWorkdirFileContent(agentId, relativePath, workspaceId)
      return c.json(result, result.ok ? 200 : 400)
    } catch (error) {
      return c.json({ message: error instanceof Error ? error.message : '文件预览失败。' }, 400)
    }
  })

  app.post('/api/agents/:id/avatar', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    const id = c.req.param('id')
    const currentAgent = getOwnedAgent(userId, id)
    if (!currentAgent) {
      return c.json({ message: 'Agent not found' }, 404)
    }

    const form = await c.req.formData()
    const file = form.get('file')
    if (!(file instanceof File)) {
      return c.json({ message: '请先选择图片文件。' }, 400)
    }

    try {
      const upload = await uploadAgentAvatar(id, file)
      const profile = readCustomAgentConfig(currentAgent.config)
      const config = writeCustomAgentConfig(currentAgent.config, {
        ...profile,
        avatarUrl: upload.avatarUrl,
      })
      const agent = agentService.updateAgent(id, {
        name: currentAgent.name,
        type: currentAgent.type,
        endpoint: currentAgent.endpoint,
        config,
        ownerUserId: currentAgent.ownerUserId || userId,
      })
      if (!agent) {
        return c.json({ message: 'Agent not found' }, 404)
      }

      return c.json({ agent, avatarUrl: upload.avatarUrl, message: 'Agent 头像已上传。' })
    } catch (error) {
      return c.json({ message: error instanceof Error ? error.message : 'Agent 头像上传失败' }, 400)
    }
  })

  app.get('/api/agents/:id/avatar/:filename', async (c) => {
    const id = c.req.param('id')
    const filename = c.req.param('filename')

    try {
      return await streamAgentAvatar(id, filename)
    } catch (error) {
      return c.json({ message: error instanceof Error ? error.message : 'Agent 头像读取失败' }, 503)
    }
  })

  app.get('/api/agents/:id/export', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    const id = c.req.param('id')
    const agent = getOwnedAgent(userId, id)
    if (!agent) {
      return c.json({ message: 'Agent not found' }, 404)
    }

    const payload = createCustomAgentTransferPackage({
      name: agent.name,
      endpoint: agent.endpoint,
      config: agent.config,
    })

    return c.json({ package: payload })
  })

  app.post('/api/agents/import', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    const payload = z.object({
      package: z.unknown(),
    }).parse(await c.req.json())

    const portable = parseCustomAgentTransferPackage(payload.package)
    const importedName = resolveImportedAgentName(portable.agent.name, userId)
    const agent = agentService.registerAgent(
      importedName,
      'custom',
      portable.agent.endpoint,
      writeCustomAgentConfig({}, portable.agent.config),
      userId,
    )

    return c.json({
      agent,
      imported: {
        originalName: portable.agent.name,
        importedName,
        renamed: importedName !== portable.agent.name,
      },
    })
  })

  app.put('/api/agents/:id', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    const id = c.req.param('id')
    const payload = agentUpdateSchema.parse(await c.req.json())
    const currentAgent = getOwnedAgent(userId, id)
    if (!currentAgent) {
      return c.json({ message: 'Agent not found' }, 404)
    }

    const normalized = normalizeAgentMutationPayload(payload)
    const conflicting = findConflictingAgentName(normalized.name, userId, id)
    if (conflicting) {
      return c.json({ message: 'Agent 名称已存在，请换一个。' }, 409)
    }

    const agent = agentService.updateAgent(id, {
      name: normalized.name,
      type: normalized.type,
      endpoint: normalized.endpoint,
      config: normalized.config,
      ownerUserId: currentAgent.ownerUserId || userId,
    })
    if (!agent) {
      return c.json({ message: 'Agent not found' }, 404)
    }

    if (agent.type.trim().toLowerCase() === 'custom') {
      const profile = readCustomAgentConfig(agent.config)
      const syncStatus = await syncAgentChannelBindings({
        requestUrl: c.req.url,
        agentId: agent.id,
        workspaceId: readCustomAgentConfig(agent.config).workspaceIds[0],
        profile,
        previousProfile: readCustomAgentConfig(currentAgent.config),
      })
      return c.json({
        agent,
        syncStatus,
      })
    }

    return c.json({ agent })
  })

  app.delete('/api/agents/:id', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    const id = c.req.param('id')
    const agent = getOwnedAgent(userId, id)
    if (!agent) {
      return c.json({ message: 'Agent not found' }, 404)
    }
    const deleted = agentService.deleteAgent(id)
    if (!deleted) {
      return c.json({ message: 'Agent not found' }, 404)
    }

    const nextState = removeMainChatSessionsForDeletedAgent(loadState(), id, userId)
    await withState(nextState, undefined, userId, { includeResources: false })

    return c.json({ ok: true })
  })

  app.post('/api/agents/:id/heartbeat', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    const id = c.req.param('id')
    if (!getOwnedAgent(userId, id)) {
      return c.json({ message: 'Agent not found' }, 404)
    }
    const payload = c.req.json().then((body) => body as { status?: 'online' | 'error'; metrics?: Record<string, unknown> })
    const { status, metrics } = await payload
    agentService.agentHeartbeat(id, status || 'online', metrics || {})
    return c.json({ ok: true })
  })

  app.get('/api/agents/:id/inbox/groups', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    const id = c.req.param('id')
    if (!getOwnedAgent(userId, id)) return c.json({ message: 'Agent not found' }, 404)
    return c.json(await listAgentInboxGroups({
      agentId: id,
      section: readAgentInboxScope(c.req.query('section')),
      cursor: c.req.query('cursor') || undefined,
      limit: Math.min(Math.max(Number(c.req.query('limit')) || 40, 1), 100),
      workspaceId: c.req.query('workspaceId')?.trim() || undefined,
    }))
  })

  app.get('/api/agents/:id/inbox/groups/:groupKey/items', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    const id = c.req.param('id')
    if (!getOwnedAgent(userId, id)) return c.json({ message: 'Agent not found' }, 404)
    return c.json(await listAgentInboxGroupItems({
      agentId: id,
      groupKey: decodeURIComponent(c.req.param('groupKey')),
      section: readAgentInboxScope(c.req.query('section')),
      cursor: c.req.query('cursor') || undefined,
      limit: Math.min(Math.max(Number(c.req.query('limit')) || 100, 1), 200),
      workspaceId: c.req.query('workspaceId')?.trim() || undefined,
    }))
  })

  app.get('/api/agents/:id/inbox/items/:itemId/attempts', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    const id = c.req.param('id')
    if (!getOwnedAgent(userId, id)) return c.json({ message: 'Agent not found' }, 404)
    return c.json({ attempts: await listAgentInboxAttempts({ agentId: id, inboxItemId: c.req.param('itemId') }) })
  })

  app.get('/api/agents/:id/inbox/stream', requireAuth, (c) => {
    const userId = getUserIdFromHeader(c)!
    const id = c.req.param('id')
    if (!getOwnedAgent(userId, id)) return c.json({ message: 'Agent not found' }, 404)
    return new Response(createInboxStream(id, 'agent'), {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      },
    })
  })

  app.get('/api/agents/:id/tasks', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    const id = c.req.param('id')
    if (!getOwnedAgent(userId, id)) {
      return c.json({ message: 'Agent not found' }, 404)
    }
    const tasks = agentService.getAgentTasks(id)
    return c.json({ tasks })
  })

  app.post('/api/agents/:id/chat/sessions', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    const id = c.req.param('id')
    const payload = mainChatSessionCreateSchema.parse(await c.req.json().catch(() => ({})))
    const agent = getOwnedAgent(userId, id)
    if (!agent || agent.type.trim().toLowerCase() === 'main') {
      return c.json({ message: 'Agent 不存在。' }, 404)
    }

    const state = ensureMainChatState(loadState(), userId)
    const defaults = resolveNewCustomAgentChatSessionDefaults({
      sessions: state.mainChatSessions,
      selectedSessionId: state.selectedMainChatSessionId,
      customAgentId: id,
    })
    const agentDefaultExecutorId = (agent.config && typeof agent.config === 'object' && 'defaultExecutorId' in agent.config)
      ? (agent.config as { defaultExecutorId?: string }).defaultExecutorId?.trim() || ''
      : ''
    const requestedExecutorId = payload.executorId?.trim() || defaults.executorId || agentDefaultExecutorId
    if (requestedExecutorId && payload.executorId?.trim()) {
      const visibleExecutorIds = new Set(listVisibleExecutorsForUser(userId).map((executor) => executor.executorId))
      if (!visibleExecutorIds.has(requestedExecutorId)) {
        return c.json({ message: '执行节点不可见或无权限访问。' }, 403)
      }
    }

    const requestedExecutionModel = payload.executionModel?.trim() || defaults.executionModel
    const session = createCustomAgentChatSession(id, payload.title?.trim() || '新会话', {
      ...defaults,
      ownerUserId: userId,
      executorId: requestedExecutorId,
      executionModel: requestedExecutionModel,
      workspaceId: payload.workspaceId?.trim() || undefined,
    })
    const modelCheck = await validateMainChatModel(userId, session, requestedExecutionModel)
    if (!modelCheck.ok) {
      return c.json({ message: modelCheck.message }, modelCheck.status)
    }

    touchAgentWorkdirSession(id, session.id)
    const nextState: AppState = {
      ...state,
      mainChatSessions: [session, ...state.mainChatSessions],
      selectedMainChatSessionId: session.id,
    }

    return c.json(await withState(nextState, '已创建 Agent 会话。', userId))
  })

  app.delete('/api/agents/:id/chat/sessions/:sessionId', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    const id = c.req.param('id')
    const sessionId = c.req.param('sessionId')
    if (!getOwnedAgent(userId, id)) {
      return c.json({ message: 'Agent 不存在。' }, 404)
    }
    const state = ensureMainChatState(loadState(), userId)
    const session = state.mainChatSessions.find((item) => item.id === sessionId && item.customAgentId === id)
    if (!session) {
      return c.json({ message: '会话不存在。' }, 404)
    }

    const nextSessions = state.mainChatSessions.filter((item) => item.id !== sessionId)
    const nextSelectedId = sessionId === state.selectedMainChatSessionId
      ? nextSessions[0]?.id ?? ''
      : state.selectedMainChatSessionId
    const activeSession = nextSessions.find((item) => item.id === nextSelectedId) ?? nextSessions[0] ?? null
    const nextState: AppState = {
      ...state,
      mainChatSessions: nextSessions,
      selectedMainChatSessionId: nextSelectedId,
    }

    return c.json(await withState(nextState, '已删除 Agent 会话。', userId))
  })

  app.post('/api/agents/:id/chat/sessions/:sessionId/executor', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    const id = c.req.param('id')
    const sessionId = c.req.param('sessionId')
    const payload = z.object({ executorId: z.string().trim().optional() }).parse(await c.req.json().catch(() => ({ executorId: '' })))
    const executorId = payload.executorId?.trim() || undefined
    if (!getOwnedAgent(userId, id)) {
      return c.json({ message: 'Agent 不存在。' }, 404)
    }
    const state = ensureMainChatState(loadState(), userId)
    const session = state.mainChatSessions.find((item) => item.id === sessionId && item.customAgentId === id)
    if (!session) {
      return c.json({ message: '会话不存在。' }, 404)
    }

    if (executorId) {
      const visibleExecutorIds = new Set(listVisibleExecutorsForUser(userId).map((executor) => executor.executorId))
      if (!visibleExecutorIds.has(executorId)) {
        return c.json({ message: '执行节点不可见或无权限访问。' }, 403)
      }
    }

    const nextState: AppState = {
      ...state,
      mainChatSessions: state.mainChatSessions.map((item) => (
        item.id === sessionId
          ? {
              ...item,
              executorId,
              executionModel: item.executorId === executorId ? item.executionModel : undefined,
              updatedAt: new Date().toISOString(),
            }
          : item
      )),
    }

    return c.json(await withState(nextState, executorId ? 'Agent 会话执行节点已更新。' : '已清空 Agent 会话执行节点。', userId))
  })

  app.get('/api/agents/:id/chat/sessions/:sessionId/models', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    const id = c.req.param('id')
    const sessionId = c.req.param('sessionId')
    if (!getOwnedAgent(userId, id)) {
      return c.json({ ok: false, models: [], message: 'Agent 不存在。' }, 404)
    }
    const state = ensureMainChatState(loadState(), userId)
    const session = state.mainChatSessions.find((item) => item.id === sessionId && item.customAgentId === id)
    if (!session) {
      return c.json({ ok: false, models: [], message: '会话不存在。' }, 404)
    }

    const result = await loadMainChatModelOptions(userId, session)
    return c.json(result, result.ok ? 200 : result.status ?? 503)
  })

  app.post('/api/agents/:id/chat/sessions/:sessionId/model', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    const id = c.req.param('id')
    const sessionId = c.req.param('sessionId')
    const payload = z.object({ executionModel: z.string().trim().optional() }).parse(await c.req.json().catch(() => ({ executionModel: '' })))
    const requestedModel = payload.executionModel?.trim() || undefined
    if (!getOwnedAgent(userId, id)) {
      return c.json({ message: 'Agent 不存在。' }, 404)
    }
    const state = ensureMainChatState(loadState(), userId)
    const session = state.mainChatSessions.find((item) => item.id === sessionId && item.customAgentId === id)
    if (!session) {
      return c.json({ message: '会话不存在。' }, 404)
    }

    const modelCheck = await validateMainChatModel(userId, session, requestedModel)
    if (!modelCheck.ok) {
      return c.json({ message: modelCheck.message }, modelCheck.status)
    }

    const nextState: AppState = {
      ...state,
      mainChatSessions: state.mainChatSessions.map((item) => (
        item.id === sessionId
          ? { ...item, executionModel: requestedModel, updatedAt: new Date().toISOString() }
          : item
      )),
    }

    return c.json(await withState(nextState, requestedModel ? 'Agent 会话模型已更新。' : 'Agent 会话已切回默认模型。', userId))
  })

  app.post('/api/agents/:id/chat/sessions/:sessionId/stream', requireAuth, async (c) => {
    const id = c.req.param('id')
    const sessionId = c.req.param('sessionId')
    const payload = aiChatSchema.parse(await c.req.json())
    const userId = getUserIdFromHeader(c)!
    if (!getOwnedAgent(userId, id)) {
      return c.json({ message: 'Agent 不存在。' }, 404)
    }
    const state = ensureMainChatState(loadState(), userId)
    const session = state.mainChatSessions.find((item) => item.id === sessionId && item.customAgentId === id)
    if (!session) {
      return c.json({ message: '会话不存在。' }, 404)
    }
    const billingSession = await getCommercialGate().startFreeExecutionSession({
      userId,
      sessionKey: sessionId,
      kind: 'custom_agent_chat',
    })
    if (!billingSession.allowed || !billingSession.token) {
      return c.json({ message: billingSession.message }, 429)
    }

    const billingEventId = crypto.randomUUID()

    const stream = new ReadableStream({
      async start(controller) {
        const sendEvent = (data: Record<string, unknown>) => {
          controller.enqueue(`data: ${JSON.stringify(data)}\n\n`)
        }
        let completed = false

        sendEvent({ type: 'user', content: payload.message, clientMessageId: payload.clientMessageId })
        sendEvent({ type: 'status', content: 'Agent 正在分析上下文...', status: 'thinking', currentStep: 'Agent 正在分析上下文...' })

        try {
          const result = await streamMainChatResponse({
            state,
            userId,
            message: payload.message,
            attachments: payload.attachments,
            sessionId,
            clientMessageId: payload.clientMessageId,
            replyToMessageId: payload.replyToMessageId,
            signal: c.req.raw.signal,
            sendEvent,
          })
          completed = result.completed
        } catch (error) {
          sendEvent({ type: 'error', content: error instanceof Error ? error.message : '未知错误' })
        } finally {
          await getCommercialGate().finishFreeExecutionSession({
            token: billingSession.token!,
            completed,
            eventId: billingEventId,
          })
        }

        controller.close()
      },
    })

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      },
    })
  })

  app.get('/api/agents/:id/crons', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    const id = c.req.param('id')
    if (!getOwnedAgent(userId, id)) return c.json({ message: 'Agent not found' }, 404)
    const crons = agentService.getAgentCrons(id)
    return c.json({ crons })
  })

  app.post('/api/agents/:id/crons', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    const id = c.req.param('id')
    if (!getOwnedAgent(userId, id)) return c.json({ message: 'Agent not found' }, 404)
    const payload = cronSchema.parse(await c.req.json())
    const validationError = validateHeartbeatCronFrequency(payload.cronExpression)
    if (validationError) {
      return c.json({ message: `Invalid cron expression: ${validationError}` }, 422)
    }
    const heartbeatPayloadError = payload.payload ? validateHeartbeatPayload(payload.payload) : null
    if (heartbeatPayloadError) {
      return c.json({ message: `Invalid heartbeat payload: ${heartbeatPayloadError}` }, 422)
    }
    const cron = agentService.createAgentCron(id, payload.name, payload.cronExpression, payload.payload || {})
    return c.json({ cron })
  })

  app.post('/api/agents/crons/:cronId/trigger', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    const cronId = c.req.param('cronId')
    const cron = findOwnedAgentCron(userId, cronId)
    if (!cron) return c.json({ message: 'Cron not found' }, 404)
    const outcome = await triggerHeartbeatScheduleNow(cron)
    return c.json({ ok: true, ...outcome })
  })

  app.put('/api/agents/crons/:cronId', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    const cronId = c.req.param('cronId')
    if (!ownsAgentCron(userId, cronId)) return c.json({ message: 'Cron not found' }, 404)
    const payload = cronUpdateSchema.parse(await c.req.json())
    if (payload.cronExpression) {
      const validationError = validateHeartbeatCronFrequency(payload.cronExpression)
      if (validationError) {
        return c.json({ message: `Invalid cron expression: ${validationError}` }, 422)
      }
    }
    if (payload.payload) {
      const heartbeatPayloadError = validateHeartbeatPayload(payload.payload)
      if (heartbeatPayloadError) {
        return c.json({ message: `Invalid heartbeat payload: ${heartbeatPayloadError}` }, 422)
      }
    }
    const cron = agentService.updateAgentCron(cronId, payload)
    if (!cron) return c.json({ message: 'Cron not found' }, 404)
    return c.json({ cron })
  })

  app.post('/api/agents/crons/:cronId/toggle', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    const cronId = c.req.param('cronId')
    if (!ownsAgentCron(userId, cronId)) return c.json({ message: 'Cron not found' }, 404)
    const payload = z.object({ enabled: z.boolean() }).parse(await c.req.json())
    agentService.toggleAgentCron(cronId, payload.enabled)
    return c.json({ ok: true })
  })

  app.delete('/api/agents/crons/:cronId', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    const cronId = c.req.param('cronId')
    if (!ownsAgentCron(userId, cronId)) return c.json({ message: 'Cron not found' }, 404)
    agentService.deleteAgentCron(cronId)
    return c.json({ ok: true })
  })

  app.get('/api/agents/:id/heartbeats', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    const id = c.req.param('id')
    if (!getOwnedAgent(userId, id)) return c.json({ message: 'Agent not found' }, 404)
    const heartbeats = agentService.getAgentHeartbeats(id)
    return c.json({ heartbeats })
  })
}
