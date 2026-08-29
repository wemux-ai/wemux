// [INPUT]: executor 仓库准备请求（项目绑定/repoUrl/探测）
// [OUTPUT]: clone/fetch/探测执行与响应
// [POS]: 仓库准备服务（server 侧驱动 worker）
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import type { LocalPathProbeResult, Project, RepoBranchSnapshotResult, TaskRuntimeGitIdentity, Workspace } from '@shared/types'
import { buildWorkspaceRepoPath } from '@shared/workspace-paths'
import { listVisibleExecutorsForUser } from './collaboration'
import { executorWsService } from './executor-ws-service'
import { listProjectBindings, upsertProjectBinding } from '../storage/distributed-task-store'
import { saveProject } from '../storage/app-state-store'
import { buildProjectBinding } from '../routes/shared'
import { resolveUserProjectGitIdentity } from './task-git-identity'
import { resolveProjectRuntimeRootPath, resolveWorkspaceRepoPath } from '../services/workspace-repo-path'

const DEFAULT_BRANCH = 'main'
const PROJECT_VERSION_CONTROL_REFRESH_TTL_MS = 30_000
const scheduledProjectVersionControlRefreshes = new Map<string, { lastStartedAt: number; inFlight: Promise<void> | null }>()

const buildUnavailableResult = (preferredBranch?: string, message?: string): RepoBranchSnapshotResult => ({
  ok: false,
  branches: [],
  defaultBranch: preferredBranch?.trim() || DEFAULT_BRANCH,
  message: message || '执行器侧仓库尚未准备好，无法读取分支列表。',
})

const requestBranches = async (
  executorId: string,
  repoPath: string,
  repoUrl: string | undefined,
  preferredBranch?: string,
  gitIdentity?: TaskRuntimeGitIdentity,
): Promise<RepoBranchSnapshotResult> => {
  try {
    return await executorWsService.requestRepoBranches(executorId, repoPath, repoUrl, preferredBranch, gitIdentity)
  } catch (error) {
    return buildUnavailableResult(preferredBranch, error instanceof Error ? error.message : '读取分支列表失败。')
  }
}

const persistPreparedBinding = (project: Project, executorId: string, repoPath: string, defaultBranch: string) => {
  upsertProjectBinding({
    ...buildProjectBinding(project, executorId, repoPath),
    defaultBranch,
  })
}

const resolveAutoRepoPath = (workspaceRoot: string | undefined, project: Project, workspaceId?: string, ownerUserId?: string) => {
  if (!workspaceRoot?.trim()) {
    return ''
  }

  return buildWorkspaceRepoPath(workspaceRoot, project, workspaceId, ownerUserId)
}

const resolveGitIdentitySafely = async (userId: string, project: Project) => {
  try {
    return await resolveUserProjectGitIdentity({
      userId,
      projectId: project.id,
      mode: 'personal',
      repoUrl: project.gitUrl,
    })
  } catch (error) {
    console.warn('[executor-repo-service] failed to load git identity, continuing without credentials', error)
    return undefined
  }
}

const resolveCurrentVersionControl = (project: Project) => project.versionControl ?? (project.gitUrl.trim() ? 'git-remote' : 'none')

const mergeDetectedDefaultBranch = (project: Project, defaultBranch: string) => {
  const normalizedDefaultBranch = defaultBranch.trim() || DEFAULT_BRANCH
  return [
    normalizedDefaultBranch,
    ...(project.recentBaseBranches ?? []).map((branch) => branch.trim()).filter(Boolean).filter((branch) => branch !== normalizedDefaultBranch),
  ].slice(0, 8)
}

export const resolveProjectVersionControlFromProbeResult = (project: Project, result: LocalPathProbeResult): Project | null => {
  const detectedVersionControl = result.versionControl
  if (!result.ok || !detectedVersionControl) {
    return null
  }

  const currentVersionControl = resolveCurrentVersionControl(project)
  const detectedGitUrl = detectedVersionControl === 'git-remote'
    ? (result.gitUrl?.trim() || project.gitUrl.trim())
    : (
        currentVersionControl === 'git-remote' && detectedVersionControl === 'none'
          ? ''
          : project.gitUrl.trim()
      )
  const detectedDefaultBranch = result.defaultBranch?.trim() || project.defaultBranch?.trim() || DEFAULT_BRANCH
  const nextProject: Project = {
    ...project,
    rootPath: result.path?.trim() || project.rootPath,
    versionControl: detectedVersionControl,
    gitUrl: detectedGitUrl,
    defaultBranch: detectedDefaultBranch,
    recentBaseBranches: mergeDetectedDefaultBranch(project, detectedDefaultBranch),
    updatedAt: new Date().toISOString(),
  }

  const changed = nextProject.rootPath !== project.rootPath
    || nextProject.versionControl !== project.versionControl
    || nextProject.gitUrl !== project.gitUrl
    || nextProject.defaultBranch !== project.defaultBranch
    || (nextProject.recentBaseBranches ?? []).join('\u0000') !== (project.recentBaseBranches ?? []).join('\u0000')

  return changed ? nextProject : project
}

const buildProbeExecutorIds = (userId: string, project: Project, executorId?: string) => {
  const visibleExecutors = listVisibleExecutorsForUser(userId)
  const visibleExecutorIds = new Set(visibleExecutors.map((executor) => executor.executorId))
  const requestedExecutorId = executorId?.trim()
  if (requestedExecutorId) {
    return visibleExecutorIds.has(requestedExecutorId) ? [requestedExecutorId] : []
  }

  const preferredIds = [
    project.preferredExecutorId?.trim(),
  ].filter((value): value is string => Boolean(value))

  return [
    ...preferredIds.filter((value, index) => visibleExecutorIds.has(value) && preferredIds.indexOf(value) === index),
    ...visibleExecutors.map((executor) => executor.executorId).filter((value) => !preferredIds.includes(value)),
  ]
}

export const buildProjectVersionControlProbePaths = (project: Pick<Project, 'rootPath'>, candidatePaths?: Array<string | undefined | null>) => {
  const paths = [
    project.rootPath,
    ...(candidatePaths ?? []),
  ].map((value) => value?.trim() || '').filter(Boolean)

  return paths.filter((value, index) => paths.indexOf(value) === index)
}

export const refreshProjectVersionControlFromExecutor = async (
  userId: string,
  project: Project,
  executorId?: string,
  candidatePaths?: Array<string | undefined | null>,
) => {
  const probePaths = buildProjectVersionControlProbePaths(project, candidatePaths)
  if (probePaths.length === 0) {
    return project
  }

  const currentVersionControl = resolveCurrentVersionControl(project)
  const probeExecutorIds = buildProbeExecutorIds(userId, project, executorId)

  for (const probeExecutorId of probeExecutorIds) {
    for (const probePath of probePaths) {
      try {
        const result = await executorWsService.requestRepoProbe(probeExecutorId, probePath)
        const nextProject = resolveProjectVersionControlFromProbeResult(project, result)
        if (!nextProject) {
          continue
        }
        if (nextProject === project) {
          if (result.versionControl === 'none') {
            continue
          }
          return project
        }

        saveProject(nextProject)
        return nextProject
      } catch {
        continue
      }
    }
  }

  return project
}

export const scheduleProjectVersionControlRefreshFromExecutor = (userId: string, project: Project, executorId?: string) => {
  const rootPath = project.rootPath?.trim()
  if (!rootPath) {
    return
  }

  const key = [userId, project.id, executorId?.trim() || '', rootPath].join(':')
  const now = Date.now()
  const existing = scheduledProjectVersionControlRefreshes.get(key)
  if (existing?.inFlight || (existing && now - existing.lastStartedAt < PROJECT_VERSION_CONTROL_REFRESH_TTL_MS)) {
    return
  }

  const inFlight = refreshProjectVersionControlFromExecutor(userId, project, executorId)
    .catch((error) => {
      console.warn('[executor-repo-service] background project version control refresh failed', JSON.stringify({
        projectId: project.id,
        executorId: executorId?.trim() || null,
        error: error instanceof Error ? error.message : 'unknown',
      }))
    })
    .then(() => undefined)
    .finally(() => {
      const current = scheduledProjectVersionControlRefreshes.get(key)
      if (current?.inFlight === inFlight) {
        scheduledProjectVersionControlRefreshes.set(key, {
          lastStartedAt: current.lastStartedAt,
          inFlight: null,
        })
      }
    })

  scheduledProjectVersionControlRefreshes.set(key, { lastStartedAt: now, inFlight })
}

export const getWorkspaceBranchSnapshotFromExecutor = async (
  userId: string,
  project: Project,
  workspace: Workspace,
  executorNodeId = workspace.executorNodeId,
  options?: {
    repoPathOverride?: string
  },
): Promise<RepoBranchSnapshotResult> => {
  const effectiveProject = await refreshProjectVersionControlFromExecutor(userId, project, executorNodeId)
  const preferredBranch = workspace.defaultBranch || effectiveProject.defaultBranch || DEFAULT_BRANCH
  if (effectiveProject.versionControl === 'none') {
    return buildUnavailableResult(preferredBranch, '当前项目未启用 Git。')
  }

  const visibleExecutors = listVisibleExecutorsForUser(userId)
  const visibleExecutorIds = new Set(visibleExecutors.map((executor) => executor.executorId))

  if (!executorNodeId) {
    return buildUnavailableResult(preferredBranch, `工作区 ${workspace.name} 还没有绑定执行器，无法读取分支。`)
  }

  if (!visibleExecutorIds.has(executorNodeId)) {
    return buildUnavailableResult(preferredBranch, `工作区 ${workspace.name} 当前绑定的执行器不可见或无权限访问。`)
  }

  const executor = visibleExecutors.find((item) => item.executorId === executorNodeId)
  const repoPathOverride = options?.repoPathOverride?.trim()
  const repoPath = repoPathOverride
    || resolveWorkspaceRepoPath({
      project: effectiveProject,
      workspaceRoot: executor?.workspaceRoot,
      workspace,
      ownerUserId: workspace.ownerUserId ?? userId,
      bindingPathHint: listProjectBindings().find((binding) => binding.projectId === effectiveProject.id && binding.nodeId === executorNodeId && binding.isActive)?.pathHint,
    })
    || (effectiveProject.versionControl === 'git-local' ? resolveProjectRuntimeRootPath(effectiveProject, executor?.workspaceRoot, workspace.id, workspace.ownerUserId ?? userId) : '')
    || resolveAutoRepoPath(executor?.workspaceRoot, effectiveProject, workspace.id, workspace.ownerUserId ?? userId)

  if (!repoPath) {
    return buildUnavailableResult(preferredBranch, `工作区 ${workspace.name} 还没有绑定执行器侧仓库目录，无法读取分支。`)
  }

  const gitIdentity = await resolveGitIdentitySafely(userId, effectiveProject)
  const repoUrl = repoPathOverride ? undefined : effectiveProject.gitUrl?.trim() || undefined
  const snapshot = await requestBranches(executorNodeId, repoPath, repoUrl, preferredBranch, gitIdentity)
  if (snapshot.ok && !repoPathOverride) {
    persistPreparedBinding(effectiveProject, executorNodeId, repoPath, snapshot.defaultBranch || preferredBranch)
  }
  return snapshot
}

export const getProjectBranchSnapshotFromExecutor = async (userId: string, project: Project, executorId?: string): Promise<RepoBranchSnapshotResult> => {
  const effectiveProject = await refreshProjectVersionControlFromExecutor(userId, project, executorId)
  const preferredBranch = effectiveProject.defaultBranch || DEFAULT_BRANCH
  if (effectiveProject.versionControl === 'none') {
    return buildUnavailableResult(preferredBranch, '当前项目未启用 Git。')
  }

  const visibleExecutors = listVisibleExecutorsForUser(userId)
  const visibleExecutorIds = new Set(visibleExecutors.map((executor) => executor.executorId))
  const bindings = listProjectBindings()
    .filter((binding) => binding.projectId === effectiveProject.id && binding.isActive)
    .filter((binding) => visibleExecutorIds.has(binding.nodeId))

  const requestedExecutorId = executorId?.trim()
  if (requestedExecutorId && !visibleExecutorIds.has(requestedExecutorId)) {
    return buildUnavailableResult(preferredBranch, `当前选择的执行器不可见或无权限访问。`)
  }

  const preferredBinding = effectiveProject.preferredExecutorId
    ? bindings.find((binding) => binding.nodeId === effectiveProject.preferredExecutorId)
    : undefined
  const selectedBinding = requestedExecutorId
    ? bindings.find((binding) => binding.nodeId === requestedExecutorId)
    : preferredBinding ?? bindings[0]

  const selectedExecutorId = requestedExecutorId || selectedBinding?.nodeId || effectiveProject.preferredExecutorId || visibleExecutors[0]?.executorId
  if (!selectedExecutorId) {
    return buildUnavailableResult(preferredBranch, `项目 ${project.name} 还没有可用的执行节点，无法读取分支。`)
  }

  const executor = visibleExecutors.find((item) => item.executorId === selectedExecutorId)
  const repoPath = effectiveProject.versionControl === 'git-remote'
    ? resolveAutoRepoPath(executor?.workspaceRoot, effectiveProject, undefined, userId)
    : selectedBinding?.pathHint?.trim()
      || (effectiveProject.versionControl === 'git-local' ? resolveProjectRuntimeRootPath(effectiveProject, executor?.workspaceRoot, undefined, userId) : '')
      || resolveAutoRepoPath(executor?.workspaceRoot, effectiveProject, undefined, userId)

  if (!repoPath) {
    return buildUnavailableResult(preferredBranch, `项目 ${project.name} 在所选执行节点上还没有可用的仓库目录，无法读取分支。`)
  }

  const gitIdentity = await resolveGitIdentitySafely(userId, effectiveProject)
  const snapshot = await requestBranches(selectedExecutorId, repoPath, effectiveProject.gitUrl?.trim() || undefined, preferredBranch, gitIdentity)
  if (snapshot.ok) {
    persistPreparedBinding(effectiveProject, selectedExecutorId, repoPath, snapshot.defaultBranch || preferredBranch)
  }
  return snapshot
}
