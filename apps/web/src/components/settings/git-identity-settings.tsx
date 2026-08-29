/**
 * [INPUT]: User Git credential summaries and authenticated credential-management API methods.
 * [OUTPUT]: Git identity creation, verification, editing, default selection, and deletion controls.
 * [POS]: Primary settings UI for the user-scoped Git identity lifecycle.
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */
import { useEffect, useMemo, useState } from 'react'
import {
  CheckCircle2,
  Copy,
  Github,
  KeyRound,
  LoaderCircle,
  Pencil,
  Plus,
  RefreshCw,
  ShieldCheck,
  Terminal,
  Trash2,
} from 'lucide-react'
import { toast } from 'sonner'
import {
  api,
  type GitCredentialSummary,
  type GitHubAppInstallationSummary,
  type GitProvider,
  type UserGitPatVerification,
} from '../../lib/api'
import { cn } from '../../lib/utils'
import { Button } from '../ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../ui/dialog'
import { Input } from '../ui/input'
import { NativeSelect } from '../ui/native-select'

type AuthMode = 'pat' | 'ssh'
type ProviderOptionId = GitProvider | 'codeup'

type CredentialDraft = {
  label: string
  provider: GitProvider
  host: string
  authMode: AuthMode
  name: string
  email: string
  patToken: string
  isDefault: boolean
}

type MethodOption = {
  id: AuthMode | 'github-app'
  title: string
  description: string
  icon: typeof KeyRound
}

const providerOptions: Array<{ id: ProviderOptionId; provider: GitProvider; label: string; defaultHost: string }> = [
  { id: 'github', provider: 'github', label: 'GitHub', defaultHost: 'github.com' },
  { id: 'gitlab', provider: 'gitlab', label: 'GitLab', defaultHost: 'gitlab.com' },
  { id: 'codeup', provider: 'generic', label: '阿里云云效 Codeup', defaultHost: 'codeup.aliyun.com' },
  { id: 'generic', provider: 'generic', label: 'Generic Git', defaultHost: 'git.example.com' },
]

const methodOptions: MethodOption[] = [
  {
    id: 'pat',
    title: 'PAT 身份',
    description: '使用 Personal Access Token 访问 GitHub、GitLab 或通用 Git Host。',
    icon: KeyRound,
  },
  {
    id: 'ssh',
    title: 'SSH 身份',
    description: '生成 SSH Key，复制公钥到 Git 服务后由 Worker 验证身份。',
    icon: Terminal,
  },
  {
    id: 'github-app',
    title: 'GitHub App',
    description: '跳转 GitHub 选择账号、组织和仓库范围，创建 installation。',
    icon: Github,
  },
]

const createEmptyDraft = (authMode: AuthMode = 'pat', provider: GitProvider = 'github'): CredentialDraft => ({
  label: '',
  provider,
  host: providerOptions.find((item) => item.id === provider)?.defaultHost ?? 'github.com',
  authMode,
  name: '',
  email: '',
  patToken: '',
  isDefault: false,
})

const toDraft = (credential: GitCredentialSummary): CredentialDraft => ({
  label: credential.label,
  provider: credential.provider,
  host: credential.host,
  authMode: credential.authMode,
  name: credential.name,
  email: credential.email,
  patToken: '',
  isDefault: credential.isDefault,
})

const resolveProviderLabel = (credential: GitCredentialSummary) => {
  if (credential.provider === 'generic' && credential.host === 'codeup.aliyun.com') {
    return '阿里云云效 Codeup'
  }

  return providerOptions.find((item) => item.id === credential.provider)?.label ?? 'Git'
}

const formatCredentialStatus = (credential: GitCredentialSummary) => {
  if (credential.authMode === 'ssh') {
    return credential.activated ? 'SSH 已验证' : 'SSH 待验证'
  }
  return credential.hasPatToken ? 'PAT 已配置' : 'PAT 待补全'
}

export function GitIdentitySettings() {
  const [credentials, setCredentials] = useState<GitCredentialSummary[]>([])
  const [installations, setInstallations] = useState<GitHubAppInstallationSummary[]>([])
  const [githubAppConfigured, setGithubAppConfigured] = useState(true)
  const [appSlug, setAppSlug] = useState<string | undefined>()
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [verifying, setVerifying] = useState(false)
  const [addOpen, setAddOpen] = useState(false)
  const [credentialDialogOpen, setCredentialDialogOpen] = useState(false)
  const [githubAppIdentityOpen, setGithubAppIdentityOpen] = useState(false)
  const [githubAppIdentityInstallationId, setGithubAppIdentityInstallationId] = useState<number | null>(null)
  const [githubAppCommitName, setGithubAppCommitName] = useState('')
  const [githubAppCommitEmail, setGithubAppCommitEmail] = useState('')
  const [editingCredential, setEditingCredential] = useState<GitCredentialSummary | null>(null)
  const [draft, setDraft] = useState<CredentialDraft>(createEmptyDraft())
  const [verification, setVerification] = useState<UserGitPatVerification | null>(null)
  const selectedProviderOptionId: ProviderOptionId = draft.provider === 'generic' && draft.host.trim().toLowerCase() === 'codeup.aliyun.com'
    ? 'codeup'
    : draft.provider

  const credentialCountLabel = useMemo(() => {
    const patCount = credentials.filter((credential) => credential.authMode === 'pat').length
    const sshCount = credentials.filter((credential) => credential.authMode === 'ssh').length
    return `${patCount} PAT / ${sshCount} SSH`
  }, [credentials])

  const isValidGithubAppIdentity = (name: string, email: string) =>
    Boolean(name.trim() && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()))

  const loadGitIdentities = async () => {
    setLoading(true)
    try {
      const [credentialResponse, githubAppResponse] = await Promise.all([
        api.listUserGitCredentials(),
        api.listUserGitHubAppInstallations(),
      ])
      setCredentials(credentialResponse.credentials)
      setInstallations(githubAppResponse.installations)
      setGithubAppConfigured(githubAppResponse.configured)
      setAppSlug(githubAppResponse.appSlug)
      return githubAppResponse.configured
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadGitIdentities().catch((error) => {
      toast.error(error instanceof Error ? error.message : '加载 Git 身份失败')
    })
  }, [])

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const status = params.get('githubApp')
    const autoConnect = params.get('githubAppConnect') === '1'
    if (status || autoConnect) {
      params.delete('githubApp')
      params.delete('githubAppConnect')
      const nextSearch = params.toString()
      const nextUrl = `${window.location.pathname}${nextSearch ? `?${nextSearch}` : ''}${window.location.hash}`
      window.history.replaceState({}, '', nextUrl)
    }
    if (status === 'connected') {
      toast.success('GitHub 已连接。')
      void loadGitIdentities().catch(() => undefined)
    } else if (status === 'error') {
      toast.error('GitHub 连接没有完成，请重新尝试。')
    } else if (autoConnect) {
      // 从创建项目弹窗跳转过来：等配置信息加载完再弹出绑定浮窗，避免 GitHub App 未配置时误弹。
      void loadGitIdentities()
        .then((configured) => {
          if (configured) {
            openGithubAppIdentityDialog()
          }
        })
        .catch(() => undefined)
    }
  }, [])

  const openAddDialog = () => {
    setEditingCredential(null)
    setDraft(createEmptyDraft())
    setVerification(null)
    setAddOpen(true)
  }

  const openCreateCredential = (authMode: AuthMode) => {
    setEditingCredential(null)
    setDraft(createEmptyDraft(authMode))
    setVerification(null)
    setAddOpen(false)
    setCredentialDialogOpen(true)
  }

  const openEditCredential = (credential: GitCredentialSummary) => {
    setEditingCredential(credential)
    setDraft(toDraft(credential))
    setVerification(null)
    setCredentialDialogOpen(true)
  }

  const handleProviderChange = (optionId: ProviderOptionId) => {
    const option = providerOptions.find((item) => item.id === optionId) ?? providerOptions[0]
    setDraft((current) => {
      const previousDefaultHost = providerOptions.find((item) => item.id === selectedProviderOptionId)?.defaultHost
      return {
        ...current,
        provider: option.provider,
        host: !current.host || current.host === previousDefaultHost ? option.defaultHost : current.host,
      }
    })
    setVerification(null)
  }

  const openGithubAppIdentityDialog = (installation?: GitHubAppInstallationSummary) => {
    setGithubAppIdentityInstallationId(installation?.installationId ?? null)
    setGithubAppCommitName(installation?.commitAuthorName ?? '')
    setGithubAppCommitEmail(installation?.commitAuthorEmail ?? '')
    setAddOpen(false)
    setGithubAppIdentityOpen(true)
  }

  const handleSubmitGithubAppIdentity = async () => {
    if (!isValidGithubAppIdentity(githubAppCommitName, githubAppCommitEmail)) {
      toast.error('请先填写有效的 Git 提交用户名和邮箱')
      return
    }

    setBusy(true)
    try {
      if (githubAppIdentityInstallationId) {
        const response = await api.updateUserGitHubAppCommitIdentity(githubAppIdentityInstallationId, {
          name: githubAppCommitName,
          email: githubAppCommitEmail,
        })
        setInstallations(response.installations)
        setGithubAppIdentityOpen(false)
        toast.success(response.message)
        return
      }

      const returnTo = `${window.location.pathname}${window.location.search}`
      const response = await api.createUserGitHubAppConnectUrl(returnTo, {
        commitAuthorName: githubAppCommitName,
        commitAuthorEmail: githubAppCommitEmail,
      })
      window.location.assign(response.url)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '无法保存 GitHub App 提交身份')
      setBusy(false)
    }
  }

  const handleRefresh = async () => {
    try {
      await loadGitIdentities()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '刷新 Git 身份失败')
    }
  }

  const handlePatVerification = async () => {
    if (!draft.patToken.trim()) {
      toast.error('请先输入 PAT。')
      return
    }
    setVerifying(true)
    try {
      const result = await api.verifyUserGitCredentialPat({
        provider: draft.provider,
        host: draft.host,
        patToken: draft.patToken,
      })
      setVerification(result)
      toast.success(result.message)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'PAT 校验失败'
      setVerification({ ok: false, message })
      toast.error(message)
    } finally {
      setVerifying(false)
    }
  }

  const handleSaveCredential = async () => {
    const requiresPatToken = draft.authMode === 'pat' && (!editingCredential || editingCredential.authMode !== 'pat')
    if (!draft.label.trim() || !draft.name.trim() || !draft.email.trim() || (requiresPatToken && !draft.patToken.trim())) {
      toast.error(requiresPatToken ? '请补全身份名称、用户名、邮箱和 PAT。' : '请补全身份名称、用户名和邮箱。')
      return
    }

    setBusy(true)
    try {
      if (draft.authMode === 'pat') {
        if (editingCredential) {
          const response = await api.updateUserGitCredential(editingCredential.id, {
            label: draft.label,
            provider: draft.provider,
            host: draft.host,
            authMode: 'pat',
            name: draft.name,
            email: draft.email,
            patToken: draft.patToken.trim() ? draft.patToken : undefined,
            isDefault: draft.isDefault,
          })
          setCredentials(response.credentials)
          toast.success(response.message)
        } else {
          const response = await api.createUserGitCredential({
            label: draft.label,
            provider: draft.provider,
            host: draft.host,
            authMode: 'pat',
            name: draft.name,
            email: draft.email,
            patToken: draft.patToken,
            isDefault: draft.isDefault,
          })
          setCredentials(response.credentials)
          toast.success(response.message)
        }
      } else if (editingCredential?.authMode === 'ssh') {
        const response = await api.updateUserGitCredential(editingCredential.id, {
          label: draft.label,
          provider: draft.provider,
          host: draft.host,
          authMode: 'ssh',
          name: draft.name,
          email: draft.email,
          isDefault: draft.isDefault,
        })
        setCredentials(response.credentials)
        toast.success(response.message)
      } else {
        const response = await api.generateUserGitCredentialSsh({
          label: draft.label,
          provider: draft.provider,
          host: draft.host,
          name: draft.name,
          email: draft.email,
          isDefault: draft.isDefault,
        })
        setCredentials(response.credentials)
        toast.success(response.message)
        if (!response.credential) {
          throw new Error('SSH 身份已生成，但无法读取已保存的公钥。')
        }
        setEditingCredential(response.credential)
        setDraft(toDraft(response.credential))
        setVerification(null)
        return
      }
      setVerification(null)
      setCredentialDialogOpen(false)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '保存 Git 身份失败')
    } finally {
      setBusy(false)
    }
  }

  const handleSetDefault = async (credential: GitCredentialSummary) => {
    setBusy(true)
    try {
      const response = await api.setUserGitCredentialDefault(credential.id)
      setCredentials(response.credentials)
      toast.success(response.message)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '设置默认身份失败')
    } finally {
      setBusy(false)
    }
  }

  const handleDeleteCredential = async (credential: GitCredentialSummary) => {
    setBusy(true)
    try {
      const response = await api.deleteUserGitCredential(credential.id)
      setCredentials(response.credentials)
      toast.success(response.message)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '删除 Git 身份失败')
    } finally {
      setBusy(false)
    }
  }

  const handleDeleteInstallation = async (installation: GitHubAppInstallationSummary) => {
    setBusy(true)
    try {
      const response = await api.deleteUserGitHubAppInstallation(installation.installationId)
      setInstallations(response.installations)
      toast.success(response.message)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '移除 GitHub 连接失败')
    } finally {
      setBusy(false)
    }
  }

  const handleVerifySsh = async () => {
    if (!editingCredential) {
      return
    }
    setBusy(true)
    try {
      const response = await api.verifyUserGitCredentialSsh(editingCredential.id)
      setCredentials(response.credentials)
      const updated = response.credentials.find((credential) => credential.id === editingCredential.id)
      if (updated) {
        setEditingCredential(updated)
        setDraft(toDraft(updated))
      }
      toast.success(response.message)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'SSH 身份验证失败')
    } finally {
      setBusy(false)
    }
  }

  const handleCopyPublicKey = async () => {
    if (!editingCredential?.sshPublicKey) {
      return
    }
    try {
      await navigator.clipboard.writeText(editingCredential.sshPublicKey)
      toast.success('SSH 公钥已复制。')
    } catch {
      toast.error('复制失败，请手动复制。')
    }
  }

  const hasAnyIdentity = credentials.length > 0 || installations.length > 0

  return (
    <>
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-3 border border-zinc-800 bg-[#09090b] px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <p className="text-sm font-medium text-zinc-100">Git 身份</p>
            <p className="mt-1 text-xs text-zinc-500">当前已保存 {credentialCountLabel}，{installations.length} 个 GitHub App installation。</p>
          </div>
          <div className="flex items-center gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => void handleRefresh()} disabled={loading || busy} className="h-8 border-zinc-800 bg-zinc-950 text-xs text-zinc-200 hover:bg-zinc-900">
              {loading ? <LoaderCircle className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="mr-1.5 h-3.5 w-3.5" />}
              刷新
            </Button>
            <Button type="button" size="sm" onClick={openAddDialog} className="h-8 bg-zinc-100 text-xs text-zinc-950 hover:bg-zinc-200">
              <Plus className="mr-1.5 h-3.5 w-3.5" />
              新增
            </Button>
          </div>
        </div>

        {!hasAnyIdentity ? (
          <div className="rounded-lg border border-dashed border-zinc-800 bg-zinc-950/70 px-4 py-8 text-center">
            <p className="text-sm font-medium text-zinc-200">还没有 Git 身份</p>
            <p className="mt-1 text-xs text-zinc-500">点击新增后选择 PAT、SSH 或 GitHub App。</p>
          </div>
        ) : null}

        {credentials.length > 0 ? (
          <div className="flex flex-col gap-2">
            {credentials.map((credential) => (
              <div key={credential.id} className="flex flex-col gap-3 rounded-lg border border-zinc-800 bg-[#09090b] px-3 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex min-w-0 items-start gap-3">
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-md border border-zinc-800 bg-zinc-950 text-zinc-400">
                    {credential.authMode === 'pat' ? <KeyRound className="h-4 w-4" /> : <Terminal className="h-4 w-4" />}
                  </span>
                  <div className="min-w-0">
                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                      <p className="truncate text-sm font-medium text-zinc-100">{credential.label}</p>
                      {credential.isDefault ? (
                        <span className="rounded border border-emerald-500/30 bg-emerald-500/10 px-1.5 py-0.5 text-[11px] text-emerald-300">默认</span>
                      ) : null}
                      <span className="rounded border border-zinc-700 bg-zinc-900 px-1.5 py-0.5 text-[11px] text-zinc-300">{formatCredentialStatus(credential)}</span>
                    </div>
                    <p className="mt-1 truncate text-xs text-zinc-500">
                      {resolveProviderLabel(credential)} · {credential.host} · {credential.name} · {credential.email}
                    </p>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  <Button type="button" size="sm" variant="ghost" onClick={() => openEditCredential(credential)} className="h-7 text-xs text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100">
                    <Pencil className="mr-1 h-3.5 w-3.5" />
                    编辑
                  </Button>
                  <Button type="button" size="sm" variant="ghost" onClick={() => void handleSetDefault(credential)} disabled={busy || credential.isDefault || (credential.authMode === 'ssh' && !credential.activated)} className="h-7 text-xs text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100">
                    <ShieldCheck className="mr-1 h-3.5 w-3.5" />
                    默认
                  </Button>
                  <Button type="button" size="icon" variant="ghost" onClick={() => void handleDeleteCredential(credential)} disabled={busy} className="h-7 w-7 text-zinc-500 hover:bg-zinc-900 hover:text-rose-300" aria-label="删除 Git 身份">
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        ) : null}

        {installations.length > 0 ? (
          <div className="flex flex-col gap-2">
            {installations.map((installation) => (
              <div key={installation.installationId} className="flex flex-col gap-3 rounded-lg border border-zinc-800 bg-[#09090b] px-3 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex min-w-0 items-start gap-3">
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-md border border-zinc-800 bg-zinc-950 text-zinc-400">
                    <Github className="h-4 w-4" />
                  </span>
                  <div className="min-w-0">
                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                      <p className="truncate text-sm font-medium text-zinc-100">{installation.accountLogin}</p>
                      <span className="rounded border border-zinc-700 bg-zinc-900 px-1.5 py-0.5 text-[11px] text-zinc-300">{installation.accountType}</span>
                      <span className="rounded border border-zinc-700 bg-zinc-900 px-1.5 py-0.5 text-[11px] text-zinc-300">GitHub App</span>
                    </div>
                    <p className="mt-1 truncate text-xs text-zinc-500">
                      #{installation.installationId} · {installation.repositorySelection} repositories · {installation.providerHost}
                    </p>
                    <p className="mt-1 truncate text-xs text-zinc-500">
                      Commit identity · {installation.commitAuthorName && installation.commitAuthorEmail ? `${installation.commitAuthorName} <${installation.commitAuthorEmail}>` : '未设置'}
                    </p>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1.5 self-start sm:self-center">
                  <Button type="button" size="sm" variant="ghost" onClick={() => openGithubAppIdentityDialog(installation)} disabled={busy} className="h-7 text-xs text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100">
                    <Pencil className="mr-1 h-3.5 w-3.5" />
                    编辑
                  </Button>
                  <Button type="button" size="icon" variant="ghost" onClick={() => void handleDeleteInstallation(installation)} disabled={busy} className="h-7 w-7 text-zinc-500 hover:bg-zinc-900 hover:text-rose-300" aria-label="移除 GitHub installation">
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        ) : null}
      </div>

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="border-zinc-800 bg-[#09090b] p-0 text-zinc-100 sm:max-w-[620px]">
          <DialogHeader>
            <DialogTitle className="text-sm">新增 Git 身份</DialogTitle>
            <DialogDescription className="text-xs text-zinc-500">选择一种访问方式后进入对应配置。</DialogDescription>
          </DialogHeader>
          <div className="grid gap-2 p-3">
            {methodOptions.map((method) => {
              const Icon = method.icon
              return (
                <button
                  key={method.id}
                  type="button"
                  onClick={() => {
                    if (method.id === 'github-app') {
                      openGithubAppIdentityDialog()
                      return
                    }
                    openCreateCredential(method.id)
                  }}
                  disabled={busy || (method.id === 'github-app' && !githubAppConfigured)}
                  className="flex items-start gap-3 rounded-lg border border-zinc-800 bg-zinc-950/70 px-3 py-3 text-left transition hover:border-zinc-700 hover:bg-zinc-900/60 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-md border border-zinc-800 bg-[#09090b] text-zinc-300">
                    <Icon className="h-4 w-4" />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm font-medium text-zinc-100">{method.title}</span>
                    <span className="mt-1 block text-xs leading-5 text-zinc-500">
                      {method.id === 'github-app' && !githubAppConfigured
                        ? 'GitHub App 尚未配置，需要先设置 server 环境变量。'
                        : method.description}
                    </span>
                  </span>
                </button>
              )
            })}
          </div>
          {appSlug ? (
            <div className="border-t border-zinc-800 px-4 py-2 text-xs text-zinc-500">GitHub App: {appSlug}</div>
          ) : null}
        </DialogContent>
      </Dialog>

      <Dialog open={githubAppIdentityOpen} onOpenChange={setGithubAppIdentityOpen}>
        <DialogContent className="border-zinc-800 bg-[#09090b] text-zinc-100 sm:max-w-[520px]">
          <DialogHeader>
            <DialogTitle>{githubAppIdentityInstallationId ? '编辑 GitHub App 提交身份' : '连接前设置 Git 提交身份'}</DialogTitle>
            <DialogDescription className="text-zinc-500">
              GitHub App 负责仓库授权；下面的 name/email 会写入 agent 创建的 commit。
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 px-5 py-4">
            <label className="space-y-1.5">
              <span className="text-xs font-medium text-zinc-400">Git name</span>
              <Input value={githubAppCommitName} onChange={(event) => setGithubAppCommitName(event.target.value)} placeholder="Alice Dev" disabled={busy} />
            </label>
            <label className="space-y-1.5">
              <span className="text-xs font-medium text-zinc-400">Git email</span>
              <Input value={githubAppCommitEmail} onChange={(event) => setGithubAppCommitEmail(event.target.value)} placeholder="alice@example.com" disabled={busy} />
            </label>
            <p className="text-xs text-zinc-500">建议填写 GitHub 已验证邮箱或 GitHub noreply 邮箱。</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setGithubAppIdentityOpen(false)} className="border-zinc-800 bg-zinc-950 text-zinc-200 hover:bg-zinc-900 hover:text-zinc-50">
              取消
            </Button>
            <Button onClick={() => void handleSubmitGithubAppIdentity()} disabled={busy || !isValidGithubAppIdentity(githubAppCommitName, githubAppCommitEmail)}>
              {busy ? '保存中...' : githubAppIdentityInstallationId ? '保存' : '继续连接 GitHub'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={credentialDialogOpen} onOpenChange={setCredentialDialogOpen}>
        <DialogContent className="max-h-[86vh] overflow-auto border-zinc-800 bg-[#09090b] p-0 text-zinc-100 sm:max-w-[760px]">
          <DialogHeader>
            <DialogTitle className="text-sm">{editingCredential ? '编辑 Git 身份' : `新增 ${draft.authMode === 'pat' ? 'PAT' : 'SSH'} 身份`}</DialogTitle>
            <DialogDescription className="text-xs text-zinc-500">配置会保存为当前用户的 Git 身份，可在项目绑定时选择。</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 p-4 sm:grid-cols-2">
            <div>
              <p className="mb-1 text-[10px] uppercase tracking-[0.12em] text-zinc-500">身份名称</p>
              <Input value={draft.label} onChange={(e) => setDraft((current) => ({ ...current, label: e.target.value }))} placeholder="例如：公司 GitLab" className="h-8 border-zinc-800 bg-zinc-950 text-xs text-zinc-100" />
            </div>
            <div>
              <p className="mb-1 text-[10px] uppercase tracking-[0.12em] text-zinc-500">平台</p>
              <NativeSelect value={selectedProviderOptionId} onChange={(e) => handleProviderChange(e.target.value as ProviderOptionId)} className="h-8 border-zinc-800 bg-zinc-950 text-xs text-zinc-100">
                {providerOptions.map((option) => (
                  <option key={option.id} value={option.id}>{option.label}</option>
                ))}
              </NativeSelect>
            </div>
            <div>
              <p className="mb-1 text-[10px] uppercase tracking-[0.12em] text-zinc-500">Host</p>
              <Input value={draft.host} onChange={(e) => setDraft((current) => ({ ...current, host: e.target.value }))} placeholder="github.com" className="h-8 border-zinc-800 bg-zinc-950 text-xs text-zinc-100" />
            </div>
            <div>
              <p className="mb-1 text-[10px] uppercase tracking-[0.12em] text-zinc-500">认证</p>
              <Input value={draft.authMode.toUpperCase()} disabled className="h-8 border-zinc-800 bg-zinc-950 text-xs text-zinc-500" />
            </div>
            <div>
              <p className="mb-1 text-[10px] uppercase tracking-[0.12em] text-zinc-500">提交者名称</p>
              <Input value={draft.name} onChange={(e) => setDraft((current) => ({ ...current, name: e.target.value }))} placeholder="Your Name" className="h-8 border-zinc-800 bg-zinc-950 text-xs text-zinc-100" />
            </div>
            <div>
              <p className="mb-1 text-[10px] uppercase tracking-[0.12em] text-zinc-500">邮箱</p>
              <Input value={draft.email} onChange={(e) => setDraft((current) => ({ ...current, email: e.target.value }))} placeholder="you@example.com" className="h-8 border-zinc-800 bg-zinc-950 text-xs text-zinc-100" />
            </div>
            <label className="flex items-center gap-1.5 text-xs text-zinc-400 sm:col-span-2">
              <input
                type="checkbox"
                checked={draft.isDefault}
                onChange={(e) => setDraft((current) => ({ ...current, isDefault: e.target.checked }))}
                disabled={draft.authMode === 'ssh' && !editingCredential?.activated}
                className="rounded border-zinc-700 bg-zinc-950"
              />
              设为默认
            </label>
          </div>

          {draft.authMode === 'pat' ? (
            <div className="border-t border-zinc-800 px-4 py-3">
              <p className="text-xs font-medium text-zinc-100">PAT 授权</p>
              <p className="mb-1 mt-3 text-[10px] uppercase tracking-[0.12em] text-zinc-500">Token</p>
              <Input
                value={draft.patToken}
                onChange={(e) => {
                  setDraft((current) => ({ ...current, patToken: e.target.value }))
                  setVerification(null)
                }}
                placeholder={draft.provider === 'github' ? 'ghp_xxx' : draft.provider === 'gitlab' ? 'glpat-xxx' : '输入 PAT'}
                type="password"
                className="h-8 border-zinc-800 bg-zinc-950 text-xs text-zinc-100"
              />
              {verification ? (
                <div className={cn(
                  'mt-2 rounded border px-2 py-1.5 text-xs',
                  verification.ok
                    ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-100'
                    : 'border-rose-500/20 bg-rose-500/10 text-rose-100',
                )}
                >
                  {verification.message}
                </div>
              ) : null}
            </div>
          ) : null}

          {draft.authMode === 'ssh' && editingCredential?.authMode === 'ssh' && editingCredential.sshPublicKey ? (
            <div className="border-t border-zinc-800 px-4 py-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-medium text-zinc-100">SSH 公钥</p>
                <Button type="button" size="sm" variant="ghost" onClick={() => void handleCopyPublicKey()} className="h-7 text-xs text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100">
                  <Copy className="mr-1 h-3.5 w-3.5" />
                  复制
                </Button>
              </div>
              <pre className="mt-2 max-h-28 overflow-auto whitespace-pre-wrap break-all rounded-lg border border-zinc-800 bg-zinc-950/70 p-2 text-[11px] leading-4 text-zinc-300">{editingCredential.sshPublicKey}</pre>
            </div>
          ) : null}

          <DialogFooter className="border-t border-zinc-800 px-4 py-3">
            {draft.authMode === 'pat' ? (
              <Button type="button" size="sm" variant="outline" onClick={() => void handlePatVerification()} disabled={busy || verifying || !draft.patToken.trim()} className="h-8 border-zinc-800 bg-zinc-950 text-xs text-zinc-200 hover:bg-zinc-900">
                {verifying ? <LoaderCircle className="mr-1 h-3.5 w-3.5 animate-spin" /> : <KeyRound className="mr-1 h-3.5 w-3.5" />}
                校验
              </Button>
            ) : null}
            {draft.authMode === 'ssh' && editingCredential?.authMode === 'ssh' && !editingCredential.activated ? (
              <Button type="button" size="sm" variant="outline" onClick={() => void handleVerifySsh()} disabled={busy} className="h-8 border-zinc-800 bg-zinc-950 text-xs text-zinc-200 hover:bg-zinc-900">
                <CheckCircle2 className="mr-1 h-3.5 w-3.5" />
                验证身份
              </Button>
            ) : null}
            <Button type="button" size="sm" onClick={() => void handleSaveCredential()} disabled={busy || verifying} className="h-8 bg-zinc-100 text-xs text-zinc-950 hover:bg-zinc-200">
              {busy ? <LoaderCircle className="mr-1 h-3.5 w-3.5 animate-spin" /> : null}
              保存
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
