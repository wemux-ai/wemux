// [INPUT]: 认证密钥输入
// [OUTPUT]: 加解密结果
// [POS]: 认证密钥管理
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import { resolveSharedTokenSecret } from './token-secret'

const DEV_BETTER_AUTH_SECRET = 'dev-better-auth-secret-change-me'

export const resolveBetterAuthSecret = () => {
  const configuredSecret = process.env.BETTER_AUTH_SECRET?.trim()
  if (configuredSecret) {
    return configuredSecret
  }

  if (process.env.NODE_ENV !== 'production') {
    return resolveSharedTokenSecret() || DEV_BETTER_AUTH_SECRET
  }

  return ''
}

export const assertBetterAuthSecretConfigured = () => {
  if (process.env.BETTER_AUTH_SECRET?.trim()) {
    return
  }

  if (process.env.NODE_ENV !== 'production') {
    return
  }

  throw new Error(
    'BETTER_AUTH_SECRET is required in production. All wemux control-plane nodes must share the same BETTER_AUTH_SECRET, otherwise Better Auth sessions, OAuth flows, and related cross-node auth checks will randomly fail.',
  )
}
