/**
 * [INPUT]: 消息现有 reactions、目标 emoji、操作者 userId 与开关（active=true 添加，false 移除）。
 * [OUTPUT]: 更新后的 MessageReaction[]（空 reaction 条目被剔除）。
 * [POS]: Pure shared message-reaction toggle contract; no runtime side effects.
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */

import type { MessageReaction } from './thread-message'

/**
 * toggle 单条消息上某个 emoji 的用户反应。
 * - active=true：把 userId 加入该 emoji 的 userIds（已存在则幂等）
 * - active=false：移除 userId；该 emoji 无用户后整条 reaction 剔除
 * 返回新数组，不修改入参。
 */
export const toggleMessageReaction = (
  reactions: MessageReaction[] | undefined,
  emoji: string,
  userId: string,
  active: boolean,
): MessageReaction[] => {
  const normalizedEmoji = emoji.trim()
  if (!normalizedEmoji || !userId.trim()) {
    return reactions ?? []
  }

  const next = (reactions ?? []).map((reaction) => ({ emoji: reaction.emoji, userIds: [...reaction.userIds] }))
  const index = next.findIndex((reaction) => reaction.emoji === normalizedEmoji)

  if (active) {
    if (index >= 0) {
      const current = next[index]
      if (!current.userIds.includes(userId)) {
        next[index] = { ...current, userIds: [...current.userIds, userId] }
      }
    } else {
      next.push({ emoji: normalizedEmoji, userIds: [userId] })
    }
  } else if (index >= 0) {
    const current = next[index]
    const remaining = current.userIds.filter((item) => item !== userId)
    if (remaining.length === 0) {
      next.splice(index, 1)
    } else {
      next[index] = { ...current, userIds: remaining }
    }
  }

  return next
}

/** 查询某用户是否已对某 emoji 点过（供 UI 高亮与幂等判断）。 */
export const hasMessageReaction = (
  reactions: MessageReaction[] | undefined,
  emoji: string,
  userId: string,
): boolean => {
  return (reactions ?? []).some((reaction) => (
    reaction.emoji === emoji && reaction.userIds.includes(userId)
  ))
}
