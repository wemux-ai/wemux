// [INPUT]: 无（纯函数）
// [OUTPUT]: 用户 ID（@username）校验 / 归一化 / 自动生成规则
// [POS]: 用户 ID 跨端契约；唯一性校验在存储层，本模块只定义格式规则
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

/** 用户 ID 修改冷静期：30 天（微信一年一次更严格，这里放宽到 30 天）。 */
export const USERNAME_CHANGE_COOLDOWN_MS = 30 * 24 * 60 * 60 * 1000

export const USERNAME_MIN_LENGTH = 3
export const USERNAME_MAX_LENGTH = 20

/** 允许的字符：小写字母 / 数字 / . _ -；不允许连续分隔符与首尾分隔符（见 isValidUsername）。 */
const USERNAME_BODY_PATTERN = /^[a-z0-9](?:[a-z0-9._-]{1,18}[a-z0-9])?$/i
/** 自动生成时的前缀字符（去掉 ._ - 和元音外保留，避免歧义）。 */
const USERNAME_PREFIX_SANITIZE_PATTERN = /[^a-z0-9]/g

export const isValidUsername = (value: string | null | undefined) => {
  if (typeof value !== 'string') {
    return false
  }
  const normalized = value.trim()
  if (normalized.length < USERNAME_MIN_LENGTH || normalized.length > USERNAME_MAX_LENGTH) {
    return false
  }
  if (!USERNAME_BODY_PATTERN.test(normalized)) {
    return false
  }
  // 不允许连续分隔符（.. / __ / -- / ._ 等）
  if (/[._-]{2,}/.test(normalized)) {
    return false
  }
  return true
}

export const normalizeUsername = (value: string | null | undefined) => (
  typeof value === 'string' ? value.trim().toLowerCase() : ''
)

/** 从邮箱前缀生成候选 ID：小写 + 去特殊字符 + 截断到 16 位（留随机后缀空间）。 */
export const buildUsernameCandidateFromEmail = (email: string | null | undefined) => {
  const prefix = (email || '').split('@')[0]?.toLowerCase().replace(USERNAME_PREFIX_SANITIZE_PATTERN, '') || ''
  const trimmed = prefix.slice(0, USERNAME_MAX_LENGTH - 5)
  return trimmed || `user${Math.floor(1000 + Math.random() * 9000)}`
}

/** 生成带随机后缀的唯一候选（调用方负责去重重试）。 */
export const buildUniqueUsernameCandidate = (email: string | null | undefined, attempt = 0) => {
  const base = buildUsernameCandidateFromEmail(email)
  if (attempt === 0) {
    return base
  }
  const suffix = String(Math.floor(10 ** Math.min(attempt + 1, 4) + Math.random() * (9 * 10 ** Math.min(attempt, 3))))
  return `${base.slice(0, USERNAME_MAX_LENGTH - String(suffix).length)}${suffix}`
}
