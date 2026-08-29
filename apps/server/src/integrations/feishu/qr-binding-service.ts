// [INPUT]: An authorized custom Agent plus Feishu device-registration callbacks.
// [OUTPUT]: Short-lived QR session state and persisted long-connection credentials.
// [POS]: Feishu registration coordinator; it owns no inbound message behavior.
// [PROTOCOL]: Update this header when changing responsibilities, then check AGENTS.md.
import { randomUUID } from 'node:crypto'
import * as Lark from '@larksuiteoapi/node-sdk'
import { readCustomAgentConfig, writeCustomAgentConfig } from '@shared/custom-agent'
import { agentService } from '../agent/service'
import type { AgentRecord } from '../../repositories/agent'
import { syncFeishuLongConnections } from './long-connection-service'

type BindingSession = {
  agentId: string
  initiatorUserId: string
  status: 'pending' | 'success' | 'error'
  qrCodeUrl: string
  expiresInSeconds: number
  expiresAt: number
  message?: string
}

const sessions = new Map<string, BindingSession>()
const cleanExpiredSessions = () => {
  const now = Date.now()
  for (const [id, session] of sessions) if (session.expiresAt <= now) sessions.delete(id)
}

export const beginFeishuQrBinding = async (agent: AgentRecord, initiatorUserId: string) => {
  cleanExpiredSessions()
  if (readCustomAgentConfig(agent.config).channels.feishu.connectionMode === 'long-connection') {
    throw new Error('当前 Agent 已绑定飞书。')
  }
  const sessionId = randomUUID()
  let resolveReady: ((session: BindingSession) => void) | null = null
  const ready = new Promise<BindingSession>((resolve) => { resolveReady = resolve })
  const session: BindingSession = { agentId: agent.id, initiatorUserId, status: 'pending', qrCodeUrl: '', expiresInSeconds: 0, expiresAt: Date.now() + 10 * 60_000 }
  sessions.set(sessionId, session)

  void Lark.registerApp({
    source: 'vibemux',
    createOnly: true,
    appPreset: { name: `${agent.name} - wemux`, desc: 'wemux Agent' },
    addons: {
      events: { items: { tenant: ['im.message.receive_v1'] } },
      scopes: { tenant: ['im:message:send_as_bot', 'im:message.group_at_msg:readonly', 'im:message.p2p_msg:readonly'] },
    },
    onQRCodeReady: ({ url, expireIn }) => {
      session.qrCodeUrl = url
      session.expiresInSeconds = expireIn
      session.expiresAt = Date.now() + expireIn * 1000
      resolveReady?.(session)
    },
  }).then((result) => {
    if (sessions.get(sessionId) !== session) {
      throw new Error('飞书绑定已取消。')
    }
    const current = agentService.getAgent(agent.id)
    if (!current) throw new Error('Agent 不存在。')
    const profile = readCustomAgentConfig(current.config)
    const updated = agentService.updateAgent(current.id, {
      name: current.name,
      type: current.type,
      endpoint: current.endpoint,
      ownerUserId: current.ownerUserId,
      config: writeCustomAgentConfig(current.config, {
        ...profile,
        channels: {
          ...profile.channels,
          feishu: {
            enabled: true,
            connectionMode: 'long-connection',
            appId: result.client_id,
            appSecret: result.client_secret,
            encryptKey: '',
            verificationToken: '',
          },
        },
      }),
    })
    if (!updated) throw new Error('Agent 不存在。')
    session.status = 'success'
    session.expiresAt = Date.now() + 30 * 60_000
    syncFeishuLongConnections()
  }).catch((error: unknown) => {
    session.status = 'error'
    session.message = error instanceof Error ? error.message : '飞书绑定失败。'
    session.expiresAt = Date.now() + 30 * 60_000
  })

  const timer = new Promise<BindingSession>((_, reject) => setTimeout(() => reject(new Error('飞书二维码生成超时。')), 15_000))
  const result = await Promise.race([ready, timer])
  return { sessionId, status: result.status, qrCodeUrl: result.qrCodeUrl, expiresInSeconds: result.expiresInSeconds, message: result.message }
}

export const getFeishuQrBindingStatus = (agentId: string, sessionId: string, initiatorUserId: string) => {
  cleanExpiredSessions()
  const session = sessions.get(sessionId)
  return session?.agentId === agentId && session.initiatorUserId === initiatorUserId
    ? { sessionId, status: session.status, qrCodeUrl: session.qrCodeUrl, expiresInSeconds: session.expiresInSeconds, message: session.message }
    : null
}

export const cancelFeishuQrBindings = (agentId: string) => {
  for (const [sessionId, session] of sessions) {
    if (session.agentId === agentId) {
      sessions.delete(sessionId)
    }
  }
}
