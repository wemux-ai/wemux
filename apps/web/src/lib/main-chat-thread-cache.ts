/**
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 * [INPUT]: main-chat 会话冷加载页（messages + hasMoreBefore），由 useChatRouteState 写入
 * [OUTPUT]: 会话级消息缓存（模块级内存单例，跨 /chat 路由挂载存活）
 * [POS]: /chat 路由重挂载/会话切换时的瞬时渲染来源；冷加载仍由 useThread + HTTP 驱动，
 *        缓存只做「先渲染旧内容、后台静默刷新」的衔接层，不是数据权威
 */
import type { ChatMessage } from '@shared/types'
import {
  invalidateTtlCache,
  readTtlCache,
  writeTtlCache,
  type TtlCache,
} from './ttl-cache'

export type MainChatThreadCachePage = {
  messages: ChatMessage[]
  hasMoreBefore: boolean
}

export const MAIN_CHAT_THREAD_CACHE_TTL_MS = 5 * 60_000
export const MAX_MAIN_CHAT_THREAD_CACHE_ENTRIES = 20

export const mainChatThreadCache: TtlCache<MainChatThreadCachePage> = new Map()

export const readMainChatThreadCache = (
  cache: TtlCache<MainChatThreadCachePage>,
  sessionId: string,
  now = Date.now(),
) => {
  return readTtlCache(cache, sessionId, MAIN_CHAT_THREAD_CACHE_TTL_MS, now)
}

export const writeMainChatThreadCache = (
  cache: TtlCache<MainChatThreadCachePage>,
  sessionId: string,
  page: MainChatThreadCachePage,
  now = Date.now(),
  maxSize = MAX_MAIN_CHAT_THREAD_CACHE_ENTRIES,
) => {
  writeTtlCache(cache, sessionId, page, now, maxSize)
}

export const invalidateMainChatThreadCache = (
  cache: TtlCache<MainChatThreadCachePage>,
  sessionId: string,
) => {
  invalidateTtlCache(cache, sessionId)
}
