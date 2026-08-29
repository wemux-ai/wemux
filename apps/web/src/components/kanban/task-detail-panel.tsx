/**
 * [INPUT]: Selected Kanban task, collaboration options, realtime workspace invalidations, and task mutation APIs.
 * [OUTPUT]: Editable task drawer with assignment, Agent activity, workspace, subtasks, and comment collaboration mutations.
 * [POS]: Kanban task-detail composition root; execution remains delegated to server/worker flows.
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { resolveMatchingAgentExecutionModelOptionId } from '@shared/model-profile'
import {
  TASK_DESCRIPTION_MAX_LENGTH,
  TASK_TITLE_MAX_LENGTH,
} from '@shared/task-input-limits'
import { sortWorkspaceSessions } from '@shared/task-workspace'
import type { TaskCommentReactionEmoji } from '@shared/task-comment-reaction'
import { TASK_COMMENT_ATTACHMENT_MAX_BYTES, type TaskChatAttachment } from '@shared/task-chat-attachment'
import { useQueryClient } from '@tanstack/react-query'
import { MoreHorizontal, Trash2, X } from 'lucide-react'
import { toast } from 'sonner'
import { api, getAuthHeaders, resolveApiUrl, type CreateWorkspaceResponse, type TaskWorkspaceBindingResponse } from '../../lib/api'
import { Button } from '../../components/ui/button'
import { DeleteWorkspaceDialog, type DeleteWorkspaceOptions } from '../workspaces/delete-workspace-dialog'
import { Drawer, DrawerClose, DrawerContent, DrawerDescription, DrawerTitle } from '../../components/ui/drawer'
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogTitle } from '../../components/ui/dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '../../components/ui/dropdown-menu'
import { ScrollArea } from '../../components/ui/scroll-area'
import { Textarea } from '../../components/ui/textarea'
import { useApp } from '../../lib/app-provider'
import { useAuth } from '../../lib/auth-context'
import { useProjectWorkspacesData } from '../../lib/use-project-workspaces-data'
import { isTaskAwaitingConfirmation } from '../../lib/runtime-status'
import { getTaskAssigneeOptionId } from '../../lib/project-collaboration-data'
import {
  readWorkspaceCreateBaseBranchPreference,
  readWorkspaceCreateRuntimePreference,
  writeWorkspaceCreateBaseBranchPreference,
  writeWorkspaceCreateRuntimePreference,
} from '../../lib/workspace-create-preferences'
import { workspaceQueryKeys } from '../../lib/workspace-query-keys'
import { shouldShowWorkspaceInUserLists } from '../../lib/workspace-visibility'
import { workspacesPageQueryKeys, type WorkspacesPageDirectoryData } from '../workspaces/workspaces-page-queries'
import { CreateTaskModal, type CreateTaskFormPayload } from './create-task-modal'
import { TaskDeleteDialog } from './task-detail-panel-dialogs'
import { TaskEnhancementSection } from './task-enhancement-section'
import {
  TaskDetailCommentsSection,
  TaskDetailHero,
  TaskDetailSubtasksSection,
  TaskDetailWorkspaceSection,
  workspacePendingKeyframes,
} from './task-detail-panel-sections'
import { parseTaskAgentActivityStreamEvent, TaskAgentExecutionLog } from './task-agent-execution-log'
import { TaskTimeline } from './task-timeline'
import {
  resolvePreferredExecutorId,
  resolveTaskBranchSelectionState,
  type TaskDetailPanelProps,
} from './task-detail-panel-helpers'
import { TaskWorkspaceCreatePanel } from './task-workspace-create-panel'
import type { AppState, ExecutorRecord, ExecutionModelOption, Project, Task, TaskCommentMention, WorkspaceSession, Workspace } from '@shared/types'
import type { ApiResponse, TaskAgentActivityRecord, TaskAgentRetrySessionMode, UpdateTaskPayload } from '../../lib/api'

const formatDateTimeInputPart = (value: number) => String(value).padStart(2, '0')

const readFileAsDataUrl = (file: File) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader()
  reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '')
  reader.onerror = () => reject(reader.error ?? new Error('附件读取失败。'))
  reader.readAsDataURL(file)
})

const toDateTimeLocalInputValue = (value?: string) => {
  if (!value) {
    return ''
  }

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return ''
  }

  return [
    date.getFullYear(),
    formatDateTimeInputPart(date.getMonth() + 1),
    formatDateTimeInputPart(date.getDate()),
  ].join('-') + `T${formatDateTimeInputPart(date.getHours())}:${formatDateTimeInputPart(date.getMinutes())}`
}

const resolveTaskDateTimeUpdate = (inputValue: string, currentValue?: string) => {
  if (inputValue === toDateTimeLocalInputValue(currentValue)) {
    return undefined
  }

  if (!inputValue.trim()) {
    return null
  }

  const date = new Date(inputValue)
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString()
}

const buildTaskUpdatePayload = (params: {
  task: Task
  taskTitleInput: string
  taskDescriptionInput: string
  taskPriorityInput: Task['priority']
  taskStartedAtInput: string
  taskDueAtInput: string
}): UpdateTaskPayload => {
  const startedAtUpdate = resolveTaskDateTimeUpdate(params.taskStartedAtInput, params.task.startedAt)
  const dueAtUpdate = resolveTaskDateTimeUpdate(params.taskDueAtInput, params.task.dueAt)

  return {
    title: params.taskTitleInput.trim() || undefined,
    description: params.taskDescriptionInput.trim(),
    priority: params.taskPriorityInput,
    ...(startedAtUpdate !== undefined ? { startedAt: startedAtUpdate } : {}),
    ...(dueAtUpdate !== undefined ? { dueAt: dueAtUpdate } : {}),
  }
}

const resolveProjectCloneBlockReason = (project?: Project | null) => {
  if (project?.repositoryCloneStatus === 'cloning') {
    return '项目仓库仍在执行节点上克隆，请等待完成后再创建工作区。'
  }

  if (project?.repositoryCloneStatus === 'failed') {
    return project.repositoryCloneMessage?.trim()
      ? `项目仓库克隆失败：${project.repositoryCloneMessage}`
      : '项目仓库克隆失败，请先修复项目仓库后再创建工作区。'
  }

  return ''
}

const upsertWorkspaceSession = (
  workspaceSessions: WorkspaceSession[],
  workspaceSession?: WorkspaceSession | null,
) => {
  if (!workspaceSession) {
    return workspaceSessions
  }

  return workspaceSessions.some((item) => item.id === workspaceSession.id)
    ? workspaceSessions.map((item) => (item.id === workspaceSession.id ? workspaceSession : item))
    : [workspaceSession, ...workspaceSessions]
}

const applyWorkspaceBindingResponseToState = (
  current: AppState,
  response: TaskWorkspaceBindingResponse,
) => ({
  ...response.state,
  workspaceSessions: upsertWorkspaceSession(
    response.state.workspaceSessions.length > 0
      ? response.state.workspaceSessions
      : current.workspaceSessions,
    response.workspaceSession,
  ),
})

type TaskDraftSnapshot = {
  taskId: string
  title: string
  description: string
  status: Task['status']
  priority: Task['priority']
  startedAtInput: string
  dueAtInput: string
}

const createTaskDraftSnapshot = (task: Task): TaskDraftSnapshot => ({
  taskId: task.id,
  title: task.title,
  description: task.description,
  status: task.status,
  priority: task.priority,
  startedAtInput: toDateTimeLocalInputValue(task.startedAt),
  dueAtInput: toDateTimeLocalInputValue(task.dueAt),
})

const areTaskDraftsEqual = (left: TaskDraftSnapshot, right: TaskDraftSnapshot) => (
  left.taskId === right.taskId
  && left.title === right.title
  && left.description === right.description
  && left.status === right.status
  && left.priority === right.priority
  && left.startedAtInput === right.startedAtInput
  && left.dueAtInput === right.dueAtInput
)

export function TaskDetailPanel({
  project,
  task,
  tasks,
  projectPullRequests,
  projectPullRequestBindings,
  assignees,
  executors,
  open,
  onClose,
  onCleanup,
  onDelete,
  onAssignExecutor,
  onOpenWorkspaceSession,
  onTaskUpdate,
  onAssignTask,
  onCreateSubtask,
  busy,
}: TaskDetailPanelProps) {
  const { projectWorkspacesRevision, runMutation, state, setState } = useApp()
  const queryClient = useQueryClient()
  const { user } = useAuth()
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [deleteTaskChecked, setDeleteTaskChecked] = useState(true)
  const [deleteTaskWorkspaces, setDeleteTaskWorkspaces] = useState(false)
  const [showSubtaskCreateModal, setShowSubtaskCreateModal] = useState(false)
  const [showWorkspaceCreate, setShowWorkspaceCreate] = useState(false)
  const [deleteWorkspaceTarget, setDeleteWorkspaceTarget] = useState<Workspace | null>(null)
  const [deleteWorkspaceBusy, setDeleteWorkspaceBusy] = useState(false)
  const [taskTitleInput, setTaskTitleInput] = useState(task.title)
  const [taskDescriptionInput, setTaskDescriptionInput] = useState(task.description)
  const [taskStatusInput, setTaskStatusInput] = useState<Task['status']>(task.status)
  const [taskPriorityInput, setTaskPriorityInput] = useState<Task['priority']>(task.priority)
  const [taskStartedAtInput, setTaskStartedAtInput] = useState(toDateTimeLocalInputValue(task.startedAt))
  const [taskDueAtInput, setTaskDueAtInput] = useState(toDateTimeLocalInputValue(task.dueAt))
  const [commentInput, setCommentInput] = useState('')
  const [pendingAgentAssigneeId, setPendingAgentAssigneeId] = useState('')
  const [assignmentHandoffPrompt, setAssignmentHandoffPrompt] = useState('')
  const [assignmentSubmitting, setAssignmentSubmitting] = useState(false)
  const [showAssignedAgentStart, setShowAssignedAgentStart] = useState(false)
  const [assignedAgentStartPrompt, setAssignedAgentStartPrompt] = useState('')
  const [assignedAgentStarting, setAssignedAgentStarting] = useState(false)
  const [agentActivities, setAgentActivities] = useState<TaskAgentActivityRecord[]>([])
  const [agentActivitiesLoading, setAgentActivitiesLoading] = useState(false)
  const [agentActivityActionId, setAgentActivityActionId] = useState('')
  const [agentTranscriptEventId, setAgentTranscriptEventId] = useState('')
  const [agentTranscriptSignals, setAgentTranscriptSignals] = useState<Record<string, string>>({})
  const [newWorkspaceName, setNewWorkspaceName] = useState(task.title || '新工作区')
  const [newWorkspaceExecutorId, setNewWorkspaceExecutorId] = useState('')
  const [workspaceAgentType, setWorkspaceAgentType] = useState<Task['agentType']>(task.agentType)
  const [workspaceWorkingDirectoryMode, setWorkspaceWorkingDirectoryMode] = useState<Workspace['workingDirectoryMode']>('worktree')
  const [workspaceExecutionModel, setWorkspaceExecutionModel] = useState('')
  const [modelOptions, setModelOptions] = useState<Array<{ id: string; modelId: string; providerId: string; isDefault?: boolean; source?: ExecutionModelOption['source'] }>>([])
  const [modelLoading, setModelLoading] = useState(false)
  const [defaultModel, setDefaultModel] = useState('')
  const [modelMessage, setModelMessage] = useState('')
  const [branchOptions, setBranchOptions] = useState<string[]>([])
  const [branchSources, setBranchSources] = useState<Record<string, 'remote' | 'local-only'> | undefined>(undefined)
  const [branchLoading, setBranchLoading] = useState(false)
  const [branchMessage, setBranchMessage] = useState('')
  const [selectedBranch, setSelectedBranch] = useState(task.baseBranch || task.baseBranchHint || '')
  const [selectedExecutorId, setSelectedExecutorId] = useState('')
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState('')
  const [launchingWorkspace, setLaunchingWorkspace] = useState(false)
  const {
    refreshProjectWorkspaces,
    workspaces,
    workspacesLoading,
    setWorkspaces,
  } = useProjectWorkspacesData(open ? task.projectId : '')
  const [taskSaving, setTaskSaving] = useState(false)
  const latestDraftRef = useRef<TaskDraftSnapshot>(createTaskDraftSnapshot(task))
  const savedDraftRef = useRef<TaskDraftSnapshot>(createTaskDraftSnapshot(task))
  const autoSaveTimerRef = useRef<number | null>(null)
  const autoSaveInFlightRef = useRef(false)
  const autoSaveQueuedRef = useRef(false)
  const taskSaveErrorToastIdRef = useRef<string | number | null>(null)
  const projectWorkspacesRevisionRef = useRef(projectWorkspacesRevision)
  const awaitingConfirmation = isTaskAwaitingConfirmation(task)
  const taskBindings = useMemo(
    () => state.taskWorkspaceBindings.filter((binding) => binding.taskId === task.id && binding.status === 'active'),
    [state.taskWorkspaceBindings, task.id],
  )
  const taskSessions = useMemo(
    () => {
      const workspaceIds = new Set(taskBindings.map((binding) => binding.workspaceId))
      return sortWorkspaceSessions(
        state.workspaceSessions.filter((session) => workspaceIds.has(session.workspaceId)),
      )
    },
    [state.workspaceSessions, taskBindings],
  )
  const primarySession = useMemo(() => taskSessions[0] ?? null, [taskSessions])
  const workspaceOptions = useMemo(
    () => workspaces.filter((workspace) => shouldShowWorkspaceInUserLists(
      workspace,
      taskBindings.some((binding) => binding.workspaceId === workspace.id),
    )),
    [taskBindings, workspaces],
  )
  const preferredExecutorId = useMemo(
    () => resolvePreferredExecutorId({
      project,
      taskExecutorId: primarySession?.executorNodeId,
      workspaces: workspaceOptions,
      executors,
    }),
    [executors, primarySession?.executorNodeId, project, workspaceOptions],
  )
  const preferredExecutorName = useMemo(
    () => executors.find((executor) => executor.executorId === preferredExecutorId)?.name ?? '未选择节点',
    [executors, preferredExecutorId],
  )
  const workspaceScopedProjectIds = useMemo(() => {
    const currentWorkspaceId = project?.workspaceId?.trim() || ''
    return state.projects
      .filter((item) => currentWorkspaceId ? item.workspaceId?.trim() === currentWorkspaceId : true)
      .map((item) => item.id)
  }, [project?.workspaceId, state.projects])
  const projectIdsKey = useMemo(
    () => workspaceScopedProjectIds.join('|'),
    [workspaceScopedProjectIds],
  )
  const selectedWorkspace = useMemo(
    () => workspaceOptions.find((workspace) => workspace.id === selectedWorkspaceId) ?? null,
    [selectedWorkspaceId, workspaceOptions],
  )
  const activeExecutorId = selectedExecutorId || newWorkspaceExecutorId || selectedWorkspace?.executorNodeId || preferredExecutorId
  const workspaceConfigReady = Boolean(selectedWorkspaceId || activeExecutorId)
  const requiresWorkspaceBaseBranch = workspaceWorkingDirectoryMode !== 'original-dir'
  const projectCloneBlockReason = selectedWorkspaceId ? '' : resolveProjectCloneBlockReason(project)
  const pendingConfirmationWorkspace = useMemo(
    () => (awaitingConfirmation && primarySession?.workspaceId
      ? workspaceOptions.find((workspace) => workspace.id === primarySession.workspaceId) ?? null
      : null),
    [awaitingConfirmation, primarySession?.workspaceId, workspaceOptions],
  )
  const childTasks = useMemo(
    () => tasks.filter((item) => item.parentTaskId === task.id),
    [task.id, tasks],
  )
  const pendingAgentAssignee = useMemo(
    () => assignees.find((assignee) => (
      assignee.id === pendingAgentAssigneeId
      && assignee.kind === 'agent'
    )) ?? null,
    [assignees, pendingAgentAssigneeId],
  )
  const taskDirty = useMemo(() => (
    (taskTitleInput.trim() || '') !== (task.title.trim() || '')
      || taskDescriptionInput.trim() !== task.description.trim()
      || taskStatusInput !== task.status
      || taskPriorityInput !== task.priority
      || taskStartedAtInput !== toDateTimeLocalInputValue(task.startedAt)
      || taskDueAtInput !== toDateTimeLocalInputValue(task.dueAt)
  ), [task.description, task.dueAt, task.priority, task.startedAt, task.status, task.title, taskDescriptionInput, taskDueAtInput, taskPriorityInput, taskStartedAtInput, taskStatusInput, taskTitleInput])
  const boundWorkspaces = useMemo(
    () => workspaceOptions
      .filter((workspace) => workspace.status !== 'archived')
      .filter((workspace) => taskBindings.some((binding) => binding.workspaceId === workspace.id))
      .sort((left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime()),
    [taskBindings, workspaceOptions],
  )

  const buildWorkspaceLaunchPrompt = () => {
    const sections = [
      task.title.trim() ? `${task.title.trim()}` : '',
      task.description.trim() ? `${task.description.trim()}` : '',
    ].filter(Boolean)

    return sections.join('\n\n')
  }

  const applyCreateWorkspaceResponseToCaches = (
    response: CreateWorkspaceResponse,
    projectId: string,
  ) => {
    setWorkspaces(response.workspaces)
    queryClient.setQueryData(
      workspaceQueryKeys.projectWorkspaces(projectId),
      {
        project: response.project ?? project ?? null,
        workspaces: response.workspaces,
      },
    )
    queryClient.setQueryData<WorkspacesPageDirectoryData>(
      workspacesPageQueryKeys.directory(projectIdsKey),
      (current) => current
        ? {
            ...current,
            updatedProjects: response.project
              ? current.updatedProjects.some((item) => item.id === response.project?.id)
                ? current.updatedProjects.map((item) => (item.id === response.project?.id ? response.project : item))
                : [response.project, ...current.updatedProjects]
              : current.updatedProjects,
            workspacesByProject: {
              ...current.workspacesByProject,
              [projectId]: response.workspaces,
            },
          }
        : current,
    )
    if (response.project) {
      setState((current) => ({
        ...current,
        projects: current.projects.map((item) => (item.id === response.project?.id ? response.project : item)),
      }))
    }
  }

  useEffect(() => {
    if (!open) {
      projectWorkspacesRevisionRef.current = projectWorkspacesRevision
      setShowWorkspaceCreate(false)
      return
    }
  }, [open, projectWorkspacesRevision, task.id, task.projectId])

  useEffect(() => {
    if (!open || projectWorkspacesRevisionRef.current === projectWorkspacesRevision) {
      return
    }

    projectWorkspacesRevisionRef.current = projectWorkspacesRevision
    const refreshTimer = window.setTimeout(() => {
      void refreshProjectWorkspaces(true)
    }, 120)

    return () => window.clearTimeout(refreshTimer)
  }, [open, projectWorkspacesRevision, refreshProjectWorkspaces, task.projectId])

  useEffect(() => {
    if (!open) return

    let cancelled = false
    let reconnectTimer: number | undefined
    let abortController: AbortController | undefined
    const refresh = async (showLoading = false) => {
      if (showLoading) setAgentActivitiesLoading(true)
      try {
        const response = await api.getTaskAgentActivities(task.id)
        if (!cancelled) setAgentActivities(response.activities)
      } catch {
        if (!cancelled) setAgentActivities([])
      } finally {
        if (!cancelled && showLoading) setAgentActivitiesLoading(false)
      }
    }

    const connect = async () => {
      abortController = new AbortController()
      try {
        const response = await fetch(resolveApiUrl(`/api/tasks/${task.id}/agent-activities/stream`), {
          headers: getAuthHeaders(),
          signal: abortController.signal,
        })
        if (!response.ok || !response.body) throw new Error(`Agent activity stream failed: ${response.status}`)
        const reader = response.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ''
        while (!cancelled) {
          const { done, value } = await reader.read()
          if (done) break
          buffer += decoder.decode(value, { stream: true })
          const events = buffer.split('\n\n')
          buffer = events.pop() ?? ''
          for (const eventBlock of events) {
            const event = parseTaskAgentActivityStreamEvent(eventBlock)
            if (event?.event === 'activity') void refresh()
            if (event?.event === 'transcript' && typeof event.data.eventId === 'string') {
              void refresh()
              setAgentTranscriptSignals((current) => ({
                ...current,
                [event.data.eventId as string]: typeof event.data.updatedAt === 'string'
                  ? event.data.updatedAt
                  : new Date().toISOString(),
              }))
            }
          }
        }
      } catch {
        // Reconnect below unless the drawer intentionally closed the stream.
      }
      if (!cancelled) reconnectTimer = window.setTimeout(() => void connect(), 1_500)
    }

    setAgentActivities([])
    setAgentTranscriptEventId('')
    setAgentTranscriptSignals({})
    void refresh(true)
    void connect()
    return () => {
      cancelled = true
      abortController?.abort()
      if (reconnectTimer) window.clearTimeout(reconnectTimer)
    }
  }, [open, task.id])

  useEffect(() => {
    setShowWorkspaceCreate(false)
  }, [task.id])

  useEffect(() => {
    if (!open) {
      return
    }

    const nextSavedDraft = createTaskDraftSnapshot(task)
    const isNewTask = latestDraftRef.current.taskId !== task.id
    const hasPendingLocalChanges = !areTaskDraftsEqual(latestDraftRef.current, savedDraftRef.current)

    savedDraftRef.current = nextSavedDraft

    if (isNewTask || (!taskSaving && !hasPendingLocalChanges)) {
      setTaskTitleInput(nextSavedDraft.title)
      setTaskDescriptionInput(nextSavedDraft.description)
      setTaskStatusInput(nextSavedDraft.status)
      setTaskPriorityInput(nextSavedDraft.priority)
      setTaskStartedAtInput(nextSavedDraft.startedAtInput)
      setTaskDueAtInput(nextSavedDraft.dueAtInput)
      latestDraftRef.current = nextSavedDraft
    }

    if (isNewTask) {
      autoSaveQueuedRef.current = false
      autoSaveInFlightRef.current = false
      if (autoSaveTimerRef.current !== null) {
        window.clearTimeout(autoSaveTimerRef.current)
        autoSaveTimerRef.current = null
      }
      setTaskSaving(false)
    }
  }, [open, task.description, task.dueAt, task.id, task.priority, task.startedAt, task.status, task.title, taskSaving])

  useEffect(() => () => {
    if (autoSaveTimerRef.current !== null) {
      window.clearTimeout(autoSaveTimerRef.current)
    }
  }, [])

  useEffect(() => {
    setSelectedWorkspaceId((current: string) => current || taskBindings[0]?.workspaceId || '')
  }, [taskBindings])

  useEffect(() => {
    if (!showDeleteConfirm) {
      return
    }

    setDeleteTaskChecked(true)
    setDeleteTaskWorkspaces(false)
  }, [showDeleteConfirm])

  useEffect(() => {
    if (!showWorkspaceCreate || !activeExecutorId) {
      setModelOptions([])
      setDefaultModel('')
      setModelMessage('')
      setModelLoading(false)
      return
    }

    let cancelled = false
    setModelLoading(true)

    void api.listAgentModels(workspaceAgentType, activeExecutorId)
      .then((response) => {
        if (cancelled) {
          return
        }

        setModelOptions(response.models)
        setDefaultModel(response.defaultModel ?? '')
        setModelMessage(response.message ?? '')
        setWorkspaceExecutionModel((current) => resolveMatchingAgentExecutionModelOptionId(workspaceAgentType, response.models, current))
      })
      .catch((error) => {
        if (cancelled) {
          return
        }

        setModelOptions([])
        setDefaultModel('')
        setModelMessage(error instanceof Error ? error.message : '执行节点未返回可用模型，请检查节点在线状态和 OpenCode 配置。')
      })
      .finally(() => {
        if (!cancelled) {
          setModelLoading(false)
        }
      })

    return () => {
      cancelled = true
    }
  }, [activeExecutorId, showWorkspaceCreate, workspaceAgentType])

  useEffect(() => {
    if (!showWorkspaceCreate) {
      return
    }

    setNewWorkspaceName(task.title || '新工作区')
  }, [showWorkspaceCreate, task.title])

  useEffect(() => {
    if (!showWorkspaceCreate) {
      return
    }

    setSelectedExecutorId((current) => current || preferredExecutorId)
    setNewWorkspaceExecutorId((current) => current || preferredExecutorId)
    setSelectedBranch((current) => current || readWorkspaceCreateBaseBranchPreference(task.projectId) || task.baseBranch || task.baseBranchHint || '')
  }, [preferredExecutorId, showWorkspaceCreate, task.baseBranch, task.baseBranchHint, task.projectId])

  useEffect(() => {
    if (!showWorkspaceCreate || workspaceWorkingDirectoryMode === 'original-dir') {
      setBranchOptions([])
      setBranchLoading(false)
      setSelectedBranch('')
      setBranchMessage('原始目录模式会直接使用当前目录所在分支。')
      return
    }

    if (!showWorkspaceCreate || !workspaceConfigReady) {
      setBranchOptions([])
      setBranchSources(undefined)
      setBranchLoading(false)
      setBranchMessage('请先选择执行节点。')
      return
    }

    if (!selectedWorkspaceId && !activeExecutorId) {
      setBranchOptions([])
      setBranchSources(undefined)
      setBranchLoading(false)
      setBranchMessage('请先选择执行节点。')
      return
    }

    if (!selectedWorkspaceId && projectCloneBlockReason) {
      setBranchOptions([])
      setBranchSources(undefined)
      setSelectedBranch('')
      setBranchLoading(false)
      setBranchMessage(projectCloneBlockReason)
      return
    }

    let cancelled = false
    setBranchLoading(true)
    setBranchMessage('')

    const requestBranches = api.listProjectBranches(task.projectId, activeExecutorId)

    void requestBranches
      .then((response) => {
        if (cancelled) {
          return
        }

        if (!response.ok && response.branches.length === 0) {
          setBranchOptions([])
          setBranchSources(undefined)
          setSelectedBranch('')
          setBranchMessage(response.message?.trim() || '分支列表加载失败')
          return
        }

        const preferredBranch = readWorkspaceCreateBaseBranchPreference(task.projectId)
        const nextBranchState = resolveTaskBranchSelectionState({
          branches: response.branches,
          currentBranch: selectedBranch || preferredBranch,
          preferredBranches: [preferredBranch, task.baseBranch || '', task.baseBranchHint || ''],
          defaultBranch: response.defaultBranch,
          fallbackBranch: project?.defaultBranch,
          message: response.message,
        })
        setBranchOptions(nextBranchState.branchOptions)
        setBranchSources(response.branchSources)
        setSelectedBranch(nextBranchState.selectedBranch)
        setBranchMessage(nextBranchState.branchMessage)
      })
      .catch((error) => {
        if (cancelled) {
          return
        }

        const preferredBranch = readWorkspaceCreateBaseBranchPreference(task.projectId)
        const nextBranchState = resolveTaskBranchSelectionState({
          branches: [],
          currentBranch: selectedBranch || preferredBranch,
          preferredBranches: [preferredBranch, task.baseBranch || '', task.baseBranchHint || ''],
          fallbackBranch: project?.defaultBranch,
          message: `${error instanceof Error ? error.message : '分支列表加载失败'} 已先回退到默认分支。`,
        })
        setBranchOptions(nextBranchState.branchOptions)
        setBranchSources(undefined)
        setSelectedBranch(nextBranchState.selectedBranch)
        setBranchMessage(nextBranchState.branchMessage)
      })
      .finally(() => {
        if (!cancelled) {
          setBranchLoading(false)
        }
      })

    return () => {
      cancelled = true
    }
  }, [activeExecutorId, project?.defaultBranch, projectCloneBlockReason, selectedWorkspaceId, showWorkspaceCreate, task.baseBranch, task.baseBranchHint, task.projectId, workspaceConfigReady, workspaceWorkingDirectoryMode])

  const handleOpenWorkspaceCreate = () => {
    const runtimePreference = readWorkspaceCreateRuntimePreference(task.projectId)
    const preferredBranch = readWorkspaceCreateBaseBranchPreference(task.projectId)
    const nextWorkingDirectoryMode = project?.versionControl === 'none'
      ? 'original-dir'
      : runtimePreference.workingDirectoryMode ?? 'worktree'

    setNewWorkspaceExecutorId(preferredExecutorId)
    setNewWorkspaceName(task.title || '新工作区')
    setSelectedWorkspaceId('')
    setSelectedExecutorId(preferredExecutorId)
    setWorkspaceAgentType(runtimePreference.agentType ?? task.agentType)
    setWorkspaceWorkingDirectoryMode(nextWorkingDirectoryMode)
    setWorkspaceExecutionModel('')
    setSelectedBranch(preferredBranch || task.baseBranch || task.baseBranchHint || '')
    setShowWorkspaceCreate(true)
  }

  const handleDeleteWorkspace = async (workspace: Workspace) => {
    setDeleteWorkspaceTarget(workspace)
  }

  const handleArchiveWorkspace = async (workspace: Workspace, archived: boolean) => {
    const response = await runMutation(() => api.archiveWorkspace(workspace.id, archived))
    if (!response) {
      return
    }

    setWorkspaces(response.workspaces)
    const nextTask = response.state.tasks.find((item) => item.id === task.id)
    if (nextTask) {
      onTaskUpdate(nextTask)
    }

    if (archived && selectedWorkspaceId === workspace.id) {
      setSelectedWorkspaceId('')
    }
  }

  const handleConfirmDeleteWorkspace = async (options: DeleteWorkspaceOptions) => {
    const workspace = deleteWorkspaceTarget
    if (!workspace) {
      return
    }

    setDeleteWorkspaceBusy(true)
    try {
      const response = await runMutation(() => api.deleteWorkspace(workspace.id, options))
      if (!response) {
        return
      }

      setWorkspaces((current) => current.filter((item) => item.id !== workspace.id))
      const nextTask = response.state.tasks.find((item) => item.id === task.id)
      if (nextTask) {
        onTaskUpdate(nextTask)
      }

      if (selectedWorkspaceId === workspace.id) {
        setSelectedWorkspaceId('')
      }
      setDeleteWorkspaceTarget(null)
    } finally {
      setDeleteWorkspaceBusy(false)
    }
  }

  const handleSubmitComment = async (payload: {
    parentCommentId?: string
    mentions: Array<Pick<TaskCommentMention, 'targetType' | 'targetId'>>
    attachments: TaskChatAttachment[]
  }) => {
    if (!commentInput.trim() && payload.attachments.length === 0) {
      return false
    }

    const response = await runMutation(() => api.addTaskComment(task.id, {
      content: commentInput.trim(),
      parentCommentId: payload.parentCommentId,
      mentions: payload.mentions,
      attachments: payload.attachments,
      idempotencyKey: crypto.randomUUID(),
    }))
    if (!response) return false

    const nextTask = response?.state.tasks.find((item) => item.id === task.id)
    if (nextTask) {
      onTaskUpdate(nextTask)
    }
    const blocked = response.commentDispatches.filter((outcome) => outcome.status === 'blocked')
    if (blocked.length > 0) {
      toast.warning(blocked.map((outcome) => outcome.message).filter(Boolean).join('；') || '部分 Mention 未能触发。')
    }
    setCommentInput('')
    return true
  }

  const handleEditComment = async (payload: {
    commentId: string
    content: string
    mentions: Array<Pick<TaskCommentMention, 'targetType' | 'targetId'>>
    attachments: TaskChatAttachment[]
  }) => {
    const response = await runMutation(() => api.updateTaskComment(task.id, payload.commentId, {
      content: payload.content.trim(),
      mentions: payload.mentions,
      attachments: payload.attachments,
    }))
    if (!response) return false

    const nextTask = response.state.tasks.find((item) => item.id === task.id)
    if (nextTask) {
      onTaskUpdate(nextTask)
    }
    return true
  }

  const handleDeleteComment = async (commentId: string) => {
    const response = await runMutation(() => api.deleteTaskComment(task.id, commentId))
    if (!response) return false

    const nextTask = response.state.tasks.find((item) => item.id === task.id)
    if (nextTask) {
      onTaskUpdate(nextTask)
    }
    return true
  }

  const handleCommentReaction = async (commentId: string, emoji: TaskCommentReactionEmoji, active: boolean) => {
    const response = await runMutation(() => api.setTaskCommentReaction(task.id, commentId, { emoji, active }))
    if (!response) return false

    const nextTask = response.state.tasks.find((item) => item.id === task.id)
    if (nextTask) {
      onTaskUpdate(nextTask)
    }
    return true
  }

  const handleCommentResolution = async (commentId: string, resolved: boolean) => {
    const response = await runMutation(() => api.setTaskCommentResolution(task.id, commentId, { resolved }))
    if (!response) return false

    const nextTask = response.state.tasks.find((item) => item.id === task.id)
    if (nextTask) onTaskUpdate(nextTask)
    return true
  }

  const handleSubscriberChange = async (userId: string, subscribed: boolean) => {
    const response = await runMutation(() => api.setTaskSubscriber(task.id, { userId, subscribed }))
    if (!response) return false

    const nextTask = response.state.tasks.find((item) => item.id === task.id)
    if (nextTask) {
      onTaskUpdate(nextTask)
    }
    return true
  }

  const handleCommentAttachmentUpload = async (file: File) => {
    if (file.size > TASK_COMMENT_ATTACHMENT_MAX_BYTES) {
      toast.error('单个附件不能超过 20MB。')
      return null
    }

    try {
      const fileBase64 = await readFileAsDataUrl(file)
      return await api.uploadTaskCommentAttachment(task.id, fileBase64, file.name, file.type || undefined)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '附件上传失败。')
      return null
    }
  }

  const handleTaskAssigneeChange = (assigneeId?: string) => {
    const assignee = assignees.find((item) => item.id === assigneeId)
    if (assignee?.kind === 'agent' && assignee.id !== getTaskAssigneeOptionId(task)) {
      setPendingAgentAssigneeId(assignee.id)
      setAssignmentHandoffPrompt('')
      return
    }

    void onAssignTask(task.id, assigneeId)
  }

  const handleConfirmAgentAssignment = async (startMode: 'now' | 'parked') => {
    if (!pendingAgentAssigneeId || assignmentSubmitting) return

    setAssignmentSubmitting(true)
    try {
      const response = await onAssignTask(task.id, pendingAgentAssigneeId, {
        startMode: task.status === 'backlog' ? 'parked' : startMode,
        handoffPrompt: startMode === 'now' ? assignmentHandoffPrompt.trim() || undefined : undefined,
        idempotencyKey: crypto.randomUUID(),
      })
      if (response) {
        setPendingAgentAssigneeId('')
        setAssignmentHandoffPrompt('')
      }
    } finally {
      setAssignmentSubmitting(false)
    }
  }

  const handleCancelAgentActivity = async (eventId: string) => {
    if (agentActivityActionId) return
    setAgentActivityActionId(eventId)
    try {
      const response = await api.cancelTaskAgentActivity(task.id, eventId)
      setAgentActivities(response.activities)
      toast.success('已取消 Agent 执行。')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '取消 Agent 执行失败。')
    } finally {
      setAgentActivityActionId('')
    }
  }

  const handleStartAssignedAgent = async () => {
    if (!task.assigneeAgentId || assignedAgentStarting) return
    setAssignedAgentStarting(true)
    try {
      const response = await api.startTaskAssignedAgent(task.id, {
        handoffPrompt: assignedAgentStartPrompt.trim() || undefined,
        idempotencyKey: crypto.randomUUID(),
      })
      setAgentActivities(response.activities)
      setShowAssignedAgentStart(false)
      setAssignedAgentStartPrompt('')
      toast.success(response.message)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '启动 Agent 失败。')
    } finally {
      setAssignedAgentStarting(false)
    }
  }

  const handleRetryAgentActivity = async (eventId: string, sessionMode: TaskAgentRetrySessionMode) => {
    if (agentActivityActionId) return false
    setAgentActivityActionId(eventId)
    try {
      const response = await api.retryTaskAgentActivity(task.id, eventId, sessionMode)
      setAgentActivities(response.activities)
      toast.success(sessionMode === 'fresh' ? '已用干净会话重新加入 Agent 队列。' : '已续接原会话重新加入 Agent 队列。')
      return true
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '重试 Agent 执行失败。')
      return false
    } finally {
      setAgentActivityActionId('')
    }
  }

  const handleOpenAgentConversation = async (sessionId: string) => {
    try {
      const response = await api.selectMainChatSession(sessionId)
      if (response.state.selectedMainChatSessionId !== sessionId) {
        throw new Error('这条 Agent 对话已不存在或无法访问。')
      }
      window.location.assign('/chat')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '打开 Agent 对话失败。')
    }
  }

  const handleCreateSubtaskFromModal = async (payload: CreateTaskFormPayload) => {
    await onCreateSubtask(task.id, {
      ...payload,
      projectId: task.projectId,
      parentTaskId: task.id,
      requirementType: 'task',
    })
    return true
  }

  const syncTaskInputsFromTask = (nextTask: Task) => {
    const nextDraft = createTaskDraftSnapshot(nextTask)
    setTaskTitleInput(nextDraft.title)
    setTaskDescriptionInput(nextDraft.description)
    setTaskStatusInput(nextDraft.status)
    setTaskPriorityInput(nextDraft.priority)
    setTaskStartedAtInput(nextDraft.startedAtInput)
    setTaskDueAtInput(nextDraft.dueAtInput)
    latestDraftRef.current = nextDraft
  }

  const applyTaskSaveResponse = (response: ApiResponse, taskId: string) => {
    const nextTask = response.state.tasks.find((item) => item.id === taskId)
    if (!nextTask) {
      return
    }

    setState(response.state)
    onTaskUpdate(nextTask)
    savedDraftRef.current = createTaskDraftSnapshot(nextTask)
  }

  const saveTaskDraft = async () => {
    if (autoSaveInFlightRef.current) {
      autoSaveQueuedRef.current = true
      return
    }

    const latestDraft = latestDraftRef.current
    const savedDraft = savedDraftRef.current
    if (latestDraft.taskId !== task.id || !open) {
      return
    }
    const draftAtSaveStart = { ...latestDraft }

    const statusChanged = latestDraft.status !== savedDraft.status
    const contentChanged = (
      latestDraft.title.trim() !== savedDraft.title.trim()
      || latestDraft.description.trim() !== savedDraft.description.trim()
      || latestDraft.priority !== savedDraft.priority
      || latestDraft.startedAtInput !== savedDraft.startedAtInput
      || latestDraft.dueAtInput !== savedDraft.dueAtInput
    )

    if (!statusChanged && !contentChanged) {
      return
    }

    autoSaveInFlightRef.current = true
    autoSaveQueuedRef.current = false
    setTaskSaving(true)
    let finalSavedTask: Task | null = null

    try {
      if (statusChanged) {
        const moveResponse = await api.moveTask(task.id, latestDraft.status)
        const movedTask = moveResponse.state.tasks.find((item) => item.id === task.id) ?? null
        if (movedTask) {
          finalSavedTask = movedTask
          applyTaskSaveResponse(moveResponse, task.id)
        }
      }

      if (contentChanged) {
        const updatePayload = buildTaskUpdatePayload({
          task,
          taskTitleInput: latestDraft.title,
          taskDescriptionInput: latestDraft.description,
          taskPriorityInput: latestDraft.priority,
          taskStartedAtInput: latestDraft.startedAtInput,
          taskDueAtInput: latestDraft.dueAtInput,
        })
        const updateResponse = await api.updateTask(task.id, updatePayload)
        const updatedTask = updateResponse.state.tasks.find((item) => item.id === task.id) ?? null
        if (updatedTask) {
          finalSavedTask = updatedTask
          applyTaskSaveResponse(updateResponse, task.id)
        }
      }

      if (finalSavedTask && areTaskDraftsEqual(latestDraftRef.current, draftAtSaveStart)) {
        syncTaskInputsFromTask(finalSavedTask)
      }

      taskSaveErrorToastIdRef.current = null
    } catch (error) {
      const message = error instanceof Error ? error.message : '自动保存失败'
      if (taskSaveErrorToastIdRef.current !== message) {
        toast.error(message)
        taskSaveErrorToastIdRef.current = message
      }
    } finally {
      autoSaveInFlightRef.current = false
      setTaskSaving(false)

      if (autoSaveQueuedRef.current) {
        void saveTaskDraft()
      }
    }
  }

  useEffect(() => {
    latestDraftRef.current = {
      taskId: task.id,
      title: taskTitleInput,
      description: taskDescriptionInput,
      status: taskStatusInput,
      priority: taskPriorityInput,
      startedAtInput: taskStartedAtInput,
      dueAtInput: taskDueAtInput,
    }

    if (!open || !taskDirty) {
      if (autoSaveTimerRef.current !== null) {
        window.clearTimeout(autoSaveTimerRef.current)
        autoSaveTimerRef.current = null
      }
      return
    }

    if (autoSaveTimerRef.current !== null) {
      window.clearTimeout(autoSaveTimerRef.current)
    }

    autoSaveTimerRef.current = window.setTimeout(() => {
      autoSaveTimerRef.current = null
      void saveTaskDraft()
    }, 600)

    return () => {
      if (autoSaveTimerRef.current !== null) {
        window.clearTimeout(autoSaveTimerRef.current)
        autoSaveTimerRef.current = null
      }
    }
  }, [open, task.id, taskDescriptionInput, taskDirty, taskDueAtInput, taskPriorityInput, taskStartedAtInput, taskStatusInput, taskTitleInput])

  const handleConfirmDelete = async () => {
    await onDelete({
      deleteTask: deleteTaskChecked,
      deleteTaskWorkspaces,
    })
    setShowDeleteConfirm(false)

    if (deleteTaskChecked) {
      onClose()
    }
  }

  const handleSubmitWorkspace = async () => {
    if (launchingWorkspace) {
      return
    }

    if (!selectedWorkspaceId && projectCloneBlockReason) {
      toast.error(projectCloneBlockReason)
      return
    }

    setLaunchingWorkspace(true)

    try {
      let workspaceId = selectedWorkspaceId
      const creatingNewWorkspace = !workspaceId
      const selectedBaseBranch = requiresWorkspaceBaseBranch ? selectedBranch.trim() : ''
      const selectedModel = workspaceExecutionModel.trim()
      writeWorkspaceCreateRuntimePreference(task.projectId, {
        agentType: workspaceAgentType,
        workingDirectoryMode: workspaceWorkingDirectoryMode,
      })
      if (selectedBaseBranch) {
        writeWorkspaceCreateBaseBranchPreference(task.projectId, selectedBaseBranch)
      }

      if (!workspaceId) {
        const response = await api.createWorkspace(task.projectId, {
          executorNodeId: newWorkspaceExecutorId || selectedExecutorId,
          agentType: workspaceAgentType,
          name: newWorkspaceName,
          nameOrigin: 'manual',
          titleOrigin: 'manual',
          workingDirectoryMode: workspaceWorkingDirectoryMode,
          suggestedBaseBranch: selectedBaseBranch || undefined,
          taskId: task.id,
        })
        applyCreateWorkspaceResponseToCaches(response, task.projectId)
        workspaceId = response.workspace.id
        setSelectedWorkspaceId(workspaceId)
      } else if (selectedWorkspace && activeExecutorId && selectedWorkspace.executorNodeId !== activeExecutorId) {
        const response = await api.updateWorkspace(selectedWorkspace.id, {
          name: newWorkspaceName,
          executorNodeId: activeExecutorId,
          taskId: task.id,
        })
        setWorkspaces(response.workspaces)
      } else if (selectedWorkspace && selectedWorkspace.name !== newWorkspaceName.trim()) {
        const response = await api.updateWorkspace(selectedWorkspace.id, {
          name: newWorkspaceName,
        })
        setWorkspaces(response.workspaces)
      }

      const bindResponse = await api.bindTaskWorkspace(task.id, workspaceId, {
        baseBranch: selectedBaseBranch || undefined,
        agentType: workspaceAgentType,
        workingDirectoryMode: workspaceWorkingDirectoryMode,
      })
      setState((current) => applyWorkspaceBindingResponseToState(current, bindResponse))

      const boundWorkspaceSessionId = bindResponse.workspaceSessionId ?? bindResponse.workspaceSession?.id
      if (!boundWorkspaceSessionId) {
        throw new Error('工作区会话创建失败')
      }

      let latestTask = bindResponse.state.tasks.find((item) => item.id === task.id) ?? null
      if (selectedModel) {
        const modelResponse = await api.updateTaskModelCompact(
          task.id,
          selectedModel,
          activeExecutorId,
          workspaceId,
          boundWorkspaceSessionId,
        )
        setState((current) => ({
          ...current,
          tasks: current.tasks.map((item) => (item.id === modelResponse.task.id ? modelResponse.task : item)),
          workspaceSessions: upsertWorkspaceSession(current.workspaceSessions, modelResponse.workspaceSession),
        }))
        latestTask = modelResponse.task
      }

      if (latestTask) {
        onTaskUpdate(latestTask)
      }

      const launchPrompt = buildWorkspaceLaunchPrompt()
      const launchId = launchPrompt ? crypto.randomUUID() : undefined
      setShowWorkspaceCreate(false)
      onOpenWorkspaceSession(
        workspaceId,
        boundWorkspaceSessionId,
        launchId,
        launchPrompt || undefined,
        selectedBaseBranch || undefined,
        false,
      )
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '创建工作区失败')
    } finally {
      setLaunchingWorkspace(false)
    }
  }

  return (
    <Drawer open={open} onOpenChange={(isOpen) => !isOpen && onClose()} direction="right" modal={false}>
      <DrawerContent
        overlayClassName="pointer-events-none bg-transparent backdrop-blur-none"
        className="dark data-[vaul-drawer-direction=right]:max-w-[456px] border-l !border-zinc-900 bg-[#0c0c0e] text-zinc-100 shadow-[-12px_0_28px_rgba(0,0,0,0.28)] backdrop-blur-none"
      >
        <DrawerTitle className="sr-only">任务详情</DrawerTitle>
        <DrawerDescription className="sr-only">查看任务详情、工作区、子任务和评论。</DrawerDescription>
        <style>{workspacePendingKeyframes}</style>

        <div className="flex h-full flex-col">
          <div className="flex shrink-0 items-center justify-between gap-3 border-b border-zinc-800/40 px-4 py-3">
            <div className="flex min-w-0 items-center">
              <span className="shrink-0 rounded-md bg-zinc-800/80 px-1.5 py-0.5 text-[11px] font-medium text-zinc-500">
                VMX-{task.id.replace(/[^a-zA-Z0-9]/g, '').slice(-4).toUpperCase() || 'TASK'}
              </span>
            </div>
            <div className="flex items-center gap-1">
              {!showWorkspaceCreate ? (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label="任务操作"
                      className="h-7 w-7 rounded-md text-zinc-400 hover:bg-zinc-800/60 hover:text-zinc-200"
                    >
                      <MoreHorizontal className="h-3.5 w-3.5" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-44">
                    <DropdownMenuItem
                      onSelect={() => setShowDeleteConfirm(true)}
                      disabled={busy}
                      className="text-rose-300 focus:text-rose-200"
                    >
                      <Trash2 className="h-4 w-4" />
                      删除任务
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              ) : null}
              <DrawerClose asChild>
                <Button
                  autoFocus
                  variant="ghost"
                  size="icon"
                  aria-label="关闭任务详情面板"
                  className="h-7 w-7 rounded-md text-zinc-400 hover:bg-zinc-800/60 hover:text-zinc-200"
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
              </DrawerClose>
            </div>
          </div>

          <div className="min-h-0 flex-1 bg-[#0c0c0e]">
            {showWorkspaceCreate ? (
              <TaskWorkspaceCreatePanel
                task={task}
                projectName={project?.name}
                executors={executors}
                preferredExecutorName={preferredExecutorName}
                workspaceWorkingDirectoryMode={workspaceWorkingDirectoryMode}
                workspaceExecutionModel={workspaceExecutionModel}
                workspaceAgentType={workspaceAgentType}
                activeExecutorId={activeExecutorId}
                selectedBranch={selectedBranch}
                newWorkspaceName={newWorkspaceName}
                defaultModel={defaultModel}
                modelMessage={modelMessage}
                modelOptions={modelOptions}
                modelLoading={modelLoading}
                branchOptions={branchOptions}
                branchSources={branchSources}
                branchLoading={branchLoading}
                branchMessage={branchMessage}
                createBlockedReason={projectCloneBlockReason}
                workspaceConfigReady={workspaceConfigReady}
                launchingWorkspace={launchingWorkspace}
                busy={busy}
                onBack={() => setShowWorkspaceCreate(false)}
                onNameChange={setNewWorkspaceName}
                onWorkingDirectoryModeChange={setWorkspaceWorkingDirectoryMode}
                onAgentTypeChange={(agentType) => {
                  setWorkspaceAgentType(agentType)
                  setWorkspaceExecutionModel('')
                }}
                onModelChange={setWorkspaceExecutionModel}
                onBranchChange={setSelectedBranch}
                onExecutorChange={(executorId) => {
                  setSelectedExecutorId(executorId)
                  setNewWorkspaceExecutorId(executorId)
                }}
                onSubmit={() => void handleSubmitWorkspace()}
              />
            ) : (
              <ScrollArea className="h-full">
                <div className="space-y-6 px-5 py-5">
                  <TaskDetailHero
                    task={task}
                    taskTitleInput={taskTitleInput}
                    taskDescriptionInput={taskDescriptionInput}
                    taskStatusInput={taskStatusInput}
                    taskPriorityInput={taskPriorityInput}
                    taskStartedAtInput={taskStartedAtInput}
                    taskDueAtInput={taskDueAtInput}
                    currentUserId={user?.id}
                    pendingConfirmationWorkspaceName={pendingConfirmationWorkspace?.name}
                    awaitingConfirmation={awaitingConfirmation}
                    onAssignTask={handleTaskAssigneeChange}
                    onTitleChange={(value) => setTaskTitleInput(value.slice(0, TASK_TITLE_MAX_LENGTH))}
                    onDescriptionChange={(value) => setTaskDescriptionInput(value.slice(0, TASK_DESCRIPTION_MAX_LENGTH))}
                    onStatusChange={setTaskStatusInput}
                    onPriorityChange={setTaskPriorityInput}
                    onStartedAtChange={setTaskStartedAtInput}
                    onDueAtChange={setTaskDueAtInput}
                    onSubscriberChange={handleSubscriberChange}
                    assignees={assignees}
                    busy={busy}
                  />

                  <TaskTimeline
                    task={task}
                    activities={agentActivities}
                    workspaces={boundWorkspaces}
                    workspaceSessions={taskSessions}
                    loading={agentActivitiesLoading || workspacesLoading}
                    onOpenWorkspace={onOpenWorkspaceSession}
                    onOpenAgentActivity={setAgentTranscriptEventId}
                  />

                  <TaskAgentExecutionLog
                    taskId={task.id}
                    activities={agentActivities}
                    loading={agentActivitiesLoading}
                    actionEventId={agentActivityActionId}
                    transcriptEventId={agentTranscriptEventId}
                    transcriptSignals={agentTranscriptSignals}
                    canStartAssignedAgent={Boolean(task.assigneeAgentId) && task.status !== 'backlog'}
                    startAssignedAgentDisabled={busy || assignedAgentStarting}
                    onStartAssignedAgent={() => setShowAssignedAgentStart(true)}
                    onCancel={(eventId) => void handleCancelAgentActivity(eventId)}
                    onRetry={handleRetryAgentActivity}
                    onTranscriptEventIdChange={setAgentTranscriptEventId}
                    onOpenConversation={(sessionId) => void handleOpenAgentConversation(sessionId)}
                  />

                  <TaskDetailWorkspaceSection
                    project={project}
                    task={task}
                    projectPullRequests={projectPullRequests}
                    projectPullRequestBindings={projectPullRequestBindings}
                    taskBindings={taskBindings}
                    executors={executors}
                    preferredExecutorName={preferredExecutorName}
                    workspaces={boundWorkspaces}
                    workspaceSessions={taskSessions}
                    selectedWorkspaceId={selectedWorkspaceId}
                    pendingConfirmationWorkspaceId={pendingConfirmationWorkspace?.id}
                    loading={workspacesLoading}
                    busy={busy}
                    onCreateWorkspace={handleOpenWorkspaceCreate}
                    onOpenWorkspaceSession={(workspaceId, workspaceSessionId) => {
                      onOpenWorkspaceSession(workspaceId, workspaceSessionId)
                    }}
                    onArchiveWorkspace={handleArchiveWorkspace}
                    onDeleteWorkspace={handleDeleteWorkspace}
                  />

                  <TaskDetailSubtasksSection
                    childTasks={childTasks}
                    busy={busy}
                    onCreate={() => setShowSubtaskCreateModal(true)}
                  />

                  <TaskDetailCommentsSection
                    taskId={task.id}
                    comments={task.comments}
                    agentActivities={agentActivities}
                    currentUserId={user?.id}
                    commentInput={commentInput}
                    mentionOptions={assignees}
                    busy={busy}
                    onCommentChange={setCommentInput}
                    onCommentSubmit={handleSubmitComment}
                    onCommentEdit={handleEditComment}
                    onCommentDelete={handleDeleteComment}
                    onCommentReaction={handleCommentReaction}
                    onCommentResolution={handleCommentResolution}
                    onCommentAttachmentUpload={handleCommentAttachmentUpload}
                    onOpenAgentActivity={setAgentTranscriptEventId}
                  />

                  <TaskEnhancementSection
                    taskId={task.id}
                    projectId={task.projectId}
                    currentUserId={user?.id}
                    initialReactions={task.reactions}
                    initialAttachments={task.attachments}
                  />
                </div>
              </ScrollArea>
            )}
          </div>

          <CreateTaskModal
            open={showSubtaskCreateModal}
            onOpenChange={setShowSubtaskCreateModal}
            project={project}
            projects={project ? [project] : []}
            assignees={assignees}
            onCreate={handleCreateSubtaskFromModal}
            busy={busy}
            initialProjectId={task.projectId}
            projectLocked
            initialRequirementType="task"
            initialPriority="none"
            initialAssigneeId={getTaskAssigneeOptionId(task)}
            initialAcceptanceCriteria={task.acceptanceCriteria}
            parentTask={task}
            draftScope={`subtask:${task.id}`}
          />

          <Dialog
            open={Boolean(pendingAgentAssignee)}
            onOpenChange={(nextOpen) => {
              if (!nextOpen && !assignmentSubmitting) {
                setPendingAgentAssigneeId('')
                setAssignmentHandoffPrompt('')
              }
            }}
          >
            <DialogContent className="max-w-md border-zinc-800 bg-[#09090b] text-zinc-100">
              <DialogBody className="space-y-3">
              <DialogTitle className="text-sm font-semibold">指派给 {pendingAgentAssignee?.name}</DialogTitle>
              <DialogDescription className="text-xs text-zinc-500">
                {task.status === 'backlog'
                  ? 'Backlog 任务只保存负责人，移出 Backlog 后才会启动 Agent。'
                  : '可以立即启动 Agent，也可以先只保存负责人。'}
              </DialogDescription>

              {task.status !== 'backlog' ? (
                <Textarea
                  value={assignmentHandoffPrompt}
                  onChange={(event) => setAssignmentHandoffPrompt(event.target.value.slice(0, 4000))}
                  placeholder="给 Agent 的补充指令（可选）"
                  className="min-h-[96px] resize-y border-zinc-800 bg-zinc-950 text-sm text-zinc-200 placeholder:text-zinc-600"
                />
              ) : null}

              <div className="flex justify-end gap-2">
                {task.status !== 'backlog' ? (
                  <Button
                    type="button"
                    variant="outline"
                    disabled={assignmentSubmitting || busy}
                    onClick={() => void handleConfirmAgentAssignment('parked')}
                    className="h-8 border-zinc-800 bg-zinc-950 px-3 text-xs text-zinc-300 hover:bg-zinc-900"
                  >
                    仅指派
                  </Button>
                ) : null}
                <Button
                  type="button"
                  disabled={assignmentSubmitting || busy}
                  onClick={() => void handleConfirmAgentAssignment(task.status === 'backlog' ? 'parked' : 'now')}
                  className="h-8 bg-zinc-100 px-3 text-xs text-zinc-950 hover:bg-zinc-200"
                >
                  {task.status === 'backlog' ? '保存负责人' : '指派并启动'}
                </Button>
              </div>
              </DialogBody>
            </DialogContent>
          </Dialog>

          <Dialog
            open={showAssignedAgentStart}
            onOpenChange={(nextOpen) => {
              if (!assignedAgentStarting) {
                setShowAssignedAgentStart(nextOpen)
                if (!nextOpen) setAssignedAgentStartPrompt('')
              }
            }}
          >
            <DialogContent className="max-w-md border-zinc-800 bg-[#09090b] text-zinc-100">
              <DialogBody className="space-y-3">
              <DialogTitle className="text-sm font-semibold">启动已指派的 Agent</DialogTitle>
              <DialogDescription className="text-xs text-zinc-500">
                不改变任务负责人，为当前任务创建一轮新的 Agent 执行。
              </DialogDescription>
              <Textarea
                value={assignedAgentStartPrompt}
                onChange={(event) => setAssignedAgentStartPrompt(event.target.value.slice(0, 4000))}
                placeholder="给本轮 Agent 的补充指令（可选）"
                className="min-h-[96px] resize-y border-zinc-800 bg-zinc-950 text-sm text-zinc-200 placeholder:text-zinc-600"
              />
              <div className="flex justify-end gap-2">
                <Button
                  type="button"
                  variant="outline"
                  disabled={assignedAgentStarting}
                  onClick={() => setShowAssignedAgentStart(false)}
                  className="h-8 border-zinc-800 bg-zinc-950 px-3 text-xs text-zinc-300 hover:bg-zinc-900"
                >
                  取消
                </Button>
                <Button
                  type="button"
                  disabled={assignedAgentStarting || busy}
                  onClick={() => void handleStartAssignedAgent()}
                  className="h-8 bg-zinc-100 px-3 text-xs text-zinc-950 hover:bg-zinc-200"
                >
                  {assignedAgentStarting ? '正在启动…' : '启动 Agent'}
                </Button>
              </div>
              </DialogBody>
            </DialogContent>
          </Dialog>

          <TaskDeleteDialog
            open={showDeleteConfirm}
            onOpenChange={setShowDeleteConfirm}
            deleteTaskChecked={deleteTaskChecked}
            deleteTaskWorkspaces={deleteTaskWorkspaces}
            busy={busy}
            onDeleteTaskChange={setDeleteTaskChecked}
            onDeleteTaskWorkspacesChange={setDeleteTaskWorkspaces}
            onSubmit={() => void handleConfirmDelete()}
          />
          <DeleteWorkspaceDialog
            open={Boolean(deleteWorkspaceTarget)}
            workspaceName={deleteWorkspaceTarget?.name || ''}
            branchName={deleteWorkspaceTarget?.codeBranchName || ''}
            busy={deleteWorkspaceBusy}
            onOpenChange={(open) => {
              if (!open && !deleteWorkspaceBusy) {
                setDeleteWorkspaceTarget(null)
              }
            }}
            onConfirm={handleConfirmDeleteWorkspace}
            title="确认删除工作区「{{name}}」？"
            description="这会同时删除该工作区对应的本地隔离目录，并解除相关任务里的工作区关联。"
            localBranchLabel="同时删除本地工作分支"
            localBranchHint="只会尝试删除 Wemux 创建的受管 worktree 分支。"
            remoteBranchLabel="同时删除远程工作分支"
            remoteBranchHint="会删除对应的 origin 分支；勾选后也会一并删除本地分支。"
            cancelText="取消"
            confirmText="删除工作区"
          />
        </div>
      </DrawerContent>
    </Drawer>
  )
}
