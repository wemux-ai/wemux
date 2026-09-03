import { useEffect, useState } from 'react'
import { Check, ExternalLink, Github, Loader2, Pencil, RefreshCw, Trash2, X } from 'lucide-react'
import { toast } from 'sonner'
import { api, type GitHubAppInstallationSummary } from '../../lib/api'
import { Button } from '../ui/button'
import { Input } from '../ui/input'

export type GitHubAppInstallationsSettingsSummary = {
  connectedCount: number
  configured: boolean
}

type GitHubAppInstallationsSettingsProps = {
  onSummaryChange?: (summary: GitHubAppInstallationsSettingsSummary) => void
}

export function GitHubAppInstallationsSettings({ onSummaryChange }: GitHubAppInstallationsSettingsProps = {}) {
  const [installations, setInstallations] = useState<GitHubAppInstallationSummary[]>([])
  const [configured, setConfigured] = useState(true)
  const [appSlug, setAppSlug] = useState<string | undefined>()
  const [oauthConfigured, setOAuthConfigured] = useState(false)
  const [oauthAuthorized, setOAuthAuthorized] = useState(false)
  const [busy, setBusy] = useState(false)
  const [commitAuthorName, setCommitAuthorName] = useState('')
  const [commitAuthorEmail, setCommitAuthorEmail] = useState('')
  const [editingInstallationId, setEditingInstallationId] = useState<number | null>(null)
  const [editingName, setEditingName] = useState('')
  const [editingEmail, setEditingEmail] = useState('')

  const isValidIdentity = (name: string, email: string) =>
    Boolean(name.trim() && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()))

  const loadInstallations = async () => {
    const response = await api.listUserGitHubAppInstallations()
    setInstallations(response.installations)
    setConfigured(response.configured)
    setAppSlug(response.appSlug)
    setOAuthConfigured(response.oauthConfigured)
    setOAuthAuthorized(response.oauthAuthorized)
  }

  useEffect(() => {
    void loadInstallations().catch(() => undefined)
  }, [])

  useEffect(() => {
    onSummaryChange?.({
      connectedCount: installations.length,
      configured,
    })
  }, [configured, installations.length, onSummaryChange])

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const status = params.get('githubApp')
    if (status === 'connected') {
      toast.success('GitHub 已连接。')
      void loadInstallations().catch(() => undefined)
    } else if (status === 'error') {
      toast.error('GitHub 连接没有完成，请重新尝试。')
    }
    if (params.get('githubOAuth') === 'authorized') {
      toast.success('GitHub 账号已授权，现在可以读取协作 / 组织仓库。')
      void loadInstallations().catch(() => undefined)
    }
  }, [])

  const handleConnect = async () => {
    if (!isValidIdentity(commitAuthorName, commitAuthorEmail)) {
      toast.error('请先填写有效的 Git 提交用户名和邮箱')
      return
    }

    setBusy(true)
    try {
      const returnTo = `${window.location.pathname}${window.location.search}`
      const response = await api.createUserGitHubAppConnectUrl(returnTo, {
        commitAuthorName,
        commitAuthorEmail,
      })
      if (response.alreadyInstalled) {
        await loadInstallations()
        toast.success(response.message ?? '检测到 GitHub App 已安装，已重新连接。')
        setBusy(false)
        return
      }
      if (!response.url) {
        toast.error(response.message ?? '无法打开 GitHub 授权页面')
        setBusy(false)
        return
      }
      window.location.assign(response.url)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '无法打开 GitHub 授权页面')
      setBusy(false)
    }
  }

  const handleAuthorizeAccount = async () => {
    if (!oauthConfigured) {
      toast.error('GitHub App 尚未启用 OAuth，需要配置 GITHUB_APP_CLIENT_ID 和 GITHUB_APP_CLIENT_SECRET。')
      return
    }
    setBusy(true)
    try {
      const returnTo = `${window.location.pathname}${window.location.search}`
      const response = await api.createUserGitHubAppAuthorizeUrl(returnTo)
      if (!response.url) {
        toast.error(response.message ?? '无法打开 GitHub 授权页面')
        setBusy(false)
        return
      }
      window.location.assign(response.url)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '无法打开 GitHub 授权页面')
      setBusy(false)
    }
  }

  const handleRefresh = async () => {
    setBusy(true)
    try {
      await loadInstallations()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '刷新 GitHub installation 失败')
    } finally {
      setBusy(false)
    }
  }

  const startEditing = (installation: GitHubAppInstallationSummary) => {
    setEditingInstallationId(installation.installationId)
    setEditingName(installation.commitAuthorName ?? commitAuthorName)
    setEditingEmail(installation.commitAuthorEmail ?? commitAuthorEmail)
  }

  const handleSaveIdentity = async (installationId: number) => {
    if (!isValidIdentity(editingName, editingEmail)) {
      toast.error('请填写有效的 Git 提交用户名和邮箱')
      return
    }

    setBusy(true)
    try {
      const response = await api.updateUserGitHubAppCommitIdentity(installationId, {
        name: editingName,
        email: editingEmail,
      })
      setInstallations(response.installations)
      setEditingInstallationId(null)
      toast.success(response.message)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '更新 Git 提交身份失败')
    } finally {
      setBusy(false)
    }
  }

  const handleDelete = async (installationId: number) => {
    setBusy(true)
    try {
      const response = await api.deleteUserGitHubAppInstallation(installationId)
      setInstallations(response.installations)
      toast.success(response.message)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '移除 GitHub 连接失败')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mt-6 border border-zinc-800 bg-zinc-950/60">
      <div className="flex flex-col gap-3 border-b border-zinc-800 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className="text-sm font-medium text-zinc-100">GitHub App</p>
          <p className="mt-1 text-xs text-zinc-500">连接 GitHub 账号或组织后，Wemux 会用 installation 权限访问仓库。</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" size="sm" className="border-zinc-800 bg-zinc-950 text-zinc-200" onClick={() => void handleRefresh()} disabled={busy}>
            {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
            刷新
          </Button>
        </div>
      </div>

      {!configured ? (
        <div className="border-b border-zinc-800 bg-amber-950/20 px-4 py-3 text-sm text-amber-200">
          GitHub App 尚未配置。需要在 server 环境设置 GITHUB_APP_ID、GITHUB_APP_SLUG 和 GITHUB_APP_PRIVATE_KEY。
        </div>
      ) : null}

      <div className="p-4">
        <div className="rounded-lg border border-zinc-800 bg-zinc-950 px-4 py-4">
          <div className="flex items-start gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-zinc-100 text-zinc-950">
              <Github className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-zinc-100">Connect GitHub{appSlug ? ` · ${appSlug}` : ''}</p>
              <p className="mt-1 text-xs text-zinc-500">连接前先确认 agent 提交时写入 commit 的用户名和邮箱；GitHub App 只负责仓库授权。</p>
            </div>
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <label className="space-y-1.5">
              <span className="text-xs font-medium text-zinc-400">Git name</span>
              <Input value={commitAuthorName} onChange={(event) => setCommitAuthorName(event.target.value)} placeholder="Alice Dev" disabled={busy} />
            </label>
            <label className="space-y-1.5">
              <span className="text-xs font-medium text-zinc-400">Git email</span>
              <Input value={commitAuthorEmail} onChange={(event) => setCommitAuthorEmail(event.target.value)} placeholder="alice@example.com" disabled={busy} />
            </label>
          </div>
          <p className="mt-2 text-xs text-zinc-500">
            建议填写 GitHub 已验证邮箱或 GitHub noreply 邮箱，避免 commit 无法归属到你的 GitHub 账号。
          </p>
          <div className="mt-4 grid gap-2 sm:grid-cols-[1fr_auto]">
            <div className="flex items-center gap-2">
              <Button type="button" size="sm" onClick={() => void handleConnect()} disabled={busy || !configured || !isValidIdentity(commitAuthorName, commitAuthorEmail)}>
                <ExternalLink className="mr-2 h-4 w-4" />
                连接 GitHub
              </Button>
              <Button type="button" size="sm" variant="outline" className="border-zinc-800 bg-zinc-950 text-zinc-200" onClick={() => void handleAuthorizeAccount()} disabled={busy || !oauthConfigured}>
                <Github className="mr-2 h-4 w-4" />
                {oauthAuthorized ? '重新授权账号' : '授权账号（读取协作仓库）'}
              </Button>
            </div>
            <div className="flex items-center gap-1.5 text-xs">
              <span className={`h-1.5 w-1.5 rounded-full ${oauthAuthorized ? 'bg-emerald-400' : 'bg-zinc-600'}`} />
              <span className="text-zinc-500">{oauthAuthorized ? '已授权：可读取协作/组织仓库' : '未授权：仅显示自己的仓库'}</span>
            </div>
          </div>
          {!oauthConfigured ? (
            <p className="mt-2 text-xs text-amber-300/90">
              要读取被邀请协作的仓库，需要 GitHub App 启用 OAuth：设置 GITHUB_APP_CLIENT_ID、GITHUB_APP_CLIENT_SECRET（GitHub App 设置中开启「Identify and authorize users」并注册回调地址）。
            </p>
          ) : null}
        </div>

        <div className="mt-5 flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-medium text-zinc-100">Available installations</p>
            <p className="mt-1 text-xs text-zinc-500">项目 Git 身份绑定时可以选择下面的 installation。</p>
          </div>
          <span className="text-xs text-zinc-500">{installations.length} connected</span>
        </div>

        <div className="mt-3 space-y-2">
          {installations.length < 1 ? (
            <div className="rounded-lg border border-dashed border-zinc-800 px-4 py-5 text-center text-sm text-zinc-500">
              No installations available
            </div>
          ) : installations.map((installation) => {
            const isEditing = editingInstallationId === installation.installationId
            return (
              <div key={installation.installationId} className="rounded-lg border border-zinc-800 bg-zinc-950 px-4 py-3">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <div className="flex min-w-0 items-center gap-2">
                      <p className="truncate text-sm font-medium text-zinc-100">{installation.accountLogin}</p>
                      <span className="rounded border border-zinc-800 px-1.5 py-0.5 text-[11px] text-zinc-500">{installation.accountType}</span>
                    </div>
                    <p className="mt-1 text-xs text-zinc-500">
                      #{installation.installationId} · {installation.repositorySelection} repositories · {installation.providerHost}
                    </p>
                    <p className="mt-2 text-xs text-zinc-400">
                      Commit identity:{' '}
                      {installation.commitAuthorName && installation.commitAuthorEmail
                        ? `${installation.commitAuthorName} <${installation.commitAuthorEmail}>`
                        : '未设置'}
                    </p>
                  </div>
                  <div className="flex gap-1 self-start sm:self-center">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-zinc-500 hover:bg-zinc-900 hover:text-zinc-100"
                      onClick={() => startEditing(installation)}
                      disabled={busy}
                      aria-label="Edit Git commit identity"
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-zinc-500 hover:bg-zinc-900 hover:text-red-300"
                      onClick={() => void handleDelete(installation.installationId)}
                      disabled={busy}
                      aria-label="Remove GitHub installation"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
                {isEditing ? (
                  <div className="mt-4 grid gap-3 border-t border-zinc-800 pt-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
                    <label className="space-y-1.5">
                      <span className="text-xs font-medium text-zinc-400">Git name</span>
                      <Input value={editingName} onChange={(event) => setEditingName(event.target.value)} placeholder="Alice Dev" disabled={busy} />
                    </label>
                    <label className="space-y-1.5">
                      <span className="text-xs font-medium text-zinc-400">Git email</span>
                      <Input value={editingEmail} onChange={(event) => setEditingEmail(event.target.value)} placeholder="alice@example.com" disabled={busy} />
                    </label>
                    <div className="flex gap-2">
                      <Button type="button" size="sm" onClick={() => void handleSaveIdentity(installation.installationId)} disabled={busy || !isValidIdentity(editingName, editingEmail)}>
                        {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Check className="mr-2 h-4 w-4" />}
                        保存
                      </Button>
                      <Button type="button" variant="outline" size="sm" className="border-zinc-800 bg-zinc-950 text-zinc-200" onClick={() => setEditingInstallationId(null)} disabled={busy}>
                        <X className="mr-2 h-4 w-4" />
                        取消
                      </Button>
                    </div>
                  </div>
                ) : null}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
