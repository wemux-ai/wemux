// [INPUT]: 配对错误输入
// [OUTPUT]: 错误类型
// [POS]: 配对错误
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

const PAIRING_ERROR_MAP = new Map<string, string>([
  ['配对码已使用。', 'This pairing code has already been used.'],
  ['配对码已过期。', 'This pairing code has expired.'],
  ['配对码不存在。', 'This pairing code does not exist.'],
])

const STALE_PAIRING_ERRORS = new Set<string>([
  'This pairing code has already been used.',
  'This pairing code has expired.',
  'This pairing code does not exist.',
])

export const normalizePairingErrorMessage = (message: string) => {
  const normalized = message.trim()
  return PAIRING_ERROR_MAP.get(normalized) || normalized
}

export const isStalePairingCodeError = (message: string) => {
  return STALE_PAIRING_ERRORS.has(normalizePairingErrorMessage(message))
}

export const buildSavedPairingRestartHint = () => {
  return 'This worker is already paired locally. If you only want to reconnect after a restart, start the worker again without `connect --pairing-code ...`.'
}

export const buildConnectPairingFailureMessage = (message: string, hasSavedPairing: boolean) => {
  const normalized = normalizePairingErrorMessage(message)
  if (!hasSavedPairing || !isStalePairingCodeError(normalized)) {
    return normalized
  }

  return `${normalized} ${buildSavedPairingRestartHint()}`
}

export const buildMissingPairingCodeMessage = (hasSavedPairing: boolean) => {
  if (!hasSavedPairing) {
    return 'Missing required flag: --pairing-code'
  }

  return `${buildSavedPairingRestartHint()} Use \`connect --pairing-code <CODE>\` only when you want to pair this machine for the first time or move it to a different account.`
}
