const RECOVERABLE_LOCAL_STORAGE_KEY_PREFIXES = [
  'vibemux-task-chat-conversation:',
  'vibemux-task-chat-composer:',
] as const

const getWindowStorage = (kind: 'localStorage' | 'sessionStorage') => {
  if (typeof window === 'undefined') {
    return undefined
  }

  return window[kind]
}

export const isQuotaExceededError = (error: unknown) => {
  return error instanceof DOMException
    && (error.name === 'QuotaExceededError' || error.code === 22 || error.code === 1014)
}

const clearRecoverableLocalStorageEntries = (keyToKeep?: string) => {
  const localStorage = getWindowStorage('localStorage')
  if (!localStorage) {
    return 0
  }

  let removedCount = 0
  try {
    for (let index = localStorage.length - 1; index >= 0; index -= 1) {
      const key = localStorage.key(index)
      if (!key || key === keyToKeep) {
        continue
      }

      if (RECOVERABLE_LOCAL_STORAGE_KEY_PREFIXES.some((prefix) => key.startsWith(prefix))) {
        localStorage.removeItem(key)
        removedCount += 1
      }
    }
  } catch {
    return removedCount
  }

  return removedCount
}

const safeStorageSetItem = (
  storage: Storage | undefined,
  key: string,
  value: string,
  options: { clearRecoverableLocalStorageOnQuota?: boolean } = {},
) => {
  if (!storage) {
    return false
  }

  try {
    storage.setItem(key, value)
    return true
  } catch (error) {
    if (
      options.clearRecoverableLocalStorageOnQuota
      && storage === getWindowStorage('localStorage')
      && isQuotaExceededError(error)
      && clearRecoverableLocalStorageEntries(key) > 0
    ) {
      try {
        storage.setItem(key, value)
        return true
      } catch {
        // Fall through to the shared false return below.
      }
    }

    return false
  }
}

export const safeLocalStorageSetItem = (
  key: string,
  value: string,
  options: { clearRecoverableLocalStorageOnQuota?: boolean } = {},
) => {
  return safeStorageSetItem(getWindowStorage('localStorage'), key, value, options)
}

export const safeSessionStorageSetItem = (
  key: string,
  value: string,
) => {
  return safeStorageSetItem(getWindowStorage('sessionStorage'), key, value)
}
