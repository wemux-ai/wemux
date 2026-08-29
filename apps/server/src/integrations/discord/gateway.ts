// [INPUT]: 已启用 Discord 渠道的 Agent bot token 与入站消息处理器。
// [OUTPUT]: 每 Agent 一个 Discord Gateway v10 WebSocket 长连接（hello/heartbeat/identify/dispatch）。
// [POS]: Discord 渠道传输运行时；业务消息处理由服务层注入（镜像 feishu long-connection-service）。
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
import { WebSocket } from 'ws'
import { readCustomAgentConfig } from '@shared/custom-agent'
import { getAllAgents } from '../../repositories/agent'
import { DISCORD_GATEWAY_INTENTS, DISCORD_GATEWAY_URL, parseDiscordMessageCreate, type DiscordMessageEvent } from './discord-api'

type InboundHandler = (params: { agentId: string; event: DiscordMessageEvent }) => Promise<void>

type GatewayEntry = {
  agentId: string
  fingerprint: string
  ws: WebSocket | null
  heartbeatTimer: NodeJS.Timeout | null
  heartbeatAck: boolean
  stopped: boolean
}

const gateways = new Map<string, GatewayEntry>()
let inboundHandler: InboundHandler | null = null

/** 每个 Agent 最近一次入站频道 id（供 channel.send 主动推送定位目标）。 */
const lastChannels = new Map<string, string>()

export const getDiscordLastChannel = (agentId: string) => lastChannels.get(agentId)?.trim() || ''

export const setDiscordLastChannel = (agentId: string, channelId: string) => {
  const channel = channelId.trim()
  if (!channel) return
  lastChannels.set(agentId, channel)
}

const connectGateway = (entry: GatewayEntry, token: string) => {
  if (entry.stopped) return
  const ws = new WebSocket(DISCORD_GATEWAY_URL)
  entry.ws = ws
  let heartbeatIntervalMs = 41_250

  ws.on('open', () => {
    // hello 后服务端会下发 heartbeat_interval；先按默认值启动兜底心跳
  })

  ws.on('message', (raw) => {
    let payload: { op?: number; d?: unknown; t?: string; s?: number }
    try {
      payload = JSON.parse(String(raw)) as typeof payload
    } catch {
      return
    }
    switch (payload.op) {
      case 10: { // HELLO
        const hello = payload.d as { heartbeat_interval?: number }
        heartbeatIntervalMs = hello.heartbeat_interval ?? 41_250
        startHeartbeat(entry, heartbeatIntervalMs)
        ws.send(JSON.stringify({
          op: 2,
          d: {
            token,
            intents: DISCORD_GATEWAY_INTENTS,
            properties: { $os: 'linux', $browser: 'wemux', $device: 'wemux' },
          },
        }))
        break
      }
      case 1: { // HEARTBEAT
        entry.heartbeatAck = true
        ws.send(JSON.stringify({ op: 1, d: null }))
        break
      }
      case 11: { // HEARTBEAT_ACK
        entry.heartbeatAck = true
        break
      }
      case 0: { // DISPATCH
        if (payload.t === 'MESSAGE_CREATE') {
          const event = parseDiscordMessageCreate(payload.d)
          if (event) {
            setDiscordLastChannel(entry.agentId, event.channelId)
            void inboundHandler?.({ agentId: entry.agentId, event }).catch((error) => {
              console.error(`[discord] Inbound failed for ${entry.agentId}:`, error)
            })
          }
        }
        break
      }
    }
  })

  ws.on('close', () => {
    stopHeartbeat(entry)
    entry.ws = null
    if (!entry.stopped) {
      setTimeout(() => connectGateway(entry, token), 5000)
    }
  })

  ws.on('error', (error) => {
    console.warn(`[discord] Gateway error for ${entry.agentId}:`, error.message)
  })
}

const startHeartbeat = (entry: GatewayEntry, intervalMs: number) => {
  stopHeartbeat(entry)
  entry.heartbeatTimer = setInterval(() => {
    if (entry.ws?.readyState === WebSocket.OPEN) {
      entry.heartbeatAck = false
      entry.ws.send(JSON.stringify({ op: 1, d: null }))
      // 连续两次未 ACK 视为断线，关闭触发重连
      setTimeout(() => {
        if (!entry.heartbeatAck && entry.ws) entry.ws.close()
      }, intervalMs + 5000)
    }
  }, intervalMs)
}

const stopHeartbeat = (entry: GatewayEntry) => {
  if (entry.heartbeatTimer) {
    clearInterval(entry.heartbeatTimer)
    entry.heartbeatTimer = null
  }
}

export const startDiscordGateways = (handler: InboundHandler) => {
  inboundHandler = handler
  syncDiscordGateways()
}

export const syncDiscordGateways = () => {
  if (!inboundHandler) return
  const desired = new Map<string, { fingerprint: string; token: string }>()
  for (const agent of getAllAgents()) {
    const discord = readCustomAgentConfig(agent.config).channels.discord
    if (!discord.enabled || !discord.botToken.trim()) continue
    desired.set(agent.id, { fingerprint: discord.botToken.trim(), token: discord.botToken.trim() })
  }

  for (const [agentId, entry] of gateways) {
    if (desired.get(agentId)?.fingerprint !== entry.fingerprint) {
      entry.stopped = true
      stopHeartbeat(entry)
      entry.ws?.close()
      gateways.delete(agentId)
    }
  }

  for (const [agentId, config] of desired) {
    if (gateways.has(agentId)) continue
    const entry: GatewayEntry = { agentId, fingerprint: config.fingerprint, ws: null, heartbeatTimer: null, heartbeatAck: true, stopped: false }
    gateways.set(agentId, entry)
    connectGateway(entry, config.token)
  }
}

export const stopDiscordGateways = () => {
  for (const entry of gateways.values()) {
    entry.stopped = true
    stopHeartbeat(entry)
    entry.ws?.close()
  }
  gateways.clear()
  inboundHandler = null
}

/** 供测试/诊断：当前活跃 gateway 数。 */
export const getDiscordGatewayCount = () => gateways.size
