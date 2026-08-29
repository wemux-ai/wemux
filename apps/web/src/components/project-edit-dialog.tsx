import { useEffect, useMemo, useState } from 'react'
import { Building, Cpu, FileDown, FolderGit2, FolderOpen, Layout, RefreshCw, Terminal, Trash2, User, Users, X } from 'lucide-react'

import { normalizeRuntimeEnvironmentConfig, type RuntimeEnvironmentConfig, type RuntimeEnvironmentSummary, validateRuntimeEnvironmentConfig } from '@shared/runtime-environment'
import { validateProjectEnvironmentPreviewPorts } from '@shared/types'
import type { ExecutorRecord, Project } from '@shared/types'
import { toast } from 'sonner'
import { api, resolveMediaUrl, type GitHubAppInstallationSummary, type ProjectGitCredentialBindingResponse, type ProjectMemberCandidate, type ProjectMemberInfo } from '../lib/api'
import { useAuth } from '../lib/auth-context'
import { useTranslation } from '../lib/i18n/react'
import { getProjectSourceDisplay, getProjectVersionControlDescription, getProjectVersionControlLabel } from '../lib/project-form'
import { cn } from '../lib/utils'
import {
  buildWorkspaceProjectRootPath,
  buildWorkspaceRepoPath,
  getWorkspaceWorktreeBaseDir,
  isManagedWorkspaceOwnedProjectPath,
  isManagedWorkspaceProjectPath,
} from '../lib/workspace-paths'
import type { ProjectFormDraft } from '../lib/project-form'
import { EnvironmentTemplateEditor, type EnvironmentTemplateEditorValue } from './environment-template-editor'
import { ProjectColorField } from './project-color-field'
import { RuntimeEnvironmentEditor } from './runtime-environment-editor'
import { Badge } from './ui/badge'
import { Avatar, AvatarFallback, AvatarImage } from './ui/avatar'
import { Button } from './ui/button'
import { Checkbox } from './ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from './ui/dialog'
import { Drawer, DrawerContent } from './ui/drawer'
import { ExecutorSelect } from './ui/executor-select'
import { Input } from './ui/input'
import { NativeSelect } from './ui/native-select'
import { SearchableSelect } from './ui/searchable-select'
import { useCompactSettingsDialogLayout } from './ui/use-compact-settings-dialog-layout'
interface ProjectEditDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  draft: ProjectFormDraft
  onDraftChange: (draft: ProjectFormDraft) => void
  project?: Project | null
  workspaceRoot: string
  executors: ExecutorRecord[]
  busy: boolean
  reimportBusy?: boolean
  isCloning?: boolean
  onReimportEnvironmentTemplate?: () => void | Promise<void>
  onSyncProjectSettings?: (executorId?: string) => void | Promise<void>
  onSubmit: () => void | Promise<void>
  onDelete?: (options: { projectName: string; deleteProjectDirectory: boolean }) => void | Promise<void>
}

type ProjectEditSectionId = 'overview' | 'members' | 'repository' | 'git-identity' | 'executor' | 'environment' | 'runtime-environment' | 'delete-project'
const tr = (language: string, zh: string, en: string) => language === 'zh' ? zh : en

const resolveProjectRepoHost = (gitUrl?: string) => {
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

const getMemberInitials = (name: string) => {
  const normalized = name.trim()
  if (!normalized) {
    return '?'
  }
  const parts = normalized.split(/\s+/).filter(Boolean)
  if (parts.length > 1) {
    return parts.slice(0, 2).map((part) => part[0]).join('').toUpperCase()
  }
  return Array.from(normalized).slice(0, 2).join('').toUpperCase()
}

export function ProjectEditDialog({
  open,
  onOpenChange,
  draft,
  onDraftChange,
  project,
  workspaceRoot,
  executors,
  busy,
  reimportBusy = false,
  isCloning = false,
  onReimportEnvironmentTemplate,
  onSyncProjectSettings,
  onSubmit,
  onDelete,
}: ProjectEditDialogProps) {
  const { user } = useAuth()
  const { language, t } = useTranslation()
  const usesCompactLayout = useCompactSettingsDialogLayout()
  const [activeSection, setActiveSection] = useState<ProjectEditSectionId>('overview')
  const [bindingState, setBindingState] = useState<ProjectGitCredentialBindingResponse | null>(null)
  const [bindingBusy, setBindingBusy] = useState(false)
  const [gitBindingMode, setGitBindingMode] = useState<'none' | 'credential' | 'github-app'>('none')
  const [selectedCredentialId, setSelectedCredentialId] = useState('')
  const [githubAppInstallations, setGitHubAppInstallations] = useState<GitHubAppInstallationSummary[]>([])
  const [selectedGitHubInstallationId, setSelectedGitHubInstallationId] = useState('')
  const [runtimeEnvironmentConfig, setRuntimeEnvironmentConfig] = useState<RuntimeEnvironmentConfig | null>(null)
  const [runtimeEnvironmentSummary, setRuntimeEnvironmentSummary] = useState<RuntimeEnvironmentSummary | null>(null)
  const [runtimeEnvironmentLoading, setRuntimeEnvironmentLoading] = useState(false)
  const [runtimeEnvironmentSaving, setRuntimeEnvironmentSaving] = useState(false)
  const [runtimeEnvironmentImporting, setRuntimeEnvironmentImporting] = useState(false)
  const [projectSettingsSyncing, setProjectSettingsSyncing] = useState(false)
  const [deletingProject, setDeletingProject] = useState(false)
  const [deleteProjectDirectory, setDeleteProjectDirectory] = useState(false)
  const [deleteProjectNameInput, setDeleteProjectNameInput] = useState('')
  const [projectMembers, setProjectMembers] = useState<ProjectMemberInfo[]>([])
  const [memberCandidates, setMemberCandidates] = useState<ProjectMemberCandidate[]>([])
  const [projectMembersLoading, setProjectMembersLoading] = useState(false)
  const [selectedMemberCandidateId, setSelectedMemberCandidateId] = useState('')
  const [memberMutationBusy, setMemberMutationBusy] = useState(false)
  const knownWorkspaceRoots = useMemo(() => (
    [...new Set([
      workspaceRoot.trim(),
      ...executors.map((executor) => executor.workspaceRoot?.trim() || ''),
    ].filter(Boolean))]
  ), [executors, workspaceRoot])
  const selectedExecutor = useMemo(() => executors.find((executor) => executor.executorId === draft.preferredExecutorId), [draft.preferredExecutorId, executors])
  const selectedExecutorWorkspaceRoot = useMemo(() => (
    selectedExecutor?.workspaceRoot?.trim()
      || workspaceRoot
  ), [selectedExecutor?.workspaceRoot, workspaceRoot])
  const selectedExecutorOwnerUserId = selectedExecutor?.ownerUserId || user?.id
  const canDeleteManagedProjectDirectory = useMemo(() => {
    const rootPath = project?.rootPath?.trim()
    if (!project || !rootPath) {
      return false
    }

    return isManagedWorkspaceOwnedProjectPath(rootPath, project)
      || knownWorkspaceRoots.some((candidateWorkspaceRoot) => isManagedWorkspaceOwnedProjectPath(rootPath, project, candidateWorkspaceRoot))
  }, [knownWorkspaceRoots, project])
  const projectDirectoryPath = useMemo(() => (
    selectedExecutorOwnerUserId?.trim()
      ? (
        draft.gitUrl.trim()
          ? buildWorkspaceRepoPath(selectedExecutorWorkspaceRoot, draft, undefined, selectedExecutorOwnerUserId)
          : (
            project && project.rootPath?.trim() && !knownWorkspaceRoots.some((candidateWorkspaceRoot) => (
              isManagedWorkspaceProjectPath(project.rootPath, project, candidateWorkspaceRoot, undefined, selectedExecutorOwnerUserId)
            ))
              ? project.rootPath.trim()
              : buildWorkspaceProjectRootPath(selectedExecutorWorkspaceRoot, draft, undefined, selectedExecutorOwnerUserId)
          )
      )
      : project?.rootPath?.trim() || ''
  ), [draft, knownWorkspaceRoots, project, selectedExecutorOwnerUserId, selectedExecutorWorkspaceRoot])
  const worktreeBaseDir = useMemo(() => (
    selectedExecutorOwnerUserId?.trim()
      ? getWorkspaceWorktreeBaseDir(selectedExecutorWorkspaceRoot, undefined, selectedExecutorOwnerUserId)
      : ''
  ), [selectedExecutorOwnerUserId, selectedExecutorWorkspaceRoot])
  const versionControlLabel = useMemo(() => getProjectVersionControlLabel(project, t), [project, t])
  const versionControlDescription = useMemo(() => getProjectVersionControlDescription(project, t), [project, t])
  const sourceDisplay = useMemo(() => getProjectSourceDisplay(project, t), [project, t])
  const repoHost = useMemo(() => resolveProjectRepoHost(draft.gitUrl || project?.gitUrl), [draft.gitUrl, project?.gitUrl])
  const filteredCredentials = useMemo(() => {
    const credentials = bindingState?.credentials ?? []
    return credentials.filter((credential) => {
      const hostMatches = !repoHost
        || normalizeHost(credential.host) === normalizeHost(repoHost)
        || credential.id === selectedCredentialId
      const isUsable = credential.authMode !== 'ssh'
        || credential.activated
        || credential.id === selectedCredentialId
      return hostMatches && isUsable
    })
  }, [bindingState?.credentials, repoHost, selectedCredentialId])
  const selectedCredential = useMemo(
    () => bindingState?.credentials.find((credential) => credential.id === selectedCredentialId) ?? null,
    [bindingState?.credentials, selectedCredentialId],
  )
  const executorOptions = useMemo(
    () => executors.filter((executor) => executor.status === 'online' || executor.status === 'paired'),
    [executors],
  )
  const currentGitBindingLabel = useMemo(() => {
    const binding = bindingState?.binding
    if (!binding) {
      return tr(language, '未绑定', 'No binding')
    }

    if (binding.authSourceType === 'github-app-installation') {
      const account = binding.githubAccountLogin || tr(language, '未知账号', 'Unknown account')
      const repo = binding.githubRepositoryName?.trim() || tr(language, '未指定仓库', 'Repository not selected')
      return `GitHub App · ${account} · ${repo}`
    }

    const credential = bindingState?.credential
    return credential ? `${credential.label} · ${credential.name}` : tr(language, '已绑定 Git 身份', 'Git identity bound')
  }, [bindingState?.binding, bindingState?.credential, language])
  const selectedGitHubInstallation = useMemo(
    () => githubAppInstallations.find((item) => String(item.installationId) === selectedGitHubInstallationId) ?? null,
    [githubAppInstallations, selectedGitHubInstallationId],
  )
  const sections = useMemo(
    () => [
      { id: 'overview' as const, label: tr(language, '基础信息', 'Overview'), icon: Building },
      ...(project && !project.workspaceId?.trim() ? [{ id: 'members' as const, label: tr(language, '成员', 'Members'), icon: Users }] : []),
      { id: 'repository' as const, label: tr(language, '仓库设置', 'Repository'), icon: FolderGit2 },
      { id: 'git-identity' as const, label: tr(language, '默认发布身份', 'Default Publish Identity'), icon: User },
      { id: 'executor' as const, label: tr(language, '默认节点', 'Default Executor'), icon: Cpu },
      { id: 'environment' as const, label: tr(language, '环境模板', 'Environment Template'), icon: Layout },
      { id: 'runtime-environment' as const, label: tr(language, '运行环境变量', 'Runtime Environment'), icon: Terminal },
      { id: 'delete-project' as const, label: tr(language, '删除项目', 'Delete Project'), icon: Trash2 },
    ],
    [language],
  )
  const activeSectionMeta = sections.find((section) => section.id === activeSection) ?? sections[0]
  const submitDisabled = busy || deletingProject || !draft.name.trim() || isCloning || !project
  const normalizedProjectNameInput = deleteProjectNameInput.trim()
  const deleteProjectNameMatches = !!project && normalizedProjectNameInput === project.name.trim()
  const deleteProjectDisabled = busy || deletingProject || !project || !deleteProjectNameMatches

  useEffect(() => {
    if (open) {
      setActiveSection('overview')
      setDeletingProject(false)
      setDeleteProjectDirectory(false)
      setDeleteProjectNameInput('')
    }
  }, [open])

  useEffect(() => {
    if (!open || !project) {
      setBindingState(null)
      setSelectedCredentialId('')
      setRuntimeEnvironmentConfig(null)
      setRuntimeEnvironmentSummary(null)
      setRuntimeEnvironmentLoading(false)
      setRuntimeEnvironmentImporting(false)
      return
    }

    void api.getProjectGitCredentialBinding(project.id)
      .then((response) => {
        setBindingState(response)
        setSelectedCredentialId(response.binding?.credentialId ?? '')
        if (response.binding?.authSourceType === 'github-app-installation' && response.binding.githubInstallationId) {
          setGitBindingMode('github-app')
          setSelectedGitHubInstallationId(String(response.binding.githubInstallationId))
        } else if (response.binding?.credentialId) {
          setGitBindingMode('credential')
          setSelectedGitHubInstallationId('')
        } else {
          setGitBindingMode('none')
          setSelectedGitHubInstallationId('')
        }
      })
      .catch(() => {
        setBindingState(null)
        setSelectedCredentialId('')
        setGitBindingMode('none')
        setSelectedGitHubInstallationId('')
      })
    void api.listUserGitHubAppInstallations()
      .then((response) => setGitHubAppInstallations(response.installations))
      .catch(() => setGitHubAppInstallations([]))

    setRuntimeEnvironmentLoading(true)
    void api.getProjectRuntimeEnvironment(project.id)
      .then((response) => {
        setRuntimeEnvironmentConfig(response.config)
        setRuntimeEnvironmentSummary(response.summary)
      })
      .catch(() => {
        setRuntimeEnvironmentConfig(null)
        setRuntimeEnvironmentSummary(null)
      })
      .finally(() => {
        setRuntimeEnvironmentLoading(false)
      })
  }, [open, project])

  const projectId = project?.id?.trim() || ''
  const isPersonalProject = !project?.workspaceId?.trim()
  const projectOwnerId = projectMembers.find((member) => member.accessType === 'owner')?.userId || project?.createdById?.trim() || ''
  const canManageMembers = Boolean(projectId && isPersonalProject && user?.id && projectOwnerId === user.id)
  useEffect(() => {
    if (!open || !projectId) {
      setProjectMembers([])
      setMemberCandidates([])
      setSelectedMemberCandidateId('')
      return
    }

    let cancelled = false
    setProjectMembersLoading(true)
    void api.getProjectMembers(projectId)
      .then((response) => {
        if (cancelled) return
        setProjectMembers(response.members)
      })
      .catch(() => {
        if (cancelled) return
        setProjectMembers([])
      })
      .finally(() => {
        if (!cancelled) setProjectMembersLoading(false)
      })
    void api.getProjectMemberCandidates(projectId)
      .then((response) => {
        if (cancelled) return
        setMemberCandidates(response.candidates)
      })
      .catch(() => {
        if (cancelled) return
        setMemberCandidates([])
      })
    return () => {
      cancelled = true
    }
  }, [open, projectId])

  useEffect(() => {
    if (!canDeleteManagedProjectDirectory && deleteProjectDirectory) {
      setDeleteProjectDirectory(false)
    }
  }, [canDeleteManagedProjectDirectory, deleteProjectDirectory])

  const runtimeEnvironmentIssues = useMemo(() => validateRuntimeEnvironmentConfig(runtimeEnvironmentConfig), [runtimeEnvironmentConfig])

  const handleSaveGitBinding = async () => {
    if (!project) {
      return
    }

    setBindingBusy(true)
    try {
      const response = gitBindingMode === 'credential'
        ? selectedCredentialId
          ? await api.saveProjectGitCredentialBinding(project.id, { credentialId: selectedCredentialId })
          : await api.deleteProjectGitCredentialBinding(project.id)
        : gitBindingMode === 'github-app'
          ? selectedGitHubInstallationId
            ? await api.saveProjectGitCredentialBinding(project.id, { githubInstallationId: Number(selectedGitHubInstallationId) })
            : await api.deleteProjectGitCredentialBinding(project.id)
          : await api.deleteProjectGitCredentialBinding(project.id)
      setBindingState(response)
      setSelectedCredentialId(response.binding?.credentialId ?? '')
      if (response.binding?.authSourceType === 'github-app-installation' && response.binding.githubInstallationId) {
        setGitBindingMode('github-app')
        setSelectedGitHubInstallationId(String(response.binding.githubInstallationId))
      } else if (response.binding?.credentialId) {
        setGitBindingMode('credential')
        setSelectedGitHubInstallationId('')
      } else {
        setGitBindingMode('none')
        setSelectedGitHubInstallationId('')
      }
      toast.success(response.message)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : tr(language, '保存项目 Git 身份绑定失败', 'Failed to save project Git identity binding'))
    } finally {
      setBindingBusy(false)
    }
  }

  const handleSaveRuntimeEnvironment = async () => {
    if (!project) {
      return
    }

    const issues = validateRuntimeEnvironmentConfig(runtimeEnvironmentConfig)
    if (issues.length > 0) {
      toast.error(issues[0]?.message || '环境变量配置无效')
      return
    }

    setRuntimeEnvironmentSaving(true)
    try {
      const normalized = normalizeRuntimeEnvironmentConfig(runtimeEnvironmentConfig)
      const response = await api.updateProjectRuntimeEnvironment(project.id, {
        config: normalized && normalized.content.trim() ? normalized : null,
      })
      setRuntimeEnvironmentConfig(response.config)
      setRuntimeEnvironmentSummary(response.summary)
      if (response.fileWrite && !response.fileWrite.ok) {
        toast.warning(response.message || response.fileWrite.message || tr(language, '配置已保存，但项目文件未写入。', 'Config saved, but the project file was not written.'))
      } else {
        toast.success(response.message || tr(language, '项目级环境变量已保存', 'Project runtime env saved'))
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : tr(language, '保存项目级环境变量失败', 'Failed to save runtime env'))
    } finally {
      setRuntimeEnvironmentSaving(false)
    }
  }

  const handleImportRuntimeEnvironment = async () => {
    if (!project) {
      return
    }

    setRuntimeEnvironmentImporting(true)
    try {
      const response = await api.importProjectRuntimeEnvironment(project.id)
      setRuntimeEnvironmentConfig(response.config)
      setRuntimeEnvironmentSummary(response.summary)
      toast.success(response.message || tr(language, '已读取 .env 并保存到项目环境变量', 'Imported .env into project runtime env'))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : tr(language, '读取 .env 失败', 'Failed to import .env'))
    } finally {
      setRuntimeEnvironmentImporting(false)
    }
  }

  const handleSyncProjectSettings = async () => {
    if (!project || !onSyncProjectSettings) {
      return
    }

    setProjectSettingsSyncing(true)
    try {
      await onSyncProjectSettings(draft.preferredExecutorId || project.preferredExecutorId)
    } finally {
      setProjectSettingsSyncing(false)
    }
  }

  const refreshProjectMembers = async (targetProjectId: string) => {
    const [membersResponse, candidatesResponse] = await Promise.all([
      api.getProjectMembers(targetProjectId),
      api.getProjectMemberCandidates(targetProjectId),
    ])
    setProjectMembers(membersResponse.members)
    setMemberCandidates(candidatesResponse.candidates)
  }

  const handleAddProjectMember = async () => {
    if (!projectId || !selectedMemberCandidateId || memberMutationBusy) {
      return
    }

    setMemberMutationBusy(true)
    try {
      const response = await api.addProjectMember(projectId, selectedMemberCandidateId)
      toast.success(response.message || tr(language, '已添加成员', 'Member added'))
      setSelectedMemberCandidateId('')
      await refreshProjectMembers(projectId)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : tr(language, '添加成员失败', 'Failed to add member'))
    } finally {
      setMemberMutationBusy(false)
    }
  }

  const handleRemoveProjectMember = async (memberUserId: string) => {
    if (!projectId || memberMutationBusy) {
      return
    }

    setMemberMutationBusy(true)
    try {
      const response = await api.removeProjectMember(projectId, memberUserId)
      toast.success(response.message || tr(language, '已移除成员', 'Member removed'))
      await refreshProjectMembers(projectId)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : tr(language, '移除成员失败', 'Failed to remove member'))
    } finally {
      setMemberMutationBusy(false)
    }
  }

  const dialogSecondaryButtonClass = 'border border-zinc-800 bg-zinc-950 text-zinc-300 hover:border-zinc-700 hover:bg-zinc-900 hover:text-zinc-100 disabled:border-zinc-900 disabled:bg-zinc-950/60 disabled:text-zinc-600 disabled:opacity-100'
  const dialogPrimaryButtonClass = 'bg-zinc-100 text-zinc-950 hover:bg-zinc-200 disabled:bg-zinc-800 disabled:text-zinc-500 disabled:opacity-100'
  const dialogDangerButtonClass = 'border border-rose-500/30 bg-rose-500/15 text-rose-100 hover:bg-rose-500/25 disabled:border-rose-950/70 disabled:bg-rose-950/30 disabled:text-rose-900 disabled:opacity-100'

  const handleDeleteProject = async () => {
    if (!project || !onDelete || deletingProject) {
      return
    }

    setDeletingProject(true)
    try {
      await onDelete({
        projectName: normalizedProjectNameInput,
        deleteProjectDirectory: canDeleteManagedProjectDirectory && deleteProjectDirectory,
      })
    } finally {
      setDeletingProject(false)
    }
  }

  const handleSubmitProject = async () => {
    const duplicatePorts = validateProjectEnvironmentPreviewPorts({
      appPort: draft.envAppPort,
      ports: draft.envPorts,
      previewDomainBindings: project?.environmentTemplate?.previewDomainBindings,
    })
    if (duplicatePorts.length > 0) {
      toast.error(`${tr(language, '预览端口不能重复', 'Preview ports must be unique')}: ${duplicatePorts.join('、')}`)
      return
    }
    await onSubmit()
  }
  const environmentTemplateEditorValue: EnvironmentTemplateEditorValue = {
    installCommand: draft.installCommand,
    startCommandTemplate: draft.envStartCommandTemplate,
    stopCommandTemplate: draft.envStopCommandTemplate,
    logsCommandTemplate: draft.envLogsCommandTemplate,
    appPort: draft.envAppPort,
    healthPath: draft.envHealthPath,
    ports: draft.envPorts,
  }

  const handleEnvironmentTemplateChange = (value: EnvironmentTemplateEditorValue) => {
    onDraftChange({
      ...draft,
      installCommand: value.installCommand,
      envStartCommandTemplate: value.startCommandTemplate,
      envStopCommandTemplate: value.stopCommandTemplate,
      envLogsCommandTemplate: value.logsCommandTemplate,
      envAppPort: value.appPort,
      envHealthPath: value.healthPath,
      envPorts: value.ports,
    })
  }

  const dialogBody = (
    <>
        <DialogHeader className="shrink-0 text-left">
          <div className="border-b border-zinc-800/80 px-4 py-3 lg:px-6 lg:py-4">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <p className="text-[11px] uppercase tracking-[0.22em] text-zinc-500">{tr(language, '项目设置', 'Project Settings')}</p>
                <DialogTitle className="mt-2 text-xl leading-tight text-zinc-50">{tr(language, '编辑项目', 'Edit Project')}</DialogTitle>
                <DialogDescription className="mt-1 text-sm text-zinc-400">{project ? `${tr(language, '维护', 'Maintain')}「${project.name}」${tr(language, '的项目设置。', ' project settings.')}` : tr(language, '维护项目元数据、仓库默认值和执行模板。', 'Maintain project metadata, repository defaults, and execution templates.')}</DialogDescription>
              </div>
              <Button
                autoFocus
                type="button"
                variant="ghost"
                size="icon"
                aria-label={tr(language, '关闭项目编辑面板', 'Close project editor')}
                className="h-9 w-9 rounded-full border border-zinc-800 bg-zinc-950 text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100"
                onClick={() => onOpenChange(false)}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </DialogHeader>

        <div className="shrink-0 border-b border-zinc-800/80 px-4 lg:hidden">
          <div className="flex gap-5 overflow-x-auto">
            {sections.map((section) => (
              <button
                key={section.id}
                type="button"
                onClick={() => setActiveSection(section.id)}
                className={cn(
                  'shrink-0 border-b-2 px-0 py-3 text-sm font-medium transition-colors',
                  activeSection === section.id
                    ? 'border-zinc-100 text-zinc-50'
                    : 'border-transparent text-zinc-500 hover:text-zinc-200',
                )}
              >
                {section.label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex min-h-0 flex-1 flex-col lg:grid lg:grid-cols-[220px_minmax(0,1fr)]">
          <aside className="hidden border-r border-zinc-800/80 bg-zinc-950/40 lg:block">
            <div className="px-4 py-5">
              <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-zinc-500">Sections</p>
              <div className="mt-4 border-t border-zinc-900">
                {sections.map((section) => (
                  <button
                    key={section.id}
                    type="button"
                    onClick={() => setActiveSection(section.id)}
                    className={cn(
                      'relative flex w-full items-center gap-3 border-b border-zinc-900 py-3 text-left text-sm font-medium transition-colors',
                      activeSection === section.id
                        ? 'text-zinc-50'
                        : 'text-zinc-500 hover:text-zinc-200',
                    )}
                  >
                    {activeSection === section.id ? (
                      <span className="absolute bottom-1 left-[-16px] top-1 w-px bg-zinc-100" aria-hidden="true" />
                    ) : null}
                    <section.icon className="h-4 w-4 shrink-0" />
                    {section.label}
                  </button>
                ))}
              </div>
            </div>
          </aside>

          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain touch-pan-y [@supports(-webkit-touch-callout:none)]:[-webkit-overflow-scrolling:touch]">
            <div className="mx-auto w-full max-w-4xl px-4 py-6 lg:px-8 lg:py-7">
              <div className="space-y-5">
                {activeSection === 'overview' ? (
                  <div className="space-y-5">
                    {project ? (
                      <div className="border border-zinc-800 bg-zinc-950/70 p-4">
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <Badge className="border border-zinc-800 bg-zinc-950 text-zinc-300">{versionControlLabel}</Badge>
                              <span className="text-xs text-zinc-500">{versionControlDescription}</span>
                            </div>
                            <p className="mt-2 break-all font-mono text-xs leading-5 text-zinc-300">{sourceDisplay}</p>
                          </div>
                          {onSyncProjectSettings ? (
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() => void handleSyncProjectSettings()}
                              disabled={busy || reimportBusy || projectSettingsSyncing}
                              className={cn(dialogSecondaryButtonClass, 'shrink-0')}
                            >
                              <RefreshCw className={projectSettingsSyncing ? 'mr-1.5 h-3.5 w-3.5 animate-spin' : 'mr-1.5 h-3.5 w-3.5'} />
                              {tr(language, '同步项目设置', 'Sync Project Settings')}
                            </Button>
                          ) : null}
                        </div>
                      </div>
                    ) : null}

                    <div className="border border-zinc-800 bg-zinc-950/70 p-4">
                      <div className="space-y-2">
                        <label className="text-sm text-zinc-400">{tr(language, '项目名称', 'Project Name')}</label>
                        <Input
                          placeholder={tr(language, '项目名称', 'Project name')}
                          value={draft.name}
                          onChange={(e) => onDraftChange({ ...draft, name: e.target.value })}
                        />
                      </div>
                    </div>

                    <div className="border border-zinc-800 bg-zinc-950/70 p-4">
                      <ProjectColorField
                        color={draft.color}
                        projectName={draft.name}
                        onChange={(color) => onDraftChange({ ...draft, color })}
                      />
                    </div>

                  </div>
                ) : null}

                {activeSection === 'members' && isPersonalProject ? (
                  <div className="space-y-5">
                    <div className="border border-zinc-800 bg-zinc-950/70 p-4">
                      <div className="space-y-1">
                        <p className="text-sm text-zinc-400">{tr(language, '私有项目成员', 'Private project members')}</p>
                        <p className="text-xs leading-5 text-zinc-600">
                          {tr(
                            language,
                            '拉入的成员可以在侧边栏「共享给我」看到这个项目，查看任务、看板与工作区，并能创建任务和派发 Agent；只有你能移除成员或删除项目。',
                            'Members you invite see this project under "Shared with me", can view tasks, board and workspaces, and can create tasks and dispatch agents; only you can remove members or delete the project.',
                          )}
                        </p>
                      </div>
                    </div>

                    <div className="border border-zinc-800 bg-zinc-950/70 p-4">
                      {projectMembersLoading ? (
                        <p className="text-xs text-zinc-500">{tr(language, '加载成员中…', 'Loading members…')}</p>
                      ) : projectMembers.length === 0 ? (
                        <p className="text-xs text-zinc-500">{tr(language, '暂无成员记录。', 'No member records yet.')}</p>
                      ) : (
                        <div className="space-y-3">
                          {projectMembers.map((member) => (
                            <div key={member.userId} className="flex items-center justify-between gap-3">
                              <div className="flex min-w-0 items-center gap-2.5">
                                <Avatar className="h-8 w-8 shrink-0">
                                  {member.avatarUrl ? <AvatarImage src={resolveMediaUrl(member.avatarUrl)} alt={member.name} /> : null}
                                  <AvatarFallback className="bg-zinc-900 text-[11px] text-zinc-300">
                                    {getMemberInitials(member.name)}
                                  </AvatarFallback>
                                </Avatar>
                                <div className="min-w-0">
                                  <p className="truncate text-sm text-zinc-200">{member.name}</p>
                                  <p className="truncate text-xs text-zinc-500">{member.email || member.userId}</p>
                                </div>
                              </div>
                              {member.accessType === 'owner' ? (
                                <Badge className="shrink-0 border border-zinc-800 bg-zinc-950 text-zinc-400">{tr(language, '所有者', 'Owner')}</Badge>
                              ) : canManageMembers ? (
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  disabled={memberMutationBusy}
                                  onClick={() => void handleRemoveProjectMember(member.userId)}
                                  className={cn(dialogSecondaryButtonClass, 'h-7 shrink-0 px-2 text-xs')}
                                >
                                  {tr(language, '移除', 'Remove')}
                                </Button>
                              ) : null}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    {canManageMembers ? (
                      <div className="space-y-2 border border-zinc-800 bg-zinc-950/70 p-4">
                        <label className="text-sm text-zinc-400">{tr(language, '添加组织成员', 'Add org member')}</label>
                        <SearchableSelect
                          value={selectedMemberCandidateId}
                          options={memberCandidates.map((candidate) => ({
                            value: candidate.userId,
                            label: candidate.name,
                            description: candidate.email,
                            keywords: [candidate.email],
                          }))}
                          placeholder={memberCandidates.length > 0 ? tr(language, '选择与你同组织的成员', 'Select a member from your org') : tr(language, '没有可添加的组织成员', 'No org members to add')}
                          searchPlaceholder={tr(language, '搜索成员', 'Search members')}
                          emptyText={tr(language, '没有匹配的成员', 'No matching members')}
                          onChange={setSelectedMemberCandidateId}
                        />
                        <Button
                          type="button"
                          size="sm"
                          disabled={!selectedMemberCandidateId || memberMutationBusy}
                          onClick={() => void handleAddProjectMember()}
                          className={cn(dialogPrimaryButtonClass, 'h-7 px-2 text-xs')}
                        >
                          {tr(language, '添加', 'Add')}
                        </Button>
                      </div>
                    ) : null}
                  </div>
                ) : null}

                {activeSection === 'repository' ? (
                  <div className="space-y-5">
                    <div className="border border-zinc-800 bg-zinc-950/70 p-4">
                      <div className="space-y-2">
                        <label className="text-sm text-zinc-400">Git {tr(language, '仓库 URL', 'Repository URL')}</label>
                        <Input
                          placeholder={tr(language, 'Git 仓库 URL', 'Git repository URL')}
                          value={draft.gitUrl}
                          onChange={(e) => onDraftChange({ ...draft, gitUrl: e.target.value })}
                        />
                      </div>
                    </div>

                    <div className="border border-zinc-800 bg-zinc-950/70 p-4">
                      <div className="space-y-2">
                        <label className="text-sm text-zinc-400">{tr(language, '默认基于分支', 'Default Base Branch')}</label>
                        <Input
                          placeholder="main"
                          value={draft.defaultBranch}
                          onChange={(e) => onDraftChange({ ...draft, defaultBranch: e.target.value })}
                        />
                        <p className="text-xs text-zinc-500">{tr(language, '新任务会默认基于这个分支创建执行上下文；留空时回退到 `main`。', 'New tasks create execution context from this branch by default; leave blank to fall back to `main`.')}</p>
                      </div>
                    </div>

                    <div className="grid gap-3 border border-zinc-800 bg-zinc-950/70 p-4 sm:grid-cols-2">
                      <div className="rounded-xl border border-zinc-800 bg-[#09090b] p-3">
                        <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-[0.18em] text-zinc-500">
                          <FolderGit2 className="h-3.5 w-3.5" />
                          {tr(language, '默认仓库目录', 'Default Repository Directory')}
                        </div>
                        <p className="mt-2 break-all font-mono text-xs leading-5 text-zinc-200">{projectDirectoryPath}</p>
                      </div>
                      <div className="rounded-xl border border-zinc-800 bg-[#09090b] p-3">
                        <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-[0.18em] text-zinc-500">
                          <FolderOpen className="h-3.5 w-3.5" />
                          {tr(language, '默认 Worktree 目录', 'Default Worktree Directory')}
                        </div>
                        <p className="mt-2 break-all font-mono text-xs leading-5 text-zinc-200">{worktreeBaseDir}</p>
                      </div>
                      <p className="text-xs leading-5 text-zinc-500 sm:col-span-2">
                        {tr(language, '项目目录以这里显示的默认目录为准；工作区只选择执行方式，不再单独维护节点路径。目录项目会直接在项目根目录运行，初始化 Git 后系统会自动识别升级。', 'The project directory follows the default shown here. Workspaces choose execution behavior and no longer maintain separate node paths. Directory projects run in the project root, and Git initialization is detected automatically.')}
                      </p>
                    </div>
                  </div>
                ) : null}

                {activeSection === 'git-identity' ? (
                  <div className="space-y-5">
                    <div className="border border-zinc-800 bg-zinc-950/70 p-4">
                      <div className="space-y-2">
                        <label className="text-sm text-zinc-400">{tr(language, '仓库 Host', 'Repository Host')}</label>
                        <div className="rounded-xl border border-zinc-800 bg-[#09090b] px-3 py-3 font-mono text-sm text-zinc-200">
                          {repoHost || tr(language, '当前项目还没有远端仓库地址', 'This project has no remote repository URL yet')}
                        </div>
                        <p className="text-xs leading-5 text-zinc-500">{tr(language, '系统会优先使用你在这个项目上显式绑定的默认发布身份；组织成员之间不会共享 token。这些身份用于平台托管的 push / PR，不等于给节点本机登录 GitHub。', 'The system prioritizes the default publish identity you explicitly bind to this project; tokens are not shared between organization members. These identities are used for platform-managed push / PR flows and do not mean the worker node is logged into GitHub locally.')}</p>
                      </div>
                    </div>

                    <div className="border border-zinc-800 bg-zinc-950/70 p-4">
                      <div className="space-y-2">
                        <label className="text-sm text-zinc-400">{tr(language, '当前默认发布来源', 'Current Default Publish Source')}</label>
                        <div className="rounded-xl border border-zinc-800 bg-[#09090b] px-3 py-3 text-sm text-zinc-200">
                          {currentGitBindingLabel}
                        </div>
                        {bindingState?.binding?.authSourceType === 'github-app-installation' ? (
                          <p className="text-xs leading-5 text-amber-400">
                            {tr(language, '当前项目绑定的是 GitHub App installation。这里已经可以直接切换到其他 installation，仓库级精细选择会在后续入口补上。', 'This project is currently bound to a GitHub App installation. You can switch installations here now; repository-level selection will be added in a follow-up entry.')}
                          </p>
                        ) : null}
                      </div>
                    </div>

                    <div className="border border-zinc-800 bg-zinc-950/70 p-4">
                      <div className="space-y-2">
                        <label className="text-sm text-zinc-400">{tr(language, '绑定来源', 'Binding Source')}</label>
                        <NativeSelect
                          value={gitBindingMode}
                          onChange={(event) => setGitBindingMode(event.target.value as typeof gitBindingMode)}
                          options={[
                            { value: 'none', label: tr(language, '不显式绑定', 'No Explicit Binding') },
                            { value: 'credential', label: tr(language, 'PAT / SSH 身份', 'PAT / SSH Identity') },
                            { value: 'github-app', label: tr(language, 'GitHub App Installation', 'GitHub App Installation') },
                          ]}
                        />
                      </div>
                    </div>

                    {gitBindingMode === 'credential' ? (
                      <div className="border border-zinc-800 bg-zinc-950/70 p-4">
                        <div className="space-y-2">
                          <label className="text-sm text-zinc-400">{tr(language, '我的 Git 身份绑定', 'My Git Identity Binding')}</label>
                          <SearchableSelect
                            value={selectedCredentialId}
                            options={[
                              { value: '', label: tr(language, '暂不绑定', 'No binding'), description: tr(language, '允许公开仓库先跑通；私有仓库建议明确绑定', 'Useful for public repositories; private repositories should bind an identity explicitly') },
                              ...filteredCredentials.map((credential) => ({
                                value: credential.id,
                                label: `${credential.label} · ${credential.name}`,
                                description: `${credential.provider.toUpperCase()} · ${credential.host} · ${credential.authMode.toUpperCase()}${credential.authMode === 'ssh' ? credential.activated ? ` · ${tr(language, '已验证', 'Verified')}` : ` · ${tr(language, '未验证', 'Not verified')}` : ''}${credential.isDefault ? ` · ${tr(language, '默认', 'Default')}` : ''}`,
                                keywords: [credential.email, credential.host],
                              })),
                            ]}
                            placeholder={filteredCredentials.length > 0 ? tr(language, '选择我的 Git 身份', 'Select my Git identity') : repoHost ? tr(language, '当前 Host 暂无可用身份', 'No identity available for this host') : tr(language, '先去设置页添加 Git 身份', 'Add a Git identity in Settings first')}
                            searchPlaceholder={tr(language, '搜索我的 Git 身份', 'Search my Git identities')}
                            emptyText={tr(language, '没有匹配的 Git 身份', 'No matching Git identities')}
                            onChange={setSelectedCredentialId}
                          />
                          {repoHost ? <p className="text-xs text-zinc-500">{tr(language, '当前只显示与', 'Only identities matching')} `{repoHost}` {tr(language, '匹配的身份，避免把 GitHub / GitLab token 绑错项目。', 'are shown to avoid binding a GitHub / GitLab token to the wrong project.')}</p> : null}
                          <div className="flex flex-wrap gap-2 pt-2">
                            <Button
                              type="button"
                              onClick={() => void handleSaveGitBinding()}
                              disabled={bindingBusy || !selectedCredentialId}
                              className={dialogPrimaryButtonClass}
                            >
                              {bindingBusy
                                ? tr(language, '验证中...', 'Verifying...')
                                : selectedCredential?.authMode === 'ssh'
                                  ? tr(language, '验证仓库并保存', 'Verify Repository and Save')
                                  : tr(language, '保存绑定', 'Save Binding')}
                            </Button>
                            <Button
                              type="button"
                              variant="outline"
                              onClick={() => {
                                setGitBindingMode('none')
                                setSelectedCredentialId('')
                              }}
                              disabled={bindingBusy || !bindingState?.binding}
                              className={dialogSecondaryButtonClass}
                            >
                              {tr(language, '取消绑定', 'Remove Binding')}
                            </Button>
                          </div>
                        </div>
                      </div>
                    ) : null}

                    {gitBindingMode === 'github-app' ? (
                      <div className="border border-zinc-800 bg-zinc-950/70 p-4">
                        <div className="space-y-2">
                          <label className="text-sm text-zinc-400">{tr(language, 'GitHub App Installation', 'GitHub App Installation')}</label>
                          <SearchableSelect
                            value={selectedGitHubInstallationId}
                            options={githubAppInstallations.map((installation) => ({
                              value: String(installation.installationId),
                              label: `${installation.accountLogin} · #${installation.installationId}`,
                              description: `${installation.providerHost} · ${installation.repositorySelection}`,
                              keywords: [installation.accountLogin, installation.providerHost],
                            }))}
                            placeholder={githubAppInstallations.length > 0 ? tr(language, '选择 GitHub App installation', 'Select GitHub App installation') : tr(language, '先去设置页连接 GitHub', 'Connect GitHub in Settings first')}
                            searchPlaceholder={tr(language, '搜索 installation', 'Search installations')}
                            emptyText={tr(language, '没有匹配的 installation', 'No matching installations')}
                            onChange={setSelectedGitHubInstallationId}
                          />
                          {selectedGitHubInstallation ? (
                            <p className="text-xs text-zinc-500">
                              {tr(language, '执行前会为该 installation 临时换取 GitHub token。仓库级选择 UI 还没补，这一步先绑定到 installation 级别。', 'Wemux will request a short-lived GitHub token for this installation before execution. Repository-level selection UI is not added yet, so binding is currently installation-level.')}
                            </p>
                          ) : null}
                          <div className="flex flex-wrap gap-2 pt-2">
                            <Button
                              type="button"
                              onClick={() => void handleSaveGitBinding()}
                              disabled={bindingBusy || !selectedGitHubInstallationId}
                              className={dialogPrimaryButtonClass}
                            >
                              {bindingBusy ? tr(language, '保存中...', 'Saving...') : tr(language, '保存绑定', 'Save Binding')}
                            </Button>
                          </div>
                        </div>
                      </div>
                    ) : null}

                    {gitBindingMode === 'none' ? (
                      <div className="border border-zinc-800 bg-zinc-950/70 p-4">
                        <div className="space-y-2">
                          <p className="text-sm text-zinc-300">{tr(language, '当前项目不设置显式绑定，将回退到默认 Git 身份解析逻辑。', 'This project has no explicit binding and will fall back to the default Git identity resolution logic.')}</p>
                          <div className="flex flex-wrap gap-2 pt-2">
                            <Button
                              type="button"
                              onClick={() => void handleSaveGitBinding()}
                              disabled={bindingBusy}
                              className={dialogPrimaryButtonClass}
                            >
                              {bindingBusy ? tr(language, '保存中...', 'Saving...') : tr(language, '清除显式绑定', 'Clear Explicit Binding')}
                            </Button>
                          </div>
                        </div>
                      </div>
                    ) : null}

                    <div className="border border-zinc-800 bg-zinc-950/70 p-4">
                      <p className="text-sm font-medium text-zinc-100">{tr(language, '组织成员绑定状态', 'Organization Member Binding Status')}</p>
                      <div className="mt-3 grid gap-2">
                        {(bindingState?.members ?? []).map((member) => (
                          <div key={member.id} className="flex items-center justify-between rounded-xl border border-zinc-800 bg-[#09090b] px-3 py-3 text-sm">
                            <div>
                              <div className="text-zinc-100">{member.name}</div>
                              <div className="text-xs text-zinc-500">{member.email}</div>
                            </div>
                            <span className={cn(
                              'rounded-full border px-2.5 py-1 text-xs',
                              member.hasBinding
                                ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-200'
                                : 'border-zinc-700 bg-zinc-900 text-zinc-400',
                            )}
                            >
                              {member.hasBinding ? tr(language, '已绑定', 'Bound') : tr(language, '未绑定', 'Not bound')}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                ) : null}

                {activeSection === 'executor' ? (
                  <div className="space-y-5">
                    <div className="border border-zinc-800 bg-zinc-950/70 p-4">
                      <div className="space-y-2">
                        <label className="text-sm text-zinc-400">{tr(language, '默认节点', 'Default Executor')}</label>
                        <ExecutorSelect
                          value={draft.preferredExecutorId}
                          options={[
                            { value: '', label: tr(language, '自动选择', 'Auto select'), statusTone: 'neutral' },
                            ...executorOptions.map((executor) => ({
                              value: executor.executorId,
                              label: executor.name,
                              description: `${executor.machineName} · ${executor.visibility}`,
                              keywords: [executor.machineName],
                              statusTone: executor.status === 'online' ? 'online' : 'offline',
                            })),
                          ]}
                          placeholder={tr(language, '自动选择', 'Auto select')}
                          searchPlaceholder={tr(language, '搜索节点', 'Search executors')}
                          emptyText={tr(language, '没有匹配的节点', 'No matching executors')}
                          onChange={(value) => onDraftChange({ ...draft, preferredExecutorId: value })}
                        />
                        <p className="text-xs text-zinc-500">{tr(language, '创建任务时会优先把远端任务派发到这里；留空则由控制面自动调度。', 'Remote tasks are dispatched here first by default; leave blank to let the control plane schedule automatically.')}</p>
                      </div>
                    </div>
                  </div>
                ) : null}

                {activeSection === 'environment' ? (
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-medium text-zinc-100">{tr(language, '环境模板', 'Environment Template')}</p>
                      <div className="flex flex-wrap justify-end gap-2">
                        {project && onReimportEnvironmentTemplate ? (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => void onReimportEnvironmentTemplate()}
                            disabled={busy || reimportBusy || projectSettingsSyncing}
                            className="text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100 disabled:text-zinc-700 disabled:opacity-100"
                          >
                            <RefreshCw className={reimportBusy ? 'mr-1.5 h-3.5 w-3.5 animate-spin' : 'mr-1.5 h-3.5 w-3.5'} />
                            {tr(language, '重新导入', 'Re-import')}
                          </Button>
                        ) : null}
                      </div>
                    </div>

                    <EnvironmentTemplateEditor
                      value={environmentTemplateEditorValue}
                      onChange={handleEnvironmentTemplateChange}
                    />
                  </div>
                ) : null}

                {activeSection === 'runtime-environment' ? (
                  <div className="space-y-5">
                    <RuntimeEnvironmentEditor
                      title={tr(language, '项目级环境变量', 'Project Runtime Environment')}
                      description={tr(language, '可选择注入终端环境，或写入项目目录中的相对文件。工作区级配置会覆盖同名键。支持 ${{ KEY }} 引用与 preview/node 平台变量。', 'Inject into terminal env or write to a relative file in the project. Workspace-level config overrides same keys. Supports ${{ KEY }} refs and preview/node platform vars.')}
                      config={runtimeEnvironmentConfig}
                      summary={runtimeEnvironmentSummary}
                      onChange={setRuntimeEnvironmentConfig}
                      chrome="minimal"
                      scope="project"
                      fileNameStatus={runtimeEnvironmentImporting ? tr(language, '读取 .env 中...', 'Importing .env...') : ''}
                      fileNameStatusBusy={runtimeEnvironmentImporting}
                    />
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-end">
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => void handleImportRuntimeEnvironment()}
                        disabled={runtimeEnvironmentLoading || runtimeEnvironmentSaving || runtimeEnvironmentImporting}
                        className={dialogSecondaryButtonClass}
                      >
                        <FileDown data-icon="inline-start" />
                        {tr(language, '读取 .env', 'Import .env')}
                      </Button>
                      <Button
                        type="button"
                        onClick={() => void handleSaveRuntimeEnvironment()}
                        disabled={runtimeEnvironmentLoading || runtimeEnvironmentSaving || runtimeEnvironmentImporting || runtimeEnvironmentIssues.length > 0}
                        className={dialogPrimaryButtonClass}
                      >
                        {runtimeEnvironmentSaving ? tr(language, '保存中...', 'Saving...') : tr(language, '保存并写入项目文件', 'Save and write project file')}
                      </Button>
                    </div>
                  </div>
                ) : null}

                {activeSection === 'delete-project' && project && onDelete ? (
                  <div className="space-y-5">
                    <div className="border border-rose-500/30 bg-rose-500/5 p-4">
                      <div className="space-y-2">
                        <p className="text-sm font-medium text-rose-100">{tr(language, '删除项目', 'Delete Project')}</p>
                        <p className="text-sm leading-6 text-rose-100/80">
                          {tr(language, '删除后会同时移除关联任务、工作区和会话记录。', 'Deleting a project also removes related tasks, workspaces, and session records.')}
                        </p>
                      </div>

                      <div className="mt-4 space-y-4 border-t border-rose-500/20 pt-4">
                        <label className="space-y-2">
                          <span className="block text-sm text-rose-100">{tr(language, '输入项目名称以确认', 'Type project name to confirm')}</span>
                          <Input
                            value={deleteProjectNameInput}
                            onChange={(e) => setDeleteProjectNameInput(e.target.value)}
                            placeholder={project.name}
                            className="border-rose-500/30 bg-zinc-950/90 text-zinc-100 placeholder:text-zinc-600 focus-visible:border-rose-400 focus-visible:ring-rose-500/20"
                          />
                          <p className="text-xs leading-5 text-rose-100/70">
                            {tr(language, `请输入「${project.name}」后再删除。`, `Type "${project.name}" before deleting.`)}
                          </p>
                        </label>

                        {canDeleteManagedProjectDirectory ? (
                          <label className="flex cursor-pointer items-start gap-3">
                            <Checkbox
                              checked={deleteProjectDirectory}
                              onCheckedChange={(checked) => setDeleteProjectDirectory(checked === true)}
                              disabled={busy || deletingProject}
                              className="mt-0.5 border-rose-300/40 data-[state=checked]:border-rose-400 data-[state=checked]:bg-rose-500"
                            />
                            <span className="space-y-1">
                              <span className="block text-sm text-rose-100">{tr(language, '同时删除项目目录', 'Also delete project directory')}</span>
                              <span className="block break-all font-mono text-xs leading-5 text-rose-100/70">
                                {project.rootPath?.trim()
                                  ? project.rootPath
                                  : tr(language, '当前项目没有可删除的目录路径。', 'This project does not have a removable directory path.')}
                              </span>
                            </span>
                          </label>
                        ) : project.rootPath?.trim() ? (
                          <div className="border border-zinc-800/80 bg-zinc-950/50 p-3">
                            <p className="text-xs leading-5 text-zinc-300">
                              {tr(language, '当前路径不是 Wemux 托管目录；删除项目时只会移除项目记录，不会删除本机目录。', 'This path is not managed by Wemux. Deleting the project removes the project record only and keeps the local directory.')}
                            </p>
                            <p className="mt-2 break-all font-mono text-xs leading-5 text-zinc-500">{project.rootPath}</p>
                          </div>
                        ) : null}

                        <div className="flex flex-wrap items-center justify-end gap-3 border-t border-rose-500/20 pt-4">
                          <Button
                            type="button"
                            variant="destructive"
                            disabled={deleteProjectDisabled}
                            onClick={() => void handleDeleteProject()}
                            className={dialogDangerButtonClass}
                          >
                            {deletingProject
                              ? tr(language, '删除中...', 'Deleting...')
                              : canDeleteManagedProjectDirectory && deleteProjectDirectory
                              ? tr(language, '删除项目和目录', 'Delete Project and Directory')
                              : tr(language, '删除项目', 'Delete Project')}
                          </Button>
                        </div>
                      </div>
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        </div>

        <div className="flex shrink-0 justify-end border-t border-zinc-800/80 bg-[#09090b] px-4 py-3 pb-[calc(env(safe-area-inset-bottom,0px)+0.75rem)] sm:px-5 lg:pb-3">
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={deletingProject} className={dialogSecondaryButtonClass}>
              {tr(language, '取消', 'Cancel')}
            </Button>
            <Button onClick={() => void handleSubmitProject()} disabled={submitDisabled} className={dialogPrimaryButtonClass}>
              {isCloning ? tr(language, '处理中...', 'Processing...') : tr(language, '保存更改', 'Save Changes')}
            </Button>
          </div>
        </div>
    </>
  )

  if (usesCompactLayout) {
    return (
      <Drawer open={open} onOpenChange={onOpenChange} direction="bottom">
        <DrawerContent
          className="border-zinc-800 bg-[#09090b] p-0 text-zinc-100 shadow-2xl shadow-black/40 data-[vaul-drawer-direction=bottom]:inset-0 data-[vaul-drawer-direction=bottom]:h-[100dvh] data-[vaul-drawer-direction=bottom]:max-h-[100dvh] data-[vaul-drawer-direction=bottom]:rounded-none data-[vaul-drawer-direction=bottom]:border-0"
        >
          {dialogBody}
        </DrawerContent>
      </Drawer>
    )
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="!flex !flex-col left-0 top-0 h-[100dvh] max-h-[100dvh] w-screen max-w-none translate-x-0 translate-y-0 overflow-hidden border-0 border-zinc-800 bg-[#09090b] p-0 text-zinc-100 lg:left-[50%] lg:top-[50%] lg:h-[min(88vh,56rem)] lg:max-h-[min(88vh,56rem)] lg:w-[min(100vw-3rem,64rem)] lg:-translate-x-1/2 lg:-translate-y-1/2 lg:border"
      >
        {dialogBody}
      </DialogContent>
    </Dialog>
  )
}
