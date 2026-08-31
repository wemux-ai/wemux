// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
import { getEnv } from '@shared/env'
// [INPUT]: JSON-RPC stdin, connector bridge environment, persisted worker pairing.
// [OUTPUT]: Authenticated JSON-RPC forwarding to the Wemux connector proxy (/api/connector/mcp).
// [POS]: Worker official-connector stdio bridge; lets runtimes without remote MCP headers (e.g. Codex) use the connector.

import { getWorkerDefaultCloudUrl } from '../core/app-root'
import { loadWorkerConfig } from '../core/config'
import { trimTrailingSlash } from '../control-plane/cloud-url'
import { parseSsePayload } from './mcp-stdio'

const readText = async (response: Response) => response.text().catch(() => '')

const resolveBridgeConfig = () => {
  const config = loadWorkerConfig()
  const cloudUrl = getEnv('WEMUX_MCP_CLOUD_URL')?.trim() || config.cloudUrl || getWorkerDefaultCloudUrl()
  const connectorToken = getEnv('WEMUX_CONNECTOR_TOKEN')?.trim() || ''
  const workspaceId = getEnv('WEMUX_MCP_WORKSPACE')?.trim()
  const actingUserId = getEnv('WEMUX_MCP_ACTING_USER')?.trim()
  const runtimeAgentId = getEnv('WEMUX_MCP_RUNTIME_AGENT')?.trim()

  return {
    url: `${trimTrailingSlash(cloudUrl)}/api/connector/mcp`,
    connectorToken,
    workspaceId,
    actingUserId,
    runtimeAgentId,
  }
}

const writeJsonLine = (payload: unknown) => {
  process.stdout.write(`${JSON.stringify(payload)}\n`)
}

const writeErrorResponse = (id: unknown, message: string) => {
  writeJsonLine({
    jsonrpc: '2.0',
    id: typeof id === 'string' || typeof id === 'number' ? id : null,
    error: {
      code: -32000,
      message,
    },
  })
}

const readMessageId = (rawLine: string) => {
  try {
    const payload = JSON.parse(rawLine) as unknown
    return payload && typeof payload === 'object' && 'id' in payload
      ? (payload as { id?: unknown }).id
      : null
  } catch {
    return null
  }
}

const forwardMessage = async (rawLine: string) => {
  const config = resolveBridgeConfig()
  let payload: unknown

  try {
    payload = JSON.parse(rawLine)
  } catch {
    writeErrorResponse(null, 'Invalid JSON-RPC message.')
    return
  }

  const id = payload && typeof payload === 'object' && 'id' in payload
    ? (payload as { id?: unknown }).id
    : null

  if (!config.connectorToken) {
    writeErrorResponse(id, 'Official connector token is not configured. Set WEMUX_CONNECTOR_TOKEN.')
    return
  }

  let response: Response
  try {
    response = await fetch(config.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        Authorization: `Bearer ${config.connectorToken}`,
        ...(config.workspaceId ? { 'x-wemux-workspace': config.workspaceId } : {}),
        ...(config.actingUserId ? { 'x-wemux-acting-user': config.actingUserId } : {}),
        ...(config.runtimeAgentId ? { 'x-wemux-runtime-agent': config.runtimeAgentId } : {}),
      },
      body: JSON.stringify(payload),
    })
  } catch (error) {
    writeErrorResponse(id, `Wemux connector bridge network error: ${error instanceof Error ? error.message : 'fetch failed'}`)
    return
  }

  const text = await readText(response)
  if (!response.ok) {
    writeErrorResponse(id, `Wemux connector HTTP ${response.status}: ${text || response.statusText}`)
    return
  }

  if (!text.trim()) {
    return
  }

  // Streamable HTTP：`initialize`/`tools/call` 等返回 SSE（event: message + data）；
  // 部分实现直接返回 JSON。SSE 按事件块合并跨行 data 后逐事件输出，避免拆坏 JSON。
  const trimmed = text.trim()
  const isSse = trimmed.startsWith('event:') || trimmed.startsWith('data:')
  if (isSse) {
    for (const data of parseSsePayload(text)) {
      process.stdout.write(`${data}\n`)
    }
    return
  }

  process.stdout.write(`${text.trim()}\n`)
}

export const runMcpConnectorStdioBridge = async () => {
  process.stdin.setEncoding('utf8')

  let buffer = ''
  let pending = Promise.resolve()

  process.stdin.on('data', (chunk) => {
    buffer += chunk
    while (true) {
      const index = buffer.indexOf('\n')
      if (index < 0) {
        break
      }

      const line = buffer.slice(0, index).replace(/\r$/, '').trim()
      buffer = buffer.slice(index + 1)
      if (line) {
        pending = pending.then(() => forwardMessage(line)).catch((error) => {
          writeErrorResponse(readMessageId(line), error instanceof Error ? error.message : 'Wemux connector bridge failed.')
        })
      }
    }
  })

  await new Promise<void>((resolve) => {
    process.stdin.on('end', resolve)
  })

  await pending
}
