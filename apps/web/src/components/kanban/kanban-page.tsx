/**
 * [INPUT]: Project-scoped tasks, assignees, executors, route actions, and task-detail mutations.
 * [OUTPUT]: Kanban/list/files board plus task creation and task-detail surfaces.
 * [POS]: Kanban page composition component; state loading and server validation stay upstream.
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { FolderGit2, GitBranch, Pencil, Plus, List, Columns3, FolderTree, Loader2, MoreHorizontal, Filter, SlidersHorizontal, PanelRight } from 'lucide-react'
import type { ProjectAssignee, TaskAssignmentOptions, TaskQuickCreatePayload } from '../../lib/api'
import { useApp } from '../../lib/app-provider'
import { useTranslation } from '../../lib/i18n/react'
import { getTaskAssigneeOptionId } from '../../lib/project-collaboration-data'
import { getProjectSourceDisplay, getProjectVersionControlLabel } from '../../lib/project-form'
import type { TaskPullRequestDisplay } from '../../lib/task-pull-request'
import { cn } from '../../lib/utils'
import { Badge } from '../ui/badge'
import { Button } from '../ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '../ui/dropdown-menu'
import { ExecutorSelect, type ExecutorSelectOption } from '../ui/executor-select'
import { SearchableSelect } from '../ui/searchable-select'
import { useSidebar } from '../ui/sidebar'
import { WorkspaceFilesPanel } from '../workspaces/workspace-files-panel'
import { ProjectCloneStatusBadge } from '../project-clone-status-badge'
import { KanbanColumn } from './kanban-column'
import { KanbanCard } from './kanban-card'
import { TaskDetailPanel } from './task-detail-panel'
import { CreateTaskModal, type CreateTaskFormPayload } from './create-task-modal'
import { columnConfig } from './constants'
import { TaskListView } from './task-list-view'
import type { ExecutorRecord, GitHubResourceBinding, Project, ProjectPullRequestReviewSummary, Task, TaskStatus } from '@shared/types'

interface KanbanPageProps {
  tasks: Task[]
  projects: Project[]
  project: Project | null
  selectedTaskId: string
  activeAgentTaskIds: string[]
  pullRequestDisplaysByTaskId: Record<string, TaskPullRequestDisplay>
  projectPullRequests: ProjectPullRequestReviewSummary[]
  projectPullRequestBindings: GitHubResourceBinding[]
  createTaskOpen: boolean
  onCreateTaskOpenChange: (open: boolean) => void
  onSelectTask: (id: string) => void
  onMoveTask: (taskId: string, status: TaskStatus) => void
  onCleanupTask: (id: string) => void
  onDeleteTask: (id: string) => Promise<unknown>
  onDeleteTaskWorkspaces: (id: string) => Promise<unknown>
  onOpenTaskInVSCode: (id: string) => void
  onSendToTask: (taskId: string, message: string) => Promise<void>
  onOpenWorkspaceSession: (taskId: string, workspaceId: string, workspaceSessionId?: string, launchId?: string, initialPrompt?: string, baseBranch?: string, autoEnvironmentInstall?: boolean) => void
  onTaskUpdate: (task: Task) => void
  onCreateTask: (payload: CreateTaskFormPayload) => Promise<boolean>
  onQuickCreateTask: (payload: TaskQuickCreatePayload) => Promise<boolean>
  createTaskInitialDescription?: string
  onQuickCreateWorkspace: () => void
  onEditProject: () => void
  assignees: ProjectAssignee[]
  assigneesById: Record<string, ProjectAssignee>
  onAssignTask: (taskId: string, assigneeId?: string, options?: TaskAssignmentOptions) => Promise<unknown>
  executors: ExecutorRecord[]
  onAssignExecutor: (taskId: string, executorNodeId: string) => void
  onExecuteTask: (taskId: string, payload: { workspaceId: string; baseBranch?: string; returnMode: 'summary' | 'branch' | 'commit'; gitIdentityMode: 'personal' }) => Promise<void>
  onBindTaskWorkspace: (taskId: string, workspaceId: string) => Promise<void>
  onCreateSubtask: (taskId: string, payload: CreateTaskFormPayload) => Promise<void>
  fileTreeLoading: boolean
  fileTreeExecutorId: string
  fileTreeDirectoryPath: string
  fileTreeNodeOptions: ExecutorSelectOption[]
  onFileTreeExecutorChange: (executorId: string) => void
  busy: boolean
}

export function KanbanPage({
  tasks,
  projects,
  project,
  selectedTaskId,
  activeAgentTaskIds,
  pullRequestDisplaysByTaskId,
  projectPullRequests,
  projectPullRequestBindings,
  createTaskOpen,
  onCreateTaskOpenChange,
  onSelectTask,
  onMoveTask,
  onCleanupTask,
  onDeleteTask,
  onDeleteTaskWorkspaces,
  onOpenTaskInVSCode,
  onSendToTask,
  onOpenWorkspaceSession,
  onTaskUpdate,
  onCreateTask,
  onQuickCreateTask,
  createTaskInitialDescription,
  onQuickCreateWorkspace,
  onEditProject,
  assignees,
  assigneesById,
  onAssignTask,
  executors,
  onAssignExecutor,
  onExecuteTask,
  onBindTaskWorkspace,
  onCreateSubtask,
  fileTreeLoading,
  fileTreeExecutorId,
  fileTreeDirectoryPath,
  fileTreeNodeOptions,
  onFileTreeExecutorChange,
  busy,
}: KanbanPageProps) {
  const { t } = useTranslation()
  const { isMobile } = useSidebar()
  const { setMobileHeaderActions } = useApp()
  const moreMenuLabel = '更多'
  const selectedTask = tasks.find((t) => t.id === selectedTaskId)
  const mobileActionHandlersRef = useRef({
    onCreateTaskOpenChange,
    onEditProject,
    onQuickCreateWorkspace,
  })
  const [draggingTaskId, setDraggingTaskId] = useState('')
  const [dropStatus, setDropStatus] = useState<TaskStatus | null>(null)
  const [viewMode, setViewMode] = useState<'kanban' | 'list' | 'files'>('kanban')
  const [viewModeTouched, setViewModeTouched] = useState(false)
  useEffect(() => {
    mobileActionHandlersRef.current = {
      onCreateTaskOpenChange,
      onEditProject,
      onQuickCreateWorkspace,
    }
  }, [onCreateTaskOpenChange, onEditProject, onQuickCreateWorkspace])
  const viewModeItems = useMemo(() => [
    { key: 'kanban' as const, label: t('kanban.page.kanbanView'), icon: Columns3 },
    { key: 'list' as const, label: t('kanban.page.listView'), icon: List },
    { key: 'files' as const, label: t('kanban.page.filesView'), icon: FolderTree },
  ], [t])
  const mobileHeaderLabels = useMemo(() => ({
    createTask: t('kanban.page.createTask'),
    createWorkspace: t('kanban.page.createWorkspace'),
    edit: t('common.edit'),
  }), [t])
  const activeViewMode = useMemo(
    () => viewModeItems.find((item) => item.key === viewMode) ?? viewModeItems[0],
    [viewMode, viewModeItems],
  )
  const mobileColumnSummary = useMemo(
    () => columnConfig.map((column) => ({
      key: column.key,
      title: column.title,
      count: tasks.filter((task) => task.status === column.key).length,
    })).filter((column) => column.count > 0),
    [tasks],
  )
  const showMobileSummary = isMobile && viewMode === 'kanban'
  const showPageHeader = !isMobile || showMobileSummary
  const boardWorkCount = tasks.filter((task) => !['done', 'blocked'].includes(task.status)).length
  const activeAgentTaskIdSet = useMemo(() => new Set(activeAgentTaskIds), [activeAgentTaskIds])

  const handleViewModeChange = (nextViewMode: 'kanban' | 'list' | 'files') => {
    setViewModeTouched(true)
    setViewMode(nextViewMode)
  }

  const mobileHeaderActions = useMemo(() => (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="h-8 w-8 rounded-full border-zinc-700 bg-zinc-950 text-zinc-200 hover:bg-zinc-900 hover:text-zinc-50"
            aria-label={activeViewMode.label}
            title={activeViewMode.label}
          >
            <activeViewMode.icon className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-44">
          {viewModeItems.map((item) => (
            <DropdownMenuItem key={item.key} onSelect={() => {
              setViewModeTouched(true)
              setViewMode(item.key)
            }}>
              <item.icon className="h-4 w-4" />
              <span>{item.label}</span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="h-8 w-8 rounded-full border-zinc-700 bg-zinc-950 text-zinc-200 hover:bg-zinc-900 hover:text-zinc-50"
            aria-label={moreMenuLabel}
          >
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuItem onSelect={() => mobileActionHandlersRef.current.onCreateTaskOpenChange(true)}>
            <Plus className="h-4 w-4" />
            <span>{mobileHeaderLabels.createTask}</span>
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => mobileActionHandlersRef.current.onQuickCreateWorkspace()}>
            <FolderGit2 className="h-4 w-4" />
            <span>{mobileHeaderLabels.createWorkspace}</span>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => mobileActionHandlersRef.current.onEditProject()}>
            <Pencil className="h-4 w-4" />
            <span>{mobileHeaderLabels.edit}</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  ), [activeViewMode, mobileHeaderLabels, moreMenuLabel, viewModeItems])

  useEffect(() => {
    if (viewModeTouched) {
      return
    }

    setViewMode(isMobile ? 'list' : 'kanban')
  }, [isMobile, viewModeTouched])

  useEffect(() => {
    if (!isMobile) {
      setMobileHeaderActions(null)
      return
    }

    setMobileHeaderActions(mobileHeaderActions)
  }, [isMobile, mobileHeaderActions, setMobileHeaderActions])

  useEffect(() => () => {
    setMobileHeaderActions(null)
  }, [setMobileHeaderActions])

  const handleDragStart = (taskId: string) => (event: React.DragEvent<HTMLDivElement>) => {
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', taskId)
    setDraggingTaskId(taskId)
  }

  const handleDragEnd = () => {
    setDraggingTaskId('')
    setDropStatus(null)
  }

  const handleColumnDragOver = (status: TaskStatus) => (event: React.DragEvent<HTMLDivElement>) => {
    if (!draggingTaskId) {
      return
    }

    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
    setDropStatus(status)
  }

  const handleColumnDragLeave = (status: TaskStatus) => (event: React.DragEvent<HTMLDivElement>) => {
    if (!draggingTaskId) {
      return
    }

    const nextTarget = event.relatedTarget
    if (nextTarget instanceof Node && event.currentTarget.contains(nextTarget)) {
      return
    }

    setDropStatus((current) => (current === status ? null : current))
  }

  const handleColumnDrop = (status: TaskStatus) => (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    const taskId = event.dataTransfer.getData('text/plain') || draggingTaskId
    const task = tasks.find((item) => item.id === taskId)

    setDraggingTaskId('')
    setDropStatus(null)

    if (!task || task.status === status) {
      return
    }

    onMoveTask(task.id, status)
  }

  if (!project) {
    return (
      <div className="rounded-lg border border-zinc-800 bg-zinc-950/70 p-8 text-center">
        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-lg border border-zinc-800 bg-zinc-900">
          <FolderGit2 size={32} className="text-zinc-500" />
        </div>
        <h2 className="mb-2 text-xl font-semibold text-zinc-100">{t('kanban.page.noProjectTitle')}</h2>
        <p className="text-sm text-zinc-400">{t('kanban.page.noProjectDescription')}</p>
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 overflow-hidden bg-[#050505]">
      <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
        {showPageHeader ? (
          <header className={cn('shrink-0 sm:px-3 sm:py-2', isMobile ? 'px-3 py-3' : 'px-3 py-2')}>
            {isMobile ? null : (
              <div className="flex min-w-0 items-center justify-between gap-3">
                <div className="flex min-w-0 items-center gap-2">
                  <button
                    type="button"
                    className="h-7 rounded-md border border-zinc-800 bg-zinc-900/85 px-3 text-xs font-semibold text-zinc-200 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)] hover:bg-zinc-800"
                  >
                    全部
                  </button>
                  <button
                    type="button"
                    className="h-7 rounded-md border border-zinc-800 bg-zinc-950/55 px-3 text-xs font-semibold text-zinc-500 hover:bg-zinc-900 hover:text-zinc-300"
                  >
                    成员
                  </button>
                  <button
                    type="button"
                    className="h-7 rounded-md border border-zinc-800 bg-zinc-950/55 px-3 text-xs font-semibold text-zinc-500 hover:bg-zinc-900 hover:text-zinc-300"
                  >
                    智能体
                  </button>
                </div>

                <div className="flex min-w-0 items-center gap-1.5">
                  <div className="hidden min-w-0 items-center gap-1.5 text-xs text-zinc-500 xl:flex">
                    <Badge className="rounded-md border border-zinc-800 bg-zinc-950/60 px-2 py-1 font-medium text-zinc-400">
                      {project.name}
                    </Badge>
                    <ProjectCloneStatusBadge project={project} />
                    <Badge className="rounded-md border border-zinc-800 bg-zinc-950/60 px-2 py-1 font-medium text-zinc-500">
                      {getProjectVersionControlLabel(project, t)}
                    </Badge>
                    <span className="flex min-w-0 items-center gap-1.5">
                      <GitBranch className="size-3 shrink-0" />
                      <span className="max-w-64 truncate">{getProjectSourceDisplay(project, t)}</span>
                    </span>
                  </div>
                  <Badge className="rounded-md border border-zinc-800 bg-zinc-900/80 px-2.5 py-1 text-xs font-semibold text-zinc-400">
                    {boardWorkCount} 工作中
                  </Badge>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    onClick={onQuickCreateWorkspace}
                    className="size-7 rounded-md border-zinc-800 bg-zinc-950/55 text-zinc-500 hover:bg-zinc-900 hover:text-zinc-200"
                    title={t('kanban.page.createWorkspace')}
                    aria-label={t('kanban.page.createWorkspace')}
                  >
                    <FolderGit2 className="size-3.5" />
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    onClick={onEditProject}
                    className="size-7 rounded-md border-zinc-800 bg-zinc-950/55 text-zinc-500 hover:bg-zinc-900 hover:text-zinc-200"
                    title={t('common.edit')}
                    aria-label={t('common.edit')}
                  >
                    <Pencil className="size-3.5" />
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    className="size-7 rounded-md border-zinc-800 bg-zinc-950/55 text-zinc-500 hover:bg-zinc-900 hover:text-zinc-200"
                    title="筛选"
                    aria-label="筛选"
                  >
                    <Filter className="size-3.5" />
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    className="size-7 rounded-md border-zinc-800 bg-zinc-950/55 text-zinc-500 hover:bg-zinc-900 hover:text-zinc-200"
                    title="显示设置"
                    aria-label="显示设置"
                  >
                    <SlidersHorizontal className="size-3.5" />
                  </Button>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        className="size-7 rounded-md border-zinc-800 bg-zinc-950/55 text-zinc-500 hover:bg-zinc-900 hover:text-zinc-200"
                        title={activeViewMode.label}
                        aria-label={activeViewMode.label}
                      >
                        <PanelRight className="size-3.5" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-44">
                      {viewModeItems.map((item) => (
                        <DropdownMenuItem key={item.key} onSelect={() => handleViewModeChange(item.key)}>
                          <item.icon className="h-4 w-4" />
                          <span>{item.label}</span>
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                  <Button
                    size="icon"
                    onClick={() => onCreateTaskOpenChange(true)}
                    className="size-7 rounded-md bg-zinc-100 text-zinc-950 hover:bg-zinc-300"
                    title={t('kanban.page.createTask')}
                    aria-label={t('kanban.page.createTask')}
                  >
                    <Plus className="size-3.5" />
                  </Button>
                </div>
              </div>
            )}

            {showMobileSummary ? (
              <div className="flex gap-2 overflow-x-auto pb-1">
                {mobileColumnSummary.length > 0 ? mobileColumnSummary.map((column) => (
                  <div
                    key={column.key}
                    className="shrink-0 rounded-full border border-zinc-800 bg-zinc-950/70 px-3 py-1.5 text-xs font-medium text-zinc-300"
                  >
                    {column.title} · {column.count}
                  </div>
                )) : (
                  <div className="rounded-full border border-zinc-800 bg-zinc-950/70 px-3 py-1.5 text-xs text-zinc-500">
                    {t('task.noTasks')}
                  </div>
                )}
              </div>
            ) : null}
          </header>
        ) : null}

        <div className="flex h-full min-h-0 flex-1 overflow-auto">
          {viewMode === 'kanban' ? (
            <div
              className={cn(
                "scrollbar-subtle flex h-full min-h-0 gap-3 overflow-x-auto px-3 pb-4 pt-3 sm:px-3",
                isMobile
                  ? "items-stretch snap-x snap-mandatory"
                  : "items-stretch pb-3",
              )}
            >
              {columnConfig.map((col) => {
                const columnTasks = tasks.filter((t) => t.status === col.key)

                return (
                  <KanbanColumn
                    key={col.key}
                    className={cn(
                      isMobile
                        ? "h-full min-w-[85vw] max-w-[85vw] shrink-0 snap-center"
                        : "h-full w-[19.5rem] min-w-[19.5rem] shrink-0 2xl:w-[20rem] 2xl:min-w-[20rem]",
                    )}
                    status={col.key}
                    title={col.title}
                    count={columnTasks.length}
                    isDropTarget={dropStatus === col.key}
                    onDragOver={handleColumnDragOver(col.key)}
                    onDragLeave={handleColumnDragLeave(col.key)}
                    onDrop={handleColumnDrop(col.key)}
                  >
                    {columnTasks.map((task) => (
                      <KanbanCard
                        key={task.id}
                        task={task}
                        assignee={(() => {
                          const assigneeId = getTaskAssigneeOptionId(task)
                          return assigneeId ? assigneesById[assigneeId] : undefined
                        })()}
                        isSelected={selectedTaskId === task.id}
                        isDragging={draggingTaskId === task.id}
                        draggable={!isMobile}
                        activeAgentEvent={activeAgentTaskIdSet.has(task.id)}
                        pullRequestDisplay={pullRequestDisplaysByTaskId[task.id]}
                        onClick={() => onSelectTask(task.id)}
                        onDragStart={!isMobile ? handleDragStart(task.id) : undefined}
                        onDragEnd={handleDragEnd}
                      />
                    ))}
                    {columnTasks.length === 0 ? (
                      <div className="px-4 py-12 text-center text-[13px] font-medium text-zinc-600">
                        无 issue
                      </div>
                    ) : null}
                  </KanbanColumn>
                )
              })}
            </div>
          ) : viewMode === 'files' ? (
            <div className="flex h-full min-h-full flex-col gap-3 px-3 pb-4 pt-3 sm:px-4">
              <div className="grid gap-2 lg:grid-cols-[minmax(0,18rem)_minmax(0,1fr)] lg:items-center">
                <ExecutorSelect
                  value={fileTreeExecutorId}
                  options={fileTreeNodeOptions}
                  placeholder={t('kanban.page.fileTreeSelectNode', { defaultValue: '选择节点' })}
                  searchPlaceholder={t('kanban.page.fileTreeSearchNode', { defaultValue: '搜索节点' })}
                  emptyText={t('kanban.page.fileTreeNoNode', { defaultValue: '没有可浏览的节点' })}
                  onChange={onFileTreeExecutorChange}
                />
                {fileTreeDirectoryPath ? (
                  <span className="truncate font-mono text-[11px] text-zinc-600">{fileTreeDirectoryPath}</span>
                ) : (
                  <span className="text-xs text-zinc-500">
                    {t('kanban.page.filesUnavailableHint')}
                  </span>
                )}
              </div>

              {fileTreeLoading ? (
                <div className="flex min-h-[18rem] flex-1 items-center justify-center rounded-xl border border-zinc-800 bg-zinc-950/50 px-6 text-sm text-zinc-400">
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  {t('kanban.page.filesLoading')}
                </div>
              ) : fileTreeExecutorId && fileTreeDirectoryPath ? (
                <WorkspaceFilesPanel
                  executorId={fileTreeExecutorId}
                  initialDirectoryPath={fileTreeDirectoryPath}
                  className="min-h-[32rem] flex-1"
                />
              ) : (
                <div className="flex min-h-[18rem] flex-1 flex-col items-center justify-center rounded-xl border border-dashed border-zinc-800 bg-zinc-950/40 px-6 text-center">
                  <FolderTree className="h-8 w-8 text-zinc-600" />
                  <p className="mt-3 text-sm font-medium text-zinc-200">{t('kanban.page.filesUnavailable')}</p>
                  <p className="mt-2 max-w-xl text-sm text-zinc-500">{t('kanban.page.filesUnavailableHint')}</p>
                </div>
              )}
            </div>
          ) : (
            <div className="px-3 pb-4 pt-3 sm:px-4">
              <TaskListView
                tasks={tasks}
                selectedTaskId={selectedTaskId}
                assigneesById={assigneesById}
                activeAgentTaskIds={activeAgentTaskIdSet}
                onSelectTask={onSelectTask}
              />
            </div>
          )}
        </div>
      </main>

      {selectedTask ? (
        <TaskDetailPanel
          project={project}
          task={selectedTask}
          tasks={tasks}
          projectPullRequests={projectPullRequests}
          projectPullRequestBindings={projectPullRequestBindings}
          assignees={assignees}
          executors={executors}
          open={!!selectedTask}
          onClose={() => onSelectTask('')}
          onCleanup={() => onCleanupTask(selectedTask.id)}
          onDelete={async ({ deleteTask, deleteTaskWorkspaces }) => {
            if (deleteTaskWorkspaces) {
              await onDeleteTaskWorkspaces(selectedTask.id)
            }
            if (deleteTask) {
              await onDeleteTask(selectedTask.id)
            }
          }}
          onSendMessage={(msg) => onSendToTask(selectedTask.id, msg)}
          onAssignExecutor={onAssignExecutor}
          onOpenWorkspaceSession={(workspaceId, workspaceSessionId, launchId, initialPrompt, baseBranch, autoEnvironmentInstall) => onOpenWorkspaceSession(selectedTask.id, workspaceId, workspaceSessionId, launchId, initialPrompt, baseBranch, autoEnvironmentInstall)}
          onTaskUpdate={onTaskUpdate}
          onAssignTask={onAssignTask}
          onExecuteTask={onExecuteTask}
          onBindTaskWorkspace={onBindTaskWorkspace}
          onCreateSubtask={onCreateSubtask}
          busy={busy}
        />
      ) : null}

      <CreateTaskModal
        open={createTaskOpen}
        onOpenChange={onCreateTaskOpenChange}
        project={project}
        projects={projects}
        assignees={assignees}
        onCreate={onCreateTask}
        onQuickCreate={onQuickCreateTask}
        initialDescription={createTaskInitialDescription}
        busy={busy}
      />
    </div>
  )
}
