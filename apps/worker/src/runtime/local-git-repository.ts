// [INPUT]: 本地仓库路径
// [OUTPUT]: 仓库识别/操作
// [POS]: 本地 Git 仓库识别
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import { mkdirSync, rmSync } from 'node:fs'
import { readdir, stat } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { simpleGit } from 'simple-git'
import { getSimpleGitOptionsForEnv } from '@shared/git-auth'

export const DEFAULT_BRANCH_FALLBACK = 'main'

export const expandHomeDir = (rawPath: string) => {
  const trimmed = rawPath.trim()

  if (!trimmed) {
    return ''
  }

  if (trimmed === '~') {
    return os.homedir()
  }

  if (trimmed.startsWith('~/')) {
    return path.join(os.homedir(), trimmed.slice(2))
  }

  return trimmed
}

export const normalizeFilesystemPath = (rawPath: string) => path.resolve(expandHomeDir(rawPath))

export const normalizeBranchName = (name: string) => {
  const trimmed = name.trim()
  if (!trimmed || trimmed === 'HEAD' || trimmed.endsWith('/HEAD')) {
    return ''
  }

  const withoutRefPrefix = trimmed.startsWith('refs/heads/') ? trimmed.slice('refs/heads/'.length) : trimmed
  const withoutRemotePrefix = withoutRefPrefix.startsWith('remotes/') ? withoutRefPrefix.slice('remotes/'.length) : withoutRefPrefix
  return withoutRemotePrefix.startsWith('origin/') ? withoutRemotePrefix.slice('origin/'.length) : withoutRemotePrefix
}

export const createGitClient = (baseDir?: string, env?: NodeJS.ProcessEnv) => {
  const options = {
    ...getSimpleGitOptionsForEnv(env),
    ...(baseDir ? { baseDir } : {}),
  }

  return simpleGit(options).env(env ?? {})
}

/** 本地快照路径下，所有分支都只存在于本地（未推送）。 */
export const buildLocalSnapshotBranchSources = (branches: string[]): Record<string, 'remote' | 'local-only'> => {
  return Object.fromEntries(branches.map((branch) => [branch, 'local-only' as const]))
}

/**
 * 远端快照路径下合并本地分支列表并标注来源：
 * 本地有而远端没有的分支标 'local-only'，其余（含两端都有、仅远端有）标 'remote'。
 * 本地仓库不存在（localSnapshotBranches 为空）时结果全部标 'remote'。
 */
export const mergeRemoteSnapshotBranchSources = (params: {
  remoteBranches: string[]
  localSnapshotBranches?: string[]
}): { branches: string[]; branchSources: Record<string, 'remote' | 'local-only'> } => {
  const localBranches = params.localSnapshotBranches ?? []
  const branches = localBranches.length > 0
    ? Array.from(new Set([...params.remoteBranches, ...localBranches])).sort((left, right) => left.localeCompare(right))
    : params.remoteBranches

  const remoteSet = new Set(params.remoteBranches)
  const localSet = new Set(localBranches)
  const branchSources: Record<string, 'remote' | 'local-only'> = {}
  for (const branch of branches) {
    branchSources[branch] = localSet.has(branch) && !remoteSet.has(branch) ? 'local-only' : 'remote'
  }

  return { branches, branchSources }
}

export const resolveLocalRepoBranchSnapshot = async (repoPath: string, preferredBranch?: string, env?: NodeJS.ProcessEnv) => {
  const git = createGitClient(repoPath, env)
  const [allBranches, localBranches] = await Promise.all([
    git.branch(['-a']),
    git.branchLocal(),
  ])

  let remoteHeadBranch = ''
  try {
    remoteHeadBranch = normalizeBranchName(await git.raw(['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD']))
  } catch {
    remoteHeadBranch = ''
  }

  const branches = Array.from(new Set(allBranches.all.map(normalizeBranchName).filter(Boolean))).sort((left, right) => left.localeCompare(right))
  const normalizedPreferredBranch = normalizeBranchName(preferredBranch ?? '')
  const normalizedCurrentBranch = normalizeBranchName(localBranches.current)
  const defaultBranch = [remoteHeadBranch, normalizedPreferredBranch, normalizedCurrentBranch, branches[0], DEFAULT_BRANCH_FALLBACK]
    .find((branch) => branch && (branch === DEFAULT_BRANCH_FALLBACK || branches.includes(branch))) ?? DEFAULT_BRANCH_FALLBACK

  return {
    branches,
    defaultBranch,
    currentBranch: normalizedCurrentBranch || undefined,
  }
}

const parseRemoteHeadBranch = (rawOutput: string) => {
  for (const line of rawOutput.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed.startsWith('ref: ')) {
      continue
    }

    const [ref] = trimmed.split('\t')
    return normalizeBranchName(ref.slice('ref: '.length))
  }

  return ''
}

const parseRemoteBranches = (rawOutput: string) => Array.from(new Set(
  rawOutput
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.split('\t')[1] || '')
    .map(normalizeBranchName)
    .filter(Boolean),
)).sort((left, right) => left.localeCompare(right))

const resolveRemoteTarget = async (repoPath: string, repoUrl?: string, env?: NodeJS.ProcessEnv) => {
  if (repoUrl?.trim()) {
    return repoUrl.trim()
  }

  const repoStats = await stat(repoPath).catch(() => null)
  if (!repoStats?.isDirectory()) {
    return ''
  }

  const git = createGitClient(repoPath, env)
  if (!await git.checkIsRepo()) {
    return ''
  }

  const remotes = await git.getRemotes(true)
  return remotes.find((remote) => remote.name === 'origin')?.refs.fetch?.trim() || ''
}

export const shouldPreferLocalBranchSnapshot = async (repoPath: string, repoUrl?: string, env?: NodeJS.ProcessEnv) => {
  if (repoUrl?.trim()) {
    return false
  }

  const repoStats = await stat(repoPath).catch(() => null)
  if (!repoStats?.isDirectory()) {
    return false
  }

  const git = createGitClient(repoPath, env)
  if (!await git.checkIsRepo().catch(() => false)) {
    return false
  }

  const remotes = await git.getRemotes(true).catch(() => [])
  return !remotes.some((remote) => remote.name === 'origin' && remote.refs.fetch?.trim())
}

export const resolveRemoteRepoBranchSnapshot = async (repoPath: string, repoUrl: string | undefined, preferredBranch?: string, env?: NodeJS.ProcessEnv) => {
  const remoteTarget = await resolveRemoteTarget(repoPath, repoUrl, env)
  if (!remoteTarget) {
    throw new Error('仓库未配置 origin，且没有可用的远端仓库地址。')
  }

  const currentBranch = await stat(repoPath)
    .then(async (repoStats) => {
      if (!repoStats.isDirectory()) {
        return undefined
      }

      const git = createGitClient(repoPath, env)
      if (!await git.checkIsRepo().catch(() => false)) {
        return undefined
      }

      return git
        .branchLocal()
        .then((summary) => normalizeBranchName(summary.current) || undefined)
        .catch(() => undefined)
    })
    .catch(() => undefined)

  const git = createGitClient(undefined, env)
  const [remoteHeadsOutput, remoteHeadOutput] = await Promise.all([
    git.raw(['ls-remote', '--heads', remoteTarget]),
    git.raw(['ls-remote', '--symref', remoteTarget, 'HEAD']),
  ])

  const branches = parseRemoteBranches(remoteHeadsOutput)
  const remoteHeadBranch = parseRemoteHeadBranch(remoteHeadOutput)
  const normalizedPreferredBranch = normalizeBranchName(preferredBranch ?? '')
  const defaultBranch = [remoteHeadBranch, normalizedPreferredBranch, branches[0], DEFAULT_BRANCH_FALLBACK]
    .find((branch) => branch && (branch === DEFAULT_BRANCH_FALLBACK || branches.includes(branch))) ?? DEFAULT_BRANCH_FALLBACK

  return {
    branches,
    defaultBranch,
    currentBranch,
    remoteTarget,
  }
}

export const resolvePreferredStartPoint = (params: {
  branches: string[]
  defaultBranch: string
  preferredBranch?: string
}) => {
  const requestedStartPoint = normalizeBranchName(params.preferredBranch ?? '') || params.defaultBranch
  return params.branches.includes(requestedStartPoint) ? requestedStartPoint : params.defaultBranch
}

export const ensurePreparedRepository = async (params: {
  repoPath: string
  remoteTarget: string
  startPoint: string
  env?: NodeJS.ProcessEnv
  allowRepairInvalidRepository?: boolean
}) => {
  const repoStats = await stat(params.repoPath).catch(() => null)
  if (repoStats && !repoStats.isDirectory()) {
    throw new Error(`目标路径不是目录：${params.repoPath}`)
  }

  if (repoStats) {
    const git = createGitClient(params.repoPath, params.env)
    if (await git.checkIsRepo().catch(() => false)) {
      await git.fetch(['origin', `${params.startPoint}:refs/remotes/origin/${params.startPoint}`])
      return
    }

    const entries = await readdir(params.repoPath)
    if (entries.length > 0) {
      if (params.allowRepairInvalidRepository) {
        rmSync(params.repoPath, {
          recursive: true,
          force: true,
          maxRetries: 5,
          retryDelay: 100,
        })
        mkdirSync(path.dirname(params.repoPath), { recursive: true })
      } else {
        throw new Error(`目标目录不是有效 Git 仓库：${params.repoPath}`)
      }
    }
  } else {
    mkdirSync(path.dirname(params.repoPath), { recursive: true })
  }

  await createGitClient(undefined, params.env).clone(params.remoteTarget, params.repoPath, ['--single-branch', '--branch', params.startPoint])
}
