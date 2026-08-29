/**
 * [INPUT] Kanban route search params, selected task detail, and workspace-scoped app state.
 * [OUTPUT] The selected project board with a freshly loaded task assignee catalog.
 * [POS] Keeps sidebar project navigation stable while the collaboration scope loads.
 * [PROTOCOL]: Update this header when changing this file, then check AGENTS.md.
 */
import { useQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { ProjectEditDialog } from '../components/project-edit-dialog'
import type { ExecutorSelectOption } from '../components/ui/executor-select'
import { useApp } from '../lib/app-provider'
import { api, getAuthHeaders, resolveApiUrl, type ProjectAssignee, type TaskQuickCreatePayload } from '../lib/api'
import { getFilteredTasks } from '../lib/app-helpers'
import { buildProjectPayload, createEmptyProjectDraft, projectToDraft, type ProjectFormDraft } from '../lib/project-form'
import { useTranslation } from '../lib/i18n/react'
import { loadProjectAssignees } from '../lib/project-collaboration-data'
import { useExecutorRuntimeData } from '../lib/use-executor-runtime-data'
import { useProjectWorkspacesData } from '../lib/use-project-workspaces-data'
import { useWorkspaceScopedProjects } from '../lib/use-workspace-scoped-projects'
import { useAutoRefreshTaskPullRequests } from '../lib/use-auto-refresh-task-pull-requests'
import type { CreateTaskFormPayload } from '../components/kanban/create-task-modal'
import { KanbanPage } from '../components/kanban/kanban-page'
import { buildWorkspaceRouteSearch } from './-workspace-route-shared'
import { deriveExecutionCenter } from '@shared/task-orchestrator'
import type { AppState, ExecutorRecord, Project, ProjectBinding, ProjectPullRequestReviewSummary, Task, TaskStatus, Workspace } from '@shared/types'
import { resolveTaskIndexedPullRequestDisplay, type TaskPullRequestDisplay } from '../lib/task-pull-request'

export const Route = createFileRoute('/kanban')({
  component: KanbanRoute,
  validateSearch: (search: Record<string, unknown>) => ({
    projectId: (search.projectId as string) || undefined,
    taskId: (search.taskId as string) || undefined,
    createTask: search.createTask === '1' ? '1' : undefined,
  }),
})

const resolveKanbanFileTreeSource = (params: {
  executors: ExecutorRecord[]
  project: Project | null
  projectBindings: ProjectBinding[]
  workspaces: Workspace[]
}) => {
  const { executors, project, projectBindings, workspaces } = params
  if (!project) {
    return []
  }

  const executorsById = new Map(executors.map((executor) => [executor.executorId, executor]))
  const activeBindings = projectBindings.filter((binding) => binding.projectId === project.id && binding.isActive)
  const repoReadyWorkspaces = workspaces.filter((workspace) => workspace.projectId === project.id && workspace.repoReady)
  const sourceByExecutorId = new Map<string, {
    executorId: string
    executorName: string
    machineName: string
    initialDirectoryPath: string
  }>()

  const registerSource = (executorId?: string, initialDirectoryPath?: string) => {
    const normalizedExecutorId = executorId?.trim() || ''
    const normalizedDirectoryPath = initialDirectoryPath?.trim() || ''
    const matchedExecutor = normalizedExecutorId ? executorsById.get(normalizedExecutorId) : undefined

    if (!matchedExecutor || !normalizedDirectoryPath || sourceByExecutorId.has(normalizedExecutorId)) {
      return
    }

    sourceByExecutorId.set(normalizedExecutorId, {
      executorId: normalizedExecutorId,
      executorName: matchedExecutor.name,
      machineName: matchedExecutor.machineName,
      initialDirectoryPath: normalizedDirectoryPath,
    })
  }

  for (const workspace of repoReadyWorkspaces) {
    registerSource(workspace.executorNodeId, workspace.repoPath)
  }

  for (const binding of activeBindings) {
    registerSource(binding.nodeId, binding.pathHint)
  }

  registerSource(project.preferredExecutorId, project.rootPath)

  if (sourceByExecutorId.size === 0 && executors[0]?.executorId && project.rootPath?.trim()) {
    registerSource(executors[0].executorId, project.rootPath)
  }

  const orderedExecutorIds = [
    project.preferredExecutorId,
    ...activeBindings.map((binding) => binding.nodeId),
    ...repoReadyWorkspaces.map((workspace) => workspace.executorNodeId),
    ...sourceByExecutorId.keys(),
  ]
    .map((value) => value?.trim() || '')
    .filter((value, index, items) => value && items.indexOf(value) === index)

  return orderedExecutorIds
    .map((executorId) => sourceByExecutorId.get(executorId))
    .filter((source): source is NonNullable<typeof source> => Boolean(source))
}

function KanbanRoute() {
  const { t } = useTranslation()
  const search = Route.useSearch()
  const { state, selectedProjectId: contextProjectId, setSelectedProjectId, setSelectedTaskId, busy, runMutation, setState, setBusy } = useApp()
  const { visibleProjects: workspaceScopedProjects, visibleProjectIds } = useWorkspaceScopedProjects(
    state.projects,
    undefined,
    { pinnedProjectIds: search.projectId ? [search.projectId] : [] },
  )
  const [assignees, setAssignees] = useState<ProjectAssignee[]>([])
  const [projectEditOpen, setProjectEditOpen] = useState(false)
  const [projectReimportBusy, setProjectReimportBusy] = useState(false)
  const [projectDraft, setProjectDraft] = useState<ProjectFormDraft>(createEmptyProjectDraft)
  const [selectedFileTreeExecutorId, setSelectedFileTreeExecutorId] = useState('')
  const [quickCreateRecoveryDescription, setQuickCreateRecoveryDescription] = useState('')
  const { executors } = useExecutorRuntimeData()

  const selectedProjectId = search.projectId && visibleProjectIds.has(search.projectId)
    ? search.projectId
    : (visibleProjectIds.has(contextProjectId) ? contextProjectId : (workspaceScopedProjects[0]?.id || ''))
  const selectedTaskId = search.taskId ?? ''
  const selectedProject = workspaceScopedProjects.find((project) => project.id === selectedProjectId) ?? null
  const filteredTasks = selectedProject ? getFilteredTasks(state, selectedProject.id) : []
  const {
    project: projectWorkspacesProject,
    workspaces: projectWorkspaces,
    workspacesLoading: projectWorkspacesLoading,
  } = useProjectWorkspacesData(selectedProject?.id ?? '')
  const kanbanProjectId = selectedProject?.id ?? ''
  const kanbanPullRequestsQuery = useQuery({
    queryKey: ['kanban', 'github-pull-requests', kanbanProjectId],
    enabled: Boolean(kanbanProjectId),
    queryFn: async () => {
      const items: ProjectPullRequestReviewSummary[] = []
      let cursor: string | undefined
      do {
        const response = await api.listProjectGitHubPullRequests({
          projectId: kanbanProjectId,
          cursor,
          limit: 100,
          scope: 'summary',
        })
        items.push(...response.pullRequests)
        cursor = response.hasMore ? response.nextCursor : undefined
      } while (cursor)
      return items
    },
    staleTime: 10_000,
    refetchInterval: typeof document !== 'undefined' && document.hidden ? false : 10_000,
  })
  const kanbanPullRequestBindingsQuery = useQuery({
    queryKey: ['kanban', 'github-resource-bindings', kanbanProjectId],
    enabled: Boolean(kanbanProjectId),
    queryFn: () => api.listGitHubResourceBindings({
      projectId: kanbanProjectId,
      resourceType: 'pull_request',
    }).then((response) => response.bindings),
    staleTime: 10_000,
    refetchInterval: typeof document !== 'undefined' && document.hidden ? false : 10_000,
  })
  const kanbanAgentActivityQuery = useQuery({
    queryKey: ['kanban', 'agent-activity', kanbanProjectId],
    enabled: Boolean(kanbanProjectId),
    queryFn: () => api.getProjectAgentActivitySummary(kanbanProjectId).then((response) => response.activeTaskIds),
    staleTime: 2_500,
    refetchInterval: typeof document !== 'undefined' && document.hidden ? false : 2_500,
  })
  const projectPullRequests = kanbanProjectId ? kanbanPullRequestsQuery.data ?? [] : []
  const projectPullRequestBindings = kanbanProjectId ? kanbanPullRequestBindingsQuery.data ?? [] : []
  const activeAgentTaskIds = kanbanProjectId ? kanbanAgentActivityQuery.data ?? [] : []
  const assigneesById = useMemo(
    () => Object.fromEntries(assignees.map((assignee) => [assignee.id, assignee])),
    [assignees],
  )
  const pullRequestDisplaysByTaskId = useMemo(() => {
    if (!selectedProject) {
      return {}
    }

    return Object.fromEntries(
      filteredTasks.flatMap((task) => {
        const display = resolveTaskIndexedPullRequestDisplay({
          pullRequests: projectPullRequests,
          bindings: projectPullRequestBindings,
          projectId: selectedProject.id,
          taskId: task.id,
        })
        return display ? [[task.id, display] as const] : []
      }),
    ) satisfies Record<string, TaskPullRequestDisplay>
  }, [filteredTasks, projectPullRequestBindings, projectPullRequests, selectedProject])
  const autoRefreshProjectIds = useMemo(
    () => new Set(selectedProject ? [selectedProject.id] : []),
    [selectedProject],
  )

  useAutoRefreshTaskPullRequests({
    projects: state.projects,
    tasks: state.tasks,
    taskWorkspaceBindings: state.taskWorkspaceBindings,
    workspaceSessions: state.workspaceSessions,
    enabledProjectIds: autoRefreshProjectIds,
    setState,
  })

  const navigate = Route.useNavigate()

  useEffect(() => {
    if (contextProjectId && visibleProjectIds.has(contextProjectId)) {
      return
    }

    setSelectedProjectId(workspaceScopedProjects[0]?.id ?? '')
  }, [contextProjectId, setSelectedProjectId, visibleProjectIds, workspaceScopedProjects])

  useEffect(() => {
    if (search.projectId && visibleProjectIds.has(search.projectId)) {
      return
    }

    const nextProjectId = workspaceScopedProjects[0]?.id || ''
    if ((search.projectId || '') === nextProjectId) {
      return
    }

    navigate({
      search: (current) => ({
        ...current,
        projectId: nextProjectId || undefined,
        taskId: undefined,
      }),
      replace: true,
    })
  }, [navigate, search.projectId, visibleProjectIds, workspaceScopedProjects])

  useEffect(() => {
    if (!selectedProject?.id) {
      setAssignees([])
      return
    }

    let cancelled = false

    void loadProjectAssignees(selectedProject.id, { force: true })
      .then((response) => {
        if (!cancelled) {
          setAssignees(response)
        }
      })
      .catch(() => {
        if (!cancelled) {
          setAssignees([])
        }
      })

    return () => {
      cancelled = true
    }
  }, [selectedProject?.id, selectedTaskId])

  useEffect(() => {
    if (!projectWorkspacesProject) {
      return
    }

    setState((current) => ({
      ...current,
      projects: current.projects.map((item) => (item.id === projectWorkspacesProject.id ? projectWorkspacesProject : item)),
    }))
  }, [projectWorkspacesProject, setState])

  const kanbanFileTreeSource = useMemo(
    () => resolveKanbanFileTreeSource({
      executors,
      project: selectedProject,
      projectBindings: state.projectBindings,
      workspaces: projectWorkspaces,
    }),
    [executors, projectWorkspaces, selectedProject, state.projectBindings],
  )
  const fileTreeNodeOptions = useMemo<ExecutorSelectOption[]>(
    () => kanbanFileTreeSource.map((source, index) => ({
      value: source.executorId,
      label: source.executorName,
      description: source.machineName,
      badgeLabel: index === 0 ? t('kanban.page.fileTreeNodePrimary', { defaultValue: '默认' }) : undefined,
      keywords: [source.machineName, source.initialDirectoryPath],
      statusTone: 'neutral',
    })),
    [kanbanFileTreeSource, t],
  )
  const selectedKanbanFileTreeSource = useMemo(
    () => kanbanFileTreeSource.find((source) => source.executorId === selectedFileTreeExecutorId) ?? kanbanFileTreeSource[0] ?? null,
    [kanbanFileTreeSource, selectedFileTreeExecutorId],
  )

  useEffect(() => {
    setSelectedFileTreeExecutorId((current) => {
      if (current && kanbanFileTreeSource.some((source) => source.executorId === current)) {
        return current
      }

      return kanbanFileTreeSource[0]?.executorId || ''
    })
  }, [kanbanFileTreeSource])

  const applyTaskPatch = (previous: AppState, updatedTask: Task, responseState?: AppState) => {
    const tasks = previous.tasks.some((task) => task.id === updatedTask.id)
      ? previous.tasks.map((task) => (task.id === updatedTask.id ? updatedTask : task))
      : [updatedTask, ...previous.tasks]

    return {
      ...previous,
      tasks,
      adapters: responseState?.adapters ?? previous.adapters,
      executionCenter: responseState?.executionCenter ?? previous.executionCenter,
      selectedProjectId: responseState?.selectedProjectId ?? previous.selectedProjectId,
      selectedTaskId: updatedTask.id,
    }
  }

  const handleSelectProject = (id: string) => {
    setSelectedProjectId(id)
    navigate({ search: (s) => ({ ...s, projectId: id }) })
  }

  const handleSelectTask = (id: string) => {
    const task = state.tasks.find((item) => item.id === id)

    setSelectedTaskId(id)
    navigate({ search: (s) => ({ ...s, taskId: id }) })

    if (!task?.needsHumanConfirm) {
      return
    }

    setState((prev) => ({
      ...prev,
      tasks: prev.tasks.map((item) => (item.id === id ? { ...item, needsHumanConfirm: false } : item)),
    }))

    void api.acknowledgeTaskConfirmation(id).catch(() => {
      setState((prev) => ({
        ...prev,
        tasks: prev.tasks.map((item) => (item.id === id ? { ...item, needsHumanConfirm: true } : item)),
      }))
    })
  }

  const handleTaskUpdate = (updatedTask: Task) => {
    setState((prev) => ({
      ...prev,
      tasks: prev.tasks.map((t) => (t.id === updatedTask.id ? updatedTask : t)),
    }))
  }

  const uploadTaskImages = async (taskId: string, images?: CreateTaskFormPayload['images']) => {
    for (const img of images || []) {
      try {
        const resp = await fetch(resolveApiUrl(`/api/tasks/${taskId}/images`), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
          body: JSON.stringify({ image: img.url, filename: img.filename }),
        })
        if (!resp.ok) {
          console.error('Failed to upload image:', await resp.text())
        }
      } catch (error) {
        console.error('Error uploading image:', error)
      }
    }
  }

  const handleMoveTask = async (taskId: string, status: TaskStatus) => {
    const timestamp = new Date().toISOString()
    const optimisticHistoryId = globalThis.crypto?.randomUUID?.() ?? `optimistic:${taskId}:${timestamp}`
    let previousTask: Task | null = null

    setState((prev) => {
      const currentTask = prev.tasks.find((task) => task.id === taskId)
      if (!currentTask || currentTask.status === status) {
        return prev
      }

      previousTask = currentTask
      const nextTask: Task = {
        ...currentTask,
        status,
        updatedAt: timestamp,
        history: [...currentTask.history, { id: optimisticHistoryId, label: status, at: timestamp }],
      }
      const tasks = prev.tasks.map((task) => (task.id === taskId ? nextTask : task))

      return {
        ...prev,
        tasks,
        executionCenter: deriveExecutionCenter(tasks, prev.executionCenter),
        selectedTaskId: taskId,
      }
    })

    if (!previousTask) {
      return
    }

    const response = await runMutation(() => api.moveTask(taskId, status))
    if (response) {
      return
    }

    setState((prev) => {
      const currentTask = prev.tasks.find((task) => task.id === taskId)
      if (!currentTask || currentTask.updatedAt !== timestamp) {
        return prev
      }

      const tasks = prev.tasks.map((task) => (task.id === taskId ? previousTask! : task))
      return {
        ...prev,
        tasks,
        executionCenter: deriveExecutionCenter(tasks, prev.executionCenter),
      }
    })
  }

  const handleCreateTask = async (payload: CreateTaskFormPayload) => {
    const targetProjectId = payload.projectId || selectedProject?.id
    if (!targetProjectId) {
      toast.error(t('kanbanPage.selectProjectFirst'))
      return false
    }

    setBusy(true)

    try {
      const { images, ...taskPayload } = payload
      const response = await api.createTask({
        ...taskPayload,
        projectId: targetProjectId,
      })
      setState(response.state)

      const nextTaskId = response.state.selectedTaskId || response.state.tasks[0]?.id || ''
      if (nextTaskId) {
        setSelectedTaskId(nextTaskId)
        navigate({ search: (s) => ({ ...s, projectId: targetProjectId, taskId: nextTaskId }) })
        await uploadTaskImages(nextTaskId, images)
      }

      toast.success(response.message || t('kanbanPage.taskCreated'))
      setQuickCreateRecoveryDescription('')
      return true
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('kanbanPage.taskCreateFailed'))
      return false
    } finally {
      setBusy(false)
    }
  }

  const pollQuickCreateTask = async (creationRunId: string, request: string) => {
    for (let attempt = 0; attempt < 90; attempt += 1) {
      await new Promise((resolve) => window.setTimeout(resolve, 2_000))
      const result = await api.getQuickCreateTaskStatus(creationRunId)
      if (result.task) {
        const createdTask = result.task
        setState((previous) => {
          const tasks = previous.tasks.some((task) => task.id === createdTask.id)
            ? previous.tasks.map((task) => task.id === createdTask.id ? createdTask : task)
            : [createdTask, ...previous.tasks]
          return {
            ...previous,
            tasks,
            selectedProjectId: createdTask.projectId,
            selectedTaskId: createdTask.id,
            executionCenter: deriveExecutionCenter(tasks, previous.executionCenter),
          }
        })
        setSelectedProjectId(createdTask.projectId)
        setSelectedTaskId(createdTask.id)
        setQuickCreateRecoveryDescription('')
        navigate({ search: (current) => ({
          ...current,
          projectId: createdTask.projectId,
          taskId: createdTask.id,
          createTask: undefined,
        }) })
        toast.success(`Agent 已创建任务「${createdTask.title}」`)
        return
      }
      if (result.status === 'failed' || result.status === 'canceled') {
        setQuickCreateRecoveryDescription(request)
        navigate({ search: (current) => ({ ...current, createTask: '1' }) })
        toast.error(result.failureMessage || 'Agent 创建失败，已将原始请求恢复到手动创建表单。')
        return
      }
    }

    toast.message('Agent 仍在创建任务，可稍后刷新任务列表查看结果。')
  }

  const handleQuickCreateTask = async (payload: TaskQuickCreatePayload) => {
    setBusy(true)
    try {
      const response = await api.quickCreateTask(payload)
      void pollQuickCreateTask(response.creationRunId, payload.request).catch((error) => {
        toast.error(error instanceof Error ? error.message : '读取 Agent 创建状态失败。')
      })
      toast.success('Agent 已开始创建任务。')
      return true
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '启动 Agent 创建任务失败。')
      return false
    } finally {
      setBusy(false)
    }
  }

  const handleOpenProjectEdit = () => {
    if (!selectedProject) {
      return
    }

    setProjectDraft(projectToDraft(selectedProject))
    setProjectEditOpen(true)
  }

  const handleSubmitProjectEdit = async () => {
    if (!selectedProject || !projectDraft.name.trim() || !projectDraft.gitUrl.trim()) {
      return
    }

    const response = await runMutation(() => api.updateProject(selectedProject.id, buildProjectPayload(projectDraft, selectedProject)))
    const nextProject = response?.state.projects.find((item) => item.id === selectedProject.id)
    if (nextProject) {
      setProjectDraft(projectToDraft(nextProject))
    }
  }

  const handleReimportProjectEnvironmentTemplate = async () => {
    if (!selectedProject) {
      return
    }

    setProjectReimportBusy(true)
    try {
      const response = await runMutation(() => api.importProjectEnvironmentTemplate(selectedProject.id))
      const nextProject = response?.state.projects.find((item) => item.id === selectedProject.id)
      if (nextProject) {
        setProjectDraft(projectToDraft(nextProject))
      }
    } finally {
      setProjectReimportBusy(false)
    }
  }

  const handleSyncProjectSettings = async (executorId?: string) => {
    if (!selectedProject) {
      return
    }

    setProjectReimportBusy(true)
    try {
      const response = await runMutation(() => api.syncProjectSettings(selectedProject.id, { executorId }))
      const nextProject = response?.state.projects.find((item) => item.id === selectedProject.id)
      if (nextProject) {
        setProjectDraft(projectToDraft(nextProject))
      }
    } finally {
      setProjectReimportBusy(false)
    }
  }

  const handleDeleteProject = async (options: { projectName: string; deleteProjectDirectory: boolean }) => {
    if (!selectedProject) {
      return
    }

    const response = await runMutation(() => api.deleteProject(selectedProject.id, options))
    if (response) {
      setProjectEditOpen(false)
    }
  }

  const handleExecuteTask = async (taskId: string, payload: { workspaceId: string; baseBranch?: string; returnMode: 'summary' | 'branch' | 'commit'; gitIdentityMode: 'personal' }) => {
    setBusy(true)

    try {
      const response = await api.executeTask(taskId, payload)
      setState(response.state)
      toast.success(response.message || t('kanbanPage.taskQueued'))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('kanbanPage.taskExecuteFailed'))
      throw error
    } finally {
      setBusy(false)
    }
  }

  const handleBindTaskWorkspace = async (taskId: string, workspaceId: string) => {
    setBusy(true)
    try {
      const response = await api.bindTaskWorkspace(taskId, workspaceId)
      setState(response.state)
      toast.success(response.message || t('kanbanPage.workspaceBound'))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('kanbanPage.workspaceBindFailed'))
      throw error
    } finally {
      setBusy(false)
    }
  }

  const handleCreateSubtask = async (taskId: string, payload: CreateTaskFormPayload) => {
    setBusy(true)
    try {
      const { images, ...subtaskPayload } = payload
      const response = await api.createSubtask(taskId, subtaskPayload)
      setState(response.state)
      const nextTaskId = response.state.selectedTaskId || response.state.tasks.find((task) => task.parentTaskId === taskId)?.id || ''
      if (nextTaskId) {
        await uploadTaskImages(nextTaskId, images)
      }
      toast.success(response.message || t('kanbanPage.subtaskCreated'))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('kanbanPage.subtaskCreateFailed'))
      throw error
    } finally {
      setBusy(false)
    }
  }

  const handleSendToTask = async (taskId: string, message: string): Promise<void> => {
    const response = await api.sendToTask(taskId, message)
    setState(response.state)
  }

  const handleOpenWorkspaceSession = (taskId: string, workspaceId: string, workspaceSessionId?: string, launchId?: string, initialPrompt?: string, baseBranch?: string, autoEnvironmentInstall?: boolean) => {
    const task = state.tasks.find((item) => item.id === taskId)
    if (!task) return

    if (typeof window !== 'undefined' && launchId && initialPrompt?.trim()) {
      sessionStorage.setItem(`workspace-launch:${launchId}`, JSON.stringify({
        launchId,
        taskId,
        workspaceId,
        projectId: task.projectId,
        initialPrompt: initialPrompt.trim(),
        baseBranch: baseBranch?.trim() || undefined,
        createdAt: new Date().toISOString(),
      }))
    }

    setSelectedTaskId(taskId)
    setSelectedProjectId(task.projectId)
    navigate({
      to: '/workspaces',
      search: buildWorkspaceRouteSearch({
        taskId,
        workspaceId,
        projectId: task.projectId,
        workspaceSessionId: workspaceSessionId || undefined,
        launchId: launchId || undefined,
        autoEnvironmentInstall: autoEnvironmentInstall ? '1' : undefined,
      }),
    })
  }

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col">
      <KanbanPage
        tasks={filteredTasks}
        projects={workspaceScopedProjects}
        project={selectedProject}
        selectedTaskId={selectedTaskId}
        activeAgentTaskIds={activeAgentTaskIds}
        pullRequestDisplaysByTaskId={pullRequestDisplaysByTaskId}
        projectPullRequests={projectPullRequests}
        projectPullRequestBindings={projectPullRequestBindings}
        createTaskOpen={search.createTask === '1'}
        onCreateTaskOpenChange={(open) => {
          navigate({
            search: (current) => ({
              ...current,
              createTask: open ? '1' : undefined,
            }),
          })
        }}
        onSelectTask={handleSelectTask}
        onMoveTask={(taskId, status) => void handleMoveTask(taskId, status)}
        onCleanupTask={(id) => runMutation(() => api.cleanupTask(id))}
        onDeleteTask={(id) => runMutation(() => api.deleteTask(id))}
        onDeleteTaskWorkspaces={(id) => runMutation(() => api.deleteTaskWorkspaces(id))}
        onOpenTaskInVSCode={(id) => runMutation(() => api.openTaskInVSCode(id))}
        onSendToTask={handleSendToTask}
        onOpenWorkspaceSession={handleOpenWorkspaceSession}
        onTaskUpdate={handleTaskUpdate}
        onCreateTask={(payload) => handleCreateTask(payload)}
        onQuickCreateTask={handleQuickCreateTask}
        createTaskInitialDescription={quickCreateRecoveryDescription}
        onQuickCreateWorkspace={() => {
          if (!selectedProject) {
            toast.error(t('kanbanPage.selectProjectFirst'))
            return
          }

          setSelectedProjectId(selectedProject.id)
          navigate({
            to: '/workspaces',
            search: buildWorkspaceRouteSearch({
              projectId: selectedProject.id,
              workspaceId: undefined,
              taskId: undefined,
              workspaceSessionId: undefined,
              create: '1',
            }),
          })
        }}
        onEditProject={handleOpenProjectEdit}
        assignees={assignees}
        assigneesById={assigneesById}
        onAssignTask={(taskId, assigneeId, options) => runMutation(() => api.updateTaskAssignee(taskId, assigneeId, options))}
        executors={executors}
        onAssignExecutor={(taskId, executorNodeId) => {
          const task = state.tasks.find((item) => item.id === taskId)
          const executor = executors.find((item) => item.executorId === executorNodeId)
          const boundWorkspaceIds = new Set(
            state.taskWorkspaceBindings
              .filter((binding) => binding.taskId === taskId && binding.status === 'active')
              .map((binding) => binding.workspaceId),
          )
          const distributedTaskId = state.workspaceSessions
            .find((session) => boundWorkspaceIds.has(session.workspaceId) && session.distributedTaskId)
            ?.distributedTaskId
            || task?.executionHistory.find((run) => run.distributedTaskId)?.distributedTaskId
          if (!distributedTaskId) {
            toast.error(t('kanbanPage.noDistributedTaskNode'))
            return
          }

          if (executor?.status !== 'online') {
            toast.warning(t('kanbanPage.nodeOfflineQueued'))
          } else {
            const runningCount = executor?.presence?.runningTaskIds.length ?? 0
            const freeSlots = Math.max(0, (executor?.maxConcurrency ?? 0) - runningCount)
            if (freeSlots === 0) {
              toast.message(t('kanbanPage.nodeBusyQueued'))
            }
          }

          void runMutation(() => api.assignDistributedTask(distributedTaskId, executorNodeId))
        }}
        onExecuteTask={handleExecuteTask}
        onBindTaskWorkspace={handleBindTaskWorkspace}
        onCreateSubtask={handleCreateSubtask}
        fileTreeLoading={projectWorkspacesLoading}
        fileTreeExecutorId={selectedKanbanFileTreeSource?.executorId || ''}
        fileTreeDirectoryPath={selectedKanbanFileTreeSource?.initialDirectoryPath || ''}
        fileTreeNodeOptions={fileTreeNodeOptions}
        onFileTreeExecutorChange={setSelectedFileTreeExecutorId}
        busy={busy}
      />
      <ProjectEditDialog
        open={projectEditOpen}
        onOpenChange={setProjectEditOpen}
        draft={projectDraft}
        onDraftChange={setProjectDraft}
        project={selectedProject}
        workspaceRoot={state.config.workspaceRoot}
        executors={executors}
        busy={busy}
        reimportBusy={projectReimportBusy}
        onReimportEnvironmentTemplate={handleReimportProjectEnvironmentTemplate}
        onSyncProjectSettings={handleSyncProjectSettings}
        onSubmit={handleSubmitProjectEdit}
        onDelete={handleDeleteProject}
      />
    </div>
  )
}
