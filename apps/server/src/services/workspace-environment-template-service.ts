// [INPUT]: 环境模板请求
// [OUTPUT]: 渲染结果
// [POS]: 工作区环境模板服务
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import { mergeImportedProjectEnvironmentTemplate, resolveEffectiveProjectEnvironmentTemplate } from '@shared/project-environment-template'
import type { Project, ProjectEnvironmentTemplate, WorkspaceRecord } from '@shared/types'
import { detectProjectEnvironmentTemplate } from '../control-plane/project-environment-service'
import {
  deleteWorkspaceEnvironmentTemplateConfig,
  getWorkspaceEnvironmentTemplateConfig,
  setWorkspaceEnvironmentTemplateConfig,
} from '../storage/postgres/workspace-environment-template-store'
import { normalizeProjectEnvironmentTemplate } from '../routes/project-route-shared'

export const getWorkspaceEnvironmentTemplate = async (workspaceId: string) => {
  return normalizeProjectEnvironmentTemplate(await getWorkspaceEnvironmentTemplateConfig(workspaceId) ?? undefined) ?? null
}

export const saveWorkspaceEnvironmentTemplate = async (workspaceId: string, template?: ProjectEnvironmentTemplate | null) => {
  const normalized = normalizeProjectEnvironmentTemplate(template ?? undefined)
  if (!normalized) {
    await deleteWorkspaceEnvironmentTemplateConfig(workspaceId)
    return null
  }

  await setWorkspaceEnvironmentTemplateConfig(workspaceId, normalized)
  return normalized
}

export const clearWorkspaceEnvironmentTemplate = async (workspaceId: string) => {
  await deleteWorkspaceEnvironmentTemplateConfig(workspaceId)
}

export const resolveWorkspaceEffectiveEnvironmentTemplate = async (project: Pick<Project, 'environmentTemplate'>, workspaceId: string) => {
  const workspaceEnvironmentTemplate = await getWorkspaceEnvironmentTemplate(workspaceId)
  return resolveEffectiveProjectEnvironmentTemplate({
    project,
    workspaceEnvironmentTemplate,
  }) ?? null
}

export const importWorkspaceEnvironmentTemplate = async (params: {
  project: Pick<Project, 'environmentTemplate'>
  workspace: Pick<WorkspaceRecord, 'id' | 'repoPath' | 'executorNodeId'>
  importPath?: string
  executorId?: string
}) => {
  const importPath = params.importPath?.trim() || params.workspace.repoPath
  const executorId = params.executorId?.trim() || params.workspace.executorNodeId
  const detected = await detectProjectEnvironmentTemplate({
    rootPath: importPath,
    executorId,
    repoPath: importPath,
  })
  if (!detected) {
    return null
  }

  const current = await getWorkspaceEnvironmentTemplate(params.workspace.id)
  const merged = normalizeProjectEnvironmentTemplate(mergeImportedProjectEnvironmentTemplate({
    current,
    imported: detected,
  }))
  if (!merged) {
    return null
  }

  await setWorkspaceEnvironmentTemplateConfig(params.workspace.id, merged)
  return merged
}
