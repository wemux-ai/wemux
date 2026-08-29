/**
 * [INPUT]: Runtime environment configs plus project/workspace executor directory targets.
 * [OUTPUT]: Immediate environment-file writes through the worker filesystem control plane.
 * [POS]: Server service bridging persisted runtime environment config to scoped worker files.
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */

import path from 'node:path'
import type { RuntimeEnvironmentConfig } from '@shared/runtime-environment'
import type { Project, ProjectBinding } from '@shared/types'
import { executorWsService } from '../control-plane/executor-ws-service'
import { writeProjectRuntimeEnvironmentFile } from '../control-plane/project-environment-service'
import { listProjectBindings } from '../storage/distributed-task-store'
import { verifyWorkspaceDirectoryReady } from './task-chat-dispatch/workspace-directory-ready'

type RuntimeEnvironmentFileWriteResult = {
  ok: boolean
  fileName?: string
  path?: string
  message?: string
}

export const selectProjectRuntimeEnvironmentBinding = (project: Pick<Project, 'id' | 'preferredExecutorId'>) => {
  const bindings = listProjectBindings().filter((binding) => binding.projectId === project.id)
  return bindings.find((binding) => (
    project.preferredExecutorId ? binding.nodeId === project.preferredExecutorId : true
  )) ?? bindings[0]
}

const resolveProjectRuntimeEnvironmentWriteBinding = (project: Pick<Project, 'id' | 'preferredExecutorId'>) => {
  const bindings = listProjectBindings().filter((binding) => binding.projectId === project.id)
  const preferredExecutorId = project.preferredExecutorId?.trim()
  if (preferredExecutorId) {
    return bindings.find((binding) => binding.nodeId === preferredExecutorId) ?? null
  }

  return bindings[0] ?? null
}

const resolveProjectRuntimeEnvironmentTarget = (
  project: Pick<Project, 'id' | 'rootPath' | 'preferredExecutorId'>,
  binding?: ProjectBinding | null,
) => {
  const repoPath = binding?.pathHint?.trim() || project.rootPath?.trim()
  const executorId = binding?.nodeId?.trim() || project.preferredExecutorId?.trim()
  return { executorId, repoPath }
}

const writeRuntimeEnvironmentFile = async (params: {
  executorId: string
  directoryPath: string
  config: RuntimeEnvironmentConfig
}): Promise<RuntimeEnvironmentFileWriteResult> => {
  const fileName = params.config.fileName || '.env'

  try {
    const written = await writeProjectRuntimeEnvironmentFile({
      executorId: params.executorId,
      repoPath: params.directoryPath,
      fileName,
      content: params.config.content,
    })
    return {
      ok: true,
      fileName: written.fileName,
      path: written.path,
    }
  } catch (error) {
    return {
      ok: false,
      fileName: params.config.fileName,
      path: path.join(params.directoryPath, fileName),
      message: error instanceof Error ? error.message : `写入 ${fileName} 失败。`,
    }
  }
}

export const materializeProjectRuntimeEnvironmentFile = async (
  project: Pick<Project, 'id' | 'rootPath' | 'preferredExecutorId'>,
  config?: RuntimeEnvironmentConfig | null,
): Promise<RuntimeEnvironmentFileWriteResult | undefined> => {
  if (config?.mode !== 'env-file') {
    return undefined
  }

  const binding = resolveProjectRuntimeEnvironmentWriteBinding(project)
  const { executorId, repoPath } = resolveProjectRuntimeEnvironmentTarget(project, binding)
  const fileName = config.fileName || '.env'

  if (!executorId || !repoPath) {
    return {
      ok: false,
      fileName: config.fileName,
      message: `当前没有项目绑定节点，未立即写入 ${fileName}。`,
    }
  }

  return writeRuntimeEnvironmentFile({
    executorId,
    directoryPath: repoPath,
    config,
  })
}

export const materializeWorkspaceRuntimeEnvironmentFile = async (params: {
  executorId?: string
  cwd?: string
  config?: RuntimeEnvironmentConfig | null
}): Promise<RuntimeEnvironmentFileWriteResult | undefined> => {
  if (params.config?.mode !== 'env-file') {
    return undefined
  }

  const fileName = params.config.fileName || '.env'
  if (!params.executorId || !params.cwd) {
    return {
      ok: false,
      fileName: params.config.fileName,
      message: `当前工作区目录不可用，未立即写入 ${fileName}。`,
    }
  }

  const directoryReady = await verifyWorkspaceDirectoryReady({
    executorId: params.executorId,
    cwd: params.cwd,
    browseDirectory: executorWsService.requestDirectoryBrowse,
  })
  if (!directoryReady.ok) {
    return {
      ok: false,
      fileName: params.config.fileName,
      path: path.join(params.cwd, fileName),
      message: directoryReady.message,
    }
  }

  return writeRuntimeEnvironmentFile({
    executorId: params.executorId,
    directoryPath: params.cwd,
    config: params.config,
  })
}
