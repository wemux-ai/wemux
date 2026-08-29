// [INPUT]: workspace-share-store 授权逻辑（grant/revoke 等待 PG commit；resolve 走内存缓存）
// [OUTPUT]: 授权/解析/撤销/幂等覆盖的单元测试
// [POS]: workspace_shares 授权语义的聚焦验证：scope 三档匹配、permission 三档与取最高、撤销失效
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import test from 'node:test'
import assert from 'node:assert/strict'

import { isPostgresConfigured, query } from './db'
import {
  grantWorkspaceShare,
  resetWorkspaceShareStoreCache,
  resolveWorkspaceShareAccess,
  revokeWorkspaceShare,
} from './workspace-share-store'

const testIfPostgres = isPostgresConfigured() ? test : test.skip

let workspaceId = `ws-test-${Date.now()}-${Math.floor(Math.random() * 100000)}`
const grant = (overrides: Record<string, string | undefined> = {}) => grantWorkspaceShare({
  workspaceId,
  scope: 'session',
  sessionId: 'session-1',
  targetType: 'user',
  targetId: 'user-alice',
  permission: 'read',
  createdBy: 'user-owner',
  ...overrides,
})

testIfPostgres('grant + resolve: 会话级授权仅对指定会话生效', async () => {
  resetWorkspaceShareStoreCache()
  await grant({})

  const sessionAccess = resolveWorkspaceShareAccess('user-alice', workspaceId, 'session-1')
  assert.equal(sessionAccess.ok, true)
  assert.equal(sessionAccess.ok && sessionAccess.permission, 'read')
  // 未授权会话不可见
  assert.equal(resolveWorkspaceShareAccess('user-alice', workspaceId, 'session-2').ok, false)
  // 其他用户不可见
  assert.equal(resolveWorkspaceShareAccess('user-bob', workspaceId, 'session-1').ok, false)
  // 其他工作区不可见
  assert.equal(resolveWorkspaceShareAccess('user-alice', 'workspace-2', 'session-1').ok, false)
})

testIfPostgres('scope=workspace 覆盖该工作区任意会话', async () => {
  resetWorkspaceShareStoreCache()
  await grant({ scope: 'workspace', sessionId: undefined })

  assert.equal(resolveWorkspaceShareAccess('user-alice', workspaceId, 'session-any').ok, true)
  // 不指定会话也能命中（列表可见性用）
  assert.equal(resolveWorkspaceShareAccess('user-alice', workspaceId).ok, true)
})

testIfPostgres('scope=all_sessions 覆盖该工作区所有会话但不覆盖其他工作区', async () => {
  resetWorkspaceShareStoreCache()
  await grant({ scope: 'all_sessions', sessionId: undefined })

  assert.equal(resolveWorkspaceShareAccess('user-alice', workspaceId, 'session-x').ok, true)
  assert.equal(resolveWorkspaceShareAccess('user-alice', workspaceId, 'session-y').ok, true)
  assert.equal(resolveWorkspaceShareAccess('user-alice', 'workspace-9', 'session-x').ok, false)
})

testIfPostgres('权限取最高：read + edit + collaborate → collaborate', async () => {
  resetWorkspaceShareStoreCache()
  await grant({ permission: 'read' })
  await grant({ scope: 'workspace', sessionId: undefined, permission: 'edit' })
  await grant({ scope: 'all_sessions', sessionId: undefined, permission: 'collaborate' })

  const access = resolveWorkspaceShareAccess('user-alice', workspaceId, 'session-1')
  assert.equal(access.ok, true)
  assert.equal(access.ok && access.permission, 'collaborate')
  // 同 key 幂等：session 级记录应只有三条（scope 三档各一条）
  const sessionShares = resolveWorkspaceShareAccess('user-alice', workspaceId, 'session-1')
  assert.equal(sessionShares.ok && sessionShares.shareIds.filter((id) => id).length, 3)
})

testIfPostgres('同 key 授权幂等覆盖：重复授权只更新 permission 不新增行', async () => {
  resetWorkspaceShareStoreCache()
  const first = await grant({ permission: 'read' })
  const second = await grant({ permission: 'edit' })

  assert.equal(first.id, second.id)
  const access = resolveWorkspaceShareAccess('user-alice', workspaceId, 'session-1')
  assert.equal(access.ok && access.permission, 'edit')
  assert.equal(access.ok && access.shareIds.length, 1)
})

testIfPostgres('撤销后授权失效；重新授权可恢复', async () => {
  resetWorkspaceShareStoreCache()
  const share = await grant({})

  assert.equal(resolveWorkspaceShareAccess('user-alice', workspaceId, 'session-1').ok, true)

  const revoked = await revokeWorkspaceShare(share.id)
  assert.ok(revoked)
  assert.ok(revoked?.revokedAt)
  assert.equal(resolveWorkspaceShareAccess('user-alice', workspaceId, 'session-1').ok, false)

  // 重新授权（同 key）恢复
  await grant({})
  assert.equal(resolveWorkspaceShareAccess('user-alice', workspaceId, 'session-1').ok, true)
})

testIfPostgres('Agent 目标授权不参与用户访问解析', async () => {
  resetWorkspaceShareStoreCache()
  await grant({ targetType: 'agent', targetId: 'agent-1', sessionId: 'session-1' })

  assert.equal(resolveWorkspaceShareAccess('user-alice', workspaceId, 'session-1').ok, false)
  assert.equal(resolveWorkspaceShareAccess('agent-1', workspaceId, 'session-1').ok, false)
})

testIfPostgres('cleanup test rows', async () => {
  await query('DELETE FROM workspace_shares WHERE workspace_id = $1', [workspaceId])
})
