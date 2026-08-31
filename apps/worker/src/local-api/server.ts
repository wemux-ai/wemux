import { getEnv } from '@shared/env'
/**
 * [INPUT]: Worker configuration, runtime state, local HTTP/WebSocket requests, and daemon controls.
 * [OUTPUT]: The local worker console API, terminal bridge, and bound server lifecycle handle.
 * [POS]: Worker-local management boundary used by daemon and interactive console commands.
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */
import { existsSync, readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import http from 'node:http'
import type { Duplex } from 'node:stream'
import type { AddressInfo } from 'node:net'
import path from 'node:path'
import { WebSocket, WebSocketServer } from 'ws'
import {
  buildWorkerConsolePortCandidates,
  resolveWorkerConsolePortEnvironment,
} from '@shared/worker-console-ports'
import { materializeMcpServersForOpencode, VIBEMUX_MCP_TARGET } from '@shared/mcp'
import { loadWorkerConfig, resetWorkerConfig, saveWorkerConfig } from '../core/config'
import { getLocalWorkerConsoleListenHost, getLocalWorkerConsoleUrl } from '../core/local-console'
import { loadWorkerRuntimeConfig as loadStoredWorkerRuntimeConfig } from '../core/runtime-cloud-url'
import { listLocalAgentSessions, readLocalAgentSession, type AgentSessionSource } from './agent-sessions'
import { pairWithControlPlane } from '../control-plane'
import {
  buildSavedPairingCodeReuseMessage,
  hasSavedWorkerPairing,
  normalizeReusablePairingCode,
  shouldReuseSavedWorkerPairing,
} from '../control-plane/pairing-code-reuse'
import { buildConnectPairingFailureMessage } from '../control-plane/pairing-error'
import { getWorkerConsoleRoot, getWorkerVersion } from '../core/app-root'
import { disconnectWorkerControlPlane, getWorkerDoctor, reconnectWorkerControlPlane, requestWorkerSelfUpdateWhenIdle } from '../runtime/daemon'
import { getSafeWorkerRuntimeState, getWorkerRuntimeState, updateWorkerRuntimeState } from '../core/runtime-state'
import { checkForWorkerUpdate, getWorkerReleaseChannel } from '../update/worker-release'
import { ensureWorkerRuntimeReady } from '../core/runtime-bootstrap'
import {
  applyReadableLocalApiCorsHeaders,
  isAllowedLocalTerminalDirectOrigin,
  isReadableLocalApiCorsPath,
} from './cors'
import {
  attachLocalTerminalDirectSession,
  detachLocalTerminalDirectSession,
  resizeLocalTerminalDirectSession,
  writeLocalTerminalDirectSession,
} from '../runtime/local-terminal-direct'
import {
  handlePreviewMeshBridgeHttp,
  handlePreviewMeshBridgeUpgrade,
} from './preview-mesh-bridge'
import {
  dismissCodexDeviceLogin,
  getCodexDeviceStatus,
  listCodexAccounts,
  readSelectedCodexAuthContent,
  removeCodexAccount,
  selectCodexAccount,
  startCodexDeviceLogin,
} from '../runtime/codex-oauth'

const parseRequestUrl = (request: http.IncomingMessage) => new URL(request.url || '/', 'http://127.0.0.1')

const readJsonBody = async <T,>(request: http.IncomingMessage) => {
  const chunks: Buffer[] = []
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }

  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as T
}

const sendJson = (response: http.ServerResponse, statusCode: number, payload: unknown) => {
  response.statusCode = statusCode
  response.setHeader('Content-Type', 'application/json; charset=utf-8')
  response.setHeader('Cache-Control', 'no-store')
  response.end(`${JSON.stringify(payload)}\n`)
}

const sendFile = (response: http.ServerResponse, filePath: string) => {
  const extension = path.extname(filePath)
  const contentType = extension === '.css'
    ? 'text/css; charset=utf-8'
    : extension === '.js'
      ? 'application/javascript; charset=utf-8'
      : extension === '.map'
        ? 'application/json; charset=utf-8'
      : 'text/html; charset=utf-8'

  response.statusCode = 200
  response.setHeader('Content-Type', contentType)
  response.end(readFileSync(filePath))
}

const getConsoleFilePath = (pathname: string) => {
  const consoleRoot = getWorkerConsoleRoot()
  const targetPath = pathname === '/'
    ? path.join(consoleRoot, 'index.html')
    : path.join(consoleRoot, pathname.replace(/^\//, ''))

  if (!targetPath.startsWith(consoleRoot)) {
    return null
  }

  return targetPath
}

const serveConsoleAsset = (pathname: string, response: http.ServerResponse) => {
  const assetPath = getConsoleFilePath(pathname)
  if (!assetPath || !existsSync(assetPath)) {
    sendJson(response, 404, { message: 'not found' })
    return
  }

  sendFile(response, assetPath)
}

const buildHealthPayload = () => {
  const runtime = getWorkerRuntimeState()
  const config = runtime.config ?? loadWorkerConfig()

  return {
    ok: true,
    service: 'worker-local-server',
    daemonMode: runtime.daemonMode,
    paired: runtime.paired,
    connected: runtime.connected,
    executorId: runtime.executorId,
    runningTaskIds: runtime.runningTaskIds,
    queuedTaskIds: runtime.queuedTaskIds,
    localServerPort: config.localServerPort,
  }
}

const parseSessionSource = (value: string | null): AgentSessionSource | null => {
  if (value === 'claude' || value === 'opencode' || value === 'codex' || value === 'pi') {
    return value
  }

  return null
}

const loadWorkerLocalApiConfig = () => getWorkerRuntimeState().config ?? loadStoredWorkerRuntimeConfig()

const buildMcpPayload = () => {
  const config = loadWorkerLocalApiConfig()
  const servers = config.mcpServers ?? []
  const hasExecutorToken = Boolean(config.executorToken?.trim())

  const summaries = servers.map((server) => {
    const materialized = materializeMcpServersForOpencode([server], {
      cloudUrl: config.cloudUrl,
      executorToken: config.executorToken,
      actingUserId: server.target === VIBEMUX_MCP_TARGET && hasExecutorToken ? '__dynamic__' : undefined,
    })
    const key = Object.keys(materialized)[0]
    const definition = key ? materialized[key] as Record<string, unknown> : null
    const isBuiltin = server.target === VIBEMUX_MCP_TARGET

    return {
      id: server.id,
      name: server.name,
      target: server.target,
      transport: server.transport,
      capabilityMode: server.capabilityMode,
      enabled: server.enabled,
      materialized: Boolean(definition),
      kind: isBuiltin ? 'builtin' : server.transport === 'stdio' || server.target.startsWith('stdio://') ? 'stdio' : server.transport === 'http' || server.transport === 'sse' ? 'remote' : 'custom',
      endpoint: typeof definition?.url === 'string' ? definition.url : undefined,
      command: typeof definition?.command === 'string' ? definition.command : undefined,
      headerKeys: definition && typeof definition === 'object' && definition.headers && typeof definition.headers === 'object'
        ? Object.keys(definition.headers as Record<string, unknown>)
        : [],
      actingUserScoped: isBuiltin && hasExecutorToken,
    }
  })

  const enabledServers = summaries.filter((server) => server.enabled)
  const builtinServer = summaries.find((server) => server.target === VIBEMUX_MCP_TARGET)
  const builtinEnabled = Boolean(builtinServer?.enabled)
  const builtinReady = builtinEnabled && hasExecutorToken

  return {
    configuredCount: summaries.length,
    enabledCount: enabledServers.length,
    materializedCount: enabledServers.filter((server) => server.materialized).length,
    builtinEnabled,
    builtinReady,
    actingUserMode: builtinEnabled ? (builtinReady ? 'request-scoped' : 'pairing-required') : 'disabled',
    servers: summaries,
  }
}

export type LocalWorkerServerHandle = {
  server?: http.Server
  port?: number
  instanceId?: string
  localUrl?: string
  disabledReason?: string
}

export type StartLocalWorkerServerOptions = {
  optional?: boolean
  portCandidates?: number[]
  rejectDuplicateExecutor?: boolean
}

class DuplicateWorkerError extends Error {}

const formatListenError = (error: NodeJS.ErrnoException, port: number) => {
  if (error.code === 'EADDRINUSE') {
    return `Local console port ${port} and the fallback port range are already in use. Choose another WEMUX_WORKER_PORT or stop an unused worker.`
  }

  if (error.code === 'EPERM') {
    return `The worker does not have permission to listen on local console port ${port}. Choose a different WEMUX_WORKER_PORT or check system permissions.`
  }

  return `Failed to start the local console: ${error.message || 'listen failed'}`
}

const resolveConfiguredWorkerConsolePortCandidates = (preferredPort: number) => {
  const environment = resolveWorkerConsolePortEnvironment({
    explicitEnvironment: getEnv('WEMUX_WORKER_PORT_PROFILE'),
    nodeEnv: process.env.NODE_ENV,
    releaseChannel: getWorkerReleaseChannel(),
    cloudUrl: loadWorkerConfig().cloudUrl,
  })
  return buildWorkerConsolePortCandidates({
    environment,
    preferredPort,
  })
}

const listenOnPort = (server: http.Server, port: number, host: string) => new Promise<number>((resolve, reject) => {
  const onError = (error: NodeJS.ErrnoException) => {
    server.off('listening', onListening)
    reject(error)
  }
  const onListening = () => {
    server.off('error', onError)
    const address = server.address()
    resolve(typeof address === 'object' && address ? (address as AddressInfo).port : port)
  }

  server.once('error', onError)
  server.once('listening', onListening)
  server.listen(port, host)
})

const closeServerQuietly = (server: unknown) => {
  try {
    (server as { close?: () => unknown }).close?.()
  } catch {
    // The server may never have reached the listening state.
  }
}

// When all explicit candidates are busy, keep scanning forward (+1) so the
// local console still comes up instead of disabling itself. This matters on
// hosts where a whole port range is reserved by the OS (e.g. Hyper-V/WSL2 on
// Windows) and the default candidate range lands entirely inside it. The
// linear window covers small conflicts; if a large range is reserved we fall
// back to an OS-assigned ephemeral port so the console always comes up.
const MAX_PORT_SCAN_FORWARD = 50

const listenOnFirstAvailablePort = async (
  server: http.Server,
  ports: number[],
  host: string,
  onPortInUse?: (port: number) => Promise<void>,
) => {
  let lastError: NodeJS.ErrnoException | null = null
  const tryPort = async (port: number) => {
    try {
      return await listenOnPort(server, port, host)
    } catch (error) {
      const listenError = error as NodeJS.ErrnoException
      lastError = listenError
      if (listenError.code !== 'EADDRINUSE') {
        throw listenError
      }
      await onPortInUse?.(port)
      return null
    }
  }

  for (const port of ports) {
    const bound = await tryPort(port)
    if (bound !== null) {
      return bound
    }
  }

  const lastPort = ports.at(-1)
  if (Number.isInteger(lastPort) && lastPort! > 0 && lastPort! < 65535) {
    for (let offset = 1; offset <= MAX_PORT_SCAN_FORWARD; offset += 1) {
      const nextPort = lastPort! + offset
      if (nextPort > 65535) {
        break
      }
      const bound = await tryPort(nextPort)
      if (bound !== null) {
        return bound
      }
    }
  }

  // Whole range reserved: let the OS pick an ephemeral port so the local
  // console still comes up instead of disabling itself.
  return listenOnPort(server, 0, host)
}

const sendTerminalDirectPayload = (socket: WebSocket, payload: Record<string, unknown>) => {
  if (socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(payload))
  }
}

const handleTerminalDirectUpgrade = (
  request: http.IncomingMessage,
  socket: Duplex,
  head: Buffer,
  webSocketServer: WebSocketServer,
) => {
  const url = parseRequestUrl(request)
  if (url.pathname !== '/api/terminal-direct/ws') {
    socket.destroy()
    return
  }

  const origin = Array.isArray(request.headers.origin) ? request.headers.origin[0] : request.headers.origin
  if (!isAllowedLocalTerminalDirectOrigin(origin)) {
    socket.destroy()
    return
  }

  const ticket = url.searchParams.get('ticket')?.trim() || ''
  if (!ticket) {
    socket.destroy()
    return
  }

  webSocketServer.handleUpgrade(request, socket, head, (clientSocket) => {
    const clientId = `local-direct:${randomUUID()}`
    let attached: ReturnType<typeof attachLocalTerminalDirectSession> | null = null

    attached = attachLocalTerminalDirectSession({
      ticket,
      clientId,
      onReady: (descriptor) => {
        sendTerminalDirectPayload(clientSocket, {
          type: 'ready',
          terminalId: descriptor.terminalId,
          terminalKey: descriptor.terminalKey,
          clientId,
          cwd: descriptor.cwd,
          mode: descriptor.mode,
          at: new Date().toISOString(),
        })
      },
      onOutput: (descriptor, stream, chunk) => {
        sendTerminalDirectPayload(clientSocket, {
          type: 'output',
          output: {
            terminalId: descriptor.terminalId,
            terminalKey: descriptor.terminalKey,
            clientId,
            stream,
            chunk,
            at: new Date().toISOString(),
          },
        })
      },
      onExit: (descriptor, exitCode) => {
        sendTerminalDirectPayload(clientSocket, {
          type: 'exit',
          terminalId: descriptor.terminalId,
          terminalKey: descriptor.terminalKey,
          exitCode,
          at: new Date().toISOString(),
        })
      },
    })

    if (!attached) {
      sendTerminalDirectPayload(clientSocket, {
        type: 'error',
        message: 'Local terminal direct ticket is invalid or expired.',
      })
      clientSocket.close(1008, 'invalid terminal direct ticket')
      return
    }

    sendTerminalDirectPayload(clientSocket, {
      type: 'snapshot',
      snapshot: attached.snapshot,
      at: new Date().toISOString(),
    })
    if (attached.descriptor.exitedAt) {
      sendTerminalDirectPayload(clientSocket, {
        type: 'exit',
        terminalId: attached.descriptor.terminalId,
        terminalKey: attached.descriptor.terminalKey,
        exitCode: attached.descriptor.exitCode ?? 0,
        at: attached.descriptor.exitedAt,
      })
    } else {
      sendTerminalDirectPayload(clientSocket, {
        type: 'ready',
        terminalId: attached.descriptor.terminalId,
        terminalKey: attached.descriptor.terminalKey,
        clientId,
        cwd: attached.descriptor.cwd,
        mode: attached.descriptor.mode,
        at: new Date().toISOString(),
      })
    }

    clientSocket.on('message', (data) => {
      if (!attached) {
        return
      }

      try {
        const message = JSON.parse(String(data)) as { type?: string; input?: string; cols?: number; rows?: number }
        if (message.type === 'input') {
          writeLocalTerminalDirectSession({
            descriptor: attached.descriptor,
            input: message.input ?? '',
          })
        }
        if (message.type === 'resize') {
          resizeLocalTerminalDirectSession({
            descriptor: attached.descriptor,
            cols: message.cols ?? 0,
            rows: message.rows ?? 0,
          })
        }
      } catch {
        sendTerminalDirectPayload(clientSocket, { type: 'error', message: 'invalid terminal direct message' })
      }
    })

    clientSocket.on('close', () => {
      if (!attached) {
        return
      }
      attached.unsubscribe()
      detachLocalTerminalDirectSession({
        descriptor: attached.descriptor,
        clientId,
      })
      attached = null
    })
  })
}

export const startLocalWorkerServer = async (options: StartLocalWorkerServerOptions = {}): Promise<LocalWorkerServerHandle> => {
  const config = loadWorkerConfig()
  const executorId = getWorkerRuntimeState().executorId ?? config.executorId
  const instanceId = randomUUID()
  const listenHost = getLocalWorkerConsoleListenHost()
  const webSocketServer = new WebSocketServer({ noServer: true })
  const server = http.createServer(async (request, response) => {
    try {
      const url = parseRequestUrl(request)
      applyReadableLocalApiCorsHeaders(request, response, url.pathname)

      if (request.method === 'OPTIONS' && isReadableLocalApiCorsPath(url.pathname)) {
        response.statusCode = 204
        response.end()
        return
      }

      if (await handlePreviewMeshBridgeHttp(request, response)) {
        return
      }

      if (request.method === 'GET' && (url.pathname === '/' || url.pathname.startsWith('/assets/'))) {
        serveConsoleAsset(url.pathname, response)
        return
      }

      if (request.method === 'GET' && (url.pathname === '/health' || url.pathname === '/api/health')) {
        sendJson(response, 200, buildHealthPayload())
        return
      }

      if (request.method === 'GET' && url.pathname === '/api/config') {
        sendJson(response, 200, { config: loadWorkerLocalApiConfig() })
        return
      }

      if (request.method === 'GET' && url.pathname === '/api/status') {
        sendJson(response, 200, { runtime: getSafeWorkerRuntimeState(), mcp: buildMcpPayload() })
        return
      }

      if (request.method === 'GET' && url.pathname === '/api/local-access/identity') {
        const runtime = getWorkerRuntimeState()
        sendJson(response, 200, {
          executorId: runtime.executorId,
          instanceId,
          protocolVersion: 1,
        })
        return
      }

      if (request.method === 'GET' && url.pathname === '/api/doctor') {
        sendJson(response, 200, await getWorkerDoctor())
        return
      }

      if (request.method === 'GET' && url.pathname === '/api/agent-sessions') {
        sendJson(response, 200, listLocalAgentSessions())
        return
      }

      if (request.method === 'GET' && url.pathname === '/api/agent-sessions/detail') {
        const source = parseSessionSource(url.searchParams.get('source'))
        const sessionId = url.searchParams.get('id')?.trim()
        if (!source || !sessionId) {
          sendJson(response, 400, { message: 'source and id are required' })
          return
        }

        const session = readLocalAgentSession(source, sessionId)
        if (!session) {
          sendJson(response, 404, { message: 'session not found' })
          return
        }

        sendJson(response, 200, { session })
        return
      }

      if (request.method === 'GET' && url.pathname === '/api/update') {
        sendJson(response, 200, await checkForWorkerUpdate())
        return
      }

      if (request.method === 'POST' && url.pathname === '/api/bootstrap-runtime') {
        const report = await ensureWorkerRuntimeReady({ autoInstall: true, target: 'all' })
        sendJson(response, 200, { report, doctor: await getWorkerDoctor() })
        return
      }

      if (request.method === 'PUT' && url.pathname === '/api/config') {
        const payload = await readJsonBody<Partial<ReturnType<typeof loadWorkerConfig>>>(request)
        const next = {
          ...loadWorkerConfig(),
          ...payload,
        }
        saveWorkerConfig(next)
        updateWorkerRuntimeState({ config: next, paired: Boolean(next.executorId && next.executorToken), executorId: next.executorId })
        sendJson(response, 200, { config: next, message: 'saved' })
        return
      }

      if (request.method === 'POST' && url.pathname === '/api/pair') {
        const payload = await readJsonBody<{ pairingCode: string; name?: string }>(request)
        const current = loadWorkerConfig()
        const normalizedPairingCode = normalizeReusablePairingCode(payload.pairingCode)

        if (shouldReuseSavedWorkerPairing(payload.pairingCode, current)) {
          const next = {
            ...current,
            executorName: payload.name?.trim() || current.executorName?.trim() || `worker-${process.pid}`,
          }
          saveWorkerConfig(next)
          updateWorkerRuntimeState({ paired: true, executorId: next.executorId, config: next, daemonMode: 'starting' })
          reconnectWorkerControlPlane()
          sendJson(response, 200, {
            config: next,
            message: `${buildSavedPairingCodeReuseMessage()} Connecting to the control plane.`,
          })
          return
        }

        let paired: Awaited<ReturnType<typeof pairWithControlPlane>>
        try {
          paired = await pairWithControlPlane({
            pairingCode: payload.pairingCode,
            machineId: current.machineId,
            machineName: current.machineName,
            name: payload.name?.trim() || `worker-${process.pid}`,
            workspaceRoot: current.workspaceRoot,
            maxConcurrency: current.maxConcurrency,
            labels: current.labels,
            capabilities: current.capabilities,
            platform: process.platform,
            version: getWorkerVersion(),
          }, current.cloudUrl)
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Pair request failed.'
          sendJson(response, 400, {
            message: buildConnectPairingFailureMessage(message, hasSavedWorkerPairing(current)),
          })
          return
        }

        const next = {
          ...current,
          executorName: payload.name?.trim() || `worker-${process.pid}`,
          executorId: paired.executorId,
          executorToken: paired.executorToken,
          lastPairedPairingCode: normalizedPairingCode,
        }
        saveWorkerConfig(next)
        updateWorkerRuntimeState({ paired: true, executorId: paired.executorId, config: next, daemonMode: 'starting' })
        reconnectWorkerControlPlane()
        sendJson(response, 200, { config: next, executor: paired.executor, message: 'Pairing complete. Connecting to the control plane.' })
        return
      }

      if (request.method === 'POST' && url.pathname === '/api/reset') {
        resetWorkerConfig()
        updateWorkerRuntimeState({
          daemonMode: 'idle',
          paired: false,
          connected: false,
          executorId: undefined,
          effectiveCloudUrl: undefined,
          routeSelection: undefined,
          config: loadWorkerConfig(),
          runningTaskIds: [],
          queuedTaskIds: [],
          lastError: undefined,
        })
        sendJson(response, 200, { config: loadWorkerConfig(), message: 'reset' })
        return
      }

      if (request.method === 'POST' && url.pathname === '/api/disconnect') {
        disconnectWorkerControlPlane()
        sendJson(response, 200, { runtime: getSafeWorkerRuntimeState(), message: 'Disconnected from the control plane.' })
        return
      }

      if (request.method === 'POST' && url.pathname === '/api/connect') {
        reconnectWorkerControlPlane()
        sendJson(response, 200, { runtime: getSafeWorkerRuntimeState(), message: 'Control plane connection requested.' })
        return
      }

      if (request.method === 'POST' && url.pathname === '/api/update') {
        const result = await requestWorkerSelfUpdateWhenIdle()
        sendJson(response, result.applied || result.scheduled ? 202 : 200, result)
        return
      }

      if (request.method === 'POST' && url.pathname === '/api/codex-oauth/device/start') {
        const payload = await readJsonBody<{ userId?: string }>(request)
        const userId = payload.userId?.trim()
        if (!userId) {
          sendJson(response, 400, { message: 'userId is required' })
          return
        }
        try {
          sendJson(response, 200, await startCodexDeviceLogin(userId))
        } catch (error) {
          sendJson(response, 500, { message: error instanceof Error ? error.message : 'failed to start codex device login' })
        }
        return
      }

      if (request.method === 'GET' && url.pathname === '/api/codex-oauth/device/status') {
        const userId = url.searchParams.get('userId')?.trim()
        if (!userId) {
          sendJson(response, 400, { message: 'userId is required' })
          return
        }
        sendJson(response, 200, getCodexDeviceStatus(userId))
        return
      }

      if (request.method === 'POST' && url.pathname === '/api/codex-oauth/device/dismiss') {
        const payload = await readJsonBody<{ userId?: string }>(request)
        const userId = payload.userId?.trim()
        if (!userId) {
          sendJson(response, 400, { message: 'userId is required' })
          return
        }
        dismissCodexDeviceLogin(userId)
        sendJson(response, 200, { ok: true })
        return
      }

      if (request.method === 'GET' && url.pathname === '/api/codex-oauth/accounts') {
        const userId = url.searchParams.get('userId')?.trim()
        if (!userId) {
          sendJson(response, 400, { message: 'userId is required' })
          return
        }
        sendJson(response, 200, listCodexAccounts(userId))
        return
      }

      // 供控制面拉取当前选中账号的 AuthDotJson（token 上报 server 后广播到所有节点）
      if (request.method === 'GET' && url.pathname === '/api/codex-oauth/export') {
        const userId = url.searchParams.get('userId')?.trim()
        if (!userId) {
          sendJson(response, 400, { message: 'userId is required' })
          return
        }
        const authContent = readSelectedCodexAuthContent(userId)
        if (!authContent) {
          sendJson(response, 404, { message: 'no selected chatgpt account' })
          return
        }
        const index = listCodexAccounts(userId)
        const active = index.accounts.find((item) => item.id === index.activeAccountId) ?? null
        sendJson(response, 200, { authContent, account: active })
        return
      }

      if (request.method === 'POST' && url.pathname === '/api/codex-oauth/accounts/select') {
        const payload = await readJsonBody<{ userId?: string, accountId?: string }>(request)
        const userId = payload.userId?.trim()
        const accountId = payload.accountId?.trim()
        if (!userId || !accountId) {
          sendJson(response, 400, { message: 'userId and accountId are required' })
          return
        }
        const index = selectCodexAccount(userId, accountId)
        if (!index) {
          sendJson(response, 404, { message: 'account not found' })
          return
        }
        sendJson(response, 200, index)
        return
      }

      if (request.method === 'DELETE' && url.pathname.startsWith('/api/codex-oauth/accounts/')) {
        const accountId = url.pathname.slice('/api/codex-oauth/accounts/'.length)
        const userId = url.searchParams.get('userId')?.trim()
        if (!userId || !accountId) {
          sendJson(response, 400, { message: 'userId and accountId are required' })
          return
        }
        const index = removeCodexAccount(userId, decodeURIComponent(accountId))
        if (!index) {
          sendJson(response, 404, { message: 'account not found' })
          return
        }
        sendJson(response, 200, index)
        return
      }

      sendJson(response, 404, { message: 'not found' })
    } catch (error) {
      sendJson(response, 500, { message: error instanceof Error ? error.message : 'worker local server error' })
    }
  })

  server.on('upgrade', (request, socket, head) => {
    if (handlePreviewMeshBridgeUpgrade(request, socket, head)) {
      return
    }
    handleTerminalDirectUpgrade(request, socket, head, webSocketServer)
  })

  let actualPort = config.localServerPort
  try {
    actualPort = await listenOnFirstAvailablePort(
      server,
      options.portCandidates ?? resolveConfiguredWorkerConsolePortCandidates(config.localServerPort),
      listenHost,
      options.rejectDuplicateExecutor && executorId
        ? async (port) => {
            if (port !== config.localServerPort) return
            try {
              const response = await fetch(`${getLocalWorkerConsoleUrl(port)}/api/local-access/identity`, {
                signal: AbortSignal.timeout(500),
              })
              const identity = response.ok ? await response.json() as { executorId?: string } : null
              if (identity?.executorId === executorId) {
                throw new DuplicateWorkerError(`Worker ${executorId} is already running on ${getLocalWorkerConsoleUrl(port)}.`)
              }
            } catch (error) {
              if (error instanceof DuplicateWorkerError) throw error
            }
          }
        : undefined,
    )
  } catch (error) {
    if (error instanceof DuplicateWorkerError) {
      closeServerQuietly(server)
      closeServerQuietly(webSocketServer)
      throw error
    }
    const message = formatListenError(error as NodeJS.ErrnoException, config.localServerPort)
    updateWorkerRuntimeState({
      connected: false,
      lastError: message,
    })
    if (options.optional) {
      closeServerQuietly(server)
      closeServerQuietly(webSocketServer)
      console.warn(`[worker] local console disabled: ${message}`)
      updateWorkerRuntimeState({
        localConsole: {
          enabled: false,
          disabledReason: message,
        },
      })
      return {
        disabledReason: message,
      }
    }
    throw new Error(message)
  }

  const actualConfig = {
    ...config,
    localServerPort: actualPort,
  }
  updateWorkerRuntimeState({ config: actualConfig })

  const localUrl = getLocalWorkerConsoleUrl(actualPort)
  const listenDetail = listenHost === '127.0.0.1' ? '' : ` (listening on ${listenHost})`
  const portDetail = actualPort === config.localServerPort ? '' : ` (preferred ${config.localServerPort} was busy)`
  console.log(`[worker] local console ${localUrl}${listenDetail}${portDetail}`)
  updateWorkerRuntimeState({
    localConsole: {
      enabled: true,
      port: actualPort,
      instanceId,
      localUrl,
    },
  })

  return {
    server,
    port: actualPort,
    instanceId,
    localUrl,
  }
}
