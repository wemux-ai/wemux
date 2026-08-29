import type { WorkingDirectoryMode } from '@shared/types'
import type { ExecutorWorktreeResult } from '@shared/types'

const normalizeBranchLabel = (value?: string) => value?.trim() || '默认分支'

export const buildWorkspacePreparationStartStep = (params: {
  workingDirectoryMode: WorkingDirectoryMode
  repoUrl?: string
  preferredBranch?: string
}) => {
  const branchLabel = normalizeBranchLabel(params.preferredBranch)

  if (params.workingDirectoryMode === 'original-dir') {
    if (params.repoUrl?.trim()) {
      return `正在准备项目目录，必要时会 clone 仓库并切换到 ${branchLabel}`
    }

    return '正在检查并复用原始项目目录'
  }

  if (params.repoUrl?.trim()) {
    return `正在准备项目仓库，必要时会 clone 并基于 ${branchLabel} 创建 worktree`
  }

  return `正在基于 ${branchLabel} 创建工作区 worktree`
}

export const buildWorkspacePreparationRetryStep = (params: {
  workingDirectoryMode: WorkingDirectoryMode
  preferredBranch?: string
}) => {
  const branchLabel = normalizeBranchLabel(params.preferredBranch)

  if (params.workingDirectoryMode === 'original-dir') {
    return `检测到工作目录缺失，正在重新准备项目目录并切换到 ${branchLabel}`
  }

  return `检测到工作目录缺失，正在重新准备仓库并创建 ${branchLabel} 对应的 worktree`
}

export const buildWorkspacePreparationSuccessStep = (result: ExecutorWorktreeResult) => {
  const normalizedMessage = result.message.trim()
  if (!normalizedMessage) {
    return '工作区目录已准备完成，正在连接执行节点'
  }

  return `工作区目录已准备完成：${normalizedMessage}`
}
