/**
 * [INPUT]: Derived workspace list items, selection/runtime state, and workspace navigation callbacks.
 * [OUTPUT]: Shared workspace cards and grouped/flat list views with creator, sessions, runtime status, preview, and PR signals.
 * [POS]: Reusable workspace-list presentation boundary consumed by /workspaces and task-detail workspace sections.
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */
import { memo, useEffect, useMemo, useState, type DragEvent, type MouseEvent, type ReactNode } from 'react'
import type { WorkspaceEnvironmentStatusSnapshot } from '@shared/task-environment'
import { Archive, ChevronDown, ChevronRight, FolderGit2, LayoutGrid, Loader2, Pencil, Play, Plus, Radio, Rocket, Search, SlidersHorizontal, TerminalSquare, Workflow } from 'lucide-react'
import { sortProjectsByDisplayOrder } from '@shared/project-workspace-order'
import {
  resolveWorkspaceTerminalRuntimeStatus,
  type WorkspaceTerminalRuntimeSnapshot,
} from '@shared/workspace-runtime'
import {
  resolveWorkspaceListItemDisplayStatus,
  resolveWorkspaceListItemDefaultSessionTarget,
  text,
  type WorkspaceListItem,
} from './workspaces-page-utils'
import { TaskPullRequestBadge } from '../task-pull-request-badge'
import { RailwayDeploymentBadge } from '../railway-deployment-badge'
import {
  resolveWorkspaceIndexedPullRequestDisplay,
} from '../../lib/task-pull-request'
import {
  resolveWorkspaceIndexedRailwayDeploymentDisplay,
} from '../../lib/railway-deployment'
import { Button } from '../ui/button'
import { Avatar, AvatarFallback, AvatarImage } from '../ui/avatar'
import { IdentityCardWrapper } from '../profiles/identity-card-wrapper'
import { Checkbox } from '../ui/checkbox'
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '../ui/dialog'
import { Input } from '../ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover'
import { ProjectIdentity } from '../project-identity'
import { ProjectCloneStatusBadge } from '../project-clone-status-badge'
import { resolveListPreviewAddress, type ResolvedListPreviewAddress } from './workspace-list-preview-address'
import { api } from '../../lib/api'
import { resolveMediaUrl } from '../../lib/api'
import { toast } from 'sonner'
import { useTranslation } from '../../lib/i18n/react'
import { isImeComposingKeyboardEvent } from '../../lib/ime-keyboard'
import { cn } from '../../lib/utils'
import type { GitHubResourceBinding, Project, ProjectPullRequestReviewSummary, RailwayDeploymentSummary, RailwayResourceBinding } from '@shared/types'
import {
  applyWorkspaceListRowDragImage,
  reorderWorkspaceListIds,
  resolveWorkspaceListDropPosition,
  type WorkspaceListDropPosition,
} from './workspaces-list-dnd'
import { WorkspacesTablePanel } from './workspaces-table-panel'

const COLLAPSED_WORKSPACE_SESSION_PREVIEW_COUNT = 3
type WorkspaceListViewMode = 'grouped' | 'flat'

const WORKSPACE_LIST_STATUS_META = {
  running: {
    labelKey: 'workspaceOverview.status.running',
    defaultValue: '运行中',
    className: 'bg-sky-500/10 text-sky-300',
  },
  queued: {
    labelKey: 'workspaceOverview.status.queued',
    defaultValue: '排队',
    className: 'bg-amber-500/10 text-amber-300',
  },
  attention: {
    labelKey: 'workspaceOverview.status.attention',
    defaultValue: '待关注',
    className: 'bg-amber-500/10 text-amber-300',
  },
  complete: {
    labelKey: 'workspaceOverview.status.complete',
    defaultValue: '已完成',
    className: 'bg-emerald-500/10 text-emerald-300',
  },
  error: {
    labelKey: 'workspaceOverview.status.error',
    defaultValue: '异常',
    className: 'bg-orange-500/10 text-orange-300',
  },
  idle: {
    labelKey: 'workspaceOverview.status.idle',
    defaultValue: '空闲',
    className: 'bg-zinc-800/80 text-zinc-400',
  },
} as const

export const filterWorkspaceProjectGroups = <T extends { project: { id: string }; items: unknown[] }>(
  projectGroups: T[],
  visibleProjectIds: string[] | null,
) => {
  if (!visibleProjectIds) {
    return projectGroups
  }

  const visibleProjectIdSet = new Set(visibleProjectIds)
  return projectGroups.filter((group) => visibleProjectIdSet.has(group.project.id))
}

const resolveVisibleProjectIds = (
  projects: Project[],
  visibleProjectIds: string[] | null,
) => visibleProjectIds ?? projects.map((project) => project.id)

export const invertVisibleProjectIds = (
  projects: Project[],
  visibleProjectIds: string[] | null,
) => {
  const allProjectIds = projects.map((project) => project.id)
  const currentVisibleProjectIds = new Set(resolveVisibleProjectIds(projects, visibleProjectIds))
  const nextVisibleProjectIds = allProjectIds.filter((projectId) => !currentVisibleProjectIds.has(projectId))
  return nextVisibleProjectIds.length === allProjectIds.length ? null : nextVisibleProjectIds
}

export const toggleSelectAllVisibleProjectIds = (
  projects: Project[],
  visibleProjectIds: string[] | null,
) => {
  const allProjectIds = projects.map((project) => project.id)
  const currentVisibleProjectIds = resolveVisibleProjectIds(projects, visibleProjectIds)
  const allSelected = currentVisibleProjectIds.length === allProjectIds.length
  return allSelected ? invertVisibleProjectIds(projects, visibleProjectIds) : null
}

interface WorkspacesListPanelProps {
  isMobile?: boolean
  activeFilteredItems: WorkspaceListItem[]
  archivedFilteredItems: WorkspaceListItem[]
  archivedWorkspaceCount?: number
  terminalOpenWorkspaceIds?: Record<string, boolean>
  environmentStartCommandRunningWorkspaceIds?: Record<string, boolean>
  workspaceEnvironmentStatusesByWorkspaceId?: Record<string, WorkspaceEnvironmentStatusSnapshot>
  projectPullRequests?: ProjectPullRequestReviewSummary[]
  githubResourceBindings?: GitHubResourceBinding[]
  railwayDeployments?: RailwayDeploymentSummary[]
  railwayResourceBindings?: RailwayResourceBinding[]
  projects: Project[]
  visibleProjectIds: string[] | null
  searchQuery: string
  selectedWorkspaceId: string
  connectedRight?: boolean
  embedded?: boolean
  headerActions?: ReactNode
  onCreate: () => void
  onCreateForProject: (projectId: string) => void
  onEditProject: (projectId: string) => void
  onLoadProject?: (projectId: string) => void
  onVisibleProjectIdsChange: (value: string[] | null) => void
  onSearchChange: (value: string) => void
  onSelectWorkspace: (workspaceId: string) => void
  onArchivedSectionExpandedChange?: (expanded: boolean) => void
  onReorderProjects?: (orderedProjectIds: string[]) => void | Promise<void>
  onReorderWorkspaces?: (projectId: string, orderedWorkspaceIds: string[]) => void | Promise<void>
  onRenameWorkspaceSession?: (
    workspaceSessionId: string,
    title: string,
    target?: { workspaceId: string; taskId?: string },
  ) => Promise<void>
  onSelectWorkspaceSessionTarget?: (target: {
    workspaceId: string
    workspaceSessionId: string
    taskId?: string
  }) => void
  showTableOverview?: boolean
  onToggleTableOverview?: () => void
}

type DropPreviewDragHandler = (
  event: DragEvent<HTMLDivElement>,
  position: WorkspaceListDropPosition,
) => void

export const resolveWorkspaceListTerminalOpen = (params: {
  localTerminalOpen: boolean
  runtimeTerminal?: WorkspaceTerminalRuntimeSnapshot
  selected: boolean
}) => {
  if (resolveWorkspaceTerminalRuntimeStatus(params.runtimeTerminal) === 'open') {
    return true
  }

  return params.selected && params.localTerminalOpen
}

export const sortWorkspaceListItemsByRecentActivity = (items: WorkspaceListItem[]) => (
  [...items].sort((left, right) => (
    right.recentActivityAt.localeCompare(left.recentActivityAt)
    || new Date(right.workspace.updatedAt).getTime() - new Date(left.workspace.updatedAt).getTime()
  ) || left.workspace.name.localeCompare(right.workspace.name))
)

function WorkspacesListPanelInner({
  isMobile = false,
  activeFilteredItems,
  archivedFilteredItems,
  archivedWorkspaceCount = 0,
  terminalOpenWorkspaceIds = {},
  environmentStartCommandRunningWorkspaceIds = {},
  workspaceEnvironmentStatusesByWorkspaceId = {},
  projectPullRequests = [],
  githubResourceBindings = [],
  railwayDeployments = [],
  railwayResourceBindings = [],
  projects,
  visibleProjectIds,
  searchQuery,
  selectedWorkspaceId,
  connectedRight = false,
  embedded = false,
  headerActions,
  onCreate,
  onCreateForProject,
  onEditProject,
  onLoadProject,
  onVisibleProjectIdsChange,
  onSearchChange,
  onSelectWorkspace,
  onArchivedSectionExpandedChange,
  onReorderProjects,
  onReorderWorkspaces,
  onRenameWorkspaceSession,
  onSelectWorkspaceSessionTarget,
  showTableOverview,
  onToggleTableOverview,
}: WorkspacesListPanelProps) {
  const { t } = useTranslation()
  const [collapsedProjectIds, setCollapsedProjectIds] = useState<Record<string, boolean>>({})
  const [archivedSectionCollapsed, setArchivedSectionCollapsed] = useState(true)
  const [draggedProjectItem, setDraggedProjectItem] = useState<{
    projectId: string
    sectionHeight: number
  } | null>(null)
  const [projectDropTarget, setProjectDropTarget] = useState<{
    projectId: string
    position: WorkspaceListDropPosition
  } | null>(null)
  const [draggedWorkspaceItem, setDraggedWorkspaceItem] = useState<{
    projectId: string
    workspaceId: string
    rowHeight: number
  } | null>(null)
  const [workspaceDropTarget, setWorkspaceDropTarget] = useState<{
    projectId: string
    workspaceId: string
    position: WorkspaceListDropPosition
  } | null>(null)
  const [sessionRenameTarget, setSessionRenameTarget] = useState<{
    id: string
    title: string
    workspaceId: string
    taskId?: string
  } | null>(null)
  const [sessionRenameDraft, setSessionRenameDraft] = useState('')
  const [sessionRenameBusy, setSessionRenameBusy] = useState(false)
  const [listViewMode, setListViewMode] = useState<WorkspaceListViewMode>('grouped')

  const openSessionRenameDialog = (session: {
    id: string
    title: string
    workspaceId: string
    taskId?: string
  }) => {
    setSessionRenameTarget(session)
    setSessionRenameDraft(session.title)
  }

  const handleRenameWorkspaceSession = async () => {
    const nextTitle = sessionRenameDraft.trim()
    if (!sessionRenameTarget || !nextTitle || !onRenameWorkspaceSession) {
      return
    }

    setSessionRenameBusy(true)
    try {
      await onRenameWorkspaceSession(sessionRenameTarget.id, nextTitle, {
        workspaceId: sessionRenameTarget.workspaceId,
        taskId: sessionRenameTarget.taskId,
      })
      setSessionRenameTarget(null)
      setSessionRenameDraft('')
    } finally {
      setSessionRenameBusy(false)
    }
  }

  const buildItemsByProjectId = (items: WorkspaceListItem[]) => {
    const map = new Map<string, WorkspaceListItem[]>()
    for (const item of items) {
      const existing = map.get(item.project.id)
      if (existing) {
        existing.push(item)
      } else {
        map.set(item.project.id, [item])
      }
    }
    return map
  }

  const activeItemsByProjectId = useMemo(
    () => buildItemsByProjectId(activeFilteredItems),
    [activeFilteredItems],
  )
  const archivedItemsByProjectId = useMemo(
    () => buildItemsByProjectId(archivedFilteredItems),
    [archivedFilteredItems],
  )

  const buildProjectGroups = (itemsByProjectId: Map<string, WorkspaceListItem[]>) => (
    sortProjectsByDisplayOrder(projects).map((project) => ({
      project,
      items: sortWorkspaceListItemsByRecentActivity(itemsByProjectId.get(project.id) ?? []),
    }))
  )

  // Show all projects, even those without workspaces
  const activeProjectGroups = useMemo(
    () => filterWorkspaceProjectGroups(buildProjectGroups(activeItemsByProjectId), visibleProjectIds),
    [activeItemsByProjectId, visibleProjectIds, projects],
  )
  const archivedProjectGroups = useMemo(
    () => filterWorkspaceProjectGroups(
      buildProjectGroups(archivedItemsByProjectId)
        .filter((group) => group.items.length > 0),
      visibleProjectIds,
    ),
    [archivedItemsByProjectId, visibleProjectIds, projects],
  )
  const hasArchivedItems = archivedFilteredItems.length > 0
  const hasArchivedSection = archivedWorkspaceCount > 0
  const selectedArchivedWorkspaceVisible = archivedFilteredItems.some((item) => item.workspace.id === selectedWorkspaceId)
  const activeFlatItems = useMemo(
    () => sortWorkspaceListItemsByRecentActivity(activeFilteredItems),
    [activeFilteredItems],
  )
  const archivedFlatItems = useMemo(
    () => sortWorkspaceListItemsByRecentActivity(archivedFilteredItems),
    [archivedFilteredItems],
  )
  const visibleProjectIdSet = useMemo(
    () => new Set(visibleProjectIds ?? projects.map((project) => project.id)),
    [projects, visibleProjectIds],
  )
  const selectedProjectCount = visibleProjectIdSet.size
  const allProjectsSelected = selectedProjectCount >= projects.length
  const projectVisibilityLabel = selectedProjectCount >= projects.length
    ? t('workspace.page.projectDisplay.all', { defaultValue: '全部项目' })
    : t('workspace.page.projectDisplay.selectedCount', {
      defaultValue: '已选 {{count}} / {{total}}',
      count: selectedProjectCount,
      total: projects.length,
    })

  const toggleProjectVisibility = (projectId: string, checked: boolean) => {
    const currentVisibleProjectIds = resolveVisibleProjectIds(projects, visibleProjectIds)
    const nextVisibleProjectIds = checked
      ? [...currentVisibleProjectIds, projectId]
      : currentVisibleProjectIds.filter((id) => id !== projectId)
    const dedupedVisibleProjectIds = [...new Set(nextVisibleProjectIds)]

    if (dedupedVisibleProjectIds.length === projects.length) {
      onVisibleProjectIdsChange(null)
      return
    }

    onVisibleProjectIdsChange(dedupedVisibleProjectIds)
  }

  useEffect(() => {
    if (selectedArchivedWorkspaceVisible) {
      setArchivedSectionCollapsed(false)
    }
  }, [selectedArchivedWorkspaceVisible])

  useEffect(() => {
    onArchivedSectionExpandedChange?.(!archivedSectionCollapsed)
  }, [archivedSectionCollapsed, onArchivedSectionExpandedChange])

  const reorderProjectIds = (
    orderedProjectIds: string[],
    draggedId: string,
    targetId: string,
    position: WorkspaceListDropPosition,
  ) => {
    if (!draggedId || !targetId || draggedId === targetId) {
      return null
    }

    const nextIds = orderedProjectIds.filter((projectId) => projectId !== draggedId)
    const targetIndex = nextIds.indexOf(targetId)
    if (targetIndex < 0) {
      return null
    }

    nextIds.splice(position === 'after' ? targetIndex + 1 : targetIndex, 0, draggedId)
    return nextIds.every((projectId, index) => projectId === orderedProjectIds[index]) ? null : nextIds
  }

  const renderProjectGroups = (
    projectGroups: Array<{ project: Project; items: WorkspaceListItem[] }>,
    {
      allowProjectReorder,
      allowWorkspaceReorder,
    }: {
      allowProjectReorder: boolean
      allowWorkspaceReorder: boolean
    },
  ) => (
    projectGroups.map((group) => {
      const collapsed = collapsedProjectIds[group.project.id] ?? false
      const hasWorkspaces = group.items.length > 0
      const draggedProjectWithinList = draggedProjectItem?.projectId === group.project.id
      const showProjectDropPreview = projectDropTarget?.projectId === group.project.id && draggedProjectItem
      const projectDropPreviewHeight = Math.max(draggedProjectItem?.sectionHeight ?? 0, 64)

      return (
        <div key={group.project.id} className="space-y-1">
          {showProjectDropPreview && projectDropTarget.position === 'before' ? (
            <WorkspaceListDropPreviewSlot
              height={projectDropPreviewHeight}
              label={t('workspace.page.dragPreview.project', { defaultValue: '项目将放到这里' })}
              onDragOver={(event) => {
                if (!allowProjectReorder || !onReorderProjects || !draggedProjectItem) {
                  return
                }

                const nextOrderedProjectIds = reorderProjectIds(
                  projectGroups.map((item) => item.project.id),
                  draggedProjectItem.projectId,
                  group.project.id,
                  'before',
                )
                if (!nextOrderedProjectIds) {
                  setProjectDropTarget(null)
                  return
                }

                event.preventDefault()
                event.dataTransfer.dropEffect = 'move'
              }}
              onDrop={(event) => {
                if (!allowProjectReorder || !onReorderProjects || !draggedProjectItem) {
                  return
                }

                event.preventDefault()
                const droppedProjectId = event.dataTransfer.getData('application/x-vibemux-project') || draggedProjectItem.projectId
                const nextOrderedProjectIds = reorderProjectIds(
                  projectGroups.map((item) => item.project.id),
                  droppedProjectId,
                  group.project.id,
                  'before',
                )
                setDraggedProjectItem(null)
                setProjectDropTarget(null)
                if (!nextOrderedProjectIds) {
                  return
                }

                void Promise.resolve(onReorderProjects(nextOrderedProjectIds))
              }}
            />
          ) : null}
          <div
            className={cn(
              'overflow-hidden rounded-lg transition-[height,opacity,margin] duration-200 ease-out',
              draggedProjectWithinList && 'pointer-events-none',
            )}
            style={draggedProjectWithinList ? { height: 0, opacity: 0 } : undefined}
          >
            <section
              data-workspace-project-section="true"
              className="overflow-hidden rounded-lg"
              onDragOver={(event) => {
                if (!allowProjectReorder || !onReorderProjects || !draggedProjectItem || draggedProjectItem.projectId === group.project.id) {
                  return
                }

                event.preventDefault()
                event.dataTransfer.dropEffect = 'move'
                const nextPosition = resolveWorkspaceListDropPosition(event)
                const nextOrderedProjectIds = reorderProjectIds(
                  projectGroups.map((item) => item.project.id),
                  draggedProjectItem.projectId,
                  group.project.id,
                  nextPosition,
                )
                if (!nextOrderedProjectIds) {
                  if (projectDropTarget?.projectId === group.project.id) {
                    setProjectDropTarget(null)
                  }
                  return
                }

                setProjectDropTarget((current) => {
                  if (
                    current?.projectId === group.project.id
                    && current.position === nextPosition
                  ) {
                    return current
                  }

                  return {
                    projectId: group.project.id,
                    position: nextPosition,
                  }
                })
              }}
              onDrop={(event) => {
                if (!allowProjectReorder || !onReorderProjects || !draggedProjectItem) {
                  return
                }

                event.preventDefault()
                const droppedProjectId = event.dataTransfer.getData('application/x-vibemux-project') || draggedProjectItem.projectId
                const nextPosition = resolveWorkspaceListDropPosition(event)
                const nextOrderedProjectIds = reorderProjectIds(
                  projectGroups.map((item) => item.project.id),
                  droppedProjectId,
                  group.project.id,
                  nextPosition,
                )
                setDraggedProjectItem(null)
                setProjectDropTarget(null)
                if (!nextOrderedProjectIds) {
                  return
                }

                void Promise.resolve(onReorderProjects(nextOrderedProjectIds))
              }}
            >
              <div
                className={cn(
                  'flex w-full items-center justify-between gap-2.5 pl-2.5 pr-1.5 py-1.5',
                  showProjectDropPreview && 'rounded-lg bg-sky-500/[0.03]',
                )}
              >
                <button
                  type="button"
                  draggable={allowProjectReorder && Boolean(onReorderProjects)}
                  onDragStart={(event) => {
                    if (!allowProjectReorder || !onReorderProjects) {
                      return
                    }

                    const projectSection = event.currentTarget.closest<HTMLElement>('[data-workspace-project-section="true"]')
                    event.dataTransfer.effectAllowed = 'move'
                    event.dataTransfer.setData('application/x-vibemux-project', group.project.id)
                    event.dataTransfer.setData('text/plain', group.project.id)
                    requestAnimationFrame(() => {
                      setDraggedProjectItem({
                        projectId: group.project.id,
                        sectionHeight: projectSection?.getBoundingClientRect().height ?? 0,
                      })
                      setProjectDropTarget(null)
                    })
                  }}
                  onDragEnd={() => {
                    setDraggedProjectItem(null)
                    setProjectDropTarget(null)
                  }}
                  onClick={() => {
                    onLoadProject?.(group.project.id)
                    setCollapsedProjectIds((current) => ({
                      ...current,
                      [group.project.id]: !collapsed,
                    }))
                  }}
                  className={cn(
                    'flex min-w-0 items-center gap-1.5 text-left',
                    allowProjectReorder && onReorderProjects && 'cursor-grab active:cursor-grabbing',
                  )}
                >
                  {collapsed ? <ChevronRight className="h-3.5 w-3.5 shrink-0 text-zinc-500" /> : <ChevronDown className="h-3.5 w-3.5 shrink-0 text-zinc-500" />}
                  <ProjectIdentity
                    project={group.project}
                    className="min-w-0 text-zinc-200"
                    dotClassName="h-3.5 w-3.5 rounded-sm"
                    nameClassName="text-[13px] font-medium text-zinc-200"
                  />
                  <ProjectCloneStatusBadge project={group.project} compact />
                </button>
                <div className="flex shrink-0 items-center gap-1">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation()
                      onLoadProject?.(group.project.id)
                      onEditProject(group.project.id)
                    }}
                    className="rounded-md p-1 text-zinc-500 hover:bg-zinc-900 hover:text-zinc-100"
                    aria-label={t('workspace.page.actions.editProject')}
                    title={t('workspace.page.actions.editProject')}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation()
                      onLoadProject?.(group.project.id)
                      onCreateForProject(group.project.id)
                    }}
                    className="rounded-md p-1 text-zinc-500 hover:bg-zinc-900 hover:text-zinc-100"
                    aria-label={t('workspace.page.actions.createForProject')}
                    title={t('workspace.page.actions.createForProject')}
                  >
                    <Plus className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>

              {!collapsed && hasWorkspaces ? (
                <div className="space-y-1 pl-2.5 pr-1.5 pb-1">
                  {group.items.map((item) => (
                    <WorkspaceListCard
                      key={item.workspace.id}
                      item={item}
                      selected={item.workspace.id === selectedWorkspaceId}
                      terminalOpen={resolveWorkspaceListTerminalOpen({
                        localTerminalOpen: Boolean(terminalOpenWorkspaceIds[item.workspace.id]),
                        runtimeTerminal: item.workspace.runtimeSummary?.terminal,
                        selected: item.workspace.id === selectedWorkspaceId,
                      })}
                      // Keep the list badge tied to the terminal-managed start flow so
                      // closing the workspace terminal does not leave a stale "Dev running" chip behind.
                      environmentStartCommandRunning={Boolean(environmentStartCommandRunningWorkspaceIds[item.workspace.id])}
                      environmentStatus={workspaceEnvironmentStatusesByWorkspaceId[item.workspace.id]
                        ?? item.workspace.runtimeSummary?.environment}
                      projectPullRequests={projectPullRequests}
                      githubResourceBindings={githubResourceBindings}
                      railwayDeployments={railwayDeployments}
                      railwayResourceBindings={railwayResourceBindings}
                      onSelect={() => onSelectWorkspace(item.workspace.id)}
                      draggable={allowWorkspaceReorder && Boolean(onReorderWorkspaces)}
                      isDragging={draggedWorkspaceItem?.workspaceId === item.workspace.id}
                      onDragStart={(event) => {
                        if (!allowWorkspaceReorder || !onReorderWorkspaces) {
                          return
                        }

                        event.dataTransfer.effectAllowed = 'move'
                        event.dataTransfer.setData('application/x-vibemux-workspace', item.workspace.id)
                        event.dataTransfer.setData('application/x-vibemux-workspace-project', group.project.id)
                        event.dataTransfer.setData('text/plain', item.workspace.id)
                        applyWorkspaceListRowDragImage(event)
                        requestAnimationFrame(() => {
                          setDraggedWorkspaceItem({
                            projectId: group.project.id,
                            workspaceId: item.workspace.id,
                            rowHeight: event.currentTarget.getBoundingClientRect().height,
                          })
                          setWorkspaceDropTarget(null)
                        })
                      }}
                      onDragEnd={() => {
                        setDraggedWorkspaceItem(null)
                        setWorkspaceDropTarget(null)
                      }}
                      onDragOver={(event) => {
                        if (!allowWorkspaceReorder || !onReorderWorkspaces || !draggedWorkspaceItem) {
                          return
                        }

                        if (draggedWorkspaceItem.projectId !== group.project.id || draggedWorkspaceItem.workspaceId === item.workspace.id) {
                          if (workspaceDropTarget?.workspaceId === item.workspace.id) {
                            setWorkspaceDropTarget(null)
                          }
                          return
                        }

                        const nextPosition = resolveWorkspaceListDropPosition(event)
                        const nextOrderedWorkspaceIds = reorderWorkspaceListIds(
                          group.items.map((workspaceItem) => workspaceItem.workspace.id),
                          draggedWorkspaceItem.workspaceId,
                          item.workspace.id,
                          nextPosition,
                        )
                        if (!nextOrderedWorkspaceIds) {
                          if (workspaceDropTarget?.workspaceId === item.workspace.id) {
                            setWorkspaceDropTarget(null)
                          }
                          return
                        }

                        event.preventDefault()
                        event.dataTransfer.dropEffect = 'move'
                        setWorkspaceDropTarget((current) => {
                          if (
                            current?.projectId === group.project.id
                            && current.workspaceId === item.workspace.id
                            && current.position === nextPosition
                          ) {
                            return current
                          }

                          return {
                            projectId: group.project.id,
                            workspaceId: item.workspace.id,
                            position: nextPosition,
                          }
                        })
                      }}
                      onDrop={(event) => {
                        if (!allowWorkspaceReorder || !onReorderWorkspaces || !draggedWorkspaceItem) {
                          return
                        }

                        event.preventDefault()
                        const droppedWorkspaceId = event.dataTransfer.getData('application/x-vibemux-workspace') || draggedWorkspaceItem.workspaceId
                        const droppedProjectId = event.dataTransfer.getData('application/x-vibemux-workspace-project') || draggedWorkspaceItem.projectId
                        const nextPosition = resolveWorkspaceListDropPosition(event)
                        const nextOrderedWorkspaceIds = reorderWorkspaceListIds(
                          group.items.map((workspaceItem) => workspaceItem.workspace.id),
                          droppedWorkspaceId,
                          item.workspace.id,
                          nextPosition,
                        )
                        setDraggedWorkspaceItem(null)
                        setWorkspaceDropTarget(null)
                        if (droppedProjectId !== group.project.id || !nextOrderedWorkspaceIds) {
                          return
                        }

                        void Promise.resolve(onReorderWorkspaces(group.project.id, nextOrderedWorkspaceIds))
                      }}
                      onSelectWorkspaceSessionTarget={onSelectWorkspaceSessionTarget}
                      onRequestRenameWorkspaceSession={openSessionRenameDialog}
                      draggedWorkspaceItem={draggedWorkspaceItem}
                      workspaceDropTarget={workspaceDropTarget}
                      onDropPreviewDragOver={(event, position) => {
                        if (!allowWorkspaceReorder || !onReorderWorkspaces || !draggedWorkspaceItem) {
                          return
                        }

                        if (draggedWorkspaceItem.projectId !== group.project.id || draggedWorkspaceItem.workspaceId === item.workspace.id) {
                          setWorkspaceDropTarget(null)
                          return
                        }

                        const nextOrderedWorkspaceIds = reorderWorkspaceListIds(
                          group.items.map((workspaceItem) => workspaceItem.workspace.id),
                          draggedWorkspaceItem.workspaceId,
                          item.workspace.id,
                          position,
                        )
                        if (!nextOrderedWorkspaceIds) {
                          setWorkspaceDropTarget(null)
                          return
                        }

                        event.preventDefault()
                        event.dataTransfer.dropEffect = 'move'
                      }}
                      onDropPreviewDrop={(event, position) => {
                        if (!allowWorkspaceReorder || !onReorderWorkspaces || !draggedWorkspaceItem) {
                          return
                        }

                        event.preventDefault()
                        const droppedWorkspaceId = event.dataTransfer.getData('application/x-vibemux-workspace') || draggedWorkspaceItem.workspaceId
                        const droppedProjectId = event.dataTransfer.getData('application/x-vibemux-workspace-project') || draggedWorkspaceItem.projectId
                        const nextOrderedWorkspaceIds = reorderWorkspaceListIds(
                          group.items.map((workspaceItem) => workspaceItem.workspace.id),
                          droppedWorkspaceId,
                          item.workspace.id,
                          position,
                        )
                        setDraggedWorkspaceItem(null)
                        setWorkspaceDropTarget(null)
                        if (droppedProjectId !== group.project.id || !nextOrderedWorkspaceIds) {
                          return
                        }

                        void Promise.resolve(onReorderWorkspaces(group.project.id, nextOrderedWorkspaceIds))
                      }}
                    />
                  ))}
                </div>
              ) : null}
            </section>
          </div>
          {showProjectDropPreview && projectDropTarget.position === 'after' ? (
            <WorkspaceListDropPreviewSlot
              height={projectDropPreviewHeight}
              label={t('workspace.page.dragPreview.project', { defaultValue: '项目将放到这里' })}
              onDragOver={(event) => {
                if (!allowProjectReorder || !onReorderProjects || !draggedProjectItem) {
                  return
                }

                const nextOrderedProjectIds = reorderProjectIds(
                  projectGroups.map((item) => item.project.id),
                  draggedProjectItem.projectId,
                  group.project.id,
                  'after',
                )
                if (!nextOrderedProjectIds) {
                  setProjectDropTarget(null)
                  return
                }

                event.preventDefault()
                event.dataTransfer.dropEffect = 'move'
              }}
              onDrop={(event) => {
                if (!allowProjectReorder || !onReorderProjects || !draggedProjectItem) {
                  return
                }

                event.preventDefault()
                const droppedProjectId = event.dataTransfer.getData('application/x-vibemux-project') || draggedProjectItem.projectId
                const nextOrderedProjectIds = reorderProjectIds(
                  projectGroups.map((item) => item.project.id),
                  droppedProjectId,
                  group.project.id,
                  'after',
                )
                setDraggedProjectItem(null)
                setProjectDropTarget(null)
                if (!nextOrderedProjectIds) {
                  return
                }

                void Promise.resolve(onReorderProjects(nextOrderedProjectIds))
              }}
            />
          ) : null}
        </div>
      )
    })
  )

  const renderWorkspaceRows = (
    items: WorkspaceListItem[],
    {
      allowWorkspaceReorder,
    }: {
      allowWorkspaceReorder: boolean
    },
  ) => (
    items.map((item) => (
      <WorkspaceListCard
        key={item.workspace.id}
        item={item}
        selected={item.workspace.id === selectedWorkspaceId}
        terminalOpen={resolveWorkspaceListTerminalOpen({
          localTerminalOpen: Boolean(terminalOpenWorkspaceIds[item.workspace.id]),
          runtimeTerminal: item.workspace.runtimeSummary?.terminal,
          selected: item.workspace.id === selectedWorkspaceId,
        })}
        environmentStartCommandRunning={Boolean(environmentStartCommandRunningWorkspaceIds[item.workspace.id])}
        environmentStatus={workspaceEnvironmentStatusesByWorkspaceId[item.workspace.id]
          ?? item.workspace.runtimeSummary?.environment}
        projectPullRequests={projectPullRequests}
        githubResourceBindings={githubResourceBindings}
        railwayDeployments={railwayDeployments}
        railwayResourceBindings={railwayResourceBindings}
        onSelect={() => onSelectWorkspace(item.workspace.id)}
        draggable={allowWorkspaceReorder && Boolean(onReorderWorkspaces)}
        isDragging={draggedWorkspaceItem?.workspaceId === item.workspace.id}
        onDragStart={(event) => {
          if (!allowWorkspaceReorder || !onReorderWorkspaces) {
            return
          }

          event.dataTransfer.effectAllowed = 'move'
          event.dataTransfer.setData('application/x-vibemux-workspace', item.workspace.id)
          event.dataTransfer.setData('application/x-vibemux-workspace-project', item.project.id)
          event.dataTransfer.setData('text/plain', item.workspace.id)
          applyWorkspaceListRowDragImage(event)
          requestAnimationFrame(() => {
            setDraggedWorkspaceItem({
              projectId: item.project.id,
              workspaceId: item.workspace.id,
              rowHeight: event.currentTarget.getBoundingClientRect().height,
            })
            setWorkspaceDropTarget(null)
          })
        }}
        onDragEnd={() => {
          setDraggedWorkspaceItem(null)
          setWorkspaceDropTarget(null)
        }}
        onSelectWorkspaceSessionTarget={onSelectWorkspaceSessionTarget}
        onRequestRenameWorkspaceSession={openSessionRenameDialog}
        draggedWorkspaceItem={draggedWorkspaceItem}
        workspaceDropTarget={workspaceDropTarget}
        showProjectName={listViewMode === 'flat'}
      />
    ))
  )

  return (
    <>
    <aside className={cn(
      'flex h-full min-h-0 w-full min-w-0 flex-col overflow-hidden bg-[#060607] text-zinc-100',
      embedded
        ? 'rounded-none border-y border-l border-zinc-900/80 shadow-none'
        : 'border border-zinc-900/80 shadow-[0_18px_80px_rgba(0,0,0,0.35)]',
      !embedded && (connectedRight ? 'rounded-l-xl rounded-r-none border-r-0' : 'rounded-xl'),
    )}>
      <div className={cn(
        'border-b border-zinc-900/80 bg-[#070708] px-3',
        isMobile ? 'py-2' : 'py-2.5',
      )}>
        {!isMobile ? (
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="truncate text-sm font-semibold text-zinc-100">{t('workspace.page.title')}</h2>
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              {onToggleTableOverview ? (
                <Button
                  type="button"
                  onClick={onToggleTableOverview}
                  variant="ghost"
                  size="icon"
                  className={cn(
                    'h-7 w-7 rounded-md border border-zinc-800 bg-zinc-950 transition-colors',
                    showTableOverview
                      ? 'text-sky-400 border-sky-800/60 bg-sky-950/30 hover:bg-sky-950/50'
                      : 'text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100',
                  )}
                  aria-label={t('workspace.page.view.table', { defaultValue: '总览' })}
                  title={t('workspace.page.view.table', { defaultValue: '总览' })}
                >
                  <LayoutGrid className="h-3.5 w-3.5" />
                </Button>
              ) : null}
              <Button
                type="button"
                onClick={onCreate}
                variant="ghost"
                size="icon"
                className={embedded
                  ? 'h-7 w-7 rounded-md border border-zinc-800 bg-zinc-950 text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100'
                  : 'h-6 shrink-0 rounded-md border border-zinc-800 bg-zinc-100 px-2 text-[11px] font-medium text-zinc-950 hover:bg-zinc-200'}
                aria-label={t('workspace.page.actions.new')}
                title={t('workspace.page.actions.new')}
              >
                <Plus className={embedded ? 'h-3.5 w-3.5' : 'mr-1 h-3 w-3'} />
                {!embedded ? t('workspace.page.actions.new') : null}
              </Button>
              {headerActions}
            </div>
          </div>
        ) : null}

        <div className={cn('flex items-center gap-2', !isMobile && 'mt-2.5')}>
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-500" />
            <Input
              value={searchQuery}
              onChange={(event) => onSearchChange(event.target.value)}
              placeholder={t('workspace.page.searchPlaceholder')}
              className="h-8 border-zinc-800 bg-zinc-950 pl-8 text-xs text-zinc-100 placeholder:text-zinc-500 focus-visible:border-zinc-700 focus-visible:ring-zinc-700"
            />
          </div>
          {isMobile ? (
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 shrink-0 rounded-md border border-zinc-800 bg-zinc-950 text-zinc-300 hover:bg-zinc-900 hover:text-zinc-100"
                  aria-label={t('workspace.page.actions.filter', { defaultValue: '筛选工作区' })}
                  title={t('workspace.page.actions.filter', { defaultValue: '筛选工作区' })}
                >
                  <SlidersHorizontal className="h-4 w-4" />
                </Button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-[260px] border-zinc-800 bg-[#09090b] p-2 text-zinc-100 shadow-2xl shadow-black/40">
                <div className="mb-3 px-1">
                  <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-zinc-500">
                    {t('workspace.page.projectDisplay.placeholder', { defaultValue: '项目显示' })}
                  </p>
                  <p className="mt-1 text-xs text-zinc-400">{projectVisibilityLabel}</p>
                </div>
                <div className="mb-2 flex items-center gap-1 px-1">
                  <button
                    type="button"
                    onClick={() => onVisibleProjectIdsChange(toggleSelectAllVisibleProjectIds(projects, visibleProjectIds))}
                    className="inline-flex h-7 items-center rounded-md border border-zinc-800 bg-zinc-950 px-2.5 text-[11px] font-medium text-zinc-300 transition-colors hover:border-zinc-700 hover:bg-zinc-900 hover:text-zinc-100"
                  >
                    {allProjectsSelected
                      ? t('workspace.page.projectDisplay.invert', { defaultValue: '反选' })
                      : t('workspace.page.projectDisplay.selectAll', { defaultValue: '全选' })}
                  </button>
                  <button
                    type="button"
                    onClick={() => onVisibleProjectIdsChange(invertVisibleProjectIds(projects, visibleProjectIds))}
                    className="inline-flex h-7 items-center rounded-md border border-zinc-800 bg-zinc-950 px-2.5 text-[11px] font-medium text-zinc-300 transition-colors hover:border-zinc-700 hover:bg-zinc-900 hover:text-zinc-100"
                  >
                    {t('workspace.page.projectDisplay.invert', { defaultValue: '反选' })}
                  </button>
                </div>
                <div className="space-y-1">
                  {projects.map((project) => {
                    const checked = visibleProjectIdSet.has(project.id)
                    return (
                      <label
                        key={project.id}
                        className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 hover:bg-zinc-900"
                      >
                        <Checkbox
                          checked={checked}
                          onCheckedChange={(value) => {
                            toggleProjectVisibility(project.id, value === true)
                          }}
                          checkStrokeWidth={3.25}
                          className="h-5 w-5 rounded-[5px] border-zinc-700 data-[state=checked]:border-zinc-100 data-[state=checked]:bg-zinc-100 data-[state=checked]:text-zinc-950"
                          checkClassName="h-4.5 w-4.5"
                        />
                        <ProjectIdentity
                          project={project}
                          className="min-w-0 flex-1"
                          dotClassName="h-3.5 w-3.5 rounded-sm"
                          nameClassName="truncate text-xs text-zinc-200"
                        />
                      </label>
                    )
                  })}
                </div>
                <div className="mt-3 border-t border-zinc-800 pt-3">
                  <p className="px-1 text-[11px] font-medium uppercase tracking-[0.18em] text-zinc-500">
                    {t('workspace.page.view.label', { defaultValue: '列表方式' })}
                  </p>
                  <div className="mt-2 flex h-8 items-center gap-1 rounded-lg border border-zinc-800 bg-zinc-950 p-1">
                    <button
                      type="button"
                      onClick={() => setListViewMode('grouped')}
                      className={cn(
                        'flex-1 rounded-md px-2 py-1 text-[11px] font-medium transition-colors',
                        listViewMode === 'grouped'
                          ? 'bg-zinc-100 text-zinc-950'
                          : 'text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100',
                      )}
                    >
                      {t('workspace.page.view.grouped', { defaultValue: '按项目' })}
                    </button>
                    <button
                      type="button"
                      onClick={() => setListViewMode('flat')}
                      className={cn(
                        'flex-1 rounded-md px-2 py-1 text-[11px] font-medium transition-colors',
                        listViewMode === 'flat'
                          ? 'bg-zinc-100 text-zinc-950'
                          : 'text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100',
                      )}
                    >
                      {t('workspace.page.view.flat', { defaultValue: '顺序列表' })}
                    </button>
                  </div>
                </div>
              </PopoverContent>
            </Popover>
          ) : null}
          {isMobile ? (
            <Button
              type="button"
              onClick={onCreate}
              variant="ghost"
              size="icon"
              className="h-8 w-8 shrink-0 rounded-md border border-zinc-800 bg-zinc-950 text-zinc-300 hover:bg-zinc-900 hover:text-zinc-100"
              aria-label={t('workspace.page.actions.new')}
              title={t('workspace.page.actions.new')}
            >
              <Plus className="h-4 w-4" />
            </Button>
          ) : null}
          {!isMobile ? headerActions : null}
        </div>
        {!isMobile ? (
          <Popover>
            <PopoverTrigger asChild>
              <button
                type="button"
                className="mt-2 flex h-8 w-full items-center justify-between rounded-lg border border-zinc-800 bg-zinc-950 px-2.5 text-xs text-zinc-100 transition-colors hover:border-zinc-700"
              >
                <span className="truncate">
                  {t('workspace.page.projectDisplay.placeholder', { defaultValue: '项目显示' })}: {projectVisibilityLabel}
                </span>
                <ChevronDown className="ml-2 h-3.5 w-3.5 shrink-0 text-zinc-500" />
              </button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-[260px] border-zinc-800 bg-[#09090b] p-2 text-zinc-100 shadow-2xl shadow-black/40">
              <div className="mb-2 flex items-center gap-1 px-1">
                <button
                  type="button"
                  onClick={() => onVisibleProjectIdsChange(toggleSelectAllVisibleProjectIds(projects, visibleProjectIds))}
                  className="inline-flex h-7 items-center rounded-md border border-zinc-800 bg-zinc-950 px-2.5 text-[11px] font-medium text-zinc-300 transition-colors hover:border-zinc-700 hover:bg-zinc-900 hover:text-zinc-100"
                >
                  {allProjectsSelected
                    ? t('workspace.page.projectDisplay.invert', { defaultValue: '反选' })
                    : t('workspace.page.projectDisplay.selectAll', { defaultValue: '全选' })}
                </button>
                <button
                  type="button"
                  onClick={() => onVisibleProjectIdsChange(invertVisibleProjectIds(projects, visibleProjectIds))}
                  className="inline-flex h-7 items-center rounded-md border border-zinc-800 bg-zinc-950 px-2.5 text-[11px] font-medium text-zinc-300 transition-colors hover:border-zinc-700 hover:bg-zinc-900 hover:text-zinc-100"
                >
                  {t('workspace.page.projectDisplay.invert', { defaultValue: '反选' })}
                </button>
              </div>
              <div className="space-y-1">
                {projects.map((project) => {
                  const checked = visibleProjectIdSet.has(project.id)
                  return (
                    <label
                      key={project.id}
                      className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 hover:bg-zinc-900"
                    >
                      <Checkbox
                        checked={checked}
                        onCheckedChange={(value) => {
                          toggleProjectVisibility(project.id, value === true)
                        }}
                        checkStrokeWidth={3.25}
                        className="h-5 w-5 rounded-[5px] border-zinc-700 data-[state=checked]:border-zinc-100 data-[state=checked]:bg-zinc-100 data-[state=checked]:text-zinc-950"
                        checkClassName="h-4.5 w-4.5"
                      />
                      <ProjectIdentity
                        project={project}
                        className="min-w-0 flex-1"
                        dotClassName="h-3.5 w-3.5 rounded-sm"
                        nameClassName="truncate text-xs text-zinc-200"
                      />
                    </label>
                  )
                })}
              </div>
            </PopoverContent>
          </Popover>
        ) : null}
        {!isMobile ? (
          <div className="mt-2 flex h-8 items-center gap-1 rounded-lg border border-zinc-800 bg-zinc-950 p-1">
            <button
              type="button"
              onClick={() => setListViewMode('grouped')}
              className={cn(
                'flex-1 rounded-md px-2 py-1 text-[11px] font-medium transition-colors',
                listViewMode === 'grouped'
                  ? 'bg-zinc-100 text-zinc-950'
                  : 'text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100',
              )}
            >
              {t('workspace.page.view.grouped', { defaultValue: '按项目' })}
            </button>
            <button
              type="button"
              onClick={() => setListViewMode('flat')}
              className={cn(
                'flex-1 rounded-md px-2 py-1 text-[11px] font-medium transition-colors',
                listViewMode === 'flat'
                  ? 'bg-zinc-100 text-zinc-950'
                  : 'text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100',
              )}
            >
              {t('workspace.page.view.flat', { defaultValue: '顺序列表' })}
            </button>
          </div>
        ) : null}
      </div>

      <div className="scrollbar-subtle min-h-0 w-full flex-1 overflow-y-auto overscroll-contain pr-1">
        {showTableOverview ? (
          <WorkspacesTablePanel
            items={activeFilteredItems}
            executors={[]}
            projectPullRequests={projectPullRequests}
            githubResourceBindings={githubResourceBindings}
            railwayDeployments={railwayDeployments}
            railwayResourceBindings={railwayResourceBindings}
            selectedWorkspaceId={selectedWorkspaceId}
            onSelectWorkspace={onSelectWorkspace}
          />
        ) : (
        <div className="mobile-bottom-nav-safe min-w-0 max-w-full space-y-1.5 py-1.5">
          {listViewMode === 'grouped' ? (
            activeProjectGroups.length > 0 ? (
              renderProjectGroups(activeProjectGroups, {
                allowProjectReorder: true,
                allowWorkspaceReorder: false,
              })
            ) : !hasArchivedSection ? (
              <div className="rounded-2xl border border-dashed border-zinc-800 bg-zinc-950/70 px-4 py-8 text-center">
                <Workflow className="mx-auto h-8 w-8 text-zinc-600" />
                <p className="mt-2 text-sm font-medium text-zinc-300">{t('workspace.page.empty.noMatched')}</p>
                <p className="mt-1 text-xs text-zinc-500">{t('workspace.page.empty.adjustFilters')}</p>
              </div>
            ) : null
          ) : activeFlatItems.length > 0 ? (
            <div className="space-y-1 px-2.5">
              {renderWorkspaceRows(activeFlatItems, {
                allowWorkspaceReorder: false,
              })}
            </div>
          ) : !hasArchivedSection ? (
            <div className="rounded-2xl border border-dashed border-zinc-800 bg-zinc-950/70 px-4 py-8 text-center">
              <Workflow className="mx-auto h-8 w-8 text-zinc-600" />
              <p className="mt-2 text-sm font-medium text-zinc-300">{t('workspace.page.empty.noMatched')}</p>
              <p className="mt-1 text-xs text-zinc-500">{t('workspace.page.empty.adjustFilters')}</p>
            </div>
          ) : null}

          {hasArchivedSection ? (
            <section className="mt-3 border-t border-zinc-900/80 pl-2.5 pr-1.5 pb-2 pt-3">
              <button
                type="button"
                onClick={() => setArchivedSectionCollapsed((current) => !current)}
                className="flex w-full items-center justify-between rounded-lg px-1 py-1.5 text-left hover:bg-zinc-950/70"
              >
                <span className="flex min-w-0 items-center gap-2 text-sm font-medium text-zinc-300">
                  {archivedSectionCollapsed ? <ChevronRight className="h-3.5 w-3.5 shrink-0 text-zinc-500" /> : <ChevronDown className="h-3.5 w-3.5 shrink-0 text-zinc-500" />}
                  <Archive className="h-3.5 w-3.5 shrink-0 text-zinc-500" />
                  <span>已归档工作区</span>
                </span>
                <span className="rounded-md border border-zinc-800 bg-zinc-950 px-1.5 py-0.5 text-[10px] text-zinc-500">
                  {archivedFilteredItems.length || archivedWorkspaceCount}
                </span>
              </button>

              {!archivedSectionCollapsed ? (
                <div className="mt-1 space-y-1.5">
                  {listViewMode === 'grouped' ? renderProjectGroups(archivedProjectGroups, {
                    allowProjectReorder: false,
                    allowWorkspaceReorder: false,
                  }) : (
                    <div className="space-y-1">
                      {renderWorkspaceRows(archivedFlatItems, {
                        allowWorkspaceReorder: false,
                      })}
                    </div>
                  )}
                </div>
              ) : null}
            </section>
          ) : null}
        </div>
        )}
      </div>
    </aside>
      <Dialog
        open={Boolean(sessionRenameTarget)}
        onOpenChange={(open) => {
          if (!open && !sessionRenameBusy) {
            setSessionRenameTarget(null)
            setSessionRenameDraft('')
          }
        }}
      >
        <DialogContent className="border-zinc-800 bg-[#09090b] text-zinc-100 shadow-2xl shadow-black/40 sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t('workspace.shell.renameSessionTitle')}</DialogTitle>
          </DialogHeader>
          <DialogBody>
          <Input
            value={sessionRenameDraft}
            onChange={(event) => setSessionRenameDraft(event.target.value)}
            onKeyDown={(event) => {
              if (isImeComposingKeyboardEvent(event)) {
                return
              }

              if (event.key === 'Enter') {
                event.preventDefault()
                void handleRenameWorkspaceSession()
              }
            }}
            maxLength={80}
            autoFocus
            className="h-10 rounded-lg border-zinc-800 bg-zinc-950 text-sm text-zinc-100"
          />
          </DialogBody>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setSessionRenameTarget(null)}
              disabled={sessionRenameBusy}
              className="border-zinc-800 bg-zinc-950 text-zinc-300 hover:bg-zinc-900 hover:text-zinc-100"
            >
              {t('common.cancel')}
            </Button>
            <Button
              type="button"
              onClick={() => void handleRenameWorkspaceSession()}
              disabled={!sessionRenameDraft.trim() || sessionRenameBusy || !onRenameWorkspaceSession}
              className="bg-zinc-100 text-zinc-950 hover:bg-zinc-200"
            >
              {sessionRenameBusy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              {t('common.save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

export const WorkspacesListPanel = memo(WorkspacesListPanelInner)

export const resolveWorkspaceEnvironmentBadge = (params: {
  environmentStartCommandRunning: boolean
  environmentStatus?: WorkspaceEnvironmentStatusSnapshot
}) => {
  if (!params.environmentStartCommandRunning) {
    return null
  }

  const status = params.environmentStatus?.status
  if (status === 'running') {
    return {
      labelKey: 'workspace.page.environmentRunning',
      defaultValue: 'Dev 运行中',
      toneClassName: 'bg-emerald-500/10 text-emerald-300',
      icon: 'play' as const,
    }
  }

  if (status === 'starting' || status === 'checking') {
    return {
      labelKey: 'workspace.page.environmentStarting',
      defaultValue: 'Dev 启动中',
      toneClassName: 'bg-sky-500/10 text-sky-300',
      icon: 'loading' as const,
    }
  }

  if (status === 'stopping') {
    return {
      labelKey: 'workspace.page.environmentStopping',
      defaultValue: 'Dev 停止中',
      toneClassName: 'bg-amber-500/10 text-amber-300',
      icon: 'loading' as const,
    }
  }

  return {
    labelKey: 'workspace.page.environmentStarted',
    defaultValue: 'Dev 已启动',
    toneClassName: 'bg-emerald-500/10 text-emerald-300',
    icon: 'play' as const,
  }
}

const getAvatarInitials = (name?: string) => {
  const normalizedName = name?.trim()
  if (!normalizedName) {
    return '?'
  }

  return Array.from(normalizedName).slice(0, 2).join('').toUpperCase()
}

const getWorkspacePresenceLabel = (
  user: NonNullable<WorkspaceListItem['activePresenceUsers']>[number],
  language: string,
) => {
  const stateLabel = user.state === 'working'
    ? text(language, '正在工作', 'Working')
    : text(language, '正在查看', 'Viewing')
  return `${user.name} · ${stateLabel}`
}

function WorkspaceUserAvatar({
  userId,
  kind = 'user',
  avatarUrl,
  label,
  name,
  sizeClassName = 'h-5 w-5',
  statusClassName,
}: {
  userId?: string
  kind?: 'user' | 'agent'
  avatarUrl?: string
  label: string
  name: string
  sizeClassName?: string
  statusClassName?: string
}) {
  return (
    <span className="relative inline-flex shrink-0" title={label} aria-label={label}>
      <IdentityCardWrapper kind={kind} id={userId} name={name} avatarUrl={avatarUrl} triggerMode="hover">
        <Avatar className={cn(sizeClassName, 'border border-zinc-800 bg-zinc-900 text-[9px] text-zinc-300')}>
          {avatarUrl ? <AvatarImage src={resolveMediaUrl(avatarUrl)} className="object-cover" /> : null}
          <AvatarFallback className="bg-zinc-900 text-[9px] font-medium text-zinc-300">
            {getAvatarInitials(name)}
          </AvatarFallback>
        </Avatar>
      </IdentityCardWrapper>
      {statusClassName ? (
        <span className={cn('absolute -bottom-0.5 -right-0.5 h-2 w-2 rounded-full border border-zinc-950', statusClassName)} />
      ) : null}
    </span>
  )
}

function WorkspaceCardPeople({
  item,
  language,
}: {
  item: WorkspaceListItem
  language: string
}) {
  const activePresenceUsers = item.activePresenceUsers ?? []
  const visiblePresenceUsers = activePresenceUsers.slice(0, 3)
  const hiddenPresenceUserCount = Math.max(0, activePresenceUsers.length - visiblePresenceUsers.length)
  const creatorLabel = item.creatorProfile
    ? text(language, `创建者：${item.creatorProfile.name}`, `Created by ${item.creatorProfile.name}`)
    : ''

  if (!item.creatorProfile && visiblePresenceUsers.length === 0) {
    return null
  }

  return (
    <div className="flex shrink-0 items-center gap-1 pl-1">
      {visiblePresenceUsers.length > 0 ? (
        <span className="flex items-center -space-x-1">
          {visiblePresenceUsers.map((user) => (
            <WorkspaceUserAvatar
              key={user.userId}
              userId={user.userId}
              avatarUrl={user.avatarUrl}
              label={getWorkspacePresenceLabel(user, language)}
              name={user.name}
              sizeClassName="h-5 w-5"
              statusClassName={user.state === 'working' ? 'bg-amber-400' : 'bg-emerald-400'}
            />
          ))}
          {hiddenPresenceUserCount > 0 ? (
            <span
              className="inline-flex h-5 min-w-5 items-center justify-center rounded-full border border-zinc-800 bg-zinc-900 px-1 text-[9px] font-medium text-zinc-400"
              title={text(language, `还有 ${hiddenPresenceUserCount} 人在此工作区`, `${hiddenPresenceUserCount} more in this workspace`)}
            >
              +{hiddenPresenceUserCount}
            </span>
          ) : null}
        </span>
      ) : null}
      {item.creatorProfile ? (
        <span className={cn(visiblePresenceUsers.length > 0 && 'ml-0.5 border-l border-zinc-800 pl-1.5')}>
          <WorkspaceUserAvatar
            userId={item.creatorProfile.id}
            kind={item.creatorProfile.type ?? 'user'}
            avatarUrl={item.creatorProfile.avatarUrl}
            label={creatorLabel}
            name={item.creatorProfile.name}
            sizeClassName="h-5 w-5"
          />
        </span>
      ) : null}
    </div>
  )
}

const resolveWorkspacePreviewBadgeLabel = (note: string | undefined, port: number | undefined) => {
  const previewLabel = note?.trim() || 'Preview'
  return port ? `${previewLabel}:${port}` : previewLabel
}

type WorkspaceListConfiguredPreviewPort = ResolvedListPreviewAddress & {
  port: number
}

export const resolveWorkspaceListPreviewPorts = (previewAddresses: ResolvedListPreviewAddress[]) => (
  previewAddresses.filter((previewAddress): previewAddress is WorkspaceListConfiguredPreviewPort => (
    typeof previewAddress.port === 'number'
    && Number.isFinite(previewAddress.port)
  ))
)

const resolvePreviewSourceViewerUrl = (params: {
  preview: Awaited<ReturnType<typeof api.resolveWorkspacePreviewSource>>
}) => params.preview.sourceViewerUrl

function WorkspaceListCardInner({
  item,
  selected = false,
  terminalOpen = false,
  environmentStartCommandRunning = false,
  environmentStatus,
  projectPullRequests = [],
  githubResourceBindings = [],
  railwayDeployments = [],
  railwayResourceBindings = [],
  onSelect,
  draggable = false,
  isDragging = false,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDrop,
  onSelectWorkspaceSessionTarget,
  onRequestRenameWorkspaceSession,
  draggedWorkspaceItem,
  workspaceDropTarget,
  showProjectName = false,
  onDropPreviewDragOver,
  onDropPreviewDrop,
}: {
  item: WorkspaceListItem
  selected?: boolean
  terminalOpen?: boolean
  environmentStartCommandRunning?: boolean
  environmentStatus?: WorkspaceEnvironmentStatusSnapshot
  projectPullRequests?: ProjectPullRequestReviewSummary[]
  githubResourceBindings?: GitHubResourceBinding[]
  railwayDeployments?: RailwayDeploymentSummary[]
  railwayResourceBindings?: RailwayResourceBinding[]
  onSelect: () => void
  draggable?: boolean
  isDragging?: boolean
  onDragStart?: (event: DragEvent<HTMLButtonElement>) => void
  onDragEnd?: () => void
  onDragOver?: (event: DragEvent<HTMLButtonElement>) => void
  onDrop?: (event: DragEvent<HTMLButtonElement>) => void
  onSelectWorkspaceSessionTarget?: (target: {
    workspaceId: string
    workspaceSessionId: string
    taskId?: string
  }) => void
  onRequestRenameWorkspaceSession?: (session: {
    id: string
    title: string
    workspaceId: string
    taskId?: string
  }) => void
  draggedWorkspaceItem?: {
    projectId: string
    workspaceId: string
    rowHeight: number
  } | null
  workspaceDropTarget?: {
    projectId: string
    workspaceId: string
    position: WorkspaceListDropPosition
  } | null
  showProjectName?: boolean
  onDropPreviewDragOver?: DropPreviewDragHandler
  onDropPreviewDrop?: DropPreviewDragHandler
}) {
  const { language, t } = useTranslation()
  const environmentBadge = resolveWorkspaceEnvironmentBadge({
    environmentStartCommandRunning,
    environmentStatus,
  })
  const executorStatusIconClassName = item.currentExecutorStatusTone === 'online'
    ? 'text-emerald-500/75'
    : item.currentExecutorStatusTone === 'busy'
      ? 'text-amber-400/85'
      : item.currentExecutorStatusTone === 'offline'
        ? 'text-zinc-600'
        : 'text-zinc-500'
  const pullRequestDisplay = useMemo(() => resolveWorkspaceIndexedPullRequestDisplay({
    pullRequests: projectPullRequests,
    bindings: githubResourceBindings,
    projectId: item.project.id,
    workspaceId: item.workspace.id,
    workspaceSessionIds: item.sessionPreviews.map((session) => session.id),
    compareBranch: item.worktreeBranchName,
  }), [projectPullRequests, githubResourceBindings, item.project.id, item.workspace.id, item.sessionPreviews, item.worktreeBranchName])
  const railwayDeploymentDisplay = useMemo(() => resolveWorkspaceIndexedRailwayDeploymentDisplay({
    deployments: railwayDeployments,
    bindings: railwayResourceBindings,
    projectId: item.project.id,
    workspaceId: item.workspace.id,
    workspaceSessionIds: item.sessionPreviews.map((session) => session.id),
    compareBranch: item.worktreeBranchName,
  }), [railwayDeployments, railwayResourceBindings, item.project.id, item.workspace.id, item.sessionPreviews, item.worktreeBranchName])
  const previewAddresses = useMemo(() => {
    const summary = item.previewSummary
    if (!summary?.sources.length) {
      return []
    }

    return summary.sources.map((source) => resolveListPreviewAddress({
      source,
      remoteTransport: summary.remoteTransport,
    }))
  }, [item.previewSummary])
  const previewPorts = useMemo(() => resolveWorkspaceListPreviewPorts(previewAddresses), [previewAddresses])
  const displayStatus = resolveWorkspaceListItemDisplayStatus(item)
  const displayStatusMeta = WORKSPACE_LIST_STATUS_META[displayStatus]
  const hasActionMeta = terminalOpen
    || Boolean(environmentBadge)
    || displayStatus !== 'idle'
    || item.runningCount > 0
    || item.unreadCount > 0
    || item.errorCount > 0
    || Boolean(pullRequestDisplay)
    || Boolean(railwayDeploymentDisplay)
    || previewPorts.length > 0
  const [sessionPreviewsExpanded, setSessionPreviewsExpanded] = useState(false)
  const [openingPreviewSourcePort, setOpeningPreviewSourcePort] = useState<number | null>(null)
  const handleOpenPreviewSource = async (previewSourcePort: number | undefined) => {
    if (!previewSourcePort) {
      toast.error(t('workspace.preview.openFailed', { defaultValue: '当前预览端口无效。' }))
      return
    }

    const popup = window.open('about:blank', '_blank')
    if (!popup) {
      toast.error(t('workspace.preview.popupBlocked', { defaultValue: '浏览器阻止了预览窗口，请允许弹窗后重试。' }))
      return
    }

    try {
      popup.opener = null
    } catch {
      // Some browsers expose a restricted WindowProxy here; navigation still works.
    }

    try {
      popup.document.title = 'Opening preview...'
      popup.document.body.innerHTML = '<div style="font-family: ui-sans-serif, system-ui, sans-serif; padding: 24px; color: #e4e4e7; background: #09090b;">Opening preview...</div>'
    } catch {
      // Ignore blank-document write failures and continue with navigation.
    }

    setOpeningPreviewSourcePort(previewSourcePort)
    try {
      const previewResponse = await api.resolveWorkspacePreviewSource(item.workspace.id, previewSourcePort)
      popup.location.href = resolvePreviewSourceViewerUrl({ preview: previewResponse })
    } catch (error) {
      popup.close()
      toast.error(error instanceof Error ? error.message : t('workspace.preview.openFailed', { defaultValue: '打开预览失败。' }))
    } finally {
      setOpeningPreviewSourcePort((current) => current === previewSourcePort ? null : current)
    }
  }
  const collapsedSessionPreviews = item.sessionPreviews.slice(0, COLLAPSED_WORKSPACE_SESSION_PREVIEW_COUNT)
  const displayedSessionPreviews = sessionPreviewsExpanded ? item.sessionPreviews : collapsedSessionPreviews
  const hiddenSessionPreviewCount = Math.max(0, item.sessionPreviews.length - collapsedSessionPreviews.length)
  const canToggleSessionPreviews = hiddenSessionPreviewCount > 0
  const showDropPreview = workspaceDropTarget?.workspaceId === item.workspace.id && draggedWorkspaceItem
  const dropPreviewHeight = Math.max(draggedWorkspaceItem?.rowHeight ?? 0, 74)

  useEffect(() => {
    if (!canToggleSessionPreviews && sessionPreviewsExpanded) {
      setSessionPreviewsExpanded(false)
    }
  }, [canToggleSessionPreviews, sessionPreviewsExpanded])

  const handleClick = (event: MouseEvent<HTMLButtonElement>) => {
    const prTarget = event.target instanceof Node
      ? (event.target instanceof Element ? event.target : event.target.parentElement)?.closest('[data-task-pull-request-url]')
      : null
    const pullRequestUrl = prTarget?.getAttribute('data-task-pull-request-url')?.trim()
    if (pullRequestUrl) {
      window.open(pullRequestUrl, '_blank', 'noopener,noreferrer')
      return
    }

    const sessionPreviewToggleTarget = event.target instanceof Node
      ? (event.target instanceof Element ? event.target : event.target.parentElement)?.closest('[data-workspace-session-preview-toggle]')
      : null
    if (sessionPreviewToggleTarget) {
      setSessionPreviewsExpanded((current) => !current)
      return
    }

    const actionTarget = event.target instanceof Node
      ? (event.target instanceof Element ? event.target : event.target.parentElement)?.closest('[data-workspace-session-target]')
      : null
    const actionType = actionTarget?.getAttribute('data-workspace-session-target')

    if (actionType && onSelectWorkspaceSessionTarget) {
      if (actionType === 'running' && item.runningTargetWorkspaceSessionId) {
        onSelectWorkspaceSessionTarget({
          workspaceId: item.workspace.id,
          workspaceSessionId: item.runningTargetWorkspaceSessionId,
          taskId: item.runningTargetTaskId,
        })
        return
      }

      if (actionType === 'unread' && item.unreadTargetWorkspaceSessionId) {
        onSelectWorkspaceSessionTarget({
          workspaceId: item.workspace.id,
          workspaceSessionId: item.unreadTargetWorkspaceSessionId,
          taskId: item.unreadTargetTaskId,
        })
        return
      }

      if (actionType === 'error' && item.errorTargetWorkspaceSessionId) {
        onSelectWorkspaceSessionTarget({
          workspaceId: item.workspace.id,
          workspaceSessionId: item.errorTargetWorkspaceSessionId,
          taskId: item.errorTargetTaskId,
        })
        return
      }
    }

    const sessionTarget = event.target instanceof Node
      ? (event.target instanceof Element ? event.target : event.target.parentElement)?.closest('[data-workspace-session-id]')
      : null
    const workspaceSessionId = sessionTarget?.getAttribute('data-workspace-session-id')?.trim()
    if (workspaceSessionId && onSelectWorkspaceSessionTarget) {
      const sessionPreview = item.sessionPreviews.find((session) => session.id === workspaceSessionId)
      onSelectWorkspaceSessionTarget({
        workspaceId: item.workspace.id,
        workspaceSessionId,
        taskId: sessionPreview?.taskId || item.activeTask?.id,
      })
      return
    }

    const defaultSessionTarget = resolveWorkspaceListItemDefaultSessionTarget(item)
    if (defaultSessionTarget && onSelectWorkspaceSessionTarget) {
      onSelectWorkspaceSessionTarget(defaultSessionTarget)
      return
    }

    onSelect()
  }

  return (
    <div className="space-y-1">
      {showDropPreview && workspaceDropTarget.position === 'before' ? (
        <WorkspaceListDropPreviewSlot
          height={dropPreviewHeight}
          label={t('workspace.page.dragPreview.workspace', { defaultValue: '工作区将放到这里' })}
          onDragOver={(event) => {
            onDropPreviewDragOver?.(event, 'before')
          }}
          onDrop={(event) => {
            onDropPreviewDrop?.(event, 'before')
          }}
        />
      ) : null}
      <div
        className={cn(
          'transition-[height,opacity,margin] duration-200 ease-out',
          isDragging && 'pointer-events-none',
        )}
        style={isDragging ? { height: 0, opacity: 0 } : undefined}
      >
        <button
          type="button"
          data-workspace-list-row="true"
          draggable={draggable}
          onDragStart={onDragStart}
          onDragEnd={onDragEnd}
          onDragOver={onDragOver}
          onDrop={onDrop}
          onClick={handleClick}
          className={cn(
            'relative block w-full min-w-0 max-w-full overflow-hidden rounded-lg border px-2.5 py-2 text-left transition-all duration-200 ease-out',
            draggable && 'cursor-grab active:cursor-grabbing',
            selected
              ? 'border-zinc-500 bg-zinc-800/90 shadow-[inset_0_1px_0_rgba(255,255,255,0.08),0_0_8px_rgba(255,255,255,0.05)] ring-1 ring-zinc-600/50'
              : 'border-zinc-800 bg-transparent hover:border-zinc-700 hover:bg-zinc-950/70',
          )}
        >
          <div className="flex min-w-0 items-start gap-2">
            <div className="min-w-0 flex-1 overflow-hidden">
              <div className="flex min-w-0 items-start justify-between gap-2">
                <p className="line-clamp-2 min-w-0 flex-1 break-all text-[13px] font-medium text-zinc-100">{item.workspace.name}</p>
                <WorkspaceCardPeople item={item} language={language} />
              </div>
              {showProjectName ? (
                <ProjectIdentity
                  project={item.project}
                  className="mt-1"
                  dotClassName="mt-0.5 h-3 w-3 rounded-[3px]"
                  nameClassName="text-[11px] text-zinc-500"
                />
              ) : null}
              <p className="mt-1 flex min-h-[16px] min-w-0 items-center gap-1.5 text-[11px] text-zinc-500">
                {item.currentExecutorDisplayName ? (
                  <>
                    <Radio className={cn('h-2.5 w-2.5 shrink-0', executorStatusIconClassName)} />
                    <span className="truncate min-w-0">{item.currentExecutorDisplayName}</span>
                  </>
                ) : (
                  <>
                    <Radio className="h-2.5 w-2.5 shrink-0 opacity-0" aria-hidden="true" />
                    <span className="truncate min-w-0 opacity-0" aria-hidden="true">executor</span>
                  </>
                )}
              </p>
              <p className="mt-1 flex min-w-0 items-center gap-1.5 text-[11px] text-zinc-500">
                <FolderGit2 className="h-2.5 w-2.5 shrink-0" />
                <span className="truncate min-w-0">
                  {text(language, '工作目录：', 'Worktree: ')}
                  {item.worktreeLabel}
                </span>
              </p>
            </div>
          </div>

          {item.sessionPreviews.length > 0 ? (
            <div className="mt-2 flex flex-col gap-1 border-t border-zinc-900/80 pt-1.5">
              {displayedSessionPreviews.map((session) => (
                <span
                  key={session.id}
                  data-workspace-session-id={session.id}
                  role="button"
                  tabIndex={-1}
                  onDoubleClick={(event) => {
                    event.stopPropagation()
                    onRequestRenameWorkspaceSession?.({
                      id: session.id,
                      title: session.title,
                      workspaceId: item.workspace.id,
                      taskId: session.taskId || item.activeTask?.id,
                    })
                  }}
                  className={cn(
                    'group/session flex min-w-0 items-center gap-1.5 rounded-md px-1.5 py-1 text-[11px] transition-colors',
                    session.tone === 'selected'
                      ? 'bg-zinc-900 text-zinc-100'
                      : 'text-zinc-500 hover:bg-zinc-900/70 hover:text-zinc-200',
                  )}
                >
                  <span className={cn(
                    'h-1.5 w-1.5 shrink-0 rounded-full',
                    session.tone === 'selected'
                      ? 'bg-zinc-100'
                      : session.tone === 'running'
                        ? 'bg-sky-400'
                        : session.tone === 'queued'
                          ? 'bg-amber-400'
                          : session.tone === 'error'
                            ? 'bg-orange-400'
                            : session.tone === 'unread'
                              ? 'bg-cyan-400'
                              : 'bg-zinc-600 group-hover/session:bg-zinc-400',
                  )} />
                  <span className="min-w-0 flex-1 truncate">{session.title}</span>
                  {session.badgeLabel ? (
                    <span className={cn(
                      'shrink-0 rounded-full border px-1.5 py-0 text-[9px] leading-4',
                      session.tone === 'running'
                        ? 'border-sky-500/20 bg-sky-500/10 text-sky-300'
                        : session.tone === 'queued'
                          ? 'border-amber-500/20 bg-amber-500/10 text-amber-300'
                          : session.tone === 'error'
                            ? 'border-orange-500/20 bg-orange-500/10 text-orange-300'
                            : 'border-cyan-500/20 bg-cyan-500/10 text-cyan-300',
                    )}>
                      {session.badgeLabel}
                    </span>
                  ) : null}
                </span>
              ))}
              {canToggleSessionPreviews ? (
                <span
                  data-workspace-session-preview-toggle="true"
                  role="button"
                  tabIndex={-1}
                  aria-expanded={sessionPreviewsExpanded}
                  className="inline-flex w-fit items-center gap-1 rounded-md px-1.5 py-1 text-[10px] text-zinc-600 transition-colors hover:bg-zinc-900/70 hover:text-zinc-300"
                >
                  {sessionPreviewsExpanded ? (
                    <ChevronDown className="h-2.5 w-2.5 shrink-0" />
                  ) : (
                    <ChevronRight className="h-2.5 w-2.5 shrink-0" />
                  )}
                  <span>
                    {sessionPreviewsExpanded
                      ? t('workspace.shell.collapseSessions', { defaultValue: '收起会话' })
                      : t('workspace.shell.moreSessions', {
                        defaultValue: '还有 {{count}} 个会话',
                        count: hiddenSessionPreviewCount,
                      })}
                  </span>
                </span>
              ) : null}
            </div>
          ) : null}

          <div
            className={cn(
              'flex flex-wrap items-center gap-1.5',
              hasActionMeta ? 'mt-1.5 min-h-[20px]' : 'mt-0 min-h-0',
            )}
            aria-hidden={!hasActionMeta}
          >
            {terminalOpen ? (
              <span className="inline-flex items-center gap-1 rounded-md bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-medium text-emerald-300">
                <TerminalSquare className="h-2.5 w-2.5" />
                {t('workspace.page.terminalOpen', { defaultValue: '终端开启' })}
              </span>
            ) : null}
            {environmentBadge ? (
              <span className={cn('inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-medium', environmentBadge.toneClassName)}>
                {environmentBadge.icon === 'loading'
                  ? <Loader2 className="h-2.5 w-2.5 animate-spin" />
                  : <Play className="h-2.5 w-2.5" />}
                {t(environmentBadge.labelKey, { defaultValue: environmentBadge.defaultValue })}
              </span>
            ) : null}
            {previewPorts.map((previewAddress) => {
              const previewLabel = resolveWorkspacePreviewBadgeLabel(previewAddress.note, previewAddress.port)
              const previewOpening = openingPreviewSourcePort === previewAddress.port
              return (
                <span
                  key={previewAddress.url}
                  role="button"
                  tabIndex={0}
                  title={`${text(language, '配置的 preview 入口', 'Configured preview source')} · ${previewAddress.transportLabel} · ${previewAddress.url}`}
                  onClick={(event) => {
                    if (previewOpening) {
                      return
                    }
                    event.stopPropagation()
                    void handleOpenPreviewSource(previewAddress.port)
                  }}
                  onKeyDown={(event) => {
                    if (previewOpening || (event.key !== 'Enter' && event.key !== ' ')) {
                      return
                    }
                    event.preventDefault()
                    event.stopPropagation()
                    void handleOpenPreviewSource(previewAddress.port)
                  }}
                  aria-disabled={previewOpening}
                  className="inline-flex max-w-full items-center gap-1 rounded-md bg-violet-500/10 px-1.5 py-0.5 text-[10px] font-medium text-violet-300 transition-colors hover:bg-violet-500/15 hover:text-violet-200 aria-disabled:cursor-wait aria-disabled:opacity-70"
                >
                  {previewOpening ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : <Rocket className="h-2.5 w-2.5 shrink-0" />}
                  <span className="truncate">{previewLabel}</span>
                </span>
              )
            })}
            <TaskPullRequestBadge display={pullRequestDisplay} compact />
            <RailwayDeploymentBadge display={railwayDeploymentDisplay} compact />
            {displayStatus !== 'idle' && !(displayStatus === 'running' && item.runningCount > 0) ? (
              <span
                className={cn(
                  'rounded-md px-1.5 py-0.5 text-[10px] font-medium',
                  displayStatusMeta.className,
                )}
              >
                {t(displayStatusMeta.labelKey, { defaultValue: displayStatusMeta.defaultValue })}
              </span>
            ) : null}
            {item.runningCount > 0 && (
              <span
                data-workspace-session-target="running"
                className="rounded-md bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-300"
              >
                {t('workspace.page.runningCount', { count: item.runningCount })}
              </span>
            )}
            {item.unreadCount > 0 && (
              <span
                data-workspace-session-target="unread"
                className="rounded-md bg-cyan-500/10 px-1.5 py-0.5 text-[10px] font-medium text-cyan-300"
              >
                {t('workspace.page.attentionCount', { count: item.unreadCount })}
              </span>
            )}
            {item.errorCount > 0 && (
              <span
                data-workspace-session-target="error"
                className="rounded-md bg-orange-500/10 px-1.5 py-0.5 text-[10px] font-medium text-orange-300"
              >
                {t('workspace.page.errorCount', { count: item.errorCount })}
              </span>
            )}
          </div>
        </button>
      </div>
      {showDropPreview && workspaceDropTarget.position === 'after' ? (
        <WorkspaceListDropPreviewSlot
          height={dropPreviewHeight}
          label={t('workspace.page.dragPreview.workspace', { defaultValue: '工作区将放到这里' })}
          onDragOver={(event) => {
            onDropPreviewDragOver?.(event, 'after')
          }}
          onDrop={(event) => {
            onDropPreviewDrop?.(event, 'after')
          }}
        />
      ) : null}
    </div>
  )
}

export const WorkspaceListCard = memo(WorkspaceListCardInner, (previous, next) => (
  previous.item === next.item
  && previous.selected === next.selected
  && previous.terminalOpen === next.terminalOpen
  && previous.environmentStartCommandRunning === next.environmentStartCommandRunning
  && previous.environmentStatus === next.environmentStatus
  && previous.projectPullRequests === next.projectPullRequests
  && previous.githubResourceBindings === next.githubResourceBindings
  && previous.draggable === next.draggable
  && previous.isDragging === next.isDragging
  && previous.draggedWorkspaceItem === next.draggedWorkspaceItem
  && previous.workspaceDropTarget === next.workspaceDropTarget
  && previous.showProjectName === next.showProjectName
))

function WorkspaceListDropPreviewSlot({
  height,
  label,
  onDragOver,
  onDrop,
}: {
  height: number
  label: string
  onDragOver?: (event: DragEvent<HTMLDivElement>) => void
  onDrop?: (event: DragEvent<HTMLDivElement>) => void
}) {
  const interactive = Boolean(onDragOver || onDrop)

  return (
    <div
      aria-hidden={interactive ? undefined : true}
      onDragOver={onDragOver}
      onDrop={onDrop}
      className="overflow-hidden rounded-lg transition-[height,opacity] duration-200 ease-out"
      style={{ height }}
    >
      <div className="relative h-full rounded-lg border border-dashed border-sky-400/35 bg-sky-500/[0.08] opacity-70 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
        <div className="absolute inset-0 rounded-lg bg-[linear-gradient(180deg,rgba(125,211,252,0.06),rgba(125,211,252,0.02))]" />
        <span className="absolute left-3 top-2.5 truncate text-[10px] font-medium tracking-[0.08em] text-sky-200/75">
          {label}
        </span>
      </div>
    </div>
  )
}
