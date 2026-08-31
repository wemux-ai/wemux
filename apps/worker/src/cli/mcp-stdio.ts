// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
import { getEnv } from '@shared/env'
// [INPUT]: JSON-RPC stdin, MCP environment overrides, persisted worker pairing, and packaged defaults.
// [OUTPUT]: Authenticated JSON-RPC forwarding to the matching control-plane MCP endpoint.
// [POS]: Worker MCP stdio bridge; preserves per-agent context without crossing preview/production endpoints.

import { getWorkerDefaultCloudUrl } from '../core/app-root'
import { loadWorkerConfig } from '../core/config'
import { trimTrailingSlash } from '../control-plane/cloud-url'

const readText = async (response: Response) => response.text().catch(() => '')

/**
 * 解析 Streamable HTTP 的 SSE 响应为事件 data 列表（纯函数，可单测）：
 * 按空行分块，合并同一事件的多行 `data:`（SSE 规范以 \n 拼接），过滤 [DONE]。
 */
export const parseSsePayload = (text: string): string[] => {
  const results: string[] = []
  for (const block of text.split(/\r?\n\r?\n/)) {
    const dataLines = block
      .split(/\r?\n/)
      .filter((line) => line.startsWith('data:'))
    if (dataLines.length === 0) {
      continue
    }
    const data = dataLines
      .map((line) => line.slice('data:'.length).trim())
      .join('\n')
    if (data && data !== '[DONE]') {
      results.push(data)
    }
  }
  return results
}

const resolveBridgeConfig = () => {
  const config = loadWorkerConfig()
  const cloudUrl = getEnv('WEMUX_MCP_CLOUD_URL')?.trim() || config.cloudUrl || getWorkerDefaultCloudUrl()
  const executorToken = getEnv('WEMUX_MCP_EXECUTOR_TOKEN')?.trim() || config.executorToken || ''
  const actingUserId = getEnv('WEMUX_MCP_ACTING_USER')?.trim()
  const runtimeAgentId = getEnv('WEMUX_MCP_RUNTIME_AGENT')?.trim()

  return {
    url: `${trimTrailingSlash(cloudUrl)}/mcp/executor`,
    executorToken,
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

  if (!config.executorToken) {
    writeErrorResponse(id, 'Wemux MCP executor token is not configured. Pair this worker or set VIBEMUX_MCP_EXECUTOR_TOKEN.')
    return
  }

  let response: Response
  try {
    response = await fetch(config.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        'x-executor-token': config.executorToken,
        ...(config.actingUserId ? { 'x-wemux-acting-user': config.actingUserId } : {}),
        ...(config.runtimeAgentId ? { 'x-wemux-runtime-agent': config.runtimeAgentId } : {}),
      },
      body: JSON.stringify(payload),
    })
  } catch (error) {
    writeErrorResponse(id, `Wemux MCP bridge network error: ${error instanceof Error ? error.message : 'fetch failed'}`)
    return
  }

  const text = await readText(response)
  if (!response.ok) {
    writeErrorResponse(id, `Wemux MCP HTTP ${response.status}: ${text || response.statusText}`)
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

export const runMcpStdioBridge = async () => {
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
          writeErrorResponse(readMessageId(line), error instanceof Error ? error.message : 'Wemux MCP bridge failed.')
        })
      }
    }
  })

  await new Promise<void>((resolve) => {
    process.stdin.on('end', resolve)
  })

  await pending
}
