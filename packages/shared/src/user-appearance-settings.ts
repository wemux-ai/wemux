export type UserThemePreference = 'dark' | 'light' | 'system'

export interface UserGlassEffectSettings {
  /** Amount of the dark tint applied to the translucent shell, in percent. */
  opacity: number
  /** Backdrop blur radius, in pixels. */
  blur: number
  /** Backdrop saturation multiplier, in percent. */
  saturation: number
  /** Brightness of the hairline glass border, in percent. */
  borderOpacity: number
}

export interface UserAppearanceSettings {
  theme: UserThemePreference
  glass: UserGlassEffectSettings
}

export const defaultUserAppearanceSettings = (): UserAppearanceSettings => ({
  theme: 'dark',
  glass: {
    opacity: 68,
    blur: 36,
    saturation: 125,
    borderOpacity: 8,
  },
})

const clampSetting = (value: unknown, fallback: number, min: number, max: number) => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback
  }

  return Math.min(max, Math.max(min, Math.round(value)))
}

export const normalizeUserAppearanceSettings = (value: unknown): UserAppearanceSettings => {
  const record = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  const defaults = defaultUserAppearanceSettings()
  const glass = record.glass && typeof record.glass === 'object' ? record.glass as Record<string, unknown> : {}

  return {
    theme: record.theme === 'dark' || record.theme === 'light' || record.theme === 'system' ? record.theme : defaults.theme,
    glass: {
      opacity: clampSetting(glass.opacity, defaults.glass.opacity, 20, 90),
      blur: clampSetting(glass.blur, defaults.glass.blur, 0, 64),
      saturation: clampSetting(glass.saturation, defaults.glass.saturation, 80, 160),
      borderOpacity: clampSetting(glass.borderOpacity, defaults.glass.borderOpacity, 0, 20),
    },
  }
}
