// [INPUT]: 任务 Git 身份配置输入（personal/PAT/SSH 偏好）
// [OUTPUT]: Git 身份配置组装结果
// [POS]: 任务级 Git 身份配置
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import { getMeta, saveMeta } from '../storage/app-state-store'

export interface GitIdentityConfigRecord {
  personal: {
    name: string
    email: string
    token: string
  }
}

const trim = (value: string | undefined) => value?.trim() || ''

const defaultConfig = (): GitIdentityConfigRecord => ({
  personal: {
    name: '',
    email: '',
    token: '',
  },
})

const META_KEY = 'gitIdentityConfig'

export const getGitIdentityConfig = (): GitIdentityConfigRecord => {
  return getMeta<GitIdentityConfigRecord>(META_KEY, defaultConfig())
}

export const saveGitIdentityConfig = (config: GitIdentityConfigRecord) => {
  const normalized: GitIdentityConfigRecord = {
    personal: {
      name: trim(config.personal.name),
      email: trim(config.personal.email),
      token: trim(config.personal.token),
    },
  }
  saveMeta(META_KEY, normalized)
  return normalized
}

export const toGitIdentityHealth = (config: GitIdentityConfigRecord) => ({
  personal: {
    configured: Boolean(config.personal.name && config.personal.email),
    hasCredentialToken: Boolean(config.personal.token),
  },
})
