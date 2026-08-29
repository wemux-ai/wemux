/**
 * [INPUT]: Workspace, workspace-session, project, executor, and path hints from control-plane state.
 * [OUTPUT]: The effective executor and filesystem paths used by workspace file and terminal surfaces.
 * [POS]: Web-side workspace-session runtime projection; session executor ownership overrides workspace defaults.
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */
import type { ExecutorRecord, Project, WorkspaceSession, Workspace } from '@shared/types'
import { resolveWorkspaceSessionExecutorId, resolveWorkspaceWorkerId } from '@shared/task-workspace'
import { isManagedWorkspaceContainerPath, isManagedWorkspaceProjectPath } from '@shared/workspace-paths'
import { buildWorkspaceProjectRootPath, buildWorkspaceRepoPath, buildWorkspaceWorktreePath, normalizeWorkspaceRoot } from './workspace-paths'

export type WorkspaceRuntimeRepoPathSource = 'binding' | 'workspace-record' | 'default-repo' | 'project-root'

type WorkspaceSessionRuntimeParams = {
  bindingPathHint?: string
  defaultWorkspaceRoot?: string
  executors: ExecutorRecord[]
  project: Pick<Project, 'gitUrl' | 'id' | 'name' | 'rootPath' | 'versionControl'>
  workspace: Pick<Workspace, 'executorName' | 'executorNodeId' | 'id' | 'ownerUserId' | 'repoPath' | 'workingDirectoryMode'>
  workspaceSession?: Pick<WorkspaceSession, 'executorNodeId' | 'runtimeOwnerExecutorId' | 'workingDirectoryMode' | 'worktreeId' | 'worktreeStatus'> | null
}

const pushUnique = (items: string[], value?: string) => {
  const normalized = value?.trim()
  if (!normalized || items.includes(normalized)) {
    return
  }

  items.push(normalized)
}

export const resolveWorkspaceSessionRuntime = (params: WorkspaceSessionRuntimeParams) => {
  const workspaceExecutorId = resolveWorkspaceWorkerId(params.workspace)
  const executorId = resolveWorkspaceSessionExecutorId(params.workspaceSession) || workspaceExecutorId
  const executor = executorId
    ? params.executors.find((item) => item.executorId === executorId) ?? null
    : null
  const workspaceRoot = normalizeWorkspaceRoot(executor?.workspaceRoot?.trim() || params.defaultWorkspaceRoot?.trim() || undefined)
  const bindingPathHint = params.bindingPathHint?.trim() || undefined
  const rawWorkspaceRepoPath = params.workspace.repoPath?.trim() || undefined
  const legacyProjectRootPath = params.project.rootPath?.trim() || undefined
  const workspaceRepoPathMatchesRuntimeExecutor = !workspaceExecutorId || workspaceExecutorId === executorId
  const workingDirectoryMode = params.project.versionControl === 'none'
    || params.workspaceSession?.workingDirectoryMode === 'original-dir'
    || params.workspace.workingDirectoryMode === 'original-dir'
    ? 'original-dir'
    : 'worktree'
  const runtimeRootPath = params.project.versionControl === 'none'
    && (!workspaceRepoPathMatchesRuntimeExecutor || isManagedWorkspaceProjectPath(legacyProjectRootPath, params.project, workspaceRoot, params.workspace.id, params.workspace.ownerUserId))
    ? buildWorkspaceProjectRootPath(workspaceRoot, params.project, params.workspace.id, params.workspace.ownerUserId)
    : legacyProjectRootPath || buildWorkspaceProjectRootPath(workspaceRoot, params.project, params.workspace.id, params.workspace.ownerUserId)
  const normalizedBindingPathHint = params.project.versionControl === 'git-remote'
    ? undefined
    : isManagedWorkspaceProjectPath(bindingPathHint, params.project, workspaceRoot, params.workspace.id, params.workspace.ownerUserId)
      ? buildWorkspaceProjectRootPath(workspaceRoot, params.project, params.workspace.id, params.workspace.ownerUserId)
      : bindingPathHint
  const workspaceRepoPathCandidate = params.project.versionControl === 'none' && isManagedWorkspaceProjectPath(rawWorkspaceRepoPath, params.project, workspaceRoot, params.workspace.id, params.workspace.ownerUserId)
    ? buildWorkspaceProjectRootPath(workspaceRoot, params.project, params.workspace.id, params.workspace.ownerUserId)
    : workspaceRepoPathMatchesRuntimeExecutor
      ? rawWorkspaceRepoPath
      : undefined
  const workspaceRepoPath = params.project.versionControl === 'git-remote'
    && isManagedWorkspaceContainerPath(workspaceRepoPathCandidate, workspaceRoot)
    ? undefined
    : workspaceRepoPathCandidate
  const autoWorkspaceRepoPath = params.project.versionControl === 'git-remote'
    ? buildWorkspaceRepoPath(workspaceRoot, params.project, params.workspace.id, params.workspace.ownerUserId)
    : undefined
  const currentExecutorWorkspaceRepoPath = workspaceRepoPath
    && workspaceRepoPath !== legacyProjectRootPath
    && workspaceRepoPathMatchesRuntimeExecutor
    ? workspaceRepoPath
    : undefined

  let repoPath: string | undefined
  let repoPathSource: WorkspaceRuntimeRepoPathSource | undefined
  const pickRepoPath = (value: string | undefined, source: WorkspaceRuntimeRepoPathSource) => {
    if (!value || repoPath) {
      return
    }

    repoPath = value
    repoPathSource = source
  }

  if (workingDirectoryMode === 'original-dir') {
    if (params.project.versionControl === 'git-remote') {
      pickRepoPath(normalizedBindingPathHint, 'binding')
      pickRepoPath(autoWorkspaceRepoPath, 'default-repo')
      pickRepoPath(currentExecutorWorkspaceRepoPath, 'workspace-record')
      pickRepoPath(workspaceRepoPath, 'workspace-record')
    } else {
      pickRepoPath(normalizedBindingPathHint, 'binding')
      pickRepoPath(workspaceRepoPath, 'workspace-record')
      pickRepoPath(runtimeRootPath, 'project-root')
    }
  } else if (params.project.versionControl === 'git-remote') {
    pickRepoPath(normalizedBindingPathHint, 'binding')
    pickRepoPath(autoWorkspaceRepoPath, 'default-repo')
    pickRepoPath(currentExecutorWorkspaceRepoPath, 'workspace-record')
    pickRepoPath(workspaceRepoPath, 'workspace-record')
  } else {
    pickRepoPath(workspaceRepoPath, 'workspace-record')
    pickRepoPath(legacyProjectRootPath, 'project-root')
    pickRepoPath(normalizedBindingPathHint, 'binding')
  }

  let terminalTargetCwd: string | undefined
  if (params.workspaceSession?.worktreeStatus !== 'cleaned') {
    if (!params.workspaceSession) {
      terminalTargetCwd = undefined
    } else if (workingDirectoryMode === 'original-dir') {
      terminalTargetCwd = repoPath || workspaceRoot
    } else if (params.workspaceSession.worktreeId?.trim()) {
      terminalTargetCwd = buildWorkspaceWorktreePath(
        workspaceRoot,
        params.project,
        params.workspaceSession.worktreeId,
        params.workspace.id,
        params.workspace.ownerUserId,
      )
    }
  }

  const terminalFallbackCwd = repoPath || workspaceRoot
  const terminalCwd = terminalTargetCwd || terminalFallbackCwd
  let fileExplorerRootPath: string | undefined
  const pickFileExplorerRootPath = (value: string | undefined) => {
    if (!value || fileExplorerRootPath) {
      return
    }

    fileExplorerRootPath = value
  }
  pickFileExplorerRootPath(terminalTargetCwd)
  pickFileExplorerRootPath(repoPath)
  pickFileExplorerRootPath(autoWorkspaceRepoPath)
  pickFileExplorerRootPath(runtimeRootPath)
  pickFileExplorerRootPath(workspaceRoot)
  pickFileExplorerRootPath(params.defaultWorkspaceRoot?.trim() || undefined)
  const candidateCwds: string[] = []
  pushUnique(candidateCwds, terminalTargetCwd)
  pushUnique(candidateCwds, repoPath)
  pushUnique(candidateCwds, autoWorkspaceRepoPath)
  pushUnique(candidateCwds, runtimeRootPath)
  pushUnique(candidateCwds, workspaceRoot)
  pushUnique(candidateCwds, params.defaultWorkspaceRoot)

  return {
    candidateCwds,
    executor,
    executorId,
    executorName: executor?.name || params.workspace.executorName,
    fileExplorerRootPath,
    repoPath,
    repoPathSource,
    terminalCwd,
    terminalFallbackCwd,
    terminalTargetCwd,
    workspaceRoot,
  }
}
