// [INPUT]: 路径输入
// [OUTPUT]: 路径校验/生成
// [POS]: workspace 路径 helper
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import type { AgentConfig, Project } from './types'

export const DEFAULT_WORKSPACE_ROOT = '~/.vibemux'

type ProjectLike = Pick<Project, 'id' | 'name' | 'gitUrl'>
type ProjectPathLike = Pick<Project, 'name' | 'gitUrl'>

const makeSlug = (text: string): string => {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 20)
}

const trimTrailingSlash = (value: string) => value.replace(/[\\/]+$/, '')
const normalizePortablePath = (value?: string) => trimTrailingSlash((value || '').trim().replace(/\\/g, '/'))
const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const joinSegments = (segments: string[]) => trimTrailingSlash(segments.filter(Boolean).join('/').replace(/\/+/g, '/'))
const sanitizePathSegment = (value: string) => value.trim().replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '')
const INVALID_SCOPE_PLACEHOLDER = 'unknown'
const normalizeScopeId = (value?: string) => sanitizePathSegment(value ?? '')
const requireScopeId = (value: string | undefined, label: 'userId' | 'workspaceId') => {
  const normalized = normalizeScopeId(value)
  if (!normalized || normalized === INVALID_SCOPE_PLACEHOLDER) {
    throw new Error(`${label} is required to create a managed workspace path.`)
  }

  return normalized
}
const normalizeWorkspaceId = (workspaceId?: string) => normalizeScopeId(workspaceId)
// 兼容窗口：新旧品牌 home 段都识别（`.wemux*` 为新默认，`.vibemux*` 为存量）
const isHomeSegment = (value?: string) => /^\.(?:wemux|vibemux)(?:-[^/]+)?$/.test(value ?? '')

const stripObsoleteWorkspaceRootSuffix = (value: string) => {
  const normalized = trimTrailingSlash(value.trim().replace(/\\/g, '/'))
  const parts = normalized.split('/')
  if (parts[parts.length - 1] !== 'workspace' || !isHomeSegment(parts[parts.length - 2])) {
    return normalized
  }

  const nextParts = parts.slice(0, -1)
  return nextParts.join('/') || '/'
}

export const normalizeWorkspaceRoot = (workspaceRoot?: string) => {
  const trimmed = workspaceRoot?.trim() || DEFAULT_WORKSPACE_ROOT
  return stripObsoleteWorkspaceRootSuffix(trimmed)
}

export const getWorkspaceNodeDir = (workspaceRoot?: string) => joinSegments([normalizeWorkspaceRoot(workspaceRoot), 'node'])

export const getWorkspaceUserScopeDir = (workspaceRoot?: string, userId?: string) => {
  return joinSegments([normalizeWorkspaceRoot(workspaceRoot), 'users', requireScopeId(userId, 'userId')])
}

export const getWorkspaceSharedScopeDir = (workspaceRoot?: string, workspaceId?: string) => {
  return joinSegments([normalizeWorkspaceRoot(workspaceRoot), 'workspaces', requireScopeId(workspaceId, 'workspaceId')])
}

export const getWorkspaceScopeDir = (workspaceRoot?: string, workspaceId?: string, userId?: string) => {
  const normalizedWorkspaceId = normalizeWorkspaceId(workspaceId)
  return normalizedWorkspaceId
    ? getWorkspaceSharedScopeDir(workspaceRoot, normalizedWorkspaceId)
    : getWorkspaceUserScopeDir(workspaceRoot, userId)
}

export const getWorkspaceRepoBaseDir = (workspaceRoot?: string, workspaceId?: string, userId?: string) => joinSegments([getWorkspaceScopeDir(workspaceRoot, workspaceId, userId), 'repos'])

export const getWorkspaceWorktreeBaseDir = (workspaceRoot?: string, workspaceId?: string, userId?: string) => joinSegments([getWorkspaceScopeDir(workspaceRoot, workspaceId, userId), 'worktrees'])

export const getWorkspaceProjectBaseDir = (workspaceRoot?: string, workspaceId?: string, userId?: string) => joinSegments([getWorkspaceScopeDir(workspaceRoot, workspaceId, userId), 'projects'])

export const getWorkspacePlaygroundBaseDir = (workspaceRoot?: string, workspaceId?: string) => joinSegments([getWorkspaceSharedScopeDir(workspaceRoot, workspaceId), 'playground'])

const PLAYGROUND_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789'

/** codex 风格随机短后缀（默认 4 位小写字母数字），纯函数、可测 */
export const generatePlaygroundSuffix = (length = 4) => {
  const safeLength = Math.min(12, Math.floor(length))
  if (safeLength < 1) {
    return 'work'
  }
  let result = ''
  for (let i = 0; i < safeLength; i++) {
    result += PLAYGROUND_ALPHABET[Math.floor(Math.random() * PLAYGROUND_ALPHABET.length)]
  }
  return result
}

/** 每次执行子目录：playground/<YYYY-MM-DD>/<随机短后缀>（codex 风格） */
export const buildWorkspacePlaygroundSessionDir = (
  workspaceRoot: string | undefined,
  workspaceId: string | undefined,
  at: Date | string = new Date(),
  randomSuffix = generatePlaygroundSuffix(),
) => {
  const dateSegment = (typeof at === 'string' ? at.slice(0, 10) : at.toISOString().slice(0, 10)).trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateSegment)) {
    return ''
  }
  const safeSuffix = sanitizePathSegment(randomSuffix.trim())
  return joinSegments([getWorkspacePlaygroundBaseDir(workspaceRoot, workspaceId), dateSegment, safeSuffix || 'work'])
}

export const extractRepositoryName = (gitUrl?: string) => {
  const trimmed = gitUrl?.trim() || ''
  if (!trimmed) {
    return ''
  }

  const normalized = trimmed.replace(/[\\/]+$/, '')
  const lastSegment = normalized.split(/[/:]/).pop() || ''
  return lastSegment.replace(/\.git$/i, '').trim()
}

export const getWorkspaceRepoName = (project: Pick<Project, 'name' | 'gitUrl'>) => {
  const seed = extractRepositoryName(project.gitUrl) || project.name.trim() || 'project'
  return makeSlug(seed) || 'project'
}

export const getWorkspaceProjectKey = (project: ProjectLike) => makeSlug(project.name.trim()) || makeSlug(extractRepositoryName(project.gitUrl)) || project.id.slice(0, 8) || 'project'

export const buildWorkspaceRepoPath = (workspaceRoot: string | undefined, project: Pick<Project, 'name' | 'gitUrl'>, workspaceId?: string, userId?: string) => {
  return joinSegments([getWorkspaceRepoBaseDir(workspaceRoot, workspaceId, userId), getWorkspaceRepoName(project)])
}

export const buildWorkspaceProjectRootPath = (workspaceRoot: string | undefined, project: Pick<Project, 'name' | 'gitUrl'>, workspaceId?: string, userId?: string) => {
  return joinSegments([getWorkspaceProjectBaseDir(workspaceRoot, workspaceId, userId), getWorkspaceRepoName(project)])
}

const matchesExpandedHomePath = (targetPath: string, expectedPath: string) => {
  if (!expectedPath.startsWith('~/')) {
    return false
  }

  const relativeHomePath = `/${escapeRegExp(expectedPath.slice(2))}`
  return new RegExp(`^(?:/Users/[^/]+|/home/[^/]+|/root)${relativeHomePath}$`).test(targetPath)
}

const matchesManagedWorkspacePath = (targetPath: string | undefined, expectedPath: string) => {
  const normalizedTargetPath = normalizePortablePath(targetPath)
  const normalizedExpectedPath = normalizePortablePath(expectedPath)
  if (!normalizedTargetPath || !normalizedExpectedPath) {
    return false
  }

  return normalizedTargetPath === normalizedExpectedPath
    || matchesExpandedHomePath(normalizedTargetPath, normalizedExpectedPath)
}

const buildManagedProjectPathSafely = (
  workspaceRoot: string | undefined,
  project: ProjectPathLike,
  containerName: 'projects' | 'repos',
  workspaceId?: string,
  userId?: string,
) => {
  const rawWorkspaceId = normalizeWorkspaceId(workspaceId)
  const normalizedWorkspaceId = rawWorkspaceId === INVALID_SCOPE_PLACEHOLDER ? '' : rawWorkspaceId
  const normalizedUserId = normalizeScopeId(userId)
  if (!normalizedWorkspaceId && (!normalizedUserId || normalizedUserId === INVALID_SCOPE_PLACEHOLDER)) {
    return ''
  }

  return containerName === 'projects'
    ? buildWorkspaceProjectRootPath(workspaceRoot, project, normalizedWorkspaceId || undefined, normalizedUserId || undefined)
    : buildWorkspaceRepoPath(workspaceRoot, project, normalizedWorkspaceId || undefined, normalizedUserId || undefined)
}

const isObsoleteManagedWorkspacePath = (
  targetPath: string | undefined,
  project: ProjectPathLike,
  containerName: 'projects' | 'repos',
  workspaceId?: string,
  userId?: string,
) => {
  const normalizedTargetPath = normalizePortablePath(targetPath)
  if (!normalizedTargetPath) {
    return false
  }

  const repoName = escapeRegExp(getWorkspaceRepoName(project))
  const normalizedWorkspaceId = sanitizePathSegment(workspaceId ?? '')
  const normalizedUserId = normalizeScopeId(userId)
  const userScopePattern = !normalizedUserId || normalizedUserId === INVALID_SCOPE_PLACEHOLDER
    ? `(?:users/[^/]+/)?`
    : `(?:users/${escapeRegExp(normalizedUserId)}/)?`
  const requiredUserScopePattern = !normalizedUserId || normalizedUserId === INVALID_SCOPE_PLACEHOLDER
    ? `users/[^/]+/`
    : `users/${escapeRegExp(normalizedUserId)}/`
  const workspaceScopePattern = normalizedWorkspaceId
    ? `(?:workspaces/${escapeRegExp(normalizedWorkspaceId)}/)?`
    : `(?:workspaces/[^/]+/)?`
  const requiredWorkspaceScopePattern = normalizedWorkspaceId
    ? `workspaces/${escapeRegExp(normalizedWorkspaceId)}/`
    : `(?:workspaces/[^/]+/)?`
  return new RegExp(`(?:^|/)\\.(?:wemux|vibemux)(?:-[^/]+)?/(?:workspace/${userScopePattern}${workspaceScopePattern}|${requiredUserScopePattern}${requiredWorkspaceScopePattern})${containerName}/${repoName}$`).test(normalizedTargetPath)
}

export const isManagedWorkspaceProjectPath = (
  targetPath: string | undefined,
  project: ProjectPathLike,
  workspaceRoot?: string,
  workspaceId?: string,
  userId?: string,
) => {
  const expectedPath = buildManagedProjectPathSafely(workspaceRoot, project, 'projects', workspaceId, userId)
  return (expectedPath ? matchesManagedWorkspacePath(targetPath, expectedPath) : false)
    || isObsoleteManagedWorkspacePath(targetPath, project, 'projects', workspaceId, userId)
}

export const isManagedWorkspaceRepoPath = (
  targetPath: string | undefined,
  project: ProjectPathLike,
  workspaceRoot?: string,
  workspaceId?: string,
  userId?: string,
) => {
  const expectedPath = buildManagedProjectPathSafely(workspaceRoot, project, 'repos', workspaceId, userId)
  return (expectedPath ? matchesManagedWorkspacePath(targetPath, expectedPath) : false)
    || isObsoleteManagedWorkspacePath(targetPath, project, 'repos', workspaceId, userId)
}

export const isManagedWorkspaceOwnedProjectPath = (
  targetPath: string | undefined,
  project: ProjectPathLike,
  workspaceRoot?: string,
  workspaceId?: string,
  userId?: string,
) => {
  return isManagedWorkspaceProjectPath(targetPath, project, workspaceRoot, workspaceId, userId)
    || isManagedWorkspaceRepoPath(targetPath, project, workspaceRoot, workspaceId, userId)
}

export const buildWorkspaceWorktreePath = (
  workspaceRoot: string | undefined,
  _project: ProjectLike,
  worktreeId: string,
  workspaceId?: string,
  userId?: string,
) => joinSegments([
  getWorkspaceWorktreeBaseDir(workspaceRoot, workspaceId, userId),
  worktreeId.trim(),
])

export const resolveTaskWorktreePath = (
  workspaceRoot: string | undefined,
  project: ProjectLike,
  task: { id: string; workspaceId?: string; worktreeId?: string; ownerUserId?: string; requestedByUserId?: string },
) => buildWorkspaceWorktreePath(workspaceRoot, project, task.worktreeId || task.id, task.workspaceId, task.ownerUserId ?? task.requestedByUserId)

export const getConfiguredWorkspaceRoot = (config?: Pick<AgentConfig, 'workspaceRoot'>) => normalizeWorkspaceRoot(config?.workspaceRoot)

export const isManagedWorkspaceContainerPath = (targetPath: string | undefined, workspaceRoot?: string) => {
  const normalizedTargetPath = normalizePortablePath(targetPath)
  const normalizedWorkspaceRoot = normalizeWorkspaceRoot(workspaceRoot)
  if (!normalizedTargetPath || !normalizedWorkspaceRoot) {
    return false
  }

  return normalizedTargetPath === normalizedWorkspaceRoot
    || normalizedTargetPath === getWorkspaceNodeDir(normalizedWorkspaceRoot)
    || new RegExp(`^${escapeRegExp(normalizedWorkspaceRoot)}/node/(?:runtime|cache)$`).test(normalizedTargetPath)
    || new RegExp(`^${escapeRegExp(normalizedWorkspaceRoot)}/users(?:/[^/]+(?:/(?:repos|projects|worktrees|runtime|cache))?)?$`).test(normalizedTargetPath)
    || new RegExp(`^${escapeRegExp(normalizedWorkspaceRoot)}/workspaces(?:/[^/]+(?:/(?:repos|projects|worktrees|cache|artifacts))?)?$`).test(normalizedTargetPath)
}
