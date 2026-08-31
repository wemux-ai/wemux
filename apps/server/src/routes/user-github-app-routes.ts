// [INPUT]: 已鉴权 Hono app，GitHub App 安装与身份请求
// [OUTPUT]: /api/user/github-app-installations* 路由（connect/authorize-url/callback/repositories/聚合仓库/commit-identity）
// [POS]: GitHub App 安装、OAuth 授权与 commit 身份 HTTP 协议层
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import { createHmac, timingSafeEqual } from 'node:crypto'
import type { Hono, MiddlewareHandler } from 'hono'
import {
  getGitHubAppInstallationForUser,
  getPendingGitHubAppConnectionIdentity,
  getGitHubAppUserAuth,
  listGitHubAppInstallationSummariesForUser,
  savePendingGitHubAppConnectionIdentity,
  saveGitHubAppUserAuth,
  unlinkGitHubAppInstallationFromUser,
  updateGitHubAppCommitIdentityForUserInstallation,
  upsertGitHubAppInstallation,
  upsertGitHubAppInstallationForUser,
} from '../services/github-app-installation-store'
import {
  buildGitHubAppInstallUrl,
  buildGitHubAppOAuthAuthorizeUrl,
  exchangeGitHubAppOAuthCode,
  fetchGitHubAppInstallation,
  fetchGitHubAppInstallationRepositories,
  fetchGitHubAppUserInstallations,
  fetchGitHubAppUserRepositories,
  getGitHubAppConnectionStatus,
  getGitHubAppOAuthStatus,
} from '../services/github-app-service'
import { resolveBetterAuthSecret } from '../services/auth-secrets'
import { getUserIdFromHeader } from './shared'

type GitHubAppStatePayload = {
  userId: string
  returnTo: string
  exp: number
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const normalizeCommitIdentity = (input: { name?: string | null; email?: string | null }) => {
  const name = input.name?.trim() ?? ''
  const email = input.email?.trim() ?? ''
  if (!name || !email || !EMAIL_PATTERN.test(email)) {
    return null
  }
  return { name, email }
}

const resolveStateSecret = () =>
  process.env.GITHUB_APP_STATE_SECRET?.trim()
  || resolveBetterAuthSecret()
  || process.env.TOKEN_SECRET?.trim()
  || 'dev-github-app-state-secret-change-me'

const base64UrlJson = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url')

const signStatePayload = (encodedPayload: string) =>
  createHmac('sha256', resolveStateSecret()).update(encodedPayload).digest('base64url')

const createGitHubAppState = (payload: GitHubAppStatePayload) => {
  const encodedPayload = base64UrlJson(payload)
  return `${encodedPayload}.${signStatePayload(encodedPayload)}`
}

const verifyGitHubAppState = (state: string): GitHubAppStatePayload | null => {
  const [encodedPayload, signature, ...rest] = state.split('.')
  if (!encodedPayload || !signature || rest.length > 0) {
    return null
  }

  const expected = signStatePayload(encodedPayload)
  const actualBuffer = Buffer.from(signature)
  const expectedBuffer = Buffer.from(expected)
  if (actualBuffer.length !== expectedBuffer.length || !timingSafeEqual(actualBuffer, expectedBuffer)) {
    return null
  }

  try {
    const payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8')) as GitHubAppStatePayload
    if (!payload.userId || !payload.returnTo || payload.exp < Date.now()) {
      return null
    }
    return payload
  } catch {
    return null
  }
}

const normalizeReturnTo = (value: string | undefined) => {
  const fallback = '/settings?section=git'
  if (!value?.trim()) {
    return fallback
  }
  const trimmed = value.trim()
  return trimmed.startsWith('/') && !trimmed.startsWith('//') ? trimmed : fallback
}

const appendResultToReturnTo = (returnTo: string, params: Record<string, string>) => {
  const url = new URL(returnTo, 'http://wemux.local')
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value)
  }
  return `${url.pathname}${url.search}`
}

export const registerUserGitHubAppRoutes = (app: Hono, requireAuth: MiddlewareHandler) => {
  app.get('/api/user/github-app-installations', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    return c.json({
      ...getGitHubAppConnectionStatus(),
      ...getGitHubAppOAuthStatus(),
      oauthAuthorized: Boolean(await getGitHubAppUserAuth(userId)),
      installations: await listGitHubAppInstallationSummariesForUser(userId),
    })
  })

  app.get('/api/user/github-app-installations/connect-url', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    const status = getGitHubAppConnectionStatus()
    if (!status.configured) {
      return c.json({
        configured: false,
        message: 'GitHub App 未配置。请设置 GITHUB_APP_ID、GITHUB_APP_SLUG 和 GITHUB_APP_PRIVATE_KEY。',
      }, 503)
    }
    const commitIdentity = normalizeCommitIdentity({
      name: c.req.query('commitAuthorName'),
      email: c.req.query('commitAuthorEmail'),
    })
    if (!commitIdentity) {
      return c.json({ message: '请先填写有效的 Git 提交用户名和邮箱。' }, 400)
    }

    const exp = Date.now() + 10 * 60 * 1000
    const state = createGitHubAppState({
      userId,
      returnTo: normalizeReturnTo(c.req.query('returnTo')),
      exp,
    })
    await savePendingGitHubAppConnectionIdentity({
      state,
      userId,
      commitIdentity,
      expiresAt: exp,
    }).catch((error) => {
      const message = error instanceof Error ? error.message : String(error)
      console.warn(`[github-app] failed to persist pending commit identity: ${message}`)
    })

    return c.json({
      configured: true,
      url: buildGitHubAppInstallUrl(state),
    })
  })

  app.get('/api/user/github-app-installations/authorize-url', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    const status = getGitHubAppOAuthStatus()
    if (!status.oauthConfigured) {
      return c.json({
        oauthConfigured: false,
        message: 'GitHub App OAuth 未配置。请设置 GITHUB_APP_CLIENT_ID 和 GITHUB_APP_CLIENT_SECRET。',
      }, 503)
    }

    const exp = Date.now() + 10 * 60 * 1000
    const state = createGitHubAppState({
      userId,
      returnTo: normalizeReturnTo(c.req.query('returnTo')),
      exp,
    })

    return c.json({
      oauthConfigured: true,
      url: buildGitHubAppOAuthAuthorizeUrl(state),
    })
  })

  app.get('/api/user/github-app-installations/callback', async (c) => {
    const authenticatedUserId = getUserIdFromHeader(c)
    const state = verifyGitHubAppState(c.req.query('state') ?? '')
    if (!state || (authenticatedUserId && state.userId !== authenticatedUserId)) {
      return c.redirect(appendResultToReturnTo('/settings?section=git', {
        githubApp: 'error',
        message: 'github_app_state_invalid',
      }))
    }
    const userId = state.userId

    const oauthCode = c.req.query('code')?.trim()
    let oauthAuthorized = false
    if (oauthCode) {
      try {
        const exchanged = await exchangeGitHubAppOAuthCode(oauthCode)
        await saveGitHubAppUserAuth({
          userId,
          accessToken: exchanged.accessToken,
          refreshToken: exchanged.refreshToken,
          expiresAt: exchanged.expiresAt,
        }).catch((error) => {
          const message = error instanceof Error ? error.message : String(error)
          console.warn(`[github-app] failed to persist user oauth auth: ${message}`)
        })
        oauthAuthorized = true
      } catch {
        return c.redirect(appendResultToReturnTo(state.returnTo, {
          githubApp: 'error',
          message: 'github_app_oauth_exchange_failed',
        }))
      }
    }

    const installationId = Number(c.req.query('installation_id'))
    const hasInstallation = Number.isFinite(installationId) && installationId >= 1
    if (!oauthAuthorized && !hasInstallation) {
      return c.redirect(appendResultToReturnTo(state.returnTo, {
        githubApp: 'error',
        message: 'github_app_installation_missing',
      }))
    }

    if (hasInstallation) {
      try {
        const installation = await fetchGitHubAppInstallation(installationId)
        const commitIdentity = await getPendingGitHubAppConnectionIdentity(c.req.query('state') ?? '', userId)
          .catch(() => null)
        await upsertGitHubAppInstallationForUser({
          userId,
          ...installation,
          commitIdentity: commitIdentity ?? undefined,
        })
      } catch {
        return c.redirect(appendResultToReturnTo(state.returnTo, {
          githubApp: 'error',
          message: 'github_app_installation_sync_failed',
        }))
      }
    }

    return c.redirect(appendResultToReturnTo(state.returnTo, {
      githubApp: 'connected',
      ...(oauthAuthorized ? { githubOAuth: 'authorized' } : {}),
      ...(hasInstallation ? { installationId: String(installationId) } : {}),
    }))
  })

  app.put('/api/user/github-app-installations/:installationId/commit-identity', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    const installationId = Number(c.req.param('installationId'))
    if (!Number.isFinite(installationId) || installationId < 1) {
      return c.json({ message: 'installationId 不合法。' }, 400)
    }

    const payload = await c.req.json().catch(() => ({})) as { name?: string; email?: string }
    const identity = normalizeCommitIdentity(payload)
    if (!identity) {
      return c.json({ message: '请填写有效的 Git 提交用户名和邮箱。' }, 400)
    }

    const installation = await updateGitHubAppCommitIdentityForUserInstallation(userId, installationId, identity)
    if (!installation) {
      return c.json({ message: 'GitHub App installation 不存在。' }, 404)
    }

    return c.json({
      ok: true,
      installation,
      installations: await listGitHubAppInstallationSummariesForUser(userId),
      message: 'Git 提交身份已更新。',
    })
  })

  app.get('/api/user/github-app-installations/repositories', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    const userAuth = await getGitHubAppUserAuth(userId)
    if (!userAuth) {
      return c.json({
        oauthConfigured: getGitHubAppOAuthStatus().oauthConfigured,
        authorized: false,
        message: '请先在「设置 → Git → GitHub App」中授权 GitHub 账号，才能读取协作/组织仓库。',
      }, 404)
    }

    try {
      // 把用户可访问的 installation 落库为全局记录，供项目绑定与安装 token 下发使用。
      const accessibleInstallations = await fetchGitHubAppUserInstallations(userAuth.accessToken)
      await Promise.allSettled(accessibleInstallations.map((installation) => upsertGitHubAppInstallation({
        installationId: installation.installationId,
        accountId: installation.accountId,
        accountLogin: installation.accountLogin,
        accountType: installation.accountType,
        repositorySelection: installation.repositorySelection,
        permissions: installation.permissions,
        suspendedAt: installation.suspendedAt,
      })))
      return c.json({
        oauthConfigured: getGitHubAppOAuthStatus().oauthConfigured,
        authorized: true,
        repositories: await fetchGitHubAppUserRepositories(userAuth.accessToken),
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : '读取 GitHub 仓库列表失败。'
      return c.json({ message }, 502)
    }
  })

  app.get('/api/user/github-app-installations/:installationId/repositories', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    const installationId = Number(c.req.param('installationId'))
    if (!Number.isFinite(installationId) || installationId < 1) {
      return c.json({ message: 'installationId 不合法。' }, 400)
    }

    const installation = await getGitHubAppInstallationForUser(userId, installationId)
    if (!installation) {
      return c.json({ message: 'GitHub App installation 不存在，或不属于当前用户。' }, 404)
    }

    try {
      return c.json({
        repositories: await fetchGitHubAppInstallationRepositories(installation.installationId),
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : '读取 GitHub 仓库列表失败。'
      return c.json({ message }, 502)
    }
  })

  app.delete('/api/user/github-app-installations/:installationId', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    const installationId = Number(c.req.param('installationId'))
    if (!Number.isFinite(installationId) || installationId < 1) {
      return c.json({ message: 'installationId 不合法。' }, 400)
    }

    const deleted = await unlinkGitHubAppInstallationFromUser(userId, installationId)
    if (!deleted) {
      return c.json({ message: 'GitHub App installation 不存在。' }, 404)
    }

    return c.json({
      ok: true,
      installations: await listGitHubAppInstallationSummariesForUser(userId),
      message: 'GitHub App installation 已删除。',
    })
  })
}
