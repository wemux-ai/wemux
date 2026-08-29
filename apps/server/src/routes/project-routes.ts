/**
 * [INPUT]: Authenticated project, assignment, runtime, repository, and main-chat requests.
 * [OUTPUT]: Project control-plane HTTP routes, creator-attributed AI-confirmed tasks, and scoped state mutations.
 * [POS]: Project route composition; repository execution remains delegated to workers.
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */
import { mkdirSync } from 'node:fs'
import type { Hono, MiddlewareHandler } from 'hono'
import { isManagedCloudAutoExecutorId } from '@shared/managed-cloud'
import { mergeImportedProjectEnvironmentTemplate } from '@shared/project-environment-template'
import { validateProjectEnvironmentPreviewPorts } from '@shared/types'
import { resolveGitRemoteHost } from '@shared/git-auth'
import { buildWorkspaceProjectRootPath } from '@shared/workspace-paths'
import { resolveMainChatSessionAccess } from '../control-plane/conversation-access'
import { setMainChatSessionPinned } from '@shared/main-chat-session'
import { isCustomAgentEnabled, readCustomAgentConfig } from '@shared/custom-agent'
import { deriveProjectColor, normalizeHexColor } from '@shared/project-color'
import { buildDisplayOrderPatch, resolveNextDisplayOrder, sortProjectsByDisplayOrder } from '@shared/project-workspace-order'
import type { AppState, TaskProposal } from '@shared/types'
import { z } from 'zod'
import { createTaskFromRequirement, deriveExecutionCenter } from '@shared/task-orchestrator'
import { canUserUseExecutorForProject, listVisibleExecutorsForUser } from '../control-plane/collaboration'
import { detectProjectEnvironmentTemplate } from '../control-plane/project-environment-service'
import { getProjectBranchSnapshotFromExecutor, refreshProjectVersionControlFromExecutor } from '../control-plane/executor-repo-service'
import { checkLocalPath, pickFolder } from '../integrations/git/service'
import { getAllAgents } from '../repositories/agent'
import { addUserProject, addUserProjectAndWait, getProjectAssignees, getUserById, removeTeamProject, removeUserProject, removeUserProjectAndWait } from '../repositories/auth'
import { generateProjectContext, getProjectsWithContext } from '../repositories/project-selector'
import { getGitCredentialById, normalizeGitCredentialHost } from '../services/git-credential-store'
import { getGitHubAppInstallationById, getGitHubAppInstallationForUser, isGitHubAppInstallationAccessibleToUser } from '../services/github-app-installation-store'
import { hasInvalidManagedScopePlaceholder, resolveDefaultLocalProjectRootPath, resolveManagedPath } from '../services/local-project-root'
import { getManagedCloudGate } from '../services/gate/managed-cloud-gate'
import { saveProjectGitCredentialBinding, saveProjectGitHubAppInstallationBinding } from '../services/project-git-binding-store'
import { deleteProjectRootDirectory } from '../services/project-delete-service'
import { autoImportProjectRuntimeEnvironment, summarizeProjectRuntimeEnvironmentImport } from '../services/project-runtime-environment-import-service'
import { materializeProjectRuntimeEnvironmentFile } from '../services/runtime-environment-file-materialization'
import { getProjectRuntimeEnvironmentConfigForProject } from '../services/runtime-environment-service'
import { stopMainChatExecution } from '../services/main-chat-runtime-state'
import { listActiveAgentEventTaskIds } from '../services/agent-event-runtime'
import { resolveCustomAgentProjectAccess } from '../services/task-agent-assignment-service'
import { deleteProject, loadState, saveProject, saveProjectAndWait, saveProjectWorkspaceAssignment, saveTask } from '../storage/app-state-store'
import { deactivateProjectBinding, listProjectBindings, listWorkspaces, upsertProjectBinding } from '../storage/distributed-task-store'
import { aiChatSchema, buildProjectBinding, ensureWorkspaceMember, getAuthorizedProject, getScopedState, getUserIdFromHeader, jsonError, pathSchema, publishState, taskModelSchema, withClusterState, withState } from './shared'
import { appendMainChatDriveAttachment, appendMainChatTextMessage, clearTaskProposalFromChat, createMainChatSession, ensureMainChatState, loadMainChatModelOptions, runMainChatResponse, streamMainChatResponse, switchMainChatSession, validateMainChatModel } from './project-main-chat'
import { buildDriveReferenceAttachment } from './drive-routes'
import { clearMainChatLegacyRuntimeSessionIds, resolveNewMainChatSessionDefaults } from './project-main-chat-session'
import { cloneWithExecutorSchema, createProjectRecord, mergeProjectEnvironmentTemplateUpdate, normalizeProjectEnvironmentTemplate, normalizeRecentBaseBranches, prepareClonedProject, projectBranchesQuerySchema, projectWithExecutorSchema } from './project-route-shared'
import { resolveUserCreatorIdentity } from './task-route-support'
import { getCommercialGate } from '../services/gate/commercial-gate'

const mainChatExecutorSchema = z.object({
  executorId: z.string().trim().optional(),
})

const mainChatAgentSchema = z.object({
  customAgentId: z.string().trim().min(1),
})

const mainChatTitleSchema = z.object({
  title: z.string().trim().min(1),
})

const mainChatPinSchema = z.object({
  pinned: z.boolean(),
})

const projectReorderSchema = z.object({
  orderedProjectIds: z.array(z.string().trim().min(1)).min(1),
})

const deleteProjectSchema = z.object({
  projectName: z.string().trim().min(1),
  deleteProjectDirectory: z.boolean().optional(),
})

const mergeProjectMessageWithDetail = (message: string, detail: string) => {
  return detail ? `${message} ${detail}` : message
}

const summarizeProjectDeletionMessage = (params: {
  deleteProjectDirectory?: boolean
  deleteProjectDirectoryResult: Awaited<ReturnType<typeof deleteProjectRootDirectory>> | null
  deleteProjectDirectoryErrorMessage?: string
}) => {
  if (!params.deleteProjectDirectory) {
    return '项目已删除。'
  }

  if (params.deleteProjectDirectoryErrorMessage) {
    return `项目已删除。项目目录删除失败，已跳过目录删除：${params.deleteProjectDirectoryErrorMessage}`
  }

  return params.deleteProjectDirectoryResult?.deleted
    ? '项目及项目目录已删除。'
    : `项目已删除。${params.deleteProjectDirectoryResult?.message ?? '项目目录已跳过删除。'}`
}

const ensureDefaultLocalProjectDirectory = (rootPath: string) => {
  const resolvedRootPath = resolveManagedPath(rootPath)
  if (!resolvedRootPath) {
    return
  }

  mkdirSync(resolvedRootPath, { recursive: true })
}

const resolveInitialGitCredential = async (params: {
  userId: string
  credentialId?: string
  githubInstallationId?: number
  githubRepositoryId?: number
  githubRepositoryName?: string
  repoUrl?: string
}) => {
  const credentialId = params.credentialId?.trim()
  const githubInstallationId = params.githubInstallationId

  if (credentialId && githubInstallationId) {
    return { ok: false as const, status: 400 as const, message: '请只选择一种 Git 授权来源。' }
  }

  if (githubInstallationId) {
    const linkedInstallation = await getGitHubAppInstallationForUser(params.userId, githubInstallationId)
    const installation = linkedInstallation ?? await getGitHubAppInstallationById(githubInstallationId)
    if (!installation) {
      return { ok: false as const, status: 404 as const, message: 'GitHub App installation 不存在，或不属于当前用户。' }
    }
    if (!linkedInstallation && !(await isGitHubAppInstallationAccessibleToUser(params.userId, githubInstallationId))) {
      return { ok: false as const, status: 404 as const, message: 'GitHub App installation 不存在，或不属于当前用户。' }
    }

    const repoHost = resolveGitRemoteHost(params.repoUrl)
    if (repoHost && normalizeGitCredentialHost(installation.providerHost) !== normalizeGitCredentialHost(repoHost)) {
      return { ok: false as const, status: 400 as const, message: '所选 GitHub App installation 与仓库 Host 不匹配。' }
    }

    return {
      ok: true as const,
      credentialId: undefined,
      githubInstallationId: installation.installationId,
      githubRepositoryId: params.githubRepositoryId,
      githubRepositoryName: params.githubRepositoryName?.trim() || undefined,
      githubAccountLogin: installation.accountLogin,
      githubAccountType: installation.accountType,
      providerHost: installation.providerHost,
    }
  }

  if (!credentialId) {
    return { ok: true as const, credentialId: undefined, githubInstallationId: undefined }
  }

  const credential = await getGitCredentialById(params.userId, credentialId)
  if (!credential) {
    return { ok: false as const, status: 404 as const, message: 'Git 身份不存在，或不属于当前用户。' }
  }

  const repoHost = resolveGitRemoteHost(params.repoUrl)
  if (repoHost && normalizeGitCredentialHost(credential.host) !== normalizeGitCredentialHost(repoHost)) {
    return { ok: false as const, status: 400 as const, message: '所选 Git 身份与仓库 Host 不匹配，请选择同一 Host 的凭证。' }
  }

  return { ok: true as const, credentialId: credential.id, githubInstallationId: undefined }
}

const validateProjectWorkspaceAccess = async (params: {
  userId: string
  workspaceId?: string
  visibility?: 'private' | 'workspace'
}) => {
  const workspaceId = params.workspaceId?.trim()
  const visibility = params.visibility ?? 'private'

  if (visibility === 'workspace' && !workspaceId) {
    return { ok: false as const, status: 400 as const, message: '工作区共享项目必须选择 workspace。' }
  }

  if (!workspaceId) {
    return { ok: true as const, workspaceId: undefined, visibility }
  }

  if (!(await ensureWorkspaceMember(workspaceId, params.userId))) {
    return { ok: false as const, status: 403 as const, message: '无权限使用该 workspace。' }
  }

  return { ok: true as const, workspaceId, visibility }
}

const resolveProjectWorkspaceAccessUpdate = async (params: {
  userId: string
  project: Pick<AppState['projects'][number], 'workspaceId' | 'visibility'>
  workspaceId?: string
  visibility?: 'private' | 'workspace'
}) => {
  const currentWorkspaceId = params.project.workspaceId?.trim()
  const nextWorkspaceId = params.workspaceId === undefined ? currentWorkspaceId : params.workspaceId.trim()
  const currentVisibility = params.project.visibility ?? 'private'
  const nextVisibility = params.visibility ?? currentVisibility

  if (nextWorkspaceId === currentWorkspaceId && nextVisibility === currentVisibility) {
    return { ok: true as const, workspaceId: nextWorkspaceId || undefined, visibility: nextVisibility }
  }

  return validateProjectWorkspaceAccess({
    userId: params.userId,
    workspaceId: nextWorkspaceId,
    visibility: nextVisibility,
  })
}

const publishProjectCloneState = async () => {
  await publishState(withClusterState(loadState()))
}

const resolvePreparedProjectBindingPath = (projectId: string, executorId?: string) => {
  const normalizedExecutorId = executorId?.trim()
  const activeBindings = listProjectBindings().filter((binding) => binding.projectId === projectId && binding.isActive)
  const matchingBinding = normalizedExecutorId
    ? activeBindings.find((binding) => binding.nodeId === normalizedExecutorId)
    : activeBindings[0]

  return matchingBinding?.pathHint?.trim() || undefined
}

export const resolveProjectSettingsSyncProbePaths = (
  project: Pick<AppState['projects'][number], 'id' | 'name' | 'gitUrl'>,
  executorId?: string,
  ownerUserId?: string,
) => {
  const normalizedExecutorId = executorId?.trim()
  const visibleExecutors = listVisibleExecutorsForUser(ownerUserId ?? '').filter((executor) => {
    return !normalizedExecutorId || executor.executorId === normalizedExecutorId
  })
  const paths = [
    ...listProjectBindings()
      .filter((binding) => binding.projectId === project.id && binding.isActive)
      .filter((binding) => !normalizedExecutorId || binding.nodeId === normalizedExecutorId)
      .map((binding) => binding.pathHint),
    ...listWorkspaces()
      .filter((workspace) => workspace.projectId === project.id)
      .filter((workspace) => !normalizedExecutorId || workspace.executorNodeId === normalizedExecutorId)
      .map((workspace) => workspace.repoPath),
    ...visibleExecutors.map((executor) => (
      buildWorkspaceProjectRootPath(executor.workspaceRoot, project, undefined, executor.ownerUserId || ownerUserId)
    )),
  ].map((value) => value?.trim() || '').filter(Boolean)

  return paths.filter((value, index) => paths.indexOf(value) === index)
}

const summarizeSyncParts = (parts: string[]) => {
  const normalized = parts.map((part) => part.trim()).filter(Boolean)
  return normalized.length > 0 ? normalized.join(' ') : '项目设置已同步。'
}

const detectProjectEnvironmentTemplateForImport = async (params: {
  project: AppState['projects'][number]
  preferredExecutorId?: string
}) => {
  const preferredExecutorId = params.preferredExecutorId?.trim() || params.project.preferredExecutorId?.trim() || ''
  const candidateTargets = [
    {
      rootPath: params.project.rootPath,
      executorId: preferredExecutorId || undefined,
      repoPath: params.project.rootPath,
    },
    ...listProjectBindings()
      .filter((binding) => binding.projectId === params.project.id && binding.isActive)
      .filter((binding) => !preferredExecutorId || binding.nodeId === preferredExecutorId)
      .map((binding) => ({
        rootPath: binding.pathHint,
        executorId: binding.nodeId,
        repoPath: binding.pathHint,
      })),
    ...listWorkspaces()
      .filter((workspace) => workspace.projectId === params.project.id)
      .filter((workspace) => !preferredExecutorId || workspace.executorNodeId === preferredExecutorId)
      .map((workspace) => ({
        rootPath: workspace.repoPath,
        executorId: workspace.executorNodeId,
        repoPath: workspace.repoPath,
      })),
  ]

  const seenTargets = new Set<string>()
  for (const candidate of candidateTargets) {
    const key = [
      candidate.rootPath?.trim() || '',
      candidate.executorId?.trim() || '',
      candidate.repoPath?.trim() || '',
    ].join('\u0000')
    if (!key.replace(/\u0000/g, '')) {
      continue
    }
    if (seenTargets.has(key)) {
      continue
    }
    seenTargets.add(key)

    const detected = await detectProjectEnvironmentTemplate(candidate)
    if (detected) {
      return detected
    }
  }

  return null
}

const runProjectClonePreparationInBackground = (params: {
  userId: string
  projectId: string
  preferredExecutorId?: string
  pathHint?: string
}) => {
  void (async () => {
    const initialProject = loadState().projects.find((project) => project.id === params.projectId)
    if (!initialProject) {
      return
    }

    try {
      const prepareResult = await prepareClonedProject({
        userId: params.userId,
        project: initialProject,
        preferredExecutorId: params.preferredExecutorId,
        pathHint: params.pathHint,
      })

      const latestProject = loadState().projects.find((project) => project.id === params.projectId)
      if (!latestProject) {
        return
      }

      if (!prepareResult.ok) {
        await saveProjectAndWait({
          ...latestProject,
          repositoryCloneStatus: 'failed',
          repositoryCloneMessage: prepareResult.message,
          updatedAt: new Date().toISOString(),
        })
        await publishProjectCloneState()
        return
      }

      const activeBindingPath = resolvePreparedProjectBindingPath(params.projectId, params.preferredExecutorId)
      const detectedEnvironmentTemplate = normalizeProjectEnvironmentTemplate(await detectProjectEnvironmentTemplate({
        executorId: params.preferredExecutorId,
        repoPath: activeBindingPath || params.pathHint,
      }) ?? latestProject.environmentTemplate)
      const preparedProject = {
        ...latestProject,
        repositoryCloneStatus: undefined,
        repositoryCloneMessage: undefined,
        environmentTemplate: detectedEnvironmentTemplate,
        updatedAt: new Date().toISOString(),
      } satisfies AppState['projects'][number]
      await saveProjectAndWait(preparedProject)
      await publishProjectCloneState()

      await autoImportProjectRuntimeEnvironment({
        project: preparedProject,
        executorId: params.preferredExecutorId,
        repoPath: activeBindingPath || params.pathHint,
        logContext: 'project-clone-background',
      })
    } catch (error) {
      const latestProject = loadState().projects.find((project) => project.id === params.projectId)
      if (!latestProject) {
        return
      }

      await saveProjectAndWait({
        ...latestProject,
        repositoryCloneStatus: 'failed',
        repositoryCloneMessage: error instanceof Error ? error.message : '后台克隆失败。',
        updatedAt: new Date().toISOString(),
      })
      await publishProjectCloneState()
    }
  })()
}

const validatePreferredProjectExecutorAccess = (params: {
  userId: string
  projectId: string
  executorId?: string
}) => {
  const executorId = params.executorId?.trim()
  if (!executorId) {
    return { ok: true as const }
  }

  const access = canUserUseExecutorForProject({
    userId: params.userId,
    projectId: params.projectId,
    executorId,
  })
  if (!access.ok) {
    return { ok: false as const, status: 403 as const, message: access.message }
  }

  if (!getManagedCloudGate().isExecutorAllowed(access.executor)) {
    return { ok: false as const, status: 403 as const, message: getManagedCloudGate().devOnlyMessage }
  }

  return { ok: true as const }
}

const resolveProjectBranchExecutorId = async (params: {
  state: AppState
  userId: string
  project: AppState['projects'][number]
  executorId?: string
}) => {
  const executorId = params.executorId?.trim()
  if (!isManagedCloudAutoExecutorId(executorId)) {
    return executorId
  }

  getManagedCloudGate().ensureDevOnlyAccess()
  await getManagedCloudGate().ensureUsageAccess({
    state: params.state,
    userId: params.userId,
  })

  const result = await getManagedCloudGate().ensureExecutor({
    config: params.state.config,
    ownerUserId: params.userId,
    workspaceId: params.project.workspaceId?.trim() || undefined,
    projects: params.state.projects,
  })
  return result.executor.executorId
}

export const registerProjectRoutes = (app: Hono, requireAuth: MiddlewareHandler) => {
  app.get('/api/projects/:id/branches', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    const state = loadState()
    const projectId = c.req.param('id')
    const query = projectBranchesQuerySchema.parse(c.req.query())
    const scopedState = getScopedState(state, userId)
    const project = scopedState.projects.find((item) => item.id === projectId)

    if (!project) {
      return c.json({ ok: false, branches: [], defaultBranch: 'main', message: '无权限访问项目。' }, 403)
    }

    if (project.repositoryCloneStatus === 'cloning') {
      return c.json({
        ok: false,
        branches: [],
        defaultBranch: project.defaultBranch || 'main',
        message: '项目仓库仍在执行节点上克隆，请等待完成后再读取分支。',
      })
    }

    if (project.repositoryCloneStatus === 'failed') {
      return c.json({
        ok: false,
        branches: [],
        defaultBranch: project.defaultBranch || 'main',
        message: project.repositoryCloneMessage?.trim()
          ? `项目仓库克隆失败：${project.repositoryCloneMessage}`
          : '项目仓库克隆失败，请先修复项目仓库后再读取分支。',
      })
    }

    try {
      const executorId = await resolveProjectBranchExecutorId({
        state,
        userId,
        project,
        executorId: query.executorId,
      })
      return c.json(await getProjectBranchSnapshotFromExecutor(userId, project, executorId))
    } catch (error) {
      return c.json({
        ok: false,
        branches: [],
        defaultBranch: project.defaultBranch || 'main',
        message: error instanceof Error ? error.message : '官方云节点暂不可用。',
      }, getManagedCloudGate().isUsageLimitError(error) ? 402 : 400)
    }
  })

  app.post('/api/projects', requireAuth, async (c) => {
    const payload = projectWithExecutorSchema.parse(await c.req.json())
    const state = loadState()
    const userId = getUserIdFromHeader(c)!
    const scopedState = getScopedState(state, userId)

    const exists = scopedState.projects.some((p) => p.name === payload.name.trim())
    if (exists) {
      return c.json({ state: scopedState, message: '项目已存在，请使用其他名称。' }, 400)
    }
    const workspaceAccess = await validateProjectWorkspaceAccess({
      userId,
      workspaceId: payload.workspaceId,
      visibility: payload.visibility,
    })
    if (!workspaceAccess.ok) {
      return c.json({ state: scopedState, message: workspaceAccess.message }, workspaceAccess.status)
    }

    const creator = getUserById(userId)
    const requestedRootPath = payload.rootPath?.trim() || ''
    const explicitRootPath = hasInvalidManagedScopePlaceholder(requestedRootPath) ? '' : requestedRootPath
    const preferredExecutorId = payload.preferredExecutorId?.trim() || ''
    const preferredExecutorWorkspaceRoot = preferredExecutorId
      ? listVisibleExecutorsForUser(userId).find((item) => item.executorId === preferredExecutorId)?.workspaceRoot
      : undefined
    const rootPath = explicitRootPath || resolveDefaultLocalProjectRootPath({
      workspaceRoot: preferredExecutorWorkspaceRoot || state.config.workspaceRoot,
      ownerUserId: userId,
      project: {
        name: payload.name,
        gitUrl: payload.gitUrl,
      },
    })
    if (!payload.gitUrl.trim() && !explicitRootPath) {
      ensureDefaultLocalProjectDirectory(rootPath)
    }
    const credentialResult = await resolveInitialGitCredential({
      userId,
      credentialId: payload.gitCredentialId,
      githubInstallationId: payload.githubInstallationId,
      githubRepositoryId: payload.githubRepositoryId,
      githubRepositoryName: payload.githubRepositoryName,
      repoUrl: payload.gitUrl,
    })
    if (!credentialResult.ok) {
      return c.json({ state: getScopedState(state, userId), message: credentialResult.message }, credentialResult.status)
    }
    const project = createProjectRecord({
      ...payload,
      workspaceId: workspaceAccess.workspaceId,
      visibility: workspaceAccess.visibility,
      rootPath,
      displayOrder: resolveNextDisplayOrder(scopedState.projects),
    }, creator ?? undefined)
    const executorAccess = validatePreferredProjectExecutorAccess({
      userId,
      projectId: project.id,
      executorId: project.preferredExecutorId,
    })
    if (!executorAccess.ok) {
      return c.json({ state: getScopedState(state, userId), message: executorAccess.message }, executorAccess.status)
    }
    project.environmentTemplate = normalizeProjectEnvironmentTemplate(await detectProjectEnvironmentTemplate({
      rootPath,
    }) ?? project.environmentTemplate)

    await saveProjectAndWait(project)
    await saveProjectWorkspaceAssignment(project)
    if (project.preferredExecutorId && project.rootPath && project.versionControl !== 'git-remote') {
      upsertProjectBinding(buildProjectBinding(project, project.preferredExecutorId, project.rootPath))
    }

    await addUserProjectAndWait(userId, project.id, 'owner')
    if (credentialResult.credentialId) {
      await saveProjectGitCredentialBinding({
        projectId: project.id,
        userId,
        credentialId: credentialResult.credentialId,
      })
    } else if (credentialResult.githubInstallationId) {
      await saveProjectGitHubAppInstallationBinding({
        projectId: project.id,
        userId,
        githubInstallationId: credentialResult.githubInstallationId,
        githubRepositoryId: credentialResult.githubRepositoryId,
        githubRepositoryName: credentialResult.githubRepositoryName,
        githubAccountLogin: credentialResult.githubAccountLogin,
        githubAccountType: credentialResult.githubAccountType,
        providerHost: credentialResult.providerHost,
      })
    }

    const runtimeEnvImportResult = await autoImportProjectRuntimeEnvironment({
      project,
      executorId: project.preferredExecutorId,
      repoPath: rootPath,
      logContext: 'project-create',
    })

    const nextState: AppState = {
      ...state,
      projects: [project, ...state.projects],
      selectedProjectId: project.id,
    }

    return c.json(await withState(
      withClusterState(nextState),
      mergeProjectMessageWithDetail('项目已创建。', summarizeProjectRuntimeEnvironmentImport(runtimeEnvImportResult)),
      userId,
    ))
  })

  app.get('/api/projects/:id/assignees', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    const state = loadState()
    const projectId = c.req.param('id')
    const projectResult = getAuthorizedProject(state, userId, projectId)
    if (!projectResult.project) {
      return jsonError(c, projectResult.message, projectResult.status)
    }

    const agents = getAllAgents()
      .filter((agent) => agent.type.trim().toLowerCase() !== 'main')
      .flatMap((agent) => {
        const access = resolveCustomAgentProjectAccess({
          agent,
          userId,
          projectId,
          collaborationWorkspaceId: projectResult.project.workspaceId,
          mode: 'delegate',
        })
        if (!access.ok) return []
        return {
          id: `agent:${agent.id}`,
          email: '',
          name: agent.name,
          avatarUrl: access.profile.avatarUrl || undefined,
          kind: 'agent' as const,
        }
      })
    return c.json({
      assignees: [
        { id: 'all:project-members', email: '所有项目成员', name: 'all', kind: 'all' as const },
        ...getProjectAssignees(projectId).map((member) => ({ ...member, kind: 'user' as const })),
        ...agents,
      ],
    })
  })

  app.get('/api/projects/:id/agent-activity-summary', requireAuth, (c) => {
    const userId = getUserIdFromHeader(c)!
    const projectId = c.req.param('id')
    const projectResult = getAuthorizedProject(loadState(), userId, projectId)
    if (!projectResult.project) return jsonError(c, projectResult.message, projectResult.status)
    return c.json({ activeTaskIds: listActiveAgentEventTaskIds(projectId) })
  })

  app.post('/api/projects/clone', requireAuth, async (c) => {
    const payload = cloneWithExecutorSchema.parse(await c.req.json())
    const state = loadState()
    const userId = getUserIdFromHeader(c)!
    const scopedState = getScopedState(state, userId)

    const exists = scopedState.projects.some((p) => p.name === payload.name.trim())
    if (exists) {
      return c.json({ state: scopedState, message: '项目已存在，请使用其他名称。' }, 400)
    }
    const workspaceAccess = await validateProjectWorkspaceAccess({
      userId,
      workspaceId: payload.workspaceId,
      visibility: payload.visibility,
    })
    if (!workspaceAccess.ok) {
      return c.json({ state: scopedState, message: workspaceAccess.message }, workspaceAccess.status)
    }

    const creator = getUserById(userId)
    const credentialResult = await resolveInitialGitCredential({
      userId,
      credentialId: payload.gitCredentialId,
      githubInstallationId: payload.githubInstallationId,
      githubRepositoryId: payload.githubRepositoryId,
      repoUrl: payload.gitUrl,
    })
    if (!credentialResult.ok) {
      return c.json({ state: getScopedState(state, userId), message: credentialResult.message }, credentialResult.status)
    }
    const project = createProjectRecord({
      ...payload,
      workspaceId: workspaceAccess.workspaceId,
      visibility: workspaceAccess.visibility,
      versionControl: 'git-remote',
      repositoryCloneStatus: payload.preferredExecutorId?.trim() ? 'cloning' : undefined,
      repositoryCloneMessage: payload.preferredExecutorId?.trim() ? '正在连接执行节点并准备仓库。' : undefined,
      displayOrder: resolveNextDisplayOrder(scopedState.projects),
    }, creator ?? undefined)
    const executorAccess = validatePreferredProjectExecutorAccess({
      userId,
      projectId: project.id,
      executorId: project.preferredExecutorId,
    })
    if (!executorAccess.ok) {
      return c.json({ state: getScopedState(state, userId), message: executorAccess.message }, executorAccess.status)
    }
    if (credentialResult.credentialId) {
      await saveProjectGitCredentialBinding({
        projectId: project.id,
        userId,
        credentialId: credentialResult.credentialId,
      })
    } else if (credentialResult.githubInstallationId) {
      await saveProjectGitHubAppInstallationBinding({
        projectId: project.id,
        userId,
        githubInstallationId: credentialResult.githubInstallationId,
        githubRepositoryId: credentialResult.githubRepositoryId,
        githubAccountLogin: credentialResult.githubAccountLogin,
        githubAccountType: credentialResult.githubAccountType,
        providerHost: credentialResult.providerHost,
      })
    }

    await saveProjectAndWait(project)
    await saveProjectWorkspaceAssignment(project)
    await addUserProjectAndWait(userId, project.id, 'owner')

    const nextState: AppState = {
      ...state,
      projects: [project, ...state.projects],
      selectedProjectId: project.id,
    }

    if (payload.preferredExecutorId?.trim()) {
      runProjectClonePreparationInBackground({
        userId,
        projectId: project.id,
        preferredExecutorId: payload.preferredExecutorId,
        pathHint: payload.pathHint,
      })
    }

    return c.json(await withState(
      withClusterState(nextState),
      payload.preferredExecutorId?.trim()
        ? '项目已创建，仓库正在后台克隆。'
        : '项目已创建。绑定执行节点后会开始准备仓库。',
      userId,
    ))
  })

  app.post('/api/projects/:id/environment-template/import', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    const state = loadState()
    const id = c.req.param('id')
    const projectResult = getAuthorizedProject(state, userId, id)
    if (!projectResult.project) return jsonError(c, projectResult.message, projectResult.status)

    const project = projectResult.project
    const detected = await detectProjectEnvironmentTemplateForImport({
      project,
      preferredExecutorId: project.preferredExecutorId,
    })

    if (!detected) {
      return c.json({ state: getScopedState(state, userId), message: '没有检测到 `.vibemux.yml`。' }, 404)
    }

    const updated = {
      ...project,
      environmentTemplate: normalizeProjectEnvironmentTemplate(mergeImportedProjectEnvironmentTemplate({
        current: project.environmentTemplate,
        imported: detected,
      })),
      updatedAt: new Date().toISOString(),
    }
    saveProject(updated)
    const nextState: AppState = {
      ...state,
      projects: state.projects.map((item) => (item.id === id ? updated : item)),
    }

    return c.json(await withState(withClusterState(nextState), '环境模板已重新导入。', userId))
  })

  app.post('/api/projects/:id/settings/sync', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    const state = loadState()
    const id = c.req.param('id')
    const projectResult = getAuthorizedProject(state, userId, id)
    if (!projectResult.project) return jsonError(c, projectResult.message, projectResult.status)

    const requestedExecutorId = c.req.query('executorId')?.trim() || projectResult.project.preferredExecutorId
    const syncedParts: string[] = []
    let project = await refreshProjectVersionControlFromExecutor(
      userId,
      projectResult.project,
      requestedExecutorId,
      resolveProjectSettingsSyncProbePaths(projectResult.project, requestedExecutorId, userId),
    )
    if (project.versionControl !== projectResult.project.versionControl || project.gitUrl !== projectResult.project.gitUrl) {
      syncedParts.push(project.versionControl === 'git-remote'
        ? '已识别为远端 Git 项目。'
        : project.versionControl === 'git-local'
          ? '已识别为本地 Git 项目。'
          : '项目仍按非 Git 本地目录处理。')
    }

    if (project.versionControl !== 'none') {
      const branchSnapshot = await getProjectBranchSnapshotFromExecutor(userId, project, requestedExecutorId)
      if (branchSnapshot.ok) {
        const latestProject = loadState().projects.find((item) => item.id === id) ?? project
        const updatedProject = {
          ...latestProject,
          defaultBranch: branchSnapshot.defaultBranch || latestProject.defaultBranch,
          recentBaseBranches: normalizeRecentBaseBranches(branchSnapshot.branches, branchSnapshot.defaultBranch || latestProject.defaultBranch),
          updatedAt: new Date().toISOString(),
        }
        saveProject(updatedProject)
        project = updatedProject
        syncedParts.push(`已同步 ${branchSnapshot.branches.length} 个 Git 分支。`)
      } else {
        syncedParts.push(branchSnapshot.message || 'Git 分支同步失败。')
      }
    } else {
      syncedParts.push('非 Git 项目已跳过远端分支拉取。')
    }

    const detectedEnvironmentTemplate = await detectProjectEnvironmentTemplateForImport({
      project,
      preferredExecutorId: requestedExecutorId,
    })
    if (detectedEnvironmentTemplate) {
      const latestProject = loadState().projects.find((item) => item.id === id) ?? project
      const updatedProject = {
        ...latestProject,
        environmentTemplate: normalizeProjectEnvironmentTemplate(mergeImportedProjectEnvironmentTemplate({
          current: latestProject.environmentTemplate,
          imported: detectedEnvironmentTemplate,
        })),
        updatedAt: new Date().toISOString(),
      }
      saveProject(updatedProject)
      project = updatedProject
      syncedParts.push('已同步项目环境模板。')
    } else {
      syncedParts.push('未检测到项目 `.vibemux.yml`。')
    }

    const activeBindingPath = resolvePreparedProjectBindingPath(project.id, requestedExecutorId)
    const runtimeEnvImportResult = await autoImportProjectRuntimeEnvironment({
      project,
      executorId: requestedExecutorId,
      repoPath: activeBindingPath || project.rootPath,
      logContext: 'project-settings-sync',
      overwrite: true,
    })
    const runtimeEnvSummary = summarizeProjectRuntimeEnvironmentImport(runtimeEnvImportResult)
    syncedParts.push(runtimeEnvSummary || '未检测到新的项目 `.env`。')

    const nextState = loadState()
    return c.json(await withState(
      withClusterState(nextState),
      summarizeSyncParts(syncedParts),
      userId,
    ))
  })

  app.post('/api/projects/check-path', async (c) => {
    const payload = pathSchema.parse(await c.req.json())
    const result = await checkLocalPath(payload.localPath)
    return c.json(result)
  })

  app.post('/api/projects/pick-folder', async (c) => {
    const result = await pickFolder()
    return c.json(result)
  })

  app.get('/api/projects/with-context', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    const projects = getProjectsWithContext(userId)
    const context = generateProjectContext(projects)
    return c.json({ projects, context })
  })

  app.post('/api/projects/reorder', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    const payload = projectReorderSchema.parse(await c.req.json().catch(() => ({})))
    const state = loadState()
    const scopedState = getScopedState(state, userId)
    const visibleProjectIds = new Set(scopedState.projects.map((project) => project.id))
    const normalizedOrderedProjectIds = payload.orderedProjectIds.filter((projectId, index, list) => (
      visibleProjectIds.has(projectId) && list.indexOf(projectId) === index
    ))
    if (normalizedOrderedProjectIds.length !== scopedState.projects.length) {
      return c.json({ message: '项目顺序无效。' }, 400)
    }

    const updatedAt = new Date().toISOString()
    const displayOrderByProjectId = buildDisplayOrderPatch(normalizedOrderedProjectIds)
    const nextProjects = sortProjectsByDisplayOrder(state.projects.map((project) => {
      const nextDisplayOrder = displayOrderByProjectId.get(project.id)
      if (typeof nextDisplayOrder !== 'number') {
        return project
      }

      const nextProject = {
        ...project,
        displayOrder: nextDisplayOrder,
        updatedAt,
      }
      saveProject(nextProject)
      return nextProject
    }))

    return c.json(await withState(withClusterState({
      ...state,
      projects: nextProjects,
    }), '项目顺序已更新。', userId))
  })

  // 轻量主聊天会话摘要（供「分享到聊天」选择器；agentId 可选过滤=该 Agent 的会话）
  app.get('/api/ai/sessions/summaries', requireAuth, (c) => {
    const userId = getUserIdFromHeader(c)
    if (!userId) return jsonError(c, '无权访问。', 403)
    const agentIdFilter = c.req.query('agentId')?.trim()
    const state = ensureMainChatState(loadState(), userId)
    const sessions = state.mainChatSessions
      // R10.1-B：private 会话仅 owner 可见（公开会话保持全员可见）。
      .filter((session) => session.visibility !== 'private' || session.ownerUserId === userId)
      .filter((session) => !agentIdFilter || session.customAgentId === agentIdFilter || session.ownerUserId === agentIdFilter)
      .slice()
      .sort((left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime())
      .slice(0, 50)
      .map((session) => ({
        id: session.id,
        title: session.title,
        updatedAt: session.updatedAt,
        visibility: session.visibility ?? 'public',
        ownerUserId: session.ownerUserId,
      }))
    return c.json({ sessions })
  })

  // R10.1-B：与 Agent 对话默认公开，可取消公开（private）——仅会话 owner 可操作。
  app.put('/api/ai/sessions/:id/visibility', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    const sessionId = c.req.param('id')
    const payload = z.object({ visibility: z.enum(['public', 'private']) }).parse(await c.req.json().catch(() => ({})))
    const state = ensureMainChatState(loadState(), userId)
    const session = state.mainChatSessions.find((item) => item.id === sessionId)
    if (!session) return jsonError(c, '会话不存在。', 404)
    if (session.ownerUserId && session.ownerUserId !== userId) {
      return jsonError(c, '只有会话创建者可以修改可见性。', 403)
    }
    if (!session.ownerUserId) {
      return jsonError(c, '该会话缺少归属信息，暂不支持修改可见性。', 409)
    }

    const nextState: AppState = {
      ...state,
      mainChatSessions: state.mainChatSessions.map((item) => (
        item.id === sessionId
          ? { ...item, visibility: payload.visibility, updatedAt: new Date().toISOString() }
          : item
      )),
    }
    return c.json(await withState(nextState, payload.visibility === 'private' ? '已取消公开。' : '已设为公开。', userId))
  })

  app.post('/api/ai/sessions', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    const payload = z.object({
      title: z.string().trim().optional(),
      workspaceId: z.string().trim().optional(),
      executorId: z.string().trim().optional(),
      cwd: z.string().trim().optional(),
      executionModel: z.string().trim().optional(),
    }).parse(await c.req.json().catch(() => ({})))
    const state = ensureMainChatState(loadState(), userId)
    const defaults = resolveNewMainChatSessionDefaults({
      sessions: state.mainChatSessions,
      selectedSessionId: state.selectedMainChatSessionId,
    })
    const requestedExecutorId = payload.executorId?.trim() || defaults.executorId
    if (requestedExecutorId && payload.executorId?.trim()) {
      const visibleExecutors = listVisibleExecutorsForUser(userId)
      const visibleExecutorIds = new Set(visibleExecutors.map((executor) => executor.executorId))
      if (!visibleExecutorIds.has(requestedExecutorId)) {
        return c.json({ message: '执行节点不可见或无权限访问。' }, 403)
      }
      const matchedExecutor = visibleExecutors.find((executor) => executor.executorId === requestedExecutorId)
      if (!getManagedCloudGate().isExecutorAllowed(matchedExecutor)) {
        return c.json({ message: getManagedCloudGate().devOnlyMessage }, 403)
      }
    }

    const requestedExecutionModel = payload.executionModel?.trim() || defaults.executionModel
    const session = createMainChatSession(payload.title?.trim() || '新会话', {
      ...defaults,
      ownerUserId: userId,
      workspaceId: payload.workspaceId?.trim() || undefined,
      executorId: requestedExecutorId,
      cwd: payload.cwd?.trim() || undefined,
      executionModel: requestedExecutionModel,
    })
    const modelCheck = await validateMainChatModel(userId, session, requestedExecutionModel)
    if (!modelCheck.ok) {
      return c.json({ message: modelCheck.message }, modelCheck.status)
    }

    const isWorkspaceScopedSession = Boolean(payload.workspaceId?.trim())
    const nextState: AppState = {
      ...state,
      mainChatSessions: [session, ...state.mainChatSessions],
      selectedMainChatSessionId: isWorkspaceScopedSession ? state.selectedMainChatSessionId : session.id,
    }

    return c.json(await withState(nextState, '已新建会话。', userId))
  })

  app.get('/api/ai/sessions/:id', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    const sessionId = c.req.param('id')
    const scopedState = getScopedState(ensureMainChatState(loadState(), userId), userId)
    const session = scopedState.mainChatSessions.find((item) => item.id === sessionId)
    if (!session) {
      return c.json({ message: '会话不存在。' }, 404)
    }

    // R10.1-B：private 会话仅 owner 与显式分享可见。
    if (session.visibility === 'private' && session.ownerUserId !== userId) {
      const access = await resolveMainChatSessionAccess({ sessionId, viewer: { type: 'user', id: userId } })
      if (!access.ok) {
        return jsonError(c, access.message, access.status)
      }
    }

    const limit = c.req.query('limit') ? Number(c.req.query('limit')) : undefined
    const beforeMessageId = c.req.query('beforeMessageId') ?? undefined
    const afterMessageId = c.req.query('afterMessageId') ?? undefined

    // 如果没有游标参数，返回会话元信息（不含消息数组）
    if (!limit && !beforeMessageId && !afterMessageId) {
      return c.json({
        session: {
          ...session,
          messages: [],
          messagesLoaded: false,
          messageCount: session.messageCount ?? session.messages?.length ?? 0,
        },
      })
    }

    // 有游标参数时，做游标分页查询
    const { getMainChatThreadMessages } = await import('../storage/postgres/thread-message-store')
    const result = await getMainChatThreadMessages({
      threadId: sessionId,
      limit,
      beforeSeq: beforeMessageId ? Number(beforeMessageId) : undefined,
      afterSeq: afterMessageId ? Number(afterMessageId) : undefined,
    })

    return c.json({
      session: {
        ...session,
        messages: result.messages,
        messagesLoaded: !result.hasMoreBefore,
        messageCount: result.totalMessageCount,
      },
      hasMoreBefore: result.hasMoreBefore,
      returnedMessageCount: result.returnedMessageCount,
    })
  })

  app.post('/api/ai/sessions/:id/select', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    const sessionId = c.req.param('id')
    const state = ensureMainChatState(loadState(), userId)
    if (!state.mainChatSessions.some((session) => session.id === sessionId)) {
      return c.json({ message: '会话不存在。' }, 404)
    }
    const nextState = switchMainChatSession(state, sessionId)

    return c.json(await withState(nextState, '已切换会话。', userId))
  })

  app.post('/api/ai/sessions/:id/stop', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    const sessionId = c.req.param('id')
    const state = ensureMainChatState(loadState(), userId)
    const session = state.mainChatSessions.find((item) => item.id === sessionId)

    if (!session) {
      return c.json({ message: '会话不存在。' }, 404)
    }

    const stopped = stopMainChatExecution({ userId, sessionId })
    const busyStatuses = new Set(['thinking', 'executing', 'waiting'])
    const nextState: AppState = busyStatuses.has(session.agentRunningStatus ?? '')
      ? {
          ...state,
          mainChatSessions: state.mainChatSessions.map((item) => (
            item.id === sessionId
              ? {
                  ...item,
                  agentRunningStatus: 'idle',
                  currentStep: '',
                  updatedAt: new Date().toISOString(),
                }
              : item
          )),
        }
      : state

    return c.json(await withState(
      nextState,
      stopped ? '已发送停止指令。' : '当前没有可停止的回复。',
      userId,
    ))
  })

  app.delete('/api/ai/sessions/:id', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    const sessionId = c.req.param('id')
    const state = ensureMainChatState(loadState(), userId)

    if (state.mainChatSessions.length <= 1) {
      return c.json({ message: '至少需要保留一个会话。' }, 400)
    }

    const session = state.mainChatSessions.find((item) => item.id === sessionId)
    if (!session) {
      return c.json({ message: '会话不存在。' }, 404)
    }

    const nextSessions = state.mainChatSessions.filter((item) => item.id !== sessionId)
    const nextSelectedId = sessionId === state.selectedMainChatSessionId
      ? nextSessions[0]?.id ?? ''
      : state.selectedMainChatSessionId

    const nextState: AppState = {
      ...state,
      mainChatSessions: nextSessions,
      selectedMainChatSessionId: nextSelectedId,
    }

    return c.json(await withState(nextState, '会话已删除。', userId))
  })

  app.post('/api/ai/sessions/:id/title', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    const sessionId = c.req.param('id')
    const payload = mainChatTitleSchema.parse(await c.req.json().catch(() => ({ title: '' })))
    const state = ensureMainChatState(loadState(), userId)
    const session = state.mainChatSessions.find((item) => item.id === sessionId)

    if (!session) {
      return c.json({ message: '会话不存在。' }, 404)
    }

    const nextTitle = payload.title.trim()
    const nextState: AppState = {
      ...state,
      mainChatSessions: state.mainChatSessions.map((item) => (
        item.id === sessionId
          ? {
              ...item,
              title: nextTitle,
              updatedAt: new Date().toISOString(),
            }
          : item
      )),
    }

    return c.json(await withState(nextState, '会话名称已更新。', userId))
  })

  app.post('/api/ai/sessions/:id/pin', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    const sessionId = c.req.param('id')
    const payload = mainChatPinSchema.parse(await c.req.json().catch(() => ({ pinned: true })))
    const state = ensureMainChatState(loadState(), userId)
    const session = state.mainChatSessions.find((item) => item.id === sessionId)

    if (!session) {
      return c.json({ message: '会话不存在。' }, 404)
    }

    const nextState: AppState = {
      ...state,
      mainChatSessions: state.mainChatSessions.map((item) => (
        item.id === sessionId
          ? setMainChatSessionPinned(item, payload.pinned)
          : item
      )),
    }

    return c.json(await withState(nextState, payload.pinned ? '会话已置顶。' : '会话已取消置顶。', userId))
  })

  app.post('/api/ai/sessions/:id/model', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    const sessionId = c.req.param('id')
    const payload = taskModelSchema.parse(await c.req.json().catch(() => ({ executionModel: '' })))
    const requestedModel = payload.executionModel?.trim() || undefined
    const state = ensureMainChatState(loadState(), userId)
    const session = state.mainChatSessions.find((item) => item.id === sessionId)

    if (!session) {
      return c.json({ message: '会话不存在。' }, 404)
    }

    const modelCheck = await validateMainChatModel(userId, session, requestedModel)
    if (!modelCheck.ok) {
      return c.json({ message: modelCheck.message }, modelCheck.status)
    }

    const nextState: AppState = {
      ...state,
      mainChatSessions: state.mainChatSessions.map((item) => (
        item.id === sessionId
          ? {
              ...clearMainChatLegacyRuntimeSessionIds(item),
              executionModel: requestedModel,
              updatedAt: new Date().toISOString(),
            }
          : item
      )),
    }

    return c.json(await withState(nextState, requestedModel ? '主对话模型已更新。' : '主对话已切换为默认模型。', userId))
  })

  app.post('/api/ai/sessions/:id/executor', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    const sessionId = c.req.param('id')
    const payload = mainChatExecutorSchema.parse(await c.req.json().catch(() => ({ executorId: '' })))
    const executorId = payload.executorId?.trim() || undefined
    const state = ensureMainChatState(loadState(), userId)
    const session = state.mainChatSessions.find((item) => item.id === sessionId)

    if (!session) {
      return c.json({ message: '会话不存在。' }, 404)
    }

    if (executorId) {
      const visibleExecutors = listVisibleExecutorsForUser(userId)
      const visibleExecutorIds = new Set(visibleExecutors.map((executor) => executor.executorId))
      if (!visibleExecutorIds.has(executorId)) {
        return c.json({ message: '执行节点不可见或无权限访问。' }, 403)
      }
      const matchedExecutor = visibleExecutors.find((executor) => executor.executorId === executorId)
      if (!getManagedCloudGate().isExecutorAllowed(matchedExecutor)) {
        return c.json({ message: getManagedCloudGate().devOnlyMessage }, 403)
      }
    }

    const nextState: AppState = {
      ...state,
      mainChatSessions: state.mainChatSessions.map((item) => (
        item.id === sessionId
          ? {
              ...clearMainChatLegacyRuntimeSessionIds(item),
              executorId,
              executionModel: item.executorId === executorId ? item.executionModel : undefined,
              updatedAt: new Date().toISOString(),
            }
          : item
      )),
    }

    const executorChanged = (session.executorId?.trim() || undefined) !== executorId
    const responseMessage = !executorId
      ? '主对话执行节点已清空。'
      : executorChanged && Boolean(session.cwd?.trim())
        ? '主对话执行节点已更新。当前会话仍绑定原来的工作目录；如果新节点上还没有 clone 或准备这个项目，下一次发送会直接提示你先准备仓库。'
        : '主对话执行节点已更新。'

    return c.json(await withState(nextState, responseMessage, userId))
  })

  app.post('/api/ai/sessions/:id/agent', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    const sessionId = c.req.param('id')
    const payload = mainChatAgentSchema.parse(await c.req.json())
    const customAgentId = payload.customAgentId
    const state = ensureMainChatState(loadState(), userId)
    const session = state.mainChatSessions.find((item) => item.id === sessionId)

    if (!session) {
      return c.json({ message: '会话不存在。' }, 404)
    }

    const agent = getAllAgents().find((item) => item.id === customAgentId && item.ownerUserId === userId)
    if (!agent || agent.type.trim().toLowerCase() === 'main') {
      return c.json({ message: 'Agent 不存在。' }, 404)
    }

    const profile = readCustomAgentConfig(agent.config)
    if (!isCustomAgentEnabled(profile)) {
      return c.json({ message: '该 Agent 已停用或归档，不能绑定到聊天会话。' }, 400)
    }

    const nextState: AppState = {
      ...state,
      mainChatSessions: state.mainChatSessions.map((item) => (
        item.id === sessionId
          ? {
              ...clearMainChatLegacyRuntimeSessionIds(item),
              customAgentId,
              executionModel: item.customAgentId === customAgentId ? item.executionModel : undefined,
              updatedAt: new Date().toISOString(),
            }
          : item
      )),
    }

    return c.json(await withState(nextState, `当前会话已切换为「${agent.name}」。`, userId))
  })

  app.get('/api/ai/sessions/:id/models', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    const sessionId = c.req.param('id')
    const state = ensureMainChatState(loadState(), userId)
    const session = state.mainChatSessions.find((item) => item.id === sessionId)

    if (!session) {
      return c.json({ ok: false, models: [], message: '会话不存在。' }, 404)
    }

    const result = await loadMainChatModelOptions(userId, session)
    return c.json(result, result.ok ? 200 : result.status ?? 503)
  })

  app.post('/api/ai/chat', requireAuth, async (c) => {
    const payload = aiChatSchema.parse(await c.req.json())
    const userId = getUserIdFromHeader(c)!
    const state = ensureMainChatState(loadState(), userId)
    const billingSession = await getCommercialGate().startFreeExecutionSession({
      userId,
      sessionKey: payload.sessionId?.trim() || `main-chat:${userId}`,
      kind: 'main_chat',
    })
    if (!billingSession.allowed || !billingSession.token) {
      return c.json({ message: billingSession.message }, 429)
    }

    const billingEventId = crypto.randomUUID()
    let completed = false

    try {
      const response = await runMainChatResponse({
        state,
        userId,
        message: payload.message,
        sessionId: payload.sessionId,
        attachments: payload.attachments,
        signal: c.req.raw.signal,
      })
      completed = !response.aborted && (!response.status || response.status === 200)

      if (response.aborted) {
        return c.json({ state: response.state, message: response.message, aborted: true })
      }

      if (response.status && response.status !== 200) {
        return c.json(response, response.status)
      }

      return c.json(response)
    } finally {
      await getCommercialGate().finishFreeExecutionSession({
        token: billingSession.token,
        completed,
        eventId: billingEventId,
      })
    }
  })

  // 分享 Drive 文件到主聊天（8a 引用附件；追加消息不触发 Agent 执行）
  app.post('/api/ai/sessions/:sessionId/attachments/drive', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)
    if (!userId) return jsonError(c, '无权访问。', 403)
    const sessionId = c.req.param('sessionId')
    const body = await c.req.json().catch(() => ({})) as { driveFileId?: string }
    const driveFileId = body.driveFileId?.trim()
    if (!driveFileId) return jsonError(c, '缺少 Drive 文件。', 400)

    const state = ensureMainChatState(loadState(), userId)
    const targetSession = state.mainChatSessions.find((session) => session.id === sessionId)
    if (!targetSession) return jsonError(c, '会话不存在。', 404)

    const built = await buildDriveReferenceAttachment({ driveFileId, userId, tokenScope: sessionId })
    if ('error' in built) return jsonError(c, built.error, built.status)

    const nextState = appendMainChatDriveAttachment({ state, userId, sessionId, attachment: built.attachment })
    return c.json(await withState(nextState, `已分享到主聊天。`, userId), 201)
  })

  // 分享工作区会话链接到主聊天（追加一条纯文本链接消息，不触发 Agent 执行）
  app.post('/api/ai/sessions/:sessionId/messages/link', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)
    if (!userId) return jsonError(c, '无权访问。', 403)
    const sessionId = c.req.param('sessionId')
    const body = await c.req.json().catch(() => ({})) as { text?: string }
    const text = body.text?.trim()
    if (!text) return jsonError(c, '缺少链接内容。', 400)

    const state = ensureMainChatState(loadState(), userId)
    const targetSession = state.mainChatSessions.find((session) => session.id === sessionId)
    if (!targetSession) return jsonError(c, '会话不存在。', 404)

    const nextState = appendMainChatTextMessage({ state, userId, sessionId, text })
    return c.json(await withState(nextState, '已分享到主聊天。', userId), 201)
  })

  app.post('/api/ai/chat-stream', requireAuth, async (c) => {
    const payload = aiChatSchema.parse(await c.req.json())
    const userId = getUserIdFromHeader(c)!
    const state = ensureMainChatState(loadState(), userId)
    const billingSession = await getCommercialGate().startFreeExecutionSession({
      userId,
      sessionKey: payload.sessionId?.trim() || `main-chat:${userId}`,
      kind: 'main_chat',
    })
    if (!billingSession.allowed || !billingSession.token) {
      return c.json({ message: billingSession.message }, 429)
    }

    const billingEventId = crypto.randomUUID()

    const stream = new ReadableStream({
      async start(controller) {
        const sendEvent = (data: Record<string, unknown>) => {
          controller.enqueue(`data: ${JSON.stringify(data)}\n\n`)
        }
        let completed = false

        sendEvent({ type: 'user', content: payload.message, clientMessageId: payload.clientMessageId })
        sendEvent({ type: 'status', content: 'Agent 系统正在分析上下文...', status: 'thinking', currentStep: 'Agent 系统正在分析上下文...' })

        try {
          const result = await streamMainChatResponse({
            state,
            userId,
            message: payload.message,
            sessionId: payload.sessionId,
            attachments: payload.attachments,
            clientMessageId: payload.clientMessageId,
            replyToMessageId: payload.replyToMessageId,
            signal: c.req.raw.signal,
            sendEvent,
          })
          completed = result.completed
        } catch (error) {
          sendEvent({ type: 'error', content: error instanceof Error ? error.message : '未知错误' })
        } finally {
          await getCommercialGate().finishFreeExecutionSession({
            token: billingSession.token!,
            completed,
            eventId: billingEventId,
          })
        }

        controller.close()
      },
    })

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      },
    })
  })

  app.post('/api/ai/confirm-task', requireAuth, async (c) => {
    const payload = await c.req.json<{ taskProposalId: string; projectId: string; title: string; description: string; difficulty: TaskProposal['difficulty']; agentManaged: TaskProposal['agentManaged'] }>()
    const userId = getUserIdFromHeader(c)!
    const state = loadState()
    const scopedState = getScopedState(state, userId)

    const project = scopedState.projects.find((p) => p.id === payload.projectId)
    if (!project) {
      return c.json({ state: scopedState, message: '项目不存在。' }, 404)
    }

    const creator = resolveUserCreatorIdentity(userId)
    const task = {
      ...createTaskFromRequirement(
        project,
        payload.description,
        payload.difficulty,
        payload.title,
        payload.agentManaged,
        undefined,
        undefined,
        undefined,
        scopedState.config,
      ),
      createdBy: creator,
    }
    saveTask(task)

    const nextState: AppState = {
      ...clearTaskProposalFromChat(scopedState, payload.taskProposalId),
      tasks: [task, ...scopedState.tasks],
      selectedTaskId: task.id,
      selectedProjectId: project.id,
      executionCenter: deriveExecutionCenter([task, ...scopedState.tasks], scopedState.executionCenter),
    }
    return c.json(await withState(nextState, `任务「${task.title}」已创建。`, userId))
  })

  app.put('/api/projects/:id', requireAuth, async (c) => {
    const payload = projectWithExecutorSchema.parse(await c.req.json())
    const userId = getUserIdFromHeader(c)!
    const id = c.req.param('id')
    const state = loadState()
    const projectResult = getAuthorizedProject(state, userId, id)
    if (!projectResult.project) return jsonError(c, projectResult.message, projectResult.status)
    const project = projectResult.project

    const gitUrl = payload.gitUrl.trim()
    const workspaceAccess = await resolveProjectWorkspaceAccessUpdate({
      userId,
      project,
      workspaceId: payload.workspaceId,
      visibility: payload.visibility,
    })
    if (!workspaceAccess.ok) {
      return jsonError(c, workspaceAccess.message, workspaceAccess.status)
    }
    const versionControl = payload.versionControl
      ?? (project.versionControl === 'git-local'
        ? 'git-local'
        : (gitUrl ? 'git-remote' : 'none'))
    const rootPath = payload.rootPath?.trim() || project.rootPath
    const defaultBranch = payload.defaultBranch?.trim() || project.defaultBranch || 'main'
    const nextPreferredExecutorId = payload.preferredExecutorId?.trim() || undefined
    const executorAccess = validatePreferredProjectExecutorAccess({
      userId,
      projectId: project.id,
      executorId: nextPreferredExecutorId,
    })
    if (!executorAccess.ok) {
      return jsonError(c, executorAccess.message, executorAccess.status)
    }
    const mergedEnvironmentTemplate = mergeProjectEnvironmentTemplateUpdate(project.environmentTemplate, payload.environmentTemplate)
    const duplicatePorts = validateProjectEnvironmentPreviewPorts({
      appPort: mergedEnvironmentTemplate?.appPort,
      ports: mergedEnvironmentTemplate?.ports,
      previewDomainBindings: mergedEnvironmentTemplate?.previewDomainBindings,
    })
    if (duplicatePorts.length > 0) {
      return jsonError(c, `预览端口不能重复：${duplicatePorts.join('、')}`, 409)
    }

    const updated: AppState['projects'][number] = {
      ...project,
      name: payload.name.trim(),
      color: normalizeHexColor(payload.color) ?? project.color ?? deriveProjectColor(payload.name),
      workspaceId: workspaceAccess.workspaceId,
      visibility: workspaceAccess.visibility,
      rootPath,
      versionControl,
      gitUrl,
      defaultBranch,
      preferredExecutorId: nextPreferredExecutorId,
      environmentTemplate: mergedEnvironmentTemplate,
      recentBaseBranches: normalizeRecentBaseBranches(payload.recentBaseBranches, defaultBranch),
      updatedAt: new Date().toISOString(),
    }
    saveProject(updated)
    await saveProjectWorkspaceAssignment(updated)

    const runtimeEnvironmentConfig = await getProjectRuntimeEnvironmentConfigForProject(updated.id).catch(() => null)
    const runtimeEnvironmentFileWriteResult = await materializeProjectRuntimeEnvironmentFile(updated, runtimeEnvironmentConfig)

    const nextState: AppState = {
      ...state,
      projects: state.projects.map((item) => (item.id === id ? updated : item)),
    }
    return c.json(await withState(
      withClusterState(nextState),
      mergeProjectMessageWithDetail(
        '项目已更新。',
        runtimeEnvironmentFileWriteResult?.ok
          ? `已同步写入 ${runtimeEnvironmentFileWriteResult.fileName || '.env'}。`
          : runtimeEnvironmentFileWriteResult?.message || '',
      ),
      userId,
    ))
  })

  app.delete('/api/projects/:id', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    const id = c.req.param('id')
    const payload = deleteProjectSchema.parse(await c.req.json().catch(() => ({})))
    const state = loadState()
    const projectResult = getAuthorizedProject(state, userId, id)
    if (!projectResult.project) return jsonError(c, projectResult.message, projectResult.status)
    if (projectResult.project.name.trim() !== payload.projectName.trim()) {
      return c.json({ ok: false, message: '项目名称不匹配，请重新输入后再删除。' }, 400)
    }
    let deleteProjectDirectoryResult: Awaited<ReturnType<typeof deleteProjectRootDirectory>> | null = null
    let deleteProjectDirectoryErrorMessage = ''
    if (payload.deleteProjectDirectory) {
      try {
        deleteProjectDirectoryResult = await deleteProjectRootDirectory({
          project: projectResult.project,
          userId,
          protectedWorkspaceRoots: [
            state.config.workspaceRoot,
            ...listVisibleExecutorsForUser(userId).map((executor) => executor.workspaceRoot),
          ],
        })
      } catch (error) {
        deleteProjectDirectoryErrorMessage = error instanceof Error ? error.message : '未知错误'
        console.warn('[project-routes] delete project directory failed, continuing with project removal', {
          projectId: projectResult.project.id,
          projectName: projectResult.project.name,
          rootPath: projectResult.project.rootPath,
          userId,
          error: deleteProjectDirectoryErrorMessage,
        })
      }
    }
    if (projectResult.project.visibility === 'workspace' && projectResult.project.workspaceId) {
      removeTeamProject(projectResult.project.workspaceId, projectResult.project.id, userId)
    }
    await removeUserProjectAndWait(userId, projectResult.project.id)
    for (const binding of listProjectBindings().filter((item) => item.projectId === id && item.isActive)) {
      deactivateProjectBinding(id, binding.nodeId)
    }

    deleteProject(id)
    const projects = state.projects.filter((project) => project.id !== id)
    const tasks = state.tasks.filter((task) => task.projectId !== id)
    const nextState: AppState = {
      ...state,
      projects,
      tasks,
      selectedProjectId: state.selectedProjectId === id ? projects[0]?.id ?? '' : state.selectedProjectId,
      selectedTaskId: tasks.some((task) => task.id === state.selectedTaskId) ? state.selectedTaskId : tasks[0]?.id ?? '',
      executionCenter: deriveExecutionCenter(tasks, state.executionCenter),
    }
    const message = summarizeProjectDeletionMessage({
      deleteProjectDirectory: payload.deleteProjectDirectory,
      deleteProjectDirectoryResult,
      deleteProjectDirectoryErrorMessage,
    })
    return c.json(await withState(withClusterState(nextState), message, userId))
  })
}
