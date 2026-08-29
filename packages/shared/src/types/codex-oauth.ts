// [INPUT]: web/server/worker 共同需要的 ChatGPT（Codex OAuth）账号结构与操作契约。
// [OUTPUT]: 设备码登录状态、托管账号索引、导出结果与 WS 转发操作枚举。
// [POS]: 跨端 Codex OAuth 契约层；worker 本地存储结构见 apps/worker/src/runtime/codex-oauth。
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

export type CodexAccountRecord = {
  id: string
  email: string
  planType?: string
  chatgptUserId?: string
  chatgptAccountId?: string
  createdAt: string
  authenticatedAt: string
}

export type CodexAccountsIndex = {
  accounts: CodexAccountRecord[]
  activeAccountId: string | null
}

export type CodexDeviceStatus =
  | { state: 'idle' }
  | { state: 'pending', userCode: string, verificationUri: string, startedAt: string }
  | { state: 'complete', account: CodexAccountRecord }
  | { state: 'error', message: string }

export type CodexOauthOperation =
  | 'device.start'
  | 'device.status'
  | 'device.dismiss'
  | 'accounts.list'
  | 'accounts.select'
  | 'accounts.remove'
  | 'export'

export type CodexOauthExportResult = {
  authContent: string | null
  account?: CodexAccountRecord | null
}

export type ExecutorCodexOauthResponsePayload =
  | CodexDeviceStatus
  | CodexAccountsIndex
  | CodexOauthExportResult
  | { ok: true }
  | null
