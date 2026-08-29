// [INPUT]: 实验性设置输入
// [OUTPUT]: 存取
// [POS]: 用户实验性功能设置
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import {
  defaultUserExperimentalSettings,
  normalizeUserExperimentalSettings,
  toExecutorFeatureFlags,
  type ExecutorFeatureFlags,
  type UserExperimentalSettings,
} from '@shared/user-experimental-settings'
import { getMeta, saveMeta } from '../storage/app-state-store'

const USER_EXPERIMENTAL_SETTINGS_META_KEY_PREFIX = 'user_experimental_settings:'

const buildUserExperimentalSettingsMetaKey = (userId: string) => {
  return `${USER_EXPERIMENTAL_SETTINGS_META_KEY_PREFIX}${userId}`
}

export const getUserExperimentalSettings = (
  userId: string,
): UserExperimentalSettings => {
  return normalizeUserExperimentalSettings(
    getMeta<UserExperimentalSettings | null>(
      buildUserExperimentalSettingsMetaKey(userId),
      defaultUserExperimentalSettings(),
    ),
  )
}

export const saveUserExperimentalSettings = (
  userId: string,
  settings: unknown,
): UserExperimentalSettings => {
  const normalizedSettings = normalizeUserExperimentalSettings(settings)
  saveMeta(buildUserExperimentalSettingsMetaKey(userId), normalizedSettings)
  return normalizedSettings
}

// 供控制面下发 featureFlags 使用；userId 为 undefined（无主 executor）时返回全 false 默认
export const resolveUserFeatureFlags = (userId?: string): ExecutorFeatureFlags => {
  return toExecutorFeatureFlags(userId ? getUserExperimentalSettings(userId) : undefined)
}
