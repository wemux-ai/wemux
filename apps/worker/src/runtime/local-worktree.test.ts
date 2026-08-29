import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { simpleGit } from 'simple-git'
import { cleanupLocalTaskWorktree, ensureLocalTaskWorktree } from './local-worktree'

test('cleanupLocalTaskWorktree preserves the project directory in original-dir mode', async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'vibemux-original-dir-cleanup-'))
  const projectDir = path.join(root, 'project')

  try {
    mkdirSync(projectDir, { recursive: true })
    writeFileSync(path.join(projectDir, 'README.md'), 'keep me\n', 'utf8')

    const result = await cleanupLocalTaskWorktree({
      workspaceRoot: root,
      workspaceId: 'workspace-1',
      repoPath: projectDir,
      worktreePath: projectDir,
      workingDirectoryMode: 'original-dir',
    })

    assert.equal(result.ok, true)
    assert.equal(existsSync(projectDir), true)
    assert.equal(existsSync(path.join(projectDir, 'README.md')), true)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('ensureLocalTaskWorktree reuses the actual original directory when stored repoPath is stale', async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'vibemux-original-dir-'))
  const projectDir = path.join(root, 'project')
  const staleRepoPath = path.join(root, 'missing-repo')

  try {
    mkdirSync(projectDir, { recursive: true })
    writeFileSync(path.join(projectDir, 'README.md'), 'hello\n', 'utf8')
    const git = simpleGit(projectDir)
    await git.init(['--initial-branch=main'])
    await git.add('.')
    await git.commit('init', { '--author': 'Test <test@example.com>' })

    const result = await ensureLocalTaskWorktree({
      workspaceRoot: path.join(root, 'workspace'),
      repoPath: staleRepoPath,
      branchName: 'vibemux/test',
      worktreePath: projectDir,
      workingDirectoryMode: 'original-dir',
    })

    assert.equal(result.ok, true)
    assert.equal(result.worktreePath, projectDir)
    assert.match(result.message, /已复用原始目录/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('ensureLocalTaskWorktree clones a missing original directory repository before reuse', async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'vibemux-original-dir-clone-'))
  const remoteRepoPath = path.join(root, 'remote-repo')
  const originalDirPath = path.join(root, 'project')

  try {
    mkdirSync(remoteRepoPath, { recursive: true })
    writeFileSync(path.join(remoteRepoPath, 'README.md'), 'hello\n', 'utf8')
    const remoteGit = simpleGit(remoteRepoPath)
    await remoteGit.init(['--initial-branch=main'])
    await remoteGit.add('.')
    await remoteGit.commit('init', { '--author': 'Test <test@example.com>' })

    const result = await ensureLocalTaskWorktree({
      workspaceRoot: path.join(root, 'workspace'),
      repoPath: originalDirPath,
      repoUrl: remoteRepoPath,
      preferredBranch: 'main',
      branchName: 'main',
      worktreePath: originalDirPath,
      workingDirectoryMode: 'original-dir',
    })

    assert.equal(result.ok, true)
    assert.equal(result.worktreePath, originalDirPath)
    assert.match(result.message, /已复用原始目录/)
    assert.equal(existsSync(path.join(originalDirPath, 'README.md')), true)
    assert.equal((await simpleGit(originalDirPath).branchLocal()).current, 'main')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('ensureLocalTaskWorktree repairs an invalid managed repo cache before creating a worktree', async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'vibemux-managed-repo-repair-'))
  const workspaceRoot = path.join(root, 'workspace')
  const remoteRepoPath = path.join(root, 'remote-repo')
  const managedRepoPath = path.join(workspaceRoot, 'workspaces', 'workspace-a', 'repos', 'vibemux')
  const worktreePath = path.join(workspaceRoot, 'workspaces', 'workspace-a', 'worktrees', 'task-1')

  try {
    mkdirSync(remoteRepoPath, { recursive: true })
    writeFileSync(path.join(remoteRepoPath, 'README.md'), 'hello\n', 'utf8')
    const remoteGit = simpleGit(remoteRepoPath)
    await remoteGit.init(['--initial-branch=main'])
    await remoteGit.add('.')
    await remoteGit.commit('init', { '--author': 'Test <test@example.com>' })

    mkdirSync(managedRepoPath, { recursive: true })
    writeFileSync(path.join(managedRepoPath, '.clone-failed'), 'partial clone residue\n', 'utf8')

    const result = await ensureLocalTaskWorktree({
      workspaceRoot,
      repoPath: managedRepoPath,
      repoUrl: remoteRepoPath,
      preferredBranch: 'main',
      branchName: 'vibemux/test',
      worktreePath,
    })

    assert.equal(result.ok, true)
    assert.equal(result.worktreePath, worktreePath)
    assert.equal(existsSync(path.join(managedRepoPath, '.clone-failed')), false)
    assert.equal(existsSync(path.join(managedRepoPath, 'README.md')), true)
    assert.equal(existsSync(path.join(worktreePath, 'README.md')), true)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('ensureLocalTaskWorktree restores an existing remote workspace branch instead of resetting to base', async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'vibemux-worktree-remote-branch-'))
  const workspaceRoot = path.join(root, 'workspace')
  const remoteRepoPath = path.join(root, 'remote-repo')
  const managedRepoPath = path.join(workspaceRoot, 'workspaces', 'workspace-a', 'repos', 'vibemux')
  const worktreePath = path.join(workspaceRoot, 'workspaces', 'workspace-a', 'worktrees', 'task-1')
  const branchName = 'vibemux/test'

  try {
    mkdirSync(remoteRepoPath, { recursive: true })
    writeFileSync(path.join(remoteRepoPath, 'README.md'), 'base\n', 'utf8')
    const remoteGit = simpleGit(remoteRepoPath)
    await remoteGit.init(['--initial-branch=main'])
    await remoteGit.add('.')
    await remoteGit.commit('init', { '--author': 'Test <test@example.com>' })
    await remoteGit.checkoutLocalBranch(branchName)
    writeFileSync(path.join(remoteRepoPath, 'workspace-only.txt'), 'remote branch change\n', 'utf8')
    await remoteGit.add('.')
    await remoteGit.commit('workspace branch commit', { '--author': 'Test <test@example.com>' })
    await remoteGit.checkout('main')

    const result = await ensureLocalTaskWorktree({
      workspaceRoot,
      repoPath: managedRepoPath,
      repoUrl: remoteRepoPath,
      preferredBranch: 'main',
      branchName,
      worktreePath,
    })

    assert.equal(result.ok, true)
    assert.equal(result.worktreePath, worktreePath)
    assert.equal(existsSync(path.join(worktreePath, 'workspace-only.txt')), true)
    assert.equal((await simpleGit(worktreePath).branchLocal()).current, branchName)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('ensureLocalTaskWorktree reuses an existing remote worktree without deleting node_modules', async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'vibemux-worktree-reuse-'))
  const workspaceRoot = path.join(root, 'workspace')
  const remoteRepoPath = path.join(root, 'remote-repo')
  const managedRepoPath = path.join(workspaceRoot, 'workspaces', 'workspace-a', 'repos', 'vibemux')
  const worktreePath = path.join(workspaceRoot, 'workspaces', 'workspace-a', 'worktrees', 'task-1')
  const branchName = 'vibemux/test'

  try {
    mkdirSync(remoteRepoPath, { recursive: true })
    writeFileSync(path.join(remoteRepoPath, 'README.md'), 'base\n', 'utf8')
    const remoteGit = simpleGit(remoteRepoPath)
    await remoteGit.init(['--initial-branch=main'])
    await remoteGit.add('.')
    await remoteGit.commit('init', { '--author': 'Test <test@example.com>' })

    const firstResult = await ensureLocalTaskWorktree({
      workspaceRoot,
      repoPath: managedRepoPath,
      repoUrl: remoteRepoPath,
      preferredBranch: 'main',
      branchName,
      worktreePath,
    })

    assert.equal(firstResult.ok, true)
    mkdirSync(path.join(worktreePath, 'node_modules', '.cache'), { recursive: true })
    writeFileSync(path.join(worktreePath, 'node_modules', '.cache', 'marker.txt'), 'keep me\n', 'utf8')

    const secondResult = await ensureLocalTaskWorktree({
      workspaceRoot,
      repoPath: managedRepoPath,
      repoUrl: remoteRepoPath,
      preferredBranch: 'main',
      branchName,
      worktreePath,
    })

    assert.equal(secondResult.ok, true)
    assert.match(secondResult.message, /已复用现有 worktree/)
    assert.equal(existsSync(path.join(worktreePath, 'node_modules', '.cache', 'marker.txt')), true)
    assert.equal((await simpleGit(worktreePath).branchLocal()).current, branchName)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('ensureLocalTaskWorktree can rebuild a workspace branch from the preferred base branch', async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'vibemux-worktree-preferred-start-'))
  const workspaceRoot = path.join(root, 'workspace')
  const remoteRepoPath = path.join(root, 'remote-repo')
  const managedRepoPath = path.join(workspaceRoot, 'workspaces', 'workspace-a', 'repos', 'vibemux')
  const worktreePath = path.join(workspaceRoot, 'workspaces', 'workspace-a', 'worktrees', 'task-1')
  const branchName = 'vibemux/test'

  try {
    mkdirSync(remoteRepoPath, { recursive: true })
    writeFileSync(path.join(remoteRepoPath, 'README.md'), 'base\n', 'utf8')
    const remoteGit = simpleGit(remoteRepoPath)
    await remoteGit.init(['--initial-branch=main'])
    await remoteGit.add('.')
    await remoteGit.commit('init', { '--author': 'Test <test@example.com>' })
    await remoteGit.checkoutLocalBranch(branchName)
    writeFileSync(path.join(remoteRepoPath, 'workspace-only.txt'), 'remote branch change\n', 'utf8')
    await remoteGit.add('.')
    await remoteGit.commit('workspace branch commit', { '--author': 'Test <test@example.com>' })
    await remoteGit.checkout('main')

    const result = await ensureLocalTaskWorktree({
      workspaceRoot,
      repoPath: managedRepoPath,
      repoUrl: remoteRepoPath,
      preferredBranch: 'main',
      startPointMode: 'preferred-branch',
      branchName,
      worktreePath,
    })

    assert.equal(result.ok, true)
    assert.equal(result.worktreePath, worktreePath)
    assert.equal(existsSync(path.join(worktreePath, 'workspace-only.txt')), false)
    assert.equal((await simpleGit(worktreePath).branchLocal()).current, branchName)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('ensureLocalTaskWorktree reports remote prepare errors instead of masking them with invalid local repo fallback', async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'vibemux-remote-error-unmasked-'))
  const workspaceRoot = path.join(root, 'workspace')
  const managedRepoPath = path.join(workspaceRoot, 'workspaces', 'workspace-a', 'repos', 'vibemux')
  const worktreePath = path.join(workspaceRoot, 'workspaces', 'workspace-a', 'worktrees', 'task-1')

  try {
    mkdirSync(managedRepoPath, { recursive: true })
    writeFileSync(path.join(managedRepoPath, '.clone-failed'), 'partial clone residue\n', 'utf8')

    const result = await ensureLocalTaskWorktree({
      workspaceRoot,
      repoPath: managedRepoPath,
      repoUrl: path.join(root, 'missing-remote'),
      preferredBranch: 'main',
      branchName: 'vibemux/test',
      worktreePath,
    })

    assert.equal(result.ok, false)
    assert.equal(/目标目录不是有效 Git 仓库/.test(result.message), false)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('ensureLocalTaskWorktree prepares a missing original directory for a plain local project', async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'vibemux-original-dir-missing-'))
  const originalDirPath = path.join(root, 'project')

  try {
    const result = await ensureLocalTaskWorktree({
      workspaceRoot: path.join(root, 'workspace'),
      repoPath: originalDirPath,
      branchName: 'vibemux/test',
      worktreePath: originalDirPath,
      workingDirectoryMode: 'original-dir',
    })

    assert.equal(result.ok, true)
    assert.equal(result.worktreePath, originalDirPath)
    assert.equal(existsSync(originalDirPath), true)
    assert.match(result.message, /已准备本地项目目录/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('ensureLocalTaskWorktree prepares a missing original directory when parent projects dir is absent', async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'vibemux-original-dir-parent-'))
  const originalDirPath = path.join(root, 'workspace', 'workspaces', 'workspace-a', 'projects', 'vibe-test')

  try {
    const result = await ensureLocalTaskWorktree({
      workspaceRoot: path.join(root, 'workspace'),
      repoPath: originalDirPath,
      branchName: 'vibemux/test',
      worktreePath: originalDirPath,
      workingDirectoryMode: 'original-dir',
      runtimeEnvironment: {
        mode: 'env-file',
        fileName: '.env.local',
        fileContent: 'HELLO=world',
        variables: {},
      },
    })

    assert.equal(result.ok, true)
    assert.equal(result.worktreePath, originalDirPath)
    assert.equal(existsSync(originalDirPath), true)
    assert.equal(existsSync(path.join(originalDirPath, '.env.local')), true)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('ensureLocalTaskWorktree remaps managed original directory paths to the local worker workspace root', async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'vibemux-original-dir-remap-'))
  const workspaceRoot = path.join(root, 'workspace')
  const expectedProjectPath = path.join(workspaceRoot, 'workspaces', 'workspace-a', 'projects', 'vibe-test')

  try {
    const result = await ensureLocalTaskWorktree({
      workspaceRoot,
      repoPath: '/root/.vibemux-dev/workspace/workspaces/workspace-a/projects/vibe-test',
      branchName: 'main',
      worktreePath: '/root/.vibemux-dev/workspace/workspaces/workspace-a/projects/vibe-test',
      workingDirectoryMode: 'original-dir',
      runtimeEnvironment: {
        mode: 'env-file',
        fileName: '.env.local',
        fileContent: 'HELLO=world',
        variables: {},
      },
    })

    assert.equal(result.ok, true)
    assert.equal(result.worktreePath, expectedProjectPath)
    assert.equal(existsSync(expectedProjectPath), true)
    assert.equal(existsSync(path.join(expectedProjectPath, '.env.local')), true)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('ensureLocalTaskWorktree does not fall back to repos dir for original directory sessions', async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'vibemux-original-dir-no-repo-fallback-'))
  const workspaceRoot = path.join(root, 'workspace')
  const originalDirPath = path.join(workspaceRoot, 'workspaces', 'workspace-a', 'projects', 'vibe-test')
  const fallbackRepoDir = path.join(workspaceRoot, 'workspaces', 'workspace-a', 'repos', 'repo-32a6fcbaa454')

  try {
    mkdirSync(fallbackRepoDir, { recursive: true })
    writeFileSync(path.join(fallbackRepoDir, 'README.md'), 'wrong directory\n', 'utf8')

    const result = await ensureLocalTaskWorktree({
      workspaceRoot,
      branchName: 'main',
      worktreePath: originalDirPath,
      workingDirectoryMode: 'original-dir',
    })

    assert.equal(result.ok, true)
    assert.equal(result.worktreePath, originalDirPath)
    assert.equal(existsSync(originalDirPath), true)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('ensureLocalTaskWorktree reuses a plain directory in original-dir mode without requiring git', async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'vibemux-original-dir-plain-'))
  const projectDir = path.join(root, 'project')

  try {
    mkdirSync(projectDir, { recursive: true })
    writeFileSync(path.join(projectDir, 'README.md'), 'hello\n', 'utf8')

    const result = await ensureLocalTaskWorktree({
      workspaceRoot: path.join(root, 'workspace'),
      repoPath: projectDir,
      branchName: 'vibemux/test',
      worktreePath: projectDir,
      workingDirectoryMode: 'original-dir',
    })

    assert.equal(result.ok, true)
    assert.equal(result.worktreePath, projectDir)
    assert.match(result.message, /当前目录还没有 Git 仓库/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('ensureLocalTaskWorktree reuses a git repo without commits in original-dir mode', async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'vibemux-original-dir-unborn-'))
  const projectDir = path.join(root, 'project')

  try {
    mkdirSync(projectDir, { recursive: true })
    const git = simpleGit(projectDir)
    await git.init(['--initial-branch=main'])

    const result = await ensureLocalTaskWorktree({
      workspaceRoot: path.join(root, 'workspace'),
      repoPath: projectDir,
      branchName: 'vibemux/test',
      worktreePath: projectDir,
      workingDirectoryMode: 'original-dir',
    })

    assert.equal(result.ok, true)
    assert.equal(result.worktreePath, projectDir)
    assert.match(result.message, /还没有首个提交/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('ensureLocalTaskWorktree writes env-file after creating a local repo worktree', async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'vibemux-worktree-env-file-'))
  const repoPath = path.join(root, 'repo')
  const worktreePath = path.join(root, 'workspace', 'workspaces', 'workspace-a', 'worktrees', 'task-1')

  try {
    mkdirSync(repoPath, { recursive: true })
    writeFileSync(path.join(repoPath, 'README.md'), 'hello\n', 'utf8')
    const git = simpleGit(repoPath)
    await git.init(['--initial-branch=main'])
    await git.add('.')
    await git.commit('init', { '--author': 'Test <test@example.com>' })

    const result = await ensureLocalTaskWorktree({
      workspaceRoot: path.join(root, 'workspace'),
      repoPath,
      branchName: 'vibemux/test',
      worktreePath,
      runtimeEnvironment: {
        mode: 'env-file',
        fileName: '.env.local',
        fileContent: 'HELLO=world',
        variables: {},
      },
    })

    assert.equal(result.ok, true)
    assert.equal(result.worktreePath, worktreePath)
    assert.equal(existsSync(path.join(worktreePath, '.env.local')), true)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('ensureLocalTaskWorktree does not materialize process-env for local repo worktrees', async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'vibemux-worktree-process-env-'))
  const repoPath = path.join(root, 'repo')
  const worktreePath = path.join(root, 'workspace', 'workspaces', 'workspace-a', 'worktrees', 'task-1')

  try {
    mkdirSync(repoPath, { recursive: true })
    writeFileSync(path.join(repoPath, 'README.md'), 'hello\n', 'utf8')
    const git = simpleGit(repoPath)
    await git.init(['--initial-branch=main'])
    await git.add('.')
    await git.commit('init', { '--author': 'Test <test@example.com>' })

    const result = await ensureLocalTaskWorktree({
      workspaceRoot: path.join(root, 'workspace'),
      repoPath,
      branchName: 'vibemux/test',
      worktreePath,
      runtimeEnvironment: {
        mode: 'process-env',
        variables: {
          HELLO: 'world',
        },
      },
    })

    assert.equal(result.ok, true)
    assert.equal(result.worktreePath, worktreePath)
    assert.equal(existsSync(path.join(worktreePath, '.env.local')), false)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
