// [INPUT]: An authorized custom Agent plus WeChat iLink QR-login callbacks.
// [OUTPUT]: Short-lived QR binding sessions and persisted iLink bot credentials.
// [POS]: WeChat iLink registration coordinator; it owns no inbound message behavior.
// [PROTOCOL]: Update this header when changing responsibilities, then check AGENTS.md
import { randomUUID } from 'node:crypto'
import { readCustomAgentConfig, writeCustomAgentConfig } from '@shared/custom-agent'
import { agentService } from '../agent/service'
import { syncWechatLongPolling } from './long-polling-service'
import {
  fetchWeixinQrCode,
  pollWeixinQrStatus,
  ILINK_DEFAULT_BASE_URL,
  type WeixinQrStatusResponse,
} from './ilink-api'

type BindingStatus = 'pending' | 'wait' | 'scaned' | 'success' | 'error' | 'expired' | 'need_verifycode' | 'verify_code_blocked'

type BindingSession = {
  agentId: string
  initiatorUserId: string
  status: BindingStatus
  qrCodeUrl: string
  qrcode: string
  baseUrl: string
  expiresAt: number
  message?: string
  pendingVerifyCode?: string
  /** 扫码者的微信 user id（confirmed 后回填） */
  wechatUserId?: string
  /** 中止信号 */
  abort: boolean
  /** 验证码等待门闩：need_verifycode 时等待 submit 唤醒 */
  verifyGate: { promise: Promise<void>; resolve: () => void }
}

const BINDING_TTL_MS = 10 * 60_000
const MAX_QR_REFRESH_COUNT = 3
const sessions = new Map<string, BindingSession>()

const cleanExpiredSessions = () => {
  const now = Date.now()
  for (const [id, session] of sessions) {
    if (session.expiresAt <= now) {
      session.abort = true
      sessions.delete(id)
    }
  }
}

const buildEmptyVerifyGate = () => {
  let resolve: () => void = () => {}
  const promise = new Promise<void>((r) => { resolve = r })
  return { promise, resolve }
}

const createSession = (agentId: string, initiatorUserId: string, qrcode: string, qrCodeUrl: string, baseUrl: string): BindingSession => {
  const session: BindingSession = {
    agentId,
    initiatorUserId,
    status: 'pending',
    qrcode,
    qrCodeUrl,
    baseUrl,
    expiresAt: Date.now() + BINDING_TTL_MS,
    abort: false,
    verifyGate: buildEmptyVerifyGate(),
  }
  return session
}

const saveBoundConfig = (agentId: string, result: WeixinQrStatusResponse) => {
  const current = agentService.getAgent(agentId)
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
        wechat: {
          enabled: true,
          botToken: result.bot_token?.trim() || '',
          botId: result.ilink_bot_id?.trim() || '',
          wechatUserId: result.ilink_user_id?.trim() || '',
          baseUrl: result.baseurl?.trim() || ILINK_DEFAULT_BASE_URL,
        },
      },
    }),
  })
  if (!updated) throw new Error('Agent 不存在。')
  return updated
}

const refreshSessionQr = async (session: BindingSession) => {
  const qr = await fetchWeixinQrCode({ baseUrl: session.baseUrl, localTokenList: [] })
  session.qrcode = qr.qrcode
  session.qrCodeUrl = qr.qrcode_img_content
  session.status = 'pending'
  session.pendingVerifyCode = undefined
  session.expiresAt = Date.now() + BINDING_TTL_MS
}

/**
 * 后台轮询扫码状态（参照官方插件 waitForWeixinLogin 的状态机）：
 * wait/scaned → 继续；need_verifycode → 等待 submitVerifyCode 唤醒；
 * expired/verify_code_blocked → 刷新二维码（最多 3 次）；scaned_but_redirect → 切换 IDC 轮询主机；
 * binded_redirect → 已绑定过；confirmed → 写入 bot 凭证并触发长轮询同步。
 */
const runBindingPollLoop = async (sessionId: string, session: BindingSession) => {
  let qrRefreshCount = 0
  try {
    while (!session.abort && Date.now() < session.expiresAt) {
      const response = await pollWeixinQrStatus({ baseUrl: session.baseUrl, qrcode: session.qrcode, verifyCode: session.pendingVerifyCode })

      switch (response.status) {
        case 'wait':
        case 'scaned': {
          if (session.status !== 'scaned' && response.status === 'scaned') session.status = 'scaned'
          break
        }
        case 'need_verifycode': {
          session.status = 'need_verifycode'
          // 挂起等待验证码提交；submit 后由 verifyGate 唤醒继续轮询
          await session.verifyGate.promise
          session.verifyGate = buildEmptyVerifyGate()
          break
        }
        case 'expired':
        case 'verify_code_blocked': {
          qrRefreshCount += 1
          if (qrRefreshCount > MAX_QR_REFRESH_COUNT) {
            session.status = 'error'
            session.message = '二维码多次失效，连接流程已停止。请稍后再试。'
            session.abort = true
            return
          }
          await refreshSessionQr(session)
          break
        }
        case 'scaned_but_redirect': {
          if (response.redirect_host) {
            session.baseUrl = `https://${response.redirect_host}`
          }
          break
        }
        case 'binded_redirect': {
          session.status = 'error'
          session.message = '该微信号已在其他平台绑定，请先在微信中解除绑定后重试。'
          session.abort = true
          return
        }
        case 'confirmed': {
          if (!response.bot_token?.trim() || !response.ilink_bot_id?.trim()) {
            session.status = 'error'
            session.message = '登录失败：服务器未返回 bot_token / ilink_bot_id。'
            session.abort = true
            return
          }
          saveBoundConfig(session.agentId, response)
          session.status = 'success'
          session.wechatUserId = response.ilink_user_id?.trim()
          session.expiresAt = Date.now() + 30 * 60_000
          syncWechatLongPolling()
          return
        }
        default: {
          session.status = 'error'
          session.message = `未知扫码状态：${response.status}`
          session.abort = true
          return
        }
      }
    }
  } catch (error) {
    session.status = 'error'
    session.message = error instanceof Error ? error.message : '微信扫码绑定失败。'
  } finally {
    if (sessions.get(sessionId) === session) sessions.delete(sessionId)
  }
}

export const beginWechatQrBinding = async (agentId: string, initiatorUserId: string) => {
  cleanExpiredSessions()
  const current = agentService.getAgent(agentId)
  if (!current) throw new Error('Agent 不存在。')
  if (readCustomAgentConfig(current.config).channels.wechat.enabled) {
    throw new Error('当前 Agent 已绑定微信，请先断开再重新绑定。')
  }

  const sessionId = randomUUID()
  const qr = await fetchWeixinQrCode({})
  const session = createSession(agentId, initiatorUserId, qr.qrcode, qr.qrcode_img_content, ILINK_DEFAULT_BASE_URL)
  sessions.set(sessionId, session)
  void runBindingPollLoop(sessionId, session)

  return {
    sessionId,
    status: session.status,
    qrCodeUrl: session.qrCodeUrl,
    expiresInSeconds: Math.floor(BINDING_TTL_MS / 1000),
  }
}

export const getWechatQrBindingStatus = (agentId: string, sessionId: string, initiatorUserId: string) => {
  cleanExpiredSessions()
  const session = sessions.get(sessionId)
  if (!session || session.agentId !== agentId || session.initiatorUserId !== initiatorUserId) {
    return null
  }
  const expired = Date.now() >= session.expiresAt
  return {
    sessionId,
    status: expired && session.status !== 'success' ? 'expired' : session.status,
    qrCodeUrl: session.qrCodeUrl,
    message: session.message,
    wechatUserId: session.wechatUserId,
    requiresVerifyCode: session.status === 'need_verifycode',
  }
}

export const submitWechatVerifyCode = (agentId: string, sessionId: string, initiatorUserId: string, verifyCode: string) => {
  const session = sessions.get(sessionId)
  if (!session || session.agentId !== agentId || session.initiatorUserId !== initiatorUserId) {
    return null
  }
  if (session.status !== 'need_verifycode') {
    return { ok: false, message: '当前绑定不处于需要验证码的状态。' }
  }
  session.pendingVerifyCode = verifyCode.trim()
  session.status = 'scaned'
  session.verifyGate.resolve()
  return { ok: true }
}

export const cancelWechatQrBindings = (agentId: string) => {
  for (const [sessionId, session] of sessions) {
    if (session.agentId === agentId) {
      session.abort = true
      session.verifyGate.resolve()
      sessions.delete(sessionId)
    }
  }
}
