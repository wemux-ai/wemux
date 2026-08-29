/**
 * [INPUT]: User Git credential summaries and authenticated credential-management API methods.
 * [OUTPUT]: Git identity creation, verification, editing, default selection, and deletion controls.
 * [POS]: Settings UI for the user-scoped Git identity lifecycle.
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */
import { useEffect, useMemo, useState } from 'react'
import {
  CheckCircle2,
  Copy,
  KeyRound,
  LoaderCircle,
  Pencil,
  Plus,
  ShieldCheck,
  Trash2,
} from 'lucide-react'
import { toast } from 'sonner'
import {
  api,
  type GitCredentialSummary,
  type GitProvider,
  type UserGitPatVerification,
} from '../../lib/api'
import { cn } from '../../lib/utils'
import { Button } from '../ui/button'
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

export type GitCredentialsSettingsSummary = {
  totalCount: number
  patCount: number
  sshCount: number
}

type GitCredentialsSettingsProps = {
  onSummaryChange?: (summary: GitCredentialsSettingsSummary) => void
}

const providerOptions: Array<{ id: ProviderOptionId; provider: GitProvider; label: string; defaultHost: string }> = [
  { id: 'github', provider: 'github', label: 'GitHub', defaultHost: 'github.com' },
  { id: 'gitlab', provider: 'gitlab', label: 'GitLab', defaultHost: 'gitlab.com' },
  { id: 'codeup', provider: 'generic', label: '阿里云云效 Codeup', defaultHost: 'codeup.aliyun.com' },
  { id: 'generic', provider: 'generic', label: 'Generic Git', defaultHost: 'git.example.com' },
]

const createEmptyDraft = (provider: GitProvider = 'github'): CredentialDraft => ({
  label: '',
  provider,
  host: providerOptions.find((item) => item.id === provider)?.defaultHost ?? 'github.com',
  authMode: 'pat',
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

const applyCredentialList = (
  nextCredentials: GitCredentialSummary[],
  selectedCredentialId: string,
  fallbackToNew: () => void,
  setCredentials: (credentials: GitCredentialSummary[]) => void,
  setSelectedCredentialId: (credentialId: string) => void,
) => {
  setCredentials(nextCredentials)
  if (selectedCredentialId && nextCredentials.some((item) => item.id === selectedCredentialId)) {
    setSelectedCredentialId(selectedCredentialId)
    return
  }

  const first = nextCredentials[0]
  if (first) {
    setSelectedCredentialId(first.id)
    return
  }

  fallbackToNew()
}

export function GitCredentialsSettings({ onSummaryChange }: GitCredentialsSettingsProps = {}) {
  const [credentials, setCredentials] = useState<GitCredentialSummary[]>([])
  const [selectedCredentialId, setSelectedCredentialId] = useState('')
  const [draft, setDraft] = useState<CredentialDraft>(createEmptyDraft())
  const [busy, setBusy] = useState(false)
  const [verifying, setVerifying] = useState(false)
  const [verification, setVerification] = useState<UserGitPatVerification | null>(null)

  const selectedCredential = useMemo(
    () => credentials.find((credential) => credential.id === selectedCredentialId) ?? null,
    [credentials, selectedCredentialId],
  )
  const selectedProviderOptionId: ProviderOptionId = draft.provider === 'generic' && draft.host.trim().toLowerCase() === 'codeup.aliyun.com'
    ? 'codeup'
    : draft.provider

  const resetToCreateMode = (provider: GitProvider = 'github') => {
    setSelectedCredentialId('')
    setDraft(createEmptyDraft(provider))
    setVerification(null)
  }

  const loadCredentials = async () => {
    const response = await api.listUserGitCredentials()
    applyCredentialList(response.credentials, selectedCredentialId, resetToCreateMode, setCredentials, setSelectedCredentialId)
  }

  useEffect(() => {
    void loadCredentials().catch((error) => {
      toast.error(error instanceof Error ? error.message : '加载 Git 身份失败')
    })
  }, [])

  useEffect(() => {
    onSummaryChange?.({
      totalCount: credentials.length,
      patCount: credentials.filter((credential) => credential.authMode === 'pat').length,
      sshCount: credentials.filter((credential) => credential.authMode === 'ssh').length,
    })
  }, [credentials, onSummaryChange])

  useEffect(() => {
    if (!selectedCredential) {
      return
    }

    setDraft(toDraft(selectedCredential))
    setVerification(null)
  }, [selectedCredential])

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

  const handleSelectCredential = (credential: GitCredentialSummary) => {
    setSelectedCredentialId(credential.id)
    setDraft(toDraft(credential))
    setVerification(null)
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

  const handleSavePatCredential = async () => {
    const requiresPatToken = !selectedCredential || selectedCredential.authMode !== 'pat'
    if (!draft.label.trim() || !draft.name.trim() || !draft.email.trim() || (requiresPatToken && !draft.patToken.trim())) {
      toast.error(requiresPatToken ? '请补全身份名称、用户名、邮箱和 PAT。' : '请补全身份名称、用户名和邮箱。')
      return
    }

    setBusy(true)
    try {
      if (selectedCredential) {
        const response = await api.updateUserGitCredential(selectedCredential.id, {
          label: draft.label,
          provider: draft.provider,
          host: draft.host,
          authMode: 'pat',
          name: draft.name,
          email: draft.email,
          patToken: draft.patToken.trim() ? draft.patToken : undefined,
          isDefault: draft.isDefault,
        })
        applyCredentialList(response.credentials, selectedCredential.id, resetToCreateMode, setCredentials, setSelectedCredentialId)
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
        applyCredentialList(response.credentials, response.credential?.id ?? '', resetToCreateMode, setCredentials, setSelectedCredentialId)
        toast.success(response.message)
      }
      setVerification(null)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '保存 Git 身份失败')
    } finally {
      setBusy(false)
    }
  }

  const handleSaveSshCredential = async () => {
    if (!draft.label.trim() || !draft.name.trim() || !draft.email.trim()) {
      toast.error('请补全身份名称、用户名和邮箱。')
      return
    }

    setBusy(true)
    try {
      if (selectedCredential?.authMode === 'ssh') {
        const response = await api.updateUserGitCredential(selectedCredential.id, {
          label: draft.label,
          provider: draft.provider,
          host: draft.host,
          authMode: 'ssh',
          name: draft.name,
          email: draft.email,
          isDefault: draft.isDefault,
        })
        applyCredentialList(response.credentials, selectedCredential.id, resetToCreateMode, setCredentials, setSelectedCredentialId)
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
        applyCredentialList(response.credentials, response.credential?.id ?? '', resetToCreateMode, setCredentials, setSelectedCredentialId)
        toast.success(response.message)
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'SSH 身份保存失败')
    } finally {
      setBusy(false)
    }
  }

  const handleSetDefault = async (credentialId: string) => {
    setBusy(true)
    try {
      const response = await api.setUserGitCredentialDefault(credentialId)
      applyCredentialList(response.credentials, credentialId, resetToCreateMode, setCredentials, setSelectedCredentialId)
      toast.success(response.message)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '设置默认身份失败')
    } finally {
      setBusy(false)
    }
  }

  const handleDelete = async (credentialId: string) => {
    setBusy(true)
    try {
      const response = await api.deleteUserGitCredential(credentialId)
      applyCredentialList(response.credentials, '', resetToCreateMode, setCredentials, setSelectedCredentialId)
      toast.success(response.message)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '删除 Git 身份失败')
    } finally {
      setBusy(false)
    }
  }

  const handleVerifySsh = async () => {
    if (!selectedCredential) {
      return
    }

    setBusy(true)
    try {
      const response = await api.verifyUserGitCredentialSsh(selectedCredential.id)
      applyCredentialList(response.credentials, selectedCredential.id, resetToCreateMode, setCredentials, setSelectedCredentialId)
      toast.success(response.message)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'SSH 身份验证失败')
    } finally {
      setBusy(false)
    }
  }

  const handleCopyPublicKey = async () => {
    if (!selectedCredential?.sshPublicKey) {
      return
    }

    try {
      await navigator.clipboard.writeText(selectedCredential.sshPublicKey)
      toast.success('SSH 公钥已复制。')
    } catch {
      toast.error('复制失败，请手动复制。')
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-medium text-zinc-100">Git 身份库</h3>
          <p className="mt-0.5 text-xs text-zinc-500">集中管理 PAT 与 SSH 身份</p>
        </div>
        <Button type="button" size="sm" onClick={() => resetToCreateMode()} className="bg-zinc-100 text-zinc-950 hover:bg-zinc-200">
          <Plus className="mr-1.5 h-3.5 w-3.5" />
          新增
        </Button>
      </div>

      <div className="grid gap-3 xl:grid-cols-[280px_minmax(0,1fr)]">
        <div className="space-y-2">
          {credentials.length === 0 ? (
            <div className="rounded-lg border border-dashed border-zinc-800/90 bg-[#09090b] p-3 text-xs text-zinc-500">
              还没有 Git 身份
            </div>
          ) : null}

          {credentials.map((credential) => (
            <div
              key={credential.id}
              className={cn(
                'rounded-lg border p-2.5 transition',
                selectedCredentialId === credential.id
                  ? 'border-zinc-600 bg-zinc-900'
                  : 'border-zinc-800/90 bg-[#09090b] hover:border-zinc-700',
              )}
            >
              <button
                type="button"
                onClick={() => handleSelectCredential(credential)}
                className="w-full text-left"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm text-zinc-100">{credential.label}</p>
                    <p className="mt-0.5 truncate text-xs text-zinc-500">{credential.name} · {credential.email}</p>
                  </div>
                  {credential.isDefault && (
                    <span className="shrink-0 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2 py-0.5 text-[10px] text-emerald-200">默认</span>
                  )}
                </div>
              </button>

              <div className="mt-2 flex gap-1.5">
                <Button type="button" size="sm" variant="ghost" onClick={() => handleSelectCredential(credential)} className="h-7 text-xs text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100">
                  <Pencil className="mr-1 h-3 w-3" />
                  编辑
                </Button>
                <Button type="button" size="sm" variant="ghost" onClick={() => void handleSetDefault(credential.id)} disabled={busy || credential.isDefault || (credential.authMode === 'ssh' && !credential.activated)} className="h-7 text-xs text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100">
                  <ShieldCheck className="mr-1 h-3 w-3" />
                  默认
                </Button>
                <Button type="button" size="sm" variant="ghost" onClick={() => void handleDelete(credential.id)} disabled={busy} className="h-7 text-xs text-zinc-400 hover:bg-zinc-800 hover:text-rose-200">
                  <Trash2 className="mr-1 h-3 w-3" />
                </Button>
              </div>
            </div>
          ))}
        </div>

        <div className="space-y-3">
          <div className="rounded-xl border border-zinc-800/90 bg-[#09090b] p-3">
            <p className="text-xs font-medium text-zinc-100">{selectedCredential ? '编辑身份' : '新增身份'}</p>
            <div className="mt-2.5 grid gap-2 sm:grid-cols-2">
              <div>
                <p className="mb-1 text-[10px] uppercase tracking-[0.12em] text-zinc-500">身份名称</p>
                <Input value={draft.label} onChange={(e) => setDraft((current) => ({ ...current, label: e.target.value }))} placeholder="例如：公司 GitLab" className="h-8 text-xs" />
              </div>
              <div>
                <p className="mb-1 text-[10px] uppercase tracking-[0.12em] text-zinc-500">平台</p>
                <NativeSelect value={selectedProviderOptionId} onChange={(e) => handleProviderChange(e.target.value as ProviderOptionId)} className="h-8 text-xs">
                  {providerOptions.map((option) => (
                    <option key={option.id} value={option.id}>{option.label}</option>
                  ))}
                </NativeSelect>
              </div>
              <div>
                <p className="mb-1 text-[10px] uppercase tracking-[0.12em] text-zinc-500">Host</p>
                <Input value={draft.host} onChange={(e) => setDraft((current) => ({ ...current, host: e.target.value }))} placeholder="github.com" className="h-8 text-xs" />
              </div>
              <div>
                <p className="mb-1 text-[10px] uppercase tracking-[0.12em] text-zinc-500">认证</p>
                <NativeSelect
                  value={draft.authMode}
                  disabled={Boolean(selectedCredential)}
                  onChange={(e) => setDraft((current) => ({
                    ...current,
                    authMode: e.target.value as AuthMode,
                    isDefault: e.target.value === 'ssh' ? false : current.isDefault,
                  }))}
                  className="h-8 text-xs"
                >
                  <option value="pat">PAT</option>
                  <option value="ssh">SSH</option>
                </NativeSelect>
              </div>
              <div>
                <p className="mb-1 text-[10px] uppercase tracking-[0.12em] text-zinc-500">提交者名称</p>
                <Input value={draft.name} onChange={(e) => setDraft((current) => ({ ...current, name: e.target.value }))} placeholder="Your Name" className="h-8 text-xs" />
              </div>
              <div>
                <p className="mb-1 text-[10px] uppercase tracking-[0.12em] text-zinc-500">邮箱</p>
                <Input value={draft.email} onChange={(e) => setDraft((current) => ({ ...current, email: e.target.value }))} placeholder="you@example.com" className="h-8 text-xs" />
              </div>
            </div>

            <label className="mt-2 flex items-center gap-1.5 text-xs text-zinc-400">
              <input
                type="checkbox"
                checked={draft.isDefault}
                onChange={(e) => setDraft((current) => ({ ...current, isDefault: e.target.checked }))}
                disabled={draft.authMode === 'ssh' && !selectedCredential?.activated}
                className="rounded border-zinc-700 bg-zinc-950"
              />
              设为默认
            </label>
          </div>

          {draft.authMode === 'pat' ? (
            <div className="rounded-xl border border-zinc-800/90 bg-[#09090b] p-3">
              <p className="text-xs font-medium text-zinc-100">PAT 授权</p>
              <div className="mt-2 space-y-2">
                <div>
                  <p className="mb-1 text-[10px] uppercase tracking-[0.12em] text-zinc-500">Token</p>
                  <Input
                    value={draft.patToken}
                    onChange={(e) => {
                      setDraft((current) => ({ ...current, patToken: e.target.value }))
                      setVerification(null)
                    }}
                    placeholder={draft.provider === 'github' ? 'ghp_xxx' : draft.provider === 'gitlab' ? 'glpat-xxx' : '输入 PAT'}
                    type="password"
                    className="h-8 text-xs"
                  />
                </div>

                {verification ? (
                  <div className={cn(
                    'rounded border px-2 py-1.5 text-xs',
                    verification.ok
                      ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-100'
                      : 'border-rose-500/20 bg-rose-500/10 text-rose-100',
                  )}
                  >
                    {verification.message}
                  </div>
                ) : null}

                <div className="flex gap-2">
                  <Button type="button" size="sm" variant="outline" onClick={() => void handlePatVerification()} disabled={busy || verifying || !draft.patToken.trim()} className="h-8 border-zinc-800 bg-zinc-950 text-xs text-zinc-200 hover:bg-zinc-900">
                    {verifying ? <LoaderCircle className="mr-1 h-3 w-3 animate-spin" /> : <KeyRound className="mr-1 h-3 w-3" />}
                    校验
                  </Button>
                  <Button type="button" size="sm" onClick={() => void handleSavePatCredential()} disabled={busy || verifying} className="h-8 bg-zinc-100 text-xs text-zinc-950 hover:bg-zinc-200">
                    {busy ? <LoaderCircle className="mr-1 h-3 w-3 animate-spin" /> : null}
                    保存
                  </Button>
                </div>
              </div>
            </div>
          ) : (
            <div className="rounded-xl border border-zinc-800/90 bg-[#09090b] p-3">
              <p className="text-xs font-medium text-zinc-100">SSH 授权</p>
              <div className="mt-2 space-y-2">
                {!selectedCredential || selectedCredential.authMode !== 'ssh' ? (
                  <Button type="button" size="sm" onClick={() => void handleSaveSshCredential()} disabled={busy} className="h-8 bg-zinc-100 text-xs text-zinc-950 hover:bg-zinc-200">
                    {busy ? <LoaderCircle className="mr-1 h-3 w-3 animate-spin" /> : <ShieldCheck className="mr-1 h-3 w-3" />}
                    生成 SSH 身份
                  </Button>
                ) : (
                  <>
                    <div className="rounded-lg border border-zinc-800/90 bg-zinc-950/70 p-2">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-[10px] uppercase tracking-[0.12em] text-zinc-500">公钥</p>
                        <Button type="button" size="sm" variant="ghost" onClick={() => void handleCopyPublicKey()} className="h-6 text-xs text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100">
                          <Copy className="mr-1 h-3 w-3" />
                          复制
                        </Button>
                      </div>
                      <pre className="mt-2 overflow-x-auto whitespace-pre-wrap break-all text-[11px] leading-4 text-zinc-300">{selectedCredential.sshPublicKey}</pre>
                    </div>
                    <div className="flex gap-2">
                      <Button type="button" size="sm" variant="outline" onClick={() => void handleSaveSshCredential()} disabled={busy} className="h-8 border-zinc-800 bg-zinc-950 text-xs text-zinc-200 hover:bg-zinc-900">
                        <Pencil className="mr-1 h-3 w-3" />
                        保存
                      </Button>
                      {!selectedCredential.activated ? (
                        <Button type="button" size="sm" onClick={() => void handleVerifySsh()} disabled={busy} className="h-8 bg-zinc-100 text-xs text-zinc-950 hover:bg-zinc-200">
                          {busy ? <LoaderCircle className="mr-1 h-3 w-3 animate-spin" /> : <CheckCircle2 className="mr-1 h-3 w-3" />}
                          验证身份
                        </Button>
                      ) : (
                        <span className="inline-flex items-center rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2 py-1 text-xs text-emerald-200">
                          已验证
                        </span>
                      )}
                    </div>
                  </>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
