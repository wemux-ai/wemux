// [INPUT]: dev 登录输入
import { getEnv } from '@shared/env'
// [OUTPUT]: dev 账号就绪
// [POS]: dev 认证服务
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import type { User } from '../repositories/auth'
import { ensurePasswordUserProfile } from '../repositories/auth'

export type DevLoginAccountConfig = {
  id: string
  label: string
  description: string
  email: string
  password: string
  name: string
  isInternal?: boolean
  onboarding: 'complete' | 'fresh'
  onboardingPath?: User['onboardingPath']
}

export type DevLoginAccountSummary = {
  id: string
  label: string
  description: string
  email: string
  name: string
}

const DEFAULT_DEV_LOGIN_ACCOUNTS: DevLoginAccountConfig[] = [
  {
    id: 'demo',
    label: 'Demo User',
    description: '恢复原有 demo 账号入口，登录后直接进入主流程，并保留已有数据。',
    email: 'demo@test.com',
    password: '123456',
    name: 'Demo User',
    isInternal: true,
    onboarding: 'complete',
    onboardingPath: 'quickstart',
  },
  {
    id: 'fresh-quickstart',
    label: 'Fresh Quickstart User',
    description: '全新账号，登录后会进入 onboarding，适合验证 quickstart 首次引导。',
    email: 'fresh-quickstart@test.com',
    password: '123456',
    name: 'Fresh Quickstart User',
    onboarding: 'fresh',
    onboardingPath: 'quickstart',
  },
  {
    id: 'fresh-team',
    label: 'Fresh Team User',
    description: '全新账号，登录后会进入 onboarding，适合验证 team 场景首次引导。',
    email: 'fresh-team@test.com',
    password: '123456',
    name: 'Fresh Team User',
    onboarding: 'fresh',
    onboardingPath: 'team',
  },
  {
    id: 'legacy-owner',
    label: 'Legacy Owner',
    description: '老账号，带项目、任务和 workspace 会话内容。',
    email: 'legacy-owner@test.com',
    password: '123456',
    name: 'Legacy Owner',
    isInternal: true,
    onboarding: 'complete',
    onboardingPath: 'quickstart',
  },
  {
    id: 'legacy-builder',
    label: 'Legacy Builder',
    description: '老账号，带协作项目、任务和历史会话内容，适合验证日常使用状态。',
    email: 'legacy-builder@test.com',
    password: '123456',
    name: 'Legacy Builder',
    onboarding: 'complete',
    onboardingPath: 'team',
  },
  {
    id: 'chat-test-a',
    label: 'Chat Test Alice',
    description: '聊天 E2E 测试账号 A（发起方 / 群成员），配合 seed 使用。',
    email: 'chat-test-a@test.com',
    password: '123456',
    name: 'Chat Test Alice',
    isInternal: true,
    onboarding: 'complete',
    onboardingPath: 'quickstart',
  },
  {
    id: 'chat-test-b',
    label: 'Chat Test Bob',
    description: '聊天 E2E 测试账号 B（接收方 / 群成员），配合 seed 使用。',
    email: 'chat-test-b@test.com',
    password: '123456',
    name: 'Chat Test Bob',
    isInternal: true,
    onboarding: 'complete',
    onboardingPath: 'quickstart',
  },
  {
    id: 'chat-test-c',
    label: 'Chat Test Carol',
    description: '聊天 E2E 测试账号 C（群成员），配合 seed 使用。',
    email: 'chat-test-c@test.com',
    password: '123456',
    name: 'Chat Test Carol',
    isInternal: true,
    onboarding: 'complete',
    onboardingPath: 'quickstart',
  },
]

export const getConfiguredDevLoginAccounts = (): DevLoginAccountConfig[] => {
  const raw = getEnv('WEMUX_DEV_LOGIN_ACCOUNTS')?.trim()
  if (!raw) {
    return DEFAULT_DEV_LOGIN_ACCOUNTS
  }

  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) {
      return DEFAULT_DEV_LOGIN_ACCOUNTS
    }

    const accounts = parsed.flatMap((item) => {
      if (!item || typeof item !== 'object') {
        return []
      }

      const account = item as Partial<DevLoginAccountConfig>
      if (
        !account.id?.trim()
        || !account.label?.trim()
        || !account.description?.trim()
        || !account.email?.trim()
        || !account.password?.trim()
        || !account.name?.trim()
        || (account.onboarding !== 'complete' && account.onboarding !== 'fresh')
      ) {
        return []
      }

      return [{
        id: account.id.trim(),
        label: account.label.trim(),
        description: account.description.trim(),
        email: account.email.trim(),
        password: account.password,
        name: account.name.trim(),
        isInternal: Boolean(account.isInternal),
        onboarding: account.onboarding,
        onboardingPath: account.onboardingPath,
      }]
    })

    return accounts.length > 0 ? accounts : DEFAULT_DEV_LOGIN_ACCOUNTS
  } catch (error) {
    console.warn('[dev-auth] Failed to parse WEMUX_DEV_LOGIN_ACCOUNTS, falling back to defaults.', error)
    return DEFAULT_DEV_LOGIN_ACCOUNTS
  }
}

const resolveAccountUserInput = (account: DevLoginAccountConfig) => {
  const onboardingCompletedAt = account.onboarding === 'complete' ? new Date().toISOString() : null

  return {
    email: account.email,
    password: account.password,
    name: account.name,
    isInternal: account.isInternal,
    onboardingCompletedAt,
    onboardingDismissedAt: null,
    onboardingPath: account.onboardingPath ?? null,
  }
}

export const isDevLoginEnabled = () => getEnv('WEMUX_ENABLE_DEV_LOGIN') === 'true'
  || (process.env.NODE_ENV !== 'production' && getEnv('WEMUX_ENABLE_DEV_LOGIN') !== 'false')

export const getDevLoginAccounts = (): DevLoginAccountSummary[] => {
  if (!isDevLoginEnabled()) {
    return []
  }

  return getConfiguredDevLoginAccounts().map((account) => ({
    id: account.id,
    label: account.label,
    description: account.description,
    email: account.email,
    name: account.name,
  }))
}

export const ensureDevLoginAccountsReady = async () => {
  if (!isDevLoginEnabled()) {
    return
  }

  for (const account of getConfiguredDevLoginAccounts()) {
    await ensurePasswordUserProfile(resolveAccountUserInput(account))
  }
}

export const signInDevLoginAccount = async (accountId: string) => {
  if (!isDevLoginEnabled()) {
    return null
  }

  const account = getConfiguredDevLoginAccounts().find((item) => item.id === accountId.trim())
  if (!account) {
    return null
  }

  return ensurePasswordUserProfile(resolveAccountUserInput(account))
}
