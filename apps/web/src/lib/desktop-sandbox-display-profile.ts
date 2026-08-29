import type {
  WorkspaceDesktopSandboxClientNetworkHint,
  WorkspaceDesktopSandboxDisplayProfile,
} from '@shared/types'

const DESKTOP_SANDBOX_DISPLAY_PROFILE_STORAGE_KEY = 'vibemux.desktopSandbox.displayProfile'

export const isDesktopSandboxDisplayProfile = (value: unknown): value is WorkspaceDesktopSandboxDisplayProfile => (
  value === 'auto' || value === '1080p' || value === '720p' || value === '480p'
)

export const readStoredDesktopSandboxDisplayProfile = (): WorkspaceDesktopSandboxDisplayProfile => {
  if (typeof window === 'undefined') {
    return 'auto'
  }

  const value = window.localStorage.getItem(DESKTOP_SANDBOX_DISPLAY_PROFILE_STORAGE_KEY)
  return isDesktopSandboxDisplayProfile(value) ? value : 'auto'
}

export const writeStoredDesktopSandboxDisplayProfile = (profile: WorkspaceDesktopSandboxDisplayProfile) => {
  if (typeof window === 'undefined') {
    return
  }
  window.localStorage.setItem(DESKTOP_SANDBOX_DISPLAY_PROFILE_STORAGE_KEY, profile)
}

export const readDesktopSandboxClientNetworkHint = (): WorkspaceDesktopSandboxClientNetworkHint | undefined => {
  if (typeof navigator === 'undefined') {
    return undefined
  }

  const connection = (navigator as Navigator & {
    connection?: {
      effectiveType?: string
      downlink?: number
      rtt?: number
      saveData?: boolean
    }
  }).connection
  if (!connection) {
    return undefined
  }

  return {
    effectiveType: connection.effectiveType,
    downlinkMbps: connection.downlink,
    rttMs: connection.rtt,
    saveData: connection.saveData,
  }
}
