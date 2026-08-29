// [INPUT]: codex-oauth 的纯逻辑与账户存储读写。
// [OUTPUT]: AuthDotJson 格式、账户索引、选中账户解析的单元覆盖。
// [POS]: worker 侧 ChatGPT 账号登录的回归防线。
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { buildCodexAuthDotJson } from './index'
import {
  getCodexAccountsRoot,
  readCodexAccountsIndex,
  resolveSelectedCodexAccountAuthPath,
  writeCodexAccountAuthContent,
  writeCodexAccountsIndex,
} from './account-store'

const prepareIsolatedWorkerHome = () => {
  const workerHome = mkdtempSync(path.join(tmpdir(), 'codex-oauth-test-'))
  process.env.WEMUX_WORKER_HOME = workerHome
  return workerHome
}

const cleanupWorkerHome = (workerHome: string) => {
  delete process.env.WEMUX_WORKER_HOME
  rmSync(workerHome, { recursive: true, force: true })
}

test('buildCodexAuthDotJson 生成官方 AuthDotJson 格式', () => {
  const content = buildCodexAuthDotJson({
    idToken: 'header.payload.sig',
    accessToken: 'access-token',
    refreshToken: 'refresh-token',
    chatgptAccountId: 'acc-1',
  })

  const parsed = JSON.parse(content) as Record<string, unknown>
  assert.equal(parsed.auth_mode, 'chatgpt')
  assert.equal(parsed.OPENAI_API_KEY, null)
  const tokens = parsed.tokens as Record<string, unknown>
  assert.equal(tokens.id_token, 'header.payload.sig')
  assert.equal(tokens.access_token, 'access-token')
  assert.equal(tokens.refresh_token, 'refresh-token')
  assert.equal(tokens.account_id, 'acc-1')
  assert.ok(typeof parsed.last_refresh === 'string')
})

test('账户索引与选中账户解析', () => {
  const workerHome = prepareIsolatedWorkerHome()
  try {
    const userId = 'user-test-1'
    writeCodexAccountsIndex(userId, {
      accounts: [
        { id: 'acc-a', email: 'a@example.com', createdAt: '2026-01-01T00:00:00.000Z', authenticatedAt: '2026-01-01T00:00:00.000Z' },
        { id: 'acc-b', email: 'b@example.com', createdAt: '2026-01-01T00:00:00.000Z', authenticatedAt: '2026-01-01T00:00:00.000Z' },
      ],
      activeAccountId: 'acc-b',
    })

    const index = readCodexAccountsIndex(userId)
    assert.equal(index.accounts.length, 2)
    assert.equal(index.activeAccountId, 'acc-b')

    // 选中账户但 auth.json 不存在 → 返回 null
    assert.equal(resolveSelectedCodexAccountAuthPath(userId), null)

    // 写入 auth.json 后 → 返回对应路径
    writeCodexAccountAuthContent(userId, 'acc-b', '{}')
    const resolved = resolveSelectedCodexAccountAuthPath(userId)
    assert.ok(resolved)
    assert.ok(resolved.includes(path.join('codex-accounts', 'acc-b', 'auth.json')))
    assert.ok(resolved.includes(getCodexAccountsRoot(userId)))
  } finally {
    cleanupWorkerHome(workerHome)
  }
})

test('账户目录按 users/<userId>/runtime 分层', () => {
  const workerHome = prepareIsolatedWorkerHome()
  try {
    const root = getCodexAccountsRoot('user-a')
    assert.ok(root.includes(path.join('users', 'user-a', 'runtime', 'codex-accounts')))
    assert.ok(root.startsWith(workerHome))
  } finally {
    cleanupWorkerHome(workerHome)
  }
})
