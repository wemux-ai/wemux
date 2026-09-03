// [INPUT]: /api/auth/account/* 数据 + better-auth link-social
// [OUTPUT]: 设置页「账号安全」面板（绑定邮箱密码 / 绑定 Google / 修改密码 / 解绑）
// [POS]: 双登录体系打通 UI；密码 scrypt 存储与校验在 server（better-auth credential account）
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import { useEffect, useState } from 'react'
import { KeyRound, ShieldCheck, Loader2, Mail, Chrome } from 'lucide-react'
import { api } from '@/lib/api'
import { betterAuthClient } from '@/lib/better-auth-client'
import { useAuth } from '@/lib/auth-context'
import { useTranslation } from '@/lib/i18n/react'
import { Button } from '@/components/ui/button'
import { FieldBlock, MenuPanel } from './settings-page-shared'

export function AccountSecurityPanel({
  onBack,
  mobile,
  language,
}: {
  onBack?: () => void
  mobile?: boolean
  language: string
}) {
  const { t } = useTranslation()
  const { logout } = useAuth()
  const tr = (zh: string, en: string) => language === 'zh' ? zh : en
  const [providers, setProviders] = useState<string[]>([])
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(true)
  const [password, setPassword] = useState('')
  const [currentPassword, setCurrentPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [info, setInfo] = useState('')
  const [error, setError] = useState('')

  const hasPassword = providers.includes('credential')
  const hasGoogle = providers.includes('google')

  const load = async () => {
    try {
      const response = await api.listAuthAccounts()
      setProviders(response.accounts)
      setEmail(response.email)
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : tr('加载账号信息失败', 'Failed to load account info'))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  const run = async (action: () => Promise<void>) => {
    setBusy(true)
    setInfo('')
    setError('')
    try {
      await action()
      setInfo(tr('操作成功', 'Done'))
      setPassword('')
      setConfirmPassword('')
      setCurrentPassword('')
      void load()
    } catch (runError) {
      setError(runError instanceof Error ? runError.message : tr('操作失败', 'Operation failed'))
    } finally {
      setBusy(false)
    }
  }

  const handleSetPassword = () => run(async () => {
    if (password.length < 8) {
      throw new Error(tr('密码至少 8 位。', 'Password must be at least 8 characters.'))
    }
    if (password !== confirmPassword) {
      throw new Error(tr('两次输入的密码不一致。', 'Passwords do not match.'))
    }
    await api.linkEmailAccount({
      password,
      ...(hasPassword ? { currentPassword } : {}),
    })
  })

  const handleUnlinkEmail = () => run(async () => {
    if (!window.confirm(tr('确定解绑邮箱密码登录吗？解绑后将无法用邮箱密码登录（Google 登录仍可用）。', 'Unbind email+password login? You will no longer be able to sign in with email and password (Google sign-in stays).'))) {
      throw new Error('cancelled')
    }
    await api.unlinkEmailAccount()
  })

  const handleLinkGoogle = async () => {
    setBusy(true)
    setError('')
    try {
      const { data, error: linkError } = await betterAuthClient.linkSocial({
        provider: 'google',
        callbackURL: window.location.pathname + window.location.search,
        errorCallbackURL: window.location.pathname + window.location.search,
        disableRedirect: false,
      })
      if (linkError?.status === 400 && linkError?.code === 'USER_ALREADY_HAS_ACCOUNT') {
        setError(tr('该 Google 账号已绑定其他 Wemux 账号。', 'This Google account is already linked to another Wemux account.'))
        return
      }
      if (data?.url) {
        window.location.assign(data.url)
        return
      }
      // 已绑定（无跳转时刷新状态）
      await load()
      setInfo(tr('Google 账号已绑定', 'Google account linked'))
    } catch (linkError) {
      setError(linkError instanceof Error ? linkError.message : tr('绑定失败', 'Link failed'))
    } finally {
      setBusy(false)
    }
  }

  const handleUnlinkGoogle = async () => {
    if (!window.confirm(tr('确定解绑 Google 登录吗？', 'Unbind Google sign-in?'))) {
      return
    }
    await run(async () => {
      // better-auth >= 1.7: unlinkAccount 只接受行级 accountId，需先拉取账号列表定位 google 绑定
      const { data: accounts, error } = await betterAuthClient.listAccounts()
      if (error || !accounts) {
        throw new Error(error?.message ?? tr('获取账号列表失败', 'Failed to load linked accounts'))
      }
      const google = accounts.find((account) => account.providerId === 'google')
      if (!google) {
        throw new Error(tr('未找到 Google 账号绑定', 'Google account is not linked'))
      }
      const result = await betterAuthClient.unlinkAccount({ accountId: google.id })
      if (result.error) {
        throw new Error(result.error.message ?? tr('解绑失败', 'Failed to unlink'))
      }
    })
  }

  return (
    <MenuPanel
      title={tr('账号安全', 'Account security')}
      mobile={mobile}
      onBack={onBack}
    >
      {loading ? (
        <div className="flex items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-900/40 px-4 py-3 text-sm text-zinc-400">
          <Loader2 className="h-4 w-4 animate-spin" />
          {tr('正在加载登录方式...', 'Loading sign-in methods...')}
        </div>
      ) : (
        <div className="space-y-4">
          <div className="space-y-2">
            <p className="text-sm font-medium text-zinc-100">{tr('已绑定的登录方式', 'Linked sign-in methods')}</p>
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-3 rounded-lg border border-zinc-800 bg-zinc-900/40 px-3 py-2.5">
                <div className="flex items-center gap-2.5">
                  <Mail className="h-4 w-4 text-emerald-400" />
                  <div className="min-w-0">
                    <p className="text-sm text-zinc-100">{email || tr('邮箱', 'Email')}</p>
                    <p className="text-xs text-zinc-500">{hasPassword ? tr('邮箱 + 密码已绑定', 'Email + password linked') : tr('未设置密码', 'No password set')}</p>
                  </div>
                </div>
                {hasPassword ? (
                  <div className="flex items-center gap-2">
                    <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => { setCurrentPassword(''); setPassword(''); setConfirmPassword(''); setInfo('') }}>
                      {tr('修改密码', 'Change password')}
                    </Button>
                    <Button type="button" size="sm" variant="ghost" className="text-rose-400 hover:text-rose-300" disabled={busy} onClick={() => void handleUnlinkEmail()}>
                      {tr('解绑', 'Unlink')}
                    </Button>
                  </div>
                ) : null}
              </div>

              <div className="flex items-center justify-between gap-3 rounded-lg border border-zinc-800 bg-zinc-900/40 px-3 py-2.5">
                <div className="flex items-center gap-2.5">
                  <Chrome className="h-4 w-4 text-emerald-400" />
                  <div className="min-w-0">
                    <p className="text-sm text-zinc-100">Google</p>
                    <p className="text-xs text-zinc-500">{hasGoogle ? tr('已绑定 Google', 'Google linked') : tr('未绑定 Google', 'Google not linked')}</p>
                  </div>
                </div>
                {hasGoogle ? (
                  <Button type="button" size="sm" variant="ghost" className="text-rose-400 hover:text-rose-300" disabled={busy} onClick={() => void handleUnlinkGoogle()}>
                    {tr('解绑', 'Unlink')}
                  </Button>
                ) : (
                  <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => void handleLinkGoogle()}>
                    {tr('绑定 Google', 'Link Google')}
                  </Button>
                )}
              </div>
            </div>
          </div>

          {info ? <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-300">{info}</div> : null}
          {error ? <div className="rounded-lg border border-rose-500/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">{error}</div> : null}

          <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-3">
            <p className="mb-2 flex items-center gap-2 text-sm font-medium text-zinc-100">
              <KeyRound className="h-4 w-4 text-emerald-400" />
              {hasPassword ? tr('修改密码', 'Change password') : tr('设置密码（绑定邮箱登录）', 'Set a password (link email sign-in)')}
            </p>
            {hasPassword ? (
              <div className="space-y-2">
                <input
                  type="password"
                  value={currentPassword}
                  onChange={(event) => setCurrentPassword(event.target.value)}
                  placeholder={tr('当前密码', 'Current password')}
                  className="h-9 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-emerald-500 focus:outline-none"
                />
              </div>
            ) : null}
            <div className="mt-2 space-y-2">
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder={tr('新密码（至少 8 位）', 'New password (min 8 characters)')}
                className="h-9 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-emerald-500 focus:outline-none"
              />
              <input
                type="password"
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                placeholder={tr('确认新密码', 'Confirm new password')}
                className="h-9 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-emerald-500 focus:outline-none"
              />
            </div>
            <Button type="button" size="sm" className="mt-3 bg-zinc-100 text-zinc-950 hover:bg-zinc-200" disabled={busy || !password} onClick={() => void handleSetPassword()}>
              {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              {hasPassword ? tr('修改密码', 'Change password') : tr('设置密码', 'Set password')}
            </Button>
            {hasPassword ? (
              <p className="mt-2 text-xs leading-5 text-zinc-500">{tr('提示：设置/修改密码后，可用邮箱和密码登录本账号（与 Google 登录指向同一账号）。', 'After setting the password you can sign in with email + password (same account as Google sign-in).')}</p>
            ) : null}
          </div>

          <p className="flex items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-900/40 px-3 py-2.5 text-xs leading-5 text-zinc-500">
            <ShieldCheck className="h-4 w-4 shrink-0 text-emerald-400" />
            {tr('邮箱密码与 Google 登录指向同一个 Wemux 账号，任选一种方式登录即可。', 'Email+password and Google sign-in point to the same Wemux account. Use either to sign in.')}
          </p>

          <Button type="button" size="sm" variant="ghost" className="text-zinc-500" onClick={() => void logout()}>
            {tr('退出登录', 'Sign out')}
          </Button>
        </div>
      )}
    </MenuPanel>
  )
}
