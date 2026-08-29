// [INPUT]: worker 本地存储分层（users/<userId>/runtime），Codex OAuth 账户持久化需求。
// [OUTPUT]: ChatGPT 托管账户的目录/索引/auth.json 读写，权限 0600。
// [POS]: worker 侧 ChatGPT 账号存储层；目录遵循 AGENTS.md users/<userId>/runtime 分层。
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import type { CodexAccountRecord, CodexAccountsIndex } from '@shared/types'
import { getWorkerHome } from '../../core/config'
import { getWorkspaceUserScopeDir } from '@shared/workspace-paths'

export type { CodexAccountRecord, CodexAccountsIndex }

export type PendingDeviceLogin = {
  deviceAuthId: string
  userCode: string
  intervalSec: number
  verificationUri: string
  startedAt: string
  state: 'pending' | 'complete' | 'error'
  accountId?: string
  error?: string
  completedAt?: string
}

const CODE_X_ACCOUNTS_DIR = 'codex-accounts'
const ACCOUNTS_INDEX_FILE = 'accounts.json'
const PENDING_FILE = 'pending.json'
const AUTH_FILE = 'auth.json'

const writePrivateFile = (filePath: string, content: string) => {
  mkdirSync(path.dirname(filePath), { recursive: true })
  writeFileSync(filePath, content, { encoding: 'utf8', mode: 0o600 })
}

const readJsonFile = <T>(filePath: string): T | null => {
  try {
    return JSON.parse(readFileSync(filePath, 'utf8')) as T
  } catch {
    return null
  }
}

export const getCodexAccountsRoot = (userId: string) => {
  return path.join(getWorkspaceUserScopeDir(getWorkerHome(), userId), 'runtime', CODE_X_ACCOUNTS_DIR)
}

export const getCodexAccountDir = (userId: string, accountId: string) => {
  return path.join(getCodexAccountsRoot(userId), accountId)
}

export const getCodexAccountAuthPath = (userId: string, accountId: string) => {
  return path.join(getCodexAccountDir(userId, accountId), AUTH_FILE)
}

export const getCodexAccountsIndexPath = (userId: string) => {
  return path.join(getCodexAccountsRoot(userId), ACCOUNTS_INDEX_FILE)
}

export const getCodexPendingPath = (userId: string) => {
  return path.join(getCodexAccountsRoot(userId), PENDING_FILE)
}

export const readCodexAccountsIndex = (userId: string): CodexAccountsIndex => {
  const index = readJsonFile<CodexAccountsIndex>(getCodexAccountsIndexPath(userId))
  return index ?? { accounts: [], activeAccountId: null }
}

export const writeCodexAccountsIndex = (userId: string, index: CodexAccountsIndex) => {
  writePrivateFile(getCodexAccountsIndexPath(userId), `${JSON.stringify(index, null, 2)}\n`)
}

export const readCodexPendingLogin = (userId: string): PendingDeviceLogin | null => {
  return readJsonFile<PendingDeviceLogin>(getCodexPendingPath(userId))
}

export const writeCodexPendingLogin = (userId: string, pending: PendingDeviceLogin) => {
  writePrivateFile(getCodexPendingPath(userId), `${JSON.stringify(pending, null, 2)}\n`)
}

export const clearCodexPendingLogin = (userId: string) => {
  const pendingPath = getCodexPendingPath(userId)
  if (existsSync(pendingPath)) {
    rmSync(pendingPath, { force: true })
  }
}

export const readCodexAccountAuthContent = (userId: string, accountId: string): string | null => {
  const authPath = getCodexAccountAuthPath(userId, accountId)
  if (!existsSync(authPath)) {
    return null
  }
  try {
    return readFileSync(authPath, 'utf8')
  } catch {
    return null
  }
}

export const writeCodexAccountAuthContent = (userId: string, accountId: string, content: string) => {
  writePrivateFile(getCodexAccountAuthPath(userId, accountId), content)
}

/**
 * 选中账户的 auth.json 路径；没有选中或账户不存在时返回 null。
 * 供 codex-runner 在执行时优先使用托管 ChatGPT 账户登录态。
 */
export const resolveSelectedCodexAccountAuthPath = (userId: string): string | null => {
  const index = readCodexAccountsIndex(userId)
  if (!index.activeAccountId) {
    return null
  }
  const account = index.accounts.find((item) => item.id === index.activeAccountId)
  if (!account) {
    return null
  }
  const authPath = getCodexAccountAuthPath(userId, account.id)
  return existsSync(authPath) ? authPath : null
}
