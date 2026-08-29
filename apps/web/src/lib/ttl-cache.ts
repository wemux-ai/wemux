/**
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 * [INPUT]: 任意 T 值 + 缓存 key
 * [OUTPUT]: 带 TTL / LRU 上限的内存缓存读写（模块级单例由各消费方自持 Map）
 * [POS]: web 端「跨路由挂载存活」的轻量缓存原语；只做先渲染旧值、后台静默刷新的衔接层，
 *        不承担数据权威。main-chat-thread-cache 与 chat-sidebar-cache 均基于它。
 */

export type TtlCacheEntry<T> = {
  value: T
  fetchedAt: number
}

export type TtlCache<T> = Map<string, TtlCacheEntry<T>>

export const readTtlCache = <T>(
  cache: TtlCache<T>,
  key: string,
  ttlMs: number,
  now = Date.now(),
): T | null => {
  const entry = cache.get(key)
  if (!entry) {
    return null
  }

  if (entry.fetchedAt + ttlMs <= now) {
    cache.delete(key)
    return null
  }

  // LRU：读一次把条目挪到末尾，避免热 key 被最早淘汰。
  cache.delete(key)
  cache.set(key, entry)
  return entry.value
}

export const writeTtlCache = <T>(
  cache: TtlCache<T>,
  key: string,
  value: T,
  now = Date.now(),
  maxSize = 32,
) => {
  cache.delete(key)
  cache.set(key, { value, fetchedAt: now })

  while (cache.size > maxSize) {
    const oldestKey = cache.keys().next().value
    if (!oldestKey) {
      break
    }
    cache.delete(oldestKey)
  }
}

export const invalidateTtlCache = <T>(cache: TtlCache<T>, key: string) => {
  cache.delete(key)
}
