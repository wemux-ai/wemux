import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { simpleGit } from 'simple-git'
import { applyLocalTaskGitChange, commitLocalTaskStagedChanges, commitLocalTaskChanges, createLocalTaskPullRequest, getLocalTaskCommitDiff, getLocalTaskGitBaselineDiff, getLocalTaskGitBaselineSnapshot, getLocalTaskGitDiff, getLocalTaskGitFileDiff, getLocalTaskGitStatus, getLocalTaskGitWorkingTreeDiff } from './git-ops'

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

const GITHUB_REPO_URL = 'https://github.com/example/vibemux-test.git'
const PRODUCTION_AGENT_CO_AUTHOR_TRAILER = 'Co-authored-by: Vibemux <289628643+vibemux[bot]@users.noreply.github.com>'
const USER_CO_AUTHOR_TRAILER = 'Co-authored-by: Example Developer <developer@example.com>'
const productionAgentCoAuthorTrailerPattern = new RegExp(PRODUCTION_AGENT_CO_AUTHOR_TRAILER.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
const userCoAuthorTrailerPattern = new RegExp(USER_CO_AUTHOR_TRAILER.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
const GITHUB_IDENTITY = {
  mode: 'personal' as const,
  authMode: 'pat' as const,
  provider: 'github' as const,
  host: 'github.com',
  name: 'Example Developer',
  email: 'developer@example.com',
  agentCoAuthorName: 'Vibemux',
  agentCoAuthorEmail: '289628643+vibemux[bot]@users.noreply.github.com',
  credentialToken: 'token',
}

const createTempRepo = async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'vibemux-git-diff-'))
  const repoDir = path.join(root, 'repo')
  mkdirSync(repoDir, { recursive: true })

  const git = simpleGit(repoDir)
  await git.init(['--initial-branch=dev'])
  await git.addConfig('user.name', 'Test User')
  await git.addConfig('user.email', 'test@example.com')

  writeFileSync(path.join(repoDir, 'README.md'), 'base\n', 'utf8')
  await git.add('.')
  await git.commit('init')

  return { root, repoDir }
}

const createPullRequestRepoFixture = (branchName: string) => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'vibemux-git-pr-'))
  const remoteDir = path.join(root, 'remote.git')
  const seedDir = path.join(root, 'seed')
  const worktreeDir = path.join(root, 'worktree')

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
  runGit(worktreeDir, ['config', 'user.name', 'Test User'])
  runGit(worktreeDir, ['config', 'user.email', 'test@example.com'])
  runGit(worktreeDir, ['checkout', '-b', branchName])

  const cloneForUpdate = (name: string) => {
    const cloneDir = path.join(root, name)
    runGit(root, ['clone', remoteDir, cloneDir])
    runGit(cloneDir, ['config', 'user.name', 'Update User'])
    runGit(cloneDir, ['config', 'user.email', 'update@example.com'])
    return cloneDir
  }

  return { root, remoteDir, worktreeDir, branchName, cloneForUpdate }
}

const withMockFetch = async (handler: () => Response, run: (getCallCount: () => number) => Promise<void>) => {
  const originalFetch = globalThis.fetch
  let callCount = 0
  globalThis.fetch = (async () => {
    callCount += 1
    return handler()
  }) as typeof fetch

  try {
    await run(() => callCount)
  } finally {
    globalThis.fetch = originalFetch
  }
}

test('getLocalTaskGitDiff includes tracked working tree changes relative to the base branch', async () => {
  const { root, repoDir } = await createTempRepo()

  try {
    writeFileSync(path.join(repoDir, 'README.md'), 'base\nlocal change\n', 'utf8')

    const result = await getLocalTaskGitDiff({
      worktreePath: repoDir,
      baseBranch: 'dev',
    })

    assert.equal(result.ok, true)
    assert.equal(result.aheadCommits, 0)
    assert.equal(result.currentBranch, 'dev')
    assert.equal(result.files.length, 1)
    assert.equal(result.files[0]?.path, 'README.md')
    assert.match(result.patch, /\+local change/)
    assert.match(result.message, /当前工作区相对 dev 的差异/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('getLocalTaskGitDiff includes untracked files in the rendered patch', async () => {
  const { root, repoDir } = await createTempRepo()

  try {
    writeFileSync(path.join(repoDir, 'notes.txt'), 'draft\n', 'utf8')

    const result = await getLocalTaskGitDiff({
      worktreePath: repoDir,
      baseBranch: 'dev',
    })

    assert.equal(result.ok, true)
    assert.equal(result.aheadCommits, 0)
    assert.equal(result.files.length, 1)
    assert.equal(result.files[0]?.path, 'notes.txt')
    assert.equal(result.files[0]?.status, '??')
    assert.match(result.patch, /diff --git a\/notes.txt b\/notes.txt/)
    assert.match(result.patch, /\+\+\+ b\/notes.txt/)
    assert.match(result.patch, /\+draft/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('getLocalTaskGitBaselineDiff only includes changes made after the baseline snapshot', async () => {
  const { root, repoDir } = await createTempRepo()

  try {
    writeFileSync(path.join(repoDir, 'stale.txt'), 'before baseline\n', 'utf8')

    const baseline = await getLocalTaskGitBaselineSnapshot({
      worktreePath: repoDir,
    })

    assert.equal(baseline.ok, true)
    assert.ok(baseline.treeSha)

    writeFileSync(path.join(repoDir, 'fresh.txt'), 'after baseline\n', 'utf8')
    writeFileSync(path.join(repoDir, 'README.md'), 'base\nturn update\n', 'utf8')

    const result = await getLocalTaskGitBaselineDiff({
      worktreePath: repoDir,
      baselineTreeSha: baseline.treeSha!,
    })

    assert.equal(result.ok, true)
    assert.deepEqual(result.files.map((file) => file.path).sort(), ['README.md', 'fresh.txt'])
    assert.match(result.patch, /fresh\.txt/)
    assert.match(result.patch, /turn update/)
    assert.doesNotMatch(result.patch, /stale\.txt/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('baseline-to-commit diff includes pre-baseline files when the resulting commit contains them', async () => {
  const { root, repoDir } = await createTempRepo()

  try {
    writeFileSync(path.join(repoDir, 'stale.txt'), 'before baseline\n', 'utf8')

    const baseline = await getLocalTaskGitBaselineSnapshot({
      worktreePath: repoDir,
    })

    assert.equal(baseline.ok, true)
    assert.ok(baseline.treeSha)

    writeFileSync(path.join(repoDir, 'fresh.txt'), 'after baseline\n', 'utf8')
    writeFileSync(path.join(repoDir, 'README.md'), 'base\nturn update\n', 'utf8')
    runGit(repoDir, ['add', 'README.md', 'fresh.txt', 'stale.txt'])
    runGit(repoDir, ['commit', '-m', 'turn commit'])
    const commitSha = readGit(repoDir, ['rev-parse', 'HEAD'])

    const result = await getLocalTaskGitBaselineDiff({
      worktreePath: repoDir,
      baselineTreeSha: baseline.treeSha!,
      targetCommitSha: commitSha,
    })

    assert.equal(result.ok, true)
    assert.equal(result.targetCommitSha, commitSha)
    assert.deepEqual(result.files.map((file) => file.path).sort(), ['README.md', 'fresh.txt'])
    assert.match(result.patch, /fresh\.txt/)
    assert.match(result.patch, /turn update/)
    assert.doesNotMatch(result.patch, /stale\.txt/)

    const commitDiff = await getLocalTaskCommitDiff({
      worktreePath: repoDir,
      commitSha,
    })
    assert.equal(commitDiff.ok, true)
    assert.match(commitDiff.patch, /stale\.txt/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('getLocalTaskGitWorkingTreeDiff includes the current working tree patch', async () => {
  const { root, repoDir } = await createTempRepo()

  try {
    writeFileSync(path.join(repoDir, 'README.md'), 'base\nlocal change\n', 'utf8')
    writeFileSync(path.join(repoDir, 'notes.txt'), 'draft\n', 'utf8')

    const result = await getLocalTaskGitWorkingTreeDiff({
      worktreePath: repoDir,
    })

    assert.equal(result.ok, true)
    assert.equal(result.currentBranch, 'dev')
    assert.equal(result.files.length, 2)
    assert.match(result.patch, /diff --git a\/README.md b\/README.md/)
    assert.match(result.patch, /\+local change/)
    assert.match(result.patch, /diff --git a\/notes.txt b\/notes.txt/)
    assert.match(result.patch, /\+draft/)
    assert.match(result.message, /当前工作区未提交改动/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('source control status separates staged and unstaged changes and loads a file diff', async () => {
  const { root, repoDir } = await createTempRepo()

  try {
    writeFileSync(path.join(repoDir, 'README.md'), 'base\nstaged change\n', 'utf8')
    writeFileSync(path.join(repoDir, 'draft.txt'), 'unstaged change\n', 'utf8')
    mkdirSync(path.join(repoDir, 'untracked'), { recursive: true })
    writeFileSync(path.join(repoDir, 'untracked', 'nested.txt'), 'nested change\n', 'utf8')

    const staged = await applyLocalTaskGitChange({
      worktreePath: repoDir,
      action: 'stage',
      paths: ['README.md'],
    })
    assert.equal(staged.ok, true)

    const status = await getLocalTaskGitStatus({ worktreePath: repoDir })
    assert.equal(status.ok, true)
    assert.ok(status.changes.some((change) => change.path === 'README.md' && change.stage === 'staged'))
    assert.ok(status.changes.some((change) => change.path === 'draft.txt' && change.stage === 'unstaged' && change.status === '??'))
    assert.ok(status.changes.some((change) => change.path === 'untracked/nested.txt' && change.stage === 'unstaged'))

    const fileDiff = await getLocalTaskGitFileDiff({
      worktreePath: repoDir,
      path: 'README.md',
      stage: 'staged',
    })
    assert.equal(fileDiff.ok, true)
    assert.match(fileDiff.patch, /\+staged change/)

    const unstaged = await applyLocalTaskGitChange({
      worktreePath: repoDir,
      action: 'unstage',
      paths: ['README.md'],
    })
    assert.equal(unstaged.ok, true)
    const nextStatus = await getLocalTaskGitStatus({ worktreePath: repoDir })
    assert.ok(nextStatus.changes.some((change) => change.path === 'README.md' && change.stage === 'unstaged'))
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('commitLocalTaskStagedChanges only commits staged files', async () => {
  const { root, repoDir } = await createTempRepo()

  try {
    writeFileSync(path.join(repoDir, 'README.md'), 'base\ncommit this\n', 'utf8')
    writeFileSync(path.join(repoDir, 'keep-draft.txt'), 'do not commit\n', 'utf8')
    await applyLocalTaskGitChange({ worktreePath: repoDir, action: 'stage', paths: ['README.md'] })

    const result = await commitLocalTaskStagedChanges({
      worktreePath: repoDir,
      commitMessage: 'Commit selected source control change',
      gitIdentity: GITHUB_IDENTITY,
    })
    assert.equal(result.ok, true)
    assert.deepEqual(result.changedFiles, ['README.md'])
    assert.match(readGit(repoDir, ['show', '--name-only', '--format=', 'HEAD']), /README\.md/)
    assert.doesNotMatch(readGit(repoDir, ['show', '--name-only', '--format=', 'HEAD']), /keep-draft\.txt/)
    assert.equal(readGit(repoDir, ['status', '--short']), '?? keep-draft.txt')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('commitLocalTaskChanges commits and pushes using the AI reply headline', async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'vibemux-git-commit-'))
  const remoteDir = path.join(root, 'remote.git')
  const seedDir = path.join(root, 'seed')
  const worktreeDir = path.join(root, 'worktree')
  const branchName = 'feature/auto-commit'

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
    writeFileSync(path.join(worktreeDir, 'README.md'), 'seed\nlocal change\n', 'utf8')

    const outcome = await commitLocalTaskChanges({
      worktreePath: worktreeDir,
      repoUrl: remoteDir,
      branchName,
      commitMessage: '# Fix workspace auto commit\n\nThis is the body.',
      push: true,
      gitIdentity: {
        mode: 'personal',
        authMode: 'pat',
        provider: 'generic',
        host: 'local',
        name: 'Example Developer',
        email: 'developer@example.com',
        agentCoAuthorName: 'Vibemux',
        agentCoAuthorEmail: '289628643+vibemux[bot]@users.noreply.github.com',
        credentialToken: 'token',
      },
    })

    assert.equal(outcome.ok, true)
    assert.equal(outcome.remoteBranchName, branchName)
    assert.equal(outcome.commitSha?.length, 40)
    assert.match(outcome.message, /已推送远端分支/)
    assert.match(execFileSync('git', ['log', '-1', '--pretty=%s', `refs/heads/${branchName}`], { cwd: remoteDir, encoding: 'utf8' }), /Fix workspace auto commit/)
    assert.equal(execFileSync('git', ['log', '-1', '--pretty=%an <%ae>|%cn <%ce>', `refs/heads/${branchName}`], { cwd: remoteDir, encoding: 'utf8' }).trim(), 'Vibemux <289628643+vibemux[bot]@users.noreply.github.com>|Vibemux <289628643+vibemux[bot]@users.noreply.github.com>')
    const commitBody = execFileSync('git', ['log', '-1', '--pretty=%B', `refs/heads/${branchName}`], { cwd: remoteDir, encoding: 'utf8' })
    assert.match(commitBody, productionAgentCoAuthorTrailerPattern)
    assert.match(commitBody, userCoAuthorTrailerPattern)
    runGit(remoteDir, ['show-ref', '--verify', `refs/heads/${branchName}`])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('commitLocalTaskChanges fetches an existing remote task branch before pushing', async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'vibemux-git-commit-existing-remote-'))
  const remoteDir = path.join(root, 'remote.git')
  const seedDir = path.join(root, 'seed')
  const updaterDir = path.join(root, 'updater')
  const worktreeDir = path.join(root, 'worktree')
  const branchName = 'feature/existing-remote-task'

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

    const outcome = await commitLocalTaskChanges({
      worktreePath: worktreeDir,
      repoUrl: remoteDir,
      branchName,
      commitMessage: 'Add local workspace change',
      push: true,
      gitIdentity: GITHUB_IDENTITY,
    })

    assert.equal(outcome.ok, true)
    assert.equal(outcome.remoteBranchName, branchName)
    const remoteTree = readGit(remoteDir, ['ls-tree', '--name-only', `refs/heads/${branchName}`])
    assert.match(remoteTree, /local\.txt/)
    assert.match(remoteTree, /remote\.txt/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('createLocalTaskPullRequest creates a PR when the remote branch already matches the local branch', async () => {
  const { root, worktreeDir, branchName } = createPullRequestRepoFixture('feature/pr-same')

  try {
    writeFileSync(path.join(worktreeDir, 'README.md'), 'seed\nsame branch\n', 'utf8')
    runGit(worktreeDir, ['add', 'README.md'])
    runGit(worktreeDir, ['commit', '-m', 'same branch commit'])
    runGit(worktreeDir, ['push', '-u', 'origin', branchName])

    await withMockFetch(
      () => new Response(JSON.stringify({
        html_url: 'https://github.com/example/vibemux-test/pull/42',
        number: 42,
        state: 'open',
      }), {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
      }),
      async (getCallCount) => {
        const result = await createLocalTaskPullRequest({
          worktreePath: worktreeDir,
          repoUrl: GITHUB_REPO_URL,
          title: 'Test PR',
          body: 'Body',
          baseBranch: 'main',
          gitIdentity: GITHUB_IDENTITY,
        })

        assert.equal(result.ok, true)
        assert.equal(result.compareBranch, branchName)
        assert.equal(result.url, 'https://github.com/example/vibemux-test/pull/42')
        assert.equal(getCallCount(), 1)
      },
    )
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('createLocalTaskPullRequest blocks when the remote branch is ahead of the local workspace branch', async () => {
  const { root, worktreeDir, branchName, cloneForUpdate } = createPullRequestRepoFixture('feature/pr-remote-ahead')

  try {
    writeFileSync(path.join(worktreeDir, 'README.md'), 'seed\nlocal base\n', 'utf8')
    runGit(worktreeDir, ['add', 'README.md'])
    runGit(worktreeDir, ['commit', '-m', 'local base commit'])
    runGit(worktreeDir, ['push', '-u', 'origin', branchName])

    const updaterDir = cloneForUpdate('updater')
    runGit(updaterDir, ['checkout', branchName])
    writeFileSync(path.join(updaterDir, 'README.md'), 'seed\nlocal base\nremote ahead\n', 'utf8')
    runGit(updaterDir, ['add', 'README.md'])
    runGit(updaterDir, ['commit', '-m', 'remote ahead commit'])
    runGit(updaterDir, ['push', 'origin', branchName])

    await withMockFetch(
      () => {
        throw new Error('fetch should not be called when remote is ahead')
      },
      async () => {
        const result = await createLocalTaskPullRequest({
          worktreePath: worktreeDir,
          repoUrl: GITHUB_REPO_URL,
          title: 'Blocked PR',
          body: 'Body',
          baseBranch: 'main',
          gitIdentity: GITHUB_IDENTITY,
        })

        assert.equal(result.ok, false)
        assert.equal(result.compareBranch, branchName)
        assert.match(result.message, /远端同名分支 .* 已包含本地没有的提交/)
      },
    )
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('createLocalTaskPullRequest blocks when the local and remote branch histories diverge', async () => {
  const { root, worktreeDir, branchName, cloneForUpdate } = createPullRequestRepoFixture('feature/pr-diverged')

  try {
    writeFileSync(path.join(worktreeDir, 'README.md'), 'seed\nshared base\n', 'utf8')
    runGit(worktreeDir, ['add', 'README.md'])
    runGit(worktreeDir, ['commit', '-m', 'shared base commit'])
    runGit(worktreeDir, ['push', '-u', 'origin', branchName])

    const updaterDir = cloneForUpdate('updater-diverged')
    runGit(updaterDir, ['checkout', branchName])
    writeFileSync(path.join(updaterDir, 'README.md'), 'seed\nshared base\nremote change\n', 'utf8')
    runGit(updaterDir, ['add', 'README.md'])
    runGit(updaterDir, ['commit', '-m', 'remote diverged commit'])
    runGit(updaterDir, ['push', 'origin', branchName])

    writeFileSync(path.join(worktreeDir, 'local-only.txt'), 'local change\n', 'utf8')
    runGit(worktreeDir, ['add', 'local-only.txt'])
    runGit(worktreeDir, ['commit', '-m', 'local diverged commit'])

    await withMockFetch(
      () => {
        throw new Error('fetch should not be called when branch histories diverge')
      },
      async () => {
        const result = await createLocalTaskPullRequest({
          worktreePath: worktreeDir,
          repoUrl: GITHUB_REPO_URL,
          title: 'Diverged PR',
          body: 'Body',
          baseBranch: 'main',
          gitIdentity: GITHUB_IDENTITY,
        })

        assert.equal(result.ok, false)
        assert.equal(result.compareBranch, branchName)
        assert.match(result.message, /已经分叉/)
      },
    )
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
