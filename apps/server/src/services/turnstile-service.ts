// [INPUT]: Turnstile token
// [OUTPUT]: 校验结果
// [POS]: Turnstile 校验服务
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto'

import { resolveBetterAuthSecret } from './auth-secrets'

const TURNSTILE_VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify'
const TURNSTILE_COOKIE_NAME = 'vibemux_turnstile_login'
const TURNSTILE_COOKIE_TTL_SECONDS = 10 * 60

type TurnstileVerifyResponse = {
  success?: boolean
  'error-codes'?: string[]
}

type TurnstileVerifyResult = {
  ok: boolean
  message?: string
}

const resolveTurnstileSecretKey = () => process.env.TURNSTILE_SECRET_KEY?.trim() || ''

const resolveTurnstileCookieSecret = () => {
  return process.env.TURNSTILE_COOKIE_SECRET?.trim()
    || resolveBetterAuthSecret()
    || process.env.TOKEN_SECRET?.trim()
    || ''
}

const createCookieSignature = (payload: string) => {
  return createHmac('sha256', resolveTurnstileCookieSecret()).update(payload).digest('hex')
}

const resolveTurnstileErrorMessage = (errorCodes: string[]) => {
  if (errorCodes.includes('missing-input-response')) {
    return '请先完成人机验证。'
  }

  if (errorCodes.includes('timeout-or-duplicate')) {
    return '人机验证已过期，请重新勾选后再试。'
  }

  if (errorCodes.includes('invalid-input-response')) {
    return '人机验证无效，请重新勾选后再试。'
  }

  return '人机验证失败，请稍后再试。'
}

export const resolveTurnstileSiteKey = () => {
  return process.env.TURNSTILE_SITE_KEY?.trim()
    || process.env.VITE_TURNSTILE_SITE_KEY?.trim()
    || ''
}

export const isTurnstileLoginEnabled = () => {
  return Boolean(resolveTurnstileSiteKey())
    && Boolean(resolveTurnstileSecretKey())
    && Boolean(resolveTurnstileCookieSecret())
}

export const turnstileLoginCookieName = TURNSTILE_COOKIE_NAME

export const turnstileLoginCookieMaxAge = TURNSTILE_COOKIE_TTL_SECONDS

export const createTurnstileLoginCookieValue = () => {
  const expiresAt = Date.now() + (TURNSTILE_COOKIE_TTL_SECONDS * 1000)
  const payload = String(expiresAt)
  return `${payload}.${createCookieSignature(payload)}`
}

export const hasValidTurnstileLoginCookie = (value?: string | null) => {
  if (!isTurnstileLoginEnabled()) {
    return true
  }

  if (!value) {
    return false
  }

  const [expiresAtRaw, signature] = value.split('.', 2)
  const expiresAt = Number.parseInt(expiresAtRaw || '', 10)
  if (!expiresAtRaw || !signature || !Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
    return false
  }

  const expectedSignature = createCookieSignature(expiresAtRaw)
  const actualBuffer = Buffer.from(signature)
  const expectedBuffer = Buffer.from(expectedSignature)
  if (actualBuffer.length !== expectedBuffer.length) {
    return false
  }

  return timingSafeEqual(actualBuffer, expectedBuffer)
}

export const verifyTurnstileToken = async (token: string, remoteIp?: string): Promise<TurnstileVerifyResult> => {
  if (!isTurnstileLoginEnabled()) {
    return { ok: true }
  }

  const trimmedToken = token.trim()
  if (!trimmedToken) {
    return { ok: false, message: '请先完成人机验证。' }
  }

  const payload = new URLSearchParams({
    secret: resolveTurnstileSecretKey(),
    response: trimmedToken,
    idempotency_key: randomUUID(),
  })
  if (remoteIp) {
    payload.set('remoteip', remoteIp)
  }

  try {
    const response = await fetch(TURNSTILE_VERIFY_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: payload.toString(),
    })

    if (!response.ok) {
      return { ok: false, message: '人机验证服务暂时不可用，请稍后重试。' }
    }

    const result = await response.json() as TurnstileVerifyResponse
    if (result.success) {
      return { ok: true }
    }

    return {
      ok: false,
      message: resolveTurnstileErrorMessage(result['error-codes'] ?? []),
    }
  } catch {
    return { ok: false, message: '人机验证服务暂时不可用，请稍后重试。' }
  }
}
