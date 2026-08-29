/**
 * [INPUT]: Authenticated browser terminal WebSockets and executor routing context.
 * [OUTPUT]: Direct or clustered terminal relay connections with terminal lifecycle frames.
 * [POS]: Server WebSocket route boundary between the web terminal and executor control plane.
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */
import type { Hono } from 'hono'
import { WebSocket as NodeWebSocket, type RawData } from 'ws'
import { z } from 'zod'
import type { RuntimeEnvironmentExecutionPayload } from '@shared/runtime-environment'
import { clusterConfig } from '../cluster/config'
import { listVisibleExecutorsForUser } from '../control-plane/collaboration'
import { resolveExecutorRequestTarget } from '../control-plane/executor-node-routing'
import { executorRegistry } from '../control-plane/executor-registry'
import { executorWsService } from '../control-plane/executor-ws-service'
import { parseTokenUserId } from '../repositories/auth'
import { ensureClusterToken, getScopedState } from './shared'
import { resolveProjectRuntimeEnvironment, resolveWorkspaceRuntimeEnvironment } from '../services/runtime-environment-service'
import { remapManagedWorkspaceProjectPath } from '../services/workspace-repo-path'
import { loadState } from '../storage/app-state-store'
import { getWorkspace } from '../storage/distributed-task-store'

type TerminalRelayTarget = {
  relayUrl: string
}

export const resolveTerminalOpenFailure = (error: unknown, at = new Date().toISOString()) => {
  const message = error instanceof Error ? error.message : 'terminal open failed'
  const unavailable = message === '终端会话不存在。' || message === 'Terminal session does not exist.'
  return unavailable
    ? {
        frame: { type: 'unavailable' as const, message, at },
        closeCode: 1000,
        closeReason: 'terminal unavailable',
      }
    : {
        frame: { type: 'error' as const, message },
        closeCode: 1011,
        closeReason: 'terminal open failed',
      }
}

export const buildClusterTerminalRelayWebSocketUrl = (params: {
  relayUrl: string
  executorId: string
  cwd?: string
  projectId?: string
  workspaceId?: string
  terminalId: string
  terminalScope: 'workspace' | 'executor'
  terminalTitle?: string
}) => {
  const url = new URL(params.relayUrl)
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  url.pathname = `/api/internal/cluster/executors/${encodeURIComponent(params.executorId)}/terminal-relay/ws`
  url.search = ''
  url.hash = ''

  if (params.cwd?.trim()) {
    url.searchParams.set('cwd', params.cwd.trim())
  }
  if (params.projectId?.trim()) {
    url.searchParams.set('projectId', params.projectId.trim())
  }
  if (params.workspaceId?.trim()) {
    url.searchParams.set('workspaceId', params.workspaceId.trim())
  }
  if (params.terminalId.trim()) {
    url.searchParams.set('terminalId', params.terminalId.trim())
  }
  url.searchParams.set('terminalScope', params.terminalScope)
  if (params.terminalTitle?.trim()) {
    url.searchParams.set('terminalTitle', params.terminalTitle.trim())
  }

  return url.toString()
}

const parseClusterRelaySocketPayload = (data: unknown) => {
  if (typeof data === 'string') {
    return data
  }

  if (data instanceof Uint8Array) {
    return Buffer.from(data).toString('utf8')
  }

  if (data instanceof ArrayBuffer) {
    return Buffer.from(data).toString('utf8')
  }

  return Buffer.from(String(data)).toString('utf8')
}

export const registerExecutorWsRoute = (app: Hono, upgradeWebSocket: any) => {
  const terminalContextSchema = z.object({
    projectId: z.string().trim().optional(),
    workspaceId: z.string().trim().optional(),
    terminalId: z.string().trim().optional(),
    terminalScope: z.enum(['workspace', 'executor']).optional(),
    terminalTitle: z.string().trim().optional(),
  })

  const resolveRuntimeEnvironmentForTerminalContext = async (params: {
    projectId?: string
    workspaceId?: string
    scopedProjectLookup?: Set<string>
  }) => {
    const workspace = params.workspaceId
      ? getWorkspace(params.workspaceId)
      : null
    const state = loadState()
    const project = params.projectId
      ? state.projects.find((item) => item.id === params.projectId) ?? null
      : null

    if (params.projectId && !project) {
      return {
        ok: false as const,
        status: 404,
        message: '项目不存在。',
      }
    }

    if (params.workspaceId && !workspace) {
      return {
        ok: false as const,
        status: 404,
        message: '工作区不存在。',
      }
    }

    if (workspace && params.scopedProjectLookup && !params.scopedProjectLookup.has(workspace.projectId)) {
      return {
        ok: false as const,
        status: 404,
        message: '工作区不存在或无权访问。',
      }
    }

    if (project && params.scopedProjectLookup && !params.scopedProjectLookup.has(project.id)) {
      return {
        ok: false as const,
        status: 404,
        message: '项目不存在或无权访问。',
      }
    }

    if (workspace && project && workspace.projectId !== project.id) {
      return {
        ok: false as const,
        status: 400,
        message: '工作区与项目不匹配。',
      }
    }

    const runtimeEnvironment = workspace
      ? await resolveWorkspaceRuntimeEnvironment(workspace.id).then((result) => result?.payload).catch(() => undefined)
      : project
        ? await resolveProjectRuntimeEnvironment(project.id).then((result) => result?.payload).catch(() => undefined)
        : undefined

    return {
      ok: true as const,
      runtimeEnvironment,
    }
  }

  app.get(
    '/api/control-plane/executors/ws',
    async (c, next) => {
      const token = c.req.query('token') || c.req.header('Authorization')?.replace(/^Bearer\s+/, '')
      if (!token) {
        return c.json({ message: '缺少 executor token。' }, 401)
      }

      const executor = executorRegistry.authenticateExecutorToken(token)
      if (!executor) {
        return c.json({ message: 'executor token 无效。' }, 401)
      }

      ;(c as any).set('executorId', executor.executorId)
      await next()
    },
    upgradeWebSocket((c: any) => {
      const executorId = c.get('executorId') as string

      return {
        onOpen(_: Event, ws: any) {
          void executorWsService.onOpen(executorId, ws).catch((error) => {
            console.error('[executor-ws] failed to register executor socket', executorId, error)
            if (ws.readyState === ws.OPEN) {
              ws.close(1011, 'executor registration failed')
            }
          })
        },
        onMessage(event: MessageEvent<string>) {
          executorWsService.handleMessage(executorId, String(event.data))
        },
        onClose(_: CloseEvent, ws: any) {
          executorWsService.onClose(executorId, ws)
        },
      }
    }),
  )

  app.get(
    '/api/control-plane/executors/:executorId/terminal/ws',
    async (c, next) => {
      const token = c.req.query('token') || c.req.header('Authorization')?.replace(/^Bearer\s+/, '')
      const userId = token ? parseTokenUserId(token) : null
      if (!userId) {
        return c.json({ message: '未登录' }, 401)
      }

      const terminalContext = terminalContextSchema.parse({
        projectId: c.req.query('projectId') || undefined,
        workspaceId: c.req.query('workspaceId') || undefined,
        terminalId: c.req.query('terminalId') || undefined,
        terminalScope: c.req.query('terminalScope') || undefined,
        terminalTitle: c.req.query('terminalTitle') || undefined,
      })
      const executorId = c.req.param('executorId')
      const executor = listVisibleExecutorsForUser(userId).find((item) => item.executorId === executorId)
      if (!executor) {
        return c.json({ message: '执行器不存在或无权限访问。' }, 404)
      }

      const state = loadState()
      const scopedState = getScopedState(state, userId)
      const project = terminalContext.projectId
        ? scopedState.projects.find((item) => item.id === terminalContext.projectId) ?? null
        : null
      const workspace = terminalContext.workspaceId
        ? getWorkspace(terminalContext.workspaceId)
        : null
      if (terminalContext.projectId && !project) {
        return c.json({ message: '项目不存在或无权访问。' }, 404)
      }
      if (terminalContext.workspaceId && (!workspace || !scopedState.projects.some((item) => item.id === workspace.projectId))) {
        return c.json({ message: '工作区不存在或无权访问。' }, 404)
      }
      if (workspace && project && workspace.projectId !== project.id) {
        return c.json({ message: '工作区与项目不匹配。' }, 400)
      }
      if (terminalContext.terminalScope === 'workspace' && !terminalContext.workspaceId) {
        return c.json({ message: 'workspace scope 终端必须提供 workspaceId。' }, 400)
      }

      const runtimeEnvironment = workspace
        ? await resolveWorkspaceRuntimeEnvironment(workspace.id).then((result) => result?.payload).catch(() => undefined)
        : project
          ? await resolveProjectRuntimeEnvironment(project.id).then((result) => result?.payload).catch(() => undefined)
          : undefined
      const requestTarget = await resolveExecutorRequestTarget(executorId)
      const terminalRelayTarget = requestTarget.mode === 'remote'
        ? { relayUrl: requestTarget.relayUrl }
        : undefined

      ;(c as any).set('executorId', executorId)
      ;(c as any).set('cwd', remapManagedWorkspaceProjectPath(executor.workspaceRoot, c.req.query('cwd') || undefined))
      ;(c as any).set('projectId', terminalContext.projectId)
      ;(c as any).set('workspaceId', terminalContext.workspaceId)
      ;(c as any).set('terminalId', terminalContext.terminalId)
      ;(c as any).set('terminalScope', terminalContext.terminalScope)
      ;(c as any).set('terminalTitle', terminalContext.terminalTitle)
      ;(c as any).set('runtimeEnvironment', runtimeEnvironment)
      ;(c as any).set('terminalRelayTarget', terminalRelayTarget)
      await next()
    },
    upgradeWebSocket((c: any) => {
      const executorId = c.get('executorId') as string
      const cwd = c.get('cwd') as string | undefined
      const projectId = c.get('projectId') as string | undefined
      const workspaceId = c.get('workspaceId') as string | undefined
      const runtimeEnvironment = c.get('runtimeEnvironment') as RuntimeEnvironmentExecutionPayload | undefined
      const relayTarget = c.get('terminalRelayTarget') as TerminalRelayTarget | undefined
      const terminalId = (c.req.query('terminalId') || c.get('terminalId') || '').trim() || 'default'
      const terminalScope = ((c.req.query('terminalScope') || c.get('terminalScope')) as 'workspace' | 'executor' | undefined) || (workspaceId ? 'workspace' : 'executor')
      const terminalTitle = (c.req.query('terminalTitle') || c.get('terminalTitle') || '').trim() || undefined
      let clientId = ''
      let relaySocket: NodeWebSocket | null = null
      const pendingRelayMessages: string[] = []
      const flushRelayMessages = () => {
        if (!relaySocket || relaySocket.readyState !== NodeWebSocket.OPEN) {
          return
        }

        while (pendingRelayMessages.length > 0) {
          const next = pendingRelayMessages.shift()
          if (typeof next !== 'string') {
            break
          }
          relaySocket.send(next)
        }
      }

      return {
        async onOpen(_: Event, ws: any) {
          if (relayTarget) {
            const relayUrl = buildClusterTerminalRelayWebSocketUrl({
              relayUrl: relayTarget.relayUrl,
              executorId,
              cwd,
              projectId,
              workspaceId,
              terminalId,
              terminalScope,
              terminalTitle,
            })
            const nextRelaySocket = new NodeWebSocket(
              relayUrl,
              undefined,
              {
                headers: clusterConfig.sharedToken
                  ? {
                      'x-cluster-token': clusterConfig.sharedToken,
                    }
                  : undefined,
              },
            )
            relaySocket = nextRelaySocket
            nextRelaySocket.on('open', () => {
              flushRelayMessages()
            })
            nextRelaySocket.on('message', (data: RawData) => {
              if (ws.readyState !== ws.OPEN) {
                return
              }
              ws.send(parseClusterRelaySocketPayload(data))
            })
            nextRelaySocket.on('close', (code: number, reasonBuffer: Buffer) => {
              if (ws.readyState !== ws.OPEN) {
                return
              }
              const reason = Buffer.from(reasonBuffer).toString('utf8') || 'terminal relay closed'
              ws.close(code || 1011, reason)
            })
            nextRelaySocket.on('error', (error: Error) => {
              if (ws.readyState !== ws.OPEN) {
                return
              }
              ws.send(JSON.stringify({
                type: 'error',
                message: error instanceof Error ? error.message : 'terminal relay failed',
              }))
              ws.close(1011, 'terminal relay failed')
            })
            return
          }

          try {
            clientId = crypto.randomUUID()
            await executorWsService.attachTerminalSession({
              executorId,
              socket: ws,
              clientId,
              scope: terminalScope,
              terminalId,
              workspaceId,
              cwd,
              title: terminalTitle,
              ownerUserId: undefined,
              runtimeEnvironment,
            })
          } catch (error) {
            const failure = resolveTerminalOpenFailure(error)
            console.error('[terminal][server-route] failed to open terminal session', {
              executorId,
              cwd,
              projectId,
              workspaceId,
              terminalId,
              terminalScope,
              message: error instanceof Error ? error.message : 'unknown',
            })
            ws.send(JSON.stringify(failure.frame))
            ws.close(failure.closeCode, failure.closeReason)
          }
        },
        onMessage(event: MessageEvent<string>, ws: any) {
          if (relaySocket) {
            const payload = String(event.data)
            if (relaySocket.readyState === NodeWebSocket.OPEN) {
              relaySocket.send(payload)
            } else if (relaySocket.readyState === 0) {
              pendingRelayMessages.push(payload)
            } else {
              ws.send(JSON.stringify({ type: 'error', message: 'terminal relay unavailable' }))
            }
            return
          }

          try {
            const message = JSON.parse(String(event.data)) as { type: 'input' | 'resize' | 'close'; input?: string; cols?: number; rows?: number }
            if (message.type === 'input' && clientId) {
              executorWsService.sendTerminalSessionInput(clientId, message.input ?? '')
            }
            if (message.type === 'resize' && clientId) {
              executorWsService.resizeTerminalSession(clientId, message.cols ?? 0, message.rows ?? 0)
            }
            if (message.type === 'close') {
              void executorWsService.closeTerminalSession({
                executorId,
                scope: terminalScope,
                terminalId,
                workspaceId,
              }).catch((error) => {
                ws.send(JSON.stringify({ type: 'error', message: error instanceof Error ? error.message : 'terminal close failed' }))
              })
            }
          } catch {
            console.error('[terminal][server-route] invalid browser terminal ws message', { executorId, clientId, terminalId })
            ws.send(JSON.stringify({ type: 'error', message: 'invalid terminal message' }))
          }
        },
        onClose() {
          if (relaySocket) {
            if (relaySocket.readyState === NodeWebSocket.OPEN || relaySocket.readyState === 0) {
              relaySocket.close()
            }
            return
          }

          if (clientId) {
            executorWsService.detachTerminalSession(clientId)
          }
        },
      }
    }),
  )

  app.get(
    '/api/internal/cluster/executors/:executorId/terminal-relay/ws',
    async (c, next) => {
      if (!ensureClusterToken(c)) {
        return c.json({ message: '无权限访问集群内部终端 relay。' }, 401)
      }

      const terminalContext = terminalContextSchema.parse({
        projectId: c.req.query('projectId') || undefined,
        workspaceId: c.req.query('workspaceId') || undefined,
        terminalId: c.req.query('terminalId') || undefined,
        terminalScope: c.req.query('terminalScope') || undefined,
        terminalTitle: c.req.query('terminalTitle') || undefined,
      })
      const executorId = c.req.param('executorId')
      const requestTarget = await resolveExecutorRequestTarget(executorId)
      if (requestTarget.mode !== 'local') {
        return c.json({ message: '目标执行器不在当前节点，无法建立终端 relay。' }, 409)
      }

      if (terminalContext.terminalScope === 'workspace' && !terminalContext.workspaceId) {
        return c.json({ message: 'workspace scope 终端必须提供 workspaceId。' }, 400)
      }

      const runtimeEnvironmentResult = await resolveRuntimeEnvironmentForTerminalContext({
        projectId: terminalContext.projectId,
        workspaceId: terminalContext.workspaceId,
      })
      if (!runtimeEnvironmentResult.ok) {
        return c.json({ message: runtimeEnvironmentResult.message }, runtimeEnvironmentResult.status as 400 | 404)
      }

      ;(c as any).set('executorId', executorId)
      ;(c as any).set('cwd', c.req.query('cwd')?.trim() || undefined)
      ;(c as any).set('projectId', terminalContext.projectId)
      ;(c as any).set('workspaceId', terminalContext.workspaceId)
      ;(c as any).set('terminalId', terminalContext.terminalId)
      ;(c as any).set('terminalScope', terminalContext.terminalScope)
      ;(c as any).set('terminalTitle', terminalContext.terminalTitle)
      ;(c as any).set('runtimeEnvironment', runtimeEnvironmentResult.runtimeEnvironment)
      await next()
    },
    upgradeWebSocket((c: any) => {
      const executorId = c.get('executorId') as string
      const cwd = c.get('cwd') as string | undefined
      const workspaceId = c.get('workspaceId') as string | undefined
      const runtimeEnvironment = c.get('runtimeEnvironment') as RuntimeEnvironmentExecutionPayload | undefined
      const terminalId = (c.req.query('terminalId') || c.get('terminalId') || '').trim() || 'default'
      const terminalScope = ((c.req.query('terminalScope') || c.get('terminalScope')) as 'workspace' | 'executor' | undefined) || (workspaceId ? 'workspace' : 'executor')
      const terminalTitle = (c.req.query('terminalTitle') || c.get('terminalTitle') || '').trim() || undefined
      let clientId = ''

      return {
        async onOpen(_: Event, ws: any) {
          try {
            clientId = crypto.randomUUID()
            await executorWsService.attachTerminalSession({
              executorId,
              socket: ws,
              clientId,
              scope: terminalScope,
              terminalId,
              workspaceId,
              cwd,
              title: terminalTitle,
              ownerUserId: undefined,
              runtimeEnvironment,
            })
          } catch (error) {
            ws.send(JSON.stringify({ type: 'error', message: error instanceof Error ? error.message : 'terminal relay open failed' }))
            ws.close(1011, 'terminal relay open failed')
          }
        },
        onMessage(event: MessageEvent<string>, ws: any) {
          try {
            const message = JSON.parse(String(event.data)) as { type: 'input' | 'resize' | 'close'; input?: string; cols?: number; rows?: number }
            if (message.type === 'input' && clientId) {
              executorWsService.sendTerminalSessionInput(clientId, message.input ?? '')
            }
            if (message.type === 'resize' && clientId) {
              executorWsService.resizeTerminalSession(clientId, message.cols ?? 0, message.rows ?? 0)
            }
            if (message.type === 'close') {
              void executorWsService.closeTerminalSession({
                executorId,
                scope: terminalScope,
                terminalId,
                workspaceId,
              }).catch((error) => {
                ws.send(JSON.stringify({ type: 'error', message: error instanceof Error ? error.message : 'terminal relay close failed' }))
              })
            }
          } catch {
            ws.send(JSON.stringify({ type: 'error', message: 'invalid terminal relay message' }))
          }
        },
        onClose() {
          if (clientId) {
            executorWsService.detachTerminalSession(clientId)
          }
        },
      }
    }),
  )
}
