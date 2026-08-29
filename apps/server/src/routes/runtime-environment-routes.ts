/**
 * [INPUT]: Authenticated project/workspace runtime-environment reads and updates.
 * [OUTPUT]: Persisted configs plus immediate env-file materialization results when requested.
 * [POS]: HTTP boundary for project and workspace runtime environment configuration.
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */

import type { Hono, MiddlewareHandler } from 'hono'
import { z } from 'zod'
import type { RuntimeEnvironmentConfig } from '@shared/runtime-environment'
import { resolveWorkspaceSessionExecutorId } from '@shared/task-workspace'
import { ProjectRuntimeEnvironmentReadError, detectProjectRuntimeEnvironmentFile } from '../control-plane/project-environment-service'
import { executorRegistry } from '../control-plane/executor-registry'
import { loadState } from '../storage/app-state-store'
import { getWorkspace } from '../storage/distributed-task-store'
import {
  materializeProjectRuntimeEnvironmentFile,
  materializeWorkspaceRuntimeEnvironmentFile,
  selectProjectRuntimeEnvironmentBinding,
} from '../services/runtime-environment-file-materialization'
import {
  getProjectRuntimeEnvironmentDetail,
  getWorkspaceRuntimeEnvironmentDetail,
  resolveWorkspaceRuntimeEnvironment,
  saveProjectRuntimeEnvironmentConfig,
  saveWorkspaceRuntimeEnvironmentConfig,
} from '../services/runtime-environment-service'
import {
  getWorkspaceSessionRecord,
  resolveEffectiveWorkspaceWorktreeSession,
  resolveWorkspaceSessionCwd,
} from './task-route-support'
import { getAuthorizedProject, getScopedState, getUserIdFromHeader, jsonError } from './shared'

const runtimeEnvironmentConfigSchema = z.object({
  mode: z.enum(['process-env', 'env-file']),
  fileName: z.string().trim().optional(),
  content: z.string(),
})

const runtimeEnvironmentPayloadSchema = z.object({
  config: runtimeEnvironmentConfigSchema.nullable().optional(),
  workspaceSessionId: z.string().trim().min(1).optional(),
})

export const registerRuntimeEnvironmentRoutes = (app: Hono, requireAuth: MiddlewareHandler) => {
  app.get('/api/projects/:id/runtime-env', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    const state = loadState()
    const projectResult = getAuthorizedProject(state, userId, c.req.param('id'))
    if (!projectResult.project) {
      return jsonError(c, projectResult.message, projectResult.status)
    }

    return c.json(await getProjectRuntimeEnvironmentDetail(projectResult.project.id))
  })

  app.put('/api/projects/:id/runtime-env', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    const state = loadState()
    const projectResult = getAuthorizedProject(state, userId, c.req.param('id'))
    if (!projectResult.project) {
      return jsonError(c, projectResult.message, projectResult.status)
    }

    const payload = runtimeEnvironmentPayloadSchema.parse(await c.req.json().catch(() => ({})))
    const project = projectResult.project
    const config = await saveProjectRuntimeEnvironmentConfig(
      project.id,
      payload.config as RuntimeEnvironmentConfig | null | undefined,
    )
    const detail = config ? await getProjectRuntimeEnvironmentDetail(project.id) : null
    let message = config ? '项目级环境变量已保存。' : '项目级环境变量已清空。'
    let fileWrite: { ok: boolean; fileName?: string; path?: string; message?: string } | undefined

    if (config?.mode === 'env-file') {
      fileWrite = await materializeProjectRuntimeEnvironmentFile(project, config)
      if (fileWrite?.ok) {
        message = `已保存，并写入项目文件 ${fileWrite.fileName || config.fileName || '.env'}。`
      } else if (fileWrite) {
        message = `已保存配置，但写入 ${config.fileName || '.env'} 失败：${fileWrite.message || '未知错误。'}`
      }
    }

    return c.json({
      config,
      summary: detail?.summary ?? null,
      message,
      fileWrite,
    })
  })

  app.post('/api/projects/:id/runtime-env/import', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    const state = loadState()
    const projectResult = getAuthorizedProject(state, userId, c.req.param('id'))
    if (!projectResult.project) {
      return jsonError(c, projectResult.message, projectResult.status)
    }

    const project = projectResult.project
    const activeBinding = selectProjectRuntimeEnvironmentBinding(project)
    let detected: { fileName: string; content: string } | null
    try {
      detected = await detectProjectRuntimeEnvironmentFile({
        rootPath: project.rootPath,
        executorId: activeBinding?.nodeId,
        repoPath: activeBinding?.pathHint || project.rootPath,
      })
    } catch (error) {
      if (error instanceof ProjectRuntimeEnvironmentReadError) {
        return c.json({ message: error.message }, 503)
      }
      throw error
    }
    if (!detected) {
      return c.json({ message: '没有检测到 `.env`。' }, 404)
    }

    const config = await saveProjectRuntimeEnvironmentConfig(project.id, {
      mode: 'process-env',
      fileName: detected.fileName,
      content: detected.content,
    })
    const detail = await getProjectRuntimeEnvironmentDetail(project.id)

    return c.json({
      config,
      summary: detail.summary,
      message: `已读取 ${detected.fileName} 并保存到项目环境变量。`,
    })
  })

  app.get('/api/workspaces/:id/runtime-env', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    const workspace = getWorkspace(c.req.param('id'))
    if (!workspace) {
      return c.json({ message: '工作区不存在。' }, 404)
    }

    const scopedState = getScopedState(loadState(), userId)
    const project = scopedState.projects.find((item) => item.id === workspace.projectId)
    if (!project) {
      return c.json({ message: '工作区不存在或无权访问。' }, 404)
    }

    return c.json(await getWorkspaceRuntimeEnvironmentDetail(workspace.id))
  })

  app.put('/api/workspaces/:id/runtime-env', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    const workspace = getWorkspace(c.req.param('id'))
    if (!workspace) {
      return c.json({ message: '工作区不存在。' }, 404)
    }

    const state = loadState()
    const scopedState = getScopedState(state, userId)
    const project = scopedState.projects.find((item) => item.id === workspace.projectId)
    if (!project) {
      return c.json({ message: '工作区不存在或无权访问。' }, 404)
    }

    const payload = runtimeEnvironmentPayloadSchema.parse(await c.req.json().catch(() => ({})))
    const workspaceSession = getWorkspaceSessionRecord(workspace.id, payload.workspaceSessionId)
    if (payload.workspaceSessionId && !workspaceSession) {
      return c.json({ message: '工作区会话不存在。' }, 404)
    }
    const config = await saveWorkspaceRuntimeEnvironmentConfig(
      workspace.id,
      payload.config as RuntimeEnvironmentConfig | null | undefined,
    )
    const resolvedEnvironment = await resolveWorkspaceRuntimeEnvironment(workspace.id)
    let message = config ? '工作区级环境变量已保存。' : '工作区级环境变量已清空。'
    let fileWrite: { ok: boolean; fileName?: string; path?: string; message?: string } | undefined

    if (resolvedEnvironment?.payload.mode === 'env-file') {
      const effectiveSession = workspaceSession
        ? resolveEffectiveWorkspaceWorktreeSession(workspaceSession.id, workspaceSession, workspace.executorNodeId)
        : null
      const executorId = effectiveSession
        ? resolveWorkspaceSessionExecutorId(effectiveSession, workspace.executorNodeId)
        : workspace.executorNodeId
      const executor = executorRegistry.listExecutorsWithPresence().find((item) => item.executorId === executorId)
      const cwd = effectiveSession
        ? resolveWorkspaceSessionCwd(executor?.workspaceRoot || state.config.workspaceRoot, project, effectiveSession, workspace)
        : undefined
      fileWrite = await materializeWorkspaceRuntimeEnvironmentFile({
        executorId,
        cwd,
        config: {
          mode: 'env-file',
          fileName: resolvedEnvironment.payload.fileName,
          content: resolvedEnvironment.payload.fileContent ?? '',
        },
      })
      if (fileWrite?.ok) {
        message = config
          ? `工作区级环境变量已保存，并写入当前工作区文件 ${fileWrite.fileName || '.env'}。`
          : `工作区级环境变量已清空，已按项目配置写入当前工作区文件 ${fileWrite.fileName || '.env'}。`
      } else if (fileWrite) {
        message = `${message.slice(0, -1)}，但写入 ${resolvedEnvironment.payload.fileName || '.env'} 失败：${fileWrite.message || '未知错误。'}`
      }
    }

    return c.json({
      config,
      summary: config ? (await getWorkspaceRuntimeEnvironmentDetail(workspace.id)).summary : null,
      message,
      fileWrite,
    })
  })
}
