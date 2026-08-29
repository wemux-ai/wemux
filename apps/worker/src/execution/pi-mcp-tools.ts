// [INPUT]: MCP tools 配置
// [OUTPUT]: Pi customTools bridge
// [POS]: Pi MCP bridge
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { defineTool, type ToolDefinition } from '@mariozechner/pi-coding-agent'
import { materializeMcpServersForOpencode, type McpServerPolicy } from '@shared/mcp'
import type { WorkerConfig } from '@shared/types'
import { buildAgentRuntimeEnvironment } from './agent-runtime-env'
import { loadWorkerRuntimeConfig } from '../core/runtime-cloud-url'

type MaterializedMcpServer = {
  command?: string
  headers?: Record<string, string>
  type?: string
  url?: string
}

type PiMcpToolsResult = {
  tools: ToolDefinition[]
  cleanup: () => Promise<void>
  warnings: string[]
}

const TOOL_NAME_SEPARATOR = '__'

const sanitizeToolSegment = (value: string) => {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
}

const buildPiToolName = (serverName: string, toolName: string, usedNames: Set<string>) => {
  const base = [sanitizeToolSegment(serverName), sanitizeToolSegment(toolName)].filter(Boolean).join(TOOL_NAME_SEPARATOR) || 'mcp_tool'
  let candidate = base
  let suffix = 2

  while (usedNames.has(candidate)) {
    candidate = `${base}_${suffix}`
    suffix += 1
  }

  usedNames.add(candidate)
  return candidate
}

const formatMcpContentPart = (part: unknown) => {
  if (!part || typeof part !== 'object') {
    return ''
  }

  const record = part as Record<string, unknown>
  if (record.type === 'text' && typeof record.text === 'string') {
    return record.text.trim()
  }

  if (record.type === 'resource' && record.resource && typeof record.resource === 'object') {
    const resource = record.resource as Record<string, unknown>
    if (typeof resource.text === 'string') {
      return resource.text.trim()
    }
  }

  if (record.type === 'resource_link' && typeof record.uri === 'string') {
    return [record.name, record.uri].filter((item): item is string => typeof item === 'string' && item.trim().length > 0).join(' - ')
  }

  if (record.type === 'image') {
    return '[image]'
  }

  if (record.type === 'audio') {
    return '[audio]'
  }

  return ''
}

const formatMcpToolResult = (result: Awaited<ReturnType<Client['callTool']>>) => {
  if ('toolResult' in result) {
    if (typeof result.toolResult === 'string') {
      return result.toolResult.trim() || '工具已执行完成，但没有返回可展示的文本结果。'
    }

    return result.toolResult === undefined
      ? '工具已执行完成，但没有返回可展示的文本结果。'
      : JSON.stringify(result.toolResult, null, 2)
  }

  const content = Array.isArray(result.content)
    ? result.content.map(formatMcpContentPart).filter(Boolean).join('\n\n').trim()
    : ''
  if (content) {
    return content
  }

  if ('structuredContent' in result && result.structuredContent !== undefined) {
    return JSON.stringify(result.structuredContent, null, 2)
  }

  return '工具已执行完成，但没有返回可展示的文本结果。'
}

const createMcpTransport = (server: MaterializedMcpServer) => {
  if (typeof server.command === 'string' && server.command.trim()) {
    return new StdioClientTransport({
      command: 'sh',
      args: ['-lc', server.command.trim()],
      env: buildAgentRuntimeEnvironment(),
    })
  }

  if (!server.url?.trim()) {
    return null
  }

  const headers = server.headers ?? {}
  const url = new URL(server.url)
  if (server.type === 'remote' && /\/sse(?:$|[/?#])/i.test(url.pathname)) {
    return new SSEClientTransport(url, {
      requestInit: Object.keys(headers).length > 0 ? { headers } : undefined,
    })
  }

  return new StreamableHTTPClientTransport(url, {
    requestInit: Object.keys(headers).length > 0 ? { headers } : undefined,
  })
}

const createPiMcpTool = (params: {
  client: Client
  serverName: string
  toolName: string
  description?: string
  inputSchema?: unknown
  exposedToolName: string
}) => {
  const label = `${params.serverName} · ${params.toolName}`
  return defineTool({
    name: params.exposedToolName,
    label,
    description: params.description?.trim() || `${params.serverName} MCP tool: ${params.toolName}`,
    promptSnippet: params.description?.trim() || `${params.serverName} MCP tool: ${params.toolName}`,
    parameters: (params.inputSchema ?? {
      type: 'object',
      properties: {},
      additionalProperties: true,
    }) as never,
    execute: async (_toolCallId, input) => {
      const result = await params.client.callTool({
        name: params.toolName,
        arguments: input as Record<string, unknown>,
      })
      const text = formatMcpToolResult(result)

      if (result.isError) {
        throw new Error(text)
      }

      return {
        content: [{ type: 'text', text }],
        details: {
          serverName: params.serverName,
          toolName: params.toolName,
          structuredContent: 'structuredContent' in result ? result.structuredContent : undefined,
        },
      }
    },
  })
}

const connectServerTools = async (params: {
  exposedToolNames: Set<string>
  materializedServer: MaterializedMcpServer
  serverPolicy: McpServerPolicy
}) => {
  const transport = createMcpTransport(params.materializedServer)
  if (!transport) {
    return {
      client: null,
      tools: [] as ToolDefinition[],
      warning: `${params.serverPolicy.name} 缺少可连接的 MCP transport，已跳过。`,
    }
  }

  const client = new Client({
    name: 'vibemux-pi-mcp',
    version: '0.1.8',
  })

  await client.connect(transport)
  const response = await client.listTools()
  const tools = response.tools.map((tool) => createPiMcpTool({
    client,
    serverName: params.serverPolicy.name,
    toolName: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema,
    exposedToolName: buildPiToolName(params.serverPolicy.name, tool.name, params.exposedToolNames),
  }))

  return {
    client,
    tools,
    warning: undefined,
  }
}

export const createPiMcpTools = async (params: {
  actingUserId?: string
  runtimeAgentId?: string
  workspaceId?: string
  mcpServers?: McpServerPolicy[]
  workerConfig?: WorkerConfig
}): Promise<PiMcpToolsResult> => {
  const config = params.workerConfig ?? loadWorkerRuntimeConfig()
  const exposedToolNames = new Set<string>()
  const warnings: string[] = []
  const clients: Client[] = []
  const tools: ToolDefinition[] = []
  const servers = params.mcpServers?.filter((server) => server.enabled && server.capabilityMode === 'resources+tools') ?? []
  const materializedServers = materializeMcpServersForOpencode(servers, {
    cloudUrl: config.cloudUrl,
    executorToken: config.executorToken,
    actingUserId: params.actingUserId,
    runtimeAgentId: params.runtimeAgentId,
    workspaceId: params.workspaceId,
  })

  for (const serverPolicy of servers) {
    const materialized = materializedServers[serverPolicy.id] as MaterializedMcpServer | undefined
    if (!materialized) {
      warnings.push(`${serverPolicy.name} 无法物化为 Pi MCP bridge，已跳过。`)
      continue
    }

    try {
      const connected = await connectServerTools({
        exposedToolNames,
        materializedServer: materialized,
        serverPolicy,
      })
      if (connected.warning) {
        warnings.push(connected.warning)
      }
      if (connected.client) {
        clients.push(connected.client)
      }
      tools.push(...connected.tools)
    } catch (error) {
      warnings.push(`${serverPolicy.name} MCP bridge 连接失败：${error instanceof Error ? error.message : 'unknown error'}`)
    }
  }

  return {
    tools,
    cleanup: async () => {
      await Promise.allSettled(clients.map((client) => client.close()))
    },
    warnings,
  }
}
