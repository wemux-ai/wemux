// [INPUT]: 认证请求
// [OUTPUT]: 认证结果
// [POS]: better-auth 服务
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import { betterAuth } from 'better-auth'
import { getMigrations } from 'better-auth/db/migration'
import { Kysely, PostgresDialect } from 'kysely'
import { resolveBetterAuthSecret } from './auth-secrets'
import { getPool } from '../storage/postgres/db'
import { ensurePasswordUser } from '../storage/postgres/auth-store'
import { sendResetPasswordEmail, sendVerificationEmail, isEmailSendingConfigured } from './email-service'

const BETTER_AUTH_BASE_PATH = '/api/identity'
const BETTER_AUTH_LOGIN_PATH = '/login'
const ELECTRON_APP_ORIGIN = 'wemux-app://local'
const trimTrailingSlash = (value: string) => value.replace(/\/$/, '')
const isDevelopment = process.env.NODE_ENV !== 'production'

const resolveBaseUrl = () => {
  const configured = process.env.BETTER_AUTH_URL?.trim()
    || process.env.APP_BASE_URL?.trim()
    || process.env.PUBLIC_APP_URL?.trim()
    || process.env.VITE_APP_BASE_URL?.trim()
  if (configured) {
    return configured
  }

  const port = process.env.PORT?.trim() || '8989'
  return `http://127.0.0.1:${port}`
}

const resolveAppBaseUrl = () => {
  const configured = process.env.VITE_APP_BASE_URL?.trim()
    || process.env.PUBLIC_APP_URL?.trim()
    || process.env.APP_BASE_URL?.trim()
  if (configured) {
    return trimTrailingSlash(configured)
  }

  return trimTrailingSlash(resolveBaseUrl())
}

export const resolveTrustedOrigins = () => {
  const values = [
    ELECTRON_APP_ORIGIN,
    process.env.BETTER_AUTH_TRUSTED_ORIGINS?.trim() || '',
    process.env.VITE_APP_BASE_URL?.trim() || '',
    process.env.APP_BASE_URL?.trim() || '',
  ]

  return [...new Set(values.flatMap((value) => value.split(',')).map((value) => value.trim()).filter(Boolean))]
}

const googleClientId = process.env.GOOGLE_CLIENT_ID?.trim() || ''
const googleClientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim() || ''

/** 是否已配置 Google OAuth（社区版未配置时前端置灰 Google 登录按钮）。 */
export const isGoogleSocialConfigured = () => Boolean(googleClientId && googleClientSecret)

/** 是否要求邮箱验证（仅配置了真实邮件发送时才要求，未配置则注册直接成功）。 */
export const isEmailVerificationRequired = () => isEmailSendingConfigured()

const db = new Kysely({
  dialect: new PostgresDialect({
    pool: getPool(),
  }),
})

export const auth = betterAuth({
  secret: resolveBetterAuthSecret() || 'dev-better-auth-secret-change-me',
  baseURL: resolveBaseUrl(),
  basePath: BETTER_AUTH_BASE_PATH,
  trustedOrigins: resolveTrustedOrigins(),
  account: {
    // Hybrid dev serves web and auth on different ports, so Better Auth's
    // extra state cookie check can fail even when the DB-backed state is valid.
    skipStateCookieCheck: isDevelopment,
  },
  database: {
    db,
    type: 'postgres',
  },
  databaseHooks: {
    // 数据隔离修复（BUG-01）：better-auth 用户写在 user 表，wemux admin 读 users 表。
    // 注册时同步创建 wemux users 记录，保证邮箱注册用户对 admin 用户管理可见/可管理。
    user: {
      create: {
        after: async (user) => {
          await syncBetterAuthUserToWemux(user).catch((error) => {
            console.error('[better-auth] sync user to wemux users failed', error)
          })
        },
      },
    },
  },
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: isEmailVerificationRequired(),
    minPasswordLength: 8,
    maxPasswordLength: 128,
    sendResetPassword: async ({ user, url }) => {
      await sendResetPasswordEmail({ email: user.email, name: user.name, url })
    },
  },
  emailVerification: {
    sendVerificationEmail: async ({ user, url }) => {
      await sendVerificationEmail({ email: user.email, name: user.name, url })
    },
    expiresIn: 60 * 60,
    autoSignInAfterVerification: false,
  },
  onAPIError: {
    errorURL: `${resolveAppBaseUrl()}${BETTER_AUTH_LOGIN_PATH}`,
  },
  socialProviders: googleClientId && googleClientSecret
    ? {
        google: {
          clientId: googleClientId,
          clientSecret: googleClientSecret,
          prompt: 'select_account',
        },
      }
    : {},
})

/**
 * 数据隔离同步（BUG-01）：better-auth 用户（user 表）→ wemux users 表。
 * 注册/验证后保持两表一致，确保 admin 用户管理可见并可管理邮箱注册账号。
 * passwordHash 由 ensurePasswordUser 写入随机占位（权威密码在 better-auth）。
 */
const syncBetterAuthUserToWemux = async (user: {
  email: string
  name?: string
  emailVerified?: boolean
}) => {
  await ensurePasswordUser({
    email: user.email,
    name: user.name || user.email.split('@')[0] || 'User',
    emailVerified: user.emailVerified === true,
  })
}

let schemaReadyPromise: Promise<void> | null = null

const summarizeBetterAuthSchemaDiff = (diff: Awaited<ReturnType<typeof getMigrations>>) => {
  const missingTables = diff.toBeCreated.map((table) => table.table)
  const missingColumns = diff.toBeAdded.flatMap((table) => (
    Object.keys(table.fields).map((field) => `${table.table}.${field}`)
  ))

  return [
    missingTables.length > 0 ? `missing tables: ${missingTables.join(', ')}` : '',
    missingColumns.length > 0 ? `missing columns: ${missingColumns.join(', ')}` : '',
  ].filter(Boolean).join('; ')
}

export const initBetterAuth = async () => {
  if (!schemaReadyPromise) {
    schemaReadyPromise = (async () => {
      const diff = await getMigrations({
        ...auth.options,
        database: {
          db,
          type: 'postgres',
        },
      })

      if (diff.toBeCreated.length > 0 || diff.toBeAdded.length > 0) {
        throw new Error(
          `Better Auth schema is not managed by the applied Drizzle migrations (${summarizeBetterAuthSchemaDiff(diff)}). Run pnpm db:generate and deploy the migration before starting the server.`,
        )
      }
    })()
  }

  await schemaReadyPromise
}

export const getBetterAuthSession = async (headers: Headers) => {
  const result = await auth.api.getSession({
    headers,
  })

  return result
}

export const betterAuthBasePath = BETTER_AUTH_BASE_PATH
