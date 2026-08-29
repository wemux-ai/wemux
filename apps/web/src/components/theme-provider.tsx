import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import {
  defaultUserAppearanceSettings,
  normalizeUserAppearanceSettings,
  type UserGlassEffectSettings,
  type UserThemePreference,
} from '@shared/user-appearance-settings'
import { api } from '../lib/api'

interface ThemeContextValue {
  theme: UserThemePreference
  resolvedTheme: 'dark' | 'light'
  glass: UserGlassEffectSettings
  setTheme: (theme: UserThemePreference) => void
  updateGlass: (patch: Partial<UserGlassEffectSettings>) => void
  resetGlass: () => void
  toggleTheme: () => void
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

export function useTheme() {
  const context = useContext(ThemeContext)
  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider')
  }
  return context
}

// 控制台是暗色硬编码设计（页面全部使用 zinc 暗色板），
// shadcn CSS 变量（--background / --border 等）必须始终落在 `.dark` 分支，
// 否则浅色模式下 outline 按钮会变成白底白字。
// 主题偏好和桌面玻璃参数优先从本地缓存读取，再由登录账户设置覆盖。
const STORAGE_KEY = 'wemux-theme-preference'
const GLASS_STORAGE_KEY = 'wemux-glass-effect-settings'
const AUTH_CHANGED_EVENT = 'wemux:auth-changed'
const readStored = (): UserThemePreference => {
  if (typeof window === 'undefined') return 'dark'
  const value = window.localStorage.getItem(STORAGE_KEY)
  return value === 'dark' || value === 'light' || value === 'system' ? value : 'dark'
}

const readStoredGlass = (): UserGlassEffectSettings => {
  if (typeof window === 'undefined') return defaultUserAppearanceSettings().glass

  try {
    const raw = window.localStorage.getItem(GLASS_STORAGE_KEY)
    if (!raw) return defaultUserAppearanceSettings().glass
    return normalizeUserAppearanceSettings({ glass: JSON.parse(raw) }).glass
  } catch {
    return defaultUserAppearanceSettings().glass
  }
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<UserThemePreference>(readStored)
  const [glass, setGlassState] = useState<UserGlassEffectSettings>(readStoredGlass)
  const [systemDark, setSystemDark] = useState(() => typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches)
  const resolvedTheme = theme === 'system' ? (systemDark ? 'dark' : 'light') : theme
  const glassSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (typeof document === 'undefined') {
      return
    }

    document.documentElement.classList.toggle('dark', resolvedTheme === 'dark')
    document.documentElement.classList.toggle('light', resolvedTheme === 'light')
    document.documentElement.style.colorScheme = resolvedTheme
    document.documentElement.style.setProperty('--wemux-glass-opacity', `${glass.opacity}%`)
    document.documentElement.style.setProperty('--wemux-glass-blur', `${glass.blur}px`)
    document.documentElement.style.setProperty('--wemux-glass-saturation', `${glass.saturation}%`)
    document.documentElement.style.setProperty('--wemux-glass-border-opacity', `${glass.borderOpacity}%`)
  }, [glass, resolvedTheme])

  useEffect(() => {
    const media = window.matchMedia?.('(prefers-color-scheme: dark)')
    if (!media) return
    const listener = () => setSystemDark(media.matches)
    media.addEventListener?.('change', listener)
    return () => media.removeEventListener?.('change', listener)
  }, [])

  useEffect(() => {
    const refresh = () => {
      // 主题偏好接口需要登录；匿名访客（无 auth_token）直接跳过，
      // 避免公开页（如落地页）无谓触发 401。authFetch 已不再把匿名 401 当会话失效，
      // 这里跳过请求是双保险。登录/登出会派发 AUTH_CHANGED_EVENT 重新同步。
      let storedToken: string | null = null
      try {
        storedToken = window.localStorage.getItem('auth_token')
      } catch {
        // 忽略存储异常
      }
      if (!storedToken) {
        return
      }
      void api.getMyAppearanceSettings().then(({ settings }) => {
        const normalized = normalizeUserAppearanceSettings(settings)
        setThemeState(normalized.theme)
        setGlassState(normalized.glass)
        try {
          window.localStorage.setItem(GLASS_STORAGE_KEY, JSON.stringify(normalized.glass))
        } catch {
          // Optional local cache; the account setting remains canonical.
        }
      }).catch(() => undefined)
    }
    refresh()
    window.addEventListener(AUTH_CHANGED_EVENT, refresh)
    return () => window.removeEventListener(AUTH_CHANGED_EVENT, refresh)
  }, [])

  const setTheme = (next: UserThemePreference) => {
    setThemeState(next)
    try { window.localStorage.setItem(STORAGE_KEY, next) } catch { /* optional storage */ }
    void api.saveMyAppearanceSettings({ theme: next, glass }).catch(() => undefined)
  }
  const updateGlass = (patch: Partial<UserGlassEffectSettings>) => {
    const next = normalizeUserAppearanceSettings({ glass: { ...glass, ...patch } }).glass
    setGlassState(next)
    try { window.localStorage.setItem(GLASS_STORAGE_KEY, JSON.stringify(next)) } catch { /* optional storage */ }

    if (glassSaveTimer.current) {
      clearTimeout(glassSaveTimer.current)
    }
    glassSaveTimer.current = setTimeout(() => {
      void api.saveMyAppearanceSettings({ theme, glass: next }).catch(() => undefined)
    }, 250)
  }
  const resetGlass = () => updateGlass(defaultUserAppearanceSettings().glass)
  const toggleTheme = () => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')

  useEffect(() => () => {
    if (glassSaveTimer.current) {
      clearTimeout(glassSaveTimer.current)
    }
  }, [])

  return (
    <ThemeContext.Provider value={{ theme, resolvedTheme, glass, setTheme, updateGlass, resetGlass, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  )
}
