export const CURRENT_APP_VERSION = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '0.0.0'
export const CURRENT_APP_BUILD_ID = typeof __APP_BUILD_ID__ === 'string' ? __APP_BUILD_ID__ : CURRENT_APP_VERSION

export type NodeVersionStatus = 'ahead' | 'current' | 'outdated' | 'unknown'

const normalizeVersion = (version?: string) => {
  const value = version?.trim()
  if (!value) {
    return null
  }

  const normalized = value.replace(/^v/i, '').split(/[+-]/)[0]?.trim()
  return normalized || null
}

const parseVersionParts = (version?: string) => {
  const normalized = normalizeVersion(version)
  if (!normalized) {
    return null
  }

  const parts = normalized.split('.').map((part) => Number.parseInt(part, 10))
  return parts.every((part) => Number.isFinite(part)) ? parts : null
}

export const getNodeVersionStatus = (
  version?: string,
  currentVersion = CURRENT_APP_VERSION,
): NodeVersionStatus => {
  const currentParts = parseVersionParts(currentVersion)
  const targetParts = parseVersionParts(version)
  if (!currentParts || !targetParts) {
    return 'unknown'
  }

  const length = Math.max(currentParts.length, targetParts.length)
  for (let index = 0; index < length; index += 1) {
    const currentPart = currentParts[index] ?? 0
    const targetPart = targetParts[index] ?? 0
    if (targetPart < currentPart) {
      return 'outdated'
    }
    if (targetPart > currentPart) {
      return 'ahead'
    }
  }

  return 'current'
}

export const isNodeVersionOutdated = (version?: string, currentVersion = CURRENT_APP_VERSION) => {
  return getNodeVersionStatus(version, currentVersion) === 'outdated'
}
