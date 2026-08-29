// [INPUT]: Cross-runtime Git operation inputs and result payloads.
// [OUTPUT]: Pure shared contracts for worker Git status, diff, mutation, and delivery flows.
// [POS]: Shared Git protocol boundary consumed by web, server, and worker.
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

export interface TaskGitDiffFile {
  path: string
  status: string
  additions: number
  deletions: number
}

export interface TaskGitChangeSummary {
  fileCount: number
  additions: number
  deletions: number
  files: TaskGitDiffFile[]
  patch?: string
}

const normalizeDiffStat = (value: number) => (Number.isFinite(value) && value > 0 ? value : 0)

export const buildTaskGitChangeSummary = (files: TaskGitDiffFile[], patch?: string): TaskGitChangeSummary | undefined => {
  const normalizedFiles = files.flatMap((file) => {
    const path = file.path.trim()
    if (!path) {
      return []
    }

    return [{
      path,
      status: file.status.trim() || 'M',
      additions: normalizeDiffStat(file.additions),
      deletions: normalizeDiffStat(file.deletions),
    }]
  })

  if (normalizedFiles.length === 0) {
    return undefined
  }

  const normalizedPatch = patch?.trim()
  return normalizedFiles.reduce<TaskGitChangeSummary>((summary, file) => ({
    fileCount: summary.fileCount + 1,
    additions: summary.additions + file.additions,
    deletions: summary.deletions + file.deletions,
    files: [...summary.files, file],
    ...(summary.patch ? { patch: summary.patch } : {}),
  }), {
    fileCount: 0,
    additions: 0,
    deletions: 0,
    files: [],
    ...(normalizedPatch ? { patch: normalizedPatch } : {}),
  })
}

export interface ExecutorGitDiffResult {
  ok: boolean
  message: string
  baseBranch: string
  currentBranch: string
  aheadCommits: number
  files: TaskGitDiffFile[]
  patch: string
}

export interface ExecutorGitWorkingTreeDiffResult {
  ok: boolean
  message: string
  currentBranch: string
  files: TaskGitDiffFile[]
  patch: string
}

export type TaskGitChangeStage = 'staged' | 'unstaged'

export interface ExecutorGitChange {
  path: string
  status: string
  stage: TaskGitChangeStage
  additions: number
  deletions: number
  conflicted: boolean
}

export interface ExecutorGitStatusResult {
  ok: boolean
  message: string
  currentBranch: string
  changes: ExecutorGitChange[]
}

export interface ExecutorGitFileDiffResult {
  ok: boolean
  message: string
  path: string
  stage: TaskGitChangeStage
  patch: string
}

export type ExecutorGitChangeAction = 'stage' | 'unstage' | 'discard'

export interface ExecutorGitChangeActionResult {
  ok: boolean
  message: string
  changedPaths: string[]
}

export interface ExecutorGitBaselineSnapshotResult {
  ok: boolean
  message: string
  currentBranch: string
  treeSha?: string
}

export interface ExecutorGitBaselineDiffResult {
  ok: boolean
  message: string
  currentBranch: string
  treeSha?: string
  targetCommitSha?: string
  files: TaskGitDiffFile[]
  patch: string
}

export interface ExecutorGitCommitDiffResult {
  ok: boolean
  message: string
  commitSha: string
  parentSha?: string
  files: TaskGitDiffFile[]
  patch: string
}

export interface ExecutorGitRebaseResult {
  ok: boolean
  message: string
  baseBranch: string
  currentBranch: string
  conflicts: boolean
  conflictedFiles: string[]
}

export interface ExecutorGitGraphResult {
  ok: boolean
  message: string
  baseBranch: string
  currentBranch: string
  limit: number
  commitCount: number
  graph: string
  commits: ExecutorGitGraphCommit[]
}

export interface ExecutorGitCommitResult {
  ok: boolean
  message: string
  branchName: string
  changedFiles: string[]
  commitSha?: string
  remoteBranchName?: string
}

export interface ExecutorGitGraphCommit {
  sha: string
  shortSha: string
  parents: string[]
  subject: string
  authorDate: string
  authorName: string
  refs: string[]
  isHead: boolean
}

export interface ExecutorGitPushResult {
  ok: boolean
  message: string
  branchName: string
  remoteBranch: string
}

export interface ExecutorGitCheckoutResult {
  ok: boolean
  message: string
  currentBranch: string
}

export interface ExecutorGitPullRequestResult {
  ok: boolean
  message: string
  provider: 'github' | 'gitlab' | null
  title: string
  body: string
  baseBranch: string
  compareBranch: string
  number?: number
  url?: string
  state?: string
}

export type TaskGitPullRequestResult = ExecutorGitPullRequestResult
