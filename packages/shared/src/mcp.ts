/**
 * [INPUT]: Stored MCP server configuration and Wemux control-plane tool names.
 * [OUTPUT]: Shared MCP policy parsing, runtime materialization, and read-only tool metadata.
 * [POS]: Cross-runtime MCP contract shared by server, worker, and web configuration surfaces.
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */
import { parseOpencodeConfigContent } from './opencode-config'
import { createStableId, inferMcpTransport as inferTransport, isRecord } from './utils'
import type { WorkspaceResourceVisibility } from './workspace-scope'

export type McpTransport = 'http' | 'sse' | 'stdio' | 'custom'

export type McpCapabilityMode = 'resources' | 'resources+tools'

export type McpServerPolicy = {
  id: string
  name: string
  target: string
  transport: McpTransport
  enabled: boolean
  capabilityMode: McpCapabilityMode
  visibility?: WorkspaceResourceVisibility | 'team'
  workspaceId?: string
  ownerUserId?: string
  managedBySystem?: boolean
  headers?: Record<string, string>
}

export const VIBEMUX_MCP_SERVER_ID = 'mcp-vibemux'
export const VIBEMUX_MCP_SERVER_NAME = 'vibemux'
export const VIBEMUX_MCP_TARGET = 'built-in://vibemux'

export const OFFICIAL_CONNECTOR_MCP_SERVER_ID = 'mcp-official-connector'
export const OFFICIAL_CONNECTOR_MCP_SERVER_NAME = 'official-connector'

export const VIBEMUX_READ_ONLY_MCP_TOOL_NAMES = [
  'executor.list',
  'project.list',
  'project.get',
  'session.list',
  'session.get',
  'workspace.list',
  'workspace.get',
  'workspace.branches',
  'conversation.list',
  'conversation.get',
  'channel.list',
  'task.list',
  'task.get',
  'task.runs',
  'task.execution.get',
  'conversation.get_task_conversation',
  'task.chat_session.list',
  'task.chat_session.get',
  'workspace.session.list',
  'workspace.session.get',
  'workspace.session.runtime',
  'agent.list',
  'agent.types',
  'agent.inbox.list',
  'mcp.list',
  'skill.list',
  'skill.get',
  'skill.runtime_packages',
  'drive.list_files',
  'drive.file_info',
  'drive.read_file',
  'drive.trash_list',
  'drive.versions',
  'drive.permissions_get',
  'drive.search',
  'admin.analytics',
  'admin.users.list',
  'admin.users.get',
  'admin.users.auth_events',
  'admin.admins.list',
  'admin.auth_events.list',
  'admin.audit.list',
  'admin.account_system.get',
  'admin.usage.summary',
  'admin.credits.accounts',
  'admin.credits.transactions',
  'admin.model_prices.list',
  'admin.executors.list',
  'admin.cluster.summary',
  'admin.agents.list',
  'admin.tasks.list',
  'admin.workspaces.list',
  'admin.ops.health',
  'admin.ops.storage.summary',
  'admin.ops.storage.list',
  'admin.ops.database.backups',
  'admin.ops.database.backup_policy',
  'admin.ops.alerts.config',
  'admin.ops.alerts.events',
] as const

const normalizeVibemuxMcpToolName = (name: string) => (
  name.trim().toLowerCase().replace(/[._]+/g, '.')
)

const vibemuxReadOnlyMcpToolNames = new Set<string>(
  VIBEMUX_READ_ONLY_MCP_TOOL_NAMES.map(normalizeVibemuxMcpToolName),
)

export const isVibemuxReadOnlyMcpToolName = (name: string) => (
  vibemuxReadOnlyMcpToolNames.has(normalizeVibemuxMcpToolName(name))
)

export const VIBEMUX_READ_ONLY_MCP_TOOL_ANNOTATIONS = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const

export const createVibemuxMcpServerPolicy = (enabled = true): McpServerPolicy => ({
  id: VIBEMUX_MCP_SERVER_ID,
  name: VIBEMUX_MCP_SERVER_NAME,
  target: VIBEMUX_MCP_TARGET,
  transport: 'http',
  enabled,
  capabilityMode: 'resources+tools',
  managedBySystem: true,
})

export const createOfficialConnectorMcpServerPolicy = (target: string, enabled = true, headers?: Record<string, string>): McpServerPolicy => ({
  id: OFFICIAL_CONNECTOR_MCP_SERVER_ID,
  name: OFFICIAL_CONNECTOR_MCP_SERVER_NAME,
  target,
  transport: 'http',
  enabled,
  capabilityMode: 'resources+tools',
  managedBySystem: true,
  headers,
})

export const parseMcpServerPolicy = (item: unknown, index: number): McpServerPolicy | null => {
  if (!isRecord(item)) {
    return null
  }

  const name = typeof item.name === 'string' ? item.name.trim() : ''
  const target = typeof item.target === 'string' ? item.target.trim() : ''
  if (!name || !target) {
    return null
  }

  const transport = item.transport === 'http' || item.transport === 'sse' || item.transport === 'stdio'
    ? item.transport
    : inferTransport(target)
  const capabilityMode = item.capabilityMode === 'resources+tools' ? 'resources+tools' : 'resources'
  const id = typeof item.id === 'string' && item.id.trim() ? item.id.trim() : createStableId('mcp', name, index)
  const visibility = item.visibility === 'workspace' || item.visibility === 'team' ? item.visibility : undefined
  const workspaceId = typeof item.workspaceId === 'string' && item.workspaceId.trim() ? item.workspaceId.trim() : undefined
  const ownerUserId = typeof item.ownerUserId === 'string' && item.ownerUserId.trim() ? item.ownerUserId.trim() : undefined
  const headers = isRecord(item.headers)
    ? Object.fromEntries(
        Object.entries(item.headers)
          .filter((entry): entry is [string, string] => typeof entry[1] === 'string' && entry[1].trim().length > 0)
          .map(([key, value]) => [key, value as string]),
      )
    : undefined

  return {
    id,
    name,
    target,
    transport,
    enabled: item.enabled !== false,
    capabilityMode,
    visibility,
    workspaceId,
    ownerUserId,
    managedBySystem: item.managedBySystem === true || name === VIBEMUX_MCP_SERVER_NAME,
    ...(headers && Object.keys(headers).length > 0 ? { headers } : {}),
  }
}

export const ensureOfficialConnectorMcpServer = (
  servers: McpServerPolicy[],
  target: string | undefined,
  headers?: Record<string, string>,
): McpServerPolicy[] => {
  const normalizedTarget = target?.trim()
  if (!normalizedTarget) {
    return servers
  }

  const normalizedHeaders = headers && Object.keys(headers).length > 0 ? headers : undefined
  const existing = servers.find((item) => (
    item.name === OFFICIAL_CONNECTOR_MCP_SERVER_NAME || item.id === OFFICIAL_CONNECTOR_MCP_SERVER_ID
  ))
  if (!existing) {
    return [...servers, createOfficialConnectorMcpServerPolicy(normalizedTarget, true, normalizedHeaders)]
  }

  return servers.map((item) => {
    if (item.id !== existing.id && item.name !== existing.name) {
      return item
    }

    return {
      ...item,
      id: OFFICIAL_CONNECTOR_MCP_SERVER_ID,
      name: OFFICIAL_CONNECTOR_MCP_SERVER_NAME,
      target: normalizedTarget,
      transport: 'http' as const,
      capabilityMode: 'resources+tools' as const,
      managedBySystem: true,
      headers: normalizedHeaders,
    }
  })
}

export const ensureVibemuxMcpServer = (servers: McpServerPolicy[]) => {
  const existing = servers.find((item) => item.name === VIBEMUX_MCP_SERVER_NAME || item.id === VIBEMUX_MCP_SERVER_ID)
  if (!existing) {
    return [...servers, createVibemuxMcpServerPolicy(true)]
  }

  return servers.map((item) => {
    if (item.id !== existing.id) {
      return item
    }

    return {
      ...item,
      id: VIBEMUX_MCP_SERVER_ID,
      name: VIBEMUX_MCP_SERVER_NAME,
      target: item.target.trim() || VIBEMUX_MCP_TARGET,
      transport: 'http' as const,
      capabilityMode: 'resources+tools' as const,
      managedBySystem: true,
    }
  })
}

export const parsePrimaryAgentMcpServers = (config: unknown): McpServerPolicy[] => {
  const record = isRecord(config) ? config : {}
  const rawMcpServers = Array.isArray(record.mcpServers) ? record.mcpServers : []
  return ensureVibemuxMcpServer(
    rawMcpServers
      .map((item, index) => parseMcpServerPolicy(item, index))
      .filter((item): item is McpServerPolicy => item !== null),
  )
}

const trimTrailingSlash = (value: string) => value.replace(/\/+$/, '')

const normalizeRemoteTarget = (target: string) => {
  if (target.startsWith('sse://')) {
    return `http://${target.slice('sse://'.length)}`
  }

  return target
}

const buildBuiltinVibemuxServer = (params: {
  cloudUrl: string
  executorToken?: string
  actingUserId?: string
  runtimeAgentId?: string
}) => {
  if (!params.executorToken?.trim()) {
    return null
  }

  const headers: Record<string, string> = {
    Authorization: `Bearer ${params.executorToken}`,
  }

  if (params.actingUserId?.trim()) {
    headers['x-vibemux-acting-user'] = params.actingUserId.trim()
  }
  if (params.runtimeAgentId?.trim()) {
    headers['x-vibemux-runtime-agent'] = params.runtimeAgentId.trim()
  }

  return {
    type: 'remote',
    url: `${trimTrailingSlash(params.cloudUrl)}/mcp/executor`,
    enabled: true,
    headers,
  }
}

const buildStdioServer = (target: string) => {
  const command = target.replace(/^stdio:\/\//, '').trim()
  if (!command) {
    return null
  }

  return {
    command,
  }
}

const buildRemoteServer = (target: string, headers?: Record<string, string>) => {
  const url = normalizeRemoteTarget(target).trim()
  if (!url) {
    return null
  }

  return {
    type: 'remote',
    url,
    enabled: true,
    ...(headers && Object.keys(headers).length > 0 ? { headers } : {}),
  }
}

// 官方连接器：agent 不直连 open-connector，而是经 Wemux server 代理（/api/connector/mcp）
// 由 server 按 workspace 上下文过滤连接，实现多租户执行侧隔离。
const buildOfficialConnectorServer = (
  server: McpServerPolicy,
  params: {
    cloudUrl: string
    workspaceId?: string
    actingUserId?: string
  },
) => {
  const cloudUrl = trimTrailingSlash(params.cloudUrl)
  if (!cloudUrl) {
    return null
  }

  const headers: Record<string, string> = {
    ...(server.headers ?? {}),
    ...(params.workspaceId?.trim() ? { 'x-vibemux-workspace': params.workspaceId.trim() } : {}),
    ...(params.actingUserId?.trim() ? { 'x-vibemux-acting-user': params.actingUserId.trim() } : {}),
  }

  return {
    type: 'remote',
    url: `${cloudUrl}/api/connector/mcp`,
    enabled: true,
    headers,
  }
}

export type McpValidationResult = { ok: true } | { ok: false; error: string }

export const validateMcpServerPolicy = (server: McpServerPolicy): McpValidationResult => {
  if (!server.name?.trim()) {
    return { ok: false, error: 'MCP server name is required.' }
  }

  const target = server.target?.trim()
  if (!target) {
    return { ok: false, error: `MCP server "${server.name}" has empty target.` }
  }

  if (server.transport === 'stdio' || target.startsWith('stdio://')) {
    const command = target.replace(/^stdio:\/\//, '').trim()
    if (!command) {
      return { ok: false, error: `MCP server "${server.name}" has empty stdio command.` }
    }
    if (command.includes('&&') || command.includes('|') || command.includes(';')) {
      return { ok: false, error: `MCP server "${server.name}" stdio command must not contain shell operators (&&, |, ;).` }
    }
    return { ok: true }
  }

  if (target === VIBEMUX_MCP_TARGET) {
    return { ok: true }
  }

  const normalizedUrl = normalizeRemoteTarget(target)
  if (!/^https?:\/\/.+/.test(normalizedUrl)) {
    return { ok: false, error: `MCP server "${server.name}" target must be http/https URL or stdio:// command. Got: ${target.slice(0, 60)}` }
  }

  return { ok: true }
}

export const materializeMcpServersForOpencode = (
  servers: McpServerPolicy[],
  params: {
    cloudUrl: string
    executorToken?: string
    actingUserId?: string
    runtimeAgentId?: string
    workspaceId?: string
  },
) => {
  return servers
    .filter((server) => server.enabled)
    .reduce<Record<string, unknown>>((result, server, index) => {
      const validation = validateMcpServerPolicy(server)
      if (!validation.ok) {
        console.warn(`[mcp] skipping invalid server: ${validation.error}`)
        return result
      }

      const key = server.id?.trim() || createStableId('mcp', server.name, index)
      const definition = server.target === VIBEMUX_MCP_TARGET
        ? buildBuiltinVibemuxServer(params)
        : server.id === OFFICIAL_CONNECTOR_MCP_SERVER_ID
          ? buildOfficialConnectorServer(server, params)
          : server.transport === 'stdio' || server.target.startsWith('stdio://')
            ? buildStdioServer(server.target)
            : buildRemoteServer(server.target, server.headers)

      if (definition) {
        result[key] = definition
      }

      return result
    }, {})
}

export const buildOpencodeConfigWithMcp = (
  rawConfigContent: string | undefined,
  servers: McpServerPolicy[],
  params: {
    cloudUrl: string
    executorToken?: string
    actingUserId?: string
    runtimeAgentId?: string
    workspaceId?: string
  },
) => {
  const parsed = parseOpencodeConfigContent(rawConfigContent)
  const baseConfig = isRecord(parsed) ? { ...parsed } : {}
  const existingServers = isRecord(baseConfig.mcp)
    ? { ...baseConfig.mcp }
    : isRecord(baseConfig.mcpServers)
      ? { ...baseConfig.mcpServers }
      : {}
  const managedServers = materializeMcpServersForOpencode(servers, params)
  const { mcpServers: _legacyMcpServers, ...restConfig } = baseConfig
  const merged = {
    ...restConfig,
    mcp: {
      ...existingServers,
      ...managedServers,
    },
  }

  return JSON.stringify(merged, null, 2)
}
