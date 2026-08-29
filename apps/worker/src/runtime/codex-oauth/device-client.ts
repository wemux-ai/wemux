// [INPUT]: OpenAI Codex 官方 OAuth 设备码协议参数（对齐 codex-rs device_code_auth.rs / server.rs）。
// [OUTPUT]: 设备码流程的 HTTP 客户端（请求设备码 → 轮询授权 → 换 token）。
// [POS]: worker 侧 ChatGPT 账号登录的协议层，不含任何持久化。
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

export const OPENAI_AUTH_BASE_URL = 'https://auth.openai.com'
export const OPENAI_CODEX_CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann'
export const OPENAI_DEVICE_VERIFY_PATH = '/codex/device'
export const OPENAI_DEVICE_AUTH_TIMEOUT_MS = 15 * 60 * 1000

export type DeviceCodeRequest = {
  deviceAuthId: string
  userCode: string
  intervalSec: number
  verificationUri: string
}

export type DeviceTokenPollResult =
  | { kind: 'complete', authorizationCode: string, codeVerifier: string }
  | { kind: 'pending' }

export type ExchangedCodexTokens = {
  idToken: string
  accessToken: string
  refreshToken: string
}

type UserCodeResponse = {
  device_auth_id: string
  user_code?: string
  usercode?: string
  interval?: string | number
}

type DeviceTokenResponse = {
  authorization_code?: string
  code_challenge?: string
  code_verifier?: string
}

type TokenExchangeResponse = {
  id_token?: string
  access_token?: string
  refresh_token?: string
}

const readInterval = (value?: string | number): number => {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return value
  }
  const parsed = typeof value === 'string' ? Number.parseInt(value, 10) : NaN
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 5
}

const postJson = async <T>(url: string, body: unknown, expectedStatus: number): Promise<T> => {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const payload = await response.json().catch(() => ({})) as T
  if (response.status !== expectedStatus) {
    throw new Error(`Codex OAuth 请求失败 (${response.status})`)
  }
  return payload
}

/**
 * 第一步：向 OpenAI 申请设备码。PKCE 参数无需客户端生成——服务端会在轮询响应里返回。
 */
export const requestOpenAiDeviceCode = async (): Promise<DeviceCodeRequest> => {
  const payload = await postJson<UserCodeResponse>(
    `${OPENAI_AUTH_BASE_URL}/api/accounts/deviceauth/usercode`,
    { client_id: OPENAI_CODEX_CLIENT_ID },
    200,
  )
  const deviceAuthId = payload.device_auth_id
  const userCode = payload.user_code || payload.usercode
  if (!deviceAuthId || !userCode) {
    throw new Error('OpenAI 设备码响应缺少 device_auth_id / user_code')
  }
  return {
    deviceAuthId,
    userCode,
    intervalSec: readInterval(payload.interval),
    verificationUri: `${OPENAI_AUTH_BASE_URL}${OPENAI_DEVICE_VERIFY_PATH}`,
  }
}

/**
 * 第二步：轮询授权状态。403/404 = 用户还没完成授权（返回 pending）；200 = 拿到 authorization_code。
 */
export const pollOpenAiDeviceToken = async (
  deviceAuthId: string,
  userCode: string,
): Promise<DeviceTokenPollResult> => {
  const url = `${OPENAI_AUTH_BASE_URL}/api/accounts/deviceauth/token`
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ device_auth_id: deviceAuthId, user_code: userCode }),
  })

  if (response.status === 200) {
    const payload = await response.json() as DeviceTokenResponse
    const authorizationCode = payload.authorization_code
    const codeVerifier = payload.code_verifier
    if (!authorizationCode || !codeVerifier) {
      throw new Error('OpenAI 设备码授权响应缺少 authorization_code / code_verifier')
    }
    return { kind: 'complete', authorizationCode, codeVerifier }
  }

  if (response.status === 403 || response.status === 404) {
    return { kind: 'pending' }
  }

  throw new Error(`Codex OAuth 设备码轮询失败 (${response.status})`)
}

/**
 * 第三步：用 authorization_code 换 id/access/refresh token（对齐 codex-rs exchange_code_for_tokens）。
 */
export const exchangeOpenAiCodeForTokens = async (
  authorizationCode: string,
  codeVerifier: string,
): Promise<ExchangedCodexTokens> => {
  const redirectUri = `${OPENAI_AUTH_BASE_URL}/deviceauth/callback`
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code: authorizationCode,
    redirect_uri: redirectUri,
    client_id: OPENAI_CODEX_CLIENT_ID,
    code_verifier: codeVerifier,
  })
  const response = await fetch(`${OPENAI_AUTH_BASE_URL}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })
  const payload = await response.json().catch(() => ({})) as TokenExchangeResponse
  if (!response.ok || !payload.id_token || !payload.access_token || !payload.refresh_token) {
    throw new Error(`Codex OAuth token 交换失败 (${response.status})`)
  }
  return {
    idToken: payload.id_token,
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token,
  }
}
