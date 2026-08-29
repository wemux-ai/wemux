import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildWorkspacePreparationRetryStep,
  buildWorkspacePreparationStartStep,
  buildWorkspacePreparationSuccessStep,
} from './workspace-preparation-status'

test('buildWorkspacePreparationStartStep describes remote worktree preparation', () => {
  assert.equal(
    buildWorkspacePreparationStartStep({
      workingDirectoryMode: 'worktree',
      repoUrl: 'https://github.com/example/todomap.git',
      preferredBranch: 'main',
    }),
    '正在准备项目仓库，必要时会 clone 并基于 main 创建 worktree',
  )
})

test('buildWorkspacePreparationStartStep describes original-dir reuse without remote clone', () => {
  assert.equal(
    buildWorkspacePreparationStartStep({
      workingDirectoryMode: 'original-dir',
      preferredBranch: 'dev',
    }),
    '正在检查并复用原始项目目录',
  )
})

test('buildWorkspacePreparationRetryStep describes worktree recovery', () => {
  assert.equal(
    buildWorkspacePreparationRetryStep({
      workingDirectoryMode: 'worktree',
      preferredBranch: 'release',
    }),
    '检测到工作目录缺失，正在重新准备仓库并创建 release 对应的 worktree',
  )
})

test('buildWorkspacePreparationSuccessStep surfaces worker result messages', () => {
  assert.equal(
    buildWorkspacePreparationSuccessStep({
      ok: true,
      message: '已基于 main 创建 worktree /tmp/worktree 并切出分支 vibemux/task-1。',
      worktreePath: '/tmp/worktree',
    }),
    '工作区目录已准备完成：已基于 main 创建 worktree /tmp/worktree 并切出分支 vibemux/task-1。',
  )
})
