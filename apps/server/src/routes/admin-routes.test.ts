// [INPUT]: 管理员准入（role / isInternal / VIBEMUX_ADMIN_EMAILS env 白名单）
// [OUTPUT]: resolveAdminAccess / resolveEnvAdminEmails 判定
// [POS]: admin 权限边界（HTTP + admin.* MCP + ops 复用同一函数）

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resolveAdminAccess, resolveEnvAdminEmails } from './admin-routes'

const savedEnv = { ...process.env }
const restore = () => {
  for (const key of Object.keys(process.env)) {
    if (!(key in savedEnv)) {
      delete process.env[key]
    }
  }
  Object.assign(process.env, savedEnv)
}

test('resolveEnvAdminEmails 解析逗号分隔并小写化', () => {
  process.env.VIBEMUX_ADMIN_EMAILS = 'Admin@Example.com, user2@test.com , '
  const set = resolveEnvAdminEmails()
  assert.ok(set.has('admin@example.com'))
  assert.ok(set.has('user2@test.com'))
  assert.equal(set.size, 2)
  restore()
})

test('resolveEnvAdminEmails 未配置返回空集', () => {
  delete process.env.VIBEMUX_ADMIN_EMAILS
  delete process.env.WEMUX_ADMIN_EMAILS
  assert.equal(resolveEnvAdminEmails().size, 0)
  restore()
})

test('env 白名单匹配 → owner（无需 DB role）', () => {
  process.env.VIBEMUX_ADMIN_EMAILS = 'boss@example.com'
  const access = resolveAdminAccess({ email: 'boss@example.com' })
  assert.equal(access.allowed, true)
  assert.equal(access.role, 'owner')
  restore()
})

test('env 白名单大小写不敏感', () => {
  process.env.VIBEMUX_ADMIN_EMAILS = 'BOSS@Example.COM'
  assert.equal(resolveAdminAccess({ email: 'boss@example.com' }).role, 'owner')
  restore()
})

test('不在白名单：role=user 拒绝，role=admin 放行，isInternal 兼容', () => {
  process.env.VIBEMUX_ADMIN_EMAILS = 'boss@example.com'
  assert.equal(resolveAdminAccess({ email: 'other@example.com' }).allowed, false)
  assert.equal(resolveAdminAccess({ email: 'other@example.com', role: 'admin' }).role, 'admin')
  assert.equal(resolveAdminAccess({ email: 'other@example.com', isInternal: true }).role, 'admin')
  assert.equal(resolveAdminAccess({ email: 'other@example.com', role: 'owner' }).role, 'owner')
  restore()
})

test('无 env 白名单时按既有 role/isInternal 判定', () => {
  delete process.env.VIBEMUX_ADMIN_EMAILS
  delete process.env.WEMUX_ADMIN_EMAILS
  assert.equal(resolveAdminAccess({ email: 'x@example.com' }).allowed, false)
  assert.equal(resolveAdminAccess({ email: 'x@example.com', role: 'owner' }).role, 'owner')
  assert.equal(resolveAdminAccess({ email: 'x@example.com', isInternal: true }).role, 'admin')
  restore()
})
