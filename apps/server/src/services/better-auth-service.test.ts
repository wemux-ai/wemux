import assert from 'node:assert/strict'
import test from 'node:test'

// 桌面端（wemux-app://local）跨站调用需要 SameSite=None + Secure 的会话 cookie，
// 否则 /api/auth/*/bridge 读不到 better-auth 会话，密码登录永远 401。
test('https baseURL 下会话 cookie 升级为 SameSite=None + Secure（桌面端跨站登录）', async () => {
  process.env.BETTER_AUTH_URL = 'https://example.test'
  process.env.DATABASE_URL ||= 'postgres://127.0.0.1:1/better-auth-cookie-test'
  const { auth } = await import('./better-auth-service')
  assert.deepEqual(auth.options.advanced?.defaultCookieAttributes, {
    sameSite: 'none',
    secure: true,
  })
})
