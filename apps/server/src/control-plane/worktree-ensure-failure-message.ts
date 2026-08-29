// [INPUT]: worktree 确保失败消息与 operation event
// [OUTPUT]: 友好失败提示
// [POS]: worktree 失败信息构建
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import type { ExecutorWorkspaceOperationEvent } from '@shared/types'

export const buildWorktreeEnsureFailureMessage = (
  baseMessage: string,
  lastOperationEvent?: ExecutorWorkspaceOperationEvent,
) => {
  const normalizedLastMessage = lastOperationEvent?.message?.trim()
  if (!normalizedLastMessage) {
    return baseMessage
  }

  return `${baseMessage} 最后进度：${normalizedLastMessage}`
}
