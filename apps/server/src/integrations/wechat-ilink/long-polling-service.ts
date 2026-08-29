// [INPUT]: Saved QR-bound WeChat iLink credentials (bot token + base URL).
// [OUTPUT]: One managed iLink getupdates long-poll loop per enabled custom Agent.
// [POS]: WeChat iLink transport runtime; business message handling is injected by the service layer.
// [PROTOCOL]: Update this header when changing responsibilities, then check AGENTS.md
import { readCustomAgentConfig } from '@shared/custom-agent'
import { getAllAgents } from '../../repositories/agent'
import { getWeixinUpdates, ILINK_DEFAULT_BASE_URL, type WeixinMessage } from './ilink-api'

type InboundHandler = (params: { agentId: string; message: WeixinMessage }) => Promise<void>

type PollEntry = {
  agentId: string
  fingerprint: string
  cursor: string
  stopped: boolean
}

const pollers = new Map<string, PollEntry>()
let inboundHandler: InboundHandler | null = null

/** 每个 Agent 最近一次入站对端微信用户 id（供 channel.send 主动推送定位目标）。 */
const lastPeers = new Map<string, string>()

export const getWechatLastPeer = (agentId: string) => lastPeers.get(agentId)?.trim() || ''

export const setWechatLastPeer = (agentId: string, peerUserId: string) => {
  const peer = peerUserId.trim()
  if (!peer) return
  lastPeers.set(agentId, peer)
}

const resolveWechatConfig = (agentId: string) => {
  const agent = getAllAgents().find((item) => item.id === agentId)
  if (!agent) return null
  const wechat = readCustomAgentConfig(agent.config).channels.wechat
  if (!wechat.enabled || !wechat.botToken.trim()) return null
  return wechat
}

const runPollLoop = (entry: PollEntry, token: string, baseUrl: string) => {
  void (async () => {
    let cursor = ''
    let consecutiveErrors = 0
    while (!entry.stopped) {
      try {
        const response = await getWeixinUpdates({ baseUrl, token, cursor, timeoutMs: 40_000 })
        consecutiveErrors = 0
        // errcode -14 = 会话超时，重置游标重新长轮询（消息会在新会话里重新可见）。
        if (response.ret !== 0 || response.errcode === -14) {
          cursor = ''
          continue
        }
        cursor = response.get_updates_buf ?? cursor
        for (const message of response.msgs ?? []) {
          if (entry.stopped) break
          const messageId = message.message_id
          const fromUserId = message.from_user_id?.trim()
          const isUserMessage = message.message_type === 1
          const isNewMessage = message.message_state === undefined || message.message_state === 0
          if (!messageId || !fromUserId || !isUserMessage || !isNewMessage) continue
          setWechatLastPeer(entry.agentId, fromUserId)
          void inboundHandler?.({ agentId: entry.agentId, message }).catch((error) => {
            console.error(`[wechat-ilink] Long poll inbound failed for ${entry.agentId}:`, error)
          })
        }
        // 长轮询结束后立即续拉（服务端 hold 约 35s，这里不留额外间隔）
      } catch (error) {
        consecutiveErrors += 1
        const backoffMs = Math.min(1000 * 2 ** Math.min(consecutiveErrors, 5), 30_000)
        console.warn(`[wechat-ilink] getupdates failed for ${entry.agentId} (retry in ${backoffMs}ms):`, error)
        await new Promise((resolve) => setTimeout(resolve, backoffMs))
      }
    }
  })()
}

export const startWechatLongPolling = (handler: InboundHandler) => {
  inboundHandler = handler
  syncWechatLongPolling()
}

export const syncWechatLongPolling = () => {
  if (!inboundHandler) return
  const desired = new Map<string, { fingerprint: string; token: string; baseUrl: string }>()
  for (const agent of getAllAgents()) {
    const wechat = readCustomAgentConfig(agent.config).channels.wechat
    if (!wechat.enabled || !wechat.botToken.trim()) continue
    desired.set(agent.id, {
      fingerprint: `${wechat.botToken}:${wechat.baseUrl || ILINK_DEFAULT_BASE_URL}`,
      token: wechat.botToken.trim(),
      baseUrl: wechat.baseUrl.trim() || ILINK_DEFAULT_BASE_URL,
    })
  }

  for (const [agentId, entry] of pollers) {
    if (desired.get(agentId)?.fingerprint !== entry.fingerprint) {
      entry.stopped = true
      pollers.delete(agentId)
    }
  }

  for (const [agentId, config] of desired) {
    if (pollers.has(agentId)) continue
    const entry: PollEntry = { agentId, fingerprint: config.fingerprint, cursor: '', stopped: false }
    pollers.set(agentId, entry)
    runPollLoop(entry, config.token, config.baseUrl)
  }
}

export const stopWechatLongPolling = () => {
  for (const entry of pollers.values()) entry.stopped = true
  pollers.clear()
  inboundHandler = null
}

/** 供测试/诊断使用：当前活跃轮询数。 */
export const getWechatPollCount = () => pollers.size

export const resolveWechatChannelConfig = (agentId: string) => resolveWechatConfig(agentId)
