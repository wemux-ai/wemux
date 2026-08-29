// [INPUT]: Scoped worktree paths, authenticated Git identities, and typed Git operation parameters.
// [OUTPUT]: Worker-local Git status, diff, mutation, commit, graph, and delivery results.
// [POS]: Worker execution boundary for all task and workspace Git commands.
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { simpleGit } from 'simple-git'
import { buildVibemuxAgentCommitMessage } from '@shared/git-commit-message'
import { rewriteGitCredentialError } from '@shared/git-auth'
import type {
  ExecutorGitBaselineDiffResult,
  ExecutorGitBaselineSnapshotResult,
  ExecutorGitCommitResult,
  ExecutorGitCheckoutResult,
  ExecutorGitCommitDiffResult,
  ExecutorGitChange,
  ExecutorGitChangeAction,
  ExecutorGitChangeActionResult,
  ExecutorGitDiffResult,
  ExecutorGitFileDiffResult,
  ExecutorGitGraphCommit,
  ExecutorGitGraphResult,
  ExecutorGitPullRequestResult,
  ExecutorGitPushResult,
  ExecutorGitRebaseResult,
  ExecutorGitWorkingTreeDiffResult,
  ExecutorGitStatusResult,
  TaskGitDiffFile,
  TaskRuntimeGitIdentity,
} from '@shared/types'
import { createTaskGitAuthContext } from '../execution/git-identity'
import { createGitClient, normalizeBranchName, normalizeFilesystemPath } from './local-git-repository'

const DEFAULT_BASE_BRANCH = 'main'

const getRemoteBranchRef = (branchName: string) => `origin/${branchName}`

const hasRemoteBranch = async (git: ReturnType<typeof simpleGit>, branchName: string) => {
  const branches = await git.branch(['-r'])
  return branches.all.includes(getRemoteBranchRef(branchName))
}

const fetchRemoteBranchIfExists = async (git: ReturnType<typeof simpleGit>, branchName: string) => {
  try {
    await git.fetch(['origin', `${branchName}:refs/remotes/origin/${branchName}`])
    return true
  } catch {
    return false
  }
}

type RemoteBranchSyncState = 'missing' | 'same' | 'local-ahead' | 'remote-ahead' | 'diverged'

type RemoteBranchSyncStatus = {
  state: RemoteBranchSyncState
  localHead: string
  remoteHead?: string
}

const readRefSha = async (git: ReturnType<typeof simpleGit>, ref: string) => {
  try {
    const sha = (await git.revparse([ref])).trim()
    return sha || null
  } catch {
    return null
  }
}

const inspectRemoteBranchSyncStatus = async (git: ReturnType<typeof simpleGit>, branchName: string): Promise<RemoteBranchSyncStatus> => {
  await git.fetch(['origin', '--prune'])
  await fetchRemoteBranchIfExists(git, branchName)

  const localHead = await readRefSha(git, 'HEAD')
  if (!localHead) {
    throw new Error('当前 worktree 没有可用的 HEAD 提交。')
  }

  if (!await hasRemoteBranch(git, branchName)) {
    return {
      state: 'missing',
      localHead,
    }
  }

  const remoteRef = getRemoteBranchRef(branchName)
  const remoteHead = await readRefSha(git, remoteRef)
  if (!remoteHead) {
    return {
      state: 'missing',
      localHead,
    }
  }

  if (remoteHead === localHead) {
    return {
      state: 'same',
      localHead,
      remoteHead,
    }
  }

  const mergeBase = (await git.raw(['merge-base', 'HEAD', remoteRef])).trim()
  if (mergeBase === remoteHead) {
    return {
      state: 'local-ahead',
      localHead,
      remoteHead,
    }
  }

  if (mergeBase === localHead) {
    return {
      state: 'remote-ahead',
      localHead,
      remoteHead,
    }
  }

  return {
    state: 'diverged',
    localHead,
    remoteHead,
  }
}

const formatShortSha = (sha?: string | null) => sha?.slice(0, 7) || 'unknown'

const ensurePullRequestBranchPublished = async (git: ReturnType<typeof simpleGit>, branchName: string) => {
  const status = await inspectRemoteBranchSyncStatus(git, branchName)
  switch (status.state) {
    case 'missing':
    case 'local-ahead':
      await git.push(['-u', 'origin', branchName])
      return
    case 'same':
      return
    case 'remote-ahead':
      throw new Error(
        `远端同名分支 ${branchName} 已包含本地没有的提交（local ${formatShortSha(status.localHead)} / remote ${formatShortSha(status.remoteHead)}）。请先同步该分支，或改用新的分支名后再创建 PR。`,
      )
    case 'diverged':
      throw new Error(
        `远端同名分支 ${branchName} 与当前工作区已经分叉（local ${formatShortSha(status.localHead)} / remote ${formatShortSha(status.remoteHead)}）。为避免把不相关提交混进同一个 PR，已停止创建 PR。请先 rebase/同步，或改用新的分支名。`,
      )
  }
}

const syncTaskBranchBeforePush = async (git: ReturnType<typeof simpleGit>, branchName: string) => {
  await git.fetch(['origin', '--prune'])
  const remoteBranchFetched = await fetchRemoteBranchIfExists(git, branchName)
  if (remoteBranchFetched || await hasRemoteBranch(git, branchName)) {
    await git.rebase([getRemoteBranchRef(branchName)])
  }
}

const buildCommitMessageFromReply = (
  reply: string,
  fallback = 'vibemux: workspace auto commit',
  identity?: TaskRuntimeGitIdentity,
) => (
  buildVibemuxAgentCommitMessage({
    reply,
    fallback,
    agentIdentity: {
      name: identity?.agentCoAuthorName,
      email: identity?.agentCoAuthorEmail,
    },
    userIdentity: {
      name: identity?.name,
      email: identity?.email,
    },
  })
)

const parseNullTerminatedList = (output: string) => output
  .split('\0')
  .map((item) => item.trim())
  .filter(Boolean)

const normalizeDiffPatchPath = (value: string) => value.split(path.sep).join('/')

const parseGitFileStats = (numstatOutput: string, nameStatusOutput: string) => {
  const statuses = new Map<string, string>()

  for (const line of nameStatusOutput.split('\n').map((item) => item.trim()).filter(Boolean)) {
    const parts = line.split('\t')
    const status = parts[0] || 'M'
    const filePath = parts.length > 2 ? `${parts[1]} → ${parts[2]}` : (parts[1] || '')
    if (filePath) {
      statuses.set(filePath, status)
    }
  }

  return numstatOutput
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.split('\t'))
    .map((parts): TaskGitDiffFile | null => {
      if (parts.length < 3) {
        return null
      }

      const additions = parts[0] === '-' ? 0 : Number(parts[0])
      const deletions = parts[1] === '-' ? 0 : Number(parts[1])
      const filePath = parts.length > 3 ? `${parts[2]} → ${parts[3]}` : parts[2]
      return {
        path: filePath,
        status: statuses.get(filePath) || 'M',
        additions: Number.isFinite(additions) ? additions : 0,
        deletions: Number.isFinite(deletions) ? deletions : 0,
      }
    })
    .filter((item): item is TaskGitDiffFile => Boolean(item))
}

const countBufferLines = (content: Buffer) => {
  if (content.length === 0 || content.includes(0)) {
    return 0
  }

  const normalized = content.toString('utf8').replace(/\r\n/g, '\n')
  if (!normalized) {
    return 0
  }

  const lineCount = normalized.split('\n').length
  return normalized.endsWith('\n') ? Math.max(0, lineCount - 1) : lineCount
}

const buildUntrackedFilePatch = (relativePath: string, content: Buffer) => {
  const patchPath = normalizeDiffPatchPath(relativePath)
  const header = [
    `diff --git a/${patchPath} b/${patchPath}`,
    'new file mode 100644',
    '--- /dev/null',
    `+++ b/${patchPath}`,
  ]

  if (content.length === 0) {
    return `${header.join('\n')}\n`
  }

  if (content.includes(0)) {
    return `${header.join('\n')}\nBinary files /dev/null and b/${patchPath} differ\n`
  }

  const normalized = content.toString('utf8').replace(/\r\n/g, '\n')
  const contentLines = normalized.endsWith('\n')
    ? normalized.slice(0, -1).split('\n')
    : normalized.split('\n')

  const hunkLines = [
    `@@ -0,0 +1,${contentLines.length} @@`,
    ...contentLines.map((line) => `+${line}`),
  ]

  if (!normalized.endsWith('\n')) {
    hunkLines.push('\\ No newline at end of file')
  }

  return `${header.join('\n')}\n${hunkLines.join('\n')}\n`
}

type UntrackedGitDiffEntry = {
  file: TaskGitDiffFile
  patch: string
}

const readUntrackedGitDiffEntries = async (worktreePath: string, rawOutput: string): Promise<UntrackedGitDiffEntry[]> => {
  return Promise.all(
    parseNullTerminatedList(rawOutput).map(async (relativePath) => {
      const absolutePath = path.join(worktreePath, relativePath)
      const content = await readFile(absolutePath).catch(() => Buffer.alloc(0))

      return {
        file: {
          path: relativePath,
          status: '??',
          additions: countBufferLines(content),
          deletions: 0,
        },
        patch: buildUntrackedFilePatch(relativePath, content),
      }
    }),
  )
}

const readUntrackedGitDiffFiles = async (worktreePath: string, rawOutput: string) => {
  const entries = await readUntrackedGitDiffEntries(worktreePath, rawOutput)
  return entries.map((entry) => entry.file)
}

const joinPatchSegments = (segments: string[]) => {
  const normalizedSegments = segments
    .map((segment) => segment.trimEnd())
    .filter(Boolean)

  return normalizedSegments.length > 0 ? `${normalizedSegments.join('\n')}\n` : ''
}

const normalizeGitRelativePath = (value: string) => {
  const normalized = value.trim().replace(/\\/g, '/')
  if (!normalized || normalized.includes('\0') || path.isAbsolute(normalized)) {
    return null
  }

  const segments = normalized.split('/')
  if (segments.some((segment) => !segment || segment === '.' || segment === '..')) {
    return null
  }

  return normalized
}

const parseGitPorcelainChanges = (output: string): Array<{ path: string; indexStatus: string; worktreeStatus: string }> => {
  const records = output.split('\0').filter(Boolean)
  const changes: Array<{ path: string; indexStatus: string; worktreeStatus: string }> = []

  for (let index = 0; index < records.length; index += 1) {
    const record = records[index]!
    const indexStatus = record[0] || ' '
    const worktreeStatus = record[1] || ' '
    const rawPath = record.slice(3)
    const normalizedPath = normalizeGitRelativePath(rawPath)
    if (!normalizedPath) {
      continue
    }

    // Porcelain v1 emits a second NUL-delimited source path for renames/copies.
    if (indexStatus === 'R' || indexStatus === 'C') {
      index += 1
    }

    changes.push({ path: normalizedPath, indexStatus, worktreeStatus })
  }

  return changes
}

const parseNumstatByPath = (output: string) => new Map(
  output
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((line) => {
      const parts = line.split('\t')
      const filePath = normalizeGitRelativePath(parts.at(-1) || '')
      if (!filePath) return []
      const additions = parts[0] === '-' ? 0 : Number(parts[0])
      const deletions = parts[1] === '-' ? 0 : Number(parts[1])
      return [[filePath, {
        additions: Number.isFinite(additions) ? additions : 0,
        deletions: Number.isFinite(deletions) ? deletions : 0,
      }] as const]
    }),
)

const buildGitStatusChanges = async (git: ReturnType<typeof simpleGit>): Promise<ExecutorGitChange[]> => {
  const [porcelain, stagedNumstat, unstagedNumstat] = await Promise.all([
    git.raw(['status', '--porcelain=v1', '-z', '--untracked-files=all']),
    git.raw(['diff', '--cached', '--numstat', '--find-renames']),
    git.raw(['diff', '--numstat', '--find-renames']),
  ])
  const stagedStats = parseNumstatByPath(stagedNumstat)
  const unstagedStats = parseNumstatByPath(unstagedNumstat)

  return parseGitPorcelainChanges(porcelain).flatMap((change) => {
    const conflicted = change.indexStatus === 'U' || change.worktreeStatus === 'U'
    if (conflicted) {
      return [{
        path: change.path,
        status: `${change.indexStatus}${change.worktreeStatus}`.trim(),
        stage: 'unstaged' as const,
        additions: 0,
        deletions: 0,
        conflicted: true,
      }]
    }
    const changes: ExecutorGitChange[] = []
    if (change.indexStatus !== ' ' && change.indexStatus !== '?') {
      const stat = stagedStats.get(change.path)
      changes.push({
        path: change.path,
        status: change.indexStatus,
        stage: 'staged',
        additions: stat?.additions ?? 0,
        deletions: stat?.deletions ?? 0,
        conflicted,
      })
    }
    if (change.worktreeStatus !== ' ' || change.indexStatus === '?') {
      const stat = unstagedStats.get(change.path)
      changes.push({
        path: change.path,
        status: change.indexStatus === '?' ? '??' : change.worktreeStatus,
        stage: 'unstaged',
        additions: stat?.additions ?? 0,
        deletions: stat?.deletions ?? 0,
        conflicted,
      })
    }
    return changes
  })
}

const createTemporaryIndexFile = async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'vibemux-git-index-'))
  const indexPath = path.join(tempDir, 'index')
  await writeFile(indexPath, '', 'utf8')
  return {
    indexPath,
    cleanup: async () => {
      await rm(tempDir, { recursive: true, force: true }).catch(() => undefined)
    },
  }
}

const hasCommitTreeObject = async (git: ReturnType<typeof simpleGit>, treeSha: string) => {
  try {
    await git.raw(['rev-parse', '--verify', `${treeSha}^{tree}`])
    return true
  } catch {
    return false
  }
}

const buildBaselineSnapshot = async (git: ReturnType<typeof simpleGit>, worktreePath: string) => {
  const temporaryIndex = await createTemporaryIndexFile()
  const env = {
    ...(process.env ?? {}),
    GIT_INDEX_FILE: temporaryIndex.indexPath,
  }
  const indexGit = createGitClient(worktreePath, env)

  try {
    const headExists = await hasHeadCommit(git)
    if (headExists) {
      await indexGit.raw(['read-tree', 'HEAD'])
    }

    await indexGit.raw(['add', '--all'])
    const treeSha = (await indexGit.raw(['write-tree'])).trim()
    const currentBranch = await readCurrentBranch(git)

    return {
      ok: Boolean(treeSha),
      message: treeSha ? '已创建当前 turn 的 Git baseline。' : '创建当前 turn 的 Git baseline 失败。',
      currentBranch,
      treeSha: treeSha || undefined,
    } satisfies ExecutorGitBaselineSnapshotResult
  } finally {
    await temporaryIndex.cleanup()
  }
}

const diffBaselineTreeToCurrentWorkingTree = async (params: {
  git: ReturnType<typeof simpleGit>
  worktreePath: string
  baselineTreeSha: string
}) => {
  const temporaryIndex = await createTemporaryIndexFile()
  const env = {
    ...(process.env ?? {}),
    GIT_INDEX_FILE: temporaryIndex.indexPath,
  }
  const indexGit = createGitClient(params.worktreePath, env)

  try {
    await indexGit.raw(['read-tree', params.baselineTreeSha])
    await indexGit.raw(['add', '--all'])
    const currentTreeSha = (await indexGit.raw(['write-tree'])).trim()

    const [numstatOutput, nameStatusOutput, trackedPatch] = await Promise.all([
      params.git.raw(['diff', '--numstat', '--find-renames', params.baselineTreeSha, currentTreeSha]),
      params.git.raw(['diff', '--name-status', '--find-renames', params.baselineTreeSha, currentTreeSha]),
      params.git.raw(['diff', '--find-renames', params.baselineTreeSha, currentTreeSha]),
    ])

    return {
      treeSha: currentTreeSha,
      files: parseGitFileStats(numstatOutput, nameStatusOutput),
      patch: trackedPatch.trim() ? `${trackedPatch.trimEnd()}\n` : '',
    }
  } finally {
    await temporaryIndex.cleanup()
  }
}

const diffBaselineTreeToCommit = async (params: {
  git: ReturnType<typeof simpleGit>
  baselineTreeSha: string
  targetCommitSha: string
}) => {
  const commitTreeSha = (await params.git.raw(['show', '-s', '--format=%T', params.targetCommitSha])).trim()
  const [numstatOutput, nameStatusOutput, trackedPatch] = await Promise.all([
    params.git.raw(['diff', '--numstat', '--find-renames', params.baselineTreeSha, commitTreeSha]),
    params.git.raw(['diff', '--name-status', '--find-renames', params.baselineTreeSha, commitTreeSha]),
    params.git.raw(['diff', '--find-renames', params.baselineTreeSha, commitTreeSha]),
  ])

  return {
    treeSha: commitTreeSha,
    files: parseGitFileStats(numstatOutput, nameStatusOutput),
    patch: trackedPatch.trim() ? `${trackedPatch.trimEnd()}\n` : '',
  }
}

const resolveExistingBaseReference = async (git: ReturnType<typeof simpleGit>, baseBranch: string) => {
  const candidates = [
    `refs/remotes/origin/${baseBranch}`,
    `origin/${baseBranch}`,
    `refs/heads/${baseBranch}`,
    baseBranch,
  ]

  for (const candidate of candidates) {
    try {
      await git.raw(['rev-parse', '--verify', candidate])
      return {
        baseBranch,
        baseRef: candidate,
      }
    } catch {
      // try next ref
    }
  }

  return null
}

const resolveBaseReference = async (
  git: ReturnType<typeof simpleGit>,
  baseBranch: string,
  options?: { forceFetchFirst?: boolean },
) => {
  const normalizedBaseBranch = normalizeBranchName(baseBranch) || DEFAULT_BASE_BRANCH

  if (options?.forceFetchFirst) {
    try {
      await git.fetch(['origin', `${normalizedBaseBranch}:refs/remotes/origin/${normalizedBaseBranch}`])
    } catch {
      // fall back to existing refs below
    }
  }

  const existingRef = await resolveExistingBaseReference(git, normalizedBaseBranch)
  if (existingRef) {
    return existingRef
  }

  if (!options?.forceFetchFirst) {
    try {
      await git.fetch(['origin', `${normalizedBaseBranch}:refs/remotes/origin/${normalizedBaseBranch}`])
    } catch {
      // fallback to local refs below
    }

    const fetchedRef = await resolveExistingBaseReference(git, normalizedBaseBranch)
    if (fetchedRef) {
      return fetchedRef
    }
  }

  throw new Error(`找不到基线分支 ${normalizedBaseBranch}。`)
}

const readCurrentBranch = async (git: ReturnType<typeof simpleGit>) => {
  const summary = await git.branchLocal()
  return normalizeBranchName(summary.current) || 'HEAD'
}

const readAheadCommitCount = async (git: ReturnType<typeof simpleGit>, baseRef: string) => {
  try {
    const output = await git.raw(['rev-list', '--count', `${baseRef}..HEAD`])
    const count = Number(output.trim())
    return Number.isFinite(count) ? count : 0
  } catch {
    return 0
  }
}

const hasHeadCommit = async (git: ReturnType<typeof simpleGit>) => {
  try {
    await git.raw(['rev-parse', '--verify', 'HEAD'])
    return true
  } catch {
    return false
  }
}

const resolveCommitParent = async (git: ReturnType<typeof simpleGit>, commitSha: string) => {
  try {
    const output = await git.raw(['rev-list', '--parents', '-n', '1', commitSha])
    const parts = output.trim().split(/\s+/).filter(Boolean)
    return parts[1]
  } catch {
    return undefined
  }
}

const readConflictedFiles = async (git: ReturnType<typeof simpleGit>) => {
  try {
    const output = await git.raw(['diff', '--name-only', '--diff-filter=U'])
    return output.split('\n').map((item) => item.trim()).filter(Boolean)
  } catch {
    return []
  }
}

const parseGitRefs = (rawDecoration: string) => {
  const trimmed = rawDecoration.trim()
  if (!trimmed.startsWith('(') || !trimmed.endsWith(')')) {
    return []
  }

  return trimmed
    .slice(1, -1)
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
}

const parseGitHubRepoUrl = (repoUrl: string) => {
  const trimmed = repoUrl.trim()
  if (!trimmed) {
    return null
  }

  const patterns = [
    /^https?:\/\/github\.com\/([^/]+)\/([^/.]+?)(?:\.git)?$/i,
    /^git@github\.com:([^/]+)\/([^/.]+?)(?:\.git)?$/i,
    /^ssh:\/\/git@github\.com\/([^/]+)\/([^/.]+?)(?:\.git)?$/i,
  ]

  for (const pattern of patterns) {
    const match = trimmed.match(pattern)
    if (match) {
      return {
        owner: match[1],
        repo: match[2],
      }
    }
  }

  return null
}

const parseGitGraphCommits = (rawOutput: string): ExecutorGitGraphCommit[] => {
  return rawOutput
    .split('\x1e')
    .map((chunk) => chunk.trim())
    .filter(Boolean)
    .map((chunk) => {
      const [sha = '', parentText = '', decoration = '', subject = '', authorDate = '', authorName = ''] = chunk.split('\x1f')
      const refs = parseGitRefs(decoration)
      return {
        sha,
        shortSha: sha.slice(0, 7),
        parents: parentText.split(' ').map((item) => item.trim()).filter(Boolean),
        subject: subject.trim(),
        authorDate: authorDate.trim(),
        authorName: authorName.trim(),
        refs,
        isHead: refs.some((ref) => ref.startsWith('HEAD')),
      } satisfies ExecutorGitGraphCommit
    })
}

const withTaskGitContext = async <T>(params: {
  worktreePath: string
  repoUrl?: string
  gitIdentity?: TaskRuntimeGitIdentity
  taskKey: string
  run: (git: ReturnType<typeof simpleGit>) => Promise<T>
}) => {
  const resolvedWorktreePath = normalizeFilesystemPath(params.worktreePath)
  const gitAuthContext = createTaskGitAuthContext({
    taskId: `${params.taskKey}-${Buffer.from(resolvedWorktreePath).toString('base64url').slice(0, 24)}`,
    identity: params.gitIdentity ?? { mode: 'personal' },
    repoUrl: params.repoUrl,
  })

  try {
    gitAuthContext.configureRepo(resolvedWorktreePath)
    const git = createGitClient(resolvedWorktreePath, gitAuthContext.env)
    return await params.run(git)
  } finally {
    gitAuthContext.cleanup(resolvedWorktreePath)
  }
}

export const getLocalTaskGitDiff = async (params: {
  worktreePath: string
  repoUrl?: string
  baseBranch: string
  gitIdentity?: TaskRuntimeGitIdentity
}): Promise<ExecutorGitDiffResult> => {
  try {
    return await withTaskGitContext({
      ...params,
      taskKey: 'git-diff',
      run: async (git) => {
        const { baseBranch, baseRef } = await resolveBaseReference(git, params.baseBranch)
        const currentBranch = await readCurrentBranch(git)
        const worktreePath = normalizeFilesystemPath(params.worktreePath)
        const [numstatOutput, nameStatusOutput, trackedPatch, aheadCommits, untrackedOutput] = await Promise.all([
          git.raw(['diff', '--numstat', '--find-renames', '--merge-base', baseRef]),
          git.raw(['diff', '--name-status', '--find-renames', '--merge-base', baseRef]),
          git.raw(['diff', '--find-renames', '--merge-base', baseRef]),
          readAheadCommitCount(git, baseRef),
          git.raw(['ls-files', '--others', '--exclude-standard', '-z']),
        ])
        const trackedFiles = parseGitFileStats(numstatOutput, nameStatusOutput)
        const trackedPathSet = new Set(trackedFiles.map((file) => file.path))
        const untrackedEntries = await readUntrackedGitDiffEntries(worktreePath, untrackedOutput)
        const untrackedFiles = untrackedEntries
          .map((entry) => entry.file)
          .filter((file) => !trackedPathSet.has(file.path))
        const files = trackedFiles.concat(untrackedFiles)
        const patch = joinPatchSegments([trackedPatch, ...untrackedEntries.map((entry) => entry.patch)])

        return {
          ok: true,
          message: files.length > 0 ? `已生成当前工作区相对 ${baseBranch} 的差异。` : `当前工作区相对 ${baseBranch} 没有差异。`,
          baseBranch,
          currentBranch,
          aheadCommits,
          files,
          patch,
        }
      },
    })
  } catch (error) {
    const normalizedError = rewriteGitCredentialError(error, params.repoUrl)
    return {
      ok: false,
      message: normalizedError instanceof Error ? normalizedError.message : '读取 Git diff 失败。',
      baseBranch: normalizeBranchName(params.baseBranch) || DEFAULT_BASE_BRANCH,
      currentBranch: 'HEAD',
      aheadCommits: 0,
      files: [],
      patch: '',
    }
  }
}

export const getLocalTaskGitBaselineSnapshot = async (params: {
  worktreePath: string
  repoUrl?: string
  gitIdentity?: TaskRuntimeGitIdentity
}): Promise<ExecutorGitBaselineSnapshotResult> => {
  try {
    return await withTaskGitContext({
      ...params,
      taskKey: 'git-baseline-snapshot',
      run: async (git) => {
        return buildBaselineSnapshot(git, normalizeFilesystemPath(params.worktreePath))
      },
    })
  } catch (error) {
    const normalizedError = rewriteGitCredentialError(error, params.repoUrl)
    return {
      ok: false,
      message: normalizedError instanceof Error ? normalizedError.message : '创建 Git turn baseline 失败。',
      currentBranch: 'HEAD',
      treeSha: undefined,
    }
  }
}

export const getLocalTaskGitBaselineDiff = async (params: {
  worktreePath: string
  repoUrl?: string
  baselineTreeSha: string
  targetCommitSha?: string
  gitIdentity?: TaskRuntimeGitIdentity
}): Promise<ExecutorGitBaselineDiffResult> => {
  try {
    return await withTaskGitContext({
      ...params,
      taskKey: 'git-baseline-diff',
      run: async (git) => {
        const baselineTreeSha = params.baselineTreeSha.trim()
        const targetCommitSha = params.targetCommitSha?.trim() || ''
        if (!baselineTreeSha) {
          return {
            ok: false,
            message: '缺少 turn baseline tree SHA。',
            currentBranch: await readCurrentBranch(git),
            treeSha: undefined,
            targetCommitSha: targetCommitSha || undefined,
            files: [],
            patch: '',
          }
        }

        const baselineExists = await hasCommitTreeObject(git, baselineTreeSha)
        if (!baselineExists) {
          return {
            ok: false,
            message: `找不到 turn baseline tree ${baselineTreeSha.slice(0, 12)}。`,
            currentBranch: await readCurrentBranch(git),
            treeSha: undefined,
            targetCommitSha: targetCommitSha || undefined,
            files: [],
            patch: '',
          }
        }

        const currentBranch = await readCurrentBranch(git)
        const diffResult = targetCommitSha
          ? await diffBaselineTreeToCommit({
              git,
              baselineTreeSha,
              targetCommitSha,
            })
          : await diffBaselineTreeToCurrentWorkingTree({
              git,
              worktreePath: normalizeFilesystemPath(params.worktreePath),
              baselineTreeSha,
            })

        return {
          ok: true,
          message: diffResult.files.length > 0
            ? (targetCommitSha
                ? `已生成 turn baseline 到提交 ${targetCommitSha.slice(0, 7)} 的差异。`
                : '已生成 turn baseline 到当前工作区的差异。')
            : (targetCommitSha
                ? `turn baseline 到提交 ${targetCommitSha.slice(0, 7)} 没有差异。`
                : 'turn baseline 到当前工作区没有差异。'),
          currentBranch,
          treeSha: diffResult.treeSha || undefined,
          targetCommitSha: targetCommitSha || undefined,
          files: diffResult.files,
          patch: diffResult.patch,
        }
      },
    })
  } catch (error) {
    const normalizedError = rewriteGitCredentialError(error, params.repoUrl)
    return {
      ok: false,
      message: normalizedError instanceof Error ? normalizedError.message : '读取 Git turn baseline diff 失败。',
      currentBranch: 'HEAD',
      treeSha: undefined,
      targetCommitSha: params.targetCommitSha?.trim() || undefined,
      files: [],
      patch: '',
    }
  }
}

export const getLocalTaskGitWorkingTreeDiff = async (params: {
  worktreePath: string
  repoUrl?: string
  gitIdentity?: TaskRuntimeGitIdentity
}): Promise<ExecutorGitWorkingTreeDiffResult> => {
  try {
    return await withTaskGitContext({
      ...params,
      taskKey: 'git-working-tree-diff',
      run: async (git) => {
        const currentBranch = await readCurrentBranch(git)
        const headExists = await hasHeadCommit(git)
        const worktreePath = normalizeFilesystemPath(params.worktreePath)
        const [trackedNumstatOutput, trackedNameStatusOutput, trackedPatch, untrackedOutput] = await Promise.all([
          headExists ? git.raw(['diff', '--numstat', '--find-renames', 'HEAD']) : Promise.resolve(''),
          headExists ? git.raw(['diff', '--name-status', '--find-renames', 'HEAD']) : Promise.resolve(''),
          headExists ? git.raw(['diff', '--find-renames', 'HEAD']) : Promise.resolve(''),
          git.raw(['ls-files', '--others', '--exclude-standard', '-z']),
        ])

        const trackedFiles = headExists
          ? parseGitFileStats(trackedNumstatOutput, trackedNameStatusOutput)
          : []
        const untrackedEntries = await readUntrackedGitDiffEntries(worktreePath, untrackedOutput)
        const untrackedFiles = untrackedEntries.map((entry) => entry.file)
        const trackedPathSet = new Set(trackedFiles.map((file) => file.path))
        const files = trackedFiles.concat(untrackedFiles.filter((file) => !trackedPathSet.has(file.path)))
        const patch = joinPatchSegments([trackedPatch, ...untrackedEntries.map((entry) => entry.patch)])

        return {
          ok: true,
          message: files.length > 0 ? '已生成当前工作区未提交改动。' : '当前工作区没有未提交改动。',
          currentBranch,
          files,
          patch,
        }
      },
    })
  } catch (error) {
    const normalizedError = rewriteGitCredentialError(error, params.repoUrl)
    return {
      ok: false,
      message: normalizedError instanceof Error ? normalizedError.message : '读取当前工作区 Git 改动失败。',
      currentBranch: 'HEAD',
      files: [],
      patch: '',
    }
  }
}

export const getLocalTaskGitStatus = async (params: {
  worktreePath: string
  repoUrl?: string
  gitIdentity?: TaskRuntimeGitIdentity
}): Promise<ExecutorGitStatusResult> => {
  try {
    return await withTaskGitContext({
      ...params,
      taskKey: 'git-status',
      run: async (git) => {
        const [currentBranch, changes] = await Promise.all([
          readCurrentBranch(git),
          buildGitStatusChanges(git),
        ])
        return {
          ok: true,
          message: changes.length > 0 ? `已读取 ${changes.length} 项工作区改动。` : '当前工作区没有改动。',
          currentBranch,
          changes,
        }
      },
    })
  } catch (error) {
    const normalizedError = rewriteGitCredentialError(error, params.repoUrl)
    return {
      ok: false,
      message: normalizedError instanceof Error ? normalizedError.message : '读取 Git 状态失败。',
      currentBranch: 'HEAD',
      changes: [],
    }
  }
}

export const getLocalTaskGitFileDiff = async (params: {
  worktreePath: string
  repoUrl?: string
  path: string
  stage: 'staged' | 'unstaged'
  gitIdentity?: TaskRuntimeGitIdentity
}): Promise<ExecutorGitFileDiffResult> => {
  const relativePath = normalizeGitRelativePath(params.path)
  if (!relativePath) {
    return { ok: false, message: '文件路径无效。', path: params.path, stage: params.stage, patch: '' }
  }

  try {
    return await withTaskGitContext({
      ...params,
      taskKey: 'git-file-diff',
      run: async (git) => {
        if (params.stage === 'unstaged') {
          const untrackedOutput = await git.raw(['ls-files', '--others', '--exclude-standard', '-z', '--', relativePath])
          if (parseNullTerminatedList(untrackedOutput).includes(relativePath)) {
            const entries = await readUntrackedGitDiffEntries(normalizeFilesystemPath(params.worktreePath), `${relativePath}\0`)
            return {
              ok: true,
              message: '已读取未跟踪文件。',
              path: relativePath,
              stage: params.stage,
              patch: entries[0]?.patch || '',
            }
          }
        }

        const patch = await git.raw([
          'diff',
          ...(params.stage === 'staged' ? ['--cached'] : []),
          '--find-renames',
          '--',
          relativePath,
        ])
        return {
          ok: true,
          message: patch.trim() ? '已读取文件差异。' : '该文件没有可展示的差异。',
          path: relativePath,
          stage: params.stage,
          patch: patch.trim() ? `${patch.trimEnd()}\n` : '',
        }
      },
    })
  } catch (error) {
    const normalizedError = rewriteGitCredentialError(error, params.repoUrl)
    return {
      ok: false,
      message: normalizedError instanceof Error ? normalizedError.message : '读取文件 diff 失败。',
      path: relativePath,
      stage: params.stage,
      patch: '',
    }
  }
}

export const applyLocalTaskGitChange = async (params: {
  worktreePath: string
  repoUrl?: string
  action: ExecutorGitChangeAction
  paths: string[]
  gitIdentity?: TaskRuntimeGitIdentity
}): Promise<ExecutorGitChangeActionResult> => {
  const paths = Array.from(new Set(params.paths.map(normalizeGitRelativePath).filter((item): item is string => Boolean(item))))
  if (paths.length === 0 || paths.length !== params.paths.length) {
    return { ok: false, message: '至少需要一个工作区内的有效文件路径。', changedPaths: [] }
  }

  try {
    return await withTaskGitContext({
      ...params,
      taskKey: `git-change-${params.action}`,
      run: async (git) => {
        if (params.action === 'stage') {
          await git.raw(['add', '--', ...paths])
          return { ok: true, message: `已暂存 ${paths.length} 个文件。`, changedPaths: paths }
        }

        if (params.action === 'unstage') {
          if (await hasHeadCommit(git)) {
            await git.raw(['restore', '--staged', '--', ...paths])
          } else {
            await git.raw(['rm', '--cached', '--ignore-unmatch', '--', ...paths])
          }
          return { ok: true, message: `已取消暂存 ${paths.length} 个文件。`, changedPaths: paths }
        }

        const status = await git.raw(['status', '--porcelain=v1', '-z', '--untracked-files=all', '--', ...paths])
        const untrackedPaths = parseGitPorcelainChanges(status)
          .filter((item) => item.indexStatus === '?')
          .map((item) => item.path)
        const trackedPaths = paths.filter((item) => !untrackedPaths.includes(item))
        if (untrackedPaths.length > 0) {
          await git.raw(['clean', '-f', '--', ...untrackedPaths])
        }
        if (trackedPaths.length > 0) {
          if (!await hasHeadCommit(git)) {
            return { ok: false, message: '首个提交前无法恢复已跟踪文件。', changedPaths: untrackedPaths }
          }
          await git.raw(['restore', '--source=HEAD', '--staged', '--worktree', '--', ...trackedPaths])
        }
        return { ok: true, message: `已丢弃 ${paths.length} 个文件的改动。`, changedPaths: paths }
      },
    })
  } catch (error) {
    const normalizedError = rewriteGitCredentialError(error, params.repoUrl)
    return {
      ok: false,
      message: normalizedError instanceof Error ? normalizedError.message : '更新 Git 改动失败。',
      changedPaths: [],
    }
  }
}

export const commitLocalTaskStagedChanges = async (params: {
  worktreePath: string
  repoUrl?: string
  branchName?: string
  commitMessage: string
  push?: boolean
  gitIdentity?: TaskRuntimeGitIdentity
}): Promise<ExecutorGitCommitResult> => {
  const commitMessage = params.commitMessage.trim()
  if (!commitMessage) {
    return { ok: false, message: '请输入提交信息。', branchName: params.branchName?.trim() || '', changedFiles: [] }
  }

  try {
    return await withTaskGitContext({
      ...params,
      taskKey: 'git-commit-staged',
      run: async (git) => {
        const currentBranch = params.branchName?.trim() || await readCurrentBranch(git)
        const normalizedBranch = normalizeBranchName(currentBranch)
        const stagedChanges = (await buildGitStatusChanges(git)).filter((change) => change.stage === 'staged')
        const changedFiles = Array.from(new Set(stagedChanges.map((change) => change.path))).sort()
        if (changedFiles.length === 0) {
          return { ok: false, message: '没有已暂存的改动可提交。', branchName: normalizedBranch || currentBranch, changedFiles }
        }
        if (!params.gitIdentity?.name || !params.gitIdentity.email) {
          return { ok: false, message: '当前任务缺少 Git 用户名或邮箱，请先在设置页完成 Git 授权配置。', branchName: normalizedBranch || currentBranch, changedFiles }
        }

        await git.commit(commitMessage)
        const commitSha = (await git.revparse(['HEAD'])).trim()
        if (!params.push) {
          return { ok: true, message: '已创建本地提交。', branchName: normalizedBranch || currentBranch, changedFiles, commitSha: commitSha || undefined }
        }
        if (!normalizedBranch) {
          return { ok: false, message: '已创建本地提交，但当前 worktree 不在有效分支上，无法推送。', branchName: currentBranch, changedFiles, commitSha: commitSha || undefined }
        }
        if (!params.gitIdentity.credentialToken) {
          return { ok: true, message: '缺少 task 级临时凭证，已创建本地提交但未推送远端。', branchName: normalizedBranch, changedFiles, commitSha: commitSha || undefined }
        }

        await syncTaskBranchBeforePush(git, normalizedBranch)
        await git.push(['-u', 'origin', normalizedBranch])
        return { ok: true, message: `已推送远端分支 ${normalizedBranch}。`, branchName: normalizedBranch, changedFiles, commitSha: commitSha || undefined, remoteBranchName: normalizedBranch }
      },
    })
  } catch (error) {
    const normalizedError = rewriteGitCredentialError(error, params.repoUrl)
    return { ok: false, message: normalizedError instanceof Error ? normalizedError.message : '提交已暂存改动失败。', branchName: params.branchName?.trim() || '', changedFiles: [] }
  }
}

export const getLocalTaskCommitDiff = async (params: {
  worktreePath: string
  repoUrl?: string
  commitSha: string
  gitIdentity?: TaskRuntimeGitIdentity
}): Promise<ExecutorGitCommitDiffResult> => {
  try {
    return await withTaskGitContext({
      worktreePath: params.worktreePath,
      repoUrl: params.repoUrl,
      gitIdentity: params.gitIdentity,
      taskKey: 'git-commit-diff',
      run: async (git) => {
        const commitSha = params.commitSha.trim()
        if (!commitSha) {
          return {
            ok: false,
            message: '缺少 commit SHA。',
            commitSha: '',
            files: [],
            patch: '',
          }
        }

        await git.raw(['rev-parse', '--verify', commitSha])
        const parentSha = await resolveCommitParent(git, commitSha)
        const [patch, numstatOutput, nameStatusOutput] = await Promise.all([
          git.raw(['show', '--format=', '--find-renames', commitSha]),
          git.raw(['show', '--format=', '--numstat', '--find-renames', commitSha]),
          git.raw(['show', '--format=', '--name-status', '--find-renames', commitSha]),
        ])
        const files = parseGitFileStats(numstatOutput, nameStatusOutput)

        return {
          ok: true,
          message: files.length > 0 ? `已加载提交 ${commitSha.slice(0, 7)} 的 diff。` : `提交 ${commitSha.slice(0, 7)} 没有文件差异。`,
          commitSha,
          parentSha,
          files,
          patch,
        }
      },
    })
  } catch (error) {
    const normalizedError = rewriteGitCredentialError(error, params.repoUrl)
    return {
      ok: false,
      message: normalizedError instanceof Error ? normalizedError.message : '读取 commit diff 失败。',
      commitSha: params.commitSha.trim(),
      files: [],
      patch: '',
    }
  }
}

export const rebaseLocalTaskBranch = async (params: {
  worktreePath: string
  repoUrl?: string
  baseBranch: string
  gitIdentity?: TaskRuntimeGitIdentity
}): Promise<ExecutorGitRebaseResult> => {
  try {
    return await withTaskGitContext({
      ...params,
      taskKey: 'git-rebase',
      run: async (git) => {
        const { baseBranch, baseRef } = await resolveBaseReference(git, params.baseBranch, { forceFetchFirst: true })
        const currentBranch = await readCurrentBranch(git)

        try {
          await git.raw(['rebase', baseRef])
          return {
            ok: true,
            message: `已将 ${currentBranch} rebase 到 ${baseBranch}。`,
            baseBranch,
            currentBranch,
            conflicts: false,
            conflictedFiles: [],
          }
        } catch (error) {
          const conflictedFiles = await readConflictedFiles(git)
          const normalizedError = rewriteGitCredentialError(error, params.repoUrl)
          return {
            ok: false,
            message: conflictedFiles.length > 0
              ? `rebase 发生冲突，请先解决冲突后再继续。${normalizedError instanceof Error ? ` ${normalizedError.message}` : ''}`.trim()
              : (normalizedError instanceof Error ? normalizedError.message : '执行 rebase 失败。'),
            baseBranch,
            currentBranch,
            conflicts: conflictedFiles.length > 0,
            conflictedFiles,
          }
        }
      },
    })
  } catch (error) {
    const normalizedError = rewriteGitCredentialError(error, params.repoUrl)
    return {
      ok: false,
      message: normalizedError instanceof Error ? normalizedError.message : '执行 rebase 失败。',
      baseBranch: normalizeBranchName(params.baseBranch) || DEFAULT_BASE_BRANCH,
      currentBranch: 'HEAD',
      conflicts: false,
      conflictedFiles: [],
    }
  }
}

export const getLocalTaskGitGraph = async (params: {
  worktreePath: string
  repoUrl?: string
  baseBranch: string
  limit?: number
  gitIdentity?: TaskRuntimeGitIdentity
}): Promise<ExecutorGitGraphResult> => {
  const limit = Math.min(120, Math.max(10, params.limit ?? 40))

  try {
    return await withTaskGitContext({
      ...params,
      taskKey: 'git-graph',
      run: async (git) => {
        const currentBranch = await readCurrentBranch(git)
        const baseBranch = normalizeBranchName(params.baseBranch) || DEFAULT_BASE_BRANCH
        const commitsOutput = await git.raw([
          'log',
          '--decorate=short',
          '--date=iso-local',
          '--topo-order',
          `--max-count=${limit}`,
          '--all',
          '--format=%H%x1f%P%x1f%d%x1f%s%x1f%cd%x1f%an%x1e',
        ])
        const graph = await git.raw([
          'log',
          '--graph',
          '--decorate',
          '--date=short',
          `--max-count=${limit}`,
          '--all',
          '--no-color',
          '--pretty=format:%h %d %s (%cd)',
        ])
        const commits = parseGitGraphCommits(commitsOutput)

        return {
          ok: true,
          message: '已加载 Git graph。',
          baseBranch,
          currentBranch,
          limit,
          commitCount: commits.length,
          graph,
          commits,
        }
      },
    })
  } catch (error) {
    const normalizedError = rewriteGitCredentialError(error, params.repoUrl)
    return {
      ok: false,
      message: normalizedError instanceof Error ? normalizedError.message : '读取 Git graph 失败。',
      baseBranch: normalizeBranchName(params.baseBranch) || DEFAULT_BASE_BRANCH,
      currentBranch: 'HEAD',
      limit,
      commitCount: 0,
      graph: '',
      commits: [],
    }
  }
}

export const commitLocalTaskChanges = async (params: {
  worktreePath: string
  repoUrl?: string
  branchName?: string
  commitMessage: string
  push?: boolean
  gitIdentity?: TaskRuntimeGitIdentity
}): Promise<ExecutorGitCommitResult> => {
  const fallbackBranchName = normalizeBranchName(params.branchName ?? '')

  try {
    return await withTaskGitContext({
      ...params,
      taskKey: 'git-commit',
      run: async (git) => {
        const currentBranch = params.branchName?.trim() || await readCurrentBranch(git)
        const normalizedBranch = normalizeBranchName(currentBranch) || fallbackBranchName
        const status = await git.status()
        const changedFiles = Array.from(new Set(status.files.map((file) => file.path))).sort()

        if (changedFiles.length === 0) {
          return {
            ok: true,
            message: '没有文件改动，跳过提交与推送。',
            branchName: normalizedBranch || currentBranch,
            changedFiles,
          }
        }

        if (!params.gitIdentity?.name || !params.gitIdentity.email) {
          return {
            ok: false,
            message: '当前任务缺少 Git 用户名或邮箱，请先在设置页完成 Git 授权配置。',
            branchName: normalizedBranch || currentBranch,
            changedFiles,
          }
        }

        await git.add(['--all'])
        await git.commit(buildCommitMessageFromReply(params.commitMessage, undefined, params.gitIdentity))
        const commitSha = (await git.revparse(['HEAD'])).trim()

        if (!params.push) {
          return {
            ok: true,
            message: '已创建本地提交。',
            branchName: normalizedBranch || currentBranch,
            changedFiles,
            commitSha: commitSha || undefined,
          }
        }

        if (!normalizedBranch) {
          return {
            ok: false,
            message: '已创建本地提交，但当前 worktree 不在有效分支上，无法推送。',
            branchName: currentBranch,
            changedFiles,
            commitSha: commitSha || undefined,
          }
        }

        if (!params.gitIdentity.credentialToken) {
          return {
            ok: true,
            message: '缺少 task 级临时凭证，已创建本地提交但未推送远端。',
            branchName: normalizedBranch,
            changedFiles,
            commitSha: commitSha || undefined,
          }
        }

        try {
          await syncTaskBranchBeforePush(git, normalizedBranch)
          await git.push(['-u', 'origin', normalizedBranch])
          return {
            ok: true,
            message: `已推送远端分支 ${normalizedBranch}。`,
            branchName: normalizedBranch,
            changedFiles,
            commitSha: commitSha || undefined,
            remoteBranchName: normalizedBranch,
          }
        } catch (error) {
          const normalizedError = rewriteGitCredentialError(error, params.repoUrl)
          return {
            ok: false,
            message: `已创建本地提交，但推送远端分支失败：${normalizedError instanceof Error ? normalizedError.message : 'unknown error'}`,
            branchName: normalizedBranch,
            changedFiles,
            commitSha: commitSha || undefined,
          }
        }
      },
    })
  } catch (error) {
    const normalizedError = rewriteGitCredentialError(error, params.repoUrl)
    return {
      ok: false,
      message: normalizedError instanceof Error ? normalizedError.message : '执行自动提交失败。',
      branchName: fallbackBranchName || '',
      changedFiles: [],
    }
  }
}

export const pushLocalTaskBranch = async (params: {
  worktreePath: string
  repoUrl?: string
  branchName?: string
  gitIdentity?: TaskRuntimeGitIdentity
}): Promise<ExecutorGitPushResult> => {
  try {
    return await withTaskGitContext({
      ...params,
      taskKey: 'git-push',
      run: async (git) => {
        const currentBranch = params.branchName?.trim() || await readCurrentBranch(git)
        const normalizedBranch = normalizeBranchName(currentBranch)

        if (!normalizedBranch) {
          return {
            ok: false,
            message: '当前 worktree 不在有效分支上，无法推送。',
            branchName: currentBranch,
            remoteBranch: '',
          }
        }

        await git.push(['-u', 'origin', normalizedBranch])
        return {
          ok: true,
          message: `已推送分支 ${normalizedBranch} 到 origin。`,
          branchName: normalizedBranch,
          remoteBranch: `origin/${normalizedBranch}`,
        }
      },
    })
  } catch (error) {
    const normalizedError = rewriteGitCredentialError(error, params.repoUrl)
    return {
      ok: false,
      message: normalizedError instanceof Error ? normalizedError.message : '推送分支失败。',
      branchName: params.branchName?.trim() || '',
      remoteBranch: '',
    }
  }
}

export const checkoutLocalTaskBranch = async (params: {
  worktreePath: string
  repoUrl?: string
  branchName: string
  gitIdentity?: TaskRuntimeGitIdentity
}): Promise<ExecutorGitCheckoutResult> => {
  const targetBranch = normalizeBranchName(params.branchName)
  if (!targetBranch) {
    return {
      ok: false,
      message: '目标分支不能为空。',
      currentBranch: '',
    }
  }

  try {
    return await withTaskGitContext({
      ...params,
      taskKey: 'git-checkout',
      run: async (git) => {
        const currentBranch = await readCurrentBranch(git)
        if (currentBranch === targetBranch) {
          return {
            ok: true,
            message: `当前已经在分支 ${targetBranch}。`,
            currentBranch,
          }
        }

        const status = await git.status()
        if (!status.isClean()) {
          const changedFiles = status.files.map((item) => item.path).filter(Boolean)
          return {
            ok: false,
            message: changedFiles.length > 0
              ? `当前工作区有未提交改动，请先处理后再切换分支：${changedFiles.slice(0, 6).join(', ')}${changedFiles.length > 6 ? '…' : ''}`
              : '当前工作区有未提交改动，请先处理后再切换分支。',
            currentBranch,
          }
        }

        const allBranches = await git.branch(['-a'])
        const normalizedBranchSet = new Set(allBranches.all.map(normalizeBranchName).filter(Boolean))
        if (!normalizedBranchSet.has(targetBranch)) {
          try {
            await git.fetch(['origin', `${targetBranch}:refs/remotes/origin/${targetBranch}`])
          } catch {
            // fall back to local refs below
          }
        }

        const refreshedBranches = await git.branch(['-a'])
        const localBranches = await git.branchLocal()
        const localBranchSet = new Set(localBranches.all.map(normalizeBranchName).filter(Boolean))
        const remoteBranchExists = refreshedBranches.all
          .map(normalizeBranchName)
          .filter(Boolean)
          .includes(targetBranch)

        if (!remoteBranchExists && !localBranchSet.has(targetBranch)) {
          return {
            ok: false,
            message: `找不到分支 ${targetBranch}。`,
            currentBranch,
          }
        }

        if (localBranchSet.has(targetBranch)) {
          await git.checkout(targetBranch)
        } else {
          await git.checkout(['-B', targetBranch, `origin/${targetBranch}`])
        }

        const nextCurrentBranch = await readCurrentBranch(git)
        return {
          ok: true,
          message: `已切换到分支 ${nextCurrentBranch}。`,
          currentBranch: nextCurrentBranch,
        }
      },
    })
  } catch (error) {
    const normalizedError = rewriteGitCredentialError(error, params.repoUrl)
    return {
      ok: false,
      message: normalizedError instanceof Error ? normalizedError.message : '切换分支失败。',
      currentBranch: '',
    }
  }
}

export const createLocalTaskPullRequest = async (params: {
  worktreePath: string
  repoUrl: string
  title: string
  body: string
  baseBranch: string
  compareBranch?: string
  gitIdentity?: TaskRuntimeGitIdentity
}): Promise<ExecutorGitPullRequestResult> => {
  let compareBranch = params.compareBranch?.trim() || ''

  try {
    return await withTaskGitContext({
      worktreePath: params.worktreePath,
      repoUrl: params.repoUrl,
      gitIdentity: params.gitIdentity,
      taskKey: 'git-pull-request',
      run: async (git) => {
        const repo = parseGitHubRepoUrl(params.repoUrl)
        if (!repo) {
          return {
            ok: false,
            message: '当前仅支持为 GitHub 仓库创建 PR。',
            provider: null,
            title: params.title,
            body: params.body,
            baseBranch: params.baseBranch,
            compareBranch: params.compareBranch?.trim() || '',
          }
        }

        const currentBranch = compareBranch || await readCurrentBranch(git)
        const normalizedBranch = normalizeBranchName(currentBranch)
        compareBranch = normalizedBranch || currentBranch
        if (!normalizedBranch) {
          return {
            ok: false,
            message: '当前 worktree 不在有效分支上，无法创建 PR。',
            provider: 'github',
            title: params.title,
            body: params.body,
            baseBranch: params.baseBranch,
            compareBranch: currentBranch,
          }
        }

        await ensurePullRequestBranchPublished(git, normalizedBranch)

        const token = params.gitIdentity?.credentialToken?.trim() || ''
        if (
          !token
          || !['pat', 'github-app'].includes(params.gitIdentity?.authMode ?? '')
          || params.gitIdentity?.provider !== 'github'
        ) {
          return {
            ok: false,
            message: '创建 PR 目前需要已配置可用的 GitHub 访问身份（PAT 或 GitHub App installation）。',
            provider: 'github',
            title: params.title,
            body: params.body,
            baseBranch: params.baseBranch,
            compareBranch: normalizedBranch,
          }
        }

        const response = await fetch(`https://api.github.com/repos/${repo.owner}/${repo.repo}/pulls`, {
          method: 'POST',
          headers: {
            Accept: 'application/vnd.github+json',
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
            'User-Agent': 'wemux-Worker',
            'X-GitHub-Api-Version': '2022-11-28',
          },
          body: JSON.stringify({
            title: params.title,
            body: params.body,
            base: params.baseBranch,
            head: normalizedBranch,
          }),
        })

        const payload = await response.json().catch(() => ({})) as {
          message?: string
          html_url?: string
          number?: number
          state?: string
          errors?: Array<{ message?: string }>
        }

        if (!response.ok) {
          const errors = Array.isArray(payload.errors)
            ? payload.errors.map((item) => item.message).filter(Boolean).join('；')
            : ''

          return {
            ok: false,
            message: [payload.message, errors].filter(Boolean).join('；') || '创建 GitHub PR 失败。',
            provider: 'github',
            title: params.title,
            body: params.body,
            baseBranch: params.baseBranch,
            compareBranch: normalizedBranch,
          }
        }

        return {
          ok: true,
          message: 'PR 已创建。',
          provider: 'github',
          title: params.title,
          body: params.body,
          baseBranch: params.baseBranch,
          compareBranch: normalizedBranch,
          number: payload.number,
          url: payload.html_url,
          state: payload.state,
        }
      },
    })
  } catch (error) {
    const normalizedError = rewriteGitCredentialError(error, params.repoUrl)
    return {
      ok: false,
      message: normalizedError instanceof Error ? normalizedError.message : '创建 PR 失败。',
      provider: 'github',
      title: params.title,
      body: params.body,
      baseBranch: params.baseBranch,
      compareBranch,
    }
  }
}
