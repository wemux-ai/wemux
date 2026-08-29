// [INPUT]: .vibemux.yml 导入
// [OUTPUT]: 基线解析
// [POS]: 环境模板导入
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import type { Project } from '@shared/types'
import { detectProjectRuntimeEnvironmentFile } from '../control-plane/project-environment-service'
import { importProjectRuntimeEnvironmentIfEmpty, saveProjectRuntimeEnvironmentConfig } from './runtime-environment-service'

export type ProjectRuntimeEnvironmentImportResult = {
  fileName: string
}

export const autoImportProjectRuntimeEnvironment = async (params: {
  project: Pick<Project, 'id' | 'name' | 'rootPath'>
  executorId?: string
  repoPath?: string
  logContext?: string
  overwrite?: boolean
}): Promise<ProjectRuntimeEnvironmentImportResult | null> => {
  try {
    const detected = await detectProjectRuntimeEnvironmentFile({
      rootPath: params.project.rootPath,
      executorId: params.executorId,
      repoPath: params.repoPath,
    })
    if (!detected) {
      return null
    }

    if (params.overwrite) {
      const config = await saveProjectRuntimeEnvironmentConfig(params.project.id, {
        mode: 'process-env',
        fileName: detected.fileName,
        content: detected.content,
      })
      return config ? { fileName: detected.fileName } : null
    }

    const result = await importProjectRuntimeEnvironmentIfEmpty({
      projectId: params.project.id,
      fileName: detected.fileName,
      content: detected.content,
    })

    return result.imported ? { fileName: detected.fileName } : null
  } catch (error) {
    console.warn('[project-runtime-environment-import] auto import failed', {
      context: params.logContext,
      projectId: params.project.id,
      projectName: params.project.name,
      executorId: params.executorId,
      repoPath: params.repoPath,
      error: error instanceof Error ? error.message : 'unknown error',
    })
    return null
  }
}

export const summarizeProjectRuntimeEnvironmentImport = (result: ProjectRuntimeEnvironmentImportResult | null) => {
  return result ? `已自动导入 ${result.fileName} 到项目环境变量。` : ''
}
