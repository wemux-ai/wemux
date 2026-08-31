/**
 * [INPUT]: Auth HTTP requests, auth repositories, billing policy, and workspace membership services.
 * [OUTPUT]: Authentication, profile, team, invitation, and personal access token HTTP routes.
 * [POS]: Server auth route boundary; validates requests and preserves shared response contracts.
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */

import type { Hono, MiddlewareHandler } from 'hono'
import { deleteCookie, getCookie, setCookie } from 'hono/cookie'
import { z } from 'zod'
import type { PersonalAccessTokenCreateResponse, PersonalAccessTokenListResponse } from '@shared/auth'
import { listTeamSharedExecutors } from '../control-plane/collaboration'
import { executorRegistry } from '../control-plane/executor-registry'
import { acceptTeamInvitation, addTeamMember, addTeamMemberAndWait, addTeamProject, addTeamProjectAndWait, cancelTeamInvitation, createTeam, createTeamAndWait, createTeamInvitation, createTeamInvitationAndWait, createToken, ensureOAuthUser, ensurePasswordUser, ensureUsernameBackfill, getInvitationById, getInvitationByToken, getPendingTeamInvitationsByEmail, getTeamActivities, getTeamById, getTeamInvitations, getTeamMemberRole, getTeamMembers, getTeamProjects, getUserByEmail, getUserById, getUserTeams, isProjectAccessible, isTeamAdmin, isUsernameTaken, logTeamActivity, recordAuthEvent, removeTeamMember, removeTeamMemberAndWait, removeTeamProject, revokeToken, resolveEffectiveUserStatus, setUserLastLogin, updateTeam, updateTeamAndWait, updateTeamMemberRole, updateTeamMemberRoleAndWait, updateUserOnboarding, updateUserProfile } from '../repositories/auth'
import { isValidUsername, normalizeUsername, USERNAME_CHANGE_COOLDOWN_MS } from '@shared/username'
import { createPersonalAccessToken, listPersonalAccessTokens, deletePersonalAccessToken, revokeAllPersonalAccessTokens } from '../repositories/auth'
import { ensureTeamMember, getRawToken, getUserIdFromHeader, publishState } from './shared'
import { getAvatarStorageStatus, streamAvatar, uploadAvatar } from '../services/avatar-storage'
import { resolveAppBrand } from '../services/brand'
import { sendFeishuMessageToWebhook } from '../integrations/feishu'
import { getUserNotificationSettings, saveUserNotificationSettings } from '../services/user-notification-settings-service'
import {
  deletePushSubscriptionById,
  deletePushSubscriptionByEndpoint,
  listPushSubscriptions,
  resolveVapidPublicKey,
  sendPushToUser,
  upsertPushSubscription,
} from '../services/web-push-service'
import { getUserExperimentalSettings, saveUserExperimentalSettings } from '../services/user-experimental-settings-service'
import { getUserAppearanceSettings, saveUserAppearanceSettings } from '../services/user-appearance-settings-service'
import { publishInboxItem } from '../services/inbox-service'
import { TEAM_INVITATION_EVENT_TYPE } from './connection-routes'
import { EXPERIMENTAL_FEATURE_FLAG_KEYS } from '@shared/user-experimental-settings'
import { provisionWorkspaceResourcesFromSourceWorkspace } from '../services/workspace-resource-provisioning-service'
import { loadState } from '../storage/app-state-store'
import { getBetterAuthSession, isEmailVerificationRequired, isGoogleSocialConfigured } from '../services/better-auth-service'
import { getDevLoginAccounts, isDevLoginEnabled, signInDevLoginAccount } from '../services/dev-auth-service'
import { getEmailSendingStatus, listRecentConsoleEmails, resolveEmailProvider } from '../services/email-service'
import { and, eq } from 'drizzle-orm'
import { betterAuthAccounts } from '../storage/postgres/schema'
import { resolveEnvAdminEmails } from './admin-routes'
import { getDrizzleDb } from '../storage/postgres/drizzle-db'
import { hashPassword, verifyPassword } from 'better-auth/crypto'
import { createTurnstileLoginCookieValue, hasValidTurnstileLoginCookie, isTurnstileLoginEnabled, resolveTurnstileSiteKey, turnstileLoginCookieMaxAge, turnstileLoginCookieName, verifyTurnstileToken } from '../services/turnstile-service'
import { getCommercialGate } from '../services/gate/commercial-gate'

const resolveRequestIp = (forwardedFor: string | undefined, fallbackIp: string | undefined) => {
  const candidate = forwardedFor?.split(',')[0]?.trim() || fallbackIp?.trim() || ''
  return candidate || undefined
}

export const registerAuthRoutes = (app: Hono, requireAuth: MiddlewareHandler) => {
  app.post('/api/auth/register', async (c) => {
    return c.json({ message: '邮箱注册请使用 /api/identity/sign-up/email（需验证邮箱）。' }, 410)
  })

  app.post('/api/auth/login', async (c) => {
    return c.json({ message: '邮箱密码登录请使用 /api/identity/sign-in/email。' }, 410)
  })

  app.get('/api/auth/dev/accounts', async (c) => {
    return c.json({
      enabled: isDevLoginEnabled(),
      accounts: getDevLoginAccounts(),
      turnstile: {
        enabled: isTurnstileLoginEnabled(),
        siteKey: isTurnstileLoginEnabled() ? resolveTurnstileSiteKey() : '',
      },
      email: getEmailSendingStatus(),
      google: {
        configured: isGoogleSocialConfigured(),
      },
      brand: resolveAppBrand(),
    })
  })

  app.get('/api/auth/dev/emails', async (c) => {
    // 仅开发/本地联调可用：console 邮件模式下查看最近发送的验证/重置邮件（含链接）
    if (resolveEmailProvider() !== 'console' || !isDevLoginEnabled()) {
      return c.json({ message: '仅 console 邮件模式且开发环境可用。' }, 404)
    }
    return c.json({ emails: listRecentConsoleEmails(20) })
  })

  app.post('/api/auth/dev/login', async (c) => {
    if (!isDevLoginEnabled()) {
      return c.json({ message: '开发测试登录未启用。' }, 404)
    }

    const payload = z.object({
      accountId: z.string().trim().min(1),
    }).parse(await c.req.json().catch(() => ({})))

    const user = await signInDevLoginAccount(payload.accountId)
    if (!user) {
      return c.json({ message: '测试账号不存在。' }, 404)
    }

    const effectiveStatus = resolveEffectiveUserStatus(user)
    if (effectiveStatus !== 'active') {
      recordAuthEvent({ userId: user.id, email: user.email, eventType: 'login_fail', provider: 'dev', result: 'blocked', ip: resolveRequestIp(c.req.header('cf-connecting-ip') || c.req.header('x-forwarded-for'), c.req.header('x-real-ip')), userAgent: c.req.header('user-agent'), metadata: { reason: effectiveStatus } })
      return c.json({ message: effectiveStatus === 'banned' ? '账号已被封禁，请联系管理员。' : '账号已停用，请联系管理员。' }, 403)
    }

    const token = createToken(user.id)
    setUserLastLogin(user.id, resolveRequestIp(c.req.header('cf-connecting-ip') || c.req.header('x-forwarded-for'), c.req.header('x-real-ip')))
    recordAuthEvent({ userId: user.id, email: user.email, eventType: 'login_success', provider: 'dev', result: 'success', ip: resolveRequestIp(c.req.header('cf-connecting-ip') || c.req.header('x-forwarded-for'), c.req.header('x-real-ip')), userAgent: c.req.header('user-agent') })
    const billingAccess = await getCommercialGate().resolveUserBillingAccess(user.id, 'execute_task')
    return c.json({
      user: {
        ...user,
        billingAccess,
      },
      token,
    })
  })

  app.post('/api/auth/google/prepare', async (c) => {
    if (!isTurnstileLoginEnabled()) {
      return c.json({ ok: true })
    }

    const payload = z.object({
      turnstileToken: z.string().trim().min(1),
    }).safeParse(await c.req.json().catch(() => ({})))
    if (!payload.success) {
      return c.json({ message: '请先完成人机验证。' }, 400)
    }

    const remoteIp = resolveRequestIp(
      c.req.header('cf-connecting-ip') || c.req.header('x-forwarded-for'),
      c.req.header('x-real-ip'),
    )
    const verification = await verifyTurnstileToken(payload.data.turnstileToken, remoteIp)
    if (!verification.ok) {
      return c.json({ message: verification.message || '人机验证失败，请稍后再试。' }, 403)
    }

    setCookie(c, turnstileLoginCookieName, createTurnstileLoginCookieValue(), {
      path: '/',
      httpOnly: true,
      sameSite: 'Lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: turnstileLoginCookieMaxAge,
    })

    return c.json({ ok: true })
  })

  app.post('/api/auth/google/bridge', async (c) => {
    const session = await getBetterAuthSession(c.req.raw.headers)
    const sessionUser = session?.user
    if (!sessionUser?.email) {
      return c.json({ message: 'Google 登录状态不存在，请重新登录。', needsLogin: true }, 401)
    }

    if (isTurnstileLoginEnabled()) {
      const turnstileCookie = getCookie(c, turnstileLoginCookieName)
      if (!hasValidTurnstileLoginCookie(turnstileCookie)) {
        return c.json({ message: '请先完成人机验证后，再重新发起 Google 登录。', needsLogin: true }, 403)
      }
    }

    const existingUser = getUserByEmail(sessionUser.email)
    const effectiveStatus = existingUser ? resolveEffectiveUserStatus(existingUser) : 'active'
    if (effectiveStatus !== 'active') {
      recordAuthEvent({ userId: existingUser?.id, email: sessionUser.email, eventType: 'login_fail', provider: 'google', result: 'blocked', ip: resolveRequestIp(c.req.header('cf-connecting-ip') || c.req.header('x-forwarded-for'), c.req.header('x-real-ip')), userAgent: c.req.header('user-agent'), metadata: { reason: effectiveStatus } })
      return c.json({ message: effectiveStatus === 'banned' ? '账号已被封禁，请联系管理员。' : '账号已停用，请联系管理员。' }, 403)
    }

    const user = await ensureOAuthUser({
      email: sessionUser.email,
      name: sessionUser.name || sessionUser.email.split('@')[0] || 'Google User',
      avatarUrl: typeof sessionUser.image === 'string' ? sessionUser.image : undefined,
      provider: 'google',
    })

    const token = createToken(user.id)
    const billingAccess = await getCommercialGate().resolveUserBillingAccess(user.id, 'execute_task')
    deleteCookie(c, turnstileLoginCookieName, { path: '/' })
    setUserLastLogin(user.id, resolveRequestIp(c.req.header('cf-connecting-ip') || c.req.header('x-forwarded-for'), c.req.header('x-real-ip')))
    recordAuthEvent({ userId: user.id, email: user.email, eventType: 'login_success', provider: 'google', result: 'success', ip: resolveRequestIp(c.req.header('cf-connecting-ip') || c.req.header('x-forwarded-for'), c.req.header('x-real-ip')), userAgent: c.req.header('user-agent') })
    return c.json({
      user: {
        ...user,
        billingAccess,
      },
      token,
    })
  })

  app.post('/api/auth/password/bridge', async (c) => {
    const session = await getBetterAuthSession(c.req.raw.headers)
    const sessionUser = session?.user
    if (!sessionUser?.email) {
      return c.json({ message: '邮箱登录状态不存在，请重新登录。', needsLogin: true }, 401)
    }

    // 邮箱密码登录必须先完成邮箱验证（仅当配置了真实邮件发送；未配置时注册即成功，不做验证拦截）
    if (isEmailVerificationRequired() && sessionUser.emailVerified !== true) {
      return c.json({ message: '邮箱尚未验证，请先完成验证邮件后再登录。', needsVerification: true, email: sessionUser.email }, 403)
    }

    const existingUser = getUserByEmail(sessionUser.email)
    const effectiveStatus = existingUser ? resolveEffectiveUserStatus(existingUser) : 'active'
    if (effectiveStatus !== 'active') {
      recordAuthEvent({ userId: existingUser?.id, email: sessionUser.email, eventType: 'login_fail', provider: 'password', result: 'blocked', ip: resolveRequestIp(c.req.header('cf-connecting-ip') || c.req.header('x-forwarded-for'), c.req.header('x-real-ip')), userAgent: c.req.header('user-agent'), metadata: { reason: effectiveStatus } })
      return c.json({ message: effectiveStatus === 'banned' ? '账号已被封禁，请联系管理员。' : '账号已停用，请联系管理员。' }, 403)
    }

    const user = await ensurePasswordUser({
      email: sessionUser.email,
      name: sessionUser.name || sessionUser.email.split('@')[0] || 'User',
      avatarUrl: typeof sessionUser.image === 'string' ? sessionUser.image : undefined,
      emailVerified: true,
    })

    const token = createToken(user.id)
    const billingAccess = await getCommercialGate().resolveUserBillingAccess(user.id, 'execute_task')
    setUserLastLogin(user.id, resolveRequestIp(c.req.header('cf-connecting-ip') || c.req.header('x-forwarded-for'), c.req.header('x-real-ip')))
    recordAuthEvent({ userId: user.id, email: user.email, eventType: 'login_success', provider: 'password', result: 'success', ip: resolveRequestIp(c.req.header('cf-connecting-ip') || c.req.header('x-forwarded-for'), c.req.header('x-real-ip')), userAgent: c.req.header('user-agent') })
    return c.json({
      user: {
        ...user,
        billingAccess,
      },
      token,
    })
  })

  app.post('/api/auth/logout', async (c) => {
    const raw = getRawToken(c)
    if (raw) await revokeToken(raw)
    return c.json({ ok: true })
  })

  // ==========================================================================
  // 账号绑定（feature 续：Google / 邮箱密码双登录体系打通）
  // ==========================================================================

  const resolveBetterAuthIdentity = async (c: import('hono').Context) => {
    const session = await getBetterAuthSession(c.req.raw.headers)
    return session?.user ?? null
  }

  /** 当前 better-auth 用户已绑定的 provider 列表 */
  app.get('/api/auth/account/accounts', async (c) => {
    const sessionUser = await resolveBetterAuthIdentity(c)
    if (!sessionUser?.id) {
      return c.json({ message: '未登录' }, 401)
    }
    const rows = await getDrizzleDb()
      .select({ providerId: betterAuthAccounts.providerId })
      .from(betterAuthAccounts)
      .where(eq(betterAuthAccounts.userId, sessionUser.id))
    const providers = rows.map((row) => row.providerId).filter(Boolean)
    return c.json({
      accounts: providers,
      email: sessionUser.email,
      emailVerified: sessionUser.emailVerified,
    })
  })

  /** 添加 / 修改密码（绑定邮箱密码登录；修改时需校验当前密码） */
  app.post('/api/auth/account/link-email', async (c) => {
    const sessionUser = await resolveBetterAuthIdentity(c)
    if (!sessionUser?.id) {
      return c.json({ message: '未登录' }, 401)
    }
    const payload = z.object({
      password: z.string().min(8).max(128),
      currentPassword: z.string().optional(),
    }).parse(await c.req.json().catch(() => ({})))

    const now = new Date()
    const db = getDrizzleDb()
    const existingRows = await db
      .select({ id: betterAuthAccounts.id, password: betterAuthAccounts.password })
      .from(betterAuthAccounts)
      .where(and(eq(betterAuthAccounts.userId, sessionUser.id), eq(betterAuthAccounts.providerId, 'credential')))

    // 已有密码 → 必须校验当前密码（防止未授权修改）
    if (existingRows.length > 0) {
      const existing = existingRows[0]
      if (!existing.password || !payload.currentPassword) {
        return c.json({ message: '修改密码需要先验证当前密码。' }, 400)
      }
      const { verifyPassword: verifyPasswordFn } = await import('better-auth/crypto')
      const valid = await verifyPasswordFn({ hash: existing.password, password: payload.currentPassword })
      if (!valid) {
        return c.json({ message: '当前密码不正确。' }, 400)
      }
    }

    const hash = await hashPassword(payload.password)
    if (existingRows.length > 0) {
      await db
        .update(betterAuthAccounts)
        .set({ password: hash, updatedAt: now })
        .where(eq(betterAuthAccounts.id, existingRows[0].id))
    } else {
      await db.insert(betterAuthAccounts).values({
        id: crypto.randomUUID(),
        userId: sessionUser.id,
        accountId: sessionUser.id,
        providerId: 'credential',
        password: hash,
        createdAt: now,
        updatedAt: now,
      })
    }

    const wemuxUser = getUserByEmail(sessionUser.email ?? '')
    if (wemuxUser) {
      recordAuthEvent({
        userId: wemuxUser.id,
        email: wemuxUser.email,
        eventType: existingRows.length > 0 ? 'password_updated' : 'password_bound',
        provider: 'password',
        result: 'success',
        ip: resolveRequestIp(c.req.header('cf-connecting-ip') || c.req.header('x-forwarded-for'), c.req.header('x-real-ip')),
        userAgent: c.req.header('user-agent'),
      })
    }
    return c.json({ ok: true, action: existingRows.length > 0 ? 'updated' : 'bound' })
  })

  /** 解绑密码（移除邮箱密码登录；需保留至少一种登录方式） */
  app.post('/api/auth/account/unlink-email', async (c) => {
    const sessionUser = await resolveBetterAuthIdentity(c)
    if (!sessionUser?.id) {
      return c.json({ message: '未登录' }, 401)
    }
    const db = getDrizzleDb()
    const providers = await db
      .select({ providerId: betterAuthAccounts.providerId })
      .from(betterAuthAccounts)
      .where(eq(betterAuthAccounts.userId, sessionUser.id))
    const hasOtherProvider = providers.some((row) => row.providerId && row.providerId !== 'credential')
    if (!hasOtherProvider) {
      return c.json({ message: '至少需要保留一种登录方式。' }, 400)
    }
    await db
      .delete(betterAuthAccounts)
      .where(and(eq(betterAuthAccounts.userId, sessionUser.id), eq(betterAuthAccounts.providerId, 'credential')))
    const wemuxUser = getUserByEmail(sessionUser.email ?? '')
    if (wemuxUser) {
      recordAuthEvent({ userId: wemuxUser.id, email: wemuxUser.email, eventType: 'password_unbound', provider: 'password', result: 'success' })
    }
    return c.json({ ok: true })
  })

  app.get('/api/auth/me', async (c) => {
    const userId = getUserIdFromHeader(c)
    if (!userId) {
      return c.json({ user: null }, 401)
    }
    const user = getUserById(userId)
    if (!user) {
      return c.json({ user: null }, 401)
    }

    // 老用户/未设置用户 ID：懒回填（邮箱前缀 + 随机后缀），只在首次访问时生成一次。
    if (!user.username) {
      const backfilled = await ensureUsernameBackfill(userId)
      if (backfilled?.username) {
        user.username = backfilled.username
        user.usernameUpdatedAt = backfilled.usernameUpdatedAt
      }
    }

    const effectiveStatus = resolveEffectiveUserStatus(user)
    if (effectiveStatus !== 'active') {
      return c.json({ user: null, message: effectiveStatus === 'banned' ? '账号已被封禁。' : '账号已停用。' }, 403)
    }

    const billingAccess = await getCommercialGate().resolveUserBillingAccess(user.id, 'execute_task')
    // env 白名单（VIBEMUX_ADMIN_EMAILS）→ 视为 owner（超级管理员），与 admin 接口准入保持一致；
    // 否则前端 /admin 只认 DB role/isInternal，会出现“服务端放行、页面仍无权”的判定不一致。
    const isEnvAdmin = resolveEnvAdminEmails().has(user.email?.trim().toLowerCase() ?? '')
    return c.json({
      user: {
        ...user,
        role: isEnvAdmin ? ('owner' as const) : user.role,
        billingAccess,
      },
    })
  })

  app.put('/api/auth/me', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    const payload = z.object({
      name: z.string().min(1).max(80),
      bio: z.string().max(240).optional(),
      /** 用户 ID（@username）：可选更新；首次设置无冷静期，改 ID 需 30 天冷静期 */
      username: z.string().trim().min(3).max(20).optional(),
    }).parse(await c.req.json())

    const current = getUserById(userId)
    if (!current) {
      return c.json({ message: '用户不存在' }, 404)
    }

    let nextUsername: string | undefined
    let nextUsernameUpdatedAt: string | undefined
    if (payload.username !== undefined) {
      const normalized = normalizeUsername(payload.username)
      if (!isValidUsername(normalized)) {
        return c.json({ message: '用户 ID 需为 3–20 位小写字母/数字/._-，且不能以分隔符开头结尾或连续出现。' }, 400)
      }
      const currentUsername = current.username ? normalizeUsername(current.username) : ''
      if (normalized === currentUsername) {
        // 未变化：保持原样，不触发冷静期。
        nextUsername = current.username
        nextUsernameUpdatedAt = current.usernameUpdatedAt
      } else {
        if (current.username && current.usernameUpdatedAt) {
          const elapsed = Date.now() - new Date(current.usernameUpdatedAt).getTime()
          if (elapsed < USERNAME_CHANGE_COOLDOWN_MS) {
            const remainingDays = Math.ceil((USERNAME_CHANGE_COOLDOWN_MS - elapsed) / (24 * 60 * 60 * 1000))
            return c.json({ message: `用户 ID 修改后有 ${remainingDays} 天冷静期，请稍后再试。` }, 400)
          }
        }
        if (isUsernameTaken(normalized, userId)) {
          return c.json({ message: '该用户 ID 已被占用，请换一个。' }, 400)
        }
        nextUsername = normalized
        nextUsernameUpdatedAt = new Date().toISOString()
      }
    }

    const user = updateUserProfile(userId, {
      name: payload.name,
      bio: payload.bio,
      ...(nextUsername !== undefined ? { username: nextUsername, usernameUpdatedAt: nextUsernameUpdatedAt } : {}),
    })
    if (!user) {
      return c.json({ message: '用户不存在' }, 404)
    }

    return c.json({ user })
  })

  app.put('/api/auth/me/onboarding', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    const payload = z.object({
      onboardingCompletedAt: z.string().datetime().nullable().optional(),
      onboardingDismissedAt: z.string().datetime().nullable().optional(),
      onboardingPath: z.enum(['existing-repo', 'quickstart', 'team']).nullable().optional(),
    }).parse(await c.req.json())

    const user = updateUserOnboarding(userId, payload)
    if (!user) {
      return c.json({ message: '用户不存在' }, 404)
    }

    return c.json({ user })
  })

  app.get('/api/auth/me/notification-settings', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    return c.json({
      settings: getUserNotificationSettings(userId),
    })
  })

  app.put('/api/auth/me/notification-settings', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    const payload = z.object({
      inboxMention: z.object({
        browserEnabled: z.boolean().optional(),
        soundEnabled: z.boolean().optional(),
      }).optional(),
      groupChatMention: z.object({
        browserEnabled: z.boolean().optional(),
        soundEnabled: z.boolean().optional(),
      }).optional(),
      groupChatMessage: z.object({
        browserEnabled: z.boolean().optional(),
        soundEnabled: z.boolean().optional(),
      }).optional(),
      taskCompletion: z.object({
        browserEnabled: z.boolean().optional(),
        soundEnabled: z.boolean().optional(),
      }).optional(),
      workspaceSessionCompletion: z.object({
        browserEnabled: z.boolean().optional(),
        soundEnabled: z.boolean().optional(),
        feishuEnabled: z.boolean().optional(),
      }).optional(),
      channels: z.object({
        feishuWebhookUrl: z.string().optional(),
      }).optional(),
    }).parse(await c.req.json().catch(() => ({})))

    return c.json({
      settings: saveUserNotificationSettings(userId, payload),
    })
  })

  app.get('/api/auth/me/experimental-settings', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    return c.json({
      settings: getUserExperimentalSettings(userId),
    })
  })

  app.put('/api/auth/me/experimental-settings', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    const payload = z.object({
      browserUse: z.boolean().optional(),
      computerUse: z.boolean().optional(),
      openConnector: z.boolean().optional(),
      railway: z.boolean().optional(),
      brain: z.boolean().optional(),
      meetingListening: z.boolean().optional(),
    }).parse(await c.req.json().catch(() => ({})))

    return c.json({
      settings: saveUserExperimentalSettings(userId, payload),
    })
  })

  app.get('/api/auth/me/appearance-settings', requireAuth, (c) => c.json({ settings: getUserAppearanceSettings(getUserIdFromHeader(c)!) }))
  app.put('/api/auth/me/appearance-settings', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    const payload = z.object({
      theme: z.enum(['dark', 'light', 'system']).optional(),
      glass: z.object({
        opacity: z.number().optional(),
        blur: z.number().optional(),
        saturation: z.number().optional(),
        borderOpacity: z.number().optional(),
      }).optional(),
    }).parse(await c.req.json().catch(() => ({})))
    return c.json({ settings: saveUserAppearanceSettings(userId, payload) })
  })

  // ---- Web Push（feature P3）：VAPID 公钥 + 多设备订阅管理 + 测试推送 ----

  app.get('/api/auth/me/push-vapid-key', requireAuth, async (c) => {
    return c.json({
      publicKey: resolveVapidPublicKey(),
    })
  })

  app.get('/api/auth/me/push-subscriptions', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    const subscriptions = await listPushSubscriptions(userId)
    return c.json({
      subscriptions: subscriptions.map(({ userId: _userId, p256dh, auth, ...summary }) => summary),
    })
  })

  app.post('/api/auth/me/push-subscriptions', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    const payload = z.object({
      endpoint: z.string().trim().min(1),
      p256dh: z.string().trim().min(1),
      auth: z.string().trim().min(1),
      userAgent: z.string().trim().optional(),
    }).parse(await c.req.json().catch(() => ({})))

    const subscription = await upsertPushSubscription(userId, payload)
    return c.json({ subscription }, 201)
  })

  app.delete('/api/auth/me/push-subscriptions/:id', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    const id = c.req.param('id')
    await deletePushSubscriptionById(userId, id)
    return c.json({ ok: true })
  })

  app.delete('/api/auth/me/push-subscriptions', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    const payload = z.object({ endpoint: z.string().trim().min(1) }).parse(await c.req.json().catch(() => ({})))
    await deletePushSubscriptionByEndpoint(userId, payload.endpoint)
    return c.json({ ok: true })
  })

  app.post('/api/auth/me/push-subscriptions/test', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    const { sent, removed } = await sendPushToUser({
      userId,
      payload: {
        title: 'wemux 测试推送',
        body: 'Web Push 通道工作正常。',
        tag: 'wemux-push-test',
        url: '/',
      },
    })
    if (sent === 0 && removed === 0) {
      return c.json({ message: '当前没有已订阅的推送设备，请先允许浏览器通知并完成订阅。' }, 400)
    }
    return c.json({ message: `测试推送已发送（${sent} 台设备）。` })
  })

  app.post('/api/auth/me/notification-settings/feishu/test', requireAuth, async (c) => {
    const payload = z.object({
      workspaceSessionCompletion: z.object({
        browserEnabled: z.boolean().optional(),
        soundEnabled: z.boolean().optional(),
        feishuEnabled: z.boolean().optional(),
      }).optional(),
      channels: z.object({
        feishuWebhookUrl: z.string().optional(),
      }).optional(),
    }).parse(await c.req.json().catch(() => ({})))

    const webhookUrl = payload.channels?.feishuWebhookUrl?.trim() || ''
    if (!webhookUrl) {
      return c.json({ ok: false, message: '请先填写飞书 Webhook URL。' }, 400)
    }

    const result = await sendFeishuMessageToWebhook(
      webhookUrl,
      'wemux 测试通知\n这是一条手动触发的飞书测试消息。',
    )
    if (!result.ok) {
      return c.json({ ok: false, message: result.message || '测试飞书通知失败。' }, 400)
    }

    return c.json({ ok: true, message: '测试飞书通知已发送。' })
  })

  app.get('/api/auth/storage/avatar', requireAuth, async (c) => {
    return c.json({ storage: getAvatarStorageStatus() })
  })

  app.post('/api/auth/me/avatar', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    const form = await c.req.formData()
    const file = form.get('file')
    if (!(file instanceof File)) {
      return c.json({ message: '请先选择图片文件。' }, 400)
    }

    try {
      const upload = await uploadAvatar(userId, file)
      const user = updateUserProfile(userId, { avatarUrl: upload.avatarUrl })
      if (!user) {
        return c.json({ message: '用户不存在' }, 404)
      }

      return c.json({ user, message: '头像已上传到对象存储。' })
    } catch (error) {
      return c.json({ message: error instanceof Error ? error.message : '头像上传失败' }, 400)
    }
  })

  app.get('/api/auth/users/:userId/avatar/:filename', async (c) => {
    const userId = c.req.param('userId')
    const filename = c.req.param('filename')

    try {
      return await streamAvatar(userId, filename)
    } catch (error) {
      return c.json({ message: error instanceof Error ? error.message : '头像读取失败' }, 503)
    }
  })

  app.get('/api/auth/teams', async (c) => {
    const userId = getUserIdFromHeader(c)
    if (!userId) {
      return c.json({ teams: [] }, 401)
    }
    const teams = getUserTeams(userId)
    return c.json({ teams })
  })

  app.post('/api/auth/teams', async (c) => {
    const userId = getUserIdFromHeader(c)
    if (!userId) {
      return c.json({ message: '未登录' }, 401)
    }
    const featureAccess = await getCommercialGate().resolveBillingFeatureAccess(userId, 'team_features')
    if (!featureAccess.allowed) {
      return c.json({ message: featureAccess.message, billingFeatureAccess: featureAccess }, 402)
    }
    const payload = z.object({
      name: z.string().trim().min(1),
      sourceWorkspaceId: z.string().trim().optional(),
    }).parse(await c.req.json())
    const team = await createTeamAndWait(payload.name, userId)
    await provisionWorkspaceResourcesFromSourceWorkspace({
      ownerUserId: userId,
      sourceWorkspaceId: payload.sourceWorkspaceId,
      targetWorkspaceId: team.id,
    })
    publishState(loadState())
    return c.json({ team })
  })

  app.get('/api/auth/teams/:teamId/members', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    const teamId = c.req.param('teamId')
    if (!ensureTeamMember(teamId, userId)) {
      return c.json({ message: '无权限' }, 403)
    }
    const members = getTeamMembers(teamId)
    return c.json({ members })
  })

  app.post('/api/auth/teams/:teamId/members', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    const teamId = c.req.param('teamId')
    if (!isTeamAdmin(teamId, userId)) {
      return c.json({ message: '无权限' }, 403)
    }
    const featureAccess = await getCommercialGate().resolveBillingFeatureAccess(userId, 'team_features', { teamId })
    if (!featureAccess.allowed) {
      return c.json({ message: featureAccess.message, billingFeatureAccess: featureAccess }, 402)
    }
    const payload = z.object({ email: z.string().email() }).parse(await c.req.json())

    const targetUser = getUserByEmail(payload.email)
    if (!targetUser) {
      return c.json({ message: '用户不存在' }, 404)
    }

    // 入空间确认：不再直接拉入，改为创建待确认邀请（被邀请人接受后才成为成员）。
    const existingRole = getTeamMemberRole(teamId, targetUser.id)
    if (existingRole && existingRole !== 'viewer') {
      return c.json({ message: '该用户已是空间成员' }, 400)
    }
    const seatAccess = await getCommercialGate().resolveTeamSeatAccess(teamId, 'member')
    if (!seatAccess.allowed) {
      return c.json({ message: seatAccess.message, teamSeatAccess: seatAccess }, 402)
    }

    const invitation = await createTeamInvitationAndWait(teamId, payload.email, userId)
    publishState(loadState())

    // 收件箱提醒（已注册用户）：XX 邀请你加入协作空间。
    const team = getTeamById(teamId)
    const currentUser = getUserById(userId)
    await publishInboxItem({
      recipientType: 'user',
      recipientId: targetUser.id,
      kind: 'mention',
      reason: 'mentioned',
      eventType: TEAM_INVITATION_EVENT_TYPE,
      actor: { type: 'user', id: userId, name: currentUser?.name || currentUser?.email || '用户' },
      title: team?.name || '协作空间',
      body: '邀请你加入协作空间',
      scope: { workspaceId: teamId, invitationToken: invitation.token },
      groupKey: `team-invitation:${teamId}`,
      replyTo: { kind: 'none' },
      dedupeKey: `team-invitation:${teamId}:${targetUser.id}`,
      createdAt: new Date().toISOString(),
    }).catch(() => undefined)

    return c.json({ ok: true, invitation, message: '已发送加入邀请，等待对方确认。' })
  })

  app.delete('/api/auth/teams/:teamId/members/:userId', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    const teamId = c.req.param('teamId')
    if (!isTeamAdmin(teamId, userId)) {
      return c.json({ message: '无权限' }, 403)
    }
    const targetUserId = c.req.param('userId')
    await removeTeamMemberAndWait(teamId, targetUserId)
    publishState(loadState())
    return c.json({ ok: true })
  })

  app.get('/api/auth/teams/:teamId', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    const teamId = c.req.param('teamId')
    if (!ensureTeamMember(teamId, userId)) {
      return c.json({ message: '无权限' }, 403)
    }
    const team = getTeamById(teamId)
    if (!team) {
      return c.json({ message: '团队不存在' }, 404)
    }
    return c.json({ team })
  })

  app.put('/api/auth/teams/:teamId', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    const teamId = c.req.param('teamId')
    if (!isTeamAdmin(teamId, userId)) {
      return c.json({ message: '无权限' }, 403)
    }
    const payload = z.object({
      name: z.string().min(1).optional(),
      description: z.string().optional(),
      avatarUrl: z.string().url().optional(),
    }).parse(await c.req.json())
    const team = await updateTeamAndWait(teamId, payload)
    if (!team) {
      return c.json({ message: '团队不存在' }, 404)
    }
    publishState(loadState())
    return c.json({ team })
  })

  app.get('/api/auth/teams/invitations/mine', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    const user = getUserById(userId)
    if (!user) {
      return c.json({ message: '用户不存在' }, 404)
    }

    const invitations = getPendingTeamInvitationsByEmail(user.email)
      .filter((invitation) => !getTeamMemberRole(invitation.teamId, userId))
      .map((invitation) => ({
        ...invitation,
        teamName: getTeamById(invitation.teamId)?.name,
      }))

    return c.json({ invitations })
  })

  app.get('/api/auth/teams/:teamId/invitations', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    const teamId = c.req.param('teamId')
    if (!ensureTeamMember(teamId, userId)) {
      return c.json({ message: '无权限' }, 403)
    }
    const invitations = getTeamInvitations(teamId)
    return c.json({ invitations })
  })

  app.post('/api/auth/teams/:teamId/invitations', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    const teamId = c.req.param('teamId')
    if (!isTeamAdmin(teamId, userId)) {
      return c.json({ message: '无权限' }, 403)
    }
    const featureAccess = await getCommercialGate().resolveBillingFeatureAccess(userId, 'team_features', { teamId })
    if (!featureAccess.allowed) {
      return c.json({ message: featureAccess.message, billingFeatureAccess: featureAccess }, 402)
    }
    const payload = z.object({
      email: z.string().email(),
      role: z.enum(['admin', 'member', 'viewer']).default('member'),
    }).parse(await c.req.json())
    const seatAccess = await getCommercialGate().resolveTeamSeatAccess(teamId, payload.role)
    if (!seatAccess.allowed) {
      return c.json({ message: seatAccess.message, teamSeatAccess: seatAccess }, 402)
    }
    const invitation = await createTeamInvitationAndWait(teamId, payload.email, userId, payload.role)
    publishState(loadState())
    return c.json({ invitation, inviteUrl: `/invite/${invitation.token}` })
  })

  app.post('/api/auth/teams/invitations/:token/accept', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    const token = c.req.param('token')
    const invitation = getInvitationByToken(token)
    if (!invitation) {
      return c.json({ message: '邀请无效或已过期' }, 400)
    }

    const currentRole = getTeamMemberRole(invitation.teamId, userId)
    if (!currentRole || currentRole === 'viewer') {
      const featureAccess = await getCommercialGate().resolveBillingFeatureAccess(userId, 'team_features', { teamId: invitation.teamId })
      if (!featureAccess.allowed) {
        return c.json({ message: featureAccess.message, billingFeatureAccess: featureAccess }, 402)
      }

      const seatAccess = await getCommercialGate().resolveTeamSeatAccess(invitation.teamId, invitation.role, {
        excludeInvitationId: invitation.id,
      })
      if (!seatAccess.allowed) {
        return c.json({ message: seatAccess.message, teamSeatAccess: seatAccess }, 402)
      }
    }

    const success = acceptTeamInvitation(token, userId)
    if (!success) {
      return c.json({ message: '邀请无效或已过期' }, 400)
    }
    publishState(loadState())
    return c.json({ ok: true })
  })

  app.delete('/api/auth/teams/invitations/:invitationId', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    const invitationId = c.req.param('invitationId')
    const invitation = getInvitationById(invitationId)
    if (!invitation || !isTeamAdmin(invitation.teamId, userId)) {
      return c.json({ message: '无权限' }, 403)
    }
    cancelTeamInvitation(invitationId, userId)
    publishState(loadState())
    return c.json({ ok: true })
  })

  app.get('/api/auth/teams/:teamId/projects', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    const teamId = c.req.param('teamId')
    if (!ensureTeamMember(teamId, userId)) {
      return c.json({ message: '无权限' }, 403)
    }
    const state = loadState()
    const projectIds = new Set(getTeamProjects(teamId).map((project) => project.projectId))
    const projects = state.projects.filter((project) => projectIds.has(project.id))
    return c.json({ projects })
  })

  app.get('/api/auth/teams/:teamId/executors', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    const teamId = c.req.param('teamId')
    if (!ensureTeamMember(teamId, userId)) {
      return c.json({ message: '无权限' }, 403)
    }

    return c.json({ executors: listTeamSharedExecutors(teamId) })
  })

  app.post('/api/auth/teams/:teamId/executors', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    const teamId = c.req.param('teamId')
    if (!isTeamAdmin(teamId, userId)) {
      return c.json({ message: '无权限' }, 403)
    }

    const payload = z.object({
      executorIds: z.array(z.string().trim().min(1)).min(1),
    }).parse(await c.req.json().catch(() => ({})))

    for (const executorId of payload.executorIds) {
      const executor = executorRegistry.getExecutor(executorId)
      if (!executor) {
        return c.json({ message: '执行器不存在。' }, 404)
      }
      if (executor.ownerUserId !== userId) {
        return c.json({ message: '只能绑定当前用户拥有的执行器。' }, 403)
      }

      const currentWorkspaceIds = Array.from(new Set((executor.workspaceIds ?? (executor.teamId ? [executor.teamId] : []))
        .map((value: string) => value?.trim() || '')
        .filter(Boolean)))
      const nextWorkspaceIds = currentWorkspaceIds.includes(teamId) ? currentWorkspaceIds : [...currentWorkspaceIds, teamId]
      executorRegistry.upsertExecutor(executorId, {
        visibility: 'team',
        teamId: nextWorkspaceIds[0],
        workspaceIds: nextWorkspaceIds,
        lastSeenAt: new Date().toISOString(),
      })
    }

    publishState(loadState())
    return c.json({ ok: true, executors: listTeamSharedExecutors(teamId) })
  })

  app.delete('/api/auth/teams/:teamId/executors/:executorId', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    const teamId = c.req.param('teamId')
    const executorId = c.req.param('executorId')
    if (!isTeamAdmin(teamId, userId)) {
      return c.json({ message: '无权限' }, 403)
    }

    const executor = executorRegistry.getExecutor(executorId)
    if (!executor) {
      return c.json({ message: '执行器不存在。' }, 404)
    }
    if (executor.ownerUserId !== userId) {
      return c.json({ message: '只能调整当前用户拥有的执行器。' }, 403)
    }

    const currentWorkspaceIds = Array.from(new Set((executor.workspaceIds ?? (executor.teamId ? [executor.teamId] : []))
      .map((value: string) => value?.trim() || '')
      .filter(Boolean)))
    const nextWorkspaceIds = currentWorkspaceIds.filter((workspaceId) => workspaceId !== teamId)

    executorRegistry.upsertExecutor(executorId, {
      visibility: nextWorkspaceIds.length > 0 ? 'team' : 'private',
      teamId: nextWorkspaceIds[0],
      workspaceIds: nextWorkspaceIds,
      lastSeenAt: new Date().toISOString(),
    })

    publishState(loadState())
    return c.json({ ok: true, executors: listTeamSharedExecutors(teamId) })
  })

  app.post('/api/auth/teams/:teamId/projects', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    const teamId = c.req.param('teamId')
    if (!isTeamAdmin(teamId, userId)) {
      return c.json({ message: '无权限' }, 403)
    }
    const payload = z.object({ projectId: z.string() }).parse(await c.req.json())
    if (!isProjectAccessible(userId, payload.projectId)) {
      return c.json({ message: '无权限访问项目。' }, 403)
    }
    await addTeamProjectAndWait(teamId, payload.projectId)
    logTeamActivity(teamId, userId, 'project_added', 'project', payload.projectId)
    publishState(loadState())
    return c.json({ ok: true })
  })

  app.delete('/api/auth/teams/:teamId/projects/:projectId', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    const teamId = c.req.param('teamId')
    if (!isTeamAdmin(teamId, userId)) {
      return c.json({ message: '无权限' }, 403)
    }
    const projectId = c.req.param('projectId')
    removeTeamProject(teamId, projectId, userId)
    publishState(loadState())
    return c.json({ ok: true })
  })

  app.get('/api/auth/teams/:teamId/members/:userId/role', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    const teamId = c.req.param('teamId')
    if (!ensureTeamMember(teamId, userId)) {
      return c.json({ message: '无权限' }, 403)
    }
    const targetUserId = c.req.param('userId')
    const role = getTeamMemberRole(teamId, targetUserId)
    return c.json({ role })
  })

  app.put('/api/auth/teams/:teamId/members/:userId/role', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    const teamId = c.req.param('teamId')
    if (!isTeamAdmin(teamId, userId)) {
      return c.json({ message: '无权限' }, 403)
    }
    const targetUserId = c.req.param('userId')
    const payload = z.object({ role: z.enum(['admin', 'member', 'viewer']) }).parse(await c.req.json())
    const currentRole = getTeamMemberRole(teamId, targetUserId)
    if (!currentRole) {
      return c.json({ message: '成员不存在' }, 404)
    }

    if (currentRole === 'viewer' && payload.role !== 'viewer') {
      const featureAccess = await getCommercialGate().resolveBillingFeatureAccess(userId, 'team_features', { teamId })
      if (!featureAccess.allowed) {
        return c.json({ message: featureAccess.message, billingFeatureAccess: featureAccess }, 402)
      }

      const seatAccess = await getCommercialGate().resolveTeamSeatAccess(teamId, payload.role)
      if (!seatAccess.allowed) {
        return c.json({ message: seatAccess.message, teamSeatAccess: seatAccess }, 402)
      }
    }

    await updateTeamMemberRoleAndWait(teamId, targetUserId, payload.role, userId)
    publishState(loadState())
    return c.json({ ok: true })
  })

  app.get('/api/auth/teams/:teamId/activities', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    const teamId = c.req.param('teamId')
    if (!ensureTeamMember(teamId, userId)) {
      return c.json({ message: '无权限' }, 403)
    }
    const limit = Number(c.req.query('limit') || 50)
    const activities = getTeamActivities(teamId, limit)
    return c.json({ activities })
  })

  app.post('/api/auth/teams/invitations/verify', async (c) => {
    const payload = z.object({ token: z.string() }).parse(await c.req.json())
    const invitation = getInvitationByToken(payload.token)
    if (!invitation) {
      return c.json({ valid: false, message: '邀请无效' }, 404)
    }
    if (invitation.status !== 'pending') {
      return c.json({ valid: false, message: `邀请已${invitation.status === 'accepted' ? '被接受' : '过期'}` }, 400)
    }
    if (new Date(invitation.expiresAt) < new Date()) {
      return c.json({ valid: false, message: '邀请已过期' }, 400)
    }

    const userId = getUserIdFromHeader(c)
    if (userId) {
      const user = getUserById(userId)
      if (user && user.email.toLowerCase() !== invitation.email.toLowerCase()) {
        return c.json({ valid: false, message: '邀请与您的邮箱不匹配，请使用被邀请的邮箱登录。' }, 403)
      }
    }

    const team = getTeamById(invitation.teamId)
    return c.json({ valid: true, invitation: { ...invitation, teamName: team?.name } })
  })

  // === Personal Access Tokens ===

  app.get('/api/auth/tokens', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    const tokens = await listPersonalAccessTokens(userId)
    return c.json({ tokens } satisfies PersonalAccessTokenListResponse)
  })

  app.post('/api/auth/tokens', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    const payload = z.object({
      name: z.string().trim().min(1).max(100),
      expiresIn: z.enum(['90d', '180d', '1y', 'never']).default('90d'),
    }).parse(await c.req.json())

    const expiresAt = (() => {
      if (payload.expiresIn === 'never') return null
      const ms = {
        '90d': 90 * 24 * 60 * 60 * 1000,
        '180d': 180 * 24 * 60 * 60 * 1000,
        '1y': 365 * 24 * 60 * 60 * 1000,
      }[payload.expiresIn]
      return new Date(Date.now() + ms).toISOString()
    })()

    const token = await createPersonalAccessToken({ userId, name: payload.name, expiresAt })
    return c.json(token satisfies PersonalAccessTokenCreateResponse, 201)
  })

  app.delete('/api/auth/tokens/:tokenId', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    const tokenId = c.req.param('tokenId')
    const deleted = await deletePersonalAccessToken(tokenId, userId)
    if (!deleted) return c.json({ message: 'Token 不存在' }, 404)
    return c.json({ ok: true })
  })

  app.delete('/api/auth/tokens', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    const count = await revokeAllPersonalAccessTokens(userId)
    return c.json({ ok: true, deleted: count })
  })
}
