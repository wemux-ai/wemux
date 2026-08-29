import type { ExecutionModelOption } from '@shared/types'
import { safeLocalStorageSetItem } from './browser-storage'
import { formatExecutionModelProviderLabel } from './utils'

const STORAGE_KEY = 'vibemux.workspace-session.model-menu-preferences'
const RECENT_MODEL_LIMIT = 48
const RECENT_PROVIDER_LIMIT = 24

export type WorkspaceSessionModelMenuPreferences = {
  recentModelIds: string[]
  recentProviderLabels: string[]
}

const createEmptyPreferences = (): WorkspaceSessionModelMenuPreferences => ({
  recentModelIds: [],
  recentProviderLabels: [],
})

const normalizeRecentValues = (value: unknown, limit: number) => {
  if (!Array.isArray(value)) {
    return []
  }

  const normalized: string[] = []
  for (const entry of value) {
    if (typeof entry !== 'string') {
      continue
    }

    const nextValue = entry.trim()
    if (!nextValue || normalized.includes(nextValue)) {
      continue
    }

    normalized.push(nextValue)
    if (normalized.length >= limit) {
      break
    }
  }

  return normalized
}

const moveRecentValueToFront = (values: string[], nextValue: string, limit: number) => {
  const normalizedValue = nextValue.trim()
  if (!normalizedValue) {
    return values
  }

  if (values[0] === normalizedValue && values.length <= limit) {
    return values
  }

  return [normalizedValue, ...values.filter((value) => value !== normalizedValue)].slice(0, limit)
}

const areStringArraysEqual = (left: string[], right: string[]) => {
  if (left.length !== right.length) {
    return false
  }

  return left.every((value, index) => value === right[index])
}

export const readWorkspaceSessionModelMenuPreferences = (): WorkspaceSessionModelMenuPreferences => {
  if (typeof window === 'undefined') {
    return createEmptyPreferences()
  }

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) {
      return createEmptyPreferences()
    }

    const parsed = JSON.parse(raw) as Partial<WorkspaceSessionModelMenuPreferences>
    return {
      recentModelIds: normalizeRecentValues(parsed?.recentModelIds, RECENT_MODEL_LIMIT),
      recentProviderLabels: normalizeRecentValues(parsed?.recentProviderLabels, RECENT_PROVIDER_LIMIT),
    }
  } catch {
    return createEmptyPreferences()
  }
}

export const writeWorkspaceSessionModelMenuPreferences = (
  preferences: WorkspaceSessionModelMenuPreferences,
) => {
  safeLocalStorageSetItem(STORAGE_KEY, JSON.stringify({
    recentModelIds: normalizeRecentValues(preferences.recentModelIds, RECENT_MODEL_LIMIT),
    recentProviderLabels: normalizeRecentValues(preferences.recentProviderLabels, RECENT_PROVIDER_LIMIT),
  }))
}

export const recordWorkspaceSessionModelMenuSelection = (
  preferences: WorkspaceSessionModelMenuPreferences,
  model?: Pick<ExecutionModelOption, 'id' | 'providerId' | 'source'> | null,
) => {
  const normalizedModelId = model?.id?.trim() || ''
  if (!normalizedModelId || !model) {
    return preferences
  }

  const providerLabel = formatExecutionModelProviderLabel(model)
  const nextRecentModelIds = moveRecentValueToFront(preferences.recentModelIds, normalizedModelId, RECENT_MODEL_LIMIT)
  const nextRecentProviderLabels = moveRecentValueToFront(
    preferences.recentProviderLabels,
    providerLabel,
    RECENT_PROVIDER_LIMIT,
  )

  if (
    areStringArraysEqual(nextRecentModelIds, preferences.recentModelIds)
    && areStringArraysEqual(nextRecentProviderLabels, preferences.recentProviderLabels)
  ) {
    return preferences
  }

  return {
    recentModelIds: nextRecentModelIds,
    recentProviderLabels: nextRecentProviderLabels,
  }
}
