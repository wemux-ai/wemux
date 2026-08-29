// [INPUT]: 分布式任务结果输入
// [OUTPUT]: 结果类型
// [POS]: 分布式任务结果契约
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import { getTaskGitBranchName } from './task-git-branch'
import type { TaskExecutionResult, TaskResultDelivery } from './types'

const getFirstSummaryLine = (summary: string) => {
  const firstLine = summary
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean)

  if (!firstLine) {
    return 'Worker completed the task.'
  }

  return firstLine.length > 160 ? `${firstLine.slice(0, 157)}...` : firstLine
}

const buildPullRequestDescription = (params: {
  summary: string
  taskTitle?: string
  taskDescription?: string
  filesChanged: string[]
  baseBranch: string
  compareBranch: string
  commitShas?: string[]
}) => {
  const summaryLine = getFirstSummaryLine(params.summary)
  const taskLine = (params.taskTitle?.trim() || params.taskDescription?.trim() || 'Worker delivery update').replace(/\s+/g, ' ')
  const changedFiles = params.filesChanged.length > 0 ? params.filesChanged.join(', ') : 'none'

  return [
    '## Summary',
    `- ${taskLine}`,
    `- ${summaryLine}`,
    `- Changed files: ${changedFiles}`,
    '',
    '## Delivery',
    `- Base branch: ${params.baseBranch}`,
    `- Compare branch: ${params.compareBranch}`,
    params.commitShas?.[0] ? `- Commit: ${params.commitShas[0]}` : null,
  ].filter(Boolean).join('\n')
}

const buildPullRequestTitle = (taskTitle?: string, taskDescription?: string) => {
  const raw = (taskTitle?.trim() || taskDescription?.trim() || 'Worker delivery update').replace(/\s+/g, ' ')
  return raw.length > 72 ? `${raw.slice(0, 69)}...` : raw
}

export const buildTaskResultDelivery = (params: {
  taskId: string
  returnMode: TaskExecutionResult['returnMode']
  repoUrl: string
  baseBranch: string
  summary: string
  taskTitle?: string
  taskDescription?: string
  filesChanged: string[]
  remoteBranchName?: string
  commitShas?: string[]
}): TaskResultDelivery => {
  const delivery: TaskResultDelivery = {
    mode: params.returnMode,
  }

  if (params.returnMode === 'branch' || params.returnMode === 'commit') {
    const branchName = params.remoteBranchName || getTaskGitBranchName(params.taskId)
    const hasCommit = params.filesChanged.length > 0 && Boolean(params.commitShas?.length)
    const pushed = Boolean(params.remoteBranchName)
    delivery.branch = {
      branchName,
      repoUrl: params.repoUrl,
      baseBranch: params.baseBranch,
      pushed,
      suggestedNextStep: hasCommit
        ? pushed
          ? params.returnMode === 'commit'
            ? '确认 PR 准备信息后即可发起 PR。'
            : '到目标仓库查看该分支，并决定是否继续发起 PR。'
          : '当前只有本地 commit，补齐凭证后推送该分支。'
        : '本次执行没有生成可交付分支。',
      reason: hasCommit
        ? pushed
          ? undefined
          : '分支名已准备，但当前结果里还没有远端推送记录。'
        : params.filesChanged.length === 0
          ? '本次执行没有代码改动，未生成分支交付。'
          : '未记录 commit 结果，暂时无法确认分支交付。',
    }

    if (delivery.branch.reason && !hasCommit) {
      delivery.syncFailureReason = delivery.branch.reason
    }
  }

  if (params.returnMode === 'commit') {
    const compareBranch = params.remoteBranchName || getTaskGitBranchName(params.taskId)
    const ready = params.filesChanged.length > 0 && Boolean(params.commitShas?.length)
    delivery.pullRequest = {
      ready,
      remoteReady: Boolean(params.remoteBranchName),
      repoUrl: params.repoUrl,
      title: ready ? buildPullRequestTitle(params.taskTitle, params.taskDescription) : undefined,
      description: ready
        ? buildPullRequestDescription({
            summary: params.summary,
            taskTitle: params.taskTitle,
            taskDescription: params.taskDescription,
            filesChanged: params.filesChanged,
            baseBranch: params.baseBranch,
            compareBranch,
            commitShas: params.commitShas,
          })
        : undefined,
      baseBranch: params.baseBranch,
      compareBranch,
      reason: ready
        ? params.remoteBranchName
          ? undefined
          : 'PR 文案已准备，但 compare branch 还没有推送到远端。'
        : params.filesChanged.length === 0
          ? '本次执行没有代码改动，未生成 PR 准备信息。'
          : '当前结果里没有 commit 信息，暂时无法准备 PR。',
    }

    if (!delivery.pullRequest.ready) {
      delivery.syncFailureReason = delivery.pullRequest.reason
    }
  }

  return delivery
}

export const attachTaskResultDelivery = (result: TaskExecutionResult, params: {
  repoUrl: string
  baseBranch: string
  taskTitle?: string
  taskDescription?: string
}): TaskExecutionResult => ({
  ...result,
  delivery: buildTaskResultDelivery({
    taskId: result.taskId,
    returnMode: result.returnMode,
    repoUrl: params.repoUrl,
    baseBranch: params.baseBranch,
    summary: result.summary,
    taskTitle: params.taskTitle,
    taskDescription: params.taskDescription,
    filesChanged: result.filesChanged,
    remoteBranchName: result.remoteBranchName,
    commitShas: result.commitShas,
  }),
})
