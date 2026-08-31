type AnalyticsEnv = ImportMeta['env'] & {
  VITE_GA_MEASUREMENT_ID?: string
}

declare global {
  interface Window {
    __wemuxGtag?: (...args: unknown[]) => void
  }
}

const getAnalyticsEnv = () => (import.meta.env ?? {}) as AnalyticsEnv

const getMeasurementId = () => (getAnalyticsEnv().VITE_GA_MEASUREMENT_ID ?? '').trim()

export const trackGoogleAnalyticsPageView = (path: string, title: string) => {
  const measurementId = getMeasurementId()

  if (!measurementId || typeof window === 'undefined' || typeof window.__wemuxGtag !== 'function') {
    return
  }

  window.__wemuxGtag('event', 'page_view', {
    page_path: path,
    page_location: window.location.href,
    page_title: title,
  })
}
