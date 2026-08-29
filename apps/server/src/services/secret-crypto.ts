// [INPUT]: 敏感数据
// [OUTPUT]: 加密/解密
// [POS]: 密钥加密工具
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'
import os from 'node:os'

const ALGORITHM = 'aes-256-gcm'
const IV_LENGTH = 16
const AUTH_TAG_LENGTH = 16
const ENCRYPTION_KEY_BYTES = 32
let hasLoggedDevFallback = false

const getSecretEncryptionKey = () => {
  const rawKey = process.env.SECRET_ENCRYPTION_KEY?.trim() || process.env.GIT_CREDENTIAL_KEY?.trim() || ''
  if (!rawKey) {
    if (process.env.NODE_ENV === 'development') {
      if (!hasLoggedDevFallback) {
        hasLoggedDevFallback = true
        console.warn('[secret-crypto] SECRET_ENCRYPTION_KEY is missing; using development fallback key.')
      }

      return createHash('sha256')
        .update(`vibemux-dev:${os.homedir()}:${process.cwd()}`)
        .digest()
        .subarray(0, ENCRYPTION_KEY_BYTES)
    }

    throw new Error('缺少 SECRET_ENCRYPTION_KEY，无法加密敏感凭证。')
  }

  if (!/^[0-9a-fA-F]+$/.test(rawKey)) {
    throw new Error('SECRET_ENCRYPTION_KEY 必须是 32 字节 hex 字符串。')
  }

  const key = Buffer.from(rawKey, 'hex')
  if (key.length !== ENCRYPTION_KEY_BYTES) {
    throw new Error('SECRET_ENCRYPTION_KEY 必须是 32 字节 hex 字符串。')
  }

  return key
}

export const encryptSecret = (plaintext: string) => {
  const iv = randomBytes(IV_LENGTH)
  const cipher = createCipheriv(ALGORITHM, getSecretEncryptionKey(), iv)
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const authTag = cipher.getAuthTag()
  return Buffer.concat([iv, authTag, encrypted]).toString('base64')
}

export const assertSecretEncryptionKeyConfigured = () => {
  getSecretEncryptionKey()
}

export const decryptSecret = (ciphertext: string) => {
  const payload = Buffer.from(ciphertext, 'base64')
  const iv = payload.subarray(0, IV_LENGTH)
  const authTag = payload.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH)
  const encrypted = payload.subarray(IV_LENGTH + AUTH_TAG_LENGTH)
  const decipher = createDecipheriv(ALGORITHM, getSecretEncryptionKey(), iv)
  decipher.setAuthTag(authTag)
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8')
}
