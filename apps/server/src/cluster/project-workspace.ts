import { existsSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { simpleGit } from 'simple-git'
import { createGitAuthContext, getSimpleGitOptionsForEnv, rewriteGitCredentialError } from '@shared/git-auth'
import type { AgentConfig, Project, TaskRuntimeGitIdentity } from '@shared/types'
import { buildWorkspaceProjectRootPath } from '@shared/workspace-paths'
import { clusterConfig } from './config'
import { resolveWorkspaceRepoPath } from '../lib/filesystem-paths'
import { getProjectBinding } from '../storage/distributed-task-store'

type ProjectExecutionConfig = Pick<AgentConfig, 'workspaceRoot'> & {
  gitIdentity?: TaskRuntimeGitIdentity
  ownerUserId?: string | null
  workspaceId?: string | null
}

const isGitRepo = async (repoPath: string) => {
  if (!repoPath || !existsSync(repoPath)) {
    return false
  }

  try {
    return await simpleGit(repoPath).checkIsRepo()
  } catch {
    return false
  }
}

const createGitClient = (baseDir?: string, env?: NodeJS.ProcessEnv) => {
  const options = {
    ...getSimpleGitOptionsForEnv(env),
    ...(baseDir ? { baseDir } : {}),
  }

  return simpleGit(options).env(env ?? {})
}

const ensureRepository = async (project: Project, repoPath: string, env?: NodeJS.ProcessEnv) => {
  console.log('[repo-prepare] ensure start', JSON.stringify({
    projectId: project.id,
    projectName: project.name,
    repoPath,
    gitUrl: project.gitUrl,
  }))

  mkdirSync(path.dirname(repoPath), { recursive: true })

  if (await isGitRepo(repoPath)) {
    console.log('[repo-prepare] existing repo', JSON.stringify({ projectId: project.id, repoPath }))
    const git = createGitClient(repoPath, env)
    await git.fetch(['--all', '--prune'])
    console.log('[repo-prepare] fetch complete', JSON.stringify({ projectId: project.id, repoPath }))
    return repoPath
  }

  if (!project.gitUrl.trim()) {
    throw new Error(`项目 ${project.name} 未配置 Git 地址，无法在默认工作区准备仓库。`)
  }

  console.log('[repo-prepare] cloning repo', JSON.stringify({ projectId: project.id, repoPath, gitUrl: project.gitUrl }))
  await createGitClient(undefined, env).clone(project.gitUrl, repoPath)
  console.log('[repo-prepare] clone complete', JSON.stringify({ projectId: project.id, repoPath }))
  return repoPath
}

export const resolveProjectExecutionPath = async (
  project: Project,
  config?: ProjectExecutionConfig,
) => {
  const gitIdentity = config?.gitIdentity
  const ownerUserId = config?.ownerUserId ?? project.createdById
  const workspaceId = config?.workspaceId ?? undefined
  const binding = getProjectBinding(project.id, clusterConfig.nodeId)
  const versionControl = project.versionControl ?? (project.gitUrl.trim() ? 'git-remote' : 'none')
  const candidates = versionControl === 'git-remote'
    ? []
    : [binding?.pathHint].filter((value): value is string => Boolean(value?.trim()))

  console.log('[repo-prepare] resolve path', JSON.stringify({
    projectId: project.id,
    projectName: project.name,
    nodeId: clusterConfig.nodeId,
    bindingPathHint: binding?.pathHint,
    workspaceRoot: config?.workspaceRoot,
  }))

  const localRootPath = project.rootPath?.trim() || buildWorkspaceProjectRootPath(config?.workspaceRoot, project, workspaceId, ownerUserId)

  if (versionControl === 'none') {
    mkdirSync(localRootPath, { recursive: true })
    return localRootPath
  }

  for (const candidate of [...candidates, localRootPath].filter(Boolean)) {
    if (await isGitRepo(candidate)) {
      console.log('[repo-prepare] using binding path', JSON.stringify({ projectId: project.id, candidate }))
      return candidate
    }
  }

  if (versionControl === 'git-local') {
    throw new Error(`项目 ${project.name} 尚未在本地目录初始化 Git 仓库。`)
  }

  const fallbackPath = resolveWorkspaceRepoPath(project, config, workspaceId, ownerUserId)

  const authContext = createGitAuthContext({
    taskId: `project-${project.id}`,
    identity: gitIdentity ?? { mode: 'personal' },
    repoUrl: project.gitUrl,
  })

  try {
    return await ensureRepository(project, fallbackPath, authContext.env)
  } catch (error) {
    throw rewriteGitCredentialError(error, project.gitUrl)
  } finally {
    authContext.cleanup()
  }
}

export const resolveProjectBaseCommit = async (project: Project, config?: ProjectExecutionConfig) => {
  if (project.versionControl === 'none') {
    return project.defaultBranch?.trim() || 'main'
  }

  const repoPath = await resolveProjectExecutionPath(project, config)
  const git = simpleGit(repoPath)
  return git.revparse(['HEAD'])
}
