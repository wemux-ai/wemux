import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import type { DistributedTask, TaskRuntimeGitIdentity } from '@shared/types'
import { commitAndMaybePush } from './git-workspace'

const runGit = (cwd: string, args: string[]) => {
  execFileSync('git', args, {
    cwd,
    stdio: 'pipe',
  })
}

const readGit = (cwd: string, args: string[]) => execFileSync('git', args, {
  cwd,
  encoding: 'utf8',
  stdio: 'pipe',
}).trim()

const createBaseDistributedTask = (repoUrl: string): DistributedTask => ({
  id: 'distributed-task-1',
  originTaskId: 'task-1',
  projectId: 'project-1',
  requestedByUserId: 'user-1',
  agentType: 'Codex',
  repoUrl,
  defaultBranch: 'main',
  baseCommit: 'main',
  description: '验证自动提交推送链路',
  status: 'assigned',
  priority: 'medium',
  timeoutSec: 1800,
  originNodeId: 'node-1',
  executorNodeId: 'executor-1',
  returnMode: 'commit',
  syncBackStrategy: 'none',
  gitIdentityMode: 'personal',
  autoCommitEnabled: true,
  idempotencyKey: 'idempotency-1',
  retryCount: 0,
  createdAt: '2026-05-12T00:00:00.000Z',
  updatedAt: '2026-05-12T00:00:00.000Z',
})

const createIdentity = (): TaskRuntimeGitIdentity => ({
  mode: 'personal',
  authMode: 'pat',
  provider: 'generic',
  host: 'local',
  name: 'Example Developer',
  email: 'developer@example.com',
  agentCoAuthorName: 'Vibemux',
  agentCoAuthorEmail: '289628643+vibemux[bot]@users.noreply.github.com',
  credentialToken: 'token',
})

const PRODUCTION_AGENT_CO_AUTHOR_TRAILER = 'Co-authored-by: Vibemux <289628643+vibemux[bot]@users.noreply.github.com>'
const USER_CO_AUTHOR_TRAILER = 'Co-authored-by: Example Developer <developer@example.com>'
const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

test('commitAndMaybePush pushes a brand-new task branch on first sync', async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'vibemux-worker-git-workspace-'))
  const remoteDir = path.join(root, 'remote.git')
  const seedDir = path.join(root, 'seed')
  const worktreeDir = path.join(root, 'worktree')
  const branchName = 'vibemux/task-branch'

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
    runGit(worktreeDir, ['config', 'user.name', 'Node User'])
    runGit(worktreeDir, ['config', 'user.email', 'node@example.com'])
    writeFileSync(path.join(worktreeDir, 'README.md'), 'seed\nworker change\n', 'utf8')

    const outcome = await commitAndMaybePush({
      task: createBaseDistributedTask(remoteDir),
      worktreePath: worktreeDir,
      branchName,
      identity: createIdentity(),
    })

    assert.equal(outcome.remoteBranchName, branchName)
    assert.match(outcome.pushMessage ?? '', /已推送远端分支/)
    assert.equal(outcome.commitShas?.length, 1)
    runGit(remoteDir, ['show-ref', '--verify', `refs/heads/${branchName}`])
    assert.equal(readGit(worktreeDir, ['log', '-1', '--pretty=%an <%ae>|%cn <%ce>']), 'Vibemux <289628643+vibemux[bot]@users.noreply.github.com>|Vibemux <289628643+vibemux[bot]@users.noreply.github.com>')
    const commitMessage = readGit(worktreeDir, ['log', '-1', '--pretty=%B'])
    assert.match(commitMessage, new RegExp(escapeRegex(PRODUCTION_AGENT_CO_AUTHOR_TRAILER)))
    assert.match(commitMessage, new RegExp(escapeRegex(USER_CO_AUTHOR_TRAILER)))
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('commitAndMaybePush fetches an existing remote task branch before pushing', async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'vibemux-worker-git-existing-remote-'))
  const remoteDir = path.join(root, 'remote.git')
  const seedDir = path.join(root, 'seed')
  const updaterDir = path.join(root, 'updater')
  const worktreeDir = path.join(root, 'worktree')
  const branchName = 'vibemux/existing-task-branch'

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

    runGit(root, ['clone', remoteDir, updaterDir])
    runGit(updaterDir, ['config', 'user.name', 'Remote User'])
    runGit(updaterDir, ['config', 'user.email', 'remote@example.com'])
    runGit(updaterDir, ['checkout', '-b', branchName])
    writeFileSync(path.join(updaterDir, 'remote.txt'), 'remote branch already exists\n', 'utf8')
    runGit(updaterDir, ['add', 'remote.txt'])
    runGit(updaterDir, ['commit', '-m', 'remote branch commit'])
    runGit(updaterDir, ['push', '-u', 'origin', branchName])

    runGit(root, ['clone', '--single-branch', '--branch', 'main', remoteDir, worktreeDir])
    runGit(worktreeDir, ['checkout', '-b', branchName])
    runGit(worktreeDir, ['config', 'user.name', 'Node User'])
    runGit(worktreeDir, ['config', 'user.email', 'node@example.com'])
    writeFileSync(path.join(worktreeDir, 'local.txt'), 'local workspace change\n', 'utf8')

    const outcome = await commitAndMaybePush({
      task: createBaseDistributedTask(remoteDir),
      worktreePath: worktreeDir,
      branchName,
      identity: createIdentity(),
    })

    assert.equal(outcome.remoteBranchName, branchName)
    assert.match(outcome.pushMessage ?? '', /已推送远端分支/)
    const remoteTree = readGit(remoteDir, ['ls-tree', '--name-only', `refs/heads/${branchName}`])
    assert.match(remoteTree, /local\.txt/)
    assert.match(remoteTree, /remote\.txt/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('commitAndMaybePush honors disabled publish policy even with credentials', async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'vibemux-worker-git-publish-off-'))
  const remoteDir = path.join(root, 'remote.git')
  const seedDir = path.join(root, 'seed')
  const worktreeDir = path.join(root, 'worktree')
  const branchName = 'vibemux/publish-off'

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
    runGit(worktreeDir, ['config', 'user.name', 'Node User'])
    runGit(worktreeDir, ['config', 'user.email', 'node@example.com'])
    writeFileSync(path.join(worktreeDir, 'README.md'), 'seed\nlocal only change\n', 'utf8')

    const outcome = await commitAndMaybePush({
      task: {
        ...createBaseDistributedTask(remoteDir),
        publishPolicy: 'none',
      },
      worktreePath: worktreeDir,
      branchName,
      identity: createIdentity(),
    })

    assert.equal(outcome.remoteBranchName, undefined)
    assert.match(outcome.pushMessage ?? '', /未启用发布权限/)
    assert.equal(outcome.commitShas?.length, 1)
    assert.throws(() => runGit(remoteDir, ['show-ref', '--verify', `refs/heads/${branchName}`]))
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('commitAndMaybePush commits git-local tasks without pushing even when credentials exist', async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'vibemux-worker-git-local-'))
  const worktreeDir = path.join(root, 'worktree')
  const branchName = 'vibemux/local-task'

  try {
    mkdirSync(worktreeDir, { recursive: true })
    runGit(worktreeDir, ['init', '--initial-branch=main'])
    runGit(worktreeDir, ['config', 'user.name', 'Seed User'])
    runGit(worktreeDir, ['config', 'user.email', 'seed@example.com'])
    writeFileSync(path.join(worktreeDir, 'README.md'), 'seed\n', 'utf8')
    runGit(worktreeDir, ['add', 'README.md'])
    runGit(worktreeDir, ['commit', '-m', 'seed'])
    runGit(worktreeDir, ['checkout', '-b', branchName])
    runGit(worktreeDir, ['config', 'user.name', 'Node User'])
    runGit(worktreeDir, ['config', 'user.email', 'node@example.com'])
    writeFileSync(path.join(worktreeDir, 'README.md'), 'seed\nlocal change\n', 'utf8')

    const outcome = await commitAndMaybePush({
      task: {
        ...createBaseDistributedTask(''),
        versionControl: 'git-local',
        rootPath: worktreeDir,
      },
      worktreePath: worktreeDir,
      branchName,
      identity: createIdentity(),
    })

    assert.equal(outcome.remoteBranchName, undefined)
    assert.match(outcome.pushMessage ?? '', /本地 Git 项目已创建本地提交/)
    assert.equal(outcome.commitShas?.length, 1)
    assert.equal(readGit(worktreeDir, ['log', '-1', '--pretty=%an <%ae>|%cn <%ce>']), 'Vibemux <289628643+vibemux[bot]@users.noreply.github.com>|Vibemux <289628643+vibemux[bot]@users.noreply.github.com>')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
