/**
 * [INPUT]: Project, workspace, workspace-session, executor root, scope, and binding path hints.
 * [OUTPUT]: The repository or project directory valid for the session's current runtime executor.
 * [POS]: Server-side workspace filesystem path resolver shared by workspace control-plane flows.
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */
import type { Project, WorkspaceSession, Workspace, WorkspaceRecord } from '@shared/types'
import { resolveWorkspaceSessionExecutorId } from '@shared/task-workspace'
import { isPlaygroundProjectId } from '@shared/playground-workspace'
import {
  getWorkspacePlaygroundBaseDir,
  buildWorkspaceProjectRootPath,
  buildWorkspaceRepoPath,
  isManagedWorkspaceContainerPath,
  isManagedWorkspaceProjectPath,
  normalizeWorkspaceRoot,
} from '@shared/workspace-paths'

type WorkingDirectoryMode = 'worktree' | 'original-dir'

type WorkingDirectorySource = {
  workingDirectoryMode?: string | null
}

type WorkspaceScopeSource = {
  id?: string | null
  ownerUserId?: string | null
}

const resolveWorkingDirectoryMode = (
  project: Project,
  workspace?: WorkingDirectorySource | null,
  session?: WorkingDirectorySource | null,
): WorkingDirectoryMode => {
  if (project.versionControl === 'none') {
    return 'original-dir'
  }

  return session?.workingDirectoryMode === 'original-dir' || workspace?.workingDirectoryMode === 'original-dir'
    ? 'original-dir'
    : 'worktree'
}

export const resolveProjectRuntimeRootPath = (project: Project, workspaceRoot?: string, workspaceId?: string | null, ownerUserId?: string | null) => {
  // playground 无项目工作区：目录固定在 workspaces/<wid>/playground（cwd 由 workspace.repoPath 进一步到 <date>-<suffix> 子目录）
  if (isPlaygroundProjectId(project.id)) {
    return workspaceId ? getWorkspacePlaygroundBaseDir(workspaceRoot, workspaceId) : ''
  }
  const effectiveOwnerUserId = ownerUserId ?? project.createdById
  const rootPath = project.rootPath?.trim()
  if (
    rootPath
    && (project.versionControl !== 'none' || !isManagedWorkspaceProjectPath(rootPath, project, workspaceRoot, workspaceId ?? undefined, effectiveOwnerUserId ?? undefined))
  ) {
    return rootPath
  }

  return buildWorkspaceProjectRootPath(workspaceRoot, project, workspaceId ?? undefined, effectiveOwnerUserId ?? undefined)
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

export const remapManagedWorkspaceProjectPath = (workspaceRoot: string | undefined, rawPath?: string) => {
  const normalizedPath = (rawPath?.trim() || '').replace(/[\\/]+$/, '')
  const normalizedWorkspaceRoot = normalizeWorkspaceRoot(workspaceRoot)
  if (!normalizedPath || !normalizedWorkspaceRoot) {
    return rawPath?.trim() || undefined
  }
  if (normalizedPath === normalizedWorkspaceRoot) {
    return normalizedPath
  }

  const normalizedForMatch = normalizedPath.replace(/\\/g, '/')
  const normalizedRootForMatch = normalizedWorkspaceRoot.replace(/\\/g, '/')
  if (normalizedForMatch.startsWith(`${normalizedRootForMatch}/`)) {
    const remappedParts = remapManagedProjectParts(normalizedForMatch.slice(normalizedRootForMatch.length + 1).split('/').filter(Boolean))
    return remappedParts ? `${normalizedWorkspaceRoot}/${remappedParts.join('/')}` : normalizedPath
  }

  const match = normalizedForMatch.match(/(?:^|\/)\.(?:wemux|vibemux)(?:-[^/]+)?\/(.+)$/)
  if (!match) {
    return normalizedPath
  }

  const remappedParts = remapManagedProjectParts(match[1].split('/').filter(Boolean))
  return remappedParts ? `${normalizedWorkspaceRoot}/${remappedParts.join('/')}` : normalizedPath
}

const resolveAutoWorkspaceRepoPath = (project: Project, workspaceRoot?: string, workspaceId?: string | null, ownerUserId?: string | null) => {
  if (project.versionControl !== 'git-remote') {
    return undefined
  }

  const normalizedWorkspaceRoot = workspaceRoot?.trim()
  if (!normalizedWorkspaceRoot) {
    return undefined
  }

  return buildWorkspaceRepoPath(normalizedWorkspaceRoot, project, workspaceId ?? undefined, ownerUserId ?? undefined)
}

export const resolveWorkspaceRepoPath = (params: {
  project: Project
  workspaceRoot?: string
  workspace?: {
    id?: string | null
    executorNodeId?: string
    ownerUserId?: string | null
    repoPath?: string
    workingDirectoryMode?: string | null
  } | null
  session?: {
    workspaceId?: string | null
    executorNodeId?: string | null
    runtimeOwnerExecutorId?: string | null
    workingDirectoryMode?: string | null
  } | null
  workspaceScope?: WorkspaceScopeSource | string | null
  ownerUserId?: string | null
  bindingPathHint?: string | null
}) => {
  const workspaceId = typeof params.workspaceScope === 'string'
    ? params.workspaceScope
    : params.workspaceScope?.id ?? params.workspace?.id ?? params.session?.workspaceId
  const ownerUserId = typeof params.workspaceScope === 'string'
    ? params.ownerUserId ?? params.project.createdById
    : params.ownerUserId ?? params.workspaceScope?.ownerUserId ?? params.workspace?.ownerUserId ?? params.project.createdById
  const runtimeExecutorId = resolveWorkspaceSessionExecutorId(params.session) || params.workspace?.executorNodeId?.trim() || ''
  const workspaceExecutorId = params.workspace?.executorNodeId?.trim() || ''
  const workspaceRepoPathMatchesRuntimeExecutor = !workspaceExecutorId || !runtimeExecutorId || workspaceExecutorId === runtimeExecutorId
  const runtimeRootPath = params.project.versionControl === 'none' && !workspaceRepoPathMatchesRuntimeExecutor
    ? buildWorkspaceProjectRootPath(params.workspaceRoot, params.project, workspaceId ?? undefined, ownerUserId ?? undefined)
    : resolveProjectRuntimeRootPath(params.project, params.workspaceRoot, workspaceId, ownerUserId)
  const rawWorkspaceRepoPath = params.workspace?.repoPath?.trim()
  const rawBindingPathHint = params.bindingPathHint?.trim() || undefined
  const scopedBindingPathHint = params.project.versionControl !== 'git-remote'
    && isManagedWorkspaceProjectPath(rawBindingPathHint, params.project, params.workspaceRoot, workspaceId ?? undefined, ownerUserId ?? undefined)
    ? buildWorkspaceProjectRootPath(params.workspaceRoot, params.project, workspaceId ?? undefined, ownerUserId ?? undefined)
    : rawBindingPathHint
  const workspaceRepoPathCandidate = workspaceRepoPathMatchesRuntimeExecutor ? rawWorkspaceRepoPath : undefined
  const workspaceRepoPath = params.project.versionControl === 'git-remote'
    && isManagedWorkspaceContainerPath(workspaceRepoPathCandidate, params.workspaceRoot)
    ? undefined
    : workspaceRepoPathCandidate
  const bindingPathHint = params.project.versionControl === 'git-remote'
    ? undefined
    : scopedBindingPathHint
  const workingDirectoryMode = resolveWorkingDirectoryMode(params.project, params.workspace, params.session)
  const autoWorkspaceRepoPath = resolveAutoWorkspaceRepoPath(params.project, params.workspaceRoot, workspaceId, ownerUserId)

  if (workingDirectoryMode === 'original-dir') {
    if (params.project.versionControl === 'git-remote') {
      return autoWorkspaceRepoPath
        || workspaceRepoPath
        || undefined
    }

    return bindingPathHint
      || workspaceRepoPath
      || runtimeRootPath
      || undefined
  }

  if (params.project.versionControl === 'git-remote') {
    return autoWorkspaceRepoPath
      || workspaceRepoPath
      || undefined
  }

  return workspaceRepoPath
    || runtimeRootPath
    || bindingPathHint
    || undefined
}
