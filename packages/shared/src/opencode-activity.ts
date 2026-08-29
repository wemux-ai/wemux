// [INPUT]: OpenCode 活动输入
// [OUTPUT]: 活动状态
// [POS]: OpenCode 活动
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

export type OpenCodeInactivityTracker = {
  markActivity: () => number
  getLastActivityAt: () => number
  getElapsedSinceActivity: () => number
  getRemainingMs: () => number
  hasTimedOut: () => boolean
}

export const createOpenCodeInactivityTracker = (
  timeoutMs: number,
  getNow: () => number = () => Date.now(),
): OpenCodeInactivityTracker => {
  let lastActivityAt = getNow()

  return {
    markActivity: () => {
      lastActivityAt = getNow()
      return lastActivityAt
    },
    getLastActivityAt: () => lastActivityAt,
    getElapsedSinceActivity: () => Math.max(0, getNow() - lastActivityAt),
    getRemainingMs: () => Math.max(0, timeoutMs - (getNow() - lastActivityAt)),
    hasTimedOut: () => (getNow() - lastActivityAt) >= timeoutMs,
  }
}
