// [INPUT]: token 生成输入
// [OUTPUT]: 签名结果
// [POS]: token 密钥
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

const DEV_TOKEN_SECRET = 'vibemux-dev-token-secret'

export const resolveSharedTokenSecret = () => {
  const configuredSecret = process.env.TOKEN_SECRET?.trim()
  if (configuredSecret) {
    return configuredSecret
  }

  if (process.env.NODE_ENV !== 'production') {
    return DEV_TOKEN_SECRET
  }

  return ''
}

export const assertSharedTokenSecretConfigured = () => {
  if (resolveSharedTokenSecret()) {
    return
  }

  throw new Error(
    'TOKEN_SECRET is required in production. All wemux control-plane nodes must share the same TOKEN_SECRET, otherwise login, preview access, turnstile cookies, and other signed cross-node tokens will randomly fail.',
  )
}
