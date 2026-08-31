// [INPUT]: runtime 环境请求
// [OUTPUT]: 执行载荷
// [POS]: runtime 环境服务
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import {
  DEFAULT_RUNTIME_ENVIRONMENT_FILE_NAME,
  getRuntimeEnvironmentSummary,
  normalizeRuntimeEnvironmentConfig,
  resolveRuntimeEnvironmentExecution,
  validateRuntimeEnvironmentConfig,
  type RuntimeEnvironmentConfig,
  type RuntimeEnvironmentReferenceContext,
} from '@shared/runtime-environment'
import type { ExecutorRecord, Project, Task, Workspace, WorkspaceSession } from '@shared/types'
import { listWorkspaces } from '../storage/distributed-task-store'
import {
  deleteProjectRuntimeEnvironmentConfig,
  deleteWorkspaceRuntimeEnvironmentConfig,
  getProjectRuntimeEnvironmentConfig,
  getWorkspaceRuntimeEnvironmentConfig,
  setProjectRuntimeEnvironmentConfig,
  setWorkspaceRuntimeEnvironmentConfig,
} from '../storage/postgres/runtime-environment-store'

const assertRuntimeEnvironmentConfigValid = (config?: RuntimeEnvironmentConfig | null, scopeLabel = '环境变量配置') => {
  const issues = validateRuntimeEnvironmentConfig(config)
  if (issues.length === 0) {
    return
  }

  throw new Error(issues[0]?.message || `${scopeLabel}无效。`)
}

export type RuntimeEnvironmentPlatformPreviewInput = {
  publicUrl?: string
  publicOrigin?: string
  publicHost?: string
  port?: number | string
}

export type RuntimeEnvironmentPlatformContextInput = {
  project?: Pick<Project, 'id'> | { id?: string } | null
  workspace?: Pick<Workspace, 'id'> | { id?: string } | null
  workspaceSession?: Pick<WorkspaceSession, 'id'> | { id?: string } | null
  task?: Pick<Task, 'id'> | { id?: string } | null
  preview?: RuntimeEnvironmentPlatformPreviewInput | null
  executor?: Pick<
    ExecutorRecord,
    | 'executorId'
    | 'name'
    | 'machineName'
    | 'previewIngressDetectedPublicIp'
    | 'previewIngressDetectedLanIp'
    | 'presence'
  > | null
}

const setPlatformVariable = (
  variables: Record<string, string | undefined>,
  key: string,
  value: string | number | undefined | null,
) => {
  if (value === undefined || value === null) {
    return
  }
  const normalized = typeof value === 'number' ? String(value) : value.trim()
  if (!normalized) {
    return
  }
  variables[key] = normalized
  // 品牌迁移兼容窗口：`${{ vibemux.* }}` 是存量模板引用前缀，与新前缀同时发布
  variables[`wemux.${key}`] = normalized
  variables[`vibemux.${key}`] = normalized
}

const derivePublicOrigin = (publicUrl?: string, publicOrigin?: string) => {
  const explicit = publicOrigin?.trim()
  if (explicit) {
    return explicit
  }
  const url = publicUrl?.trim()
  if (!url) {
    return undefined
  }
  try {
    return new URL(url).origin
  } catch {
    return undefined
  }
}

/**
 * Build explicit-only platform variables for `${{ preview.* }}` / `${{ node.* }}` etc.
 * Values are only present when the caller supplies them; nothing is injected by default.
 */
export const buildRuntimeEnvironmentPlatformVariables = (
  input: RuntimeEnvironmentPlatformContextInput = {},
): Record<string, string | undefined> => {
  const variables: Record<string, string | undefined> = {}
  const mesh = input.executor?.presence?.mesh

  setPlatformVariable(variables, 'project.id', input.project?.id)
  setPlatformVariable(variables, 'workspace.id', input.workspace?.id)
  setPlatformVariable(variables, 'workspaceSession.id', input.workspaceSession?.id)
  setPlatformVariable(variables, 'task.id', input.task?.id)

  setPlatformVariable(variables, 'preview.publicUrl', input.preview?.publicUrl)
  setPlatformVariable(variables, 'preview.publicOrigin', derivePublicOrigin(input.preview?.publicUrl, input.preview?.publicOrigin))
  setPlatformVariable(variables, 'preview.publicHost', input.preview?.publicHost)
  setPlatformVariable(variables, 'preview.port', input.preview?.port)

  setPlatformVariable(variables, 'node.id', input.executor?.executorId)
  setPlatformVariable(variables, 'node.name', input.executor?.name)
  setPlatformVariable(variables, 'node.machineName', input.executor?.machineName)
  setPlatformVariable(variables, 'node.publicIp', input.executor?.previewIngressDetectedPublicIp)
  setPlatformVariable(variables, 'node.lanIp', input.executor?.previewIngressDetectedLanIp)
  setPlatformVariable(variables, 'node.meshIp', mesh?.meshIpv4)
  setPlatformVariable(variables, 'node.meshHostname', mesh?.meshHostname)

  return variables
}

export const buildRuntimeEnvironmentReferenceContext = (params: {
  platform?: RuntimeEnvironmentPlatformContextInput
  missingPlatformVariable?: RuntimeEnvironmentReferenceContext['missingPlatformVariable']
} = {}): RuntimeEnvironmentReferenceContext => {
  return {
    platformVariables: buildRuntimeEnvironmentPlatformVariables(params.platform),
    missingPlatformVariable: params.missingPlatformVariable ?? 'preserve',
  }
}

export const getProjectRuntimeEnvironmentDetail = async (projectId: string) => {
  const config = await getProjectRuntimeEnvironmentConfig(projectId)
  return {
    config,
    summary: getRuntimeEnvironmentSummary(config),
  }
}

export const getProjectRuntimeEnvironmentConfigForProject = async (projectId: string) => {
  return getProjectRuntimeEnvironmentConfig(projectId)
}

export const getWorkspaceRuntimeEnvironmentDetail = async (workspaceId: string) => {
  const config = await getWorkspaceRuntimeEnvironmentConfig(workspaceId)
  return {
    config,
    summary: getRuntimeEnvironmentSummary(config),
  }
}

export const resolveScopedRuntimeEnvironment = async (params: {
  projectId?: string
  workspaceId?: string
  referenceContext?: RuntimeEnvironmentReferenceContext
}) => {
  const projectId = params.projectId?.trim()
  const workspaceId = params.workspaceId?.trim()
  if (!projectId && !workspaceId) {
    return null
  }

  const workspace = workspaceId
    ? listWorkspaces().find((item) => item.id === workspaceId) ?? null
    : null
  const projectConfig = workspace
    ? await getProjectRuntimeEnvironmentConfig(workspace.projectId)
    : projectId
      ? await getProjectRuntimeEnvironmentConfig(projectId)
      : null
  const workspaceConfig = workspaceId
    ? await getWorkspaceRuntimeEnvironmentConfig(workspaceId)
    : null

  return resolveRuntimeEnvironmentExecution({
    projectConfig,
    workspaceConfig,
    referenceContext: params.referenceContext,
  })
}

export const saveProjectRuntimeEnvironmentConfig = async (projectId: string, config?: RuntimeEnvironmentConfig | null) => {
  const normalized = normalizeRuntimeEnvironmentConfig(config)
  if (!normalized || !normalized.content.trim()) {
    await deleteProjectRuntimeEnvironmentConfig(projectId)
    return null
  }

  assertRuntimeEnvironmentConfigValid(normalized, '项目级环境变量配置')
  await setProjectRuntimeEnvironmentConfig(projectId, normalized)
  return normalized
}

export const importProjectRuntimeEnvironmentIfEmpty = async (params: {
  projectId: string
  content?: string | null
  fileName?: string
}) => {
  const existing = await getProjectRuntimeEnvironmentConfig(params.projectId)
  if (existing?.content.trim()) {
    return { imported: false as const, reason: 'already-configured' as const, config: existing }
  }

  const content = params.content ?? ''
  if (!content.trim()) {
    return { imported: false as const, reason: 'empty' as const, config: null }
  }

  const config = await saveProjectRuntimeEnvironmentConfig(params.projectId, {
    mode: 'process-env',
    fileName: params.fileName?.trim() || DEFAULT_RUNTIME_ENVIRONMENT_FILE_NAME,
    content,
  })

  return { imported: Boolean(config), reason: config ? undefined : 'empty' as const, config }
}

export const saveWorkspaceRuntimeEnvironmentConfig = async (workspaceId: string, config?: RuntimeEnvironmentConfig | null) => {
  const normalized = normalizeRuntimeEnvironmentConfig(config)
  if (!normalized || !normalized.content.trim()) {
    await deleteWorkspaceRuntimeEnvironmentConfig(workspaceId)
    return null
  }

  assertRuntimeEnvironmentConfigValid(normalized, '工作区级环境变量配置')
  await setWorkspaceRuntimeEnvironmentConfig(workspaceId, normalized)
  return normalized
}

export const resolveProjectRuntimeEnvironment = async (
  projectId: string,
  referenceContext?: RuntimeEnvironmentReferenceContext,
) => {
  return resolveRuntimeEnvironmentExecution({
    projectConfig: await getProjectRuntimeEnvironmentConfig(projectId),
    referenceContext,
  })
}

export const resolveWorkspaceRuntimeEnvironment = async (
  workspaceId: string,
  referenceContext?: RuntimeEnvironmentReferenceContext,
) => {
  const workspace = listWorkspaces().find((item) => item.id === workspaceId)
  if (!workspace) {
    return null
  }

  return resolveRuntimeEnvironmentExecution({
    projectConfig: await getProjectRuntimeEnvironmentConfig(workspace.projectId),
    workspaceConfig: await getWorkspaceRuntimeEnvironmentConfig(workspaceId),
    referenceContext,
  })
}
