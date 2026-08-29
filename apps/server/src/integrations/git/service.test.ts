import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import type { WorkspaceTaskExecutionView } from '@shared/task-workspace'
import type { Project, TaskRuntimeGitIdentity } from '@shared/types'
import { finalizeTaskWorktreeGit } from './service'

const runGit = (cwd: string, args: string[]) => {
  execFileSync('git', args, {
    cwd,
    stdio: 'pipe',
  })
}

const createProject = (repoUrl: string): Project => ({
  id: 'project-1',
  name: 'Git Finalize Test',
  gitUrl: repoUrl,
  defaultBranch: 'main',
  createdAt: '2026-05-12T00:00:00.000Z',
  updatedAt: '2026-05-12T00:00:00.000Z',
})

const createTask = (branchName: string): WorkspaceTaskExecutionView => ({
  id: 'task-1',
  projectId: 'project-1',
  title: '验证 workspace 自动提交推送',
  description: '',
  status: 'todo',
  priority: 'medium',
  retryCount: 0,
  agentType: 'OpenCode',
  executionModel: 'openai/gpt-5',
  opencodeConfig: undefined,
  executionMode: 'auto',
  gitIdentityMode: 'personal',
  agentManaged: 'ai',
  baseBranch: 'main',
  acceptanceCriteria: '',
  comments: [],
  logs: [],
  toolCalls: [],
  executionHistory: [],
  history: [],
  orchestration: [],
  validationChecks: [],
  currentStep: '',
  needsHumanConfirm: false,
  agentRunningStatus: 'idle',
  createdAt: '2026-05-12T00:00:00.000Z',
  updatedAt: '2026-05-12T00:00:00.000Z',
  workspaceId: 'workspace-1',
  executorNodeId: 'executor-1',
  distributedTaskId: undefined,
  agentSessionId: undefined,
  opencodeSessionId: undefined,
  worktreeId: 'worktree-1',
  branchName,
  worktreeStatus: 'created',
  workingDirectoryMode: 'worktree',
  agentSettings: undefined,
  enabledMcpServerIds: [],
 })

const createIdentity = (): TaskRuntimeGitIdentity => ({
  mode: 'personal',
  authMode: 'pat',
  provider: 'generic',
  host: 'local',
  name: 'Vibemux Bot',
  email: 'bot@example.com',
  credentialToken: 'token',
})

test('finalizeTaskWorktreeGit pushes a new workspace branch after auto-commit', async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'vibemux-server-git-finalize-'))
  const remoteDir = path.join(root, 'remote.git')
  const seedDir = path.join(root, 'seed')
  const worktreeDir = path.join(root, 'worktree')
  const branchName = 'vibemux/workspace-task'

  try {
    mkdirSync(seedDir, { recursive: true })

    runGit(root, ['init', '--bare', '--initial-branch=main', remoteDir])
    runGit(seedDir, ['init', '--initial-branch=main'])
    runGit(seedDir, ['config', 'user.name', 'Seed User'])
    runGit(seedDir, ['config', 'user.email', 'seed@example.com'])
    writeFileSync(path.join(seedDir, 'README.md'), 'seed\n', 'utf8')
    runGit(seedDir, ['add', 'README.md'])
    runGit(seedDir, ['commit', '-m', 'seed'])
    runGit(seedDir, ['remote', 'add', 'origin', remoteDir])
    runGit(seedDir, ['push', '-u', 'origin', 'main'])

    runGit(root, ['clone', remoteDir, worktreeDir])
    runGit(worktreeDir, ['checkout', '-b', branchName])
    writeFileSync(path.join(worktreeDir, 'README.md'), 'seed\nworkspace change\n', 'utf8')

    const outcome = await finalizeTaskWorktreeGit({
      project: createProject(remoteDir),
      task: createTask(branchName),
      worktreePath: worktreeDir,
      identity: createIdentity(),
      commitMessage: 'workspace auto commit',
    })

    assert.equal(outcome.remoteBranchName, branchName)
    assert.match(outcome.pushMessage ?? '', /已推送远端分支/)
    assert.equal(outcome.commitShas?.length, 1)
    runGit(remoteDir, ['show-ref', '--verify', `refs/heads/${branchName}`])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
