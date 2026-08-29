// [INPUT]: 项目路由共享参数（taskId/workspaceId 解析）
// [OUTPUT]: 项目路由共享 helper（授权上下文/任务解析）
// [POS]: 项目路由共享逻辑（供项目/任务路由复用）
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import { z } from 'zod'
import { deriveProjectColor, normalizeHexColor } from '@shared/project-color'
import { normalizeEnvironmentPorts, normalizePreviewDomainBindings } from '@shared/project-environment-template'
import { resolveNextDisplayOrder } from '@shared/project-workspace-order'
import type { Project, ProjectEnvironmentTemplate } from '@shared/types'
import { canUserUseExecutorForProject } from '../control-plane/collaboration'
import { getProjectBranchSnapshotFromExecutor } from '../control-plane/executor-repo-service'
import { deactivateProjectBinding, upsertProjectBinding } from '../storage/distributed-task-store'
import { buildProjectBinding, cloneSchema, projectSchema } from './shared'
import { getManagedCloudGate } from '../services/gate/managed-cloud-gate'

const gitCredentialIdSchema = z.string().trim().optional()
const gitHubInstallationIdSchema = z.coerce.number().int().positive().optional()
const gitHubRepositoryIdSchema = z.coerce.number().int().positive().optional()
const gitHubRepositoryNameSchema = z.string().trim().optional()

export const projectWithExecutorSchema = projectSchema.extend({
  preferredExecutorId: z.string().trim().optional(),
  gitCredentialId: gitCredentialIdSchema,
  githubInstallationId: gitHubInstallationIdSchema,
  githubRepositoryId: gitHubRepositoryIdSchema,
  githubRepositoryName: gitHubRepositoryNameSchema,
})
export const projectBranchesQuerySchema = z.object({ executorId: z.string().trim().optional() })
export const cloneWithExecutorSchema = cloneSchema.extend({
  workspaceId: projectSchema.shape.workspaceId,
  visibility: projectSchema.shape.visibility,
  preferredExecutorId: z.string().trim().optional(),
  gitCredentialId: gitCredentialIdSchema,
  githubInstallationId: gitHubInstallationIdSchema,
  githubRepositoryId: gitHubRepositoryIdSchema,
  githubRepositoryName: gitHubRepositoryNameSchema,
  environmentTemplate: projectSchema.shape.environmentTemplate,
  recentBaseBranches: projectSchema.shape.recentBaseBranches,
})

export const normalizeRecentBaseBranches = (recentBaseBranches: string[] | undefined, defaultBranch?: string) => {
  const normalized = (recentBaseBranches ?? []).map((branch) => branch.trim()).filter(Boolean)
  const fallback = defaultBranch?.trim() ? [defaultBranch.trim()] : []
  const unique = [...new Set(normalized.length > 0 ? normalized : fallback)]
  return unique.slice(0, 8)
}

export const normalizeProjectEnvironmentTemplate = (template?: ProjectEnvironmentTemplate | null) => {
  const installCommand = template?.installCommand?.trim() || undefined
  const buildCommand = template?.buildCommand?.trim() || undefined
  const testCommand = template?.testCommand?.trim() || undefined
  const lintCommand = template?.lintCommand?.trim() || undefined
  const branchNamePattern = template?.branchNamePattern?.trim() || undefined
  const startCommandTemplate = template?.startCommandTemplate?.trim() || ''
  const stopCommandTemplate = template?.stopCommandTemplate?.trim() || ''
  const nukeCommandTemplate = template?.nukeCommandTemplate?.trim() || undefined
  const appPort = template?.appPort?.trim() || undefined
  const rawHealthPath = template?.healthPath?.trim()
  const healthPath = rawHealthPath ? (rawHealthPath.startsWith('/') ? rawHealthPath : `/${rawHealthPath}`) : undefined
  const logsCommandTemplate = template?.logsCommandTemplate?.trim() || undefined
  const ports = normalizeEnvironmentPorts(template?.ports)
  const previewDomainBindings = normalizePreviewDomainBindings(template?.previewDomainBindings)
  const configPath = template?.configPath?.trim() || undefined
  const imported = template?.imported
    ? {
        installCommand: template.imported.installCommand?.trim() || undefined,
        buildCommand: template.imported.buildCommand?.trim() || undefined,
        testCommand: template.imported.testCommand?.trim() || undefined,
        lintCommand: template.imported.lintCommand?.trim() || undefined,
        branchNamePattern: template.imported.branchNamePattern?.trim() || undefined,
        startCommandTemplate: template.imported.startCommandTemplate?.trim() || '',
        stopCommandTemplate: template.imported.stopCommandTemplate?.trim() || '',
        nukeCommandTemplate: template.imported.nukeCommandTemplate?.trim() || undefined,
        appPort: template.imported.appPort?.trim() || undefined,
        healthPath: template.imported.healthPath?.trim()
          ? (template.imported.healthPath.trim().startsWith('/') ? template.imported.healthPath.trim() : `/${template.imported.healthPath.trim()}`)
          : undefined,
        logsCommandTemplate: template.imported.logsCommandTemplate?.trim() || undefined,
        ports: normalizeEnvironmentPorts(template.imported.ports),
        previewDomainBindings: normalizePreviewDomainBindings(template.imported.previewDomainBindings),
        configPath: template.imported.configPath?.trim() || undefined,
      }
    : undefined
  const hasContent = Boolean(
    installCommand
    || buildCommand
    || testCommand
    || lintCommand
    || branchNamePattern
    || startCommandTemplate
    || stopCommandTemplate
    || nukeCommandTemplate
    || appPort
    || healthPath
    || logsCommandTemplate
    || ports.length > 0
    || previewDomainBindings.length > 0
  )
  if (!hasContent) {
    return undefined
  }

  return {
    installCommand,
    buildCommand,
    testCommand,
    lintCommand,
    branchNamePattern,
    startCommandTemplate,
    stopCommandTemplate,
    nukeCommandTemplate,
    appPort,
    healthPath,
    logsCommandTemplate,
    ports: ports.length > 0 ? ports : undefined,
    previewDomainBindings: previewDomainBindings.length > 0 ? previewDomainBindings : undefined,
    configPath,
    source: template?.source ?? 'manual',
    imported,
  } satisfies ProjectEnvironmentTemplate
}

export const mergeProjectEnvironmentTemplateUpdate = (
  current: ProjectEnvironmentTemplate | undefined,
  incoming: ProjectEnvironmentTemplate | null | undefined,
) => {
  if (incoming === null) {
    return undefined
  }

  if (!incoming) {
    return current
  }

  return normalizeProjectEnvironmentTemplate({
    installCommand: incoming.installCommand ?? current?.installCommand,
    buildCommand: incoming.buildCommand ?? current?.buildCommand,
    testCommand: incoming.testCommand ?? current?.testCommand,
    lintCommand: incoming.lintCommand ?? current?.lintCommand,
    branchNamePattern: incoming.branchNamePattern ?? current?.branchNamePattern,
    startCommandTemplate: incoming.startCommandTemplate ?? current?.startCommandTemplate,
    stopCommandTemplate: incoming.stopCommandTemplate ?? current?.stopCommandTemplate,
    nukeCommandTemplate: incoming.nukeCommandTemplate ?? current?.nukeCommandTemplate,
    appPort: incoming.appPort ?? current?.appPort,
    healthPath: incoming.healthPath ?? current?.healthPath,
    logsCommandTemplate: incoming.logsCommandTemplate ?? current?.logsCommandTemplate,
    ports: incoming.ports ?? current?.ports,
    previewDomainBindings: incoming.previewDomainBindings ?? current?.previewDomainBindings,
    source: incoming.source ?? current?.source ?? 'manual',
    configPath: incoming.configPath ?? current?.configPath,
    imported: incoming.imported ?? current?.imported,
  }) ?? current
}

export const createProjectRecord = (
  payload: {
    name: string
    gitUrl: string
    color?: string
    workspaceId?: string
    visibility?: Project['visibility']
    rootPath?: string
    versionControl?: Project['versionControl']
    defaultBranch?: string
    preferredExecutorId?: string
    repositoryCloneStatus?: Project['repositoryCloneStatus']
    repositoryCloneMessage?: string
    environmentTemplate?: ProjectEnvironmentTemplate | null
    recentBaseBranches?: string[]
    displayOrder?: number
  },
  creator?: { id: string; name: string; avatarUrl?: string },
) => {
  const timestamp = new Date().toISOString()
  const gitUrl = payload.gitUrl.trim()
  const versionControl = payload.versionControl ?? (gitUrl ? 'git-remote' : 'none')
  const rootPath = payload.rootPath?.trim() || undefined
  const defaultBranch = payload.defaultBranch?.trim() || 'main'
  const environmentTemplate = normalizeProjectEnvironmentTemplate(payload.environmentTemplate ?? undefined)
  return {
    id: crypto.randomUUID(),
    name: payload.name.trim(),
    displayOrder: payload.displayOrder ?? resolveNextDisplayOrder([]),
    color: normalizeHexColor(payload.color) ?? deriveProjectColor(payload.name),
    workspaceId: payload.workspaceId?.trim() || undefined,
    visibility: payload.visibility ?? 'private',
    rootPath,
    versionControl,
    gitUrl,
    defaultBranch,
    preferredExecutorId: payload.preferredExecutorId?.trim() || undefined,
    repositoryCloneStatus: payload.repositoryCloneStatus,
    repositoryCloneMessage: payload.repositoryCloneMessage?.trim() || undefined,
    environmentTemplate,
    recentBaseBranches: normalizeRecentBaseBranches(payload.recentBaseBranches, defaultBranch),
    createdById: creator?.id,
    createdByName: creator?.name,
    createdByAvatarUrl: creator?.avatarUrl,
    createdAt: timestamp,
    updatedAt: timestamp,
  }
}

export const prepareClonedProject = async (params: {
  userId: string
  project: Project
  preferredExecutorId?: string
  pathHint?: string
}) => {
  const executorId = params.preferredExecutorId?.trim()
  if (!executorId) {
    return { ok: true as const }
  }

  const access = canUserUseExecutorForProject({
    userId: params.userId,
    projectId: params.project.id,
    executorId,
  })
  if (!access.ok) {
    return { ok: false as const, status: 403, message: access.message }
  }

  if (!getManagedCloudGate().isExecutorAllowed(access.executor)) {
    return { ok: false as const, status: 403 as const, message: getManagedCloudGate().devOnlyMessage }
  }

  upsertProjectBinding(buildProjectBinding(params.project, executorId, params.pathHint))
  const snapshot = await getProjectBranchSnapshotFromExecutor(params.userId, params.project)
  if (snapshot.ok) {
    return { ok: true as const }
  }

  deactivateProjectBinding(params.project.id, executorId)
  return {
    ok: false as const,
    status: 400,
    message: snapshot.message || '仓库克隆失败，请检查 Git 地址、认证和 Worker 状态。',
  }
}
