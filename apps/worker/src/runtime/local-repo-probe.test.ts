import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { simpleGit } from 'simple-git'

import {
  browseExecutorDirectories,
  getLocalRepositoryBranchSnapshot,
  probeLocalRepositoryPath,
  readExecutorFileContent,
  writeExecutorFileContent,
} from './local-repo-probe'
import { isManagedProjectPath, isManagedRepositoryPath, remapManagedProjectPath } from './managed-workspace-path'

test('browseExecutorDirectories allows jumping from workspace root to another path inside home directory', async () => {
  const homePath = path.resolve(os.homedir())
  const fakeWorkspaceRoot = path.join(homePath, '.vibemux-test', 'workspace')

  const result = await browseExecutorDirectories(fakeWorkspaceRoot, homePath)

  assert.equal(result.ok, true)
  assert.equal(result.path, homePath)
  assert.equal(result.rootPath, homePath)
})

test('browseExecutorDirectories still rejects paths outside the allowed browse root', async () => {
  const homePath = path.resolve(os.homedir())
  const fakeWorkspaceRoot = path.join(homePath, '.vibemux-test', 'workspace')
  const outsidePath = path.resolve('/tmp')

  const result = await browseExecutorDirectories(fakeWorkspaceRoot, outsidePath)

  assert.equal(result.ok, false)
  assert.equal(result.rootPath, homePath)
})

test('remapManagedProjectPath maps stale managed project paths to the local workspace root only for projects', () => {
  const workspaceRoot = '/Users/x/.vibemux-dev'

  assert.equal(
    remapManagedProjectPath(workspaceRoot, '/root/.vibemux-dev/workspace/projects/vibe-test'),
    '/root/.vibemux-dev/workspace/projects/vibe-test',
  )
  assert.equal(
    remapManagedProjectPath(workspaceRoot, '/root/.vibemux-dev/workspace/workspaces/workspace-a/projects/vibe-test'),
    '/Users/x/.vibemux-dev/workspaces/workspace-a/projects/vibe-test',
  )
  assert.equal(
    remapManagedProjectPath(workspaceRoot, '/root/.vibemux-dev/users/user-a/workspaces/workspace-a/projects/vibe-test'),
    '/Users/x/.vibemux-dev/workspaces/workspace-a/projects/vibe-test',
  )
  assert.equal(
    remapManagedProjectPath(workspaceRoot, '/root/.vibemux-dev/workspace/repos/vibe-test'),
    '/root/.vibemux-dev/workspace/repos/vibe-test',
  )
  assert.equal(
    remapManagedProjectPath(workspaceRoot, '/Users/x/work/vibe-test'),
    '/Users/x/work/vibe-test',
  )
})

test('isManagedProjectPath treats user and workspace projects paths as managed', () => {
  const workspaceRoot = '/Users/x/.vibemux-dev'

  assert.equal(isManagedProjectPath(workspaceRoot, '/Users/x/.vibemux-dev/projects/vibe-test'), false)
  assert.equal(isManagedProjectPath(workspaceRoot, '/Users/x/.vibemux-dev/workspaces/workspace-a/projects/vibe-test'), true)
  assert.equal(isManagedProjectPath(workspaceRoot, '/Users/x/.vibemux-dev/users/user-a/projects/vibe-test'), true)
  assert.equal(isManagedProjectPath(workspaceRoot, '/Users/x/.vibemux-dev/users/user-a/workspaces/workspace-a/projects/vibe-test'), true)
  assert.equal(isManagedProjectPath(workspaceRoot, '/root/.vibemux-dev/workspace/projects/vibe-test'), true)
  assert.equal(isManagedProjectPath(workspaceRoot, '/root/.vibemux-dev/workspace/workspaces/workspace-a/projects/vibe-test'), true)
  assert.equal(isManagedProjectPath(workspaceRoot, '/Users/x/.vibemux-dev/repos/repo-32a6fcbaa454'), false)
  assert.equal(isManagedProjectPath(workspaceRoot, '/Users/x/work/vibe-test'), false)
})

test('isManagedRepositoryPath treats user and workspace repos paths as managed', () => {
  const workspaceRoot = '/Users/x/.vibemux-dev'

  assert.equal(isManagedRepositoryPath(workspaceRoot, '/Users/x/.vibemux-dev/repos/vibemux'), false)
  assert.equal(isManagedRepositoryPath(workspaceRoot, '/Users/x/.vibemux-dev/workspaces/workspace-a/repos/vibemux'), true)
  assert.equal(isManagedRepositoryPath(workspaceRoot, '/Users/x/.vibemux-dev/users/user-a/repos/vibemux'), true)
  assert.equal(isManagedRepositoryPath(workspaceRoot, '/Users/x/.vibemux-dev/users/user-a/workspaces/workspace-a/repos/vibemux'), true)
  assert.equal(isManagedRepositoryPath(workspaceRoot, '/root/.vibemux-preview/workspace/repos/vibemux'), true)
  assert.equal(isManagedRepositoryPath(workspaceRoot, '/root/.vibemux-preview/workspace/workspaces/workspace-a/repos/vibemux'), true)
  assert.equal(isManagedRepositoryPath(workspaceRoot, '/Users/x/.vibemux-dev/projects/vibemux'), false)
  assert.equal(isManagedRepositoryPath(workspaceRoot, '/Users/x/work/vibemux'), false)
})

test('browseExecutorDirectories creates missing managed local project directories', async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'vibemux-browse-create-project-'))
  const workspaceRoot = path.join(root, 'workspace')
  const projectDir = path.join(workspaceRoot, 'workspaces', 'workspace-a', 'projects', 'vibe-test')

  try {
    const result = await browseExecutorDirectories(workspaceRoot, projectDir)

    assert.equal(result.ok, true)
    assert.equal(result.path, projectDir)
    assert.equal(existsSync(projectDir), true)
    assert.deepEqual(result.entries, [])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('browseExecutorDirectories can browse a remapped managed local project path', async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'vibemux-browse-remap-'))
  const workspaceRoot = path.join(root, 'workspace')
  const projectDir = path.join(workspaceRoot, 'workspaces', 'workspace-a', 'projects', 'vibe-test')

  try {
    mkdirSync(projectDir, { recursive: true })
    writeFileSync(path.join(projectDir, 'README.md'), '# hello\n', 'utf8')

    const rootPath = remapManagedProjectPath(workspaceRoot, '/root/.vibemux-dev/workspace/workspaces/workspace-a/projects/vibe-test') || workspaceRoot
    const directoryPath = remapManagedProjectPath(workspaceRoot, '/root/.vibemux-dev/workspace/workspaces/workspace-a/projects/vibe-test')
    const result = await browseExecutorDirectories(rootPath, directoryPath)

    assert.equal(result.ok, true)
    assert.equal(result.path, projectDir)
    assert.equal(result.entries.some((entry) => entry.name === 'README.md'), true)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('readExecutorFileContent uses the same allowed root as directory browsing', async () => {
  const homePath = path.resolve(os.homedir())
  const root = mkdtempSync(path.join(homePath, 'vibemux-file-read-'))
  const fakeWorkspaceRoot = path.join(root, '.vibemux-test', 'workspace')
  const projectDir = path.join(root, 'project')
  const filePath = path.join(projectDir, 'AGENTS.md')

  mkdirSync(fakeWorkspaceRoot, { recursive: true })
  mkdirSync(projectDir, { recursive: true })
  writeFileSync(filePath, '# test\n', 'utf8')

  try {
    const result = await readExecutorFileContent(fakeWorkspaceRoot, filePath)

    assert.equal(result.ok, true)
    assert.equal(result.path, filePath)
    assert.equal(result.rootPath, path.resolve(os.homedir()))
    assert.match(result.content || '', /# test/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('readExecutorFileContent returns image previews as base64 with content type', async () => {
  const homePath = path.resolve(os.homedir())
  const root = mkdtempSync(path.join(homePath, 'vibemux-image-read-'))
  const fakeWorkspaceRoot = path.join(root, '.vibemux-test', 'workspace')
  const projectDir = path.join(root, 'project')
  const filePath = path.join(projectDir, 'pixel.png')

  mkdirSync(fakeWorkspaceRoot, { recursive: true })
  mkdirSync(projectDir, { recursive: true })
  writeFileSync(filePath, Buffer.from([0x89, 0x50, 0x4e, 0x47]))

  try {
    const result = await readExecutorFileContent(fakeWorkspaceRoot, filePath)

    assert.equal(result.ok, true)
    assert.equal(result.contentType, 'image/png')
    assert.equal(result.encoding, 'base64')
    assert.equal(result.content, Buffer.from([0x89, 0x50, 0x4e, 0x47]).toString('base64'))
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('writeExecutorFileContent uses the same allowed root as directory browsing', async () => {
  const homePath = path.resolve(os.homedir())
  const root = mkdtempSync(path.join(homePath, 'vibemux-file-write-'))
  const fakeWorkspaceRoot = path.join(root, '.vibemux-test', 'workspace')
  const projectDir = path.join(root, 'project')
  const filePath = path.join(projectDir, '.env')

  mkdirSync(fakeWorkspaceRoot, { recursive: true })

  try {
    const result = await writeExecutorFileContent(fakeWorkspaceRoot, filePath, 'OPENAI_API_KEY=test\n')

    assert.equal(result.ok, true)
    assert.equal(result.path, filePath)
    assert.equal(result.rootPath, path.resolve(os.homedir()))
    assert.equal(existsSync(filePath), true)

    const readResult = await readExecutorFileContent(fakeWorkspaceRoot, filePath)
    assert.equal(readResult.content, 'OPENAI_API_KEY=test\n')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('writeExecutorFileContent rejects paths outside the allowed root', async () => {
  const homePath = path.resolve(os.homedir())
  const fakeWorkspaceRoot = path.join(homePath, '.vibemux-test', 'workspace')
  const outsidePath = path.resolve('/tmp', `vibemux-file-write-${Date.now()}`)

  const result = await writeExecutorFileContent(fakeWorkspaceRoot, outsidePath, 'SECRET=value\n')

  assert.equal(result.ok, false)
  assert.equal(result.rootPath, homePath)
  assert.equal(existsSync(outsidePath), false)
})

test('getLocalRepositoryBranchSnapshot clones a missing remote repository before reading branches', async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'vibemux-repo-snapshot-'))
  const remoteRepoPath = path.join(root, 'remote-repo')
  const localRepoPath = path.join(root, 'missing-local-repo')

  try {
    mkdirSync(remoteRepoPath, { recursive: true })
    writeFileSync(path.join(remoteRepoPath, 'README.md'), 'hello\n', 'utf8')

    const git = simpleGit(remoteRepoPath)
    await git.init(['--initial-branch=main'])
    await git.add('.')
    await git.commit('init', { '--author': 'Test <test@example.com>' })
    await git.checkoutLocalBranch('feature/test')
    writeFileSync(path.join(remoteRepoPath, 'feature.txt'), 'feature\n', 'utf8')
    await git.add('.')
    await git.commit('feature', { '--author': 'Test <test@example.com>' })
    await git.checkout('main')

    const result = await getLocalRepositoryBranchSnapshot(localRepoPath, remoteRepoPath, 'main')

    assert.equal(result.ok, true)
    assert.deepEqual(result.branches, ['feature/test', 'main'])
    assert.equal(result.defaultBranch, 'main')
    assert.equal(result.currentBranch, 'main')
    assert.equal(existsSync(path.join(localRepoPath, 'README.md')), true)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('getLocalRepositoryBranchSnapshot repairs an invalid managed repo cache before reading branches', async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'vibemux-repo-snapshot-repair-'))
  const workspaceRoot = path.join(root, 'workspace')
  const remoteRepoPath = path.join(root, 'remote-repo')
  const localRepoPath = path.join(workspaceRoot, 'users', 'user-a', 'repos', 'vibemux')

  try {
    mkdirSync(remoteRepoPath, { recursive: true })
    writeFileSync(path.join(remoteRepoPath, 'README.md'), 'hello\n', 'utf8')

    const git = simpleGit(remoteRepoPath)
    await git.init(['--initial-branch=main'])
    await git.add('.')
    await git.commit('init', { '--author': 'Test <test@example.com>' })

    mkdirSync(localRepoPath, { recursive: true })
    writeFileSync(path.join(localRepoPath, '.clone-failed'), 'partial clone residue\n', 'utf8')

    const result = await getLocalRepositoryBranchSnapshot(localRepoPath, remoteRepoPath, 'main', undefined, workspaceRoot)

    assert.equal(result.ok, true)
    assert.deepEqual(result.branches, ['main'])
    assert.equal(result.defaultBranch, 'main')
    assert.equal(result.currentBranch, 'main')
    assert.equal(existsSync(path.join(localRepoPath, '.clone-failed')), false)
    assert.equal(existsSync(path.join(localRepoPath, 'README.md')), true)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('getLocalRepositoryBranchSnapshot reports a plain directory as non-git', async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'vibemux-branch-plain-dir-'))
  const projectDir = path.join(root, 'project')

  try {
    mkdirSync(projectDir, { recursive: true })

    const result = await getLocalRepositoryBranchSnapshot(projectDir, undefined, 'main')

    assert.equal(result.ok, false)
    assert.equal(result.versionControl, 'none')
    assert.deepEqual(result.branches, [])
    assert.match(result.message ?? '', /未启用 Git/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('probeLocalRepositoryPath treats a plain directory as a local directory project', async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'vibemux-probe-plain-dir-'))
  const projectDir = path.join(root, 'project')

  try {
    mkdirSync(projectDir, { recursive: true })
    writeFileSync(path.join(projectDir, 'README.md'), 'hello\n', 'utf8')

    const result = await probeLocalRepositoryPath(projectDir)

    assert.equal(result.ok, true)
    assert.equal(result.versionControl, 'none')
    assert.match(result.message, /目录无 Git 仓库/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('probeLocalRepositoryPath treats git init without commit as a local directory project', async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'vibemux-probe-git-unborn-'))
  const projectDir = path.join(root, 'project')

  try {
    mkdirSync(projectDir, { recursive: true })
    const git = simpleGit(projectDir)
    await git.init(['--initial-branch=main'])

    const result = await probeLocalRepositoryPath(projectDir)

    assert.equal(result.ok, true)
    assert.equal(result.versionControl, 'none')
    assert.match(result.message, /还没有首个提交/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
