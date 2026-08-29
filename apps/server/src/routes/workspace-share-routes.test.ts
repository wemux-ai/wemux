// [INPUT]: 已注册 workspace-share 路由的 Hono app + 本地 Postgres（collab workspace 成员判定）
// [OUTPUT]: 授权/列表/撤销 HTTP 主链路集成测试
// [POS]: workspace_shares 协议层聚焦验证：成员可授权、列表可见、撤销生效、非成员被拒
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import assert from 'node:assert/strict'
import test from 'node:test'
import { Hono } from 'hono'
import type { MiddlewareHandler } from 'hono'
import { addTeamMember, createTeam, createUser } from '../storage/postgres/auth-store'
import { createToken } from '../repositories/auth'
import { initWorkspaceShareStore } from '../storage/postgres/workspace-share-store'
import { registerWorkspaceShareRoutes } from './workspace-share-routes'

const requireAuth: MiddlewareHandler = async (c, next) => {
  const authHeader = c.req.header('Authorization')
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return c.json({ message: '未登录' }, 401)
  }
  await next()
}

const createApp = () => {
  const app = new Hono()
  registerWorkspaceShareRoutes(app, requireAuth)
  return app
}

test('workspace share routes: grant → list → revoke 主链路', async () => {
  await initWorkspaceShareStore().catch(() => {})

  const ownerEmail = `share-owner-${crypto.randomUUID()}@test.local`
  const targetEmail = `share-target-${crypto.randomUUID()}@test.local`
  const owner = await createUser(ownerEmail, 'password-1', 'Share Owner')
  const target = await createUser(targetEmail, 'password-2', 'Share Target')
  const team = createTeam(`Share Team ${crypto.randomUUID()}`, owner.id)
  addTeamMember(team.id, owner.id, 'owner')

  const app = createApp()
  const auth = { Authorization: `Bearer ${createToken(owner.id)}` }

  // 授权（会话级，默认权限 read）
  const grantResponse = await app.request(`/api/workspaces/${team.id}/shares`, {
    method: 'POST',
    headers: auth,
    body: JSON.stringify({
      scope: 'session',
      sessionId: 'session-1',
      targetType: 'user',
      targetId: target.id,
      permission: 'edit',
    }),
  })
  assert.equal(grantResponse.status, 201)
  const grantBody = (await grantResponse.json()) as { share: { id: string; permission: string } }
  assert.equal(grantBody.share.permission, 'edit')

  // 列表可见
  const listResponse = await app.request(`/api/workspaces/${team.id}/shares`, { headers: auth })
  assert.equal(listResponse.status, 200)
  const listBody = (await listResponse.json()) as { shares: Array<{ id: string; targetId: string }> }
  assert.equal(listBody.shares.some((share) => share.id === grantBody.share.id && share.targetId === target.id), true)

  // 撤销
  const revokeResponse = await app.request(`/api/workspaces/${team.id}/shares/${grantBody.share.id}`, {
    method: 'DELETE',
    headers: auth,
  })
  assert.equal(revokeResponse.status, 200)
  const revokeBody = (await revokeResponse.json()) as { share: { revokedAt?: string } | null }
  assert.ok(revokeBody.share?.revokedAt)

  // 撤销后列表不再包含
  const listAfterResponse = await app.request(`/api/workspaces/${team.id}/shares`, { headers: auth })
  const listAfterBody = (await listAfterResponse.json()) as { shares: Array<{ id: string }> }
  assert.equal(listAfterBody.shares.some((share) => share.id === grantBody.share.id), false)
})

test('workspace share routes: 非成员授权被拒；目标用户不存在被拒', async () => {
  await initWorkspaceShareStore().catch(() => {})

  const ownerEmail = `share-owner2-${crypto.randomUUID()}@test.local`
  const outsiderEmail = `share-outsider-${crypto.randomUUID()}@test.local`
  const owner = await createUser(ownerEmail, 'password-1', 'Share Owner 2')
  const outsider = await createUser(outsiderEmail, 'password-2', 'Share Outsider')
  const team = createTeam(`Share Team 2 ${crypto.randomUUID()}`, owner.id)
  addTeamMember(team.id, owner.id, 'owner')

  const app = createApp()

  // 非成员授权 → 403
  const outsiderResponse = await app.request(`/api/workspaces/${team.id}/shares`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${createToken(outsider.id)}` },
    body: JSON.stringify({
      scope: 'session',
      sessionId: 'session-1',
      targetType: 'user',
      targetId: owner.id,
      permission: 'read',
    }),
  })
  assert.equal(outsiderResponse.status, 403)

  // 成员授权但目标用户不存在 → 404
  const missingTargetResponse = await app.request(`/api/workspaces/${team.id}/shares`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${createToken(owner.id)}` },
    body: JSON.stringify({
      scope: 'session',
      sessionId: 'session-1',
      targetType: 'user',
      targetId: 'user-does-not-exist',
      permission: 'read',
    }),
  })
  assert.equal(missingTargetResponse.status, 404)

  // 会话级共享缺少 sessionId → 400
  const missingSessionResponse = await app.request(`/api/workspaces/${team.id}/shares`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${createToken(owner.id)}` },
    body: JSON.stringify({
      scope: 'session',
      targetType: 'user',
      targetId: owner.id,
      permission: 'read',
    }),
  })
  assert.equal(missingSessionResponse.status, 400)
})
