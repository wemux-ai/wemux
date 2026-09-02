import { isNativeClient } from './native-client'

type RuntimeEnv = ImportMeta['env'] & {
  VITE_API_BASE_URL?: string
  VITE_APP_BASE_URL?: string
  VITE_BETTER_AUTH_URL?: string
  VITE_BILLING_DEBUG_ENABLED?: string
  VITE_DEMO_BOOKING_URL?: string
  VITE_DEMO_EMAIL?: string
  VITE_COMMUNITY_DISCORD_URL?: string
  VITE_COMMUNITY_WECHAT_QR_URL?: string
}

const trimTrailingSlash = (value: string) => value.replace(/\/$/, '')
const LOOPBACK_HOSTNAMES = new Set(['127.0.0.1', 'localhost', '[::1]', '::1'])
const LOCAL_PREVIEW_SITE_SUFFIXES = ['.vibemux.localtest.me', '.wemux.localtest.me']
const PREVIEW_SITE_HOSTS = ['vibemux.xyz', 'wemux.xyz']
const PRODUCTION_SITE_HOSTS = ['vibemux.com', 'wemux.ai']
const isPrivateIpv4Hostname = (hostname: string) => /^10\./.test(hostname)
  || /^192\.168\./.test(hostname)
  || /^172\.(1[6-9]|2\d|3[0-1])\./.test(hostname)

const getRuntimeEnv = () => ((import.meta.env ?? {}) as RuntimeEnv)
const getEnvValue = (key: keyof RuntimeEnv) => trimTrailingSlash(((getRuntimeEnv()[key] ?? '') as string).trim())

const isAbsoluteHttpUrl = (value: string) => /^https?:\/\//i.test(value)
const isLoopbackHostname = (hostname: string) => LOOPBACK_HOSTNAMES.has(hostname)
const isLocalPreviewHostname = (hostname: string) => {
  const normalized = hostname.trim().toLowerCase()
  return LOCAL_PREVIEW_SITE_SUFFIXES.some((suffix) => normalized.endsWith(suffix))
}
const isPreviewHostname = (hostname: string) => {
  const normalized = hostname.trim().toLowerCase()
  return PREVIEW_SITE_HOSTS.some((host) => normalized === host || normalized.endsWith(`.${host}`))
}
const isProductionHostname = (hostname: string) => {
  const normalized = hostname.trim().toLowerCase()
  return PRODUCTION_SITE_HOSTS.some((host) => normalized === host || normalized.endsWith(`.${host}`))
}

const isPreviewUrl = (value: string) => {
  if (!value.trim()) return false

  try {
    return isPreviewHostname(new URL(value).hostname)
  } catch {
    return false
  }
}

export const shouldUseCurrentOriginForLoopbackConfig = (params: {
  currentHostname?: string
  configuredUrl?: string
}) => {
  const currentHostname = params.currentHostname?.trim().toLowerCase() ?? ''
  const configuredUrl = params.configuredUrl?.trim() ?? ''
  if (!currentHostname || !configuredUrl || !isAbsoluteHttpUrl(configuredUrl)) {
    return false
  }

  if (
    isLoopbackHostname(currentHostname)
    || isPrivateIpv4Hostname(currentHostname)
  ) {
    return false
  }

  try {
    const configuredHostname = new URL(configuredUrl).hostname.toLowerCase()
    return isLoopbackHostname(configuredHostname)
  } catch {
    return false
  }
}

const shouldUseCurrentOriginForLocalPreviewConfig = (params: {
  currentHostname?: string
  configuredUrl?: string
  currentPort?: string
}) => {
  const currentHostname = params.currentHostname?.trim().toLowerCase() ?? ''
  const configuredUrl = params.configuredUrl?.trim() ?? ''
  if (!currentHostname || !configuredUrl || !isAbsoluteHttpUrl(configuredUrl)) {
    return false
  }

  if (!isLoopbackHostname(currentHostname) && !isPrivateIpv4Hostname(currentHostname)) {
    return false
  }

  try {
    const configured = new URL(configuredUrl)
    return isLocalPreviewHostname(configured.hostname) && (!params.currentPort || configured.port === params.currentPort)
  } catch {
    return false
  }
}

const shouldUseCurrentWindowOriginForLoopbackConfig = (configuredUrl: string) => (
  typeof window !== 'undefined'
  && shouldUseCurrentOriginForLoopbackConfig({
    currentHostname: window.location.hostname,
    configuredUrl,
  })
)

const shouldUseCurrentWindowOriginForLocalPreviewConfig = (configuredUrl: string) => (
  typeof window !== 'undefined'
  && shouldUseCurrentOriginForLocalPreviewConfig({
    currentHostname: window.location.hostname,
    currentPort: window.location.port,
    configuredUrl,
  })
)

const getCurrentWindowOrigin = () => {
  if (typeof window === 'undefined') return ''
  return trimTrailingSlash(window.location.origin)
}

export const resolvePreviewEnvironment = (params: {
  currentHostname?: string
  appBaseUrl?: string
}) => {
  const currentHostname = params.currentHostname?.trim().toLowerCase() ?? ''
  if (currentHostname && isPreviewHostname(currentHostname)) {
    return true
  }

  return isPreviewUrl(params.appBaseUrl?.trim() ?? '')
}

export const resolveProductionEnvironment = (params: {
  currentHostname?: string
  appBaseUrl?: string
}) => {
  const currentHostname = params.currentHostname?.trim().toLowerCase() ?? ''
  if (currentHostname && isProductionHostname(currentHostname)) {
    return true
  }

  const appBaseUrl = params.appBaseUrl?.trim() ?? ''
  if (!appBaseUrl) {
    return false
  }

  try {
    return isProductionHostname(new URL(appBaseUrl).hostname)
  } catch {
    return false
  }
}

export const resolveReviewCenterEnvironment = (params: {
  dev?: boolean
  currentHostname?: string
  appBaseUrl?: string
}) => {
  return Boolean(params.dev) || resolvePreviewEnvironment({
    currentHostname: params.currentHostname,
    appBaseUrl: params.appBaseUrl,
  })
}

export const isPreviewEnvironment = () => {
  return resolvePreviewEnvironment({
    currentHostname: typeof window !== 'undefined' ? window.location.hostname : '',
    appBaseUrl: getEnvValue('VITE_APP_BASE_URL'),
  })
}

export const isDevEnvironment = () => Boolean(getRuntimeEnv().DEV)
export const isReviewCenterEnabled = () => resolveReviewCenterEnvironment({
  dev: isDevEnvironment(),
  currentHostname: typeof window !== 'undefined' ? window.location.hostname : '',
  appBaseUrl: getEnvValue('VITE_APP_BASE_URL'),
})
export const isProductionEnvironment = () => {
  return resolveProductionEnvironment({
    currentHostname: typeof window !== 'undefined' ? window.location.hostname : '',
    appBaseUrl: getEnvValue('VITE_APP_BASE_URL'),
  })
}
export const isDesktopSandboxDevOnlyEnabled = () => isDevEnvironment() || isPreviewEnvironment()
export const isManagedCloudDevOnlyEnabled = () => isDevEnvironment() || isPreviewEnvironment()

// ---------- 桌面端服务器地址选择（开源客户端连自托管/官方） ----------

/** 官方云托管默认地址（桌面端开箱即连；自托管用户可在登录页改为自己的实例） */
export const DEFAULT_SERVER_URL = 'https://wemux.ai'
const CUSTOM_SERVER_STORAGE_KEY = 'wemux.serverUrl'

/** 读取用户自定义服务器地址（未设置返回 null） */
export const getCustomServerUrl = (): string | null => {
  if (typeof window === 'undefined') return null
  try {
    return window.localStorage.getItem(CUSTOM_SERVER_STORAGE_KEY)
  } catch {
    return null
  }
}

/** 保存用户自定义服务器地址（校验 http/https，去尾部斜杠）；非法输入不保存 */
export const setCustomServerUrl = (url: string): boolean => {
  if (typeof window === 'undefined') return false
  const trimmed = url.trim().replace(/\/+$/, '')
  if (!/^https?:\/\//i.test(trimmed)) {
    return false
  }
  try {
    window.localStorage.setItem(CUSTOM_SERVER_STORAGE_KEY, trimmed)
    return true
  } catch {
    return false
  }
}

/** 清除自定义服务器地址（回到官方默认 wemux.ai） */
export const clearCustomServerUrl = (): void => {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.removeItem(CUSTOM_SERVER_STORAGE_KEY)
  } catch {
    // 忽略存储异常
  }
}

export const getApiBaseUrl = () => {
  // Native 客户端优先使用登录页保存的服务器地址，默认官方 wemux.ai。
  // 浏览器网页（云托管/自托管站点）保持同源相对路径，不受影响。
  if (isNativeClient() && !import.meta.env.DEV) {
    return getCustomServerUrl() || DEFAULT_SERVER_URL
  }
  const envBaseUrl = getEnvValue('VITE_API_BASE_URL')
  if (shouldUseCurrentWindowOriginForLoopbackConfig(envBaseUrl) || shouldUseCurrentWindowOriginForLocalPreviewConfig(envBaseUrl)) return ''
  if (envBaseUrl) return envBaseUrl
  if (typeof window === 'undefined') return ''

  const { protocol, hostname, port } = window.location
  if (isLocalPreviewHostname(hostname) && port === '15173') {
    return ''
  }
  const isLocalHost = hostname === 'localhost' || hostname === '127.0.0.1'
  if (!isLocalHost || port === '8989' || port === '18989') return ''
  if (port === '15173') return `${protocol}//${hostname}:18989`
  return `${protocol}//${hostname}:8989`
}

export const resolveApiUrl = (path: string) => `${getApiBaseUrl()}${path}`

export const resolveAbsoluteApiUrl = (path: string) => {
  const baseUrl = getApiBaseUrl()
  const apiUrl = `${baseUrl}${path}`
  if (baseUrl && isAbsoluteHttpUrl(baseUrl)) return apiUrl

  if (typeof window !== 'undefined') {
    return new URL(apiUrl, window.location.origin).toString()
  }

  const appBaseUrl = getAppBaseUrl()
  if (appBaseUrl && isAbsoluteHttpUrl(appBaseUrl)) {
    return new URL(apiUrl, appBaseUrl).toString()
  }

  return new URL(apiUrl, 'http://127.0.0.1:8989').toString()
}

export const resolveApiWebSocketUrl = (path: string) => {
  const baseUrl = resolveApiUrl(path)
  if (baseUrl.startsWith('https://')) {
    return baseUrl.replace('https://', 'wss://')
  }

  if (baseUrl.startsWith('http://')) {
    return baseUrl.replace('http://', 'ws://')
  }

  return baseUrl
}

export const resolveApiWebSocketUrlWithBase = (baseUrl: string, path: string) => {
  const normalizedBase = trimTrailingSlash(baseUrl.trim())
  const absoluteUrl = `${normalizedBase}${path}`
  if (absoluteUrl.startsWith('https://')) {
    return absoluteUrl.replace('https://', 'wss://')
  }

  if (absoluteUrl.startsWith('http://')) {
    return absoluteUrl.replace('http://', 'ws://')
  }

  return absoluteUrl
}

export const getBetterAuthBaseUrl = () => {
  const envAuthUrl = getEnvValue('VITE_BETTER_AUTH_URL')
  if (shouldUseCurrentWindowOriginForLoopbackConfig(envAuthUrl) || shouldUseCurrentWindowOriginForLocalPreviewConfig(envAuthUrl)) {
    return `${getCurrentWindowOrigin()}/api/identity`
  }
  if (envAuthUrl) return envAuthUrl

  if (typeof window !== 'undefined') {
    const current = window.location.hostname.toLowerCase()
    if (isLocalPreviewHostname(current) && window.location.port === '15173') {
      return trimTrailingSlash(window.location.origin)
    }
  }

  return resolveAbsoluteApiUrl('/api/identity')
}

export const resolveBetterAuthUrl = (path: string) => {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`
  const authBaseUrl = `${getBetterAuthBaseUrl()}${normalizedPath}`

  if (isAbsoluteHttpUrl(authBaseUrl)) {
    return authBaseUrl
  }

  if (typeof window !== 'undefined') {
    return new URL(authBaseUrl, window.location.origin).toString()
  }

  const appBaseUrl = getAppBaseUrl()
  if (appBaseUrl && isAbsoluteHttpUrl(appBaseUrl)) {
    return new URL(authBaseUrl, appBaseUrl).toString()
  }

  return new URL(authBaseUrl, 'http://127.0.0.1:8989').toString()
}

export const getAppBaseUrl = () => {
  const envAppUrl = getEnvValue('VITE_APP_BASE_URL')
  if (shouldUseCurrentWindowOriginForLoopbackConfig(envAppUrl) || shouldUseCurrentWindowOriginForLocalPreviewConfig(envAppUrl)) return getCurrentWindowOrigin()
  if (envAppUrl) return envAppUrl

  if (typeof window === 'undefined') return ''
  return trimTrailingSlash(window.location.origin)
}

export const resolveAppUrl = (path: string) => `${getAppBaseUrl()}${path}`

export const resolveCanonicalLoopbackUrlForConfig = (params: {
  currentUrl: string
  configuredBaseUrl?: string
}) => {
  const configuredBaseUrl = params.configuredBaseUrl?.trim() || ''
  if (!configuredBaseUrl || !isAbsoluteHttpUrl(configuredBaseUrl)) {
    return ''
  }

  const current = new URL(params.currentUrl)
  const currentHost = current.hostname.toLowerCase()
  const target = new URL(configuredBaseUrl)
  if (shouldUseCurrentOriginForLoopbackConfig({
    currentHostname: currentHost,
    configuredUrl: target.toString(),
  })) {
    return ''
  }

  if (
    isLocalPreviewHostname(current.hostname)
    && LOOPBACK_HOSTNAMES.has(target.hostname)
  ) {
    return ''
  }

  const shouldAlignToAuthHost = isLoopbackHostname(target.hostname)
    || isPrivateIpv4Hostname(target.hostname)
  if (!shouldAlignToAuthHost) {
    return ''
  }

  if (current.hostname === target.hostname && current.protocol === target.protocol) {
    return ''
  }

  current.protocol = target.protocol
  current.hostname = target.hostname
  return current.toString()
}

export const resolveCanonicalLoopbackUrl = () => {
  if (typeof window === 'undefined') {
    return ''
  }

  const configuredBaseUrl = getEnvValue('VITE_BETTER_AUTH_URL')
    || getEnvValue('VITE_APP_BASE_URL')
    || getBetterAuthBaseUrl()
    || getAppBaseUrl()

  return resolveCanonicalLoopbackUrlForConfig({
    currentUrl: window.location.href,
    configuredBaseUrl,
  })
}

export const getDemoBookingUrl = () => getEnvValue('VITE_DEMO_BOOKING_URL')

export const getDemoEmail = () => (getRuntimeEnv().VITE_DEMO_EMAIL ?? '').trim()

export const getCommunityChannels = () => ({
  discordUrl: (getRuntimeEnv().VITE_COMMUNITY_DISCORD_URL ?? '').trim(),
  wechatQrUrl: (getRuntimeEnv().VITE_COMMUNITY_WECHAT_QR_URL ?? '').trim(),
})
