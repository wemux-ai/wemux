// [INPUT]: 评审中心访问
import { getEnv } from '@shared/env'
// [OUTPUT]: 授权判定
// [POS]: 评审中心访问控制
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import type { MiddlewareHandler } from 'hono'

export const REVIEW_CENTER_PREVIEW_ONLY_MESSAGE = 'Review Center 仅在开发环境和 preview 环境开放。'

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

export const isReviewCenterEnabled = () => {
  if (process.env.NODE_ENV === 'development') {
    return true
  }

  if (getEnv('WEMUX_ENV')?.trim().toLowerCase() === 'preview') {
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

export const requireReviewCenterAccess: MiddlewareHandler = async (c, next) => {
  if (!isReviewCenterEnabled()) {
    return c.json({ message: REVIEW_CENTER_PREVIEW_ONLY_MESSAGE }, 404)
  }

  await next()
}
