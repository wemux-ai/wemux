/**
 * [INPUT]: `/chat` 页面发布的聊天未读总量（DM + 主对话 + 群聊会话未读之和）。
 * [OUTPUT]: 全局聊天未读订阅（app 侧边栏 /chat 导航红点）。
 * [POS]: 跨路由聊天未读信号；聊天页实时发布，侧边栏消费，离开页面后保留最后一次值（未读清零需回到聊天页聚焦）。
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */
import { useEffect, useState } from 'react'

let totalChatUnread = 0
const listeners = new Set<(total: number) => void>()

export const setChatTotalUnread = (total: number) => {
  const next = Math.max(0, Math.floor(total))
  if (next === totalChatUnread) {
    return
  }
  totalChatUnread = next
  for (const listener of listeners) {
    listener(totalChatUnread)
  }
}

export const getChatTotalUnread = () => totalChatUnread

export const subscribeChatTotalUnread = (listener: (total: number) => void) => {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function useChatTotalUnread(): number {
  const [total, setTotal] = useState(getChatTotalUnread)
  useEffect(() => subscribeChatTotalUnread(setTotal), [])
  return total
}
