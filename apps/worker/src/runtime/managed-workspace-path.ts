// [INPUT]: managed workspace 路径输入
// [OUTPUT]: 作用域校验后的路径
// [POS]: managed workspace 路径校验
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import path from 'node:path'
import { normalizeWorkspaceRoot } from '@shared/workspace-paths'
import { normalizeFilesystemPath } from './local-git-repository'

const isPathInsideRoot = (rootPath: string, candidatePath: string) => {
  const relativePath = path.relative(rootPath, candidatePath)
  return relativePath === '' || (!relativePath.startsWith('..') && !path.isAbsolute(relativePath))
}

const isPathInsideScopedManagedRoot = (
  workspaceRoot: string,
  candidatePath: string,
  directoryName: 'projects' | 'repos',
) => {
  const relativeParts = path.relative(workspaceRoot, candidatePath).split(path.sep).filter(Boolean)
  if (relativeParts[0] === 'workspaces' && relativeParts[1]) {
    return relativeParts.length >= 4 && relativeParts[2] === directoryName
  }

  if (relativeParts[0] === 'users' && relativeParts[1]) {
    if (relativeParts.length >= 4 && relativeParts[2] === directoryName) {
      return true
    }

    return relativeParts.length >= 6
      && relativeParts[2] === 'workspaces'
      && Boolean(relativeParts[3])
      && relativeParts[4] === directoryName
  }

  return false
}

const isManagedWorkspacePath = (workspaceRoot: string, rawPath: string | undefined, directoryName: 'projects' | 'repos') => {
  const trimmed = rawPath?.trim()
  if (!trimmed) {
    return false
  }

  const resolvedWorkspaceRoot = normalizeFilesystemPath(normalizeWorkspaceRoot(workspaceRoot))
  const resolvedPath = normalizeFilesystemPath(trimmed)
  if (
    isPathInsideRoot(resolvedWorkspaceRoot, resolvedPath)
    && isPathInsideScopedManagedRoot(resolvedWorkspaceRoot, resolvedPath, directoryName)
  ) {
    return true
  }

  const normalizedForMatch = resolvedPath.replace(/\\/g, '/')
  return new RegExp(`(?:^|/)\\.(?:wemux|vibemux)(?:-[^/]+)?/(?:workspace/(?:users/[^/]+/)?(?:workspaces/[^/]+/)?|users/[^/]+/(?:workspaces/[^/]+/)?|workspaces/[^/]+/)${directoryName}/.+$`).test(normalizedForMatch)
}

export const isManagedProjectPath = (workspaceRoot: string, rawPath?: string) => {
  return isManagedWorkspacePath(workspaceRoot, rawPath, 'projects')
}

export const isManagedRepositoryPath = (workspaceRoot: string, rawPath?: string) => {
  return isManagedWorkspacePath(workspaceRoot, rawPath, 'repos')
}

export const remapManagedProjectPath = (workspaceRoot: string, rawPath?: string) => {
  const trimmed = rawPath?.trim()
  if (!trimmed) {
    return trimmed
  }

  const resolvedWorkspaceRoot = normalizeFilesystemPath(normalizeWorkspaceRoot(workspaceRoot))
  const resolvedPath = normalizeFilesystemPath(trimmed)
  if (resolvedPath === resolvedWorkspaceRoot) {
    return resolvedPath
  }

  const normalizedForMatch = resolvedPath.replace(/\\/g, '/')
  const normalizedRootForMatch = resolvedWorkspaceRoot.replace(/\\/g, '/')
  if (normalizedForMatch.startsWith(`${normalizedRootForMatch}/`)) {
    const remappedParts = remapManagedProjectParts(normalizedForMatch.slice(normalizedRootForMatch.length + 1).split('/').filter(Boolean))
    return remappedParts ? path.join(resolvedWorkspaceRoot, ...remappedParts) : resolvedPath
  }

  const match = normalizedForMatch.match(/(?:^|\/)\.wemux(?:-[^/]+)?\/(.+)$/)
  if (!match) {
    return resolvedPath
  }

  const remappedParts = remapManagedProjectParts(match[1].split('/').filter(Boolean))
  return remappedParts ? path.join(resolvedWorkspaceRoot, ...remappedParts) : resolvedPath
}

const remapManagedProjectParts = (parts: string[]) => {
  const scopedParts = parts[0] === 'workspace' ? parts.slice(1) : parts
  if (scopedParts[0] === 'users' && scopedParts[2] === 'workspaces' && scopedParts[3] && scopedParts[4] === 'projects') {
    return ['workspaces', scopedParts[3], ...scopedParts.slice(4)]
  }

  if (scopedParts[0] === 'workspaces' && scopedParts[1] && scopedParts[2] === 'projects') {
    return scopedParts
  }

  if (scopedParts[0] === 'users' && scopedParts[1] && scopedParts[2] === 'projects') {
    return scopedParts
  }

  return null
}
