// [INPUT]: 设备码协议客户端 + 托管账户存储 + 用户身份。
// [OUTPUT]: ChatGPT 账号登录的服务面：start/status/accounts/select/remove 与后台轮询。
// [POS]: worker 侧 ChatGPT 账号登录编排层；token 只落本地私有目录，不上送控制面。
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import { randomUUID } from 'node:crypto'
import { rmSync } from 'node:fs'
import {
  clearCodexPendingLogin,
  getCodexAccountAuthPath,
  readCodexAccountsIndex,
  readCodexPendingLogin,
  readCodexAccountAuthContent,
  writeCodexAccountAuthContent,
  writeCodexAccountsIndex,
  writeCodexPendingLogin,
  type CodexAccountRecord,
  type CodexAccountsIndex,
  type PendingDeviceLogin,
} from './account-store'
import {
  exchangeOpenAiCodeForTokens,
  pollOpenAiDeviceToken,
  requestOpenAiDeviceCode,
  OPENAI_DEVICE_AUTH_TIMEOUT_MS,
} from './device-client'

import type { CodexDeviceStatus } from '@shared/types'

export type { CodexDeviceStatus } from '@shared/types'

type IdTokenClaims = {
  email?: string
  chatgpt_plan_type?: string
  chatgpt_user_id?: string
  chatgpt_account_id?: string
}

const decodeJwtPayload = (jwt: string): IdTokenClaims | null => {
  try {
    const payload = jwt.split('.')[1]
    if (!payload) {
      return null
    }
    const base64 = payload.replace(/-/g, '+').replace(/_/g, '/')
    const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '=')
    const json = Buffer.from(padded, 'base64').toString('utf8')
    return JSON.parse(json) as IdTokenClaims
  } catch {
    return null
  }
}

/**
 * 生成与官方 `codex login` 一致的 auth.json（AuthDotJson 格式）：
 * auth_mode=chatgpt + tokens{id_token raw jwt, access_token, refresh_token, account_id} + last_refresh。
 */
export const buildCodexAuthDotJson = (input: {
  idToken: string
  accessToken: string
  refreshToken: string
  chatgptAccountId?: string
}): string => {
  const auth: Record<string, unknown> = {
    auth_mode: 'chatgpt',
    OPENAI_API_KEY: null,
    tokens: {
      id_token: input.idToken,
      access_token: input.accessToken,
      refresh_token: input.refreshToken,
      account_id: input.chatgptAccountId ?? null,
    },
    last_refresh: new Date().toISOString(),
  }
  return `${JSON.stringify(auth, null, 2)}\n`
}

const runningPolls = new Map<string, Promise<void>>()

const registerAccountFromTokens = (userId: string, input: {
  idToken: string
  accessToken: string
  refreshToken: string
}): CodexAccountRecord => {
  const claims = decodeJwtPayload(input.idToken)
  const now = new Date().toISOString()
  const account: CodexAccountRecord = {
    id: randomUUID(),
    email: claims?.email || 'chatgpt-account',
    planType: claims?.chatgpt_plan_type,
    chatgptUserId: claims?.chatgpt_user_id,
    chatgptAccountId: claims?.chatgpt_account_id,
    createdAt: now,
    authenticatedAt: now,
  }
  writeCodexAccountAuthContent(userId, account.id, buildCodexAuthDotJson({
    idToken: input.idToken,
    accessToken: input.accessToken,
    refreshToken: input.refreshToken,
    chatgptAccountId: account.chatgptAccountId,
  }))
  const index = readCodexAccountsIndex(userId)
  index.accounts.push(account)
  if (!index.activeAccountId) {
    index.activeAccountId = account.id
  }
  writeCodexAccountsIndex(userId, index)
  return account
}

const pollDeviceLogin = async (userId: string, pending: PendingDeviceLogin) => {
  const deadline = Date.now() + OPENAI_DEVICE_AUTH_TIMEOUT_MS
  while (Date.now() < deadline) {
    let result: Awaited<ReturnType<typeof pollOpenAiDeviceToken>>
    try {
      result = await pollOpenAiDeviceToken(pending.deviceAuthId, pending.userCode)
    } catch (error) {
      updatePendingState(userId, { state: 'error', error: error instanceof Error ? error.message : 'device auth failed' })
      return
    }

    if (result.kind === 'pending') {
      await new Promise((resolve) => setTimeout(resolve, Math.max(pending.intervalSec, 1) * 1000))
      continue
    }

    try {
      const tokens = await exchangeOpenAiCodeForTokens(result.authorizationCode, result.codeVerifier)
      const account = registerAccountFromTokens(userId, tokens)
      updatePendingState(userId, { state: 'complete', accountId: account.id })
      return
    } catch (error) {
      updatePendingState(userId, { state: 'error', error: error instanceof Error ? error.message : 'token exchange failed' })
      return
    }
  }
  updatePendingState(userId, { state: 'error', error: 'device auth timed out after 15 minutes' })
}

const updatePendingState = (userId: string, patch: { state: 'complete', accountId: string } | { state: 'error', error: string }) => {
  const current = readCodexPendingLogin(userId)
  if (!current) {
    return
  }
  writeCodexPendingLogin(userId, {
    ...current,
    state: patch.state,
    ...(patch.state === 'complete' ? { accountId: patch.accountId, completedAt: new Date().toISOString() } : { error: patch.error, completedAt: new Date().toISOString() }),
  })
}

export const startCodexDeviceLogin = async (userId: string): Promise<CodexDeviceStatus> => {
  const deviceCode = await requestOpenAiDeviceCode()
  const pending: PendingDeviceLogin = {
    deviceAuthId: deviceCode.deviceAuthId,
    userCode: deviceCode.userCode,
    intervalSec: deviceCode.intervalSec,
    verificationUri: deviceCode.verificationUri,
    startedAt: new Date().toISOString(),
    state: 'pending',
  }
  writeCodexPendingLogin(userId, pending)

  const pollPromise = pollDeviceLogin(userId, pending)
  runningPolls.set(userId, pollPromise)
  void pollPromise.finally(() => {
    if (runningPolls.get(userId) === pollPromise) {
      runningPolls.delete(userId)
    }
  })

  return {
    state: 'pending',
    userCode: deviceCode.userCode,
    verificationUri: deviceCode.verificationUri,
    startedAt: pending.startedAt,
  }
}

export const getCodexDeviceStatus = (userId: string): CodexDeviceStatus => {
  const pending = readCodexPendingLogin(userId)
  if (!pending) {
    return { state: 'idle' }
  }

  if (pending.state === 'complete' && pending.accountId) {
    const account = readCodexAccountsIndex(userId).accounts.find((item) => item.id === pending.accountId)
    if (account) {
      return { state: 'complete', account }
    }
  }

  if (pending.state === 'error') {
    return { state: 'error', message: pending.error || 'login failed' }
  }

  const elapsed = Date.now() - new Date(pending.startedAt).getTime()
  if (elapsed >= OPENAI_DEVICE_AUTH_TIMEOUT_MS) {
    return { state: 'error', message: 'device auth timed out after 15 minutes' }
  }

  return {
    state: 'pending',
    userCode: pending.userCode,
    verificationUri: pending.verificationUri,
    startedAt: pending.startedAt,
  }
}

export const dismissCodexDeviceLogin = (userId: string) => {
  clearCodexPendingLogin(userId)
}

export const listCodexAccounts = (userId: string): CodexAccountsIndex => {
  return readCodexAccountsIndex(userId)
}

export const selectCodexAccount = (userId: string, accountId: string): CodexAccountsIndex | null => {
  const index = readCodexAccountsIndex(userId)
  if (!index.accounts.some((item) => item.id === accountId)) {
    return null
  }
  index.activeAccountId = accountId
  writeCodexAccountsIndex(userId, index)
  return index
}

export const removeCodexAccount = (userId: string, accountId: string): CodexAccountsIndex | null => {
  const index = readCodexAccountsIndex(userId)
  const target = index.accounts.find((item) => item.id === accountId)
  if (!target) {
    return null
  }
  index.accounts = index.accounts.filter((item) => item.id !== accountId)
  if (index.activeAccountId === accountId) {
    index.activeAccountId = index.accounts[0]?.id ?? null
  }
  writeCodexAccountsIndex(userId, index)
  rmSync(getCodexAccountAuthPath(userId, accountId), { force: true })
  return index
}

export const readSelectedCodexAuthContent = (userId: string): string | null => {
  const index = readCodexAccountsIndex(userId)
  if (!index.activeAccountId) {
    return null
  }
  const account = index.accounts.find((item) => item.id === index.activeAccountId)
  if (!account) {
    return null
  }
  return readCodexAccountAuthContent(userId, account.id)
}
