import { resolveProjectEnvironmentCommandFields } from '@shared/project-environment-template'
import type { Project, ProjectEnvironmentPort } from '@shared/types'
import { normalizeEnvironmentPortDrafts } from './preview-domain-bindings'

export type ProjectFormDraft = {
  name: string
  color: string
  gitUrl: string
  defaultBranch: string
  preferredExecutorId: string
  installCommand: string
  buildCommand: string
  testCommand: string
  lintCommand: string
  branchNamePattern: string
  envStartCommandTemplate: string
  envStopCommandTemplate: string
  envNukeCommandTemplate: string
  envAppPort: string
  envHealthPath: string
  envLogsCommandTemplate: string
  envPorts: ProjectEnvironmentPort[]
}

export type ProjectMutationPayload = {
  name: string
  color?: Project['color']
  gitUrl: string
  defaultBranch?: string
  preferredExecutorId?: string
  environmentTemplate?: Project['environmentTemplate'] | null
  recentBaseBranches?: string[]
}

export const createEmptyProjectDraft = (): ProjectFormDraft => ({
  name: '',
  color: '',
  gitUrl: '',
  defaultBranch: 'main',
  preferredExecutorId: '',
  installCommand: '',
  buildCommand: '',
  testCommand: '',
  lintCommand: '',
  branchNamePattern: '',
  envStartCommandTemplate: '',
  envStopCommandTemplate: '',
  envNukeCommandTemplate: '',
  envAppPort: '',
  envHealthPath: '',
  envLogsCommandTemplate: '',
  envPorts: [],
})

export const projectToDraft = (project?: Project): ProjectFormDraft => {
  const commands = resolveProjectEnvironmentCommandFields(project)
  const ports = project?.environmentTemplate?.ports ?? []

  return {
    name: project?.name ?? '',
    color: project?.color ?? '',
    gitUrl: project?.gitUrl ?? '',
    defaultBranch: project?.defaultBranch ?? 'main',
    preferredExecutorId: project?.preferredExecutorId ?? '',
    installCommand: commands.installCommand ?? '',
    buildCommand: commands.buildCommand ?? '',
    testCommand: commands.testCommand ?? '',
    lintCommand: commands.lintCommand ?? '',
    branchNamePattern: commands.branchNamePattern ?? '',
    envStartCommandTemplate: project?.environmentTemplate?.startCommandTemplate ?? '',
    envStopCommandTemplate: project?.environmentTemplate?.stopCommandTemplate ?? '',
    envNukeCommandTemplate: project?.environmentTemplate?.nukeCommandTemplate ?? '',
    envAppPort: project?.environmentTemplate?.appPort ?? '',
    envHealthPath: project?.environmentTemplate?.healthPath ?? '',
    envLogsCommandTemplate: project?.environmentTemplate?.logsCommandTemplate ?? '',
    envPorts: normalizeEnvironmentPortDrafts(ports),
  }
}

export const buildProjectPayload = (draft: ProjectFormDraft, project?: Project): ProjectMutationPayload => {
  const ports = normalizeEnvironmentPortDrafts(draft.envPorts)
  const environmentTemplate = {
    installCommand: draft.installCommand.trim() || undefined,
    buildCommand: draft.buildCommand.trim() || undefined,
    testCommand: draft.testCommand.trim() || undefined,
    lintCommand: draft.lintCommand.trim() || undefined,
    branchNamePattern: draft.branchNamePattern.trim() || undefined,
    startCommandTemplate: draft.envStartCommandTemplate.trim() || '',
    stopCommandTemplate: draft.envStopCommandTemplate.trim() || '',
    nukeCommandTemplate: draft.envNukeCommandTemplate.trim() || undefined,
    appPort: draft.envAppPort.trim() || undefined,
    healthPath: draft.envHealthPath.trim() || undefined,
    logsCommandTemplate: draft.envLogsCommandTemplate.trim() || undefined,
    ports,
    previewDomainBindings: project?.environmentTemplate?.previewDomainBindings,
    source: project?.environmentTemplate?.source ?? 'manual',
    configPath: project?.environmentTemplate?.configPath,
    imported: project?.environmentTemplate?.imported,
  }
  const hasEnvironmentTemplate = Boolean(
    environmentTemplate.installCommand
    || environmentTemplate.buildCommand
    || environmentTemplate.testCommand
    || environmentTemplate.lintCommand
    || environmentTemplate.branchNamePattern
    || environmentTemplate.startCommandTemplate
    || environmentTemplate.stopCommandTemplate
    || environmentTemplate.nukeCommandTemplate
    || environmentTemplate.appPort
    || environmentTemplate.healthPath
    || environmentTemplate.logsCommandTemplate
    || environmentTemplate.ports.length > 0
    || (environmentTemplate.previewDomainBindings?.length ?? 0) > 0
  )

  return {
    name: draft.name,
    color: draft.color.trim() || undefined,
    gitUrl: draft.gitUrl,
    defaultBranch: draft.defaultBranch.trim() || 'main',
    preferredExecutorId: draft.preferredExecutorId || undefined,
    environmentTemplate: hasEnvironmentTemplate ? environmentTemplate : (project?.environmentTemplate ? null : undefined),
    recentBaseBranches: project?.recentBaseBranches,
  }
}

export const resolveProjectVersionControl = (project?: Pick<Project, 'versionControl' | 'gitUrl'> | null) => {
  if (!project) {
    return 'none' as const
  }

  return project.versionControl ?? (project.gitUrl.trim() ? 'git-remote' : 'none')
}

export const getProjectVersionControlLabel = (
  project?: Pick<Project, 'versionControl' | 'gitUrl'> | null,
  t?: (key: string) => string,
) => {
  const versionControl = resolveProjectVersionControl(project)
  if (versionControl === 'git-remote') return t ? t('projectsPage.versionControl.gitRemote') : '远端 Git'
  if (versionControl === 'git-local') return t ? t('projectsPage.versionControl.gitLocal') : '本地 Git'
  return t ? t('projectsPage.versionControl.gitNone') : '未启用 Git'
}

export const getProjectVersionControlDescription = (
  project?: Pick<Project, 'versionControl' | 'gitUrl'> | null,
  t?: (key: string) => string,
) => {
  const versionControl = resolveProjectVersionControl(project)
  if (versionControl === 'git-remote') return t ? t('projectsPage.versionControl.gitRemoteDesc') : '已连接远端仓库，支持分支、隔离目录、push 和 PR 等完整 Git 工作流。'
  if (versionControl === 'git-local') return t ? t('projectsPage.versionControl.gitLocalDesc') : '已识别本地 Git 仓库，支持本地分支、diff、graph、rebase 和隔离目录；没有远端时暂不直接支持 PR。'
  return t ? t('projectsPage.versionControl.gitNoneDesc') : '当前项目由 Wemux 托管但尚未初始化 Git；暂不支持 Git diff / rebase / PR，初始化 Git 后会自动升级。'
}

export const getProjectSourceDisplay = (
  project?: Pick<Project, 'versionControl' | 'gitUrl' | 'rootPath'> | null,
  t?: (key: string) => string,
) => {
  const versionControl = resolveProjectVersionControl(project)
  if (versionControl === 'git-remote') {
    return project?.gitUrl?.trim() || project?.rootPath?.trim() || (t ? t('projectsPage.sourceDisplay.noRemoteRepoSet') : '远端仓库未设置')
  }

  return project?.rootPath?.trim() || project?.gitUrl?.trim() || (t ? t('projectsPage.sourceDisplay.noDirectorySet') : '项目目录未设置')
}
