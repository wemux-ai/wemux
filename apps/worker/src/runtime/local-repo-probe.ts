// [INPUT]: 目录探测请求
// [OUTPUT]: 仓库探测结果
// [POS]: 本地仓库探测
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { getSimpleGitOptionsForEnv, rewriteGitCredentialError } from '@shared/git-auth'
import type {
  ExecutorDirectoryBrowseResult,
  ExecutorFileReadResult,
  ExecutorFileWriteResult,
  LocalPathProbeResult,
  RepoBranchSnapshotResult,
  TaskRuntimeGitIdentity,
} from '@shared/types'
import { createTaskGitAuthContext } from '../execution/git-identity'
import {
  DEFAULT_BRANCH_FALLBACK,
  buildLocalSnapshotBranchSources,
  createGitClient,
  ensurePreparedRepository,
  mergeRemoteSnapshotBranchSources,
  normalizeBranchName,
  normalizeFilesystemPath,
  resolveLocalRepoBranchSnapshot,
  resolvePreferredStartPoint,
  resolveRemoteRepoBranchSnapshot,
  shouldPreferLocalBranchSnapshot,
} from './local-git-repository'
import { isManagedProjectPath, isManagedRepositoryPath } from './managed-workspace-path'

const isPathInsideRoot = (rootPath: string, candidatePath: string) => {
  const relativePath = path.relative(rootPath, candidatePath)
  return relativePath === '' || (!relativePath.startsWith('..') && !path.isAbsolute(relativePath))
}

const resolveDirectoryBrowseRoot = (workspaceRoot: string) => {
  const resolvedWorkspaceRoot = normalizeFilesystemPath(workspaceRoot)
  const resolvedHomePath = normalizeFilesystemPath(os.homedir())

  return isPathInsideRoot(resolvedHomePath, resolvedWorkspaceRoot)
    ? resolvedHomePath
    : resolvedWorkspaceRoot
}

const resolveRootedPathTarget = (rootPath: string, targetPath?: string) => {
  const resolvedRootPath = normalizeFilesystemPath(rootPath)
  const requestedPath = targetPath?.trim() ? normalizeFilesystemPath(targetPath) : resolvedRootPath
  return {
    resolvedRootPath,
    requestedPath,
  }
}

export const probeLocalRepositoryPath = async (localPath: string): Promise<LocalPathProbeResult> => {
  const resolvedLocalPath = normalizeFilesystemPath(localPath)

  try {
    const stats = await stat(resolvedLocalPath)
    if (!stats.isDirectory()) {
      return { ok: false, path: resolvedLocalPath, message: '请选择目录而非文件' }
    }
  } catch {
    return { ok: false, path: resolvedLocalPath, message: '目录不存在' }
  }

  const name = path.basename(resolvedLocalPath)

  try {
    const git = createGitClient(resolvedLocalPath)
    const isRepo = await git.checkIsRepo()
    if (!isRepo) {
      return {
        ok: true,
        path: resolvedLocalPath,
        name,
        versionControl: 'none',
        message: '目录无 Git 仓库',
      }
    }

    const hasCommit = await git.revparse(['--verify', 'HEAD'])
      .then((value) => Boolean(value.trim()))
      .catch(() => false)
    const remotes = await git.getRemotes(true)
    const origin = remotes.find((remote) => remote.name === 'origin')
    const remoteUrl = origin?.refs.fetch?.trim() || ''
    if (!hasCommit) {
      return {
        ok: true,
        path: resolvedLocalPath,
        name,
        versionControl: 'none',
        gitUrl: remoteUrl || undefined,
        message: remoteUrl
          ? '目录已初始化 Git 并配置远端，但还没有首个提交；当前按本地目录项目处理。'
          : '目录已初始化 Git，但还没有首个提交；当前按本地目录项目处理。',
      }
    }

    const snapshot = await resolveLocalRepoBranchSnapshot(resolvedLocalPath)
    const branchCount = snapshot.branches.length
    const versionControl = remoteUrl ? 'git-remote' : 'git-local'
    return {
      ok: true,
      path: resolvedLocalPath,
      name,
      versionControl,
      gitUrl: remoteUrl,
      defaultBranch: snapshot.defaultBranch,
      message: branchCount > 0
        ? (versionControl === 'git-remote'
          ? `已检测到 Git 仓库，共 ${branchCount} 个分支`
          : `已检测到本地 Git 仓库（未绑定远端），共 ${branchCount} 个分支`)
        : (versionControl === 'git-remote' ? '已检测到 Git 仓库' : '已检测到本地 Git 仓库（未绑定远端）'),
    }
  } catch {
    return { ok: true, path: resolvedLocalPath, name, message: '无法读取 Git 信息' }
  }
}

export const browseExecutorDirectories = async (rootPath: string, directoryPath?: string): Promise<ExecutorDirectoryBrowseResult> => {
  const resolvedBrowseRoot = resolveDirectoryBrowseRoot(rootPath)
  const resolvedWorkspaceRoot = normalizeFilesystemPath(rootPath)
  const requestedPath = directoryPath?.trim() ? normalizeFilesystemPath(directoryPath) : resolvedWorkspaceRoot
  if (!isPathInsideRoot(resolvedBrowseRoot, requestedPath)) {
    return {
      ok: false,
      path: requestedPath,
      rootPath: resolvedBrowseRoot,
      entries: [],
      message: '当前路径超出可浏览范围。',
    }
  }

  try {
    const stats = await stat(requestedPath)
    if (!stats.isDirectory()) {
      return {
        ok: false,
        path: requestedPath,
        rootPath: resolvedBrowseRoot,
        entries: [],
        message: '当前路径不是目录。',
      }
    }
  } catch {
    if (isManagedProjectPath(rootPath, requestedPath)) {
      try {
        await mkdir(requestedPath, { recursive: true })
      } catch (error) {
        return {
          ok: false,
          path: requestedPath,
          rootPath: resolvedBrowseRoot,
          entries: [],
          message: error instanceof Error ? `创建项目目录失败：${error.message}` : '创建项目目录失败。',
        }
      }
    } else {
      return {
        ok: false,
        path: requestedPath,
        rootPath: resolvedBrowseRoot,
        entries: [],
        message: '目录不存在。',
      }
    }
  }

  try {
    const stats = await stat(requestedPath)
    if (!stats.isDirectory()) {
      return {
        ok: false,
        path: requestedPath,
        rootPath: resolvedBrowseRoot,
        entries: [],
        message: '当前路径不是目录。',
      }
    }
  } catch {
    return {
      ok: false,
      path: requestedPath,
      rootPath: resolvedBrowseRoot,
      entries: [],
      message: '目录不存在。',
    }
  }

  try {
    const children = await readdir(requestedPath, { withFileTypes: true })
    const entries = children
      .filter((entry) => entry.isDirectory() || entry.isFile())
      .map((entry) => ({
        name: entry.name,
        path: path.join(requestedPath, entry.name),
        kind: entry.isDirectory() ? 'directory' as const : 'file' as const,
      }))
      .sort((left, right) => {
        if (left.kind !== right.kind) {
          return left.kind === 'directory' ? -1 : 1
        }

        return left.name.localeCompare(right.name, 'zh-Hans-CN')
      })

    return {
      ok: true,
      path: requestedPath,
      rootPath: resolvedBrowseRoot,
      parentPath: requestedPath === resolvedBrowseRoot ? undefined : path.dirname(requestedPath),
      entries,
      message: entries.length > 0 ? `共找到 ${entries.length} 个条目。` : '当前目录下没有文件或文件夹。',
    }
  } catch (error) {
    return {
      ok: false,
      path: requestedPath,
      rootPath: resolvedBrowseRoot,
      entries: [],
      message: error instanceof Error ? error.message : '读取目录失败。',
    }
  }
}

const MAX_PREVIEW_BYTES = 200 * 1024
const IMAGE_EXTENSION_CONTENT_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.bmp': 'image/bmp',
  '.ico': 'image/x-icon',
}
const MARKDOWN_EXTENSIONS = new Set(['.md', '.markdown', '.mdx'])
const JSON_EXTENSIONS = new Set(['.json', '.jsonc'])

const resolvePreviewContentType = (filePath: string) => {
  const extension = path.extname(filePath).toLowerCase()
  if (IMAGE_EXTENSION_CONTENT_TYPES[extension]) {
    return IMAGE_EXTENSION_CONTENT_TYPES[extension]
  }
  if (MARKDOWN_EXTENSIONS.has(extension)) {
    return 'text/markdown'
  }
  if (JSON_EXTENSIONS.has(extension)) {
    return 'application/json'
  }
  return 'text/plain'
}

export const readExecutorFileContent = async (rootPath: string, filePath: string): Promise<ExecutorFileReadResult> => {
  const resolvedBrowseRoot = resolveDirectoryBrowseRoot(rootPath)
  const requestedPath = filePath?.trim() ? normalizeFilesystemPath(filePath) : resolvedBrowseRoot
  if (!isPathInsideRoot(resolvedBrowseRoot, requestedPath)) {
    return {
      ok: false,
      path: requestedPath,
      rootPath: resolvedBrowseRoot,
      message: '只能读取该工作站 workspace 内的文件。',
    }
  }

  try {
    const stats = await stat(requestedPath)
    if (!stats.isFile()) {
      return {
        ok: false,
        path: requestedPath,
        rootPath: resolvedBrowseRoot,
        message: '当前路径不是文件。',
      }
    }

    if (stats.size > MAX_PREVIEW_BYTES) {
      return {
        ok: false,
        path: requestedPath,
        rootPath: resolvedBrowseRoot,
        sizeBytes: stats.size,
        message: '文件过大，暂不支持预览。',
      }
    }

    const content = await readFile(requestedPath)
    const contentType = resolvePreviewContentType(requestedPath)
    const isImage = contentType.startsWith('image/')
    if (!isImage && content.includes(0)) {
      return {
        ok: false,
        path: requestedPath,
        rootPath: resolvedBrowseRoot,
        contentType,
        sizeBytes: stats.size,
        message: '暂不支持预览二进制文件。',
      }
    }

    return {
      ok: true,
      path: requestedPath,
      rootPath: resolvedBrowseRoot,
      content: isImage ? content.toString('base64') : content.toString('utf8'),
      contentType,
      encoding: isImage ? 'base64' : 'utf8',
      sizeBytes: stats.size,
      truncated: false,
    }
  } catch (error) {
    return {
      ok: false,
      path: requestedPath,
      rootPath: resolvedBrowseRoot,
      message: error instanceof Error ? error.message : '读取文件失败。',
    }
  }
}

export const writeExecutorFileContent = async (rootPath: string, filePath: string, content: string): Promise<ExecutorFileWriteResult> => {
  const resolvedBrowseRoot = resolveDirectoryBrowseRoot(rootPath)
  const requestedPath = filePath?.trim() ? normalizeFilesystemPath(filePath) : resolvedBrowseRoot
  if (!isPathInsideRoot(resolvedBrowseRoot, requestedPath)) {
    return {
      ok: false,
      path: requestedPath,
      rootPath: resolvedBrowseRoot,
      message: '只能写入该工作站 workspace 内的文件。',
    }
  }

  try {
    await mkdir(path.dirname(requestedPath), { recursive: true })

    const existingStats = await stat(requestedPath).catch(() => null)
    if (existingStats && !existingStats.isFile()) {
      return {
        ok: false,
        path: requestedPath,
        rootPath: resolvedBrowseRoot,
        message: '当前路径不是文件。',
      }
    }

    await writeFile(requestedPath, content, 'utf8')
    const stats = await stat(requestedPath)
    return {
      ok: true,
      path: requestedPath,
      rootPath: resolvedBrowseRoot,
      sizeBytes: stats.size,
      message: '文件已写入。',
    }
  } catch (error) {
    return {
      ok: false,
      path: requestedPath,
      rootPath: resolvedBrowseRoot,
      message: error instanceof Error ? error.message : '写入文件失败。',
    }
  }
}

export const getLocalRepositoryBranchSnapshot = async (
  localPath: string,
  repoUrl?: string,
  preferredBranch?: string,
  gitIdentity?: TaskRuntimeGitIdentity,
  workspaceRoot?: string,
): Promise<RepoBranchSnapshotResult> => {
  const resolvedLocalPath = normalizeFilesystemPath(localPath)
  const allowRepairInvalidRepository = isManagedRepositoryPath(workspaceRoot || '', resolvedLocalPath)
  const gitAuthContext = createTaskGitAuthContext({
    taskId: `repo-branches-${Buffer.from(resolvedLocalPath).toString('base64url').slice(0, 24)}`,
    identity: gitIdentity ?? { mode: 'personal' },
    repoUrl,
  })

  console.log('[worker] [repo-branches] snapshot starting', JSON.stringify({
    localPath: resolvedLocalPath,
    repoUrl,
    preferredBranch,
  }))

  try {
    const repoStats = await stat(resolvedLocalPath).catch(() => null)
    if (!repoUrl?.trim() && repoStats?.isDirectory()) {
      const git = createGitClient(resolvedLocalPath, gitAuthContext.env)
      const isRepo = await git.checkIsRepo().catch(() => false)
      if (!isRepo) {
        return {
          ok: false,
          branches: [],
          defaultBranch: normalizeBranchName(preferredBranch ?? '') || DEFAULT_BRANCH_FALLBACK,
          versionControl: 'none',
          message: '当前项目未启用 Git。',
        }
      }
    }

    if (await shouldPreferLocalBranchSnapshot(resolvedLocalPath, repoUrl, gitAuthContext.env)) {
      const snapshot = await resolveLocalRepoBranchSnapshot(resolvedLocalPath, preferredBranch, gitAuthContext.env)
      console.log('[worker] [repo-branches] local-only snapshot resolved', JSON.stringify({
        localPath: resolvedLocalPath,
        branchCount: snapshot.branches.length,
        defaultBranch: snapshot.defaultBranch,
      }))
      return {
        ok: true,
        branches: snapshot.branches,
        defaultBranch: snapshot.defaultBranch,
        currentBranch: snapshot.currentBranch,
        versionControl: 'git-local',
        branchSources: buildLocalSnapshotBranchSources(snapshot.branches),
      }
    }

    const snapshot = await resolveRemoteRepoBranchSnapshot(resolvedLocalPath, repoUrl, preferredBranch, gitAuthContext.env)
    const startPoint = resolvePreferredStartPoint({
      branches: snapshot.branches,
      defaultBranch: snapshot.defaultBranch,
      preferredBranch,
    })
    if (!snapshot.branches.includes(startPoint)) {
      return {
        ok: false,
        branches: [],
        defaultBranch: snapshot.defaultBranch,
        message: snapshot.branches.length > 0
          ? `起始分支 ${startPoint} 不存在。当前仓库分支：${snapshot.branches.join(', ')}`
          : `起始分支 ${startPoint} 不存在。`,
      }
    }

    await ensurePreparedRepository({
      repoPath: resolvedLocalPath,
      remoteTarget: snapshot.remoteTarget,
      startPoint,
      env: gitAuthContext.env,
      allowRepairInvalidRepository,
    })
    console.log('[worker] [repo-branches] remote snapshot resolved', JSON.stringify({
      localPath: resolvedLocalPath,
      remoteTarget: snapshot.remoteTarget,
      branchCount: snapshot.branches.length,
      defaultBranch: snapshot.defaultBranch,
    }))

    const preparedSnapshot = await resolveLocalRepoBranchSnapshot(resolvedLocalPath, preferredBranch, gitAuthContext.env)
      .catch(() => null)
    const mergedBranches = mergeRemoteSnapshotBranchSources({
      remoteBranches: snapshot.branches,
      localSnapshotBranches: preparedSnapshot?.branches,
    })
    return {
      ok: true,
      branches: mergedBranches.branches,
      defaultBranch: snapshot.defaultBranch,
      currentBranch: preparedSnapshot?.currentBranch ?? snapshot.currentBranch,
      versionControl: 'git-remote',
      branchSources: mergedBranches.branchSources,
    }
  } catch (error) {
    const normalizedError = rewriteGitCredentialError(error, repoUrl)
    console.log('[worker] [repo-branches] remote snapshot failed', JSON.stringify({
      localPath: resolvedLocalPath,
      error: normalizedError instanceof Error ? normalizedError.message : 'unknown',
    }))

    try {
      const stats = await stat(resolvedLocalPath)
      if (!stats.isDirectory()) {
        return {
          ok: false,
          branches: [],
          defaultBranch: normalizeBranchName(preferredBranch ?? '') || DEFAULT_BRANCH_FALLBACK,
          message: normalizedError instanceof Error ? normalizedError.message : '读取分支列表失败。',
        }
      }

      const git = createGitClient(resolvedLocalPath, gitAuthContext.env)
      if (!await git.checkIsRepo()) {
        console.log('[worker] [repo-branches] fallback skipped: path is not repo', JSON.stringify({
          localPath: resolvedLocalPath,
        }))
        return {
          ok: false,
          branches: [],
          defaultBranch: normalizeBranchName(preferredBranch ?? '') || DEFAULT_BRANCH_FALLBACK,
          message: normalizedError instanceof Error ? normalizedError.message : '读取分支列表失败。',
        }
      }

      const snapshot = await resolveLocalRepoBranchSnapshot(resolvedLocalPath, preferredBranch, gitAuthContext.env)
      console.log('[worker] [repo-branches] local fallback resolved', JSON.stringify({
        localPath: resolvedLocalPath,
        branchCount: snapshot.branches.length,
        defaultBranch: snapshot.defaultBranch,
      }))
      return {
        ok: true,
        branches: snapshot.branches,
        defaultBranch: snapshot.defaultBranch,
        currentBranch: snapshot.currentBranch,
        versionControl: 'git-local',
        branchSources: buildLocalSnapshotBranchSources(snapshot.branches),
      }
    } catch (fallbackError) {
      const normalizedFallbackError = rewriteGitCredentialError(fallbackError, repoUrl)
      console.log('[worker] [repo-branches] local fallback failed', JSON.stringify({
        localPath: resolvedLocalPath,
        error: normalizedFallbackError instanceof Error ? normalizedFallbackError.message : 'unknown',
      }))
    }

    return {
      ok: false,
      branches: [],
      defaultBranch: normalizeBranchName(preferredBranch ?? '') || DEFAULT_BRANCH_FALLBACK,
      message: normalizedError instanceof Error ? normalizedError.message : '读取分支列表失败。',
    }
  } finally {
    gitAuthContext.cleanup()
  }
}
