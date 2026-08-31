// [INPUT]: 官方连接器（open-connector runtime）管理请求（Authenticated）
import { getEnv } from '@shared/env'
// [OUTPUT]: 代理到 open-connector runtime 的 provider / connection / action 接口，连接归属由 connector_connections 表控制
// [POS]: connector gateway 协议层——web 与 agent 经 Wemux server 间接访问连接器，凭据留在 runtime 边界
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import { randomBytes } from 'node:crypto'
import type { Context, Hono, MiddlewareHandler } from 'hono'
import { getTeamMemberRole } from '../repositories/auth'
import { listUserWorkspaces } from '../repositories/workspace'
import { createConnectorConnectionRecord, deleteConnectorConnectionRecord, getConnectorConnectionRecord, listConnectorConnectionRecordsForUser, updateConnectorConnectionRecordScope, updateConnectorConnectionRecordStatus } from '../storage/postgres/connector-store'
import { getUserIdFromHeader } from './shared'

const REQUEST_TIMEOUT_MS = 20000

// OOMOL 官方 provider 图标映射（service -> iconUrl），服务端缓存，失败自动降级不阻塞
const OOMOL_CATALOG_URL = 'https://oomol.com/en/apps/catalog.json'
const OOMOL_ICON_CACHE_TTL_MS = 30 * 60 * 1000

let oomolIconCache: { urls: Map<string, string>; fetchedAt: number } | null = null

const loadOomolIconUrls = async (): Promise<Map<string, string>> => {
  const now = Date.now()
  if (oomolIconCache && now - oomolIconCache.fetchedAt < OOMOL_ICON_CACHE_TTL_MS) {
    return oomolIconCache.urls
  }
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 10000)
    const response = await fetch(OOMOL_CATALOG_URL, { signal: controller.signal })
    clearTimeout(timer)
    if (!response.ok) {
      throw new Error(`catalog ${response.status}`)
    }
    const payload = (await response.json()) as { items?: Array<{ service?: unknown; iconUrl?: unknown }> }
    const urls = new Map<string, string>()
    for (const item of payload.items ?? []) {
      if (typeof item.service === 'string' && typeof item.iconUrl === 'string' && item.iconUrl.trim()) {
        urls.set(item.service, item.iconUrl.trim())
      }
    }
    oomolIconCache = { urls, fetchedAt: now }
    return urls
  } catch {
    // 拉取失败时保留旧缓存，没有缓存则返回空映射（前端降级为品牌色块）
    return oomolIconCache?.urls ?? new Map<string, string>()
  }
}

const resolveOfficialConnectorBaseUrl = () => {
  const target = getEnv('WEMUX_OFFICIAL_CONNECTOR_URL')?.trim()
    || getEnv('WEMUX_OFFICIAL_CONNECTOR_URL')?.trim()
  if (!target) {
    return ''
  }

  return target.replace(/\/mcp\/?$/, '').replace(/\/+$/, '')
}

const resolveOfficialConnectorAdminToken = () => getEnv('WEMUX_OFFICIAL_CONNECTOR_ADMIN_TOKEN')?.trim()
  || getEnv('WEMUX_OFFICIAL_CONNECTOR_ADMIN_TOKEN')?.trim()
  || ''

const resolveOfficialConnectorRuntimeToken = () => getEnv('WEMUX_OFFICIAL_CONNECTOR_RUNTIME_TOKEN')?.trim()
  || getEnv('WEMUX_OFFICIAL_CONNECTOR_RUNTIME_TOKEN')?.trim()
  || ''

const proxyJson = async (
  c: Context,
  baseUrl: string,
  runtimePath: string,
  init?: RequestInit,
) => {
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
    const adminToken = resolveOfficialConnectorAdminToken()
    const response = await fetch(`${baseUrl}${runtimePath}`, {
      ...init,
      signal: controller.signal,
      headers: {
        ...(init?.body ? { 'content-type': 'application/json' } : {}),
        ...(adminToken ? { Authorization: `Bearer ${adminToken}` } : {}),
        ...init?.headers,
      },
    })
    clearTimeout(timer)
    const body = await response.text()
    return new Response(body, {
      status: response.status,
      headers: { 'content-type': response.headers.get('content-type') ?? 'application/json' },
    })
  } catch (error) {
    return c.json({
      ok: false,
      error: { code: 'connector_unreachable', message: `official connector runtime unreachable: ${String(error)}` },
    }, 502)
  }
}

const resolveWorkspaceMember = async (workspaceId: string | undefined, userId: string) => {
  if (!workspaceId?.trim()) {
    return null
  }
  return getTeamMemberRole(workspaceId.trim(), userId)
}

export const registerConnectorRoutes = (app: Hono, requireAuth: MiddlewareHandler) => {
  const baseUrl = resolveOfficialConnectorBaseUrl()
  if (!baseUrl) {
    return
  }

  // provider catalog（1277 个 provider，含 authTypes / auth 表单信息）
  // 合并 OOMOL 官方图标映射（service -> iconUrl），runtime 自带 iconUrl 优先；不可达时原样透传
  app.get('/api/connector/providers', requireAuth, async (c) => {
    const runtimeResponse = await fetch(`${baseUrl}/api/providers`, {
      headers: resolveOfficialConnectorAdminToken()
        ? { Authorization: `Bearer ${resolveOfficialConnectorAdminToken()}` }
        : {},
    })
    const body = await runtimeResponse.text()
    if (!runtimeResponse.ok) {
      return new Response(body, {
        status: runtimeResponse.status,
        headers: { 'content-type': 'application/json' },
      })
    }

    try {
      const providers = JSON.parse(body) as Array<Record<string, unknown>>
      if (Array.isArray(providers)) {
        const iconUrls = await loadOomolIconUrls()
        for (const provider of providers) {
          if (typeof provider.service === 'string' && !provider.iconUrl) {
            const iconUrl = iconUrls.get(provider.service)
            if (iconUrl) {
              provider.iconUrl = iconUrl
            }
          }
        }
        return c.json(providers)
      }
    } catch {
      // 解析失败则原样透传
    }

    return new Response(body, {
      headers: { 'content-type': 'application/json' },
    })
  })

  // 当前用户可见的连接：个人连接（仅本人）+ 我所在所有协作组织的连接（成员共享，不限 owner）
  app.get('/api/connector/connections', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c) ?? ''
    const workspaceId = c.req.query('workspaceId')?.trim()
    const runtimeResponse = await fetch(`${baseUrl}/api/connections`, {
      headers: resolveOfficialConnectorAdminToken()
        ? { Authorization: `Bearer ${resolveOfficialConnectorAdminToken()}` }
        : {},
    })
    const runtimeConnections = runtimeResponse.ok
      ? await runtimeResponse.json().catch(() => [])
      : []

    const runtimeByKey = new Map<string, unknown>()
    if (Array.isArray(runtimeConnections)) {
      for (const item of runtimeConnections) {
        const service = typeof item.service === 'string' ? item.service : ''
        const name = typeof item.connectionName === 'string' ? item.connectionName : ''
        if (service && name) {
          runtimeByKey.set(`${service}:${name}`, item)
        }
      }
    }

    // 用户所有协作组织；兼容前端显式传当前 workspaceId 做过滤
    const memberWorkspaceIds = (await listUserWorkspaces(userId)).map((workspace) => workspace.id)
    const workspaceIds = workspaceId?.trim()
      ? [workspaceId.trim(), ...memberWorkspaceIds.filter((id) => id !== workspaceId.trim())]
      : memberWorkspaceIds
    const records = await listConnectorConnectionRecordsForUser(userId, workspaceIds)
    const visible = records.filter((record) => {
      if (record.visibility === 'personal') {
        return record.ownerUserId === userId
      }
      return true
    })

    return c.json(visible.map((record) => {
      const runtimeState = runtimeByKey.get(`${record.service}:${record.connectionName}`)
      const profile = (runtimeState as { profile?: unknown })?.profile ?? undefined
      return {
        id: record.id,
        service: record.service,
        connectionName: record.connectionName,
        authType: record.authType,
        ownerUserId: record.ownerUserId,
        workspaceId: record.workspaceId ?? undefined,
        visibility: record.visibility,
        status: record.status,
        message: record.message ?? undefined,
        accountLabel: record.accountLabel
          ?? (profile ? (profile as { displayName?: string }).displayName : undefined),
        runtimeConfigured: Boolean(runtimeState),
      }
    }))
  })

  // 新建 api_key 连接：body { service, values: { apiKey }, workspaceId? }
  // 归属：ownerUserId = 当前用户；workspaceId 非空且为用户所在协作组织时记为 workspace 连接
  app.put('/api/connector/connections/:service', requireAuth, async (c) => {
    const service = c.req.param('service')
    const userId = getUserIdFromHeader(c) ?? ''
    const body = await c.req.json()
    const apiKey = typeof body.values?.apiKey === 'string' ? body.values.apiKey.trim() : ''
    const workspaceId = typeof body.workspaceId === 'string' && body.workspaceId.trim() ? body.workspaceId.trim() : ''
    if (!apiKey) {
      return c.json({ ok: false, error: { code: 'invalid_input', message: 'apiKey is required.' } }, 400)
    }

    const workspaceRole = workspaceId ? await resolveWorkspaceMember(workspaceId, userId) : null
    if (workspaceId && workspaceRole === null) {
      return c.json({ ok: false, error: { code: 'forbidden', message: 'Not a member of this workspace.' } }, 403)
    }

    const connectionName = `vx-${randomBytes(4).toString('hex')}`
    const runtimeResponse = await fetch(`${baseUrl}/api/connections/${encodeURIComponent(service)}`, {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
        ...(resolveOfficialConnectorAdminToken()
          ? { Authorization: `Bearer ${resolveOfficialConnectorAdminToken()}` }
          : {}),
      },
      body: JSON.stringify({ authType: 'api_key', connectionName, values: { apiKey } }),
    })
    const runtimeBody = await runtimeResponse.json().catch(() => null)
    if (!runtimeResponse.ok) {
      const message = (runtimeBody as { error?: { message?: string } })?.error?.message
        ?? (runtimeBody as { message?: string })?.message
        ?? `connector rejected connection: ${runtimeResponse.status}`
      return c.json({ ok: false, error: { code: 'credential_verification_failed', message } }, 502)
    }

    const profile = (runtimeBody as { profile?: { displayName?: string } })?.profile
    const record = await createConnectorConnectionRecord({
      id: `cnx_${randomBytes(8).toString('hex')}`,
      service,
      connectionName,
      authType: 'api_key',
      ownerUserId: userId,
      workspaceId: workspaceId || null,
      visibility: workspaceId ? 'workspace' : 'personal',
      status: 'ok',
      accountLabel: profile?.displayName ?? null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })

    return c.json({ ok: true, connection: record })
  })

  // 切换连接归属：body { visibility: 'personal' | 'workspace', workspaceId? }
  // 仅 owner 可改；切到 workspace 需调用者是该组织成员（避免把连接塞进不属于自己的组织）
  app.patch('/api/connector/connections/:id', requireAuth, async (c) => {
    const id = c.req.param('id')
    const userId = getUserIdFromHeader(c) ?? ''
    const body = await c.req.json().catch(() => null)
    const visibility = body?.visibility
    if (visibility !== 'personal' && visibility !== 'workspace') {
      return c.json({ ok: false, error: { code: 'invalid_input', message: 'visibility must be personal or workspace.' } }, 400)
    }

    const record = await getConnectorConnectionRecord(id)
    if (!record) {
      return c.json({ ok: false, error: { code: 'not_found', message: 'Connection record not found.' } }, 404)
    }
    if (record.ownerUserId !== userId) {
      return c.json({ ok: false, error: { code: 'forbidden', message: 'Only the owner can change connection scope.' } }, 403)
    }

    let workspaceId: string | null = null
    if (visibility === 'workspace') {
      const rawWorkspaceId = typeof body?.workspaceId === 'string' && body.workspaceId.trim()
        ? body.workspaceId.trim()
        : ''
      if (!rawWorkspaceId) {
        return c.json({ ok: false, error: { code: 'invalid_input', message: 'workspaceId is required for workspace visibility.' } }, 400)
      }
      const role = await resolveWorkspaceMember(rawWorkspaceId, userId)
      if (!role) {
        return c.json({ ok: false, error: { code: 'forbidden', message: 'Not a member of this workspace.' } }, 403)
      }
      workspaceId = rawWorkspaceId
    }

    await updateConnectorConnectionRecordScope(id, { workspaceId, visibility })
    return c.json({
      ok: true,
      connection: {
        ...record,
        workspaceId: workspaceId ?? undefined,
        visibility,
        updatedAt: new Date().toISOString(),
      },
    })
  })

  // 删除连接：id = connector_connections 记录 id；校验归属（owner 或所在 workspace 成员）
  app.delete('/api/connector/connections/:id', requireAuth, async (c) => {
    const id = c.req.param('id')
    const userId = getUserIdFromHeader(c) ?? ''
    const record = await getConnectorConnectionRecord(id)
    if (!record) {
      return c.json({ ok: false, error: { code: 'not_found', message: 'Connection record not found.' } }, 404)
    }

    const isOwner = record.ownerUserId === userId
    // workspace 连接的删除：创建者 或 workspace owner/admin；普通成员只能看不能用删
    const canManageWorkspace = record.workspaceId
      ? await resolveWorkspaceMember(record.workspaceId, userId)
      : null
    const canDelete = record.workspaceId
      ? isOwner || canManageWorkspace === 'owner' || canManageWorkspace === 'admin'
      : isOwner
    if (!canDelete) {
      return c.json({ ok: false, error: { code: 'forbidden', message: 'No permission to delete this connection.' } }, 403)
    }

    await fetch(`${baseUrl}/api/connections/${encodeURIComponent(record.connectionName)}?service=${encodeURIComponent(record.service)}`, {
      method: 'DELETE',
      headers: resolveOfficialConnectorAdminToken()
        ? { Authorization: `Bearer ${resolveOfficialConnectorAdminToken()}` }
        : {},
    }).catch(() => undefined)

    await deleteConnectorConnectionRecord(id)
    return c.json({ ok: true })
  })

  // 测试执行 action：body { actionId, input?, connectionName? }
  app.post('/api/connector/actions/:actionId', requireAuth, async (c) => {
    const actionId = c.req.param('actionId')
    const body = await c.req.json()
    return proxyJson(c, baseUrl, `/v1/actions/${encodeURIComponent(actionId)}`, {
      method: 'POST',
      body: JSON.stringify(body),
    })
  })

  // 官方连接器 MCP 代理（多租户执行侧隔离）：agent 经此访问连接器，
  // server 按 x-wemux-workspace（执行 workspaceId）解析 collab workspace，过滤连接。
  // 鉴权：与直连 open-connector 相同（runtime token）；未配置时跳过（本地 dev）。
  app.post('/api/connector/mcp', async (c) => {
    const runtimeToken = resolveOfficialConnectorRuntimeToken()
    const auth = (c.req.header('Authorization') ?? '').replace(/^Bearer\s+/i, '').trim()
    if (runtimeToken && auth !== runtimeToken) {
      return c.json({ jsonrpc: '2.0', error: { code: -32001, message: 'Unauthorized' }, id: null }, 401)
    }

    const executionWorkspaceId = c.req.header('x-wemux-workspace')?.trim() || undefined
    const actingUserId = c.req.header('x-wemux-acting-user')?.trim() || undefined
    const collabWorkspaceId = executionWorkspaceId
      ? await resolveCollabWorkspaceForExecutionWorkspace(executionWorkspaceId).catch(() => undefined)
      : undefined

    const body = await c.req.json().catch(() => null)
    if (!body || typeof body !== 'object' || !('method' in body)) {
      return c.json({ jsonrpc: '2.0', error: { code: -32600, message: 'Invalid Request' }, id: null }, 400)
    }

    const method = (body as { method?: string }).method
    if (method === 'tools/call') {
      const name = (body as { params?: { name?: string } }).params?.name
      if (name === 'list_connections') {
        return proxyMcpToolsCall(c, baseUrl, 'list_connections', collabWorkspaceId, actingUserId)
      }
      if (name === 'execute_action') {
        return proxyMcpExecuteAction(c, baseUrl, (body as { params?: { arguments?: Record<string, unknown> } }).params?.arguments, collabWorkspaceId, actingUserId)
      }
    }

    // initialize / tools/list / list_apps / search_actions / get_action_guide / notifications → 透传
    return proxyMcpJson(c, baseUrl, body)
  })
}

const resolveCollabWorkspaceForExecutionWorkspace = async (executionWorkspaceId: string) => {
  const { query } = await import('../storage/postgres/db')
  const workspaceRows = await query<{ project_id: string }>(
    'SELECT project_id FROM workspaces WHERE id = $1 LIMIT 1',
    [executionWorkspaceId],
  )
  const projectId = workspaceRows.rows[0]?.project_id
  if (!projectId) {
    return undefined
  }

  const projectRows = await query<{ workspace_id: string | null }>(
    'SELECT workspace_id FROM projects WHERE id = $1 LIMIT 1',
    [projectId],
  )
  return projectRows.rows[0]?.workspace_id?.trim() || undefined
}

const proxyMcpJson = async (c: Context, baseUrl: string, body: unknown) => {
  const runtimeToken = resolveOfficialConnectorRuntimeToken()
  const response = await fetch(`${baseUrl}/mcp`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      ...(runtimeToken ? { Authorization: `Bearer ${runtimeToken}` } : {}),
    },
    body: JSON.stringify(body),
  })
  const text = await response.text()
  return new Response(text, {
    status: response.status,
    headers: { 'content-type': response.headers.get('content-type') ?? 'application/json' },
  })
}

const proxyMcpToolsCall = async (c: Context, baseUrl: string, toolName: string, collabWorkspaceId?: string, actingUserId?: string) => {
  const runtimeResponse = await fetch(`${baseUrl}/mcp`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      ...(resolveOfficialConnectorRuntimeToken()
        ? { Authorization: `Bearer ${resolveOfficialConnectorRuntimeToken()}` }
        : {}),
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 'vibemux-proxy', method: 'tools/call', params: { name: toolName, arguments: {} } }),
  })
  const runtimeBody = await runtimeResponse.json().catch(() => null)
  const allConnections = extractMcpTextContent(runtimeBody)

  // 过滤：只保留该 collab workspace 可见的连接 + 当前 acting user 的个人连接
  const visibleNames = collabWorkspaceId || actingUserId
    ? await listVisibleConnectionNames(collabWorkspaceId, actingUserId)
    : new Set<string>()
  const filtered = Array.isArray(allConnections)
    ? allConnections.filter((connection) => visibleNames.has(connection.connectionName))
    : allConnections

  return c.json({
    jsonrpc: '2.0',
    id: (runtimeBody as { id?: unknown })?.id ?? null,
    result: {
      content: [{ type: 'text', text: JSON.stringify({ ok: true, data: filtered }) }],
    },
  })
}

const proxyMcpExecuteAction = async (
  c: Context,
  baseUrl: string,
  args: Record<string, unknown> | undefined,
  collabWorkspaceId?: string,
  actingUserId?: string,
) => {
  // 多租户隔离：必须携带 workspace 上下文（agent 在执行工作区内运行）或个人身份，否则拒绝
  if (!collabWorkspaceId && !actingUserId) {
    return c.json({
      jsonrpc: '2.0',
      id: null,
      error: { code: -32002, message: 'workspace or acting-user context is required for connector execution' },
    }, 403)
  }

  const connectionName = typeof args?.connectionName === 'string' && args.connectionName.trim()
    ? args.connectionName.trim()
    : undefined
  if (!connectionName) {
    return c.json({
      jsonrpc: '2.0',
      id: null,
      error: { code: -32002, message: 'connectionName is required for workspace-scoped execution' },
    }, 403)
  }

  // 校验 connectionName 属于当前 collab workspace 可见集合或个人连接
  const visibleNames = await listVisibleConnectionNames(collabWorkspaceId, actingUserId)
  if (!visibleNames.has(connectionName)) {
    return c.json({
      jsonrpc: '2.0',
      id: null,
      error: { code: -32002, message: `connection ${connectionName} is not available in this workspace` },
    }, 403)
  }

  const runtimeToken = resolveOfficialConnectorRuntimeToken()
  const response = await fetch(`${baseUrl}/mcp`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      ...(runtimeToken ? { Authorization: `Bearer ${runtimeToken}` } : {}),
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 'vibemux-proxy', method: 'tools/call', params: { name: 'execute_action', arguments: args ?? {} } }),
  })
  const text = await response.text()
  return new Response(text, {
    status: response.status,
    headers: { 'content-type': response.headers.get('content-type') ?? 'application/json' },
  })
}

const listVisibleConnectionNames = async (collabWorkspaceId?: string, actingUserId?: string) => {
  const { getDrizzleDb } = await import('../storage/postgres/drizzle-db')
  const { connectorConnections } = await import('../storage/postgres/schema-core')
  const { and, eq, inArray, isNull, or } = await import('drizzle-orm')
  const db = getDrizzleDb()
  const conditions = []
  if (collabWorkspaceId) {
    conditions.push(eq(connectorConnections.workspaceId, collabWorkspaceId))
  }
  // 个人连接（仅自己）：owner 匹配且不属于任何 workspace
  if (actingUserId) {
    conditions.push(
      and(
        eq(connectorConnections.ownerUserId, actingUserId),
        isNull(connectorConnections.workspaceId),
      ),
    )
  }
  if (conditions.length === 0) {
    return new Set<string>()
  }
  const rows = await db
    .select({ connectionName: connectorConnections.connectionName })
    .from(connectorConnections)
    .where(or(...conditions))
  return new Set(rows.map((row) => row.connectionName))
}

const extractMcpTextContent = (runtimeBody: unknown): unknown => {
  const content = (runtimeBody as { result?: { content?: Array<{ type?: string; text?: string }> } })?.result?.content
  if (!Array.isArray(content)) {
    return null
  }
  const text = content.find((item) => item.type === 'text')?.text
  if (!text) {
    return null
  }
  try {
    const parsed = JSON.parse(text)
    return parsed?.data ?? parsed
  } catch {
    return null
  }
}
