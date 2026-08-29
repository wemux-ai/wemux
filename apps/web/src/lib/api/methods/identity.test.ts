// [INPUT]: 无（读取前端 identity.ts 源码与安装的 better-auth 端点声明）
// [OUTPUT]: 断言两端点名一致
// [POS]: 回归 BUG-01——前端调用的 better-auth 端点名必须与安装版本（1.6.7）实际端点一致，
//        防止再次出现 /sign-in/email-password、/request-email-verification 这类 404
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'
import assert from 'node:assert/strict'

const repoRoot = process.cwd()
const identitySource = readFileSync(path.join(repoRoot, 'apps/web/src/lib/api/methods/identity.ts'), 'utf8')
const signInSource = readFileSync(path.join(repoRoot, 'node_modules/better-auth/dist/api/routes/sign-in.mjs'), 'utf8')
const emailVerificationSource = readFileSync(path.join(repoRoot, 'node_modules/better-auth/dist/api/routes/email-verification.mjs'), 'utf8')
const passwordSource = readFileSync(path.join(repoRoot, 'node_modules/better-auth/dist/api/routes/password.mjs'), 'utf8')

/** better-auth 1.6.7 实际暴露的端点 */
const declaredEndpoints = new Set([
  ...signInSource.matchAll(/createAuthEndpoint\("([^"]+)"/g),
  ...emailVerificationSource.matchAll(/createAuthEndpoint\("([^"]+)"/g),
  ...passwordSource.matchAll(/createAuthEndpoint\("([^"]+)"/g),
].map((match) => match[1]))

const findFrontendEndpoint = (methodName: string): string | null => {
  const methodStart = identitySource.indexOf(`${methodName}: async`)
  assert.ok(methodStart >= 0, `identity.ts 未找到 ${methodName}`)
  const methodBlock = identitySource.slice(methodStart, methodStart + 1200)
  const match = /resolveBetterAuthUrl\('([^']+)'\)/.exec(methodBlock)
  return match?.[1] ?? null
}

test('BUG-01：邮箱密码登录端点与 better-auth 1.6.7 一致（/sign-in/email）', () => {
  const endpoint = findFrontendEndpoint('signInWithEmailPassword')
  assert.ok(endpoint, '未找到 signInWithEmailPassword 端点')
  assert.ok(declaredEndpoints.has(endpoint), `better-auth 未声明端点 ${endpoint}`)
  assert.equal(endpoint, '/sign-in/email')
})

test('BUG-01：重发验证邮件端点与 better-auth 1.6.7 一致（/send-verification-email）', () => {
  const endpoint = findFrontendEndpoint('requestEmailVerification')
  assert.ok(endpoint, '未找到 requestEmailVerification 端点')
  assert.ok(declaredEndpoints.has(endpoint), `better-auth 未声明端点 ${endpoint}`)
  assert.equal(endpoint, '/send-verification-email')
})

test('BUG-01：忘记密码端点与 better-auth 1.6.7 一致（/request-password-reset）', () => {
  const endpoint = findFrontendEndpoint('forgetPassword')
  assert.ok(endpoint, '未找到 forgetPassword 端点')
  assert.ok(declaredEndpoints.has(endpoint), `better-auth 未声明端点 ${endpoint}`)
  assert.equal(endpoint, '/request-password-reset')
})
