// [INPUT]: 状态载荷
// [OUTPUT]: hash 输出
// [POS]: 状态载荷哈希
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

export const hashStatePayload = (payload: string) => {
  let hash = 0x811c9dc5
  for (let index = 0; index < payload.length; index += 1) {
    hash ^= payload.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }

  return `${payload.length.toString(36)}-${(hash >>> 0).toString(36)}`
}
