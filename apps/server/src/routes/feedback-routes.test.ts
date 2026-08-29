import assert from 'node:assert/strict'
import test from 'node:test'
import { Hono } from 'hono'
import type { MiddlewareHandler } from 'hono'
import { createToken } from '../repositories/auth'
import { ensurePasswordUserProfile, getUserByEmail } from '../repositories/auth'
import { initConversationStore } from '../storage/conversation-store'
import { registerFeedbackRoutes } from './feedback-routes'

const requireAuth: MiddlewareHandler = async (c, next) => {
  const authHeader = c.req.header('Authorization')
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return c.json({ message: '未登录' }, 401)
  }
  await next()
}

const createApp = () => {
  const app = new Hono()
  registerFeedbackRoutes(app, requireAuth)
  return app
}

const authedHeaders = (userId: string) => ({
  Authorization: `Bearer ${createToken(userId)}`,
})

test('未登录用户不能提交反馈', async () => {
  await initConversationStore().catch(() => {})
  const app = createApp()
  const response = await app.request('/api/feedback', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'bug', title: 'x', body: 'y' }),
  })
  assert.equal(response.status, 401)
})

test('反馈内容不合法时返回 400（在落库之前校验）', async () => {
  await initConversationStore().catch(() => {})
  const app = createApp()
  const response = await app.request('/api/feedback', {
    method: 'POST',
    headers: { ...authedHeaders('user-1'), 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'bug', title: '', body: '' }),
  })
  assert.equal(response.status, 400)
})

test('consentPublic 非布尔时返回 400（在落库之前校验）', async () => {
  await initConversationStore().catch(() => {})
  const app = createApp()
  const response = await app.request('/api/feedback', {
    method: 'POST',
    headers: { ...authedHeaders('user-1'), 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'bug', title: 'x', body: 'y', consentPublic: 'yes' }),
  })
  assert.equal(response.status, 400)
})

test('非内部管理员不能查看 admin 反馈列表', async () => {
  await initConversationStore().catch(() => {})
  const app = createApp()
  const response = await app.request('/api/admin/feedback', {
    headers: authedHeaders('user-regular'),
  })
  assert.equal(response.status, 403)
})

test('非内部管理员不能回复用户', async () => {
  await initConversationStore().catch(() => {})
  const app = createApp()
  const response = await app.request('/api/admin/feedback/feedback:1/reply', {
    method: 'POST',
    headers: { ...authedHeaders('user-regular'), 'Content-Type': 'application/json' },
    body: JSON.stringify({ content: '你好' }),
  })
  assert.equal(response.status, 403)
})

test('BUG-04：env 白名单管理员（无 isInternal/role）可访问 admin 反馈接口，不再 403', async () => {
  await initConversationStore().catch(() => {})
  const savedEnv = process.env.VIBEMUX_ADMIN_EMAILS
  process.env.VIBEMUX_ADMIN_EMAILS = 'boss@example.com'
  try {
    // 注入内存 user（无 DB 时缓存仍生效；ensurePasswordUserProfile 先写缓存再落库）
    await ensurePasswordUserProfile({ email: 'boss@example.com', password: 'test-pass-1', name: 'Boss' }).catch(() => {})
    const boss = getUserByEmail('boss@example.com')
    assert.ok(boss, 'boss 用户应已注入缓存')
    assert.equal(boss.isInternal, false, '前置条件：该用户不是 isInternal')

    const app = createApp()
    // 准入检查在 DB 访问之前：修复前此处返回 403；通过准入后无 DB 时是 500，有 DB 时是 200
    const response = await app.request('/api/admin/feedback', {
      headers: authedHeaders(boss.id),
    })
    assert.notEqual(response.status, 403, 'env 白名单管理员不应被 403')
  } finally {
    if (savedEnv === undefined) {
      delete process.env.VIBEMUX_ADMIN_EMAILS
    } else {
      process.env.VIBEMUX_ADMIN_EMAILS = savedEnv
    }
  }
})

test('未携带 token 的 admin 请求返回 401', async () => {
  await initConversationStore().catch(() => {})
  const app = createApp()
  const response = await app.request('/api/admin/feedback', {})
  assert.equal(response.status, 401)
})

test('BUG-02：/api/feedback/chat 不被 :id 参数路由抢先（静态路由优先）', async () => {
  await initConversationStore().catch(() => {})
  const app = createApp()
  // 本地无 Postgres 时可能 500，但绝不能再是 :id 路由的 404「反馈不存在」（路由被抢先的表现）
  const response = await app.request('/api/feedback/chat', {
    headers: authedHeaders('user-1'),
  })
  const body = await response.json().catch(() => null)
  assert.notEqual(body?.message, '反馈不存在')
})

test('BUG-02：/api/feedback/unread-count 不被 :id 参数路由抢先', async () => {
  await initConversationStore().catch(() => {})
  const app = createApp()
  // 无 DB 时 unread-count 可能 500，但绝不能再是 :id 路由的 404「反馈不存在」
  const response = await app.request('/api/feedback/unread-count', {
    headers: authedHeaders('user-1'),
  })
  const body = await response.json().catch(() => null)
  assert.notEqual(body?.message, '反馈不存在')
})

test('BUG-03：/api/feedback/:id 在启动时注册，不在请求处理中动态 app.get', async () => {
  await initConversationStore().catch(() => {})
  const app = createApp()
  // 未带 token：若 :id 未在启动时注册（曾被误嵌套进 unread-count handler，请求时动态注册会
  // 触发 Hono「matcher is already built」），请求会 fall-through 成 404；修复后应命中路由并
  // 被 requireAuth 拦截为 401。
  const response = await app.request('/api/feedback/any-id', {})
  assert.equal(response.status, 401)
})

test('BUG-03：静态路由连续请求不再触发动态注册（matcher 构建后不再 app.get）', async () => {
  await initConversationStore().catch(() => {})
  const app = createApp()
  // 第一次请求构建 matcher；修复前第二次请求仍会在 handler 内再次注册 :id 而抛错
  const first = await app.request('/api/feedback/unread-count', {})
  const second = await app.request('/api/feedback/unread-count', {})
  assert.equal(first.status, 401)
  assert.equal(second.status, 401)
})
