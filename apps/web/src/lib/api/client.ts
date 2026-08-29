import type { AppState } from '@shared/types'

import type { MainChatStreamEvent, TeamActivity } from './types'
import { normalizeBuiltInAgentAvatarUrl } from '../agent-avatar'
import { resolveApiUrl } from '../runtime-config'

export { resolveApiUrl } from '../runtime-config'

export const normalizeTeamActivity = (activity: TeamActivity): TeamActivity => ({
  ...activity,
  entityType: activity.entityType ?? activity.targetType,
  entityId: activity.entityId ?? activity.targetId,
  metadata: activity.metadata ?? activity.details,
  targetType: activity.targetType ?? activity.entityType,
  targetId: activity.targetId ?? activity.entityId,
  details: activity.details ?? activity.metadata,
})

export const getAuthHeaders = () => {
  const headers: Record<string, string> = {}
  if (typeof window === 'undefined') {
    return headers
  }

  const token = localStorage.getItem('auth_token')
  if (token) {
    headers.Authorization = `Bearer ${token}`
  }
  return headers
}

export const resolveMediaUrl = (url?: string) => {
  if (!url) {
    return ''
  }

  const normalizedUrl = normalizeBuiltInAgentAvatarUrl(url)

  if (/^https?:\/\//.test(normalizedUrl) || normalizedUrl.startsWith('data:') || normalizedUrl.startsWith('blob:')) {
    return normalizedUrl
  }

  if (normalizedUrl.startsWith('/agents/avatars/')) {
    return normalizedUrl
  }

  return resolveApiUrl(normalizedUrl)
}

const AUTH_NOTICE_KEY = 'auth_notice'

// ── 401 强制登出 ↔ login 自动恢复的防循环护栏 ────────────────
// authFetch 收到业务接口 401 时会清 token 并整页跳到 /login；
// login 页在有 Google cookie session 时会自动 bridge 登录并跳回原页面。
// 当某接口对「新 token」也持续返回 401 时，两者会形成无限循环。
// 这里用 sessionStorage 记录「强制登出」与「bridge 已成功」两个信号：
// login 页自动 bridge 前若同时看到两者，说明上一次恢复后又被踢回，
// 立即熔断（停止自动 bridge、展示登录表单），由用户手动登录。

export const setAuthNotice = (message: string) => {
  if (typeof window === 'undefined') {
    return
  }

  sessionStorage.setItem(AUTH_NOTICE_KEY, message)
}

export const consumeAuthNotice = () => {
  if (typeof window === 'undefined') {
    return ''
  }

  const message = sessionStorage.getItem(AUTH_NOTICE_KEY) ?? ''
  if (message) {
    sessionStorage.removeItem(AUTH_NOTICE_KEY)
  }
  return message
}

const AUTH_FORCED_LOGOUT_KEY = 'vibemux_auth_forced_logout'
const AUTH_BRIDGE_SUCCEEDED_KEY = 'vibemux_auth_bridge_succeeded'

export const markAuthForcedLogout = () => {
  if (typeof window === 'undefined') {
    return
  }

  window.sessionStorage.setItem(AUTH_FORCED_LOGOUT_KEY, '1')
}

export const markAuthBridgeSucceeded = () => {
  if (typeof window === 'undefined') {
    return
  }

  window.sessionStorage.setItem(AUTH_BRIDGE_SUCCEEDED_KEY, '1')
}

// 在 login 页每次自动 bridge 前调用：清除两个信号，并返回是否检测到循环。
export const consumeAuthRedirectLoopGuard = () => {
  if (typeof window === 'undefined') {
    return false
  }

  const forcedLogout = window.sessionStorage.getItem(AUTH_FORCED_LOGOUT_KEY) === '1'
  const bridgeSucceeded = window.sessionStorage.getItem(AUTH_BRIDGE_SUCCEEDED_KEY) === '1'
  window.sessionStorage.removeItem(AUTH_FORCED_LOGOUT_KEY)
  window.sessionStorage.removeItem(AUTH_BRIDGE_SUCCEEDED_KEY)
  return forcedLogout && bridgeSucceeded
}

export const extractErrorMessage = (text: string) => {
  const normalized = text.trim()
  if (!normalized) {
    return ''
  }

  try {
    const payload = JSON.parse(normalized) as { message?: unknown; error?: unknown }
    if (typeof payload.message === 'string' && payload.message.trim()) {
      return payload.message.trim()
    }
    if (typeof payload.error === 'string' && payload.error.trim()) {
      return payload.error.trim()
    }
  } catch {
    // Fall back to the raw text when the response body is not JSON.
  }

  const lower = normalized.toLowerCase()
  if (lower.startsWith('<!doctype') || lower.startsWith('<html') || lower.includes('<html')) {
    if (lower.includes('error code 522') || lower.includes('connection timed out')) {
      return '服务暂时不可用：Cloudflare 连接源站超时（522），请稍后重试。'
    }

    if (lower.includes('cloudflare')) {
      return '服务暂时不可用：Cloudflare 返回了网关错误页，请稍后重试。'
    }

    return '服务暂时不可用：接口返回了 HTML 错误页，请稍后重试。'
  }

  return normalized
}

// ── 统一请求中间件 ──────────────────────────────────────────
// 所有出站请求都走这里：自动注入 token、401 自动登出

export const authFetch = async (input: string, init?: RequestInit): Promise<Response> => {
  const headers: Record<string, string> = {
    ...(init?.headers as Record<string, string> ?? {}),
  }

  const hasContentType = Object.keys(headers).some((key) => key.toLowerCase() === 'content-type')
  if (!(init?.body instanceof FormData) && !hasContentType) {
    headers['Content-Type'] = 'application/json'
  }

  if (typeof window !== 'undefined') {
    Object.assign(headers, getAuthHeaders())
  }

  const response = await fetch(input, { ...init, headers })

  if (response.status === 401 && typeof window !== 'undefined') {
    const path = window.location.pathname
    // 匿名请求（未携带 Authorization）的 401 只是「接口需要认证」，不是会话过期：
    // 没有任何会话可登出，触发强制登出只会把公开页访客（如落地页）整页踢去 /login。
    // 只有请求确实带了 token 时才走「会话失效」判定。
    const sentToken = headers.Authorization
    if (path !== '/login' && sentToken) {
      // BUG-05：部分功能接口（依赖 better-auth 会话，如 /api/auth/account/accounts）
      // 对 dev login 用户也会返回 401，但 vibemux token 仍然有效。此时不应把整个会话登出——
      // 先校验 vibemux token 是否仍有效，只有 token 真的失效才强制登出。
      const storedToken = localStorage.getItem('auth_token')
      const tokenStillValid = storedToken
        ? await vibemuxTokenStillValid(storedToken)
        : false
      if (!tokenStillValid) {
        markAuthForcedLogout()
        setAuthNotice('登录状态已失效，请重新登录。开发环境热重载后会保留账号，无需重新注册。')
        localStorage.removeItem('auth_token')
        localStorage.removeItem('user')
        window.location.href = '/login'
      }
    }
  }

  return response
}

/** 校验 vibemux token 是否仍有效（/api/auth/me）。401 可能是功能级（better-auth 会话缺失），token 有效则不应登出。 */
export const vibemuxTokenStillValid = async (token: string): Promise<boolean> => {
  try {
    const me = await fetch(resolveApiUrl('/api/auth/me'), {
      headers: { Authorization: `Bearer ${token}` },
    })
    return me.ok
  } catch {
    // 网络不可达时按失效处理（保持原登出行为，不引入新风险）
    return false
  }
}

// ── JSON 请求封装 ───────────────────────────────────────────

export const request = async <T>(path: string, init?: RequestInit): Promise<T> => {
  const response = await authFetch(resolveApiUrl(path), init)

  if (!response.ok) {
    const text = await response.text()
    const error = new Error(text ? extractErrorMessage(text) : `Request failed: ${response.status}`) as Error & { status?: number }
    // 附加 HTTP status，供调用方精确判断（如 403 未归属/无权限）
    error.status = response.status
    throw error
  }

  const contentType = response.headers.get('content-type') ?? ''
  if (!contentType.includes('application/json')) {
    const text = await response.text()
    throw new Error(
      text.startsWith('<!doctype')
        ? 'API returned HTML. Please make sure the backend is running on port 8989, or set `VITE_API_BASE_URL`.'
        : text || 'API returned a non-JSON response.',
    )
  }

  return (await response.json()) as T
}

export const streamChatRequest = async (
  path: string,
  body: Record<string, unknown>,
  onMessage: (data: MainChatStreamEvent) => void,
  signal?: AbortSignal,
): Promise<{ ok: boolean; output: string; state?: AppState; aborted?: boolean }> => {
  if (signal?.aborted) {
    return { ok: false, output: '已停止', aborted: true }
  }

  const response = await authFetch(resolveApiUrl(path), {
    method: 'POST',
    body: JSON.stringify(body),
    signal,
  })

  if (!response.ok) {
    const text = await response.text()
    const message = extractErrorMessage(text)
    return {
      ok: false,
      output: message || `Request failed: ${response.status}${response.statusText ? ` ${response.statusText}` : ''}`,
    }
  }

  if (!response.body) {
    return {
      ok: false,
      output: `Request failed: ${response.status}${response.statusText ? ` ${response.statusText}` : ''}`,
    }
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  const handleAbort = () => {
    void reader.cancel().catch(() => undefined)
  }

  signal?.addEventListener('abort', handleAbort, { once: true })

  const consumeEvent = (rawEvent: string) => {
    const dataLines = rawEvent
      .split('\n')
      .filter((line) => line.startsWith('data: '))
      .map((line) => line.slice(6))

    if (dataLines.length === 0) {
      return null
    }

    try {
      return JSON.parse(dataLines.join('\n')) as MainChatStreamEvent
    } catch {
      return null
    }
  }

  try {
    while (true) {
      if (signal?.aborted) {
        return { ok: false, output: '已停止', aborted: true }
      }

      const { done, value } = await reader.read()
      if (done) {
        buffer += decoder.decode()
        break
      }

      buffer += decoder.decode(value, { stream: true })
      const events = buffer.split('\n\n')
      buffer = events.pop() ?? ''

      for (const event of events) {
        const data = consumeEvent(event)
        if (!data) {
          continue
        }

        onMessage(data)
        if (data.type === 'done' || data.type === 'error') {
          return { ok: data.type === 'done', output: data.content, state: data.state }
        }
      }
    }

    const lastEvent = consumeEvent(buffer)
    if (lastEvent) {
      onMessage(lastEvent)
      if (lastEvent.type === 'done' || lastEvent.type === 'error') {
        return { ok: lastEvent.type === 'done', output: lastEvent.content, state: lastEvent.state }
      }
    }
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      return { ok: false, output: '已停止', aborted: true }
    }
    if (signal?.aborted) {
      return { ok: false, output: '已停止', aborted: true }
    }

    return {
      ok: false,
      output: error instanceof Error ? error.message : '连接中断',
    }
  } finally {
    signal?.removeEventListener('abort', handleAbort)
  }

  return { ok: false, output: '连接中断' }
}
