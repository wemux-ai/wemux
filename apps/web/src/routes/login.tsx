// [INPUT]: 登录请求
// [OUTPUT]: 登录页
// [POS]: 登录页
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import { useEffect, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { ArrowRight, CheckCircle2, ChevronDown, FlaskConical, LoaderCircle, Mail } from 'lucide-react'
import { TurnstileWidget } from '../components/auth/turnstile-widget'
import { CommunityLinkList } from '../components/community-join-dialog'
import { Button } from '../components/ui/button'
import { api, consumeAuthNotice, consumeAuthRedirectLoopGuard, markAuthBridgeSucceeded, type DevLoginAccountSummary, type GoogleBridgeResponse } from '../lib/api'
import { isCommunityEdition, useAppBrand } from '../lib/app-brand'
import { useAuth } from '../lib/auth-context'
import { useTranslation } from '../lib/i18n/react'
import { buildNoIndexHead } from '../lib/marketing-site'
import { isMacNativeClient, isNativeClient } from '../lib/native-client'
import { clearCustomServerUrl, DEFAULT_SERVER_URL, getCustomServerUrl, resolveCanonicalLoopbackUrl, setCustomServerUrl } from '../lib/runtime-config'
import { cn } from '../lib/utils'

export const Route = createFileRoute('/login')({
  head: () => buildNoIndexHead({
    title: 'Log In to Wemux',
    description: 'Sign in to the Wemux control plane to manage AI coding delivery, workers, and review flows.',
  }),
  component: LoginPage,
})

const getErrorMessage = (error: unknown, fallback: string) => {
  if (error instanceof Error) {
    return error.message
  }

  return fallback
}

const getOAuthErrorCode = () => {
  if (typeof window === 'undefined') {
    return ''
  }

  return new URLSearchParams(window.location.search).get('error') ?? ''
}

const clearOAuthErrorCode = () => {
  if (typeof window === 'undefined') {
    return
  }

  const url = new URL(window.location.href)
  url.searchParams.delete('error')
  window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`)
}

const resolveCurrentWindowUrl = (path: string) => {
  if (typeof window === 'undefined') {
    return path
  }

  return new URL(path, window.location.origin).toString()
}

export function LoginPage() {
  const { language, t } = useTranslation()
  const tr = (zh: string, en: string) => language === 'zh' ? zh : en
  const { login: authLogin } = useAuth()
  const [loading, setLoading] = useState(false)
  const [checkingSession, setCheckingSession] = useState(true)
  const [error, setError] = useState('')
  const [hasOAuthError, setHasOAuthError] = useState(() => Boolean(getOAuthErrorCode()))
  const [devAccountsLoading, setDevAccountsLoading] = useState(true)
  const [devAccounts, setDevAccounts] = useState<DevLoginAccountSummary[]>([])
  const [emailConfigured, setEmailConfigured] = useState(true)
  const [googleConfigured, setGoogleConfigured] = useState(false)
  const [turnstileSiteKey, setTurnstileSiteKey] = useState('')
  const [turnstileToken, setTurnstileToken] = useState('')
  const [turnstileMessage, setTurnstileMessage] = useState('')
  const [turnstileResetKey, setTurnstileResetKey] = useState(0)
  const isTurnstileEnabled = Boolean(turnstileSiteKey)
  const isMacNative = isMacNativeClient()

  const redirectAfterLogin = (response: NonNullable<GoogleBridgeResponse['user']>) => {
    window.location.href = response.onboardingCompletedAt || response.onboardingDismissedAt ? '/dashboard' : '/onboarding'
  }

  const tryBridgeSession = async () => {
    setLoading(true)
    try {
      const response = await api.bridgeGoogleSession()
      if (!response.user || !response.token) {
        throw new Error(response.message || tr('登录结果无效。', 'Invalid login result.'))
      }

      markAuthBridgeSucceeded()
      authLogin(response.user, response.token)
      redirectAfterLogin(response.user)
    } catch (error) {
      const status = typeof error === 'object' && error && 'status' in error ? (error as { status?: number }).status : undefined
      const payload = typeof error === 'object' && error && 'payload' in error ? (error as { payload?: GoogleBridgeResponse }).payload : undefined

      if (status === 401 || payload?.needsLogin) {
        if (!hasOAuthError) {
          setError('')
        }
        return
      }

      setError(getErrorMessage(error, tr('登录失败，请稍后再试。', 'Login failed. Please try again later.')))
    } finally {
      setLoading(false)
      setCheckingSession(false)
    }
  }

  useEffect(() => {
    let cancelled = false

    void api.listDevLoginAccounts()
      .then((response) => {
        if (!cancelled) {
          setDevAccounts(response.enabled ? response.accounts : [])
          setTurnstileSiteKey(response.turnstile?.enabled ? response.turnstile.siteKey : '')
          if (response.email) {
            setEmailConfigured(response.email.configured)
          }
          if (response.google) {
            setGoogleConfigured(response.google.configured)
          }
        }
      })
      .catch(() => {
        if (!cancelled) {
          setDevAccounts([])
          setTurnstileSiteKey('')
        }
      })
      .finally(() => {
        if (!cancelled) {
          setDevAccountsLoading(false)
        }
      })

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    const canonicalUrl = resolveCanonicalLoopbackUrl()
    if (canonicalUrl) {
      window.location.replace(canonicalUrl)
    }
  }, [])

  useEffect(() => {
    const oauthError = getOAuthErrorCode()
    if (oauthError === 'state_mismatch') {
      setError(tr(
        'Google 登录状态已丢失。请从当前 hybrid 默认地址重新发起登录，不要在 localhost、127.0.0.1 和局域网 IP 之间来回切换。',
        'Google sign-in state was lost. Restart sign-in from the current hybrid default origin and avoid switching between localhost, 127.0.0.1, and LAN IPs.',
      ))
      if (isTurnstileEnabled) {
        setTurnstileToken('')
        setTurnstileResetKey((current) => current + 1)
      }
      clearOAuthErrorCode()
      return
    }

    if (oauthError === 'please_restart_the_process') {
      setError(tr(
        '登录流程已过期，请重新点击 Google 登录。',
        'The sign-in flow expired. Please click Google sign-in again.',
      ))
      if (isTurnstileEnabled) {
        setTurnstileToken('')
        setTurnstileResetKey((current) => current + 1)
      }
      clearOAuthErrorCode()
      return
    }

    const notice = consumeAuthNotice()
    if (notice) {
      setError(notice)
    }
  }, [isTurnstileEnabled, language])

  useEffect(() => {
    if (resolveCanonicalLoopbackUrl()) {
      return
    }

    // 防 401 强制登出 ↔ 自动 bridge 的无限循环：上一次被 401 踢到登录页后，
    // 自动恢复登录成功，但又被同一接口 401 踢回，说明不是单纯 token 过期。
    // 此时熔断自动恢复，停在登录表单由用户手动操作。
    if (consumeAuthRedirectLoopGuard()) {
      setCheckingSession(false)
      return
    }

    void tryBridgeSession()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleGoogleLogin = async () => {
    const canonicalUrl = resolveCanonicalLoopbackUrl()
    if (canonicalUrl) {
      window.location.replace(canonicalUrl)
      return
    }

    if (isTurnstileEnabled && !turnstileToken) {
      setTurnstileMessage(tr('请先完成人机验证。', 'Please complete the human check first.'))
      return
    }

    setHasOAuthError(false)
    setError('')
    setTurnstileMessage('')
    setLoading(true)
    try {
      if (isTurnstileEnabled) {
        await api.prepareGoogleLogin(turnstileToken)
      }

      const redirectUrl = await api.startGoogleSocialLogin({
        callbackURL: resolveCurrentWindowUrl('/login'),
        errorCallbackURL: resolveCurrentWindowUrl('/login'),
      })

      window.location.assign(redirectUrl)
    } catch (error) {
      if (isTurnstileEnabled) {
        setTurnstileToken('')
        setTurnstileResetKey((current) => current + 1)
        setTurnstileMessage(getErrorMessage(error, tr('请重新完成人机验证后再试。', 'Please complete the human check again before retrying.')))
      }
      setError(getErrorMessage(error, tr('登录失败，请稍后再试。', 'Login failed. Please try again later.')))
      setLoading(false)
    }
  }

  const handleDevLogin = async (accountId: string) => {
    setHasOAuthError(false)
    setError('')
    setLoading(true)
    try {
      const response = await api.loginWithDevAccount(accountId)
      authLogin(response.user, response.token)
      redirectAfterLogin(response.user)
    } catch (error) {
      setError(getErrorMessage(error, tr('测试账号登录失败，请稍后再试。', 'Dev account sign-in failed. Please try again later.')))
      setLoading(false)
    }
  }

  const loginBrand = useAppBrand()
  const communityLogin = isCommunityEdition(loginBrand)
  const title = communityLogin
    ? tr('登录 Wemux 社区版', 'Sign in to Wemux Community')
    : tr('登录 Wemux', 'Sign in to Wemux')
  const subtitle = tr('使用邮箱账号登录或注册，也可使用 Google 账号继续。', 'Sign in with your email or create an account, or continue with Google.')
  const googleLoginDisabled = loading || !googleConfigured || (isTurnstileEnabled && !turnstileToken)

  const handlePasswordLoginSuccess = (user: NonNullable<GoogleBridgeResponse['user']>, token: string) => {
    markAuthBridgeSucceeded()
    authLogin(user, token)
    redirectAfterLogin(user)
  }

  return (
    <div className={cn(
      'min-h-screen text-zinc-100',
      isMacNative
        ? 'relative bg-transparent md:grid md:grid-cols-[minmax(0,1fr)_minmax(400px,0.72fr)]'
        : 'flex items-center justify-center bg-zinc-950 px-4 py-8',
    )}>
      {isMacNative ? <div data-native-drag-region="deep" className="fixed inset-x-0 top-0 z-50 h-11" /> : null}

      {isMacNative ? (
        <section
          data-native-drag-region="deep"
          className="relative hidden min-h-screen overflow-hidden border-r border-white/[0.055] px-12 pb-10 pt-20 md:flex md:flex-col lg:px-16"
        >
          <div className="max-w-xl">
            <div className="flex items-center gap-3">
              <img src="/logo.svg" alt="" className="h-9 w-9 rounded-lg" />
              <span className="text-lg font-semibold text-zinc-100">Wemux</span>
            </div>
            <p className="mt-10 max-w-lg text-3xl font-semibold leading-tight text-zinc-50 lg:text-4xl">
              {tr('让任务、Agent 与工作区在同一个交付界面协作。', 'Bring tasks, agents, and workspaces into one delivery surface.')}
            </p>
            <p className="mt-4 max-w-lg text-sm leading-6 text-zinc-400">
              {tr('从需求分派到代码、日志和评审，桌面端持续连接你的执行环境。', 'From dispatch to code, logs, and review, the desktop app stays connected to your execution environment.')}
            </p>
            <div className="mt-8 space-y-3 text-sm text-zinc-300">
              {[
                tr('统一查看任务与工作区状态', 'See task and workspace status together'),
                tr('实时跟踪 Agent 执行过程', 'Track agent execution in real time'),
                tr('集中审阅代码与交付结果', 'Review code and delivery results in one place'),
              ].map((item) => (
                <div key={item} className="flex items-center gap-2.5">
                  <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" />
                  <span>{item}</span>
                </div>
              ))}
            </div>
          </div>
        </section>
      ) : null}

      <main className={cn(
        'flex items-center justify-center',
        isMacNative ? 'min-h-screen overflow-y-auto bg-[#09090b] px-8 py-16 md:px-10' : 'w-full',
      )}>
      <div className={cn('w-full space-y-5', isMacNative ? 'max-w-sm' : 'max-w-xs')}>
        <header className="space-y-1.5 text-center">
          <p className="text-xs font-medium text-emerald-300">
            {communityLogin
              ? tr('Wemux 社区版 · 开源自托管', 'Wemux Community · Open-source self-hosted')
              : t('login.workspaceBadge')}
          </p>
          <h1 className="text-xl font-semibold tracking-tight text-zinc-50">{title}</h1>
          <p className="text-xs leading-5 text-zinc-500">{subtitle}</p>
        </header>

        {/* 桌面端客户端：服务器地址选择（自托管用户连自己的实例；浏览器网页不显示） */}
        {isNativeClient() ? <ServerSelector tr={tr} /> : null}

        {checkingSession ? <LoadingNotice /> : null}
        {!checkingSession ? (
          <div className="space-y-3">
            <ErrorMessage message={error} />
            {isMacNative && (devAccountsLoading || devAccounts.length > 0) ? (
              <DevAccountsPanel
                accounts={devAccounts}
                loading={devAccountsLoading}
                disabled={loading}
                onSelect={(accountId) => void handleDevLogin(accountId)}
              />
            ) : null}
            <EmailPasswordPanel
              tr={tr}
              emailConfigured={emailConfigured}
              onSuccess={handlePasswordLoginSuccess}
              onError={setError}
            />
            <div className="space-y-2">
              {isTurnstileEnabled ? (
                <TurnstilePanel
                  message={turnstileMessage}
                  resetKey={turnstileResetKey}
                  siteKey={turnstileSiteKey}
                  token={turnstileToken}
                  onError={(message) => {
                    setTurnstileToken('')
                    setTurnstileMessage(message)
                  }}
                  onTokenChange={(token) => {
                    setTurnstileToken(token)
                    if (token) {
                      setTurnstileMessage('')
                    }
                  }}
                />
              ) : null}
              <Button
                type="button"
                className="h-9 w-full bg-zinc-100 text-zinc-950 hover:bg-zinc-200 disabled:cursor-not-allowed disabled:bg-zinc-800/60 disabled:text-zinc-500"
                disabled={googleLoginDisabled}
                onClick={() => void handleGoogleLogin()}
              >
                <GoogleGIcon className="h-4 w-4" />
                {loading
                  ? tr('正在跳转...', 'Redirecting...')
                  : tr('使用 Google 登录', 'Sign in with Google')}
                {!googleConfigured ? null : <ArrowRight className="h-4 w-4" />}
              </Button>
              <p className="text-center text-xs text-zinc-600">
                {googleConfigured
                  ? tr('Google 登录后直接进入系统。', 'Google sign-in takes you straight into Wemux.')
                  : tr('未配置 Google 登录（需 GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET）。', 'Google sign-in is not configured (requires GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET).')}
              </p>
            </div>
            <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-xs text-zinc-500">
              <CommunityLinkList language={language} className="text-emerald-400 transition hover:text-emerald-300" />
            </div>
            {!isMacNative && (devAccountsLoading || devAccounts.length > 0) ? (
              <DevAccountsPanel
                accounts={devAccounts}
                loading={devAccountsLoading}
                disabled={loading}
                onSelect={(accountId) => void handleDevLogin(accountId)}
              />
            ) : null}
          </div>
        ) : null}
      </div>
      </main>
    </div>
  )
}

/**
 * 桌面端服务器地址选择（仅 Electron 客户端显示）：
 * 默认官方 wemux.ai；自托管用户填写自己部署的实例地址。
 * 切换服务器时清空旧登录态（auth_token/user），避免串号。
 */
function ServerSelector({ tr }: { tr: (zh: string, en: string) => string }) {
  const [url, setUrl] = useState<string>(() => getCustomServerUrl() ?? '')
  const [message, setMessage] = useState<string>('')

  const handleSave = () => {
    const trimmed = url.trim().replace(/\/+$/, '')
    if (trimmed && !/^https?:\/\//i.test(trimmed)) {
      setMessage(tr('请输入以 http:// 或 https:// 开头的完整地址。', 'Enter a full URL starting with http:// or https://.'))
      return
    }
    // 切换服务器：清空旧登录态，避免跨服务器串号
    try {
      window.localStorage.removeItem('auth_token')
      window.localStorage.removeItem('user')
    } catch {
      // 忽略存储异常
    }
    if (trimmed) {
      setCustomServerUrl(trimmed)
    } else {
      clearCustomServerUrl()
    }
    setMessage(tr('已保存，正在重新连接…', 'Saved, reconnecting…'))
    window.setTimeout(() => window.location.reload(), 300)
  }

  return (
    <div className="rounded-xl border border-zinc-800/80 bg-zinc-950/60 p-3">
      <p className="text-xs font-medium text-zinc-300">{tr('服务器地址（桌面客户端）', 'Server address (desktop client)')}</p>
      <p className="mt-1 text-[11px] leading-4 text-zinc-500">
        {tr('默认连接 Wemux 官方服务。自托管用户请填写自己部署的服务器地址。', 'Defaults to the official Wemux service. Self-hosted users should enter their own server address.')}
      </p>
      <div className="mt-2 flex gap-2">
        <input
          type="text"
          value={url}
          placeholder={DEFAULT_SERVER_URL}
          onChange={(event) => setUrl(event.target.value)}
          className="h-8 min-w-0 flex-1 rounded-lg border border-zinc-800 bg-zinc-950 px-2.5 text-xs text-zinc-200 placeholder-zinc-600 focus:border-emerald-400/50 focus:outline-none"
          spellCheck={false}
        />
        <button
          type="button"
          onClick={handleSave}
          className="h-8 shrink-0 rounded-lg bg-zinc-100 px-3 text-xs font-medium text-zinc-950 transition hover:bg-zinc-200"
        >
          {tr('保存并重连', 'Save & reconnect')}
        </button>
      </div>
      {message ? <p className="mt-1.5 text-[11px] text-emerald-400">{message}</p> : null}
    </div>
  )
}

function EmailPasswordPanel({
  tr,
  emailConfigured,
  onSuccess,
  onError,
}: {
  tr: (zh: string, en: string) => string
  emailConfigured: boolean
  onSuccess: (user: NonNullable<GoogleBridgeResponse['user']>, token: string) => void
  onError: (message: string) => void
}) {
  const [mode, setMode] = useState<'login' | 'register' | 'forgot'>('login')
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [info, setInfo] = useState('')
  const [needsVerification, setNeedsVerification] = useState(false)

  const run = async (action: () => Promise<void>) => {
    setBusy(true)
    setInfo('')
    onError('')
    try {
      await action()
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const payload = typeof error === 'object' && error && 'payload' in error
        ? (error as { payload?: { code?: string; message?: string } }).payload
        : undefined
      if (payload?.code === 'EMAIL_NOT_VERIFIED') {
        setNeedsVerification(true)
        setInfo(tr('邮箱尚未验证，请查收验证邮件，或点击下方按钮重发。', 'Email is not verified yet. Check your inbox or resend the verification email below.'))
        return
      }
      onError(message)
    } finally {
      setBusy(false)
    }
  }

  const handleLogin = () => run(async () => {
    if (!email.trim() || !password) {
      onError(tr('请输入邮箱和密码。', 'Please enter your email and password.'))
      return
    }
    await api.signInWithEmailPassword({
      email: email.trim(),
      password,
      callbackURL: resolveCurrentWindowUrl('/login'),
    })
    const bridge = await api.bridgePasswordSession()
    if (!bridge.user || !bridge.token) {
      if (bridge.needsVerification) {
        setNeedsVerification(true)
        setInfo(tr('邮箱尚未验证，请查收验证邮件，或点击下方按钮重发。', 'Email is not verified yet. Check your inbox or resend the verification email below.'))
        return
      }
      throw new Error(bridge.message || tr('登录结果无效。', 'Invalid login result.'))
    }
    onSuccess(bridge.user, bridge.token)
  })

  const handleRegister = () => run(async () => {
    if (!email.trim() || !password) {
      onError(tr('请输入邮箱和密码。', 'Please enter your email and password.'))
      return
    }
    if (password.length < 8) {
      onError(tr('密码至少 8 位。', 'Password must be at least 8 characters.'))
      return
    }
    if (password !== confirmPassword) {
      onError(tr('两次输入的密码不一致。', 'Passwords do not match.'))
      return
    }
    await api.signUpWithEmail({
      email: email.trim(),
      password,
      name: name.trim() || email.trim().split('@')[0] || 'User',
      callbackURL: resolveCurrentWindowUrl('/login'),
    })
    setMode('login')
    if (emailConfigured) {
      // 已配置真实邮件发送：进入验证流程
      setNeedsVerification(true)
      setInfo(tr('注册成功！验证邮件已发送到您的邮箱，请查收并点击验证链接（1 小时内有效）。', 'Registration succeeded! A verification email has been sent. Click the link in it within 1 hour to verify.'))
      return
    }
    // 未配置邮件发送：注册即成功，无需验证，直接登录
    setNeedsVerification(false)
    try {
      const bridge = await api.bridgePasswordSession()
      if (bridge.user && bridge.token) {
        onSuccess(bridge.user, bridge.token)
        return
      }
    } catch {
      // 自动登录失败时停留在登录表单，用户手动登录即可
    }
    setInfo(tr('注册成功！当前未配置邮件发送服务，无需邮箱验证，请直接登录。', 'Registration succeeded! No email service is configured, so no verification is needed — sign in below.'))
  })

  const handleForgot = () => run(async () => {
    if (!email.trim()) {
      onError(tr('请输入邮箱。', 'Please enter your email.'))
      return
    }
    await api.forgetPassword({ email: email.trim(), redirectTo: resolveCurrentWindowUrl('/login') })
    setInfo(tr('如果该邮箱已注册，重置密码邮件已发送，请查收。', 'If that email is registered, a password reset email has been sent.'))
  })

  const handleResendVerification = () => run(async () => {
    if (!email.trim()) {
      onError(tr('请输入邮箱。', 'Please enter your email.'))
      return
    }
    await api.requestEmailVerification({ email: email.trim(), callbackURL: resolveCurrentWindowUrl('/login') })
    setInfo(tr('验证邮件已重新发送，请查收。', 'Verification email has been resent. Please check your inbox.'))
  })

  return (
    <div className="space-y-3">
      {info ? (
        <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-4 py-3 text-sm leading-5 text-emerald-300">{info}</div>
      ) : null}

      {mode === 'login' ? (
        <>
          <input
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder={tr('邮箱', 'Email')}
            className="h-9 w-full rounded-lg border border-zinc-700 bg-zinc-900/60 px-3 text-sm text-zinc-100 placeholder:text-zinc-500 focus:border-emerald-500 focus:outline-none"
          />
          <input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder={tr('密码', 'Password')}
            className="h-9 w-full rounded-lg border border-zinc-700 bg-zinc-900/60 px-3 text-sm text-zinc-100 placeholder:text-zinc-500 focus:border-emerald-500 focus:outline-none"
          />
          <Button type="button" className="h-9 w-full bg-zinc-100 text-zinc-950 hover:bg-zinc-200" disabled={busy} onClick={() => void handleLogin()}>
            {busy ? tr('登录中...', 'Signing in...') : tr('登录', 'Sign in')}
          </Button>
          <div className="flex items-center justify-between text-xs">
            <button type="button" className="text-emerald-400 hover:text-emerald-300" onClick={() => { setMode('register'); setInfo(''); onError('') }}>
              {tr('没有账号？注册', 'No account? Register')}
            </button>
            <button type="button" className="text-zinc-500 hover:text-zinc-300" onClick={() => { setMode('forgot'); setInfo(''); onError('') }}>
              {tr('忘记密码？', 'Forgot password?')}
            </button>
          </div>
          {needsVerification ? (
            <button type="button" className="w-full text-center text-xs text-emerald-400 hover:text-emerald-300" disabled={busy} onClick={() => void handleResendVerification()}>
              {tr('重新发送验证邮件', 'Resend verification email')}
            </button>
        ) : null}
        </>
      ) : null}

      {mode === 'register' ? (
        <>
          <input
            type="text"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder={tr('名字（选填，默认取邮箱前缀）', 'Name (optional, defaults to email prefix)')}
            className="h-9 w-full rounded-lg border border-zinc-700 bg-zinc-900/60 px-3 text-sm text-zinc-100 placeholder:text-zinc-500 focus:border-emerald-500 focus:outline-none"
          />
          <input
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder={tr('邮箱', 'Email')}
            className="h-9 w-full rounded-lg border border-zinc-700 bg-zinc-900/60 px-3 text-sm text-zinc-100 placeholder:text-zinc-500 focus:border-emerald-500 focus:outline-none"
          />
          <input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder={tr('密码（至少 8 位）', 'Password (min 8 characters)' )}
            className="h-9 w-full rounded-lg border border-zinc-700 bg-zinc-900/60 px-3 text-sm text-zinc-100 placeholder:text-zinc-500 focus:border-emerald-500 focus:outline-none"
          />
          <input
            type="password"
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
            placeholder={tr('确认密码', 'Confirm password')}
            className="h-9 w-full rounded-lg border border-zinc-700 bg-zinc-900/60 px-3 text-sm text-zinc-100 placeholder:text-zinc-500 focus:border-emerald-500 focus:outline-none"
          />
          <Button type="button" className="h-9 w-full bg-zinc-100 text-zinc-950 hover:bg-zinc-200" disabled={busy} onClick={() => void handleRegister()}>
            {busy ? tr('注册中...', 'Registering...') : (emailConfigured ? tr('注册并发送验证邮件', 'Register and send verification email') : tr('注册', 'Register'))}
          </Button>
          <button type="button" className="w-full text-center text-xs text-zinc-500 hover:text-zinc-300" onClick={() => { setMode('login'); setInfo(''); onError('') }}>
            {tr('已有账号？去登录', 'Have an account? Sign in')}
          </button>
        </>
      ) : null}

      {mode === 'forgot' ? (
        <>
          <input
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder={tr('邮箱', 'Email')}
            className="h-9 w-full rounded-lg border border-zinc-700 bg-zinc-900/60 px-3 text-sm text-zinc-100 placeholder:text-zinc-500 focus:border-emerald-500 focus:outline-none"
          />
          <Button type="button" className="h-9 w-full bg-zinc-100 text-zinc-950 hover:bg-zinc-200" disabled={busy} onClick={() => void handleForgot()}>
            {busy ? tr('发送中...', 'Sending...') : tr('发送重置邮件', 'Send reset email')}
          </Button>
          <button type="button" className="w-full text-center text-xs text-zinc-500 hover:text-zinc-300" onClick={() => { setMode('login'); setInfo(''); onError('') }}>
            {tr('返回登录', 'Back to sign in')}
          </button>
        </>
      ) : null}

      <p className="flex items-center justify-center gap-1.5 text-xs text-zinc-600">
        <Mail className="h-3 w-3" />
        {emailConfigured
          ? tr('邮箱注册需要验证邮件，Google 登录无需验证。', 'Email sign-up requires email verification. Google sign-in does not.')
          : tr('邮箱注册无需邮件验证，Google 登录同样直接可用。', 'Email sign-up needs no email verification, and Google sign-in works the same way.')}
      </p>
    </div>
  )
}

/** Google 官方四色 G 图标（品牌图标，lucide 不提供）。 */
function GoogleGIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
      />
    </svg>
  )
}

function LoadingNotice() {
  const { language } = useTranslation()
  return (
    <div className="flex items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-900/40 px-4 py-3 text-sm text-zinc-400">
      <LoaderCircle className="h-4 w-4 animate-spin" />
      {language === 'zh' ? '正在检查登录状态...' : 'Checking sign-in status...'}
    </div>
  )
}

function ErrorMessage({ message }: { message: string }) {
  if (!message) return null

  return (
    <div className="rounded-lg border border-rose-500/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">
      {message}
    </div>
  )
}

function TurnstilePanel({
  message,
  resetKey,
  siteKey,
  token,
  onError,
  onTokenChange,
}: {
  message: string
  resetKey: number
  siteKey: string
  token: string
  onError: (message: string) => void
  onTokenChange: (token: string) => void
}) {
  const { language } = useTranslation()

  const statusText = message || (token
    ? (language === 'zh' ? '验证成功，可以继续登录。' : 'Verification succeeded. You can proceed with sign-in.')
    : (language === 'zh' ? '登录前验证你是真人。' : 'A human check runs before Google sign-in.'))

  return (
    <div className="min-w-0 space-y-2 rounded-lg border border-zinc-700 bg-zinc-900/60 p-2 sm:p-3">
      <TurnstileWidget
        expiredMessage={language === 'zh' ? '人机验证已过期，请重新勾选后再试。' : 'The human check expired. Please verify again.'}
        resetKey={resetKey}
        siteKey={siteKey}
        scriptErrorMessage={language === 'zh' ? '人机验证脚本加载失败，请刷新页面后重试。' : 'The human check script failed to load. Refresh the page and try again.'}
        widgetErrorMessage={language === 'zh' ? '人机验证加载失败，请刷新页面后重试。' : 'The human check failed to load. Refresh the page and try again.'}
        onError={onError}
        onTokenChange={onTokenChange}
      />
      <p className="text-xs leading-5 text-zinc-500">
        {statusText}
      </p>
    </div>
  )
}

function DevAccountsPanel({
  accounts,
  loading,
  disabled,
  onSelect,
}: {
  accounts: DevLoginAccountSummary[]
  loading: boolean
  disabled: boolean
  onSelect: (accountId: string) => void
}) {
  const { language } = useTranslation()
  const [expanded, setExpanded] = useState(() => isNativeClient())

  if (!loading && accounts.length === 0) {
    return null
  }

  return (
    <div className="border-t border-zinc-900 pt-3">
      <button
        type="button"
        onClick={() => setExpanded((current) => !current)}
        aria-expanded={expanded}
        className="flex w-full items-center justify-center gap-1.5 rounded-md py-1 text-xs font-medium text-emerald-400 transition hover:text-emerald-300"
      >
        <FlaskConical className="h-3.5 w-3.5" />
        {language === 'zh' ? '开发测试账号登录' : 'Development test account sign-in'}
        <ChevronDown className={`h-3.5 w-3.5 transition-transform ${expanded ? 'rotate-180' : ''}`} />
      </button>

      {loading ? (
        <div className="mt-2 flex items-center justify-center gap-2 text-xs text-zinc-500">
          <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
          {language === 'zh' ? '正在准备测试账号...' : 'Preparing dev accounts...'}
        </div>
      ) : null}

      {!loading && expanded ? (
        <div className="mt-2.5">
          <p className="text-center text-[10px] leading-4 text-zinc-600">
            {language === 'zh'
              ? '仅本地开发环境可见，点击即可直接登录，不走 Google OAuth。'
              : 'Visible in local development only. Click to sign in directly without Google OAuth.'}
          </p>
          <div className="mt-2 grid grid-cols-2 gap-1.5">
            {accounts.map((account) => (
              <button
                key={account.id}
                type="button"
                onClick={() => onSelect(account.id)}
                disabled={disabled}
                title={account.description}
                className="min-w-0 rounded-lg border border-zinc-800 bg-zinc-900/40 px-2.5 py-2 text-left transition hover:border-zinc-700 hover:bg-zinc-900 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <div className="flex items-center justify-between gap-1.5">
                  <p className="min-w-0 truncate text-xs font-medium text-zinc-100">{account.label}</p>
                  <span className="shrink-0 text-[10px] text-emerald-300">{language === 'zh' ? '一键登录' : 'One-click sign in'}</span>
                </div>
                <p className="mt-0.5 truncate text-[11px] text-zinc-500">{account.email}</p>
                <p className="mt-0.5 truncate text-[10px] leading-4 text-zinc-600">{account.description}</p>
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  )
}
