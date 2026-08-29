// [INPUT]: /workspace route state, project/workspace/session records, and executor runtime data.
// [OUTPUT]: Workspace route projections and an optional real task execution view.
// [POS]: Workspace detail data boundary; unbound sessions do not create task-shaped views.
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import { resolveProjectEnvironmentCommandFields, resolveProjectEnvironmentPreview } from '@shared/project-environment-template'
import { buildWorkspaceTaskExecutionView, resolveWorkspaceSessionExecutorId, resolveWorkspaceWorkerId } from '@shared/task-workspace'
import type { AppState, ExecutorRecord, Project, Task, WorkspaceSession, Workspace } from '@shared/types'
import { useEffect, useMemo, useState, type Dispatch, type SetStateAction } from 'react'
import { api } from '../lib/api'
import type { ManagedCloudRuntimeStatus } from '../lib/api'
import type { Language } from '../lib/i18n'
import { isManagedCloudExecutorRecord, normalizeManagedCloudExecutorForDisplay } from '../lib/managed-cloud-executor'
import { useProjectWorkspacesData } from '../lib/use-project-workspaces-data'
import { listWorkspaceSessionsForWorkspace } from '../lib/workspace-session-scope'
import { useExecutorRuntimeData } from '../lib/use-executor-runtime-data'
import { resolveWorkspaceSessionRuntime } from '../lib/workspace-session-runtime'
import { WorkspaceRouteSearch, text } from './-workspace-route-shared'
import {
  selectFallbackWorkspaceSession,
  selectProjectBindingPathHint,
  selectWorkspaceSessionsForWorkspace,
  selectWorkspaceTask,
  type WorkspaceRouteIndexes,
} from './-workspace-route-selectors'

const toWorkspaceExecutorStatus = (
  executor: ExecutorRecord | undefined,
  runtime: ManagedCloudRuntimeStatus | null,
): Workspace['executorStatus'] => {
  if (!executor) {
    return 'offline'
  }

  if (isManagedCloudExecutorRecord(executor) && runtime?.available) {
    return 'online'
  }

  switch (executor.status) {
    case 'online':
    case 'paired':
    case 'offline':
      return executor.status
    default:
      return 'offline'
  }
}

type Translate = (key: string, options?: Record<string, unknown>) => string

type UseWorkspaceRouteDataParams = {
  language: Language
  project: Project | null
  routeIndexes: WorkspaceRouteIndexes
  search: WorkspaceRouteSearch
  setState: Dispatch<SetStateAction<AppState>>
  state: AppState
  task: Task | null
  t: Translate
}

export const useWorkspaceRouteData = ({
  language,
  project,
  routeIndexes,
  search,
  setState,
  state,
  task,
  t,
}: UseWorkspaceRouteDataParams) => {
  const {
    executors,
    managedCloudRuntime,
    refreshExecutors,
    refreshManagedCloudRuntime,
  } = useExecutorRuntimeData()
  const {
    refreshProjectWorkspaces,
    setWorkspaces,
    workspaces,
    workspacesLoading,
  } = useProjectWorkspacesData(project?.id ?? '')
  const [workspaceEnvironmentTemplate, setWorkspaceEnvironmentTemplate] = useState<Project['environmentTemplate'] | null>(null)

  const environmentCommands = useMemo(
    () => resolveProjectEnvironmentCommandFields(project, workspaceEnvironmentTemplate),
    [project, workspaceEnvironmentTemplate],
  )

  const workspace = useMemo(
    () => workspaces.find((item) => item.id === search.workspaceId) ?? null,
    [search.workspaceId, workspaces],
  )

  const currentWorkspace = useMemo<Workspace | null>(() => {
    if (workspace) {
      return workspace
    }

    if (!project || !task) {
      return null
    }

    const fallbackSession = selectFallbackWorkspaceSession(
      routeIndexes,
      search.workspaceId,
      search.workspaceSessionId,
    )

    const legacyFallbackWorkerId = resolveWorkspaceSessionExecutorId(fallbackSession)
    const matchedExecutor = legacyFallbackWorkerId
      ? executors.find((item) => item.executorId === legacyFallbackWorkerId)
      : undefined

    return {
      id: search.workspaceId || '',
      projectId: project.id,
      executorNodeId: legacyFallbackWorkerId,
      agentType: fallbackSession?.agentType ?? task.agentType,
      name: t('workspace.unnamed', { defaultValue: '未命名工作区' }),
      executorName: matchedExecutor?.name || (legacyFallbackWorkerId || t('workspace.unassignedNode', { defaultValue: '未分配节点' })),
      executorStatus: toWorkspaceExecutorStatus(matchedExecutor, managedCloudRuntime),
      status: project.versionControl === 'git-remote' ? 'pending_repo' : 'ready',
      repoReady: project.versionControl !== 'git-remote',
      repoPath: project.versionControl === 'git-remote' ? undefined : project.rootPath,
      worktreeRootPath: undefined,
      source: 'manual',
      workingDirectoryMode: project.versionControl === 'none' ? 'original-dir' : 'worktree',
      defaultBranch: project.defaultBranch,
      suggestedBaseBranch: task.baseBranch || task.baseBranchHint,
      ownerUserId: undefined,
      createdAt: task.createdAt,
      updatedAt: task.updatedAt,
    }
  }, [executors, managedCloudRuntime, project, routeIndexes, search.workspaceId, search.workspaceSessionId, t, task, workspace])

  const gitPanelEnabled = project?.versionControl !== 'none'

  const allWorkspaceSessions = useMemo<WorkspaceSession[]>(() => {
    if (!currentWorkspace) {
      return []
    }

    return selectWorkspaceSessionsForWorkspace(routeIndexes, currentWorkspace.id)
  }, [currentWorkspace, routeIndexes])

  const matchedWorkspaceSession = useMemo<WorkspaceSession | null>(() => {
    if (!search.workspaceSessionId) {
      return null
    }

    return allWorkspaceSessions.find((item) => item.id === search.workspaceSessionId) ?? null
  }, [allWorkspaceSessions, search.workspaceSessionId])

  const workspaceTask = useMemo(() => {
    if (!currentWorkspace || !project) {
      return null
    }

    return selectWorkspaceTask(routeIndexes, {
      fallbackTask: task,
      project,
      workspaceId: currentWorkspace.id,
    })
  }, [currentWorkspace, project, routeIndexes, task])

  const workspaceSessions = useMemo<WorkspaceSession[]>(() => {
    if (!currentWorkspace) {
      return []
    }

    return listWorkspaceSessionsForWorkspace({
      workspaceId: currentWorkspace.id,
      workspaceSessions: allWorkspaceSessions,
    })
  }, [allWorkspaceSessions, currentWorkspace])

  const workspaceSession = useMemo<WorkspaceSession | null>(() => {
    if (workspaceSessions.length === 0) {
      return null
    }

    if (search.workspaceSessionId) {
      return workspaceSessions.find((item) => item.id === search.workspaceSessionId) ?? workspaceSessions[0]
    }

    return workspaceSessions[0]
  }, [search.workspaceSessionId, workspaceSessions])

  const testerWorkspaceSession = useMemo<WorkspaceSession | null>(() => {
    return workspaceSessions.find((item) => item.status === 'active' && item.sessionKind === 'subagent' && item.sessionRole === 'tester') ?? null
  }, [workspaceSessions])

  const parentWorkspaceSession = useMemo<WorkspaceSession | null>(() => {
    if (!workspaceSession?.parentSessionId) {
      return null
    }

    return workspaceSessions.find((item) => item.id === workspaceSession.parentSessionId) ?? null
  }, [workspaceSession?.parentSessionId, workspaceSessions])

  const selectedWorkspaceSessionId = workspaceSession?.id || ''

  const displayTask = useMemo(() => {
    if (!workspaceTask) {
      return null
    }

    return workspaceSession ? buildWorkspaceTaskExecutionView(workspaceTask, workspaceSession) : workspaceTask
  }, [workspaceSession, workspaceTask])
  const workspaceExecutorId = resolveWorkspaceWorkerId(currentWorkspace)

  const workspaceSessionRuntime = useMemo(() => {
    if (!currentWorkspace || !project) {
      return null
    }

    const bindingPathHint = selectProjectBindingPathHint(routeIndexes, project.id, workspaceExecutorId)

    return resolveWorkspaceSessionRuntime({
      bindingPathHint,
      defaultWorkspaceRoot: state.config.workspaceRoot,
      executors: executors.map((executor) => normalizeManagedCloudExecutorForDisplay(executor, managedCloudRuntime)),
      project,
      workspace: currentWorkspace,
      workspaceSession,
    })
  }, [currentWorkspace, executors, managedCloudRuntime, project, routeIndexes, state.config.workspaceRoot, workspaceSession, workspaceExecutorId])

  const workspaceExecutor = workspaceSessionRuntime?.executor ?? null
  const workspaceRuntimeExecutorId = workspaceSessionRuntime?.executorId || workspaceExecutorId
  const workspaceRuntimeExecutorName = workspaceSessionRuntime?.executorName || workspaceExecutor?.name || currentWorkspace?.executorName || workspaceExecutorId
  const workspaceFileExplorerRootPath = workspaceSessionRuntime?.fileExplorerRootPath
  const terminalTargetCwd = workspaceSessionRuntime?.terminalTargetCwd
  const terminalCwd = workspaceSessionRuntime?.terminalCwd
  const terminalCandidateCwds = workspaceSessionRuntime?.candidateCwds ?? []

  const environmentPreview = useMemo(() => {
    if (!project || !workspaceSession) {
      return null
    }

    return resolveProjectEnvironmentPreview({
      project,
      session: workspaceSession,
      cwd: terminalTargetCwd,
      workspaceEnvironmentTemplate,
    })
  }, [project, terminalTargetCwd, workspaceEnvironmentTemplate, workspaceSession])

  const hasEnvironmentControls = Boolean(currentWorkspace && workspaceSession)

  const environmentDisabledReason = useMemo(() => {
    if (!hasEnvironmentControls) {
      return text(language, '当前工作区会话还没准备好。', 'The current workspace session is not ready yet.')
    }

    if (!project?.environmentTemplate && !workspaceEnvironmentTemplate) {
      return text(language, '当前项目还没有配置环境模板。', 'The current project has no environment template configured.')
    }

    if (!terminalTargetCwd) {
      return text(language, '当前工作区还没有可用的环境目录。', 'The current workspace has no available environment directory.')
    }

    if (!environmentPreview) {
      return text(language, '当前环境模板还不能渲染出可执行环境。', 'The current environment template cannot render an executable environment yet.')
    }

    return ''
  }, [environmentPreview, hasEnvironmentControls, language, project?.environmentTemplate, terminalTargetCwd, workspaceEnvironmentTemplate])

  useEffect(() => {
    let cancelled = false
    if (!currentWorkspace?.id) {
      setWorkspaceEnvironmentTemplate(null)
      return () => {
        cancelled = true
      }
    }

    void api.getWorkspaceEnvironmentTemplate(currentWorkspace.id)
      .then((response) => {
        if (!cancelled) {
          setWorkspaceEnvironmentTemplate(response.template)
        }
      })
      .catch(() => {
        if (!cancelled) {
          setWorkspaceEnvironmentTemplate(null)
        }
      })

    return () => {
      cancelled = true
    }
  }, [currentWorkspace?.id])

  useEffect(() => {
    let cancelled = false

    void refreshExecutors()
    void refreshManagedCloudRuntime()

    if (!project?.id) {
      return () => {
        cancelled = true
      }
    }

    void refreshProjectWorkspaces()
      .then((response) => {
        if (!cancelled) {
          if (response.project) {
            setState((current) => ({
              ...current,
              projects: current.projects.map((item) => (item.id === response.project!.id ? response.project! : item)),
            }))
          }
        }
      })

    return () => {
      cancelled = true
    }
  }, [project?.id, refreshExecutors, refreshManagedCloudRuntime, refreshProjectWorkspaces, setState])

  return {
    currentWorkspace,
    displayTask,
    environmentCommands,
    environmentDisabledReason,
    environmentPreview,
    executors,
    gitPanelEnabled,
    managedCloudRuntime,
    hasEnvironmentControls,
    matchedWorkspaceSession,
    parentWorkspaceSession,
    refreshExecutors,
    selectedWorkspaceSessionId,
    setWorkspaceEnvironmentTemplate,
    setWorkspaces,
    terminalCandidateCwds,
    terminalCwd,
    terminalTargetCwd,
    testerWorkspaceSession,
    workspaceExecutor,
    workspaceFileExplorerRootPath,
    workspaceRuntimeExecutorId,
    workspaceRuntimeExecutorName,
    workspaceSessionRuntime,
    workspaceSession,
    workspaceSessions,
    workspaceTask,
    workspacesLoading,
  }
}
