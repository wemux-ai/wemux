// [INPUT]: token 生成输入
// [OUTPUT]: 签名/校验结果
// [POS]: Drive 引用附件 token（8a：会话发 Drive 文件给 Agent，Agent 经免鉴权下载 URL 读原文件）
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import { createHmac, timingSafeEqual } from 'node:crypto'
import { resolveSharedTokenSecret } from './token-secret'

/** 引用附件下载 URL 时效：24 小时（worker 物化附件在会话执行时下载，无需长期有效） */
export const DRIVE_ATTACHMENT_TOKEN_TTL_MS = 24 * 60 * 60 * 1000

const signDriveAttachmentPayload = (payload: string, secret: string) => {
  return createHmac('sha256', secret).update(payload).digest('hex').slice(0, 48)
}

/**
 * 生成 Drive 引用附件下载 token（无状态 HMAC：payload = issuedAt:taskId:driveFileId）。
 * taskId / driveFileId 均为 uuid（不含 ':'），split(':') 安全。
 */
export const buildDriveAttachmentToken = (params: {
  taskId: string
  driveFileId: string
  issuedAt?: number
}) => {
  const secret = resolveSharedTokenSecret()
  if (!secret) {
    return ''
  }
  const issuedAt = params.issuedAt ?? Date.now()
  const payload = `${issuedAt}:${params.taskId}:${params.driveFileId}`
  return `${Buffer.from(payload, 'utf8').toString('base64url')}.${signDriveAttachmentPayload(payload, secret)}`
}

/**
 * 校验并解析 Drive 引用附件 token：格式 + HMAC 签名（timing-safe）+ 时效。
 * 校验失败或过期返回 null。
 */
export const parseDriveAttachmentToken = (
  token: string,
  now = Date.now(),
): { taskId: string; driveFileId: string; issuedAt: number } | null => {
  const secret = resolveSharedTokenSecret()
  if (!secret || !token) {
    return null
  }
  const dotIndex = token.indexOf('.')
  if (dotIndex <= 0) {
    return null
  }

  const payloadPart = token.slice(0, dotIndex)
  const signaturePart = token.slice(dotIndex + 1)
  let payload: string
  try {
    payload = Buffer.from(payloadPart, 'base64url').toString('utf8')
  } catch {
    return null
  }

  const expectedSignature = signDriveAttachmentPayload(payload, secret)
  const signatureBuffer = Buffer.from(signaturePart)
  const expectedBuffer = Buffer.from(expectedSignature)
  if (signatureBuffer.length !== expectedBuffer.length || !timingSafeEqual(signatureBuffer, expectedBuffer)) {
    return null
  }

  const [issuedAtRaw, taskId, driveFileId] = payload.split(':')
  const issuedAt = Number(issuedAtRaw)
  if (!Number.isFinite(issuedAt) || !taskId || !driveFileId) {
    return null
  }
  if (now - issuedAt > DRIVE_ATTACHMENT_TOKEN_TTL_MS) {
    return null
  }

  return { taskId, driveFileId, issuedAt }
}
