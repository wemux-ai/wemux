// [INPUT]: 任务 Git 交付请求（branch/commit/push）
// [OUTPUT]: Git 工作区操作结果
// [POS]: task-executor Git 工作区操作
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, rmSync } from 'node:fs'
import path from 'node:path'
import { buildVibemuxAgentCommitMessage } from '@shared/git-commit-message'
import type { DistributedTask, TaskRuntimeGitIdentity, WorkerProjectBinding } from '@shared/types'
import { getWorkspaceRepoBaseDir } from '@shared/workspace-paths'
import { mergeTaskGitCommitIdentityEnv } from '../git-identity'
import { createGitClient } from '../../runtime/local-git-repository'
import type { GitClient, WorkingDirectoryMode } from './types'

const DEFAULT_BRANCH = 'main'

const hashRepo = (repoUrl: string) => createHash('sha1').update(repoUrl).digest('hex').slice(0, 12)

const sanitizeName = (value: string) => value.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'repo'

const resolveRepoDir = (workspaceRoot: string, task: DistributedTask) => {
  const repoUrl = task.repoUrl
  const baseName = path.basename(repoUrl).replace(/\.git$/i, '')
  return path.join(getWorkspaceRepoBaseDir(workspaceRoot, task.workspaceId, task.requestedByUserId), `${sanitizeName(baseName)}-${hashRepo(repoUrl)}`)
}

const resolveStartPoint = (task: DistributedTask) => task.baseCommit?.trim() || task.defaultBranch?.trim() || DEFAULT_BRANCH

const getRemoteBranchRef = (branchName: string) => `origin/${branchName}`

const remoteBranchExists = async (repoUrl: string, branchName: string, env?: NodeJS.ProcessEnv) => {
  const output = await createGitClient(undefined, env).raw(['ls-remote', '--heads', repoUrl, branchName])
  return output.trim().length > 0
}

const fetchRemoteBranch = async (git: GitClient, branchName: string) => {
  console.log('[worker] [task-worktree] fetching target branch only', JSON.stringify({ branchName }))
  await git.fetch(['origin', `${branchName}:refs/remotes/origin/${branchName}`])
}

const fetchRemoteBranchIfExists = async (git: GitClient, branchName: string) => {
  try {
    await fetchRemoteBranch(git, branchName)
    return true
  } catch {
    return false
  }
}

const hasRemoteBranch = async (git: GitClient, branchName: string) => {
  const branches = await git.branch(['-r'])
  return branches.all.includes(getRemoteBranchRef(branchName))
}

const syncTaskBranchBeforePush = async (git: GitClient, branchName: string) => {
  await git.fetch(['origin', '--prune'])
  const remoteBranchFetched = await fetchRemoteBranchIfExists(git, branchName)
  if (remoteBranchFetched || await hasRemoteBranch(git, branchName)) {
    await git.rebase([getRemoteBranchRef(branchName)])
  }
}

export const buildIdentity = (task: DistributedTask): TaskRuntimeGitIdentity => {
  return task.gitIdentity ?? { mode: task.gitIdentityMode ?? 'personal' }
}

export const resolveWorkingDirectoryMode = (task: DistributedTask): WorkingDirectoryMode => {
  const value = (task as DistributedTask & { workingDirectoryMode?: string }).workingDirectoryMode
  return value === 'original-dir' ? 'original-dir' : 'worktree'
}

const resolveBoundRepoDir = (bindings: WorkerProjectBinding[] | undefined, task: DistributedTask) => {
  if (task.versionControl !== 'git-remote' && task.rootPath?.trim()) {
    return task.rootPath.trim()
  }

  return bindings?.find((binding) => {
    if (binding.projectId && binding.projectId === task.projectId) {
      return true
    }

    if (binding.repoUrl && binding.repoUrl === task.repoUrl) {
      return true
    }

    return false
  })?.localPath
}

const listWorktrees = async (git: GitClient) => {
  const output = await git.raw(['worktree', 'list', '--porcelain'])
  const entries: Array<{ path: string; branch?: string }> = []
  let current: { path: string; branch?: string } | null = null

  for (const line of output.split('\n')) {
    if (line.startsWith('worktree ')) {
      if (current) {
        entries.push(current)
      }
      current = { path: path.resolve(line.slice('worktree '.length).trim()) }
      continue
    }

    if (line.startsWith('branch ') && current) {
      current.branch = line.slice('branch '.length).trim()
    }
  }

  if (current) {
    entries.push(current)
  }

  return entries
}

const hasLocalBranch = async (git: GitClient, branchName: string) => {
  const branches = await git.branchLocal()
  return branches.all.includes(branchName)
}

const removePathSafely = (targetPath: string) => {
  rmSync(targetPath, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 100,
  })
}

export const ensureFreshWorktree = async (repoDir: string, worktreePath: string, branchName: string) => {
  const git = createGitClient(repoDir)
  const resolvedWorktreePath = path.resolve(worktreePath)
  const branchRef = `refs/heads/${branchName}`

  try {
    await git.raw(['worktree', 'prune'])
  } catch {
    // ignore prune failure and continue cleanup
  }

  const worktrees = await listWorktrees(git)
  const branchOwner = worktrees.find((entry) => entry.branch === branchRef)
  if (branchOwner && branchOwner.path !== resolvedWorktreePath) {
    try {
      await git.raw(['worktree', 'remove', '--force', branchOwner.path])
    } catch {
      // ignore stale registration miss
    }
  }

  try {
    await git.raw(['worktree', 'remove', '--force', resolvedWorktreePath])
  } catch {
    // ignore stale registration miss
  }

  removePathSafely(resolvedWorktreePath)

  if (await hasLocalBranch(git, branchName)) {
    try {
      await git.deleteLocalBranch(branchName, true)
    } catch {
      // ignore branch already detached or removed
    }
  }

  try {
    await git.raw(['worktree', 'prune'])
  } catch {
    // ignore prune failure after cleanup
  }

  mkdirSync(path.dirname(resolvedWorktreePath), { recursive: true })
}

export const ensureRepoReady = async (params: {
  workspaceRoot: string
  task: DistributedTask
  branchName: string
  bindings?: WorkerProjectBinding[]
  env?: NodeJS.ProcessEnv
}) => {
  const repoDir = resolveBoundRepoDir(params.bindings, params.task) || resolveRepoDir(params.workspaceRoot, params.task)
  const startPoint = resolveStartPoint(params.task)
  mkdirSync(path.dirname(repoDir), { recursive: true })

  if (params.task.versionControl === 'git-local') {
    const git = createGitClient(repoDir, params.env)
    if (!existsSync(repoDir) || !await git.checkIsRepo().catch(() => false)) {
      throw new Error('本地 Git 项目目录未初始化，无法创建任务 worktree。')
    }

    return { repoDir, git, taskBranchExists: false }
  }

  if (!existsSync(repoDir)) {
    console.log('[worker] [task-worktree] cloning target branch only', JSON.stringify({ repoDir, repoUrl: params.task.repoUrl, startPoint }))
    await createGitClient(undefined, params.env).clone(params.task.repoUrl, repoDir, ['--no-checkout', '--single-branch', '--branch', startPoint])
  }

  const git = createGitClient(repoDir, params.env)
  await fetchRemoteBranch(git, startPoint)
  const taskBranchExists = await remoteBranchExists(params.task.repoUrl, params.branchName, params.env)
  if (taskBranchExists && params.branchName !== startPoint) {
    await fetchRemoteBranch(git, params.branchName)
  }

  return { repoDir, git, taskBranchExists }
}

export const ensureOriginalDirectoryBranch = async (params: {
  git: GitClient
  task: DistributedTask
  branchName: string
  taskBranchExists: boolean
}) => {
  const startPoint = params.taskBranchExists || await hasRemoteBranch(params.git, params.branchName)
    ? getRemoteBranchRef(params.branchName)
    : resolveStartPoint(params.task)
  await params.git.checkout(['-B', params.branchName, startPoint])
  return startPoint
}

export const commitAndMaybePush = async (params: {
  task: DistributedTask
  worktreePath: string
  branchName: string
  identity: TaskRuntimeGitIdentity
  env?: NodeJS.ProcessEnv
}) => {
  const git = createGitClient(params.worktreePath, mergeTaskGitCommitIdentityEnv(params.env, params.identity))
  const status = await git.status()
  const changedFiles = Array.from(new Set(status.files.map((file) => file.path))).sort()

  if (changedFiles.length === 0) {
    return {
      changedFiles,
      commitShas: undefined,
      remoteBranchName: undefined,
      pushMessage: '没有文件改动，跳过提交与推送。',
    }
  }

  if (params.task.autoCommitEnabled === false) {
    return {
      changedFiles,
      commitShas: undefined,
      remoteBranchName: undefined,
      pushMessage: '当前工作区已关闭自动提交 / 推送，改动保留在本地目录。',
    }
  }

  if (params.task.returnMode !== 'branch' && params.task.returnMode !== 'commit') {
    return {
      changedFiles,
      commitShas: undefined,
      remoteBranchName: undefined,
      pushMessage: undefined,
    }
  }

  if (!params.identity.name || !params.identity.email) {
    throw new Error('当前任务缺少 Git 用户名或邮箱，请先在设置页完成 Git 授权配置。')
  }

  await git.add(['--all'])
  await git.commit(buildVibemuxAgentCommitMessage({
    fallback: `vibemux: ${params.task.id}`,
    agentIdentity: {
      name: params.identity.agentCoAuthorName,
      email: params.identity.agentCoAuthorEmail,
    },
    userIdentity: {
      name: params.identity.name,
      email: params.identity.email,
    },
  }))
  const commitSha = (await git.revparse(['HEAD'])).trim()

  let remoteBranchName: string | undefined
  let pushMessage = '已创建本地提交。'
  const taskVersionControl = params.task.versionControl ?? (params.task.repoUrl.trim() ? 'git-remote' : 'none')
  if (taskVersionControl === 'git-remote' && params.task.publishPolicy === 'none') {
    pushMessage = '当前工作区会话未启用发布权限，已创建本地提交但未推送远端。'
  } else if (taskVersionControl === 'git-remote' && params.identity.credentialToken) {
    await syncTaskBranchBeforePush(git, params.branchName)
    await git.push(['-u', 'origin', params.branchName])
    remoteBranchName = params.branchName
    pushMessage = `已推送远端分支 ${params.branchName}。`
  } else if (taskVersionControl === 'git-local') {
    pushMessage = '本地 Git 项目已创建本地提交，未尝试推送远端。'
  } else if (params.task.returnMode === 'branch' || params.task.returnMode === 'commit') {
    pushMessage = '缺少 task 级临时凭证，已创建本地提交但未推送远端。'
  }

  return {
    changedFiles,
    commitShas: commitSha ? [commitSha] : undefined,
    remoteBranchName,
    pushMessage,
  }
}
