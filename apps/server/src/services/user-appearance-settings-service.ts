import { defaultUserAppearanceSettings, normalizeUserAppearanceSettings, type UserAppearanceSettings } from '@shared/user-appearance-settings'
import { getMeta, saveMeta } from '../storage/app-state-store'

const KEY_PREFIX = 'user_appearance_settings:'
export const getUserAppearanceSettings = (userId: string): UserAppearanceSettings => normalizeUserAppearanceSettings(getMeta(`${KEY_PREFIX}${userId}`, defaultUserAppearanceSettings()))
export const saveUserAppearanceSettings = (userId: string, settings: unknown): UserAppearanceSettings => {
  const current = getUserAppearanceSettings(userId)
  const incoming = settings && typeof settings === 'object' ? settings as Record<string, unknown> : {}
  const incomingGlass = incoming.glass && typeof incoming.glass === 'object' ? incoming.glass as Record<string, unknown> : {}
  const normalized = normalizeUserAppearanceSettings({
    ...current,
    ...incoming,
    glass: { ...current.glass, ...incomingGlass },
  })
  saveMeta(`${KEY_PREFIX}${userId}`, normalized)
  return normalized
}
