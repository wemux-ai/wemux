// [INPUT]: worktree 请求（ensure/cleanup）
// [OUTPUT]: worktree 操作
// [POS]: 本地 worktree 管理
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, rmSync } from 'node:fs'
import { stat } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { simpleGit } from 'simple-git'
import { rewriteGitCredentialError } from '@shared/git-auth'
import type { RuntimeEnvironmentExecutionPayload } from '@shared/runtime-environment'
import type { ExecutorWorkspaceOperationEvent, ExecutorWorktreeResult, ExecutorWorktreeStartPointMode, TaskRuntimeGitIdentity } from '@shared/types'
import { getWorkspaceRepoBaseDir } from '@shared/workspace-paths'
import { createTaskGitAuthContext } from '../execution/git-identity'
import { materializeRuntimeEnvironment } from '../execution/runtime-environment'
import {
  createGitClient,
  DEFAULT_BRANCH_FALLBACK,
  ensurePreparedRepository,
  expandHomeDir,
  normalizeBranchName,
  normalizeFilesystemPath,
  resolveLocalRepoBranchSnapshot,
  resolvePreferredStartPoint,
  resolveRemoteRepoBranchSnapshot,
} from './local-git-repository'
import { isManagedRepositoryPath, remapManagedProjectPath } from './managed-workspace-path'

type WorkingDirectoryMode = 'worktree' | 'original-dir'
const resolveWorkingDirectoryMode = (value?: string): WorkingDirectoryMode => value === 'original-dir' ? 'original-dir' : 'worktree'
const resolveFileMaterializationRuntimeEnvironment = (runtimeEnvironment?: RuntimeEnvironmentExecutionPayload) => (
  runtimeEnvironment?.mode === 'env-file' ? runtimeEnvironment : undefined
)
type WorkspaceOperationEmitter = (event: ExecutorWorkspaceOperationEvent) => void

const emitWorkspaceOperation = (
  emit: WorkspaceOperationEmitter | undefined,
  phase: string,
  message: string,
) => {
  emit?.({
    phase,
    message,
    at: new Date().toISOString(),
  })
}

const sanitizeGitRemoteLabel = (value?: string) => {
  const normalized = value?.trim()
  if (!normalized) {
    return ''
  }

  try {
    const url = new URL(normalized)
    url.username = ''
    url.password = ''
    return url.toString()
  } catch {
    return normalized.replace(/\/\/[^/@\s]+@/, '//')
  }
}

const sanitizeName = (value: string) => value.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'repo'

const hashRepo = (repoUrl: string) => createHash('sha1').update(repoUrl).digest('hex').slice(0, 12)

const resolveFallbackRepoDir = (workspaceRoot: string, repoUrl?: string, workspaceId?: string, ownerUserId?: string) => {
  const baseName = repoUrl ? path.basename(repoUrl).replace(/\.git$/i, '') : 'repo'
  return path.join(normalizeFilesystemPath(getWorkspaceRepoBaseDir(workspaceRoot, workspaceId, ownerUserId)), `${sanitizeName(baseName)}-${hashRepo(repoUrl || baseName)}`)
}

const resolveOriginalDirectoryRepoPath = (params: {
  repoPath?: string
  worktreePath: string
}) => {
  const candidates = [
    params.repoPath?.trim(),
    params.worktreePath.trim(),
  ]
    .filter((candidate): candidate is string => Boolean(candidate))
    .map((candidate) => normalizeFilesystemPath(candidate))
  const existingCandidate = candidates.find((candidate) => existsSync(candidate))

  return existingCandidate || candidates[0] || normalizeFilesystemPath(params.worktreePath)
}

const ensureOriginalDirectoryReady = async (params: {
  repoPath: string
  repoUrl?: string
  preferredBranch?: string
  branchName: string
  env?: NodeJS.ProcessEnv
}): Promise<ExecutorWorktreeResult> => {
  const repoStats = await stat(params.repoPath).catch(() => null)
  if (!repoStats) {
    if (params.repoUrl?.trim()) {
      const remoteSnapshot = await resolveRemoteRepoBranchSnapshot(
        params.repoPath,
        params.repoUrl,
        params.preferredBranch,
        params.env,
      )
      const startPoint = resolvePreferredStartPoint({
        branches: remoteSnapshot.branches,
        defaultBranch: remoteSnapshot.defaultBranch,
        preferredBranch: params.preferredBranch,
      })
      if (!remoteSnapshot.branches.includes(startPoint)) {
        return {
          ok: false,
          message: remoteSnapshot.branches.length > 0
            ? `起始分支 ${startPoint} 不存在。当前仓库分支：${remoteSnapshot.branches.join(', ')}`
            : `起始分支 ${startPoint} 不存在。`,
          worktreePath: params.repoPath,
        }
      }

      await ensurePreparedRepository({
        repoPath: params.repoPath,
        remoteTarget: remoteSnapshot.remoteTarget,
        startPoint,
        env: params.env,
      })
    } else {
      mkdirSync(params.repoPath, { recursive: true })
      return {
        ok: true,
        message: `已准备本地项目目录 ${params.repoPath}。`,
        worktreePath: params.repoPath,
      }
    }
  } else if (!repoStats.isDirectory()) {
    return {
      ok: false,
      message: `目标路径不是目录：${params.repoPath}`,
      worktreePath: params.repoPath,
    }
  }

  if (params.repoUrl?.trim()) {
    const remoteSnapshot = await resolveRemoteRepoBranchSnapshot(
      params.repoPath,
      params.repoUrl,
      params.preferredBranch,
      params.env,
    )
    const startPoint = resolvePreferredStartPoint({
      branches: remoteSnapshot.branches,
      defaultBranch: remoteSnapshot.defaultBranch,
      preferredBranch: params.preferredBranch,
    })
    if (!remoteSnapshot.branches.includes(startPoint)) {
      return {
        ok: false,
        message: remoteSnapshot.branches.length > 0
          ? `起始分支 ${startPoint} 不存在。当前仓库分支：${remoteSnapshot.branches.join(', ')}`
          : `起始分支 ${startPoint} 不存在。`,
        worktreePath: params.repoPath,
      }
    }

    console.log('[worker] [worktree] preparing original directory repository', JSON.stringify({
      repoPath: params.repoPath,
      remoteTarget: remoteSnapshot.remoteTarget,
      startPoint,
    }))
    await ensurePreparedRepository({
      repoPath: params.repoPath,
      remoteTarget: remoteSnapshot.remoteTarget,
      startPoint,
      env: params.env,
    })
  }

  const git = createGitClient(params.repoPath, params.env)
  if (!existsSync(params.repoPath)) {
    mkdirSync(params.repoPath, { recursive: true })
    return {
      ok: true,
      message: `已准备本地项目目录 ${params.repoPath}。`,
      worktreePath: params.repoPath,
    }
  }

  if (!await git.checkIsRepo().catch(() => false)) {
    return {
      ok: true,
      message: `已复用本地目录 ${params.repoPath}。当前目录还没有 Git 仓库。`,
      worktreePath: params.repoPath,
    }
  }

  const hasCommit = await git.revparse(['--verify', 'HEAD'])
    .then((value) => Boolean(value.trim()))
    .catch(() => false)
  if (!hasCommit) {
    return {
      ok: true,
      message: `已复用原始目录 ${params.repoPath}。Git 已初始化但还没有首个提交，暂不创建隔离 worktree。`,
      worktreePath: params.repoPath,
    }
  }

  const currentBranch = normalizeBranchName((await git.branchLocal()).current)
  return {
    ok: true,
    message: currentBranch
      ? `已复用原始目录 ${params.repoPath}，当前分支 ${currentBranch}。`
      : `已复用原始目录 ${params.repoPath}。`,
    worktreePath: params.repoPath,
  }
}

const listWorktrees = async (git: ReturnType<typeof simpleGit>) => {
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

const hasLocalBranch = async (git: ReturnType<typeof simpleGit>, branchName: string) => {
  const branches = await git.branchLocal()
  return branches.all.includes(branchName)
}

const resolveWorkspaceWorktreeStartPoint = (params: {
  branches: string[]
  defaultBranch: string
  preferredBranch?: string
  startPointMode?: ExecutorWorktreeStartPointMode
  branchName: string
}) => {
  if (params.startPointMode === 'preferred-branch') {
    return resolvePreferredStartPoint({
      branches: params.branches,
      defaultBranch: params.defaultBranch,
      preferredBranch: params.preferredBranch,
    })
  }

  const normalizedBranchName = normalizeBranchName(params.branchName)
  if (normalizedBranchName && params.branches.includes(normalizedBranchName)) {
    return normalizedBranchName
  }

  return resolvePreferredStartPoint({
    branches: params.branches,
    defaultBranch: params.defaultBranch,
    preferredBranch: params.preferredBranch,
  })
}

const deleteManagedWorktreeBranches = async (params: {
  repoPath: string
  repoUrl?: string
  branchName?: string
  deleteLocalBranch?: boolean
  deleteRemoteBranch?: boolean
  gitIdentity?: TaskRuntimeGitIdentity
}): Promise<Pick<ExecutorWorktreeResult, 'deletedLocalBranch' | 'deletedRemoteBranch'>> => {
  const branchName = normalizeBranchName(params.branchName ?? '')
  if (!branchName || !(branchName.startsWith('wemux/') || branchName.startsWith('vibemux/'))) {
    return {}
  }

  const deleted: Pick<ExecutorWorktreeResult, 'deletedLocalBranch' | 'deletedRemoteBranch'> = {}
  const gitAuthContext = params.deleteRemoteBranch
    ? createTaskGitAuthContext({
        taskId: `worktree-cleanup-${Buffer.from(params.repoPath).toString('base64url').slice(0, 24)}`,
        identity: params.gitIdentity ?? { mode: 'personal' },
        repoUrl: params.repoUrl,
      })
    : null

  try {
    const git = createGitClient(params.repoPath, gitAuthContext?.env)
    if (gitAuthContext) {
      gitAuthContext.configureRepo(params.repoPath)
    }

    if (params.deleteLocalBranch && await hasLocalBranch(git, branchName)) {
      try {
        await git.deleteLocalBranch(branchName, true)
        deleted.deletedLocalBranch = branchName
      } catch {
        // ignore local branch cleanup failure and continue
      }
    }

    if (params.deleteRemoteBranch && params.gitIdentity?.credentialToken) {
      try {
        await git.push(['origin', '--delete', branchName])
        deleted.deletedRemoteBranch = branchName
      } catch {
        // ignore remote branch cleanup failure and continue
      }
    }

    return deleted
  } finally {
    gitAuthContext?.cleanup(params.repoPath)
  }
}

const removePathSafely = (targetPath: string) => {
  rmSync(targetPath, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 100,
  })
}

const ensureFreshWorktree = async (git: ReturnType<typeof simpleGit>, worktreePath: string, branchName: string) => {
  const resolvedWorktreePath = path.resolve(worktreePath)
  const branchRef = `refs/heads/${branchName}`

  try {
    await git.raw(['worktree', 'prune'])
  } catch {
    // ignore prune failure before cleanup
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

const isWorktreeDirty = async (worktreePath: string, env?: NodeJS.ProcessEnv) => {
  const git = createGitClient(worktreePath, env)
  const status = await git.status(['--untracked-files=no'])
  return !status.isClean()
}

const tryFastForwardExistingWorktree = async (params: {
  worktreePath: string
  startPointRef?: string
  env?: NodeJS.ProcessEnv
}) => {
  if (!params.startPointRef) {
    return false
  }

  const git = createGitClient(params.worktreePath, params.env)
  if (await isWorktreeDirty(params.worktreePath, params.env).catch(() => true)) {
    return false
  }

  await git.raw(['merge', '--ff-only', params.startPointRef])
    .catch(() => undefined)
  return true
}

const tryReuseExistingWorktree = async (params: {
  repoGit: ReturnType<typeof simpleGit>
  worktreePath: string
  branchName: string
  startPointMode?: ExecutorWorktreeStartPointMode
  startPointRef?: string
  env?: NodeJS.ProcessEnv
}) => {
  if (params.startPointMode === 'preferred-branch') {
    return null
  }

  const resolvedWorktreePath = path.resolve(params.worktreePath)
  const branchRef = `refs/heads/${params.branchName}`
  const stats = await stat(resolvedWorktreePath).catch(() => null)
  if (!stats?.isDirectory()) {
    return null
  }

  const worktreeGit = createGitClient(resolvedWorktreePath, params.env)
  if (!await worktreeGit.checkIsRepo().catch(() => false)) {
    return null
  }

  const currentBranch = await worktreeGit.branchLocal()
    .then((branches) => normalizeBranchName(branches.current))
    .catch(() => '')
  if (currentBranch !== normalizeBranchName(params.branchName)) {
    return null
  }

  const worktrees = await listWorktrees(params.repoGit).catch(() => [])
  const existingWorktree = worktrees.find((entry) => entry.path === resolvedWorktreePath)
  if (existingWorktree && existingWorktree.branch !== branchRef) {
    return null
  }

  const fastForwarded = await tryFastForwardExistingWorktree({
    worktreePath: resolvedWorktreePath,
    startPointRef: params.startPointRef,
    env: params.env,
  }).catch(() => false)

  return {
    ok: true,
    message: fastForwarded
      ? `已复用现有 worktree ${resolvedWorktreePath}，并快进更新分支 ${params.branchName}。`
      : `已复用现有 worktree ${resolvedWorktreePath}，分支 ${params.branchName}。`,
    worktreePath: resolvedWorktreePath,
  } satisfies ExecutorWorktreeResult
}

const createWorktreeFromLocalRepo = async (params: {
  repoPath: string
  worktreePath: string
  branchName: string
  preferredBranch?: string
  startPointMode?: ExecutorWorktreeStartPointMode
  env?: NodeJS.ProcessEnv
}): Promise<ExecutorWorktreeResult> => {
  const git = createGitClient(params.repoPath, params.env)
  if (!await git.checkIsRepo().catch(() => false)) {
    return {
      ok: false,
      message: `目标目录不是有效 Git 仓库：${params.repoPath}`,
      worktreePath: params.worktreePath,
    }
  }

  const snapshot = await resolveLocalRepoBranchSnapshot(params.repoPath, params.preferredBranch, params.env)
  const startPoint = resolveWorkspaceWorktreeStartPoint({
    branches: snapshot.branches,
    defaultBranch: snapshot.defaultBranch,
    preferredBranch: params.preferredBranch,
    startPointMode: params.startPointMode,
    branchName: params.branchName,
  })
  if (!snapshot.branches.includes(startPoint)) {
    return {
      ok: false,
      message: snapshot.branches.length > 0
        ? `起始分支 ${startPoint} 不存在。当前仓库分支：${snapshot.branches.join(', ')}`
        : `起始分支 ${startPoint} 不存在。`,
      worktreePath: params.worktreePath,
    }
  }

  console.log('[worker] [worktree] local repo creating worktree', JSON.stringify({
    repoPath: params.repoPath,
    worktreePath: params.worktreePath,
    branchName: params.branchName,
    startPoint,
  }))
  const reusedWorktree = await tryReuseExistingWorktree({
    repoGit: git,
    worktreePath: params.worktreePath,
    branchName: params.branchName,
    startPointMode: params.startPointMode,
    env: params.env,
  })
  if (reusedWorktree) {
    return reusedWorktree
  }

  await ensureFreshWorktree(git, params.worktreePath, params.branchName)
  await git.raw(['worktree', 'add', '--force', '-B', params.branchName, params.worktreePath, startPoint])
  return {
    ok: true,
    message: `已基于 ${startPoint} 创建 worktree ${params.worktreePath} 并切出分支 ${params.branchName}。`,
    worktreePath: params.worktreePath,
  }
}

const isValidLocalGitRepository = async (repoPath: string, env?: NodeJS.ProcessEnv) => {
  if (!existsSync(repoPath)) {
    return false
  }

  const git = createGitClient(repoPath, env)
  return git.checkIsRepo().catch(() => false)
}

export const ensureLocalTaskWorktree = async (params: {
  workspaceRoot: string
  workspaceId?: string
  ownerUserId?: string
  repoPath?: string
  repoUrl?: string
  preferredBranch?: string
  startPointMode?: ExecutorWorktreeStartPointMode
  branchName: string
  worktreePath: string
  gitIdentity?: TaskRuntimeGitIdentity
  workingDirectoryMode?: string
  runtimeEnvironment?: RuntimeEnvironmentExecutionPayload
  onOperationEvent?: WorkspaceOperationEmitter
}): Promise<ExecutorWorktreeResult> => {
  const workingDirectoryMode = resolveWorkingDirectoryMode(params.workingDirectoryMode)
  const resolvedWorktreePath = remapManagedProjectPath(params.workspaceRoot, params.worktreePath) || normalizeFilesystemPath(params.worktreePath)
  const resolvedRepoPath = params.repoPath?.trim()
    ? remapManagedProjectPath(params.workspaceRoot, params.repoPath) || normalizeFilesystemPath(params.repoPath)
    : workingDirectoryMode === 'original-dir' || !params.repoUrl?.trim()
      ? resolvedWorktreePath
      : normalizeFilesystemPath(resolveFallbackRepoDir(params.workspaceRoot, params.repoUrl, params.workspaceId, params.ownerUserId))
  const gitAuthContext = createTaskGitAuthContext({
    taskId: `worktree-${Buffer.from(resolvedWorktreePath).toString('base64url').slice(0, 24)}`,
    identity: params.gitIdentity ?? { mode: 'personal' },
    repoUrl: params.repoUrl,
  })
  const materializeRuntimeEnvironmentForResult = (result: ExecutorWorktreeResult): ExecutorWorktreeResult => {
    if (!result.ok) {
      return result
    }

    const worktreePath = result.worktreePath?.trim()
    if (!worktreePath) {
      return {
        ...result,
        ok: false,
        message: '项目目录准备失败：缺少工作目录路径。',
      }
    }

    try {
      materializeRuntimeEnvironment(worktreePath, resolveFileMaterializationRuntimeEnvironment(params.runtimeEnvironment))
      return result
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error
          ? `项目目录准备失败：${error.message}`
          : '项目目录准备失败。',
        worktreePath,
      }
    }
  }
  const executionEnv = gitAuthContext.env
  const canRepairManagedRepoCache = workingDirectoryMode !== 'original-dir'
    && isManagedRepositoryPath(params.workspaceRoot, resolvedRepoPath)

  console.log(`[worker] [worktree] ensure worktree starting`, JSON.stringify({
    worktreePath: resolvedWorktreePath,
    repoPath: resolvedRepoPath,
    workspaceId: params.workspaceId,
    ownerUserId: params.ownerUserId,
    branchName: params.branchName,
    preferredBranch: params.preferredBranch,
    startPointMode: params.startPointMode,
    workingDirectoryMode,
  }))
  emitWorkspaceOperation(
    params.onOperationEvent,
    'worktree.ensure.start',
    workingDirectoryMode === 'original-dir'
      ? `正在检查原始项目目录：${resolvedRepoPath}`
      : `正在准备工作目录：${resolvedWorktreePath}`,
  )

  if (workingDirectoryMode === 'original-dir') {
    const resolvedOriginalRepoPath = resolveOriginalDirectoryRepoPath({
      repoPath: resolvedRepoPath,
      worktreePath: resolvedWorktreePath,
    })
    try {
      if (!existsSync(resolvedOriginalRepoPath) && params.repoUrl?.trim()) {
        emitWorkspaceOperation(
          params.onOperationEvent,
          'worktree.original-dir.clone',
          `原始目录不存在，正在 clone：${sanitizeGitRemoteLabel(params.repoUrl)}`,
        )
      }
      const result = await ensureOriginalDirectoryReady({
        repoPath: resolvedOriginalRepoPath,
        repoUrl: params.repoUrl,
        preferredBranch: params.preferredBranch,
        branchName: params.branchName,
        env: executionEnv,
      })
      if (result.ok) {
        emitWorkspaceOperation(
          params.onOperationEvent,
          'worktree.original-dir.ready',
          `原始项目目录已准备：${result.worktreePath ?? resolvedOriginalRepoPath}`,
        )
      }
      return materializeRuntimeEnvironmentForResult(result)
    } catch (error) {
      const normalizedError = rewriteGitCredentialError(error, params.repoUrl)
      return {
        ok: false,
        message: normalizedError instanceof Error ? normalizedError.message : '原始目录准备失败。',
        worktreePath: resolvedRepoPath,
      }
    } finally {
      gitAuthContext.cleanup()
    }
  }

  if (!params.repoPath?.trim() && !params.repoUrl?.trim()) {
    mkdirSync(resolvedWorktreePath, { recursive: true })
    emitWorkspaceOperation(
      params.onOperationEvent,
      'worktree.directory.ready',
      `已准备项目目录：${resolvedWorktreePath}`,
    )
    return materializeRuntimeEnvironmentForResult({
      ok: true,
      message: `已准备项目目录 ${resolvedWorktreePath}。`,
      worktreePath: resolvedWorktreePath,
    })
  }

  if (!params.repoUrl?.trim()) {
    try {
      emitWorkspaceOperation(
        params.onOperationEvent,
        'worktree.local-repo.prepare',
        `正在基于本地 Git 仓库创建 worktree：${resolvedRepoPath}`,
      )
      const result = await createWorktreeFromLocalRepo({
        repoPath: resolvedRepoPath,
        worktreePath: resolvedWorktreePath,
        branchName: params.branchName,
        preferredBranch: params.preferredBranch,
        startPointMode: params.startPointMode,
        env: executionEnv,
      })
      return materializeRuntimeEnvironmentForResult(result)
    } catch (error) {
      const normalizedError = rewriteGitCredentialError(error, params.repoUrl)
      return {
        ok: false,
        message: normalizedError instanceof Error ? normalizedError.message : '创建 worktree 失败。',
        worktreePath: resolvedWorktreePath,
      }
    } finally {
      gitAuthContext.cleanup()
    }
  }

  try {
    const remoteSnapshot = await resolveRemoteRepoBranchSnapshot(resolvedRepoPath, params.repoUrl, params.preferredBranch, executionEnv)
    const requestedStartPoint = normalizeBranchName(params.preferredBranch ?? '') || remoteSnapshot.defaultBranch
    const startPoint = resolveWorkspaceWorktreeStartPoint({
      branches: remoteSnapshot.branches,
      defaultBranch: remoteSnapshot.defaultBranch,
      preferredBranch: params.preferredBranch,
      startPointMode: params.startPointMode,
      branchName: params.branchName,
    })
    if (!remoteSnapshot.branches.includes(startPoint)) {
      console.log(`[worker] [worktree] ensure worktree skipped: branch not found`, JSON.stringify({ startPoint, availableBranches: remoteSnapshot.branches }))
      return {
        ok: false,
        message: remoteSnapshot.branches.length > 0
          ? `起始分支 ${startPoint} 不存在。当前仓库分支：${remoteSnapshot.branches.join(', ')}`
          : `起始分支 ${startPoint} 不存在。`,
      }
    }

    console.log(`[worker] [worktree] resolved remote start point`, JSON.stringify({
      repoPath: resolvedRepoPath,
      remoteTarget: remoteSnapshot.remoteTarget,
      requestedStartPoint,
      startPoint,
      startPointMode: params.startPointMode,
    }))

    const repoStats = await stat(resolvedRepoPath).catch(() => null)
    const hasValidRepoCache = repoStats?.isDirectory()
      ? await isValidLocalGitRepository(resolvedRepoPath, executionEnv)
      : false
    emitWorkspaceOperation(
      params.onOperationEvent,
      hasValidRepoCache ? 'worktree.repo.fetch' : 'worktree.repo.clone',
      hasValidRepoCache
        ? `正在 fetch base 分支：${startPoint}`
        : `本节点尚未准备 repo，正在 clone：${sanitizeGitRemoteLabel(params.repoUrl) || resolvedRepoPath}`,
    )
    await ensurePreparedRepository({
      repoPath: resolvedRepoPath,
      remoteTarget: remoteSnapshot.remoteTarget,
      startPoint,
      env: executionEnv,
      allowRepairInvalidRepository: canRepairManagedRepoCache,
    })
    emitWorkspaceOperation(
      params.onOperationEvent,
      hasValidRepoCache ? 'worktree.repo.fetch.done' : 'worktree.repo.clone.done',
      hasValidRepoCache
        ? `已 fetch base 分支：${startPoint}`
        : `repo clone 完成：${resolvedRepoPath}`,
    )
    const git = createGitClient(resolvedRepoPath, executionEnv)
    const startPointRef = `refs/remotes/origin/${startPoint}`
    const repoCacheCurrentBranch = await git.branchLocal()
      .then((branches) => normalizeBranchName(branches.current))
      .catch(() => '')
    if (repoCacheCurrentBranch === normalizeBranchName(params.branchName)) {
      await git.checkout(['--detach', startPointRef])
    }
    const reusedWorktree = await tryReuseExistingWorktree({
      repoGit: git,
      worktreePath: resolvedWorktreePath,
      branchName: params.branchName,
      startPointMode: params.startPointMode,
      startPointRef,
      env: executionEnv,
    })
    if (reusedWorktree) {
      console.log(`[worker] [worktree] reused existing worktree`, JSON.stringify({ worktreePath: resolvedWorktreePath, branchName: params.branchName, startPoint, startPointRef }))
      emitWorkspaceOperation(
        params.onOperationEvent,
        'worktree.reuse',
        reusedWorktree.message,
      )
      return materializeRuntimeEnvironmentForResult(reusedWorktree)
    }

    console.log(`[worker] [worktree] creating fresh worktree`, JSON.stringify({ worktreePath: resolvedWorktreePath, branchName: params.branchName, startPoint, startPointRef }))
    emitWorkspaceOperation(
      params.onOperationEvent,
      'worktree.create',
      `正在创建 worktree：${resolvedWorktreePath}，分支 ${params.branchName}`,
    )
    await ensureFreshWorktree(git, resolvedWorktreePath, params.branchName)
    await git.raw(['worktree', 'add', '--force', '-B', params.branchName, resolvedWorktreePath, startPointRef])
    console.log(`[worker] [worktree] worktree created`, JSON.stringify({ worktreePath: resolvedWorktreePath, branchName: params.branchName, startPoint, startPointRef }))
    emitWorkspaceOperation(
      params.onOperationEvent,
      'worktree.create.done',
      `worktree 创建完成：${resolvedWorktreePath}，分支 ${params.branchName}`,
    )
    return materializeRuntimeEnvironmentForResult({
      ok: true,
      message: `已基于 ${startPoint} 创建 worktree ${resolvedWorktreePath} 并切出分支 ${params.branchName}。`,
      worktreePath: resolvedWorktreePath,
    })
  } catch (error) {
    const normalizedError = rewriteGitCredentialError(error, params.repoUrl)
    console.log(`[worker] [worktree] remote prepare failed`, JSON.stringify({ worktreePath: resolvedWorktreePath, repoPath: resolvedRepoPath, error: normalizedError instanceof Error ? normalizedError.message : 'unknown' }))

    if (!await isValidLocalGitRepository(resolvedRepoPath, executionEnv)) {
      return {
        ok: false,
        message: normalizedError instanceof Error ? normalizedError.message : '创建 worktree 失败。',
        worktreePath: resolvedWorktreePath,
      }
    }

    try {
      const result = await createWorktreeFromLocalRepo({
        repoPath: resolvedRepoPath,
        worktreePath: resolvedWorktreePath,
        branchName: params.branchName,
        preferredBranch: params.preferredBranch,
        startPointMode: params.startPointMode,
        env: executionEnv,
      })
      return materializeRuntimeEnvironmentForResult(result)
    } catch (fallbackError) {
      const normalizedFallbackError = rewriteGitCredentialError(fallbackError, params.repoUrl)
      console.log(`[worker] [worktree] ensure worktree failed`, JSON.stringify({ worktreePath: resolvedWorktreePath, error: normalizedFallbackError instanceof Error ? normalizedFallbackError.message : 'unknown' }))
      return {
        ok: false,
        message: normalizedFallbackError instanceof Error ? normalizedFallbackError.message : '创建 worktree 失败。',
        worktreePath: resolvedWorktreePath,
      }
    }
  } finally {
    gitAuthContext.cleanup()
  }
}

export const cleanupLocalTaskWorktree = async (params: {
  workspaceRoot: string
  workspaceId?: string
  ownerUserId?: string
  repoPath?: string
  repoUrl?: string
  worktreePath: string
  workingDirectoryMode?: string
  branchName?: string
  deleteLocalBranch?: boolean
  deleteRemoteBranch?: boolean
  gitIdentity?: TaskRuntimeGitIdentity
  onOperationEvent?: WorkspaceOperationEmitter
}): Promise<ExecutorWorktreeResult> => {
  const workingDirectoryMode = resolveWorkingDirectoryMode(params.workingDirectoryMode)
  const resolvedWorktreePath = normalizeFilesystemPath(params.worktreePath)
  const resolvedRepoPath = normalizeFilesystemPath(params.repoPath?.trim() || resolveFallbackRepoDir(params.workspaceRoot, params.repoUrl, params.workspaceId, params.ownerUserId))

  console.log(`[worker] [worktree] cleanup worktree starting`, JSON.stringify({
    worktreePath: resolvedWorktreePath,
    repoPath: resolvedRepoPath,
    workspaceId: params.workspaceId,
    ownerUserId: params.ownerUserId,
    workingDirectoryMode,
  }))
  emitWorkspaceOperation(
    params.onOperationEvent,
    'worktree.cleanup.start',
    workingDirectoryMode === 'original-dir'
      ? `正在检查原始目录清理策略：${resolvedRepoPath}`
      : `正在清理 worktree：${resolvedWorktreePath}`,
  )

  if (workingDirectoryMode === 'original-dir') {
    emitWorkspaceOperation(
      params.onOperationEvent,
      'worktree.cleanup.skip-original-dir',
      `原始目录模式无需清理 worktree，保留项目目录：${resolvedRepoPath}`,
    )
    return {
      ok: true,
      message: `原始目录模式无需清理 worktree，保留项目目录 ${resolvedRepoPath}。`,
      worktreePath: resolvedRepoPath,
    }
  }

  if (!params.repoPath?.trim() && !params.repoUrl?.trim()) {
    emitWorkspaceOperation(
      params.onOperationEvent,
      'worktree.cleanup.skip-directory',
      `当前目录项目无需清理 worktree：${resolvedWorktreePath}`,
    )
    return {
      ok: true,
      message: `当前目录项目无需清理 worktree：${resolvedWorktreePath}。`,
      worktreePath: resolvedWorktreePath,
    }
  }

  try {
    if (existsSync(resolvedRepoPath)) {
      const git = simpleGit(resolvedRepoPath)
      if (await git.checkIsRepo()) {
        try {
          console.log(`[worker] [worktree] removing worktree via git`, JSON.stringify({ worktreePath: resolvedWorktreePath }))
          await git.raw(['worktree', 'remove', '--force', resolvedWorktreePath])
        } catch {
          console.log(`[worker] [worktree] git worktree remove failed, falling through to local cleanup`, JSON.stringify({ worktreePath: resolvedWorktreePath }))
        }

        try {
          await git.raw(['worktree', 'prune'])
        } catch {
          console.log(`[worker] [worktree] git worktree prune failed, ignoring`, JSON.stringify({ worktreePath: resolvedWorktreePath }))
        }
      }
    }

    console.log(`[worker] [worktree] removing worktree path`, JSON.stringify({ worktreePath: resolvedWorktreePath }))
    emitWorkspaceOperation(
      params.onOperationEvent,
      'worktree.path.remove',
      `正在删除 worktree 目录：${resolvedWorktreePath}`,
    )
    removePathSafely(resolvedWorktreePath)
    const deletedBranches = existsSync(resolvedRepoPath)
      ? await deleteManagedWorktreeBranches({
          repoPath: resolvedRepoPath,
          repoUrl: params.repoUrl,
          branchName: params.branchName,
          deleteLocalBranch: params.deleteLocalBranch,
          deleteRemoteBranch: params.deleteRemoteBranch,
          gitIdentity: params.gitIdentity,
        })
      : {}
    if (deletedBranches.deletedLocalBranch) {
      emitWorkspaceOperation(
        params.onOperationEvent,
        'worktree.branch.delete-local',
        `已删除本地分支：${deletedBranches.deletedLocalBranch}`,
      )
    }
    if (deletedBranches.deletedRemoteBranch) {
      emitWorkspaceOperation(
        params.onOperationEvent,
        'worktree.branch.delete-remote',
        `已删除远端分支：${deletedBranches.deletedRemoteBranch}`,
      )
    }
    console.log(`[worker] [worktree] cleanup worktree done`, JSON.stringify({ worktreePath: resolvedWorktreePath }))
    emitWorkspaceOperation(
      params.onOperationEvent,
      'worktree.cleanup.done',
      `worktree 清理完成：${resolvedWorktreePath}`,
    )
    return {
      ok: true,
      message: `已清理 worktree ${resolvedWorktreePath}。`,
      worktreePath: resolvedWorktreePath,
      ...deletedBranches,
    }
  } catch (error) {
    console.log(`[worker] [worktree] cleanup worktree failed`, JSON.stringify({ worktreePath: resolvedWorktreePath, error: error instanceof Error ? error.message : 'unknown' }))
    return {
      ok: false,
      message: error instanceof Error ? error.message : '清理 worktree 失败。',
      worktreePath: resolvedWorktreePath,
    }
  }
}
