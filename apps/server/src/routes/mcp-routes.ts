// [INPUT]: 已鉴权 Hono app，MCP server 测试请求
// [OUTPUT]: POST /api/mcp/test 路由
// [POS]: MCP 配置测试 HTTP 协议层
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import type { MiddlewareHandler } from 'hono'
import { Hono } from 'hono'
import { validateMcpServerPolicy } from '@shared/mcp'
import type { McpServerPolicy } from '@shared/mcp'
import { createVibemuxMcpServer } from '../integrations/mcp/vibemux-mcp-server'
import { normalizeMcpArguments } from '../integrations/mcp/vibemux-mcp-chat-tools'
import { WebStandardStreamableHTTPServerTransport } from '../integrations/mcp/sdk'
import { executorRegistry } from '../control-plane/executor-registry'
import { loadState } from '../storage/app-state-store'
import { ensureTeamMember, getScopedState, getUserIdFromHeader, getUserIdFromHeaderAsync } from './shared'

/**
 * opencode 等 runtime 可能以「文本参数」调用 MCP 工具（LLM 输出 `key: value` 行文本而非 JSON 对象）。
 * 在路由层拦截 tools/call 请求体：若 arguments 是字符串，归一化为对象再转发给 MCP server。
 */
const normalizeMcpToolsCallRequest = async (request: Request): Promise<Request> => {
  if (request.method !== 'POST') {
    return request
  }

  const contentType = request.headers.get('content-type') ?? ''
  if (!contentType.includes('application/json')) {
    return request
  }

  const clone = request.clone()
  const rawText = await clone.text()
  if (!rawText.trim()) {
    return request
  }

  let payload: unknown
  try {
    payload = JSON.parse(rawText) as unknown
  } catch {
    return request
  }

  const isToolsCall = Boolean(payload && typeof payload === 'object' && 'method' in payload
    && (payload as { method?: string }).method === 'tools/call')
  if (!isToolsCall) {
    return request
  }

  const params = (payload as { params?: { arguments?: unknown } }).params
  if (!params || typeof params.arguments === 'object') {
    return request
  }

  const nextPayload = {
    ...(payload as Record<string, unknown>),
    params: {
      ...params,
      arguments: normalizeMcpArguments(params.arguments),
    },
  }
  return new Request(request.url, {
    method: request.method,
    headers: request.headers,
    body: JSON.stringify(nextPayload),
  })
}

export const registerMcpRoutes = (app: Hono, requireAuth: MiddlewareHandler) => {
  app.all('/mcp/executor', async (c) => {
    const token = c.req.header('Authorization')?.replace(/^Bearer\s+/, '') || c.req.header('x-executor-token')
    if (!token) {
      return c.json({ message: '缺少 executor token。' }, 401)
    }

    const executor = executorRegistry.authenticateExecutorToken(token)
    if (!executor) {
      return c.json({ message: 'executor token 无效。' }, 401)
    }

    const actingUserId = c.req.header('x-vibemux-acting-user')?.trim()
    if (actingUserId && actingUserId !== executor.ownerUserId) {
      if (!(executor.visibility === 'team' && executor.teamId && ensureTeamMember(executor.teamId, actingUserId))) {
        return c.json({ message: 'acting user 无权通过该执行器访问 MCP。' }, 403)
      }
    }

    const userId = actingUserId || executor.ownerUserId
    const runtimeAgentId = c.req.header('x-vibemux-runtime-agent')?.trim()
    const server = createVibemuxMcpServer({
      userId,
      runtimeAgentId,
      getState: () => getScopedState(loadState(), userId),
    })
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    })

    await server.connect(transport)
    return transport.handleRequest(await normalizeMcpToolsCallRequest(c.req.raw))
  })

  app.all('/mcp', requireAuth, async (c) => {
    const userId = await getUserIdFromHeaderAsync(c)
    if (!userId) {
      return c.json({ message: '未登录' }, 401)
    }
    const server = createVibemuxMcpServer({
      userId,
      getState: () => getScopedState(loadState(), userId),
    })
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    })

    await server.connect(transport)
    return transport.handleRequest(await normalizeMcpToolsCallRequest(c.req.raw))
  })

  app.post('/api/mcp/test', requireAuth, async (c) => {
    const body = await c.req.json().catch(() => ({}))
    const server = body as Partial<McpServerPolicy>

    if (!server.name?.trim() || !server.target?.trim()) {
      return c.json({ ok: false, error: 'name and target are required.' }, 400)
    }

    const validation = validateMcpServerPolicy(server as McpServerPolicy)
    if (!validation.ok) {
      return c.json({ ok: false, error: validation.error, phase: 'validation' })
    }

    const target = server.target!.trim()
    const transport = server.transport || 'http'

    if (transport === 'stdio' || target.startsWith('stdio://')) {
      return c.json({ ok: true, phase: 'validated', message: 'stdio command format is valid. Connection test not applicable for stdio servers.' })
    }

    if (target === 'built-in://vibemux') {
      return c.json({ ok: true, phase: 'validated', message: 'Built-in Wemux MCP server.' })
    }

    const normalizedUrl = target.startsWith('sse://')
      ? `http://${target.slice('sse://'.length)}`
      : target

    try {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 5000)
      const response = await fetch(normalizedUrl, {
        method: 'GET',
        signal: controller.signal,
        headers: { Accept: 'application/json' },
      }).catch(() => null)
      clearTimeout(timer)

      if (!response) {
        return c.json({ ok: false, error: 'Connection failed (no response).', phase: 'connect' })
      }

      return c.json({
        ok: response.ok || response.status === 405,
        phase: 'connected',
        status: response.status,
        message: response.ok ? 'MCP server is reachable.' : `Server returned ${response.status}.`,
      })
    } catch (error) {
      return c.json({
        ok: false,
        error: error instanceof Error ? error.message : 'Connection test failed.',
        phase: 'connect',
      })
    }
  })
}
