// [INPUT]: 会话标题输入
// [OUTPUT]: 标题建议
// [POS]: 会话标题建议
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

export const buildSessionTitle = (message: string, maxLength = 24) => {
  const normalized = message.trim().replace(/\s+/g, ' ')
  if (!normalized) {
    return '新会话'
  }

  return normalized.length > maxLength ? `${normalized.slice(0, maxLength)}...` : normalized
}
