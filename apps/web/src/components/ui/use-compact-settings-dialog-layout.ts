import { useEffect, useState } from 'react'

const COMPACT_SETTINGS_DIALOG_MEDIA_QUERY = '(max-width: 1023px)'

function getUsesCompactSettingsDialogLayout() {
  if (typeof window === 'undefined') {
    return false
  }

  return window.matchMedia(COMPACT_SETTINGS_DIALOG_MEDIA_QUERY).matches
}

export function useCompactSettingsDialogLayout() {
  const [usesCompactLayout, setUsesCompactLayout] = useState(getUsesCompactSettingsDialogLayout)

  useEffect(() => {
    if (typeof window === 'undefined') {
      return
    }

    const mediaQuery = window.matchMedia(COMPACT_SETTINGS_DIALOG_MEDIA_QUERY)
    const handleChange = (event: MediaQueryListEvent) => {
      setUsesCompactLayout(event.matches)
    }

    setUsesCompactLayout(mediaQuery.matches)
    mediaQuery.addEventListener('change', handleChange)

    return () => mediaQuery.removeEventListener('change', handleChange)
  }, [])

  return usesCompactLayout
}
