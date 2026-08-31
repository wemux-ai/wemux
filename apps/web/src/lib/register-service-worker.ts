import { isNativeClient } from './native-client'
import { CURRENT_APP_BUILD_ID } from './node-version'

const SKIP_WAITING_MESSAGE_TYPE = 'WEMUX_SKIP_WAITING'
const DEFAULT_UPDATE_CHECK_INTERVAL_MS = 5 * 60 * 1000
const DEFAULT_BUILD_VERSION_CHECK_INTERVAL_MS = 60 * 1000
const VERSION_MANIFEST_PATH = '/version.json'

interface RegisterServiceWorkerOptions {
  onUpdateAvailable?: (controller: { activateUpdate: () => void }) => void
  updateCheckIntervalMs?: number
  buildVersionCheckIntervalMs?: number
}

const activateWaitingServiceWorker = (registration: ServiceWorkerRegistration) => {
  if (!registration.waiting) {
    window.location.reload()
    return
  }

  registration.waiting.postMessage({ type: SKIP_WAITING_MESSAGE_TYPE })
}

interface AppVersionManifest {
  buildId?: string
}

const readManifestBuildId = (value: unknown) => {
  if (!value || typeof value !== 'object') {
    return ''
  }

  const buildId = (value as AppVersionManifest).buildId
  return typeof buildId === 'string' ? buildId.trim() : ''
}

export const isRemoteBuildUpdateAvailable = (
  remoteManifest: unknown,
  currentBuildId = CURRENT_APP_BUILD_ID,
) => {
  const remoteBuildId = readManifestBuildId(remoteManifest)
  return Boolean(remoteBuildId && currentBuildId && remoteBuildId !== currentBuildId)
}

const fetchAppVersionManifest = async () => {
  const response = await fetch(`${VERSION_MANIFEST_PATH}?t=${Date.now()}`, {
    cache: 'no-store',
    headers: {
      accept: 'application/json',
    },
  })

  if (!response.ok) {
    return null
  }

  return response.json() as Promise<unknown>
}

const registerBuildVersionUpdateCheck = (options: RegisterServiceWorkerOptions) => {
  if (!CURRENT_APP_BUILD_ID) return

  let promptedRemoteBuildId = ''

  const checkForBuildVersionUpdate = async () => {
    if (document.visibilityState === 'hidden') return

    try {
      const manifest = await fetchAppVersionManifest()
      if (!isRemoteBuildUpdateAvailable(manifest)) return

      const remoteBuildId = readManifestBuildId(manifest)
      if (!remoteBuildId || promptedRemoteBuildId === remoteBuildId) return

      promptedRemoteBuildId = remoteBuildId
      options.onUpdateAvailable?.({
        activateUpdate: () => {
          window.location.reload()
        },
      })
    } catch {
      // Version checks are best-effort and should never interrupt app usage.
    }
  }

  const buildVersionCheckIntervalMs = options.buildVersionCheckIntervalMs ?? DEFAULT_BUILD_VERSION_CHECK_INTERVAL_MS
  if (buildVersionCheckIntervalMs > 0) {
    window.setInterval(() => {
      void checkForBuildVersionUpdate()
    }, buildVersionCheckIntervalMs)
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      void checkForBuildVersionUpdate()
    }
  })

  void checkForBuildVersionUpdate()
}

export function registerServiceWorker(options: RegisterServiceWorkerOptions = {}) {
  if (isNativeClient()) return

  if (import.meta.env.DEV) {
    if ('serviceWorker' in navigator) {
      void navigator.serviceWorker.getRegistrations().then((registrations) => {
        void Promise.all(registrations.map((registration) => registration.unregister()))
      })
    }
    return
  }

  window.addEventListener('load', () => {
    registerBuildVersionUpdateCheck(options)
  })

  if (!('serviceWorker' in navigator)) return

  window.addEventListener('load', () => {
    let shouldReloadForApprovedUpdate = false
    let promptedWaitingWorker: ServiceWorker | null = null

    void navigator.serviceWorker.register('/sw.js').then((registration) => {
      const notifyAboutWaitingUpdate = () => {
        const waitingWorker = registration.waiting
        if (!waitingWorker || !navigator.serviceWorker.controller || promptedWaitingWorker === waitingWorker) {
          return
        }

        promptedWaitingWorker = waitingWorker
        options.onUpdateAvailable?.({
          activateUpdate: () => {
            shouldReloadForApprovedUpdate = true
            activateWaitingServiceWorker(registration)
          },
        })
      }

      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (!shouldReloadForApprovedUpdate) return
        shouldReloadForApprovedUpdate = false
        window.location.reload()
      })

      notifyAboutWaitingUpdate()

      registration.addEventListener('updatefound', () => {
        const installingWorker = registration.installing
        if (!installingWorker) return

        installingWorker.addEventListener('statechange', () => {
          if (installingWorker.state !== 'installed') return
          notifyAboutWaitingUpdate()
        })
      })

      const checkForServiceWorkerUpdate = () => {
        if (document.visibilityState === 'hidden') return
        void registration.update().catch(() => {
          // A transient network failure should not break the app or the next scheduled check.
        })
      }

      const updateCheckIntervalMs = options.updateCheckIntervalMs ?? DEFAULT_UPDATE_CHECK_INTERVAL_MS
      if (updateCheckIntervalMs > 0) {
        window.setInterval(checkForServiceWorkerUpdate, updateCheckIntervalMs)
      }

      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
          checkForServiceWorkerUpdate()
        }
      })
    })
  })
}
