import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { ExternalLink, GitFork, Github, Link, Loader2, Plus } from 'lucide-react'
import { MANAGED_CLOUD_AUTO_EXECUTOR_ID } from '@shared/managed-cloud'
import type { ExecutorRecord } from '@shared/types'
import { toast } from 'sonner'
import { api, type CollaborationWorkspace, type GitCredentialSummary, type GitHubAppInstallationSummary, type GitHubAppRepositorySummary, type ManagedCloudRuntimeStatus } from '../../lib/api'
import { useApp } from '../../lib/app-provider'
import { buildExecutorOptionsWithManagedCloud } from '../../lib/managed-cloud-executor'
import { isManagedCloudDevOnlyEnabled } from '../../lib/runtime-config'
import { ProjectColorField } from '../project-color-field'
import { Button } from '../ui/button'
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog'
import { ExecutorSelect } from '../ui/executor-select'
import { Input } from '../ui/input'
import { NativeSelect } from '../ui/native-select'
import { SearchableSelect } from '../ui/searchable-select'

interface CreateProjectModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  mode?: 'create' | 'clone'
  initialCloneSource?: 'github-app' | 'manual'
  defaultWorkspaceId?: string
  preferredExecutorId?: string
  workspaces?: CollaborationWorkspace[]
  flow?: 'default' | 'onboarding'
}

type CreateProjectDraft = {
  name: string
  color: string
  gitUrl: string
  cloneSource: 'github-app' | 'manual'
  preferredExecutorId: string
  gitBindingMode: 'credential' | 'github-app' | 'none'
  gitCredentialId: string
  githubInstallationId: string
  githubRepositoryId: string
  githubRepositoryName: string
  visibility: 'private' | 'workspace'
  workspaceId: string
}

const EMPTY_DRAFT: CreateProjectDraft = {
  name: '',
  color: '',
  gitUrl: '',
  cloneSource: 'manual',
  preferredExecutorId: '',
  gitBindingMode: 'none',
  gitCredentialId: '',
  githubInstallationId: '',
  githubRepositoryId: '',
  githubRepositoryName: '',
  visibility: 'private',
  workspaceId: '',
}

const getManagedCloudBoxRuntimeLabel = (runtime: ManagedCloudRuntimeStatus | null | undefined) => (
  runtime?.providerName === 'ascii-box-cli' || runtime?.providerName === 'ascii-box-sdk' ? 'ASCII Box' : 'BoxLite'
)

const isManagedCloudBoxRuntime = (runtime: ManagedCloudRuntimeStatus | null | undefined) => (
  runtime?.providerName === 'boxlite-cli' || runtime?.providerName === 'ascii-box-cli' || runtime?.providerName === 'ascii-box-sdk'
)

const getManagedCloudExecutorDescription = (
  executor: ExecutorRecord,
  runtime: ManagedCloudRuntimeStatus | null,
) => {
  if (executor.executorId !== MANAGED_CLOUD_AUTO_EXECUTOR_ID) {
    return executor.machineName
  }

  if (runtime?.isolationMode !== 'container') {
    return executor.machineName
  }

  const boxRuntimeLabel = getManagedCloudBoxRuntimeLabel(runtime)
  if (runtime.poolSize > 1) {
    return isManagedCloudBoxRuntime(runtime)
      ? `官方托管 ${boxRuntimeLabel} 池，首次使用时自动分配宿主`
      : '官方托管 Docker 池，首次使用时自动分配宿主'
  }

  if (runtime.hostMode === 'remote-docker-host') {
    return '官方托管远程 Docker 节点，首次使用时自动开通'
  }
  if (runtime.hostMode === 'remote-cloudflare-sandbox') {
    return '官方托管 Cloudflare Sandbox 节点，首次使用时自动开通'
  }
  if (runtime.hostMode === 'remote-boxlite-host') {
    return `官方托管 ${boxRuntimeLabel} 节点，首次使用时自动开通`
  }

  return isManagedCloudBoxRuntime(runtime)
    ? `官方托管 ${boxRuntimeLabel} 节点，但当前仍落在控制面宿主机上`
    : '官方托管 Docker 节点，但当前仍落在控制面宿主机上'
}

const getManagedCloudExecutorBadgeLabel = (
  executor: ExecutorRecord,
  runtime: ManagedCloudRuntimeStatus | null,
) => {
  if (executor.executorId !== MANAGED_CLOUD_AUTO_EXECUTOR_ID) {
    return undefined
  }

  if (runtime?.isolationMode !== 'container') {
    return '官方托管'
  }

  const boxRuntimeLabel = getManagedCloudBoxRuntimeLabel(runtime)
  if (runtime.poolSize > 1) {
    return isManagedCloudBoxRuntime(runtime) ? `${boxRuntimeLabel} 池` : 'Docker 池'
  }
  if (runtime.hostMode === 'remote-docker-host') {
    return 'Docker'
  }
  if (runtime.hostMode === 'remote-boxlite-host') {
    return boxRuntimeLabel
  }

  return isManagedCloudBoxRuntime(runtime) ? `本机 ${boxRuntimeLabel}` : '本机 Docker'
}

const resolveRepoHost = (gitUrl?: string) => {
  const trimmed = gitUrl?.trim() || ''
  if (!trimmed) {
    return ''
  }

  const sshMatch = /^(?:ssh:\/\/)?git@([^/:]+)(?::|\/)/i.exec(trimmed)
  if (sshMatch?.[1]) {
    return sshMatch[1].toLowerCase()
  }

  try {
    return new URL(trimmed).hostname.toLowerCase()
  } catch {
    return ''
  }
}

const normalizeHost = (host: string) => host.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/+$/, '')

const extractProjectNameFromGitUrl = (gitUrl: string): string => {
  const trimmed = gitUrl.trim()
  if (!trimmed) return ''

  const repoMatch = /[\/:]([^\/]+?)(?:\.git)?$/i.exec(trimmed)
  return repoMatch?.[1] ?? ''
}

export function CreateProjectModal({
  open,
  onOpenChange,
  mode: initialMode = 'create',
  initialCloneSource = 'github-app',
  defaultWorkspaceId = '',
  preferredExecutorId = '',
  workspaces = [],
  flow = 'default',
}: CreateProjectModalProps) {
  const { busy, runMutation } = useApp()
  const navigate = useNavigate()
  const [mode, setMode] = useState<'create' | 'clone'>(initialMode)
  const [draft, setDraft] = useState(EMPTY_DRAFT)
  const [isCloning, setIsCloning] = useState(false)
  const [executors, setExecutors] = useState<ExecutorRecord[]>([])
  const [credentials, setCredentials] = useState<GitCredentialSummary[]>([])
  const [githubAppInstallations, setGitHubAppInstallations] = useState<GitHubAppInstallationSummary[]>([])
  const [githubAppConfigured, setGitHubAppConfigured] = useState(true)
  const [githubRepositories, setGitHubRepositories] = useState<GitHubAppRepositorySummary[]>([])
  const [githubRepositoriesLoading, setGitHubRepositoriesLoading] = useState(false)
  const [githubRepositoriesScope, setGitHubRepositoriesScope] = useState<'all' | 'installation'>('installation')
  const [githubOAuthAuthorized, setGitHubOAuthAuthorized] = useState(false)
  const [managedCloudRuntime, setManagedCloudRuntime] = useState<ManagedCloudRuntimeStatus | null>(null)
  const [autoFilledNameFromUrl, setAutoFilledNameFromUrl] = useState('')

  const executorOptions = useMemo(
    () => buildExecutorOptionsWithManagedCloud(executors, managedCloudRuntime),
    [executors, managedCloudRuntime],
  )
  const credentialRepoHost = useMemo(() => resolveRepoHost(draft.gitUrl), [draft.gitUrl])
  const filteredCredentials = useMemo(() => {
    if (!credentialRepoHost) {
      return credentials
    }

    return credentials.filter((credential) => (
      normalizeHost(credential.host) === normalizeHost(credentialRepoHost)
      || credential.id === draft.gitCredentialId
    ))
  }, [credentialRepoHost, credentials, draft.gitCredentialId])

  const hasWorkspaceChoices = workspaces.length > 0
  const currentWorkspace = useMemo(
    () => workspaces.find((workspace) => workspace.id === (draft.workspaceId || defaultWorkspaceId)) ?? null,
    [defaultWorkspaceId, draft.workspaceId, workspaces],
  )
  const selectedGitHubRepository = useMemo(
    () => githubRepositories.find((repository) => String(repository.id) === draft.githubRepositoryId) ?? null,
    [draft.githubRepositoryId, githubRepositories],
  )
  const githubRepositoryOptions = useMemo(
    () => githubRepositories.map((repository) => ({
      value: String(repository.id),
      label: repository.fullName,
      description: `${repository.defaultBranch ?? 'default branch'} · ${repository.archived ? 'archived' : repository.private ? 'private' : 'public'}`,
      badgeLabel: repository.private ? 'Private' : 'Public',
      keywords: [repository.name, repository.ownerLogin, repository.defaultBranch, repository.cloneUrl],
      disabled: repository.disabled,
    })),
    [githubRepositories],
  )
  useEffect(() => {
    if (!open) {
      return
    }

    void api.listExecutors().then((response) => setExecutors(response.executors)).catch(() => setExecutors([]))
    void api.listUserGitCredentials().then((response) => setCredentials(response.credentials)).catch(() => setCredentials([]))
    void api.listUserGitHubAppInstallations()
      .then((response) => {
        setGitHubAppConfigured(response.configured)
        setGitHubAppInstallations(response.installations)
        setDraft((current) => {
          if (initialMode !== 'clone' || current.cloneSource !== 'github-app' || current.githubInstallationId || response.installations.length !== 1) {
            return current
          }
          return {
            ...current,
            gitBindingMode: 'github-app',
            githubInstallationId: String(response.installations[0].installationId),
          }
        })
      })
      .catch(() => {
        setGitHubAppConfigured(true)
        setGitHubAppInstallations([])
      })
    if (isManagedCloudDevOnlyEnabled()) {
      void api.getManagedCloudRuntime().then((response) => setManagedCloudRuntime(response.runtime)).catch(() => setManagedCloudRuntime(null))
    } else {
      setManagedCloudRuntime(null)
    }
  }, [open])

  useEffect(() => {
    if (!open) {
      setMode(initialMode)
      setDraft({
        ...EMPTY_DRAFT,
        cloneSource: initialMode === 'clone' ? initialCloneSource : 'manual',
        gitBindingMode: initialMode === 'clone' && initialCloneSource === 'github-app' ? 'github-app' : 'none',
        preferredExecutorId: preferredExecutorId.trim(),
        workspaceId: defaultWorkspaceId.trim(),
        visibility: 'private',
      })
      setManagedCloudRuntime(null)
      setGitHubRepositories([])
      setGitHubRepositoriesLoading(false)
      setGitHubRepositoriesScope('installation')
      setGitHubOAuthAuthorized(false)
      setAutoFilledNameFromUrl('')
      return
    }

    setMode(initialMode)
    setDraft((current) => ({
      ...current,
      cloneSource: initialMode === 'clone' && !current.gitUrl.trim() ? initialCloneSource : current.cloneSource,
      gitBindingMode: initialMode === 'clone' && !current.gitUrl.trim()
        ? (initialCloneSource === 'github-app' ? 'github-app' : 'none')
        : current.gitBindingMode,
      preferredExecutorId: current.preferredExecutorId || preferredExecutorId.trim(),
      workspaceId: current.workspaceId || defaultWorkspaceId.trim(),
      visibility: current.visibility,
    }))
    setAutoFilledNameFromUrl('')
  }, [defaultWorkspaceId, initialCloneSource, initialMode, open, preferredExecutorId])

  useEffect(() => {
    if (!open || mode !== 'clone' || draft.cloneSource !== 'github-app') {
      setGitHubRepositories([])
      setGitHubRepositoriesLoading(false)
      return
    }

    let active = true
    setGitHubRepositoriesLoading(true)
    void api.listUserGitHubAppRepositories()
      .then((response) => {
        if (!active) return
        setGitHubOAuthAuthorized(true)
        setGitHubRepositoriesScope('all')
        setGitHubRepositories(response.repositories)
        setDraft((current) => {
          if (!current.githubRepositoryId) {
            return current
          }
          const repository = response.repositories.find((item) => String(item.id) === current.githubRepositoryId)
          if (!repository) {
            return { ...current, githubRepositoryId: '', githubRepositoryName: '', githubInstallationId: '' }
          }
          return {
            ...current,
            githubInstallationId: repository.installationId ? String(repository.installationId) : current.githubInstallationId,
          }
        })
      })
      .catch(() => {
        // 未授权 OAuth 账号时回退到「按安装列出仓库」的旧流程
        if (!active) return
        setGitHubOAuthAuthorized(false)
        setGitHubRepositoriesScope('installation')
        setGitHubRepositories([])
      })
      .finally(() => {
        if (active) {
          setGitHubRepositoriesLoading(false)
        }
      })

    return () => {
      active = false
    }
  }, [draft.cloneSource, mode, open])

  useEffect(() => {
    if (!open || mode !== 'clone' || draft.cloneSource !== 'github-app' || githubRepositoriesScope !== 'installation') {
      return
    }

    const installationId = Number(draft.githubInstallationId || '0')
    if (!Number.isFinite(installationId) || installationId < 1) {
      setGitHubRepositories([])
      setGitHubRepositoriesLoading(false)
      return
    }

    let active = true
    setGitHubRepositoriesLoading(true)
    void api.listUserGitHubAppInstallationRepositories(installationId)
      .then((response) => {
        if (!active) return
        setGitHubRepositories(response.repositories)
        setDraft((current) => {
          if (current.githubInstallationId !== String(installationId) || !current.githubRepositoryId) {
            return current
          }
          const stillAvailable = response.repositories.some((repository) => String(repository.id) === current.githubRepositoryId)
          return stillAvailable ? current : { ...current, githubRepositoryId: '', githubRepositoryName: '' }
        })
      })
      .catch((error) => {
        if (!active) return
        setGitHubRepositories([])
        toast.error(error instanceof Error ? error.message : '读取 GitHub 仓库列表失败')
      })
      .finally(() => {
        if (active) {
          setGitHubRepositoriesLoading(false)
        }
      })

    return () => {
      active = false
    }
  }, [draft.cloneSource, draft.githubInstallationId, githubRepositoriesScope, mode, open])

  useEffect(() => {
    if (draft.preferredExecutorId !== MANAGED_CLOUD_AUTO_EXECUTOR_ID) {
      return
    }

    const virtualManagedCloudVisible = executorOptions.some((executor) => executor.executorId === MANAGED_CLOUD_AUTO_EXECUTOR_ID)
    if (virtualManagedCloudVisible) {
      return
    }

    setDraft((current) => (
      current.preferredExecutorId === MANAGED_CLOUD_AUTO_EXECUTOR_ID
        ? { ...current, preferredExecutorId: '' }
        : current
    ))
  }, [draft.preferredExecutorId, executorOptions])

  useEffect(() => {
    if (mode !== 'clone') {
      return
    }
    const extracted = extractProjectNameFromGitUrl(draft.gitUrl)
    if (!extracted) {
      return
    }
    if (draft.name && draft.name !== autoFilledNameFromUrl) {
      return
    }
    setDraft((current) => ({ ...current, name: extracted }))
    setAutoFilledNameFromUrl(extracted)
  }, [mode, draft.gitUrl])

  const handleNameChange = (name: string) => {
    setDraft((current) => ({ ...current, name }))
    if (name !== autoFilledNameFromUrl) {
      setAutoFilledNameFromUrl('')
    }
  }

  const handleGitUrlChange = (gitUrl: string) => {
    setDraft((current) => {
      const currentRepository = githubRepositories.find((repository) => String(repository.id) === current.githubRepositoryId)
      const keepGitHubRepository = current.gitBindingMode === 'github-app'
        && currentRepository
        && currentRepository.cloneUrl === gitUrl.trim()
      return {
        ...current,
        gitUrl,
        githubRepositoryId: keepGitHubRepository ? current.githubRepositoryId : '',
        githubRepositoryName: keepGitHubRepository ? current.githubRepositoryName : '',
      }
    })
  }

  const handleGitBindingModeChange = (gitBindingMode: CreateProjectDraft['gitBindingMode']) => {
    setDraft((current) => ({
      ...current,
      gitBindingMode,
      gitCredentialId: gitBindingMode === 'credential' ? current.gitCredentialId : '',
      githubInstallationId: gitBindingMode === 'github-app'
        ? current.githubInstallationId || (githubAppInstallations.length === 1 ? String(githubAppInstallations[0].installationId) : '')
        : '',
      githubRepositoryId: '',
      githubRepositoryName: '',
    }))
  }

  const handleCloneSourceChange = (cloneSource: CreateProjectDraft['cloneSource']) => {
    setDraft((current) => ({
      ...current,
      cloneSource,
      gitBindingMode: cloneSource === 'github-app' ? 'github-app' : 'none',
      gitCredentialId: '',
      githubInstallationId: cloneSource === 'github-app'
        ? current.githubInstallationId || (githubAppInstallations.length === 1 ? String(githubAppInstallations[0].installationId) : '')
        : '',
      githubRepositoryId: '',
      githubRepositoryName: '',
      gitUrl: cloneSource === 'github-app' ? '' : current.gitUrl,
    }))
  }

  const handleGitHubRepositoryChange = (repositoryId: string) => {
    const repository = githubRepositories.find((item) => String(item.id) === repositoryId) ?? null
    setDraft((current) => {
      const nextName = repository && (!current.name.trim() || current.name === autoFilledNameFromUrl)
        ? repository.name
        : current.name
      return {
        ...current,
        githubRepositoryId: repository ? String(repository.id) : '',
        githubRepositoryName: repository?.fullName ?? '',
        githubInstallationId: repository?.installationId ? String(repository.installationId) : current.githubInstallationId,
        gitUrl: repository?.cloneUrl ?? current.gitUrl,
        name: nextName,
      }
    })
    if (repository) {
      setAutoFilledNameFromUrl(repository.name)
    }
  }

  const handleSubmit = async () => {
    if (!draft.name.trim()) {
      return
    }
    if (draft.visibility === 'workspace' && !draft.workspaceId.trim()) {
      toast.error('请选择一个组织，或改成仅自己可见。')
      return
    }

    const resolvedExecutorId = draft.preferredExecutorId === MANAGED_CLOUD_AUTO_EXECUTOR_ID
      ? (await api.ensureManagedCloudExecutor({
          workspaceId: draft.visibility === 'workspace' ? draft.workspaceId.trim() || undefined : undefined,
        })).executor.executorId
      : draft.preferredExecutorId

    if (mode === 'clone') {
      if (!draft.gitUrl.trim()) {
        return
      }
      setIsCloning(true)
      try {
        await runMutation(() => api.cloneProject({
          name: draft.name,
          color: draft.color.trim() || undefined,
          gitUrl: draft.gitUrl,
          preferredExecutorId: resolvedExecutorId,
          gitCredentialId: draft.gitBindingMode === 'credential' ? draft.gitCredentialId.trim() || undefined : undefined,
          githubInstallationId: draft.gitBindingMode === 'github-app' ? Number(draft.githubInstallationId || '0') || undefined : undefined,
          githubRepositoryId: draft.gitBindingMode === 'github-app' ? Number(draft.githubRepositoryId || '0') || undefined : undefined,
          githubRepositoryName: draft.gitBindingMode === 'github-app' ? draft.githubRepositoryName.trim() || undefined : undefined,
          workspaceId: draft.workspaceId.trim() || undefined,
          visibility: draft.visibility,
        }))
        onOpenChange(false)
        setDraft(EMPTY_DRAFT)
      } finally {
        setIsCloning(false)
      }
      return
    }

    const response = await runMutation(() => api.createProject({
      name: draft.name,
      color: draft.color.trim() || undefined,
      gitUrl: '',
      preferredExecutorId: resolvedExecutorId,
      workspaceId: draft.workspaceId.trim() || undefined,
      visibility: draft.visibility,
    }))
    const projectId = response?.state.selectedProjectId
    const createdProject = response?.state.projects.find((project) => project.id === projectId)
    const bindingPathHint = createdProject?.rootPath?.trim() || ''
    if (projectId && bindingPathHint && resolvedExecutorId) {
      await runMutation(() => api.saveProjectBinding({
        projectId,
        nodeId: resolvedExecutorId,
        pathHint: bindingPathHint,
      }))
    }
    onOpenChange(false)
    setDraft(EMPTY_DRAFT)
  }

  const handleExecutorChange = (executorId: string) => {
    setDraft((current) => ({
      ...current,
      preferredExecutorId: executorId,
    }))
  }

  const handleGoToSettingsGit = () => {
    // GitHub App 绑定统一走设置页「Git 身份治理」的绑定浮窗，不在弹窗内直接发起授权。
    onOpenChange(false)
    void navigate({
      to: '/settings',
      search: {
        section: 'git',
        githubAppConnect: '1',
      } as never,
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[80vh] overflow-y-auto border-zinc-800 bg-[#09090b] text-zinc-100 sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {mode === 'clone' ? <GitFork size={18} /> : <Plus size={18} />}
            {mode === 'clone' ? (flow === 'onboarding' ? '克隆第一个项目' : 'Git Clone') : (flow === 'onboarding' ? '创建第一个空项目' : '新建空项目')}
          </DialogTitle>
        </DialogHeader>

        <DialogBody className="space-y-4">
        <div className="flex gap-2 rounded-xl bg-zinc-950 p-1">
          <Button
            variant="ghost"
            size="sm"
            className={`flex-1 rounded-lg ${mode === 'create' ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-500'}`}
            onClick={() => setMode('create')}
          >
            空项目
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className={`flex-1 rounded-lg ${mode === 'clone' ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-500'}`}
            onClick={() => {
              setMode('clone')
              setDraft((current) => current.cloneSource === 'github-app'
                ? current
                : {
                    ...current,
                    cloneSource: 'github-app',
                    gitBindingMode: 'github-app',
                    githubInstallationId: current.githubInstallationId || (githubAppInstallations.length === 1 ? String(githubAppInstallations[0].installationId) : ''),
                  })
            }}
          >
            Git Clone
          </Button>
        </div>

        <div className="grid gap-4 py-3">
          {mode === 'clone' && (
            <div className="grid gap-4">
              <div className="space-y-2">
                <label className="text-xs font-medium text-zinc-500">仓库来源</label>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { value: 'github-app' as const, label: 'GitHub 授权仓库', icon: Github },
                    { value: 'manual' as const, label: '手动输入 URL', icon: Link },
                  ].map((option) => {
                    const Icon = option.icon
                    const active = draft.cloneSource === option.value
                    return (
                      <button
                        key={option.value}
                        type="button"
                        aria-pressed={active}
                        onClick={() => handleCloneSourceChange(option.value)}
                        className={`flex h-16 items-center gap-3 rounded-lg border px-3 text-left text-sm font-medium transition-colors ${
                          active
                            ? 'border-emerald-500/60 bg-emerald-500/10 text-zinc-50'
                            : 'border-zinc-800 bg-zinc-950/90 text-zinc-400 hover:border-zinc-700 hover:text-zinc-100'
                        }`}
                      >
                        <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-md ${active ? 'bg-emerald-400 text-zinc-950' : 'bg-zinc-900 text-zinc-500'}`}>
                          <Icon className="h-4 w-4" />
                        </span>
                        <span className="min-w-0 truncate">{option.label}</span>
                      </button>
                    )
                  })}
                </div>
              </div>

              {draft.cloneSource === 'github-app' ? (
                <div className="grid gap-4">
                  {githubAppInstallations.length > 0 || githubRepositoriesScope === 'all' ? (
                    <>
                      {githubRepositoriesScope === 'all' ? (
                        <div className="space-y-2">
                          <label className="flex items-center gap-2 text-xs font-medium text-zinc-500">
                            {githubRepositoriesLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Github className="h-3.5 w-3.5" />}
                            有权限的仓库（含协作 / 组织仓库）
                          </label>
                          <SearchableSelect
                            value={draft.githubRepositoryId}
                            options={githubRepositoryOptions}
                            placeholder={githubRepositoriesLoading ? '正在读取授权仓库' : githubRepositories.length > 0 ? '选择仓库' : '没有可用仓库'}
                            searchPlaceholder="搜索仓库"
                            emptyText={githubRepositoriesLoading ? '正在读取授权仓库' : '没有匹配的仓库'}
                            disabled={githubRepositoriesLoading || githubRepositories.length < 1}
                            onChange={handleGitHubRepositoryChange}
                          />
                          {selectedGitHubRepository ? (
                            <p className="truncate text-xs text-zinc-500">{selectedGitHubRepository.cloneUrl}</p>
                          ) : null}
                          <p className="text-xs text-zinc-600">
                            已授权 GitHub 账号：可读取你被邀请协作、所在组织的仓库（对方账号/组织也需要安装本 App 并授权该仓库）。
                          </p>
                        </div>
                      ) : (
                        <>
                          <div className="space-y-2">
                            <label className="text-xs font-medium text-zinc-500">GitHub 账号 / 组织</label>
                        <SearchableSelect
                          value={draft.githubInstallationId}
                          options={githubAppInstallations.map((installation) => ({
                            value: String(installation.installationId),
                            label: installation.accountLogin,
                            description: `${installation.providerHost} · ${installation.repositorySelection}`,
                            keywords: [installation.accountLogin, installation.providerHost, String(installation.installationId)],
                          }))}
                          placeholder="选择 GitHub 授权"
                          searchPlaceholder="搜索 GitHub 授权"
                          emptyText="没有匹配的 GitHub 授权"
                          onChange={(value) => setDraft((current) => ({
                            ...current,
                            githubInstallationId: value,
                            githubRepositoryId: '',
                            githubRepositoryName: '',
                            gitUrl: '',
                          }))}
                        />
                      </div>

                      {draft.githubInstallationId ? (
                        <div className="space-y-2">
                          <label className="flex items-center gap-2 text-xs font-medium text-zinc-500">
                            {githubRepositoriesLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Github className="h-3.5 w-3.5" />}
                            授权仓库
                          </label>
                          <SearchableSelect
                            value={draft.githubRepositoryId}
                            options={githubRepositoryOptions}
                            placeholder={githubRepositoriesLoading ? '正在读取授权仓库' : githubRepositories.length > 0 ? '选择仓库' : '没有可用仓库'}
                            searchPlaceholder="搜索仓库"
                            emptyText={githubRepositoriesLoading ? '正在读取授权仓库' : '没有匹配的仓库'}
                            disabled={githubRepositoriesLoading || githubRepositories.length < 1}
                            onChange={handleGitHubRepositoryChange}
                          />
                          {selectedGitHubRepository ? (
                            <p className="truncate text-xs text-zinc-500">{selectedGitHubRepository.cloneUrl}</p>
                          ) : null}
                        </div>
                      ) : null}
                      <p className="text-xs text-zinc-600">
                        目前只能看到当前账号自己的仓库。想读取被邀请协作的仓库？
                        <button type="button" className="ml-1 text-zinc-300 underline hover:text-zinc-100" onClick={() => handleGoToSettingsGit()}>
                          去设置页授权 GitHub 账号
                        </button>
                      </p>
                    </>
                  )}
                    </>
                  ) : (
                    <div className="rounded-xl border border-zinc-800 bg-zinc-950/70 px-4 py-4">
                      <div className="flex items-start gap-3">
                        <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-zinc-100 text-zinc-950">
                          <Github className="h-4 w-4" />
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium text-zinc-100">连接 GitHub 后直接选择仓库</p>
                          <p className="mt-1 text-xs text-zinc-500">
                            授权完成后，Wemux 会在这里列出可访问仓库，不需要再去 GitHub 复制 clone URL。
                          </p>
                          {!githubAppConfigured ? (
                            <p className="mt-2 text-xs text-amber-300">GitHub App 尚未配置，请先配置 server 环境变量。</p>
                          ) : null}
                          <div className="mt-3">
                            <Button
                              type="button"
                              size="sm"
                              onClick={() => handleGoToSettingsGit()}
                              disabled={!githubAppConfigured}
                            >
                              <ExternalLink className="mr-2 h-4 w-4" />
                              去设置页绑定 GitHub
                            </Button>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div className="grid gap-4">
                  <div className="space-y-2">
                <label className="text-xs font-medium text-zinc-500">Git 仓库 URL</label>
                <Input
                  placeholder="https://github.com/user/repo.git"
                  value={draft.gitUrl}
                  onChange={(e) => handleGitUrlChange(e.target.value)}
                  className="border-zinc-800 bg-zinc-950"
                />
              </div>

                  <div className="space-y-2">
                    <label className="text-xs font-medium text-zinc-500">访问方式（可选）</label>
                    <NativeSelect
                      value={draft.gitBindingMode}
                      onChange={(event) => handleGitBindingModeChange(event.target.value as CreateProjectDraft['gitBindingMode'])}
                      options={[
                        { value: 'none', label: '不显式绑定' },
                        { value: 'credential', label: 'PAT / SSH 身份' },
                        { value: 'github-app', label: 'GitHub App Installation' },
                      ]}
                    />
                  </div>
                </div>
              )}
            </div>
          )}

          <div className="space-y-2">
            <label className="text-xs font-medium text-zinc-500">项目名称</label>
            <Input
              placeholder="例如: my-awesome-project"
              value={draft.name}
              onChange={(e) => handleNameChange(e.target.value)}
              className="border-zinc-800 bg-zinc-950"
            />
          </div>

          {hasWorkspaceChoices ? (
            <>
              {!currentWorkspace ? (
                <div className="space-y-2">
                  <label className="text-xs font-medium text-zinc-500">所属组织</label>
                  <SearchableSelect
                    value={draft.workspaceId}
                    options={workspaces.map((workspace) => ({
                      value: workspace.id,
                      label: workspace.name,
                      description: workspace.description || '共享项目、模型、Skills 和 MCP',
                    }))}
                    placeholder="选择组织"
                    searchPlaceholder="搜索组织"
                    emptyText="没有匹配的组织"
                    onChange={(workspaceId) => setDraft((current) => ({
                      ...current,
                      workspaceId,
                      visibility: workspaceId ? current.visibility : 'private',
                    }))}
                  />
                </div>
              ) : null}

              <div className="space-y-2">
                <label className="text-xs font-medium text-zinc-500">可见性</label>
                <SearchableSelect
                  value={draft.visibility}
                  options={[
                    { value: 'private', label: '仅自己可见' },
                    { value: 'workspace', label: '共享到当前组织' },
                  ]}
                  placeholder="选择可见性"
                  searchPlaceholder="搜索可见性"
                  emptyText="没有匹配项"
                  onChange={(visibility) => setDraft((current) => ({
                    ...current,
                    visibility: visibility === 'workspace' && !current.workspaceId ? 'private' : (visibility as 'private' | 'workspace'),
                  }))}
                />
                {draft.visibility === 'workspace' && !draft.workspaceId ? (
                  <p className="text-xs text-amber-400">要共享到组织，先选择一个组织。</p>
                ) : null}
              </div>
            </>
          ) : null}

          <div className="space-y-2">
            <label className="text-xs font-medium text-zinc-500">执行节点（可选）</label>
            <ExecutorSelect
              value={draft.preferredExecutorId}
              options={[
                { value: '', label: '暂不绑定（执行时再选）', description: '创建时不绑定节点，执行任务时自动分配节点', statusTone: 'neutral' },
                ...executorOptions.map((executor) => ({
                  value: executor.executorId,
                  label: executor.name,
                  description: getManagedCloudExecutorDescription(executor, managedCloudRuntime),
                  keywords: [executor.machineName],
                  badgeLabel: getManagedCloudExecutorBadgeLabel(executor, managedCloudRuntime),
                  statusTone: executor.executorId === MANAGED_CLOUD_AUTO_EXECUTOR_ID
                    ? 'online'
                    : (executor.status === 'online' ? 'online' : 'offline'),
                })),
              ]}
              placeholder="暂不绑定（执行时再选）"
              searchPlaceholder="搜索节点"
              emptyText="没有匹配的节点"
              onChange={handleExecutorChange}
            />
          </div>

          {mode === 'clone' && draft.cloneSource === 'manual' && draft.gitBindingMode === 'credential' && (
            <div className="space-y-2">
              <label className="text-xs font-medium text-zinc-500">PAT / SSH 身份</label>
              <SearchableSelect
                value={draft.gitCredentialId}
                options={[
                  { value: '', label: '暂不绑定' },
                  ...filteredCredentials.map((credential) => ({
                    value: credential.id,
                    label: `${credential.label} · ${credential.name}`,
                    description: `${credential.provider.toUpperCase()} · ${credential.host} · ${credential.authMode.toUpperCase()}${credential.isDefault ? ' · 默认' : ''}`,
                    keywords: [credential.email, credential.host],
                  })),
                ]}
                placeholder={filteredCredentials.length > 0 ? '选择 Git 身份' : credentialRepoHost ? '当前 Host 暂无匹配身份' : '先去设置页添加 Git 身份'}
                searchPlaceholder="搜索 Git 身份"
                emptyText="没有匹配的 Git 身份"
                onChange={(value) => setDraft((current) => ({ ...current, gitCredentialId: value }))}
              />
            </div>
          )}

          {mode === 'clone' && draft.cloneSource === 'manual' && draft.gitBindingMode === 'github-app' && (
            <div className="space-y-2">
              <label className="text-xs font-medium text-zinc-500">GitHub App Installation</label>
              <SearchableSelect
                value={draft.githubInstallationId}
                options={githubAppInstallations.map((installation) => ({
                  value: String(installation.installationId),
                  label: `${installation.accountLogin} · #${installation.installationId}`,
                  description: `${installation.providerHost} · ${installation.repositorySelection}`,
                  keywords: [installation.accountLogin, installation.providerHost],
                }))}
                placeholder={githubAppInstallations.length > 0 ? '选择 GitHub App installation' : '先去设置页连接 GitHub'}
                searchPlaceholder="搜索 GitHub App installation"
                emptyText="没有匹配的 installation"
                onChange={(value) => setDraft((current) => ({
                  ...current,
                  githubInstallationId: value,
                  githubRepositoryId: '',
                  githubRepositoryName: '',
                }))}
              />
            </div>
          )}

          <ProjectColorField
            color={draft.color}
            projectName={draft.name}
            onChange={(color) => setDraft((current) => ({ ...current, color }))}
          />
        </div>
        </DialogBody>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} className="text-zinc-400 hover:text-zinc-100">
            取消
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={
              busy
              || !draft.name.trim()
              || (mode === 'clone' && !draft.gitUrl.trim())
              || isCloning
            }
            className="bg-zinc-100 text-zinc-950 hover:bg-zinc-200"
          >
            {isCloning ? '提交中...' : mode === 'clone' ? (flow === 'onboarding' ? '开始克隆' : '执行 Clone') : (flow === 'onboarding' ? '创建空项目' : '创建项目')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
