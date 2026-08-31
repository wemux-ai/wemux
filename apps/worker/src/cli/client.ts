// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
import { getEnv } from '@shared/env'
// [INPUT]: Explicit CLI credentials/URL, persisted worker config, and packaged runtime defaults.
// [OUTPUT]: Authenticated MCP requests to the matching wemux control plane.
// [POS]: Worker CLI HTTP client; production packages must never fall back to preview endpoints.

import { getWorkerDefaultCloudUrl } from '../core/app-root'
import { loadWorkerConfig } from '../core/config'
import { trimTrailingSlash } from '../control-plane/cloud-url'

export type McpToolResult = {
  content: Array<{ type: 'text'; text: string }>
}

export type McpJsonRpcResponse = {
  jsonrpc: '2.0'
  id: string
  result?: {
    content?: Array<{ type: 'text'; text: string }>
    tools?: Array<{
      name: string
      description?: string
      inputSchema?: unknown
    }>
  }
  error?: {
    code: number
    message: string
    data?: unknown
  }
}

export class WemuxClient {
  private baseUrl: string
  private executorToken: string
  private apiToken: string

  constructor(params?: { cloudUrl?: string; executorToken?: string; apiToken?: string }) {
    const config = loadWorkerConfig()
    this.baseUrl = trimTrailingSlash(params?.cloudUrl || config.cloudUrl || getWorkerDefaultCloudUrl())
    this.executorToken = params?.executorToken || config.executorToken || ''
    this.apiToken = params?.apiToken || getEnv('WEMUX_TOKEN')?.trim() || ''
  }

  private async request<T>(body: Record<string, unknown>): Promise<T> {
    if (!this.apiToken && !this.executorToken) {
      throw new Error('CLI authentication is missing. Set WEMUX_TOKEN or pair this worker first.')
    }

    const url = `${this.baseUrl}${this.apiToken ? '/mcp' : '/mcp/executor'}`
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(this.apiToken
          ? { Authorization: `Bearer ${this.apiToken}` }
          : { 'x-executor-token': this.executorToken }),
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: crypto.randomUUID(),
        ...body,
      }),
    })

    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new Error(`HTTP ${res.status}: ${text || res.statusText}`)
    }

    const json: McpJsonRpcResponse = await res.json()
    if (json.error) {
      throw new Error(json.error.message)
    }

    return json.result as T
  }

  async callTool<T = unknown>(name: string, args: Record<string, unknown> = {}): Promise<T> {
    const result = await this.request<{ content?: Array<{ type: 'text'; text: string }> }>({
      method: 'tools/call',
      params: { name, arguments: args },
    })

    const text = result?.content?.[0]?.text
    if (!text) {
      return undefined as T
    }

    try {
      return JSON.parse(text) as T
    } catch {
      return text as T
    }
  }

  async listTools() {
    const result = await this.request<{
      tools?: Array<{ name: string; description?: string; inputSchema?: unknown }>
    }>({
      method: 'tools/list',
      params: {},
    })

    return result?.tools ?? []
  }
}
