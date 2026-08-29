// [INPUT]: 已启用钉钉 Stream 模式的 Agent 凭证与入站消息处理器。
// [OUTPUT]: 每 Agent 一个钉钉 Stream 模式 WebSocket 长连接（免公网收消息，ACK 回发）。
// [POS]: 钉钉渠道传输运行时；业务消息处理由服务层注入（镜像 feishu long-connection-service）。
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
import { WebSocket } from 'ws'
import { readCustomAgentConfig } from '@shared/custom-agent'
import { getAllAgents } from '../../repositories/agent'
import { openDingtalkStreamConnection, parseDingtalkRobotMessage, parseDingtalkStreamEvent, type DingtalkRobotMessage } from './dingtalk-api'

type InboundHandler = (params: { agentId: string; message: DingtalkRobotMessage; text: string }) => Promise<void>

type StreamEntry = {
  agentId: string
  fingerprint: string
  ws: WebSocket | null
  stopped: boolean
}

const streams = new Map<string, StreamEntry>()
let inboundHandler: InboundHandler | null = null

/** 每个 Agent 最近一次入站对端 staffId（供 channel.send 主动推送定位目标）。 */
const lastPeers = new Map<string, string>()

export const getDingtalkLastPeer = (agentId: string) => lastPeers.get(agentId)?.trim() || ''

export const setDingtalkLastPeer = (agentId: string, staffId: string) => {
  const peer = staffId.trim()
  if (!peer) return
  lastPeers.set(agentId, peer)
}

const connectStream = async (entry: StreamEntry, appKey: string, appSecret: string) => {
  if (entry.stopped) return
  const result = await openDingtalkStreamConnection({ appKey, appSecret })
  if (!result.ok || !result.wsUrl) {
    console.warn(`[dingtalk] Stream connect failed for ${entry.agentId}:`, result.message)
    if (!entry.stopped) setTimeout(() => { void connectStream(entry, appKey, appSecret) }, 10_000)
    return
  }

  const ws = new WebSocket(result.wsUrl)
  entry.ws = ws

  ws.on('message', (raw) => {
    const event = parseDingtalkStreamEvent(String(raw))
    if (!event) return
    // ACK：原样回发（SUCCESS 确认），保证服务端不再重投
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(String(raw))
    }
    const parsed = parseDingtalkRobotMessage(event)
    if (!parsed) return
    setDingtalkLastPeer(entry.agentId, parsed.message.senderStaffId)
    void inboundHandler?.({ agentId: entry.agentId, message: parsed.message, text: parsed.text }).catch((error) => {
      console.error(`[dingtalk] Inbound failed for ${entry.agentId}:`, error)
    })
  })

  ws.on('close', () => {
    entry.ws = null
    if (!entry.stopped) {
      setTimeout(() => { void connectStream(entry, appKey, appSecret) }, 5000)
    }
  })

  ws.on('error', (error) => {
    console.warn(`[dingtalk] Stream error for ${entry.agentId}:`, error.message)
  })
}

export const startDingtalkStreams = (handler: InboundHandler) => {
  inboundHandler = handler
  syncDingtalkStreams()
}

export const syncDingtalkStreams = () => {
  if (!inboundHandler) return
  const desired = new Map<string, { fingerprint: string; appKey: string; appSecret: string }>()
  for (const agent of getAllAgents()) {
    const dingtalk = readCustomAgentConfig(agent.config).channels.dingtalk
    if (!dingtalk.enabled || dingtalk.connectionMode !== 'stream' || !dingtalk.appKey.trim() || !dingtalk.appSecret.trim()) continue
    desired.set(agent.id, { fingerprint: `${dingtalk.appKey}:${dingtalk.appSecret}`, appKey: dingtalk.appKey.trim(), appSecret: dingtalk.appSecret.trim() })
  }

  for (const [agentId, entry] of streams) {
    if (desired.get(agentId)?.fingerprint !== entry.fingerprint) {
      entry.stopped = true
      entry.ws?.close()
      streams.delete(agentId)
    }
  }

  for (const [agentId, config] of desired) {
    if (streams.has(agentId)) continue
    const entry: StreamEntry = { agentId, fingerprint: config.fingerprint, ws: null, stopped: false }
    streams.set(agentId, entry)
    void connectStream(entry, config.appKey, config.appSecret)
  }
}

export const stopDingtalkStreams = () => {
  for (const entry of streams.values()) {
    entry.stopped = true
    entry.ws?.close()
  }
  streams.clear()
  inboundHandler = null
}

/** 供测试/诊断：当前活跃 stream 数。 */
export const getDingtalkStreamCount = () => streams.size
