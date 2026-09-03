// [INPUT]: Workspace creation form state, global Agent runtime defaults, project/executor APIs, and route callbacks.
// [OUTPUT]: /workspaces creation controller that persists the effective runtime config before immediate navigation.
// [POS]: Web orchestration boundary; uploads and initial message queueing continue after the workspace becomes visible.
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import { useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react'
import { toast } from 'sonner'
import { resolveMatchingAgentExecutionModelOptionId } from '@shared/model-profile'
import { PLAYGROUND_PROJECT_ID } from '@shared/playground-workspace'
import type { AgentSettings, AppState, ExecutionModelOption, ExecutorRecord, Project, WorkspaceExecutionDefaults, WorkspaceSession, WorkspaceSessionTitleOrigin, Workspace } from '@shared/types'
import { buildWorkspaceTitleFallback } from '@shared/workspace-title'
import type { WorkspaceRouteSearch } from '../../routes/-workspace-route-shared'
import { useAuth } from '../../lib/auth-context'
import { api, type GitHubAppInstallationSummary, type GitHubAppRepositorySummary } from '../../lib/api'
import { buildExecutorOptionsWithManagedCloud } from '../../lib/managed-cloud-executor'
import {
  readWorkspaceCreateBaseBranchPreference,
  writeWorkspaceCreateBaseBranchPreference,
  writeWorkspaceCreateRuntimePreference,
} from '../../lib/workspace-create-preferences'
import { workspaceQueryKeys } from '../../lib/workspace-query-keys'
import { setCachedTaskChatSession } from '../../lib/workspace-session-chat-cache'
import {
  isUsableWorkspaceCreationExecutor,
  readWorkspaceCreationImage,
  resolveDefaultWorkspaceCreationExecutorId,
  resolvePreferredWorkspaceCreationRuntime,
  resolveWorkspaceCreationAgentSettings,
  resolveWorkspaceCreationCloneBlockReason,
  runWorkspaceCreationUseCase,
} from '../../lib/workspace-creation-use-case'
import { createWorkspaceInitialState, type CreateWorkspaceState } from './workspaces-create-state'
import type { WorkspacesPageDirectoryData } from './workspaces-page-queries'
import {
  DEFAULT_BRANCH_FALLBACK,
  resolveBranchSelectionState,
  type WorkspaceListItem,
} from './workspaces-page-utils'
import { openWorkspaceTab } from './workspaces-page-ui-store'

type ProjectWorkspacesQueryData = {
  project: Project | null
  workspaces: Workspace[]
}

export type WorkspaceGitHubRepositoryOption = GitHubAppRepositorySummary & {
  installationId: number
  installationAccountLogin: string
}

const MODEL_OPTIONS_CACHE_TTL_MS = 30_000
const RUNTIME_MODEL_REFRESH_DELAY_MS = 2_000
const PROJECT_CLONE_WAIT_TIMEOUT_MS = 120_000
const PROJECT_CLONE_WAIT_INTERVAL_MS = 2_000
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const isNonGitBranchSnapshot = (response: {
  ok: boolean
  branches: string[]
  versionControl?: Project['versionControl']
  message?: string
}) => {
  if (response.versionControl === 'none') {
    return true
  }

  if (response.ok || response.branches.length > 0) {
    return false
  }

  const message = response.message?.trim() || ''
  return /未启用 Git|无 Git 仓库|不是有效 Git 仓库|仓库未配置 origin|no git|not a git/i.test(message)
}

const isExecutorOfflineBranchMessage = (message?: string) => {
  const normalizedMessage = message?.trim() || ''
  return normalizedMessage.includes('执行器当前未在线')
}

const buildExecutorOfflineBranchMessage = (t: (key: string, options?: Record<string, unknown>) => string) => {
  return t(
    'workspace.createPanel.branchMessages.executorConnectionLost',
    {
      defaultValue: '执行节点连接刚刚失效，暂时无法读取仓库分支。请稍等自动刷新，或重新选择该节点。',
    },
  )
}

const createWorkspaceInitialStateWithRuntime = (params: {
  defaults: WorkspaceExecutionDefaults
  executorId?: string
  fallbackAgentType?: Workspace['agentType'] | WorkspaceSession['agentType']
  project: Project | null
  projectId: string
}) => {
  const runtimePreference = resolvePreferredWorkspaceCreationRuntime({
    defaults: params.defaults,
    fallbackAgentType: params.fallbackAgentType,
    project: params.project,
    projectId: params.projectId,
  })
  return {
    ...createWorkspaceInitialState(params.projectId, params.executorId || params.defaults.executorNodeId),
    agentType: runtimePreference.agentType,
    executionModel: runtimePreference.executionModel,
    workingDirectoryMode: runtimePreference.workingDirectoryMode,
  }
}

export type WorkspacesCreateControllerOptions = {
  agentSettings: AgentSettings
  clearPendingWorkspaceSessionSelection: () => void
  executors: WorkspacesPageDirectoryData['executors']
  isMobile: boolean
  language: string
  managedCloudRuntime: WorkspacesPageDirectoryData['managedCloudRuntime']
  panelMode: 'detail' | 'create'
  pendingWorkspaceSelectionIdRef: MutableRefObject<string>
  pendingWorkspaceSessionSelectionIdRef: MutableRefObject<string>
  search: WorkspaceRouteSearch
  selectedItem: WorkspaceListItem | null
  selectedProjectId: string
  setMobileView: (view: 'list' | 'detail' | 'create') => void
  setOptimisticWorkspaceSession: (workspaceSession: WorkspaceSession | null) => void
  setPanelMode: (mode: 'detail' | 'create') => void
  setPendingAutoEnvironmentInstallWorkspaceId: (workspaceId: string | null) => void
  setSelectedProjectId: (projectId: string) => void
  setSelectedWorkspaceId: (workspaceId: string) => void
  setSelectedWorkspaceSessionId: (workspaceSessionId: string) => void
  setState: (updater: AppState | ((state: AppState) => AppState)) => void
  t: (key: string, options?: Record<string, unknown>) => string
  updateWorkspaceDirectoryCache: (
    updater: (current: WorkspacesPageDirectoryData | undefined) => WorkspacesPageDirectoryData | undefined,
  ) => void
  updateWorkspaceSearch: (patch: Partial<WorkspaceRouteSearch>, replace?: boolean) => void
  visibleProjectIds: Set<string>
  workspaceScopedProjects: Project[]
  workspaceExecutionDefaults: WorkspaceExecutionDefaults
}

export function useWorkspacesCreateController({
  agentSettings,
  clearPendingWorkspaceSessionSelection,
  executors,
  isMobile,
  language,
  managedCloudRuntime,
  panelMode,
  pendingWorkspaceSelectionIdRef,
  pendingWorkspaceSessionSelectionIdRef,
  search,
  selectedItem,
  selectedProjectId,
  setMobileView,
  setOptimisticWorkspaceSession,
  setPanelMode,
  setPendingAutoEnvironmentInstallWorkspaceId,
  setSelectedProjectId,
  setSelectedWorkspaceId,
  setSelectedWorkspaceSessionId,
  setState,
  t,
  updateWorkspaceDirectoryCache,
  updateWorkspaceSearch,
  visibleProjectIds,
  workspaceScopedProjects,
  workspaceExecutionDefaults,
}: WorkspacesCreateControllerOptions) {
  const queryClient = useQueryClient()
  const { user } = useAuth()
  const [createState, setCreateState] = useState<CreateWorkspaceState>(
    () => {
      const initialProjectId = search.projectId || selectedProjectId || workspaceScopedProjects[0]?.id || ''
      const initialProject = workspaceScopedProjects.find((project) => project.id === initialProjectId) ?? null
      return createWorkspaceInitialStateWithRuntime({
        defaults: workspaceExecutionDefaults,
        fallbackAgentType: selectedItem?.workspace.agentType,
        project: initialProject,
        projectId: initialProjectId,
      })
    },
  )
  const [createModelOptions, setCreateModelOptions] = useState<ExecutionModelOption[]>([])
  const [createDefaultModel, setCreateDefaultModel] = useState('')
  const [createModelLoading, setCreateModelLoading] = useState(false)
  const [createModelError, setCreateModelError] = useState('')
  const [githubAppConfigured, setGitHubAppConfigured] = useState(true)
  const [githubAppInstallations, setGitHubAppInstallations] = useState<GitHubAppInstallationSummary[]>([])
  const [githubRepositories, setGitHubRepositories] = useState<WorkspaceGitHubRepositoryOption[]>([])
  const [githubRepositoriesLoading, setGitHubRepositoriesLoading] = useState(false)
  const createPanelProjectDefaultBranch = useMemo(
    () => workspaceScopedProjects.find((project) => project.id === createState.projectId)?.defaultBranch || DEFAULT_BRANCH_FALLBACK,
    [createState.projectId, workspaceScopedProjects],
  )
  const createPanelSelectedProject = useMemo(
    () => workspaceScopedProjects.find((project) => project.id === createState.projectId) ?? null,
    [createState.projectId, workspaceScopedProjects],
  )
  const executorOptions = useMemo(
    () => buildExecutorOptionsWithManagedCloud(executors, managedCloudRuntime),
    [executors, managedCloudRuntime],
  )
  const githubAppInstallationsRef = useRef<GitHubAppInstallationSummary[]>([])
  const loadGitHubAppInstallations = useCallback(async () => {
    try {
      const response = await api.listUserGitHubAppInstallations()
      githubAppInstallationsRef.current = response.installations
      setGitHubAppConfigured(response.configured)
      setGitHubAppInstallations(response.installations)
      return response
    } catch {
      githubAppInstallationsRef.current = []
      setGitHubAppConfigured(true)
      setGitHubAppInstallations([])
      return null
    }
  }, [])

  const loadGitHubRepositories = useCallback(async (installationIds?: string[]) => {
    const normalizedInstallationIds = (installationIds ?? [])
      .map((value) => Number(value || '0'))
      .filter((value) => Number.isFinite(value) && value > 0)
    if (normalizedInstallationIds.length < 1) {
      setGitHubRepositories([])
      setGitHubRepositoriesLoading(false)
      return
    }

    setGitHubRepositoriesLoading(true)
    try {
      const repositoriesByInstallation = await Promise.all(
        normalizedInstallationIds.map(async (installationId) => {
          const response = await api.listUserGitHubAppInstallationRepositories(installationId)
          const installation = githubAppInstallationsRef.current.find((item) => item.installationId === installationId) ?? null
          return response.repositories.map((repository) => ({
            ...repository,
            installationId,
            installationAccountLogin: installation?.accountLogin ?? String(installationId),
          }))
        }),
      )
      setGitHubRepositories(repositoriesByInstallation.flat())
    } catch (error) {
      setGitHubRepositories([])
      toast.error(error instanceof Error ? error.message : '读取 GitHub 仓库列表失败')
    } finally {
      setGitHubRepositoriesLoading(false)
    }
  }, [])

  const waitForClonedProjectReady = useCallback(async (projectId: string) => {
    const startedAt = Date.now()
    for (;;) {
      const response = await api.bootstrap({ scope: 'workspaces' })
      const latestProject = response.state.projects.find((project) => project.id === projectId) ?? null
      if (!latestProject) {
        throw new Error('新建项目后未能在状态中找到该项目。')
      }
      if (!latestProject.repositoryCloneStatus) {
        return { state: response.state, project: latestProject }
      }
      if (latestProject.repositoryCloneStatus === 'failed') {
        throw new Error(latestProject.repositoryCloneMessage?.trim() || '项目仓库克隆失败。')
      }
      if (Date.now() - startedAt >= PROJECT_CLONE_WAIT_TIMEOUT_MS) {
        throw new Error('项目仓库仍在克隆中，等待超时。请稍后从项目列表继续创建工作区。')
      }
      await new Promise((resolve) => setTimeout(resolve, PROJECT_CLONE_WAIT_INTERVAL_MS))
    }
  }, [])

  useEffect(() => {
    if (panelMode !== 'create') {
      return
    }

    let active = true
    void loadGitHubAppInstallations().then((response) => {
      if (!active) {
        return
      }
      const installationIds = response?.installations.map((installation) => String(installation.installationId)) ?? []
      if (installationIds.length > 0) {
        void loadGitHubRepositories(installationIds)
      } else {
        setGitHubRepositories([])
      }
    })

    return () => {
      active = false
    }
  }, [loadGitHubAppInstallations, loadGitHubRepositories, panelMode])


  const markCreateExecutorOffline = useCallback((executorId: string) => {
    const normalizedExecutorId = executorId.trim()
    if (!normalizedExecutorId) {
      return
    }

    queryClient.setQueryData<ExecutorRecord[]>(
      workspaceQueryKeys.executors(),
      (current) => current?.map((executor) => (
        executor.executorId === normalizedExecutorId
          ? { ...executor, status: 'offline' }
          : executor
      )) ?? current,
    )
    updateWorkspaceDirectoryCache((current) => current
      ? {
          ...current,
          executors: current.executors.map((executor) => (
            executor.executorId === normalizedExecutorId
              ? { ...executor, status: 'offline' }
              : executor
          )),
        }
      : current)
  }, [queryClient, updateWorkspaceDirectoryCache])
  const resolveDefaultExecutorIdForProject = useCallback((projectId: string) => {
    const project = workspaceScopedProjects.find((item) => item.id === projectId) ?? null
    return resolveDefaultWorkspaceCreationExecutorId(project, executorOptions, workspaceExecutionDefaults)
  }, [executorOptions, workspaceExecutionDefaults, workspaceScopedProjects])

  useEffect(() => {
    if (search.create === '1') {
      const nextProjectId = search.projectId || selectedProjectId || workspaceScopedProjects[0]?.id || ''
      const nextExecutorId = resolveDefaultExecutorIdForProject(nextProjectId)

      setCreateState((current) => {
        if (current.busy) {
          return current
        }

        if (!current.projectId) {
          const nextProject = workspaceScopedProjects.find((project) => project.id === nextProjectId) ?? null
          return createWorkspaceInitialStateWithRuntime({
            defaults: workspaceExecutionDefaults,
            executorId: nextExecutorId,
            fallbackAgentType: selectedItem?.workspace.agentType,
            project: nextProject,
            projectId: nextProjectId,
          })
        }

        if (search.projectId && search.projectId !== current.projectId) {
          const nextProject = workspaceScopedProjects.find((project) => project.id === nextProjectId) ?? null
          const nextState = createWorkspaceInitialStateWithRuntime({
            defaults: workspaceExecutionDefaults,
            executorId: nextExecutorId,
            fallbackAgentType: selectedItem?.workspace.agentType,
            project: nextProject,
            projectId: nextProjectId,
          })
          return {
            ...nextState,
            executionModel: current.executionModel,
            name: current.name,
            initialPrompt: current.initialPrompt,
            images: current.images,
          }
        }

        return current
      })
      setPanelMode('create')
      if (isMobile) {
        setMobileView('create')
      }
      return
    }

    setPanelMode('detail')
  }, [isMobile, resolveDefaultExecutorIdForProject, search.create, search.projectId, selectedItem?.workspace.agentType, selectedProjectId, setMobileView, setPanelMode, workspaceScopedProjects])

  useEffect(() => {
    setCreateState((current) => {
      const nextProjectId = current.projectId || selectedProjectId || workspaceScopedProjects[0]?.id || ''
      return current.projectId === nextProjectId
        ? current
        : {
            ...current,
            projectId: nextProjectId,
          }
    })
  }, [selectedProjectId, workspaceScopedProjects])

  useEffect(() => {
    if (!createState.projectId || visibleProjectIds.has(createState.projectId)) {
      return
    }

    setCreateState((current) => {
      const nextProjectId = workspaceScopedProjects[0]?.id || ''
      return current.projectId === nextProjectId
        ? current
        : {
            ...current,
            projectId: nextProjectId,
          }
    })
  }, [createState.projectId, visibleProjectIds, workspaceScopedProjects])

  useEffect(() => {
    if (panelMode !== 'create') {
      return
    }

    const nextExecutorId = resolveDefaultExecutorIdForProject(createState.projectId)
    const currentExecutor = executorOptions.find((executor) => executor.executorId === createState.executorId)
    if (!nextExecutorId || isUsableWorkspaceCreationExecutor(currentExecutor)) {
      return
    }

    setCreateState((current) => ({ ...current, executorId: nextExecutorId }))
  }, [createState.executorId, createState.projectId, executorOptions, panelMode, resolveDefaultExecutorIdForProject])

  useEffect(() => {
    if (panelMode !== 'create') {
      return
    }

    const owningExecutorId = createPanelSelectedProject?.preferredExecutorId?.trim() || ''
    if (
      !owningExecutorId
      || createPanelSelectedProject?.versionControl === 'git-remote'
      || createState.executorId === owningExecutorId
    ) {
      return
    }

    setCreateState((current) => ({
      ...current,
      executorId: owningExecutorId,
    }))
  }, [
    createPanelSelectedProject?.preferredExecutorId,
    createPanelSelectedProject?.versionControl,
    createState.executorId,
    panelMode,
  ])

  useEffect(() => {
    if (panelMode !== 'create') return

    if (createState.branchVersionControl === 'none' || createPanelSelectedProject?.versionControl === 'none') {
      setCreateState((current) => ({
        ...current,
        workingDirectoryMode: 'original-dir',
        autoCommitEnabled: false,
        branchOptions: [],
        branchSources: undefined,
        selectedBranch: '',
        defaultBranch: '',
        branchLoading: false,
        branchVersionControl: 'none',
        branchMessage: t('workspace.createPanel.branchMessages.nonGitProject'),
      }))
      return
    }

    if (createState.workingDirectoryMode === 'original-dir') {
      setCreateState((current) => ({
        ...current,
        branchOptions: [],
        branchSources: undefined,
        selectedBranch: '',
        defaultBranch: '',
        branchLoading: false,
        branchVersionControl: createPanelSelectedProject?.versionControl,
        branchMessage: t('workspace.createPanel.branchMessages.originalDirDirect'),
      }))
      return
    }

    if (!createState.projectId || !createState.executorId) {
      setCreateState((current) => ({
        ...current,
        branchOptions: [],
        branchSources: undefined,
        selectedBranch: '',
        defaultBranch: '',
        branchLoading: false,
        branchVersionControl: undefined,
        branchMessage: current.executorId ? t('workspace.page.errors.selectProjectFirst') : t('workspace.page.errors.selectExecutorFirst'),
      }))
      return
    }

    const cloneBlockReason = resolveWorkspaceCreationCloneBlockReason(createPanelSelectedProject, t)
    if (cloneBlockReason) {
      setCreateState((current) => ({
        ...current,
        branchOptions: [],
        selectedBranch: '',
        defaultBranch: createPanelProjectDefaultBranch,
        branchLoading: false,
        branchVersionControl: undefined,
        branchMessage: cloneBlockReason,
      }))
      return
    }

    let cancelled = false
    setCreateState((current) => ({
      ...current,
      branchLoading: true,
      branchMessage: '',
    }))

    void queryClient.fetchQuery({
      queryKey: workspaceQueryKeys.projectBranches(createState.projectId, createState.executorId),
      queryFn: () => api.listProjectBranches(createState.projectId, createState.executorId),
      staleTime: 30_000,
    })
      .then((response) => {
        if (cancelled) return
        if (isNonGitBranchSnapshot(response)) {
          setCreateState((current) => ({
            ...current,
            workingDirectoryMode: 'original-dir',
            autoCommitEnabled: false,
            branchOptions: [],
            branchSources: undefined,
            selectedBranch: '',
            defaultBranch: response.defaultBranch || createPanelProjectDefaultBranch,
            branchVersionControl: 'none',
            branchMessage: t('workspace.createPanel.branchMessages.nonGitProject'),
          }))
          return
        }

        if (!response.ok && response.branches.length === 0) {
          if (isExecutorOfflineBranchMessage(response.message)) {
            markCreateExecutorOffline(createState.executorId)
          }
          setCreateState((current) => ({
            ...current,
            branchOptions: [],
            branchSources: undefined,
            selectedBranch: '',
            defaultBranch: response.defaultBranch || createPanelProjectDefaultBranch,
            branchVersionControl: response.versionControl,
            branchMessage: isExecutorOfflineBranchMessage(response.message)
              ? buildExecutorOfflineBranchMessage(t)
              : response.message?.trim() || t('workspace.page.errors.loadBranchesFailed'),
          }))
          return
        }

        const preferredBranch = readWorkspaceCreateBaseBranchPreference(createState.projectId)
        setCreateState((current) => ({
          ...current,
          ...resolveBranchSelectionState({
            branches: response.branches,
            currentBranch: current.selectedBranch || preferredBranch,
            defaultBranch: response.defaultBranch,
            fallbackBranch: createPanelProjectDefaultBranch,
            language,
            message: response.message,
          }),
          branchSources: response.branchSources,
          branchVersionControl: response.versionControl,
        }))
      })
      .catch((error) => {
        if (cancelled) return
        const preferredBranch = readWorkspaceCreateBaseBranchPreference(createState.projectId)
        const errorMessage = error instanceof Error ? error.message : t('workspace.page.errors.loadBranchesFailed')
        const executorOffline = isExecutorOfflineBranchMessage(errorMessage)
        if (executorOffline) {
          markCreateExecutorOffline(createState.executorId)
        }
        setCreateState((current) => ({
          ...current,
          ...resolveBranchSelectionState({
            branches: [],
            currentBranch: current.selectedBranch || preferredBranch,
            fallbackBranch: createPanelProjectDefaultBranch,
            language,
            message: executorOffline
              ? buildExecutorOfflineBranchMessage(t)
              : `${errorMessage} ${t('workspace.page.errors.fallbackToDefaultBranch')}`,
          }),
          branchSources: undefined,
          branchVersionControl: undefined,
        }))
      })
      .finally(() => {
        if (cancelled) return
        setCreateState((current) => ({ ...current, branchLoading: false }))
      })

    return () => {
      cancelled = true
    }
  }, [
    createPanelSelectedProject?.repositoryCloneMessage,
    createPanelSelectedProject?.repositoryCloneStatus,
    createPanelSelectedProject?.versionControl,
    createPanelProjectDefaultBranch,
    createState.branchVersionControl,
    createState.executorId,
    createState.projectId,
    createState.workingDirectoryMode,
    language,
    panelMode,
    queryClient,
    t,
    markCreateExecutorOffline,
  ])

  useEffect(() => {
    if (panelMode !== 'create') {
      return
    }

    let cancelled = false
    let refreshTimer: ReturnType<typeof setTimeout> | undefined
    const modelAgentType = createState.agentType
    const modelExecutorId = createState.executorId.trim()

    if ((modelAgentType === 'OpenCode' || modelAgentType === 'Pi') && !modelExecutorId) {
      setCreateModelOptions([])
      setCreateDefaultModel('')
      setCreateModelError('')
      setCreateModelLoading(false)
      setCreateState((current) => current.executionModel ? { ...current, executionModel: '' } : current)
      return
    }

    // 首次返回带 runtimePending 时，worker 运行时模型仍在后台导出：
    // 稍后带 waitRuntime 补拉一次完整列表（不阻塞 UI，失败则保留模型库内容）。
    const scheduleCreateModelRefresh = () => {
      if (refreshTimer) {
        return
      }
      refreshTimer = setTimeout(() => {
        if (cancelled) {
          return
        }
        void api.listAgentModels(modelAgentType, modelExecutorId || undefined, { waitRuntime: true })
          .then((refreshed) => {
            if (cancelled || refreshed.runtimePending) {
              return
            }
            setCreateModelOptions(refreshed.models)
            setCreateDefaultModel(refreshed.defaultModel ?? '')
            setCreateModelError('')
            setCreateState((current) => {
              if (!current.executionModel) {
                return current
              }
              const matchedModel = resolveMatchingAgentExecutionModelOptionId(
                current.agentType,
                refreshed.models,
                current.executionModel,
              )
              return matchedModel ? current : { ...current, executionModel: '' }
            })
          })
          .catch(() => {
            // 保持模型库列表；下次切换 Agent/执行节点时会重新加载。
          })
      }, RUNTIME_MODEL_REFRESH_DELAY_MS)
    }

    setCreateModelLoading(true)
    setCreateModelError('')
    void queryClient.fetchQuery({
      queryKey: workspaceQueryKeys.agentModels(modelAgentType, modelExecutorId || undefined),
      queryFn: () => api.listAgentModels(modelAgentType, modelExecutorId || undefined),
      staleTime: MODEL_OPTIONS_CACHE_TTL_MS,
    })
      .then((response) => {
        if (cancelled) {
          return
        }

        setCreateModelOptions(response.models)
        setCreateDefaultModel(response.defaultModel ?? '')
        setCreateModelError('')
        setCreateState((current) => {
          if (!current.executionModel) {
            return current
          }
          const matchedModel = resolveMatchingAgentExecutionModelOptionId(
            current.agentType,
            response.models,
            current.executionModel,
          )
          return matchedModel ? current : { ...current, executionModel: '' }
        })
        if (response.runtimePending) {
          scheduleCreateModelRefresh()
        }
      })
      .catch((error) => {
        if (cancelled) {
          return
        }
        setCreateModelOptions([])
        setCreateDefaultModel('')
        setCreateModelError(error instanceof Error ? error.message : '模型列表加载失败。')
      })
      .finally(() => {
        if (!cancelled) {
          setCreateModelLoading(false)
        }
      })

    return () => {
      cancelled = true
      if (refreshTimer) {
        clearTimeout(refreshTimer)
      }
    }
  }, [createState.agentType, createState.executorId, panelMode, queryClient])

  const openCreatePanel = useCallback(() => {
    const nextProjectId = selectedProjectId || selectedItem?.project.id || workspaceScopedProjects[0]?.id || ''
    const nextExecutorId = resolveDefaultExecutorIdForProject(nextProjectId)
    const nextProject = workspaceScopedProjects.find((project) => project.id === nextProjectId) ?? null

    clearPendingWorkspaceSessionSelection()
    setCreateState(createWorkspaceInitialStateWithRuntime({
      defaults: workspaceExecutionDefaults,
      executorId: nextExecutorId,
      fallbackAgentType: selectedItem?.workspace.agentType,
      project: nextProject,
      projectId: nextProjectId,
    }))
    setPanelMode('create')
    updateWorkspaceSearch({
      projectId: nextProjectId || undefined,
      create: '1',
      workspaceId: undefined,
      taskId: undefined,
      workspaceSessionId: undefined,
    })
    if (isMobile) {
      setMobileView('create')
    }
  }, [
    clearPendingWorkspaceSessionSelection,
    isMobile,
    resolveDefaultExecutorIdForProject,
    selectedItem?.project.id,
    selectedItem?.workspace.agentType,
    selectedProjectId,
    setMobileView,
    setPanelMode,
    updateWorkspaceSearch,
    workspaceScopedProjects,
  ])

  const openCreatePanelForProject = useCallback((projectId: string) => {
    const nextExecutorId = resolveDefaultExecutorIdForProject(projectId)
    const nextProject = workspaceScopedProjects.find((project) => project.id === projectId) ?? null

    clearPendingWorkspaceSessionSelection()
    setCreateState(createWorkspaceInitialStateWithRuntime({
      defaults: workspaceExecutionDefaults,
      executorId: nextExecutorId,
      project: nextProject,
      projectId,
    }))
    setPanelMode('create')
    updateWorkspaceSearch({
      projectId,
      create: '1',
      workspaceId: undefined,
      taskId: undefined,
      workspaceSessionId: undefined,
    })
    if (isMobile) {
      setMobileView('create')
    }
  }, [
    clearPendingWorkspaceSessionSelection,
    isMobile,
    resolveDefaultExecutorIdForProject,
    setMobileView,
    setPanelMode,
    updateWorkspaceSearch,
    workspaceScopedProjects,
  ])

  const closeCreatePanel = useCallback((selectedWorkspaceId: string) => {
    const nextProjectId = selectedProjectId || workspaceScopedProjects[0]?.id || ''
    const nextProject = workspaceScopedProjects.find((project) => project.id === nextProjectId) ?? null
    setCreateState(createWorkspaceInitialStateWithRuntime({
      defaults: workspaceExecutionDefaults,
      fallbackAgentType: selectedItem?.workspace.agentType,
      project: nextProject,
      projectId: nextProjectId,
    }))
    setPanelMode('detail')
    updateWorkspaceSearch({
      create: undefined,
      workspaceId: selectedWorkspaceId || undefined,
      taskId: undefined,
      workspaceSessionId: undefined,
    })
    if (isMobile) {
      setMobileView(selectedWorkspaceId ? 'detail' : 'list')
    }
  }, [
    isMobile,
    selectedProjectId,
    selectedItem?.workspace.agentType,
    setMobileView,
    setPanelMode,
    updateWorkspaceSearch,
    workspaceScopedProjects,
  ])

  const handleCreateWorkspace = async (options: { startAgent?: boolean } = {}) => {
    const startAgent = options.startAgent ?? true
    const nextInitialPrompt = createState.initialPrompt.trim()
    const nextImages = createState.images
    const manualWorkspaceName = createState.name.trim()
    const firstImage = startAgent ? nextImages[0] : undefined
    const fallbackName = manualWorkspaceName
      || buildWorkspaceTitleFallback(
        nextInitialPrompt,
        firstImage?.filename,
        startAgent
          ? t('workspace.createPanel.title')
          : t('workspace.createPanel.emptyWorkspaceFallbackTitle'),
      )
    const nextWorkspaceName = fallbackName
    const nextTitleOrigin: WorkspaceSessionTitleOrigin = manualWorkspaceName || !startAgent ? 'manual' : 'system'
    const nextProjectSource = createState.projectSource
    let nextProjectId = createState.projectId
    const nextExecutorId = createState.executorId
    const nextExecutionModel = createState.executionModel.trim()
    const nextAgentSettings = resolveWorkspaceCreationAgentSettings({
      agentType: createState.agentType,
      globalAgentSettings: agentSettings,
      scopedAgentSettings: createState.agentSettings,
    })
    const nextWorkingDirectoryMode = createState.workingDirectoryMode
    const nextAutoCommitEnabled = createState.autoCommitEnabled
    const nextSelectedBranch = createState.selectedBranch
    const needsBranch = createState.workingDirectoryMode !== 'original-dir'
    if (nextProjectSource === 'existing' && !createState.projectId) {
      toast.error(t('workspace.page.errors.selectProjectFirst'))
      return
    }
    if (nextProjectSource === 'github-app') {
      if (!createState.githubInstallationId) {
        toast.error('请先选择 GitHub App installation')
        return
      }
      if (!createState.githubRepositoryId || !createState.githubRepositoryCloneUrl.trim()) {
        toast.error('请先选择 GitHub 仓库')
        return
      }
    }
    if (!createState.executorId) {
      toast.error(t('workspace.page.errors.selectExecutorFirst'))
      return
    }
    const cloneBlockReason = nextProjectSource === 'existing'
      ? resolveWorkspaceCreationCloneBlockReason(createPanelSelectedProject, t)
      : ''
    if (cloneBlockReason) {
      toast.error(cloneBlockReason)
      return
    }
    if (needsBranch && !createState.selectedBranch) {
      toast.error(t('workspace.page.errors.selectBaseBranchFirst'))
      return
    }
    if (startAgent && !nextInitialPrompt && nextImages.length === 0) {
      toast.error(t('workspace.createPanel.promptRequired'))
      return
    }
    if (!startAgent && nextImages.length > 0) {
      toast.error(t('workspace.createPanel.emptyWorkspaceImageBlocked'))
      return
    }

    setCreateState((current) => ({ ...current, busy: true, creatingStep: 'workspace' }))

    let workspaceVisible = false
    try {
      let resolvedProjectState: AppState | null = null
      let resolvedCreatePanelProject = createPanelSelectedProject
      if (nextProjectSource === 'github-app') {
        const githubRepositoryDisplayName = createState.githubRepositoryName.trim() || createState.githubRepositoryCloneUrl.trim()
        const cloneResponse = await api.cloneProject({
          name: githubRepositoryDisplayName.split('/').pop() || githubRepositoryDisplayName,
          gitUrl: createState.githubRepositoryCloneUrl,
          preferredExecutorId: nextExecutorId,
          githubInstallationId: Number(createState.githubInstallationId),
          githubRepositoryId: Number(createState.githubRepositoryId),
          githubRepositoryName: createState.githubRepositoryName.trim() || undefined,
        })
        nextProjectId = cloneResponse.state.selectedProjectId || cloneResponse.state.projects[0]?.id || ''
        if (!nextProjectId) {
          throw new Error('GitHub 仓库项目创建成功，但未返回项目 ID。')
        }
        const readyResult = await waitForClonedProjectReady(nextProjectId)
        resolvedProjectState = readyResult.state
        resolvedCreatePanelProject = readyResult.project
        if (needsBranch && nextSelectedBranch) {
          writeWorkspaceCreateBaseBranchPreference(nextProjectId, nextSelectedBranch)
        }
        writeWorkspaceCreateRuntimePreference(nextProjectId, {
          agentType: createState.agentType,
          workingDirectoryMode: nextWorkingDirectoryMode,
        })
        setState(readyResult.state)
      } else if (nextProjectSource !== 'playground') {
        if (needsBranch) {
          writeWorkspaceCreateBaseBranchPreference(nextProjectId, nextSelectedBranch)
        }
        writeWorkspaceCreateRuntimePreference(nextProjectId, {
          agentType: createState.agentType,
          workingDirectoryMode: nextWorkingDirectoryMode,
        })
      }

      const creation = await runWorkspaceCreationUseCase({
        createWorkspace: () => api.createWorkspace(nextProjectId, {
          executorNodeId: nextExecutorId,
          agentType: createState.agentType,
          executionModel: nextExecutionModel || undefined,
          agentSettings: nextAgentSettings,
          workingDirectoryMode: nextWorkingDirectoryMode,
          autoCommitEnabled: nextAutoCommitEnabled,
          name: nextWorkspaceName,
          initialPrompt: startAgent ? nextInitialPrompt || undefined : undefined,
          imageFilename: firstImage?.filename,
          imageDataUrl: undefined,
          suggestedBaseBranch: needsBranch ? nextSelectedBranch : undefined,
          nameOrigin: nextTitleOrigin,
          titleOrigin: nextTitleOrigin,
          deferInitialization: true,
        }),
        onWorkspaceCreated: async (response) => {
          if (response.project) {
            setState((current) => ({
              ...current,
              projects: current.projects.map((project) => project.id === response.project?.id ? response.project : project),
            }))
          } else if (resolvedProjectState) {
            setState(resolvedProjectState)
          }
          void api.listExecutors().then((executorResponse) => {
            updateWorkspaceDirectoryCache((current) => current ? { ...current, executors: executorResponse.executors } : current)
          }).catch(() => undefined)
          queryClient.setQueryData<ProjectWorkspacesQueryData>(
            workspaceQueryKeys.projectWorkspaces(nextProjectId),
            (current) => ({ project: response.project ?? current?.project ?? resolvedCreatePanelProject, workspaces: response.workspaces }),
          )
          updateWorkspaceDirectoryCache((current) => current ? {
            ...current,
            workspacesByProject: { ...current.workspacesByProject, [nextProjectId]: response.workspaces },
          } : current)
        },
        onWorkspaceSessionReady: ({ response, sessionResponse, workspaceSessionId }) => {
          const workspaceSession = sessionResponse.workspaceSession
            ?? sessionResponse.state.workspaceSessions.find((session) => session.id === workspaceSessionId)
            ?? null
          pendingWorkspaceSelectionIdRef.current = response.workspace.id
          if (workspaceSession) {
            pendingWorkspaceSessionSelectionIdRef.current = workspaceSession.id
            setOptimisticWorkspaceSession(workspaceSession)
          } else {
            clearPendingWorkspaceSessionSelection()
          }
          openWorkspaceTab({
            workspaceId: response.workspace.id,
            projectId: nextProjectId,
            workspaceSessionId: workspaceSessionId || undefined,
          })
          setState(sessionResponse.state)
          setSelectedProjectId(nextProjectId)
          setSelectedWorkspaceId(response.workspace.id)
          setSelectedWorkspaceSessionId(workspaceSessionId)
          setPendingAutoEnvironmentInstallWorkspaceId(null)
          updateWorkspaceSearch({
            projectId: nextProjectId,
            workspaceId: response.workspace.id,
            taskId: undefined,
            workspaceSessionId: workspaceSessionId || undefined,
            panel: undefined,
            create: undefined,
          })
          setPanelMode('detail')
          if (isMobile) {
            setMobileView('list')
          }
          setCreateState(createWorkspaceInitialStateWithRuntime({
            defaults: workspaceExecutionDefaults,
            fallbackAgentType: workspaceSession?.agentType ?? response.workspace.agentType,
            project: response.project ?? resolvedCreatePanelProject,
            projectId: nextProjectId,
          }))
          workspaceVisible = true
          toast.success(response.message || t('workspace.created'))
        },
        createSession: (workspaceResponse) => api.createWorkspaceSession(workspaceResponse.workspace.id, {
          agentType: createState.agentType,
          executionModel: nextExecutionModel || undefined,
          agentSettings: nextAgentSettings,
          baseBranch: needsBranch ? nextSelectedBranch : undefined,
          createNewSession: true,
          title: workspaceResponse.workspace.name,
        }),
        fallbackTaskId: search.taskId,
        startAgent,
        initialPrompt: nextInitialPrompt,
        images: nextImages,
        deferUntilWorkspaceReady: true,
        onSessionCreate: () => setCreateState((current) => ({ ...current, creatingStep: 'session' })),
        uploadImage: async (taskId, image) => {
          const source = nextImages.find((item) => item.id === image.id)!
          const result = await api.uploadImage(taskId, await readWorkspaceCreationImage(source.file), image.filename)
          return { id: result.id, url: result.url, filename: image.filename, contentType: image.contentType }
        },
        onUploadError: (_image, error) => {
          const message = error instanceof Error ? error.message : t('workspace.createPanel.imageUploadFailed', { defaultValue: '图片上传失败。' })
          toast.error(message)
        },
        enqueueInitialMessage: (input) => api.enqueueTaskChatMessage(
          input.taskId,
          input.message,
          input.workspaceId,
          input.workspaceSessionId,
          input.attachments,
          undefined,
          undefined,
          { deferUntilWorkspaceReady: input.deferUntilWorkspaceReady, dedupeKey: `workspace-initial:${input.taskId}:${input.workspaceId}:${input.workspaceSessionId}` },
        ),
        onInitialMessageError: (error) => toast.error(error instanceof Error ? error.message : t('workspace.createPanel.initialMessageSendFailed', { defaultValue: '工作区已创建，但首条消息发送失败。' })),
      })
      const { response, taskId: nextTaskId, workspaceSessionId: nextWorkspaceSessionId } = creation
      if (creation.queuedInitialMessage) {
        const queuedInitialMessage = creation.queuedInitialMessage
        queryClient.setQueryData(
          workspaceQueryKeys.chatSession(nextTaskId, response.workspace.id, nextWorkspaceSessionId),
          queuedInitialMessage.snapshot,
        )
        setCachedTaskChatSession(
          nextTaskId,
          response.workspace.id,
          nextWorkspaceSessionId,
          queuedInitialMessage.snapshot,
        )
      }
      nextImages.forEach((image) => {
        if (image.previewUrl) {
          URL.revokeObjectURL(image.previewUrl)
        }
      })
    } catch (error) {
      setPendingAutoEnvironmentInstallWorkspaceId(null)
      toast.error(workspaceVisible
        ? (error instanceof Error ? error.message : t('workspace.createPanel.initialMessageSendFailed', { defaultValue: '工作区已创建，但后台初始化失败。' }))
        : (error instanceof Error ? error.message : t('workspace.page.errors.createFailed')))
      if (!workspaceVisible) {
        setCreateState((current) => ({ ...current, busy: false, creatingStep: '' }))
      }
    }
  }

  const handleUpdateCreateState = (patch: Partial<CreateWorkspaceState>) => {
    if (patch.selectedBranch && createState.projectId && createState.projectSource === 'existing') {
      writeWorkspaceCreateBaseBranchPreference(createState.projectId, patch.selectedBranch)
    }

    if (createState.projectId && createState.projectSource === 'existing' && (patch.agentType || patch.workingDirectoryMode)) {
      writeWorkspaceCreateRuntimePreference(createState.projectId, {
        agentType: patch.agentType ?? createState.agentType,
        workingDirectoryMode: patch.workingDirectoryMode ?? createState.workingDirectoryMode,
      })
    }

    setCreateState((current) => {
      const nextProjectId = patch.projectId ?? current.projectId
      const projectChanged = Boolean(patch.projectId && patch.projectId !== current.projectId)
      const projectSourceChanged = Boolean(patch.projectSource && patch.projectSource !== current.projectSource)
      const nextProject = projectChanged
        ? workspaceScopedProjects.find((project) => project.id === nextProjectId) ?? null
        : createPanelSelectedProject
      const projectRuntimePreference = projectChanged
        ? resolvePreferredWorkspaceCreationRuntime({
            defaults: workspaceExecutionDefaults,
            fallbackAgentType: selectedItem?.workspace.agentType,
            project: nextProject,
            projectId: nextProjectId,
          })
        : null
      const nextBranchVersionControl = patch.branchVersionControl
        ?? (projectChanged ? nextProject?.versionControl : current.branchVersionControl)
      const defaultExecutorId = projectChanged ? resolveDefaultExecutorIdForProject(nextProjectId) : ''
      const nextAgentType = patch.agentType ?? projectRuntimePreference?.agentType ?? current.agentType
      const nextWorkingDirectoryMode = nextBranchVersionControl === 'none'
        ? 'original-dir'
        : patch.workingDirectoryMode ?? projectRuntimePreference?.workingDirectoryMode ?? current.workingDirectoryMode
      const agentChanged = nextAgentType !== current.agentType
      const switchingToExistingProject = projectSourceChanged && patch.projectSource === 'existing'
      const switchingToGitHubProject = projectSourceChanged && patch.projectSource === 'github-app'
      const switchingToPlayground = projectSourceChanged && patch.projectSource === 'playground'
      const defaultGitHubInstallationId = switchingToGitHubProject && githubAppInstallations.length === 1
        ? String(githubAppInstallations[0].installationId)
        : ''
      return {
        ...current,
        ...patch,
        projectId: switchingToGitHubProject
          ? ''
          : switchingToPlayground
            ? PLAYGROUND_PROJECT_ID
            : nextProjectId,
        executorId: projectChanged ? defaultExecutorId : patch.executorId ?? current.executorId,
        agentType: nextAgentType,
        agentSettings: agentChanged || projectChanged ? patch.agentSettings : patch.agentSettings ?? current.agentSettings,
        executionModel: projectChanged
          ? projectRuntimePreference?.executionModel ?? ''
          : agentChanged ? '' : patch.executionModel ?? current.executionModel,
        workingDirectoryMode: switchingToPlayground
          ? 'original-dir' as const
          : nextWorkingDirectoryMode,
        branchVersionControl: switchingToPlayground ? 'none' as const : nextBranchVersionControl,
        branchOptions: switchingToPlayground ? [] : current.branchOptions,
        selectedBranch: switchingToPlayground ? '' : current.selectedBranch,
        branchMessage: switchingToPlayground ? '' : current.branchMessage,
        githubInstallationId: switchingToExistingProject || switchingToPlayground
          ? ''
          : patch.githubInstallationId ?? (switchingToGitHubProject ? defaultGitHubInstallationId : current.githubInstallationId),
        githubRepositoryId: switchingToExistingProject || switchingToPlayground ? '' : patch.githubRepositoryId ?? current.githubRepositoryId,
        githubRepositoryName: switchingToExistingProject || switchingToPlayground ? '' : patch.githubRepositoryName ?? current.githubRepositoryName,
        githubRepositoryCloneUrl: switchingToExistingProject || switchingToPlayground ? '' : patch.githubRepositoryCloneUrl ?? current.githubRepositoryCloneUrl,
        githubRepositoryDefaultBranch: switchingToExistingProject || switchingToPlayground ? '' : patch.githubRepositoryDefaultBranch ?? current.githubRepositoryDefaultBranch,
        autoCommitEnabled: switchingToPlayground
          ? false
          : patch.workingDirectoryMode
            ? patch.autoCommitEnabled ?? (nextWorkingDirectoryMode !== 'original-dir' && nextBranchVersionControl !== 'none')
            : nextBranchVersionControl === 'none'
              ? false
              : patch.autoCommitEnabled ?? current.autoCommitEnabled,
      }
    })
  }

  const connectGitHubApp = useCallback(async () => {
    const commitAuthorName = user?.name?.trim() || ''
    const commitAuthorEmail = user?.email?.trim() || ''
    if (!commitAuthorName || !EMAIL_PATTERN.test(commitAuthorEmail)) {
      toast.error('当前账号缺少可用的 Git 提交用户名或邮箱，请先到设置页补全。')
      return
    }

    try {
      const returnTo = `${window.location.pathname}${window.location.search}`
      const response = await api.createUserGitHubAppConnectUrl(returnTo, {
        commitAuthorName,
        commitAuthorEmail,
      })
      if (response.alreadyInstalled) {
        await loadGitHubAppInstallations()
        toast.success(response.message ?? '检测到 GitHub App 已安装，已重新连接。')
        return
      }
      if (!response.url) {
        toast.error(response.message ?? '无法打开 GitHub 授权页面')
        return
      }
      window.location.assign(response.url)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '无法打开 GitHub 授权页面')
    }
  }, [user?.email, user?.name, loadGitHubAppInstallations])

  return {
    closeCreatePanel,
    connectGitHubApp,
    createPanelSelectedProject,
    createDefaultModel,
    githubAppConfigured,
    githubAppInstallations,
    githubRepositories,
    githubRepositoriesLoading,
    createModelError,
    createModelLoading,
    createModelOptions,
    createState,
    executorOptions,
    handleCreateWorkspace,
    loadGitHubRepositories,
    handleUpdateCreateState,
    openCreatePanel,
    openCreatePanelForProject,
  }
}
