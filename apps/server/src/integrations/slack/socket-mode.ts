// [INPUT]: 已启用 Slack 渠道的 Agent 凭证（botToken + appToken）与入站消息处理器。
// [OUTPUT]: 每 Agent 一个 Slack Socket Mode WebSocket 长连接（免公网收事件）。
// [POS]: Slack 渠道传输运行时；业务消息处理由服务层注入（镜像 feishu long-connection-service）。
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
import { WebSocket } from 'ws'
import { readCustomAgentConfig } from '@shared/custom-agent'
import { getAllAgents } from '../../repositories/agent'
import { openSlackSocketModeConnection, parseSlackEventEnvelope, type SlackMessageEvent } from './slack-api'

type InboundHandler = (params: { agentId: string; event: SlackMessageEvent }) => Promise<void>

type SocketEntry = {
  agentId: string
  fingerprint: string
  ws: WebSocket | null
  stopped: boolean
}

const sockets = new Map<string, SocketEntry>()
let inboundHandler: InboundHandler | null = null

/** 每个 Agent 最近一次入站频道 id（供 channel.send 主动推送定位目标）。 */
const lastChannels = new Map<string, string>()

export const getSlackLastChannel = (agentId: string) => lastChannels.get(agentId)?.trim() || ''

export const setSlackLastChannel = (agentId: string, channelId: string) => {
  const channel = channelId.trim()
  if (!channel) return
  lastChannels.set(agentId, channel)
}

const connectSocket = async (entry: SocketEntry, appToken: string) => {
  if (entry.stopped) return
  const result = await openSlackSocketModeConnection(appToken)
  if (!result.ok || !result.url) {
    console.warn(`[slack] Socket Mode connect failed for ${entry.agentId}:`, result.message)
    if (!entry.stopped) setTimeout(() => { void connectSocket(entry, appToken) }, 10_000)
    return
  }

  const ws = new WebSocket(result.url)
  entry.ws = ws

  ws.on('message', (raw) => {
    let envelope: unknown
    try {
      envelope = JSON.parse(String(raw))
    } catch {
      return
    }
    const envelopeData = envelope as { type?: string; payload?: { event?: { type?: string } } }
    // 只处理 events_api；其他（hello/disconnect）忽略
    if (envelopeData.type !== 'events_api') return
    const event = parseSlackEventEnvelope(envelope)
    if (event) {
      setSlackLastChannel(entry.agentId, event.channelId)
      void inboundHandler?.({ agentId: entry.agentId, event }).catch((error) => {
        console.error(`[slack] Inbound failed for ${entry.agentId}:`, error)
      })
    }
  })

  ws.on('close', () => {
    entry.ws = null
    if (!entry.stopped) {
      setTimeout(() => { void connectSocket(entry, appToken) }, 5000)
    }
  })

  ws.on('error', (error) => {
    console.warn(`[slack] Socket error for ${entry.agentId}:`, error.message)
  })
}

export const startSlackSockets = (handler: InboundHandler) => {
  inboundHandler = handler
  syncSlackSockets()
}

export const syncSlackSockets = () => {
  if (!inboundHandler) return
  const desired = new Map<string, { fingerprint: string; appToken: string }>()
  for (const agent of getAllAgents()) {
    const slack = readCustomAgentConfig(agent.config).channels.slack
    if (!slack.enabled || !slack.botToken.trim() || !slack.appToken.trim()) continue
    desired.set(agent.id, { fingerprint: `${slack.botToken}:${slack.appToken}`, appToken: slack.appToken.trim() })
  }

  for (const [agentId, entry] of sockets) {
    if (desired.get(agentId)?.fingerprint !== entry.fingerprint) {
      entry.stopped = true
      entry.ws?.close()
      sockets.delete(agentId)
    }
  }

  for (const [agentId, config] of desired) {
    if (sockets.has(agentId)) continue
    const entry: SocketEntry = { agentId, fingerprint: config.fingerprint, ws: null, stopped: false }
    sockets.set(agentId, entry)
    void connectSocket(entry, config.appToken)
  }
}

export const stopSlackSockets = () => {
  for (const entry of sockets.values()) {
    entry.stopped = true
    entry.ws?.close()
  }
  sockets.clear()
  inboundHandler = null
}

/** 供测试/诊断：当前活跃 socket 数。 */
export const getSlackSocketCount = () => sockets.size
