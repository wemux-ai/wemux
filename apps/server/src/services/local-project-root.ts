// [INPUT]: 本地路径输入
// [OUTPUT]: 路径展开/校验
// [POS]: 本地项目根路径
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import os from 'node:os'
import path from 'node:path'
import { buildWorkspaceProjectRootPath, getWorkspaceNodeDir, normalizeWorkspaceRoot } from '@shared/workspace-paths'

const expandHomeDir = (rawPath: string) => {
  const trimmed = rawPath.trim()
  if (!trimmed) {
    return ''
  }

  if (trimmed === '~') {
    return os.homedir()
  }

  if (trimmed.startsWith('~/')) {
    return path.join(os.homedir(), trimmed.slice(2))
  }

  return trimmed
}

export const resolveManagedPath = (rawPath?: string) => {
  const expandedPath = expandHomeDir(rawPath ?? '')
  return expandedPath ? path.resolve(expandedPath) : ''
}

export const hasInvalidManagedScopePlaceholder = (rawPath?: string) => {
  const normalizedPath = rawPath?.trim().replace(/\\/g, '/') || ''
  if (!normalizedPath) {
    return false
  }

  return /(?:^|\/)users\/unknown(?:\/|$)/.test(normalizedPath)
    || /(?:^|\/)workspaces\/unknown(?:\/|$)/.test(normalizedPath)
}

const isPathEqualOrInside = (rootPath: string, candidatePath: string) => {
  const relativePath = path.relative(rootPath, candidatePath)
  return relativePath === '' || (!relativePath.startsWith('..') && !path.isAbsolute(relativePath))
}

export const buildProtectedProjectDeletionRoots = (workspaceRoots: Array<string | undefined>) => {
  const protectedRoots = new Set<string>()

  const addProtectedRoot = (value?: string) => {
    const normalized = resolveManagedPath(value)
    if (normalized) {
      protectedRoots.add(normalized)
    }
  }

  addProtectedRoot(path.parse(process.cwd()).root)
  addProtectedRoot(os.homedir())

  for (const workspaceRoot of workspaceRoots) {
    const normalizedWorkspaceRoot = resolveManagedPath(normalizeWorkspaceRoot(workspaceRoot))
    if (!normalizedWorkspaceRoot) {
      continue
    }

    addProtectedRoot(normalizedWorkspaceRoot)
    addProtectedRoot(getWorkspaceNodeDir(normalizedWorkspaceRoot))
    addProtectedRoot(path.join(normalizedWorkspaceRoot, 'users'))
    addProtectedRoot(path.join(normalizedWorkspaceRoot, 'workspaces'))
  }

  return [...protectedRoots]
}

export const getProjectDirectoryDeletionIssue = (rawTargetPath?: string, protectedRoots: string[] = []) => {
  const targetPath = resolveManagedPath(rawTargetPath)
  if (!targetPath) {
    return '项目目录未设置，无法删除目录。'
  }

  for (const protectedRoot of protectedRoots.map((value) => resolveManagedPath(value)).filter(Boolean)) {
    if (isPathEqualOrInside(targetPath, protectedRoot)) {
      return `不允许删除受保护路径：${targetPath}`
    }
  }

  return null
}

export const resolveDefaultLocalProjectRootPath = (params: {
  workspaceRoot?: string
  ownerUserId: string
  project: {
    name: string
    gitUrl: string
  }
}) => {
  const ownerUserId = params.ownerUserId.trim()
  if (!ownerUserId) {
    throw new Error('ownerUserId is required to create a managed local project path.')
  }

  const rawRootPath = buildWorkspaceProjectRootPath(params.workspaceRoot, params.project, undefined, ownerUserId)
  return resolveManagedPath(rawRootPath) || rawRootPath
}
