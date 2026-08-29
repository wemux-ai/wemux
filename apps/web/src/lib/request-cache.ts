export type CachedRequestLoader<T> = () => Promise<T>
export type CachedRequestKeyedLoader<TKey, TValue> = (key: TKey) => Promise<TValue>

export function createCachedRequestLoader<T>(params: {
  ttlMs: number
  load: CachedRequestLoader<T>
}) {
  let cached: { expiresAt: number; value: T } | null = null
  let pending: Promise<T> | null = null

  return async (options: { force?: boolean } = {}) => {
    const now = Date.now()
    if (!options.force && cached && cached.expiresAt > now) {
      return cached.value
    }

    if (pending) {
      return pending
    }

    pending = params.load()
      .then((value) => {
        cached = {
          expiresAt: Date.now() + params.ttlMs,
          value,
        }
        return value
      })
      .finally(() => {
        pending = null
      })

    return pending
  }
}

export function createCachedRequestLoaderMap<TKey, TValue>(params: {
  ttlMs: number
  load: CachedRequestKeyedLoader<TKey, TValue>
}) {
  const loaders = new Map<TKey, ReturnType<typeof createCachedRequestLoader<TValue>>>()

  return (key: TKey, options?: { force?: boolean }) => {
    let loader = loaders.get(key)
    if (!loader) {
      loader = createCachedRequestLoader({
        ttlMs: params.ttlMs,
        load: () => params.load(key),
      })
      loaders.set(key, loader)
    }

    return loader(options)
  }
}
