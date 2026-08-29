// [INPUT]: 端侧设备 token（device_tokens 表）+ 业务事件（meeting/task/workspace）
// [OUTPUT]: 按设备平台路由到推送 provider（APNs / FCM / Log），离线可达
// [POS]: 推送网关服务层（feature 离线推送衔接）：token 路由 + 事件→通知映射 + provider 抽象
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
import { listDeviceTokens } from '../storage/postgres/device-tokens-store'

/** 推送设备（端侧注册）
 * - ios → APNs token
 * - android → FCM token（海外）/ 厂商通道 token（国内，后续接入）
 */
export type PushDevice = {
  id: string
  userId: string
  platform: 'android' | 'ios'
  token: string
}

/** 一条待推送通知（语义与 inbox 通知一致） */
export type PushNotification = {
  title: string
  body: string
  /** 点击后深链目标（如 wemux://chat 或 /meeting-records） */
  route?: string
  /** 事件类型（诊断/去重） */
  eventType: string
  /** 幂等键（provider 侧去重） */
  idempotencyKey: string
}

/** 单设备发送结果 */
export type PushSendResult = { ok: boolean; error?: string }

/** 推送 provider 抽象：APNs / FCM / 日志 / 测试替身 */
export interface PushProvider {
  readonly platform: 'ios' | 'android'
  /** 发送一条通知；失败返回 { ok: false, error } */
  send(device: PushDevice, notification: PushNotification): Promise<PushSendResult>
}

/** 发送结果汇总 */
export type PushDispatchResult = {
  delivered: number
  failed: number
  errors: string[]
}

/** 事件→推送通知映射（与 inbox eventSemantics 语义对齐，覆盖 feature 批1 事件源） */
export const buildPushNotification = (eventType: string, payload: Record<string, unknown>): PushNotification | null => {
  const title = typeof payload.title === 'string' && payload.title.trim()
    ? payload.title.trim()
    : typeof payload.taskTitle === 'string' && payload.taskTitle.trim()
      ? payload.taskTitle.trim()
      : 'wemux'
  const body = [payload.handoffPrompt, payload.comment, payload.description, payload.transcript]
    .find((candidate) => typeof candidate === 'string' && candidate.trim())
  const bodyText = typeof body === 'string' ? body.slice(0, 120) : '有新动态'

  switch (true) {
    case eventType === 'meeting.segment.valuable':
      return {
        title: '会议记录 · 新价值片段',
        body: bodyText,
        route: '/meeting-records',
        eventType,
        idempotencyKey: `push:${eventType}:${String(payload.segmentId ?? crypto.randomUUID())}`,
      }
    case eventType === 'task.assigned':
      return { title: '新任务指派', body: bodyText, route: '/chat', eventType, idempotencyKey: `push:${eventType}:${String(payload.taskId ?? crypto.randomUUID())}` }
    case eventType === 'task.status.changed':
      return { title: '任务状态更新', body: bodyText, route: '/chat', eventType, idempotencyKey: `push:${eventType}:${String(payload.taskId ?? crypto.randomUUID())}` }
    case eventType === 'workspace.session.completed':
      return { title: '工作区会话完成', body: bodyText, route: '/workspaces', eventType, idempotencyKey: `push:${eventType}:${String(payload.workspaceSessionId ?? crypto.randomUUID())}` }
    case eventType.startsWith('task.comment.'):
      return { title: '任务评论 @ 了你', body: bodyText, route: '/chat', eventType, idempotencyKey: `push:${eventType}:${String(payload.commentId ?? crypto.randomUUID())}` }
    default:
      return null // 未映射事件不推送（不静默吞错：上层记录 skipped）
  }
}

/**
 * 向用户的所有设备推送一条事件通知。
 * - token 路由：查 device_tokens → 按平台分发
 * - provider 可注入（测试用 fake；生产默认 Log + 未配置 APNs/FCM 返回明确错误）
 * - 单设备失败不阻断其余设备（尽量送达）
 */
export const notifyUserPush = async (params: {
  userId: string
  eventType: string
  payload: Record<string, unknown>
  providers?: PushProvider[]
  /** 测试注入：缺省时查 device_tokens 表 */
  devices?: PushDevice[]
}): Promise<PushDispatchResult> => {
  const { userId, eventType, payload, providers, devices } = params
  const result: PushDispatchResult = { delivered: 0, failed: 0, errors: [] }

  const notification = buildPushNotification(eventType, payload)
  if (!notification) {
    return result // 未映射事件：调用方自行决定（记录 skipped）
  }

  const resolvedDevices = devices ?? (await listDeviceTokens(userId)).map((row) => ({
    id: row.id,
    userId,
    platform: row.platform,
    token: row.token,
  }))
  if (resolvedDevices.length === 0) {
    return result // 无设备：静默（端侧未装 App 属正常态）
  }

  const resolver = providers ?? []
  for (const device of resolvedDevices) {
    const provider = resolver.find((candidate) => candidate.platform === device.platform)
    if (!provider) {
      result.failed += 1
      result.errors.push(`${device.platform}:provider-not-configured`)
      continue
    }
    const sendResult = await provider.send(
      { id: device.id, userId, platform: device.platform, token: device.token },
      notification,
    )
    if (sendResult.ok) {
      result.delivered += 1
    } else {
      result.failed += 1
      result.errors.push(`${device.platform}:${sendResult.error ?? 'send-failed'}`)
    }
  }

  return result
}

/** 开发/测试用日志 provider（不真实发送） */
export class LogPushProvider implements PushProvider {
  readonly platform: 'ios' | 'android'
  constructor(platform: 'ios' | 'android') {
    this.platform = platform
  }

  async send(device: PushDevice, notification: PushNotification): Promise<PushSendResult> {
    console.info(`[push:${this.platform}] ${notification.title} → ${device.token.slice(0, 12)}… (${notification.eventType})`)
    return { ok: true }
  }
}

/** 真实 APNs / FCM provider 占位：需要凭据（APNs 证书/密钥、FCM service account），配置后替换 */
export class UnconfiguredPushProvider implements PushProvider {
  readonly platform: 'ios' | 'android'
  constructor(platform: 'ios' | 'android') {
    this.platform = platform
  }

  async send(_device: PushDevice, _notification: PushNotification): Promise<PushSendResult> {
    return { ok: false, error: 'provider-not-configured（需配置 APNs/FCM 凭据）' }
  }
}
