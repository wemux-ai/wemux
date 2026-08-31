// [INPUT]: 桌面沙箱访问请求
import { getEnv } from '@shared/env'
// [OUTPUT]: dev 访问判定
// [POS]: 桌面沙箱 dev 访问控制
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import type { MiddlewareHandler } from 'hono'

export const DESKTOP_SANDBOX_DEV_ONLY_MESSAGE = 'Desktop Sandbox 仅在开发环境开放。'

const PREVIEW_HOSTNAMES = ['vibemux.xyz', 'wemux.xyz']

const isPreviewHostname = (value: string) => {
  const normalized = value.trim().toLowerCase()
  return PREVIEW_HOSTNAMES.some((hostname) => normalized === hostname || normalized.endsWith(`.${hostname}`))
}

const isPreviewUrl = (value?: string) => {
  if (!value?.trim()) return false

  try {
    return isPreviewHostname(new URL(value).hostname)
  } catch {
    return false
  }
}

export const isDesktopSandboxDevOnlyEnabled = () => {
  if (process.env.NODE_ENV === 'development') {
    return true
  }

  return [
    getEnv('WEMUX_CLOUD_URL'),
    getEnv('WEMUX_PUBLIC_BASE_URL'),
    process.env.APP_BASE_URL,
    process.env.VITE_APP_BASE_URL,
    process.env.BETTER_AUTH_URL,
  ].some(isPreviewUrl)
}

export const requireDesktopSandboxDevOnlyAccess: MiddlewareHandler = async (c, next) => {
  if (!isDesktopSandboxDevOnlyEnabled()) {
    return c.json({ message: DESKTOP_SANDBOX_DEV_ONLY_MESSAGE }, 404)
  }

  await next()
}
