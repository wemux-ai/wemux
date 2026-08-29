// [INPUT]: 项目删除请求
// [OUTPUT]: 关联清理
// [POS]: 项目删除服务
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import { lstat, rm } from 'node:fs/promises'
import type { Project } from '@shared/types'
import { isManagedWorkspaceOwnedProjectPath } from '@shared/workspace-paths'
import { listVisibleExecutorsForUser } from '../control-plane/collaboration'
import { executorWsService } from '../control-plane/executor-ws-service'
import { resolveManagedPath, buildProtectedProjectDeletionRoots, getProjectDirectoryDeletionIssue } from './local-project-root'
import { resolveProjectRuntimeRootPath } from './workspace-repo-path'
import { listProjectBindings } from '../storage/distributed-task-store'

const buildExecutorDeleteDirectoryCommand = (targetPath: string) => {
  const encodedTargetPath = Buffer.from(targetPath, 'utf8').toString('base64')
  return `node -e "const fs=require('node:fs');const target=Buffer.from(process.argv[1],'base64').toString('utf8');const stats=fs.lstatSync(target,{throwIfNoEntry:false});if(!stats){console.log('missing');process.exit(0)}if(stats.isSymbolicLink()){throw new Error('symbolic link roots are not supported')}if(!stats.isDirectory()){throw new Error('target is not a directory')}fs.rmSync(target,{recursive:true,force:true});console.log('deleted')" ${encodedTargetPath}`
}

const buildDeleteFailureMessage = (targetPath: string, output?: string) => {
  const detail = output?.trim()
  return detail
    ? `删除项目目录失败：${targetPath}\n${detail}`
    : `删除项目目录失败：${targetPath}`
}

const isManagedProjectDirectory = (
  targetPath: string,
  project: Pick<Project, 'name' | 'gitUrl'>,
  workspaceRoots: Array<string | undefined>,
) => (
  isManagedWorkspaceOwnedProjectPath(targetPath, project)
  || workspaceRoots.some((workspaceRoot) => isManagedWorkspaceOwnedProjectPath(targetPath, project, workspaceRoot))
)

const deleteProjectDirectoryLocally = async (targetPath: string, protectedRoots: string[]) => {
  const issue = getProjectDirectoryDeletionIssue(targetPath, protectedRoots)
  if (issue) {
    throw new Error(issue)
  }

  const stats = await lstat(targetPath).catch(() => null)
  if (!stats) {
    return { deleted: false as const, path: targetPath, message: `项目目录不存在，已跳过目录删除：${targetPath}` }
  }
  if (stats.isSymbolicLink()) {
    throw new Error(`不支持删除符号链接项目目录：${targetPath}`)
  }
  if (!stats.isDirectory()) {
    throw new Error(`项目目录不是文件夹：${targetPath}`)
  }

  await rm(targetPath, { recursive: true, force: true })
  return { deleted: true as const, path: targetPath, message: `已删除项目目录：${targetPath}` }
}

const resolveExecutorDeletionTarget = (params: {
  project: Pick<Project, 'id' | 'rootPath' | 'preferredExecutorId' | 'versionControl' | 'name' | 'gitUrl'>
  targetPath: string
  userId: string
}) => {
  const activeBindings = listProjectBindings()
    .filter((binding) => binding.projectId === params.project.id && binding.isActive)
  const visibleExecutors = listVisibleExecutorsForUser(params.userId)
  const visibleById = new Map(visibleExecutors.map((executor) => [executor.executorId, executor]))
  const orderedExecutors = [
    params.project.preferredExecutorId?.trim(),
    ...activeBindings.map((binding) => binding.nodeId),
    ...visibleExecutors.map((executor) => executor.executorId),
  ]
    .filter((value): value is string => Boolean(value))
    .filter((value, index, values) => values.indexOf(value) === index)
    .map((executorId) => visibleById.get(executorId))
    .filter((executor): executor is NonNullable<typeof executor> => Boolean(executor))

  for (const executor of orderedExecutors) {
    const bindingPath = activeBindings.find((binding) => binding.nodeId === executor.executorId)?.pathHint
    const normalizedBindingPath = resolveManagedPath(bindingPath)
    if (normalizedBindingPath && normalizedBindingPath === params.targetPath) {
      return {
        executorId: executor.executorId,
        workspaceRoot: executor.workspaceRoot,
        targetPath: normalizedBindingPath,
      }
    }

    const runtimeRootPath = resolveManagedPath(resolveProjectRuntimeRootPath(params.project as Project, executor.workspaceRoot, undefined, params.userId))
    if (runtimeRootPath && runtimeRootPath === params.targetPath) {
      return {
        executorId: executor.executorId,
        workspaceRoot: executor.workspaceRoot,
        targetPath: runtimeRootPath,
      }
    }
  }

  return null
}

const deleteProjectDirectoryOnExecutor = async (params: {
  executorId: string
  workspaceRoot?: string
  targetPath: string
  protectedRoots: string[]
}) => {
  const issue = getProjectDirectoryDeletionIssue(params.targetPath, params.protectedRoots)
  if (issue) {
    throw new Error(issue)
  }

  const result = await executorWsService.requestTerminalCommand(
    params.executorId,
    buildExecutorDeleteDirectoryCommand(params.targetPath),
    params.workspaceRoot,
    { timeoutMs: 15_000 },
  )
  if (result.exitCode !== 0) {
    throw new Error(buildDeleteFailureMessage(params.targetPath, [result.stdout, result.stderr].filter(Boolean).join('\n')))
  }

  const deleted = ![result.stdout, result.stderr].join('\n').includes('missing')
  return {
    deleted,
    path: params.targetPath,
    message: deleted
      ? `已在执行器 ${params.executorId} 删除项目目录：${params.targetPath}`
      : `执行器 ${params.executorId} 上的项目目录不存在，已跳过目录删除：${params.targetPath}`,
  }
}

export const deleteProjectRootDirectory = async (params: {
  project: Pick<Project, 'id' | 'rootPath' | 'preferredExecutorId' | 'versionControl' | 'name' | 'gitUrl'>
  userId: string
  protectedWorkspaceRoots?: Array<string | undefined>
}) => {
  const targetPath = resolveManagedPath(params.project.rootPath)
  if (!targetPath) {
    return {
      deleted: false as const,
      path: '',
      message: '项目目录未设置，已跳过目录删除。',
    }
  }

  if (!isManagedProjectDirectory(targetPath, params.project, params.protectedWorkspaceRoots ?? [])) {
    return {
      deleted: false as const,
      path: targetPath,
      message: `当前路径不是 wemux 托管目录，已跳过目录删除：${targetPath}`,
    }
  }

  const executorTarget = resolveExecutorDeletionTarget({
    project: params.project,
    targetPath,
    userId: params.userId,
  })
  const protectedRoots = buildProtectedProjectDeletionRoots([
    ...(params.protectedWorkspaceRoots ?? []),
    executorTarget?.workspaceRoot,
  ])

  if (executorTarget) {
    return deleteProjectDirectoryOnExecutor({
      executorId: executorTarget.executorId,
      workspaceRoot: executorTarget.workspaceRoot,
      targetPath: executorTarget.targetPath,
      protectedRoots,
    })
  }

  return deleteProjectDirectoryLocally(targetPath, protectedRoots)
}
