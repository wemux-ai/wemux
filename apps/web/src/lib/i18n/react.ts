import { useCallback, useMemo, useSyncExternalStore } from 'react'

import i18n, { getCurrentLanguage } from './index'

function subscribe(onStoreChange: () => void) {
  const notify = () => onStoreChange()

  i18n.on('initialized', notify)
  i18n.on('loaded', notify)
  i18n.on('languageChanged', notify)

  return () => {
    i18n.off('initialized', notify)
    i18n.off('loaded', notify)
    i18n.off('languageChanged', notify)
  }
}

function getSnapshot() {
  return `${i18n.isInitialized ? '1' : '0'}:${i18n.resolvedLanguage ?? i18n.language}`
}

export function useTranslation() {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
  const language = getCurrentLanguage()
  const t = useCallback((...args: Parameters<typeof i18n.t>) => i18n.t(...args), [snapshot])

  return useMemo(() => ({
    i18n,
    language,
    t,
  }), [language, t])
}
