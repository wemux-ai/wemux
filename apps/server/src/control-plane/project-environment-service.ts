// [INPUT]: 项目环境模板与请求参数
// [OUTPUT]: 环境模板渲染/变量插值结果
// [POS]: 项目环境模板服务
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { DEFAULT_RUNTIME_ENVIRONMENT_FILE_NAME } from '@shared/runtime-environment'
import { parseProjectEnvironmentTemplate } from '@shared/project-environment-template'
import type { ProjectEnvironmentTemplate, ProjectEnvironmentTemplateSource } from '@shared/types'
import { executorWsService } from './executor-ws-service'

const CONFIG_FILENAMES = [
  '.wemux.yml',
  '.Wemux.yml',
  // 品牌迁移兼容窗口：存量仓库可能仍用旧名模板文件
  '.vibemux.yml',
  '.Vibemux.yml',
] as const

const RUNTIME_ENVIRONMENT_FILENAMES = [
  DEFAULT_RUNTIME_ENVIRONMENT_FILE_NAME,
] as const

const EXECUTOR_CONFIG_READ_TIMEOUT_MS = 12000

export class ProjectRuntimeEnvironmentReadError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ProjectRuntimeEnvironmentReadError'
  }
}

const loadProjectEnvironmentTemplateFromExecutor = async (executorId: string, repoPath: string) => {
  for (const filename of CONFIG_FILENAMES) {
    const configPath = path.join(repoPath, filename)
    const result = await executorWsService
      .requestFileRead(executorId, repoPath, configPath, EXECUTOR_CONFIG_READ_TIMEOUT_MS)
      .catch(() => null)
    if (!result || !result.ok || (result.encoding && result.encoding !== 'utf8') || !result.content?.trim()) {
      continue
    }

    const parsed = parseProjectEnvironmentTemplate(result.content, {
      configPath,
      source: templateSourceForFilename(filename),
    })
    if (parsed) {
      return parsed
    }
  }

  return null
}

const templateSourceForFilename = (filename: string): ProjectEnvironmentTemplateSource =>
  filename.toLowerCase().includes('vibemux') ? 'vibemux-yml' : 'wemux-yml'

const loadProjectEnvironmentTemplateFromLocalPath = (rootPath: string) => {
  const normalizedRootPath = path.resolve(rootPath)

  for (const filename of CONFIG_FILENAMES) {
    const configPath = path.join(normalizedRootPath, filename)
    if (!existsSync(configPath)) {
      continue
    }

    const parsed = parseProjectEnvironmentTemplate(readFileSync(configPath, 'utf8'), {
      configPath,
      source: templateSourceForFilename(filename),
    })
    if (parsed) {
      return parsed
    }
  }

  return null
}

const loadProjectRuntimeEnvironmentFileFromExecutor = async (executorId: string, repoPath: string) => {
  for (const filename of RUNTIME_ENVIRONMENT_FILENAMES) {
    const filePath = path.join(repoPath, filename)
    const result = await executorWsService
      .requestFileRead(executorId, repoPath, filePath, 12000)
      .catch((error) => {
        throw new ProjectRuntimeEnvironmentReadError(error instanceof Error ? error.message : '读取执行器 .env 失败。')
      })
    if (!result.ok) {
      if (/no such file|not found|不存在|ENOENT/i.test(result.message || '')) {
        continue
      }
      throw new ProjectRuntimeEnvironmentReadError(result.message || '执行器读取 .env 失败。')
    }
    if (result.encoding && result.encoding !== 'utf8') {
      throw new ProjectRuntimeEnvironmentReadError('执行器读取到的 .env 不是 UTF-8 文本文件。')
    }
    if (!result.content?.trim()) {
      continue
    }

    return {
      fileName: filename,
      content: result.content,
    }
  }

  return null
}

export const writeProjectRuntimeEnvironmentFile = async (params: {
  executorId: string
  repoPath: string
  fileName: string
  content: string
}) => {
  const filePath = path.join(params.repoPath, params.fileName)
  const result = await executorWsService
    .requestFileWrite(params.executorId, params.repoPath, filePath, params.content, 12000)
    .catch((error) => {
      throw new ProjectRuntimeEnvironmentReadError(error instanceof Error ? error.message : '写入执行器 .env 失败。')
    })
  if (!result.ok) {
    throw new ProjectRuntimeEnvironmentReadError(result.message || '执行器写入 .env 失败。')
  }

  return {
    fileName: params.fileName,
    path: filePath,
    sizeBytes: result.sizeBytes,
  }
}

const loadProjectRuntimeEnvironmentFileFromLocalPath = (rootPath: string) => {
  const normalizedRootPath = path.resolve(rootPath)

  for (const filename of RUNTIME_ENVIRONMENT_FILENAMES) {
    const filePath = path.join(normalizedRootPath, filename)
    if (!existsSync(filePath)) {
      continue
    }

    const content = readFileSync(filePath, 'utf8')
    if (!content.trim()) {
      continue
    }

    return {
      fileName: filename,
      content,
    }
  }

  return null
}

export const detectProjectEnvironmentTemplate = async (params: {
  rootPath?: string
  executorId?: string
  repoPath?: string
}): Promise<ProjectEnvironmentTemplate | null> => {
  const localRootPath = params.rootPath?.trim()
  if (localRootPath && existsSync(path.resolve(localRootPath))) {
    const localTemplate = loadProjectEnvironmentTemplateFromLocalPath(localRootPath)
    if (localTemplate) {
      return localTemplate
    }
  }

  const executorId = params.executorId?.trim()
  const repoPath = params.repoPath?.trim()
  if (executorId && repoPath) {
    return loadProjectEnvironmentTemplateFromExecutor(executorId, repoPath)
  }

  return null
}

export const detectProjectRuntimeEnvironmentFile = async (params: {
  rootPath?: string
  executorId?: string
  repoPath?: string
}): Promise<{ fileName: string; content: string } | null> => {
  const localRootPath = params.rootPath?.trim()
  if (localRootPath && existsSync(path.resolve(localRootPath))) {
    const localFile = loadProjectRuntimeEnvironmentFileFromLocalPath(localRootPath)
    if (localFile) {
      return localFile
    }
  }

  const executorId = params.executorId?.trim()
  const repoPath = params.repoPath?.trim()
  if (executorId && repoPath) {
    return loadProjectRuntimeEnvironmentFileFromExecutor(executorId, repoPath)
  }

  return null
}
