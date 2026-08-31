import { Link, useLocation, useNavigate } from "@tanstack/react-router"
import { getProjectColor } from "@shared/project-color"
import { sortProjectsByDisplayOrder } from "@shared/project-workspace-order"
import {
  BarChart3,
  Bot,
  BrainCircuit,
  Bug,
  CircleHelp,
  Clock3,
  Cloud,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Cpu,
  FileText,
  Github,
  GitPullRequest,
  Inbox,
  LayoutDashboard,
  LayoutGrid,
  PieChart,
  Languages,
  LogOut,
  MessageCircle,
  MessageSquare,
  MessagesSquare,
  Orbit,
  PencilLine,
  Plus,
  Plug,
  Radio,
  Search,
  Settings,
  Workflow,
  Wrench,
} from "lucide-react"
import { lazy, Suspense, type DragEventHandler, type ReactNode, useCallback, useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import { buildProjectPayload, createEmptyProjectDraft, projectToDraft, type ProjectFormDraft } from "../lib/project-form"
import { useAuth } from "../lib/auth-context"
import { getStoredCollaborationWorkspaceId, resolveCollaborationWorkspace, resolveCollaborationWorkspaceId, setStoredCollaborationWorkspaceId } from "../lib/collaboration-workspace"
import { loadCollaborationWorkspaces } from "../lib/collaboration-workspaces-data"
import { api, resolveMediaUrl, type AgentRecord, type CollaborationWorkspace } from "../lib/api"
import type { ExecutorRecord } from "@shared/types"
import { useApp } from "../lib/app-provider"
import { useInbox } from "../lib/inbox-provider"
import { FeedbackDialog } from "./feedback/feedback-dialog"
import {
  mergeProjectSectionOrder,
  reorderProjectIds,
  resolveSidebarProjectDropPosition,
  type SidebarProjectDropPosition,
} from "./app-sidebar-project-order"
import { partitionAgentsByScope, readCustomAgentConfig } from "@shared/custom-agent"
import { isAgentEffectivelyOnline } from "../lib/managed-cloud-executor"
import { AGENT_SIDEBAR_REFRESH_EVENT, consumeSelectedAgentId, setSelectedAgentId } from "../lib/agent-sidebar-store"
import { useTranslation } from "../lib/i18n/react"
import { changeLanguage } from '../lib/i18n'
import { useExperimentalSettings } from '../lib/use-experimental-settings'
import { getAgentAvatarAccent } from "../lib/agent-avatar"
import { isNodeVersionOutdated } from "../lib/node-version"
import { getProjectRuntimeSummary, getProjectWorkspaceUnreadCount, type ProjectRuntimeSummary } from "../lib/runtime-status"
import { isDevEnvironment, isReviewCenterEnabled } from "../lib/runtime-config"
import { isMacNativeClient } from "../lib/native-client"
import { loadAvailableAgents } from "../lib/use-available-agents"
import { useExecutorRuntimeData } from "../lib/use-executor-runtime-data"
import { partitionProjectsByScope } from "../lib/project-scope"
import { useWorkspaceScopedProjects } from "../lib/use-workspace-scoped-projects"
import { cn } from "../lib/utils"
import { AppSidebarWorkspaceSwitcher } from "./app-sidebar-workspace-switcher"
import { CommunityJoinDialog } from './community-join-dialog'
import { ProjectCloneStatusBadge } from "./project-clone-status-badge"
import { RuntimeStatusBadge } from "./runtime-status-badge"
import { Avatar, AvatarFallback, AvatarImage } from "./ui/avatar"
import { Badge } from "./ui/badge"
import { Button } from "./ui/button"
import { ScrollArea } from "./ui/scroll-area"
import { Separator } from "./ui/separator"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from './ui/dropdown-menu'
import { useSidebar } from "./ui/sidebar"
import { useWorkspaceSessionUnreadSnapshot } from "../lib/use-workspace-session-unread-state"
import { useChatTotalUnread } from "../lib/chat-unread-store"
import { requestGlobalSearchOpen } from "./global-search/global-search-nav"
import { UserMenuPopover } from "./user-menu-popover"

const appVersion = __APP_VERSION__
const SIDEBAR_WIDTH_STORAGE_KEY = "vibemux.sidebar.width"
const SIDEBAR_MIN_WIDTH = 230
const SIDEBAR_MAX_WIDTH = 384
const SIDEBAR_DEFAULT_WIDTH = 282
const SIDEBAR_FOCUS_REFRESH_COOLDOWN_MS = 60_000
const SIDEBAR_SECONDARY_DATA_IDLE_TIMEOUT_MS = 1_200
const CreateProjectModal = lazy(() => import("./kanban/create-project-modal").then((module) => ({ default: module.CreateProjectModal })))
const ProjectEditDialog = lazy(() => import("./project-edit-dialog").then((module) => ({ default: module.ProjectEditDialog })))

type SidebarNavigationItem = {
  label: string
  icon: typeof LayoutDashboard
  path: string
  badgeCount?: number
  dot?: boolean
  isAlpha?: boolean
  meta?: string
  search?: Record<string, string | undefined>
  isActiveOverride?: boolean
  onClick?: () => void
}

const getSidebarNavigationItemKey = (item: SidebarNavigationItem, prefix = '') => {
  const searchKey = item.search
    ? new URLSearchParams(
        Object.entries(item.search).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
      ).toString()
    : ''
  return `${prefix}${item.path}:${searchKey}`
}

function isRouteActive(currentPath: string, path: string) {
  return currentPath === path || (path === "/dashboard" && currentPath === "/")
}

function clampSidebarWidth(width: number) {
  return Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, width))
}

function getAgentInitials(name: string) {
  return (name.trim() || "Agent").slice(0, 2).toUpperCase()
}

function getSidebarAgentProfile(agent: AgentRecord) {
  const profile = readCustomAgentConfig(agent.config)
  return {
    avatarUrl: profile.avatarUrl.trim(),
    role: profile.role.trim(),
  }
}

function SidebarFeatureBadge({
  compact = false,
}: {
  compact?: boolean
}) {
  const { t } = useTranslation()

  return (
    <Badge
      variant="outline"
      className={cn(
        "shrink-0 border-amber-400/25 bg-amber-400/10 font-semibold uppercase text-amber-200",
        compact ? "px-1 py-0 text-[8px] leading-3" : "px-1.5 py-0 text-[9px] leading-4 tracking-[0.18em]",
      )}
    >
      {compact ? "A" : t("sidebar.alphaBadge")}
    </Badge>
  )
}

function SidebarPanelLink({
  currentPath,
  icon: Icon,
  badgeCount,
  dot,
  isAlpha,
  label,
  path,
  meta,
  reserveMetaSpace = false,
  search,
  isActiveOverride,
  onClick,
}: {
  currentPath: string
  icon: typeof LayoutDashboard
  badgeCount?: number
  dot?: boolean
  isAlpha?: boolean
  label: string
  path: string
  meta?: ReactNode
  reserveMetaSpace?: boolean
  search?: Record<string, string | undefined>
  isActiveOverride?: boolean
  onClick?: () => void
}) {
  const isActive = isActiveOverride ?? isRouteActive(currentPath, path)
  const shouldRenderMeta = reserveMetaSpace || Boolean(meta)

  return (
    <Button
      asChild
      variant="ghost"
      className={cn(
        "h-auto w-full justify-start rounded-lg px-3 py-2 text-left text-zinc-400 transition-colors duration-150 hover:bg-white/[0.06] hover:text-zinc-100",
        isActive && "bg-white/[0.1] text-zinc-50 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] hover:bg-white/[0.12]"
      )}
    >
      <Link
        to={path as never}
        search={(search ?? {}) as never}
        onClick={onClick}
        activeOptions={{ exact: true } as never}
        activeProps={{ className: '' } as never}
        aria-current={isActive ? 'page' : undefined}
      >
        <Icon size={16} className="mt-0.5" />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className="block truncate text-sm font-medium">{label}</span>
            {isAlpha ? <SidebarFeatureBadge /> : null}
          </span>
          {shouldRenderMeta ? (
            <span
              className={cn(
                'block min-h-[16px] truncate text-xs text-zinc-500',
                !meta && 'invisible',
              )}
              aria-hidden={!meta}
            >
              {meta ?? 'placeholder'}
            </span>
          ) : null}
        </span>
        {typeof badgeCount === "number" && badgeCount > 0 ? (
          <span className="ml-2 inline-flex min-w-5 items-center justify-center rounded-full bg-rose-500 px-1.5 py-0.5 text-[10px] font-semibold leading-none text-white">
            {badgeCount > 99 ? "99+" : badgeCount}
          </span>
        ) : null}
        {dot ? (
          <span className="ml-2 inline-flex size-2 shrink-0 rounded-full bg-rose-500" aria-label="unread" />
        ) : null}
      </Link>
    </Button>
  )
}

function ProjectSidebarSubsection({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  return (
    <div className="space-y-1">
      <div className="px-3">
        <span className="text-[10px] font-medium tracking-[0.08em] text-zinc-600">
          {title}
        </span>
      </div>
      <div className="space-y-0.5">{children}</div>
    </div>
  )
}

function ProjectSidebarButton({
  currentPath,
  color,
  isSelected,
  label,
  project,
  unreadCount,
  runtime,
  draggable,
  onDragStart,
  onDragEnd,
  onClick,
}: {
  currentPath: string
  color: string
  isSelected: boolean
  label: string
  project: {
    repositoryCloneStatus?: "cloning" | "failed"
    repositoryCloneMessage?: string
    updatedAt: string
  }
  unreadCount: number
  runtime: ReturnType<typeof getProjectRuntimeSummary>
  draggable?: boolean
  onDragStart?: DragEventHandler<HTMLButtonElement>
  onDragEnd?: DragEventHandler<HTMLButtonElement>
  onClick: () => void
}) {
  const isActive = currentPath === "/kanban" && isSelected
  const { t } = useTranslation()
  const projectRuntimeSummary: ProjectRuntimeSummary = {
    ...runtime,
    phase: runtime.runningCount > 0 ? 'running' : unreadCount > 0 ? 'attention' : 'idle',
    attentionCount: unreadCount,
  }

  return (
    <Button
      type="button"
      variant="ghost"
      draggable={draggable}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onClick={onClick}
      className={cn(
        "h-auto w-full justify-start rounded-lg px-3 py-1.5 text-left text-zinc-400 transition-colors duration-150 hover:bg-white/[0.06] hover:text-zinc-100",
        draggable && "cursor-grab active:cursor-grabbing",
        isActive && "bg-white/[0.1] text-zinc-50 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] hover:bg-white/[0.12]"
      )}
    >
      <span
        className="mt-0.5 h-3.5 w-3.5 shrink-0 rounded-sm"
        style={{ backgroundColor: color }}
      />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-medium">{label}</span>
        <span className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-zinc-500">
          <ProjectCloneStatusBadge project={project} compact />
          {!project.repositoryCloneStatus ? (
            <RuntimeStatusBadge
              projectSummary={projectRuntimeSummary}
              compact
              showText
              className="min-w-0"
              attentionCountLabel={t('workspace.page.attentionCount', { count: unreadCount })}
              attentionLabel={t('workspace.page.attention', { defaultValue: '未读' })}
            />
          ) : null}
        </span>
      </span>
    </Button>
  )
}

function SidebarDropPreviewSlot({
  height,
  label,
}: {
  height: number
  label: string
}) {
  return (
    <div
      aria-hidden="true"
      className="overflow-hidden rounded-lg transition-[height,opacity] duration-200 ease-out"
      style={{ height }}
    >
      <div className="flex h-full items-center justify-center rounded-lg border border-dashed border-sky-400/45 bg-sky-500/[0.06] px-3 shadow-[inset_0_0_0_1px_rgba(125,211,252,0.08)]">
        <div className="flex h-[calc(100%-8px)] w-full items-center justify-center rounded-md border border-sky-300/10 bg-[linear-gradient(90deg,rgba(125,211,252,0.08),rgba(125,211,252,0.02))] px-3">
          <span className="truncate text-[10px] font-medium tracking-[0.08em] text-sky-200/80">
            {label}
          </span>
        </div>
      </div>
    </div>
  )
}

function SidebarSection({
  title,
  isAlpha,
  children,
  onAdd,
}: {
  title?: string
  isAlpha?: boolean
  children: React.ReactNode
  onAdd?: () => void
}) {
  const { t } = useTranslation()

  return (
    <section className="space-y-1.5">
      {(title || onAdd) ? (
        <div className="flex items-center justify-between px-3">
          <div className="flex min-w-0 items-center gap-2">
            {title ? (
              <span className="text-[10px] font-semibold uppercase tracking-[0.24em] text-zinc-500">
                {title}
              </span>
            ) : null}
            {isAlpha ? <SidebarFeatureBadge /> : null}
          </div>
          {onAdd && (
            <Button
              variant="ghost"
              size="icon"
              onClick={onAdd}
              className="h-6 w-6 rounded-md text-zinc-500 hover:bg-zinc-900 hover:text-zinc-100"
            >
              <Plus size={13} />
              <span className="sr-only">{`${t('common.add')} ${title}`}</span>
            </Button>
          )}
        </div>
      ) : null}
      <div className="space-y-0.5">{children}</div>
    </section>
  )
}

function SidebarRailLink({
  badgeCount,
  currentPath,
  dot,
  icon: Icon,
  isAlpha,
  isActiveOverride,
  label,
  onClick,
  path,
  search,
}: {
  badgeCount?: number
  currentPath: string
  dot?: boolean
  icon: typeof LayoutDashboard
  isAlpha?: boolean
  isActiveOverride?: boolean
  label: string
  onClick?: () => void
  path: string
  search?: Record<string, string | undefined>
}) {
  const { t } = useTranslation()
  const isActive = isActiveOverride ?? isRouteActive(currentPath, path)
  const title = isAlpha ? `${label} · ${t("sidebar.alphaBadge")}` : label

  return (
    <Button
      asChild
      variant="ghost"
      size="icon"
      title={title}
      className={cn(
        "relative h-10 w-10 rounded-lg text-zinc-400 transition-colors duration-150 hover:bg-white/[0.07] hover:text-zinc-100",
        isActive && "bg-white/[0.1] text-zinc-50 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] hover:bg-white/[0.12]",
      )}
    >
      <Link
        to={path as never}
        search={(search ?? {}) as never}
        onClick={onClick}
        activeOptions={{ exact: true } as never}
        activeProps={{ className: '' } as never}
        aria-current={isActive ? 'page' : undefined}
      >
        <Icon size={16} />
        <span className="sr-only">{title}</span>
        {isAlpha ? (
          <span className="pointer-events-none absolute bottom-1 right-1">
            <SidebarFeatureBadge compact />
          </span>
        ) : null}
        {typeof badgeCount === "number" && badgeCount > 0 ? (
          <span className="pointer-events-none absolute right-1 top-1 inline-flex min-w-4 items-center justify-center rounded-full bg-rose-500 px-1 text-[9px] font-semibold leading-none text-white">
            {badgeCount > 9 ? "9+" : badgeCount}
          </span>
        ) : null}
        {dot ? (
          <span className="pointer-events-none absolute right-1 top-1 size-2 rounded-full bg-rose-500" />
        ) : null}
      </Link>
    </Button>
  )
}

function SidebarRailActionButton({
  icon: Icon,
  label,
  onClick,
}: {
  icon: typeof LayoutDashboard
  label: string
  onClick: () => void
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      title={label}
      onClick={onClick}
      className="h-10 w-10 rounded-lg text-zinc-400 hover:bg-white/[0.07] hover:text-zinc-100"
    >
      <Icon size={16} />
      <span className="sr-only">{label}</span>
    </Button>
  )
}

function SidebarHelpMenu({
  language,
  onJoinCommunity,
  onLogout,
}: {
  language: string
  onJoinCommunity: () => void
  onLogout: () => void
}) {
  const [supportOpen, setSupportOpen] = useState(false)
  const [supportTab, setSupportTab] = useState<'chat' | 'feedback'>('chat')
  const [unreadReplies, setUnreadReplies] = useState(0)
  const nextLanguage = language === 'zh' ? 'en' : 'zh'

  // 问号红点：未读创始人回复/升级提醒（不进全局收件箱，轮询保持同步）
  useEffect(() => {
    let cancelled = false
    const refresh = async () => {
      try {
        const response = await api.getFeedbackUnreadCount()
        if (!cancelled) setUnreadReplies(response.count)
      } catch {
        // 静默
      }
    }
    void refresh()
    const timer = setInterval(() => void refresh(), 60_000)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [])

  // 打开弹窗后标已读，红点归零
  useEffect(() => {
    if (supportOpen) {
      void api.markFeedbackRepliesRead().then(() => setUnreadReplies(0)).catch(() => {})
    }
  }, [supportOpen])

  const openSupport = (tab: 'chat' | 'feedback') => {
    setSupportTab(tab)
    setSupportOpen(true)
  }

  return (
    <>
      <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          title={language === 'zh' ? '更多操作' : 'More actions'}
          className="relative h-8 w-8 rounded-full bg-transparent text-zinc-400 hover:bg-white/[0.08] hover:text-zinc-100"
        >
          <CircleHelp size={16} />
          {unreadReplies > 0 && (
            <span className="absolute right-0.5 top-0.5 flex h-2.5 min-w-2.5 items-center justify-center rounded-full bg-rose-500 px-0.5 text-[9px] font-semibold text-white">
              {unreadReplies > 9 ? '9+' : unreadReplies}
            </span>
          )}
          <span className="sr-only">{language === 'zh' ? '更多操作' : 'More actions'}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="end" className="wemux-sidebar-menu-surface w-48">
        <DropdownMenuItem onSelect={() => openSupport('chat')}>
          <MessagesSquare />
          {language === 'zh' ? '与创始人沟通' : 'Chat with founder'}
          {unreadReplies > 0 && (
            <span className="ml-auto rounded-full bg-rose-500 px-1.5 text-[10px] font-semibold text-white">
              {unreadReplies}
            </span>
          )}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={onJoinCommunity}>
          <MessageCircle />
          {language === 'zh' ? '加入社群' : 'Join community'}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => openSupport('feedback')}>
          <Bug />
          {language === 'zh' ? '反馈与建议' : 'Feedback'}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => void changeLanguage(nextLanguage)}>
          <Languages />
          {language === 'zh' ? 'Switch to English' : '切换到中文'}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={onLogout} className="text-rose-300 focus:bg-rose-500/10 focus:text-rose-100">
          <LogOut />
          {language === 'zh' ? '退出登录' : 'Sign out'}
        </DropdownMenuItem>
      </DropdownMenuContent>
      </DropdownMenu>
      <FeedbackDialog open={supportOpen} onOpenChange={setSupportOpen} initialTab={supportTab} />
    </>
  )
}

function SidebarExpandablePanelButton({
  expanded,
  icon: Icon,
  isActive,
  label,
  onClick,
}: {
  expanded: boolean
  icon: typeof LayoutDashboard
  isActive: boolean
  label: string
  onClick: () => void
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      onClick={onClick}
      className={cn(
        "h-auto w-full justify-start rounded-lg px-3 py-2 text-left text-zinc-400 transition-colors duration-150 hover:bg-white/[0.06] hover:text-zinc-100",
        isActive && "bg-white/[0.1] text-zinc-50 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] hover:bg-white/[0.12]",
      )}
    >
      <Icon size={16} className="mt-0.5" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{label}</span>
      </span>
      {expanded ? <ChevronDown size={16} className="text-zinc-500" /> : <ChevronRight size={16} className="text-zinc-500" />}
    </Button>
  )
}

function AgentSidebarGroups({
  agents,
  currentPath,
  executors,
  language,
  selectedAgentId,
  onSelectAgent,
  t,
}: {
  agents: AgentRecord[]
  currentPath: string
  executors: ExecutorRecord[]
  language: string
  selectedAgentId: string
  onSelectAgent: (agentId: string) => void
  t: (key: string, options?: Record<string, unknown>) => string
}) {
  const { workspaceAgents, privateAgents } = partitionAgentsByScope(agents)
  const renderAgent = (agent: AgentRecord) => (
    <SidebarAgentButton
      key={agent.id}
      agent={agent}
      currentPath={currentPath}
      selectedAgentId={selectedAgentId}
      onClick={onSelectAgent}
      executors={executors}
      language={language}
    />
  )

  return (
    <div className="space-y-2">
      {workspaceAgents.length > 0 ? (
        <ProjectSidebarSubsection title={t('sidebar.projects.scope.workspace', { defaultValue: language === 'zh' ? '协作区' : 'Workspace' })}>
          {workspaceAgents.map(renderAgent)}
        </ProjectSidebarSubsection>
      ) : null}
      {privateAgents.length > 0 ? (
        <ProjectSidebarSubsection title={t('sidebar.projects.scope.private', { defaultValue: language === 'zh' ? '私人' : 'Private' })}>
          {privateAgents.map(renderAgent)}
        </ProjectSidebarSubsection>
      ) : null}
    </div>
  )
}

function SidebarAgentButton({
  agent,
  currentPath,
  selectedAgentId,
  onClick,
  executors,
  language,
}: {
  agent: AgentRecord
  currentPath: string
  selectedAgentId: string
  onClick: (agentId: string) => void
  executors: ExecutorRecord[]
  language: string
}) {
  const profile = getSidebarAgentProfile(agent)
  const config = readCustomAgentConfig(agent.config)
  const isActive = currentPath === "/agents" && selectedAgentId === agent.id
  const runtimeExecutor = config.defaultExecutorId
    ? executors.find((executor) => executor.executorId === config.defaultExecutorId)
    : undefined
  const nodeLabel = runtimeExecutor?.name
    || config.defaultExecutorId
    || (language === "zh" ? "云托管节点" : "Hosted Cloud")
  const agentOnline = isAgentEffectivelyOnline({
    agentStatus: agent.status,
    defaultExecutorId: config.defaultExecutorId,
    executors,
  })
  return (
    <Button
      type="button"
      variant="ghost"
      onClick={() => onClick(agent.id)}
      className={cn(
        "h-auto w-full justify-start rounded-lg px-3 py-1.5 text-left text-zinc-400 transition-colors duration-150 hover:bg-white/[0.06] hover:text-zinc-100",
        isActive && "bg-white/[0.1] text-zinc-50 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] hover:bg-white/[0.12]",
      )}
    >
      <span className="shrink-0">
        <Avatar className="h-8 w-8 rounded-full border border-zinc-800 bg-zinc-900">
          <AvatarImage src={resolveMediaUrl(profile.avatarUrl)} />
          <AvatarFallback className={cn(
            "rounded-full bg-gradient-to-br text-[11px] font-black text-zinc-950",
            getAgentAvatarAccent(agent.id),
          )}>
            {getAgentInitials(agent.name)}
          </AvatarFallback>
        </Avatar>
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-medium">{agent.name}</span>
        <span className="mt-0.5 flex items-center gap-1.5 text-xs text-zinc-500">
          <Radio className={cn("h-3 w-3 shrink-0", agentOnline ? "text-emerald-400" : "text-zinc-600")} />
          <span className="truncate">{nodeLabel}</span>
        </span>
      </span>
    </Button>
  )
}

export function AppSidebar() {
  const { language, t } = useTranslation()
  const location = useLocation()
  const navigate = useNavigate()
  const { user, logout } = useAuth()
  const experimentalSettings = useExperimentalSettings()
  const { state, selectedProjectId, setSelectedProjectId, setState, busy, runMutation } = useApp()
  const { collapsed, setCollapsed, isMobile, mobileOpen, setMobileOpen } = useSidebar()
  const isMacNative = !isMobile && isMacNativeClient()
  const workspaceSessionUnreadState = useWorkspaceSessionUnreadSnapshot()
  const { badgeCount: inboxUnreadGroups } = useInbox()
  const chatTotalUnread = useChatTotalUnread()
  const { executors, refreshExecutors } = useExecutorRuntimeData()
  const [createModalOpen, setCreateModalOpen] = useState(false)
  const [createMode, setCreateMode] = useState<"create" | "clone">("create")
  const [collaborationWorkspaces, setCollaborationWorkspaces] = useState<CollaborationWorkspace[]>([])
  const [currentWorkspaceId, setCurrentWorkspaceId] = useState('')
  const [agents, setAgents] = useState<AgentRecord[]>([])
  const [agentsLoading, setAgentsLoading] = useState(true)
  const [selectedAgentId, setSidebarSelectedAgentId] = useState('')
  const [sidebarWidth, setSidebarWidth] = useState(SIDEBAR_DEFAULT_WIDTH)
  const [isResizing, setIsResizing] = useState(false)
  const [draggedProjectItem, setDraggedProjectItem] = useState<{
    projectId: string
    rowHeight: number
  } | null>(null)
  const [projectDropTarget, setProjectDropTarget] = useState<{
    projectId: string
    position: SidebarProjectDropPosition
  } | null>(null)
  const [projectEditOpen, setProjectEditOpen] = useState(false)
  const [editingProjectId, setEditingProjectId] = useState('')
  const [projectDraft, setProjectDraft] = useState<ProjectFormDraft>(createEmptyProjectDraft)
  const [projectReimportBusy, setProjectReimportBusy] = useState(false)
  const [communityDialogOpen, setCommunityDialogOpen] = useState(false)
  const resizeFrameRef = useRef<number | null>(null)
  const sidebarDataRequestRef = useRef(0)
  const sidebarDataLoadedAtRef = useRef(0)
  const sidebarAliveRef = useRef(true)
  const currentPath = location.pathname
  const currentSearch = typeof window === 'undefined' ? '' : window.location.search
  const currentSearchParams = new URLSearchParams(currentSearch)
  const routeProjectId = currentSearchParams.get('projectId')?.trim() || ''
  const currentWorkspace = resolveCollaborationWorkspace(collaborationWorkspaces, currentWorkspaceId)
  const { visibleProjects } = useWorkspaceScopedProjects(
    state.projects,
    currentWorkspaceId,
    { pinnedProjectIds: routeProjectId ? [routeProjectId] : [] },
  )
  const { workspaceProjects: workspaceScopedProjects, privateProjects: personalProjects, sharedWithMeProjects } = partitionProjectsByScope(visibleProjects, { currentUserId: user?.id ?? '' })
  const workspaceProjectIdSet = new Set(workspaceScopedProjects.map((project) => project.id))
  const personalProjectIdSet = new Set(personalProjects.map((project) => project.id))
  const [githubSectionExpanded, setGithubSectionExpanded] = useState(currentPath === '/review' || currentPath === '/actions')
  const editingProject = editingProjectId ? state.projects.find((project) => project.id === editingProjectId) ?? null : null
  const visibleExecutors = executors.filter((executor) => executor.executorSource !== 'managed-cloud' && executor.managedBy !== 'vibemux')
  const onlineExecutorCount = visibleExecutors.filter((executor) => executor.status === "online").length
  const pairedExecutorCount = visibleExecutors.filter((executor) => executor.status === "paired" || executor.status === "pairing").length
  const offlineExecutorCount = visibleExecutors.length - onlineExecutorCount - pairedExecutorCount
  const updatableExecutorCount = visibleExecutors.filter((executor) => isNodeVersionOutdated(executor.version)).length
  const isInboxActive = currentPath === '/inbox' || (currentPath === '/agents' && currentSearchParams?.get('tab') === 'inbox')
  const isAutomationVisible = isDevEnvironment()
  const reviewCenterEnabled = isReviewCenterEnabled()
  // 收件箱未读 group 数（实时 SSE 驱动）。
  const inboxBadgeCount = inboxUnreadGroups

  const isReviewPageActive = currentPath === '/review' && currentSearchParams.get('mode') !== 'issues' && !currentSearchParams.get('issueId')
  const isIssuesPageActive = currentPath === '/review' && (currentSearchParams.get('mode') === 'issues' || Boolean(currentSearchParams.get('issueId')))
  const isGithubSectionActive = currentPath === '/review' || currentPath === '/actions'

  const workItems: SidebarNavigationItem[] = [
    { label: t("nav.dashboard"), icon: LayoutDashboard, path: "/dashboard" },
    { label: t("nav.workspaces"), icon: LayoutGrid, path: "/workspaces" },
    { label: t("nav.drive"), icon: Cloud, path: "/drive" },
    ...(experimentalSettings.meetingListening
      ? [{ label: t("nav.meetingRecords"), icon: Radio, path: "/meeting-records" }]
      : []),
    ...(experimentalSettings.brain
      ? [{ label: t("nav.brain"), icon: BrainCircuit, path: "/brain" }]
      : []),
    ...(isAutomationVisible
      ? [{ label: t("nav.automations"), icon: Clock3, path: "/automations" }]
      : []),
    { label: t("nav.projectManagerAgent"), icon: MessageCircle, path: "/chat", dot: chatTotalUnread > 0 },
    {
      label: t("nav.inbox"),
      icon: Inbox,
      path: "/inbox",
      badgeCount: inboxBadgeCount,
      isActiveOverride: isInboxActive,
      onClick: () => setMobileOpen(false),
    },
  ]
  const githubItems: SidebarNavigationItem[] = reviewCenterEnabled
    ? [
        { label: t("nav.reviews"), icon: GitPullRequest, path: "/review", isActiveOverride: isReviewPageActive },
        { label: t("nav.actions"), icon: Workflow, path: "/actions" },
        {
          label: t("nav.issues"),
          icon: MessageSquare,
          path: "/review",
          search: { mode: 'issues' },
          isActiveOverride: isIssuesPageActive,
        },
      ]
    : []
  const systemItems: Array<{
    label: string
    icon: typeof LayoutDashboard
    path: string
    isAlpha?: boolean
    meta?: ReactNode
  }> = [
    {
      label: t('nav.workstationManagement'),
      icon: Workflow,
      path: '/execution',
      meta: visibleExecutors.length > 0
        ? (
            <>
              <span className="text-emerald-400">
                {onlineExecutorCount} {t('execution.online')}
              </span>
              {pairedExecutorCount > 0 ? (
                <>
                  {' · '}
                  <span className="text-amber-400">
                    {pairedExecutorCount} {t('execution.paired')}
                  </span>
                </>
              ) : null}
              {' · '}
              {offlineExecutorCount} {t('execution.offline')}
              {updatableExecutorCount > 0 ? (
                <>
                  {' · '}
                  <span className="text-amber-300">
                    {updatableExecutorCount} {t('execution.updatable')}
                  </span>
                </>
              ) : null}
            </>
          )
        : undefined,
    },
    {
      label: t('nav.overview'),
      icon: BarChart3,
      path: '/overview',
    },
    {
      label: t('nav.universe'),
      icon: Orbit,
      path: '/universe',
      meta: t('sidebar.systemItems.universeMeta'),
    },
    {
      label: t('nav.usage'),
      icon: PieChart,
      path: '/usage',
    },
    {
      label: t('nav.changelog'),
      icon: FileText,
      path: '/changelog',
      meta: t('sidebar.systemItems.changelogMeta'),
    },
    {
      label: t('nav.models'),
      icon: Cpu,
      path: '/models',
      meta: t('sidebar.systemItems.modelsMeta'),
    },
    {
      label: t('nav.skills'),
      icon: Bot,
      path: '/skills',
      isAlpha: true,
      meta: t('sidebar.systemItems.skillsMeta'),
    },
    {
      label: t('nav.integrations'),
      icon: Plug,
      path: '/integrations',
      meta: t('sidebar.systemItems.integrationsMeta'),
    },
    {
      label: t('nav.mcp'),
      icon: Wrench,
      path: '/mcp',
      isAlpha: true,
      meta: t('sidebar.systemItems.mcpMeta'),
    },
    {
      label: t('nav.feedback'),
      icon: MessageSquare,
      path: '/feedback',
    },
    {
      label: t('nav.settings'),
      icon: Settings,
      path: '/settings',
      meta: t('settings.modelExecutionCleanup'),
    },
  ]

  const openCreateProjectModal = () => {
    setCreateMode("create")
    setCreateModalOpen(true)
    setMobileOpen(false)
  }

  const openCreateTaskModal = () => {
    void navigate({
      to: "/kanban",
      search: {
        projectId: selectedProjectId || undefined,
        taskId: undefined,
        createTask: "1",
      },
    })
    setMobileOpen(false)
  }

  const openCommunityDialog = () => {
    setCommunityDialogOpen(true)
    setMobileOpen(false)
  }

  const handleSelectProject = (projectId: string) => {
    setSelectedProjectId(projectId)

    void navigate({
      to: "/kanban",
      search: {
        projectId,
        taskId: undefined,
        createTask: undefined,
      },
    })
    setMobileOpen(false)
  }

  const openGitHubSection = () => {
    setGithubSectionExpanded(true)
    void navigate({
      to: '/review' as never,
      search: {} as never,
    })
    setMobileOpen(false)
  }

  const handleOpenProjectEdit = (projectId: string) => {
    const project = state.projects.find((item) => item.id === projectId)
    if (!project) {
      return
    }

    setEditingProjectId(project.id)
    setProjectDraft(projectToDraft(project))
    setProjectEditOpen(true)
  }

  const handleProjectEditOpenChange = (open: boolean) => {
    setProjectEditOpen(open)
    if (!open) {
      setEditingProjectId('')
      setProjectDraft(createEmptyProjectDraft())
    }
  }

  const handleSubmitProjectEdit = async () => {
    if (!editingProject || !projectDraft.name.trim()) {
      return
    }

    const response = await runMutation(() => api.updateProject(
      editingProject.id,
      buildProjectPayload(projectDraft, editingProject),
    ))
    const nextProject = response?.state.projects.find((item) => item.id === editingProject.id)
    if (nextProject) {
      setProjectDraft(projectToDraft(nextProject))
    }
  }

  const handleReimportProjectEnvironmentTemplate = async () => {
    if (!editingProject) {
      return
    }

    setProjectReimportBusy(true)
    try {
      const response = await runMutation(() => api.importProjectEnvironmentTemplate(editingProject.id))
      const nextProject = response?.state.projects.find((item) => item.id === editingProject.id)
      if (nextProject) {
        setProjectDraft(projectToDraft(nextProject))
      }
    } finally {
      setProjectReimportBusy(false)
    }
  }

  const handleDeleteProject = async (options: { projectName: string; deleteProjectDirectory: boolean }) => {
    if (!editingProject) {
      return
    }

    const response = await runMutation(() => api.deleteProject(editingProject.id, options))
    if (response) {
      handleProjectEditOpenChange(false)
    }
  }

  const handleReorderProjects = useCallback(async (orderedProjectIds: string[]) => {
    const visibleProjectIdSet = new Set(visibleProjects.map((project) => project.id))
    const visibleProjectOrder = orderedProjectIds.filter((projectId) => visibleProjectIdSet.has(projectId))
    if (visibleProjectOrder.length <= 1) {
      return
    }

    const currentVisibleProjectOrder = visibleProjects.map((project) => project.id)
    const nextVisibleProjectOrder = mergeProjectSectionOrder(currentVisibleProjectOrder, visibleProjectOrder)
    if (!nextVisibleProjectOrder || nextVisibleProjectOrder.length !== visibleProjects.length) {
      return
    }

    const projectOrderById = new Map(nextVisibleProjectOrder.map((projectId, index) => [projectId, index] as const))
    const previousProjects = state.projects

    setState((current) => ({
      ...current,
      projects: sortProjectsByDisplayOrder(current.projects.map((project) => {
        const displayOrder = projectOrderById.get(project.id)
        return typeof displayOrder === 'number'
          ? { ...project, displayOrder }
          : project
      })),
    }))

    try {
      const response = await api.reorderProjects({ orderedProjectIds: nextVisibleProjectOrder })
      setState(response.state)
    } catch (error) {
      setState((current) => ({ ...current, projects: previousProjects }))
      toast.error(error instanceof Error ? error.message : t('workspace.page.errors.loadFailed'))
      throw error
    }
  }, [setState, state.projects, t, visibleProjects])

  const handleProjectDragEnd = useCallback(() => {
    setDraggedProjectItem(null)
    setProjectDropTarget(null)
  }, [])

  const handleProjectDrop = useCallback((
    draggedId: string,
    targetProjectId: string,
    position: SidebarProjectDropPosition,
  ) => {
    const workspaceProjectIds = workspaceScopedProjects.map((project) => project.id)
    const personalProjectIds = personalProjects.map((project) => project.id)
    const isWorkspaceSectionDrop = workspaceProjectIdSet.has(draggedId) && workspaceProjectIdSet.has(targetProjectId)
    const isPersonalSectionDrop = personalProjectIdSet.has(draggedId) && personalProjectIdSet.has(targetProjectId)

    const scopedProjectIds = isWorkspaceSectionDrop
      ? workspaceProjectIds
      : isPersonalSectionDrop
        ? personalProjectIds
        : null

    if (!scopedProjectIds) {
      handleProjectDragEnd()
      return
    }

    const nextOrderedProjectIds = reorderProjectIds(
      scopedProjectIds,
      draggedId,
      targetProjectId,
      position,
    )

    handleProjectDragEnd()
    if (!nextOrderedProjectIds) {
      return
    }

    void handleReorderProjects(nextOrderedProjectIds)
  }, [handleProjectDragEnd, handleReorderProjects, personalProjectIdSet, personalProjects, workspaceProjectIdSet, workspaceScopedProjects])

  const handleResize = useCallback((clientX: number) => {
    if (isMobile || collapsed) {
      return
    }

    const nextWidth = clampSidebarWidth(clientX)

    if (resizeFrameRef.current !== null) {
      cancelAnimationFrame(resizeFrameRef.current)
    }

    resizeFrameRef.current = requestAnimationFrame(() => {
      setSidebarWidth(nextWidth)
    })
  }, [collapsed, isMobile])

  const handleResizeStart = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (isMobile || collapsed) {
      return
    }

    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    setIsResizing(true)
  }, [collapsed, isMobile])

  useEffect(() => {
    if (typeof window === "undefined") {
      return
    }

    const storedWidth = window.localStorage.getItem(SIDEBAR_WIDTH_STORAGE_KEY)
    if (!storedWidth) {
      return
    }

    const parsedWidth = Number(storedWidth)
    if (!Number.isFinite(parsedWidth)) {
      return
    }

    setSidebarWidth(clampSidebarWidth(parsedWidth))
  }, [])

  useEffect(() => {
    if (typeof window === "undefined") {
      return
    }

    window.localStorage.setItem(SIDEBAR_WIDTH_STORAGE_KEY, String(sidebarWidth))
  }, [sidebarWidth])

  useEffect(() => {
    if (!isResizing) {
      return
    }

    const handlePointerMove = (event: PointerEvent) => {
      handleResize(event.clientX)
    }

    const stopResize = () => {
      setIsResizing(false)
    }

    document.body.style.userSelect = "none"
    document.body.style.cursor = "col-resize"
    window.addEventListener("pointermove", handlePointerMove)
    window.addEventListener("pointerup", stopResize)
    window.addEventListener("pointercancel", stopResize)

    return () => {
      document.body.style.userSelect = ""
      document.body.style.cursor = ""
      window.removeEventListener("pointermove", handlePointerMove)
      window.removeEventListener("pointerup", stopResize)
      window.removeEventListener("pointercancel", stopResize)
    }
  }, [handleResize, isResizing])

  useEffect(() => {
    sidebarAliveRef.current = true

    return () => {
      sidebarAliveRef.current = false
      if (resizeFrameRef.current !== null) {
        cancelAnimationFrame(resizeFrameRef.current)
      }
    }
  }, [])

  useEffect(() => {
    if (!isMobile) {
      return
    }

    setMobileOpen(false)
  }, [currentPath, isMobile, setMobileOpen])

  useEffect(() => {
    if (isGithubSectionActive) {
      setGithubSectionExpanded(true)
    }
  }, [isGithubSectionActive])

  useEffect(() => {
    setSidebarSelectedAgentId(consumeSelectedAgentId())
  }, [currentPath, currentSearch])

  useEffect(() => {
    if (collaborationWorkspaces.length === 0) {
      return
    }

    const nextWorkspaceId = resolveCollaborationWorkspaceId(
      collaborationWorkspaces,
      currentWorkspaceId || getStoredCollaborationWorkspaceId(),
    )
    if (nextWorkspaceId !== currentWorkspaceId) {
      setCurrentWorkspaceId(nextWorkspaceId)
    }

    if (getStoredCollaborationWorkspaceId() !== nextWorkspaceId) {
      setStoredCollaborationWorkspaceId(nextWorkspaceId || null)
    }
  }, [collaborationWorkspaces, currentWorkspaceId])

  useEffect(() => {
    if (visibleProjects.some((project) => project.id === selectedProjectId)) {
      return
    }

    setSelectedProjectId(visibleProjects[0]?.id ?? '')
  }, [selectedProjectId, setSelectedProjectId, visibleProjects])

  const loadSidebarData = useCallback(async (options: { force?: boolean } = {}) => {
    const now = Date.now()
    if (!options.force && now - sidebarDataLoadedAtRef.current < SIDEBAR_FOCUS_REFRESH_COOLDOWN_MS) {
      return
    }

    sidebarDataLoadedAtRef.current = now
    const requestId = ++sidebarDataRequestRef.current

    void refreshExecutors(options.force)

    setAgentsLoading(true)
    void loadAvailableAgents({
      force: options.force,
      workspaceId: currentWorkspaceId || undefined,
    })
      .then((nextAgents) => {
        if (!sidebarAliveRef.current || requestId !== sidebarDataRequestRef.current) {
          return
        }

        const sidebarAgents = nextAgents.filter((agent) => agent.type.trim().toLowerCase() !== 'main')
        const storedSelectedAgentId = consumeSelectedAgentId()
        const nextSelectedAgentId = sidebarAgents.some((agent) => agent.id === storedSelectedAgentId)
          ? storedSelectedAgentId
          : ''

        setAgents(sidebarAgents)
        setSidebarSelectedAgentId(nextSelectedAgentId)
      })
      .catch(() => {
        if (!sidebarAliveRef.current || requestId !== sidebarDataRequestRef.current) {
          return
        }

        setAgents([])
        setSidebarSelectedAgentId('')
      })
      .finally(() => {
        if (!sidebarAliveRef.current || requestId !== sidebarDataRequestRef.current) {
          return
        }

        setAgentsLoading(false)
      })

    void loadCollaborationWorkspaces()
      .then((workspaces) => {
        if (!sidebarAliveRef.current || requestId !== sidebarDataRequestRef.current) {
          return
        }

        setCollaborationWorkspaces(workspaces)
      })
      .catch(() => {
        if (!sidebarAliveRef.current || requestId !== sidebarDataRequestRef.current) {
          return
        }

        setCollaborationWorkspaces([])
      })
  }, [refreshExecutors, currentWorkspaceId])

  useEffect(() => {
    void loadSidebarData()
  }, [loadSidebarData])

  useEffect(() => {
    const handleWindowFocus = () => {
      void loadSidebarData()
    }

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        void loadSidebarData()
      }
    }

    window.addEventListener('focus', handleWindowFocus)
    document.addEventListener('visibilitychange', handleVisibilityChange)

    return () => {
      window.removeEventListener('focus', handleWindowFocus)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [loadSidebarData])

  useEffect(() => {
    const handleAgentSidebarRefresh = () => {
      void loadSidebarData({ force: true })
    }

    window.addEventListener(AGENT_SIDEBAR_REFRESH_EVENT, handleAgentSidebarRefresh)
    return () => {
      window.removeEventListener(AGENT_SIDEBAR_REFRESH_EVENT, handleAgentSidebarRefresh)
    }
  }, [loadSidebarData])

  const openAgentsPage = (agentId?: string) => {
    if (agentId) {
      setSelectedAgentId(agentId)
      setSidebarSelectedAgentId(agentId)
    }
    void navigate({
      to: '/agents' as never,
      params: {} as never,
      search: { agentId } as never,
    })
    setMobileOpen(false)
  }

  const openAgentCreate = () => {
    setSelectedAgentId('')
    setSidebarSelectedAgentId('')
    void navigate({
      to: '/agents' as never,
      params: {} as never,
      search: { create: String(Date.now()) } as never,
    })
    setMobileOpen(false)
  }

  const handleSelectWorkspace = (workspaceId: string) => {
    const nextWorkspaceId = resolveCollaborationWorkspaceId(collaborationWorkspaces, workspaceId)
    setCurrentWorkspaceId(nextWorkspaceId)
    setStoredCollaborationWorkspaceId(nextWorkspaceId || null)
    void loadSidebarData({ force: true })
  }

  const handleCreateWorkspace = async (name: string) => {
    const response = await api.createCollaborationWorkspace({
      name,
      sourceWorkspaceId: currentWorkspace?.id,
    })
    setCollaborationWorkspaces((current) => [response.workspace, ...current.filter((workspace) => workspace.id !== response.workspace.id)])
    handleSelectWorkspace(response.workspace.id)
    toast.success(response.message || t('workspace.created'))
  }

  const openWorkspaceSettings = () => {
    void navigate({
      to: '/settings' as never,
      params: {} as never,
      search: {
        section: 'workspace',
        checkout: undefined,
        billingRequestId: undefined,
        workspaceId: currentWorkspace?.id || undefined,
        billingDebug: undefined,
      } as never,
    })
    setMobileOpen(false)
  }

  const showExpandedPanel = isMobile || !collapsed

  return (
    <>
      {isMobile && mobileOpen ? (
        <button
          type="button"
          className="fixed inset-0 z-30 bg-black/60 backdrop-blur-sm"
          onClick={() => setMobileOpen(false)}
          aria-label={t("sidebar.closeSidebar")}
        />
      ) : null}
      <aside
        className={cn(
          "wemux-shell-sidebar text-zinc-100",
          isMobile
            ? "fixed inset-y-0 left-0 z-40 flex w-[min(88vw,17.6rem)] max-w-[17.6rem] translate-x-0 border-r border-transparent bg-transparent shadow-2xl shadow-black/40 transition-transform duration-200 ease-out"
            : isMacNative
              ? "relative flex h-full shrink-0 bg-transparent transition-[width] duration-300"
              : "relative flex h-full shrink-0 bg-transparent shadow-none transition-[width] duration-300",
          isResizing && !isMobile && "duration-0",
          !isMobile && (collapsed
            ? isMacNative ? "w-20 min-w-20 max-w-20" : "w-16 min-w-16 max-w-16"
            : "w-[17.6rem] min-w-[17.6rem] max-w-[17.6rem]"),
          isMobile && !mobileOpen && "-translate-x-full"
        )}
        style={
          !isMobile && !collapsed
            ? { width: `${sidebarWidth}px`, minWidth: `${sidebarWidth}px`, maxWidth: `${sidebarWidth}px` }
            : undefined
        }
      >
      <div className="flex w-full pb-[env(safe-area-inset-bottom)] pt-[env(safe-area-inset-top)]">
        {showExpandedPanel ? (
          <div className="flex min-w-0 flex-1 flex-col bg-transparent">
            <div
              data-native-drag-region={isMacNative ? 'deep' : undefined}
              className={cn(
                "flex items-center",
                isMacNative
                  ? "h-10 bg-transparent pl-[72px] pr-2"
                  : isMobile
                    ? "h-10 bg-transparent px-3"
                    : "h-10 bg-transparent px-2",
              )}
            >
              {isMacNative ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  title={t('sidebar.collapseSidebar')}
                  onClick={() => setCollapsed(true)}
                  className="ml-auto h-8 w-8 shrink-0 rounded-lg text-zinc-500 hover:bg-white/[0.08] hover:text-zinc-100"
                >
                  <ChevronLeft size={15} />
                  <span className="sr-only">{t('sidebar.collapseSidebar')}</span>
                </Button>
              ) : (
                <div className="flex w-full items-center gap-1.5">
                  <div className="min-w-0 flex-1">
                    <AppSidebarWorkspaceSwitcher
                      compact={isMobile}
                      currentWorkspace={currentWorkspace}
                      user={user}
                      workspaces={collaborationWorkspaces}
                      onSelectWorkspace={handleSelectWorkspace}
                      onCreateWorkspace={handleCreateWorkspace}
                      onOpenSettings={openWorkspaceSettings}
                    />
                  </div>
                  {!isMobile ? (
                    <>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={requestGlobalSearchOpen}
                        data-testid="sidebar-global-search"
                        title={language === 'zh' ? '搜索全部内容' : 'Search everything'}
                        className="h-8 w-8 shrink-0 rounded-md text-zinc-500 hover:bg-white/[0.08] hover:text-zinc-100"
                      >
                        <Search size={16} />
                        <span className="sr-only">{language === 'zh' ? '搜索' : 'Search'}</span>
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        title={t('sidebar.collapseSidebar')}
                        onClick={() => setCollapsed(true)}
                        className="h-8 w-8 shrink-0 rounded-md text-zinc-500 hover:bg-white/[0.08] hover:text-zinc-100"
                      >
                        <ChevronLeft size={16} />
                        <span className="sr-only">{t('sidebar.collapseSidebar')}</span>
                      </Button>
                    </>
                  ) : null}
                </div>
              )}
            </div>

            {isMacNative ? (
              <div className="flex items-center gap-1.5 px-2 pb-1 pt-1">
                <div className="min-w-0 flex-1">
                  <AppSidebarWorkspaceSwitcher
                    currentWorkspace={currentWorkspace}
                    user={user}
                    workspaces={collaborationWorkspaces}
                    onSelectWorkspace={handleSelectWorkspace}
                    onCreateWorkspace={handleCreateWorkspace}
                    onOpenSettings={openWorkspaceSettings}
                  />
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={requestGlobalSearchOpen}
                  data-testid="sidebar-global-search"
                  title={language === 'zh' ? '搜索全部内容' : 'Search everything'}
                  className="h-8 w-8 shrink-0 rounded-md text-zinc-500 hover:bg-white/[0.08] hover:text-zinc-100"
                >
                  <Search size={16} />
                  <span className="sr-only">{language === 'zh' ? '搜索' : 'Search'}</span>
                </Button>
              </div>
            ) : null}

            <ScrollArea className="flex-1">
              <div className="space-y-5 pb-4 pl-3 pr-2 pt-2">
                <SidebarSection>
                  <Button
                    type="button"
                    onClick={openCreateTaskModal}
                    variant="ghost"
                    className="h-auto w-full justify-start rounded-lg px-3 py-2 text-left text-zinc-300 transition-colors duration-150 hover:bg-white/[0.06] hover:text-zinc-100"
                  >
                    <Plus size={16} className="mt-0.5" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{t('sidebar.newTask')}</span>
                    </span>
                  </Button>
                  {workItems.map((item) => (
                    <SidebarPanelLink
                      key={getSidebarNavigationItemKey(item)}
                      currentPath={currentPath}
                      icon={item.icon}
                      badgeCount={item.badgeCount}
                      dot={item.dot}
                      isAlpha={item.isAlpha}
                      label={item.label}
                      path={item.path}
                      meta={item.meta}
                      search={item.search}
                      isActiveOverride={item.isActiveOverride}
                      onClick={item.onClick}
                    />
                  ))}
                  {githubItems.length > 0 ? (
                    <div className="mt-2.5 space-y-0.5 border-t border-zinc-900 pt-2.5">
                      <SidebarExpandablePanelButton
                        expanded={githubSectionExpanded}
                        icon={Github}
                        isActive={isGithubSectionActive}
                        label={t('nav.github')}
                        onClick={openGitHubSection}
                      />
                      {githubSectionExpanded ? (
                        <div className="space-y-1 pl-5">
                          {githubItems.map((item) => (
                            <SidebarPanelLink
                              key={getSidebarNavigationItemKey(item, 'github:')}
                              currentPath={currentPath}
                              icon={item.icon}
                              badgeCount={item.badgeCount}
                              isAlpha={item.isAlpha}
                              label={item.label}
                              path={item.path}
                              meta={item.meta}
                              search={item.search}
                              isActiveOverride={item.isActiveOverride}
                              onClick={item.onClick}
                            />
                          ))}
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </SidebarSection>

                <SidebarSection
                  title={t('sidebar.projects')}
                  onAdd={openCreateProjectModal}
                >
                  {visibleProjects.length === 0 ? (
                    <button
                      type="button"
                      onClick={openCreateProjectModal}
                      className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-zinc-800 bg-zinc-950/40 px-3 py-3 text-xs text-zinc-500 transition-colors hover:border-zinc-700 hover:text-zinc-300"
                    >
                      <Plus size={14} />
                      {t('sidebar.newProject')}
                    </button>
                  ) : null}
                  {workspaceScopedProjects.length > 0 ? (
                    <ProjectSidebarSubsection title={t('sidebar.projects.scope.workspace', { defaultValue: language === 'zh' ? '协作区' : 'Workspace' })}>
                      {workspaceScopedProjects.map((project) => {
                        const runtime = getProjectRuntimeSummary({
                          projectId: project.id,
                          tasks: state.tasks,
                          taskWorkspaceBindings: state.taskWorkspaceBindings,
                          workspaceSessions: state.workspaceSessions,
                        })
                        const unreadCount = getProjectWorkspaceUnreadCount({
                          projectId: project.id,
                          tasks: state.tasks,
                          taskWorkspaceBindings: state.taskWorkspaceBindings,
                          workspaceSessions: state.workspaceSessions,
                          unreadOptions: workspaceSessionUnreadState,
                        })
                        const isDragging = draggedProjectItem?.projectId === project.id
                        const showDropPreview = projectDropTarget?.projectId === project.id && draggedProjectItem
                        const dropPreviewHeight = Math.max(draggedProjectItem?.rowHeight ?? 0, 48)

                        return (
                          <div key={project.id} className="space-y-1">
                            {showDropPreview && projectDropTarget.position === 'before' ? (
                              <SidebarDropPreviewSlot
                                height={dropPreviewHeight}
                                label={t('sidebar.dragPreview.project', { defaultValue: '项目将放到这里' })}
                              />
                            ) : null}
                            <div
                              onDragOver={(event) => {
                                if (!draggedProjectItem || draggedProjectItem.projectId === project.id || !workspaceProjectIdSet.has(draggedProjectItem.projectId)) {
                                  return
                                }

                                const nextPosition = resolveSidebarProjectDropPosition(event)
                                const nextOrderedProjectIds = reorderProjectIds(
                                  workspaceScopedProjects.map((item) => item.id),
                                  draggedProjectItem.projectId,
                                  project.id,
                                  nextPosition,
                                )
                                if (!nextOrderedProjectIds) {
                                  if (projectDropTarget?.projectId === project.id) {
                                    setProjectDropTarget(null)
                                  }
                                  return
                                }

                                event.preventDefault()
                                event.dataTransfer.dropEffect = 'move'
                                setProjectDropTarget((current) => {
                                  if (current?.projectId === project.id && current.position === nextPosition) {
                                    return current
                                  }

                                  return {
                                    projectId: project.id,
                                    position: nextPosition,
                                  }
                                })
                              }}
                              onDrop={(event) => {
                                event.preventDefault()
                                const droppedProjectId = event.dataTransfer.getData('application/x-wemux-project') || draggedProjectItem?.projectId
                                if (!droppedProjectId) {
                                  handleProjectDragEnd()
                                  return
                                }

                                handleProjectDrop(
                                  droppedProjectId,
                                  project.id,
                                  resolveSidebarProjectDropPosition(event),
                                )
                              }}
                              className={cn(
                                "overflow-hidden rounded-lg transition-[height,opacity,margin] duration-200 ease-out",
                                isDragging && "pointer-events-none",
                              )}
                              style={isDragging ? { height: 0, opacity: 0 } : undefined}
                            >
                              <div className="group flex items-center gap-1.5">
                                <ProjectSidebarButton
                                  currentPath={currentPath}
                                  color={getProjectColor(project)}
                                  isSelected={project.id === selectedProjectId}
                                  label={project.name}
                                  project={project}
                                  unreadCount={unreadCount}
                                  runtime={runtime}
                                  draggable={workspaceScopedProjects.length > 1}
                                  onDragStart={(event) => {
                                    event.dataTransfer.effectAllowed = 'move'
                                    event.dataTransfer.setData('application/x-wemux-project', project.id)
                                    event.dataTransfer.setData('text/plain', project.id)
                                    requestAnimationFrame(() => {
                                      setDraggedProjectItem({
                                        projectId: project.id,
                                        rowHeight: event.currentTarget.getBoundingClientRect().height,
                                      })
                                      setProjectDropTarget(null)
                                    })
                                  }}
                                  onDragEnd={handleProjectDragEnd}
                                  onClick={() => handleSelectProject(project.id)}
                                />
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon"
                                  onClick={(event) => {
                                    event.stopPropagation()
                                    handleOpenProjectEdit(project.id)
                                  }}
                                  className="h-8 w-8 shrink-0 rounded-lg text-zinc-500 opacity-0 transition-opacity duration-150 pointer-events-none group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100 focus-visible:pointer-events-auto focus-visible:opacity-100 hover:bg-zinc-900 hover:text-zinc-100"
                                  title={language === 'zh' ? `编辑项目 ${project.name}` : `Edit project ${project.name}`}
                                >
                                  <PencilLine size={14} />
                                  <span className="sr-only">{language === 'zh' ? `编辑项目 ${project.name}` : `Edit project ${project.name}`}</span>
                                </Button>
                              </div>
                            </div>
                            {showDropPreview && projectDropTarget.position === 'after' ? (
                              <SidebarDropPreviewSlot
                                height={dropPreviewHeight}
                                label={t('sidebar.dragPreview.project', { defaultValue: '项目将放到这里' })}
                              />
                            ) : null}
                          </div>
                        )
                      })}
                    </ProjectSidebarSubsection>
                  ) : null}
                  {personalProjects.length > 0 ? (
                    <ProjectSidebarSubsection title={t('sidebar.projects.scope.private', { defaultValue: language === 'zh' ? '私人' : 'Private' })}>
                      {personalProjects.map((project) => {
                        const runtime = getProjectRuntimeSummary({
                          projectId: project.id,
                          tasks: state.tasks,
                          taskWorkspaceBindings: state.taskWorkspaceBindings,
                          workspaceSessions: state.workspaceSessions,
                        })
                        const unreadCount = getProjectWorkspaceUnreadCount({
                          projectId: project.id,
                          tasks: state.tasks,
                          taskWorkspaceBindings: state.taskWorkspaceBindings,
                          workspaceSessions: state.workspaceSessions,
                          unreadOptions: workspaceSessionUnreadState,
                        })
                        const isDragging = draggedProjectItem?.projectId === project.id
                        const showDropPreview = projectDropTarget?.projectId === project.id && draggedProjectItem
                        const dropPreviewHeight = Math.max(draggedProjectItem?.rowHeight ?? 0, 48)

                        return (
                          <div key={project.id} className="space-y-1">
                            {showDropPreview && projectDropTarget.position === 'before' ? (
                              <SidebarDropPreviewSlot
                                height={dropPreviewHeight}
                                label={t('sidebar.dragPreview.project', { defaultValue: '项目将放到这里' })}
                              />
                            ) : null}
                            <div
                              onDragOver={(event) => {
                                if (!draggedProjectItem || draggedProjectItem.projectId === project.id || !personalProjectIdSet.has(draggedProjectItem.projectId)) {
                                  return
                                }

                                const nextPosition = resolveSidebarProjectDropPosition(event)
                                const nextOrderedProjectIds = reorderProjectIds(
                                  personalProjects.map((item) => item.id),
                                  draggedProjectItem.projectId,
                                  project.id,
                                  nextPosition,
                                )
                                if (!nextOrderedProjectIds) {
                                  if (projectDropTarget?.projectId === project.id) {
                                    setProjectDropTarget(null)
                                  }
                                  return
                                }

                                event.preventDefault()
                                event.dataTransfer.dropEffect = 'move'
                                setProjectDropTarget((current) => {
                                  if (current?.projectId === project.id && current.position === nextPosition) {
                                    return current
                                  }

                                  return {
                                    projectId: project.id,
                                    position: nextPosition,
                                  }
                                })
                              }}
                              onDrop={(event) => {
                                event.preventDefault()
                                const droppedProjectId = event.dataTransfer.getData('application/x-wemux-project') || draggedProjectItem?.projectId
                                if (!droppedProjectId) {
                                  handleProjectDragEnd()
                                  return
                                }

                                handleProjectDrop(
                                  droppedProjectId,
                                  project.id,
                                  resolveSidebarProjectDropPosition(event),
                                )
                              }}
                              className={cn(
                                "overflow-hidden rounded-lg transition-[height,opacity,margin] duration-200 ease-out",
                                isDragging && "pointer-events-none",
                              )}
                              style={isDragging ? { height: 0, opacity: 0 } : undefined}
                            >
                              <div className="group flex items-center gap-1.5">
                                <ProjectSidebarButton
                                  currentPath={currentPath}
                                  color={getProjectColor(project)}
                                  isSelected={project.id === selectedProjectId}
                                  label={project.name}
                                  project={project}
                                  unreadCount={unreadCount}
                                  runtime={runtime}
                                  draggable={personalProjects.length > 1}
                                  onDragStart={(event) => {
                                    event.dataTransfer.effectAllowed = 'move'
                                    event.dataTransfer.setData('application/x-wemux-project', project.id)
                                    event.dataTransfer.setData('text/plain', project.id)
                                    requestAnimationFrame(() => {
                                      setDraggedProjectItem({
                                        projectId: project.id,
                                        rowHeight: event.currentTarget.getBoundingClientRect().height,
                                      })
                                      setProjectDropTarget(null)
                                    })
                                  }}
                                  onDragEnd={handleProjectDragEnd}
                                  onClick={() => handleSelectProject(project.id)}
                                />
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon"
                                  onClick={(event) => {
                                    event.stopPropagation()
                                    handleOpenProjectEdit(project.id)
                                  }}
                                  className="h-8 w-8 shrink-0 rounded-lg text-zinc-500 opacity-0 transition-opacity duration-150 pointer-events-none group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100 focus-visible:pointer-events-auto focus-visible:opacity-100 hover:bg-zinc-900 hover:text-zinc-100"
                                  title={language === 'zh' ? `编辑项目 ${project.name}` : `Edit project ${project.name}`}
                                >
                                  <PencilLine size={14} />
                                  <span className="sr-only">{language === 'zh' ? `编辑项目 ${project.name}` : `Edit project ${project.name}`}</span>
                                </Button>
                              </div>
                            </div>
                            {showDropPreview && projectDropTarget.position === 'after' ? (
                              <SidebarDropPreviewSlot
                                height={dropPreviewHeight}
                                label={t('sidebar.dragPreview.project', { defaultValue: '项目将放到这里' })}
                              />
                            ) : null}
                          </div>
                        )
                      })}
                    </ProjectSidebarSubsection>
                  ) : null}
                  {sharedWithMeProjects.length > 0 ? (
                    <ProjectSidebarSubsection title={t('sidebar.projects.scope.sharedWithMe', { defaultValue: language === 'zh' ? '共享给我' : 'Shared with me' })}>
                      {sharedWithMeProjects.map((project) => {
                        const runtime = getProjectRuntimeSummary({
                          projectId: project.id,
                          tasks: state.tasks,
                          taskWorkspaceBindings: state.taskWorkspaceBindings,
                          workspaceSessions: state.workspaceSessions,
                        })
                        const unreadCount = getProjectWorkspaceUnreadCount({
                          projectId: project.id,
                          tasks: state.tasks,
                          taskWorkspaceBindings: state.taskWorkspaceBindings,
                          workspaceSessions: state.workspaceSessions,
                          unreadOptions: workspaceSessionUnreadState,
                        })

                        return (
                          <div key={project.id} className="group flex items-center gap-1.5">
                            <ProjectSidebarButton
                              currentPath={currentPath}
                              color={getProjectColor(project)}
                              isSelected={project.id === selectedProjectId}
                              label={project.name}
                              project={project}
                              unreadCount={unreadCount}
                              runtime={runtime}
                              onClick={() => handleSelectProject(project.id)}
                            />
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              onClick={(event) => {
                                event.stopPropagation()
                                handleOpenProjectEdit(project.id)
                              }}
                              className="h-8 w-8 shrink-0 rounded-lg text-zinc-500 opacity-0 transition-opacity duration-150 pointer-events-none group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100 focus-visible:pointer-events-auto focus-visible:opacity-100 hover:bg-zinc-900 hover:text-zinc-100"
                              title={language === 'zh' ? `查看项目 ${project.name}` : `View project ${project.name}`}
                            >
                              <PencilLine size={14} />
                              <span className="sr-only">{language === 'zh' ? `查看项目 ${project.name}` : `View project ${project.name}`}</span>
                            </Button>
                          </div>
                        )
                      })}
                    </ProjectSidebarSubsection>
                  ) : null}
                </SidebarSection>

                <SidebarSection
                  title={t('nav.agents')}
                  isAlpha
                  onAdd={openAgentCreate}
                >
                  {agents.length > 0 ? (
                    <AgentSidebarGroups
                      agents={agents}
                      currentPath={currentPath}
                      executors={executors}
                      language={language}
                      selectedAgentId={isInboxActive ? '' : selectedAgentId}
                      onSelectAgent={openAgentsPage}
                      t={t}
                    />
                  ) : agentsLoading ? (
                    <div className="space-y-2 rounded-lg border border-zinc-900/70 bg-zinc-950/30 px-3 py-3">
                      <div className="h-8 animate-pulse rounded-md bg-zinc-900/80" />
                      <div className="h-8 animate-pulse rounded-md bg-zinc-900/60" />
                    </div>
                  ) : (
                    <div className="rounded-xl border border-dashed border-zinc-800 bg-zinc-950/40 px-3 py-3 text-xs text-zinc-500">
                      {t('sidebar.noAgents')}
                    </div>
                  )}
                </SidebarSection>

                <section className="space-y-0.5 px-3">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-zinc-500">
                    {t('sidebar.system')}
                  </p>
                  <SidebarPanelLink
                    currentPath={currentPath}
                    icon={Workflow}
                    label={t('nav.workstationManagement')}
                    path="/execution"
                    meta={systemItems[0]?.meta}
                    reserveMetaSpace
                  />
                  <SidebarPanelLink
                    currentPath={currentPath}
                    icon={BarChart3}
                    label={t('nav.overview')}
                    path="/overview"
                  />
                  <SidebarPanelLink
                    currentPath={currentPath}
                    icon={PieChart}
                    label={t('nav.usage')}
                    path="/usage"
                  />
                  <SidebarPanelLink
                    currentPath={currentPath}
                    icon={Cpu}
                    label={t('nav.models')}
                    path="/models"
                  />
                  <SidebarPanelLink
                    currentPath={currentPath}
                    icon={Bot}
                    label={t('nav.skills')}
                    path="/skills"
                    isAlpha
                  />
                  <SidebarPanelLink
                    currentPath={currentPath}
                    icon={Plug}
                    label={t('nav.integrations')}
                    path="/integrations"
                  />
                  <SidebarPanelLink
                    currentPath={currentPath}
                    icon={Wrench}
                    label={t('nav.mcp')}
                    path="/mcp"
                    isAlpha
                  />
                  <SidebarPanelLink
                    currentPath={currentPath}
                    icon={Settings}
                    label={t('nav.settings')}
                    path="/settings"
                  />
                </section>
              </div>
            </ScrollArea>

            <div className="shrink-0 px-3 pb-3">
              <div className="border-t border-white/[0.07]" />
              <div className="flex items-center justify-between gap-2 pt-3">
                <UserMenuPopover
                  user={user ? {
                    id: user.id,
                    name: user.name,
                    avatarUrl: user.avatarUrl,
                    email: user.email,
                    bio: user.bio,
                  } : null}
                  onLogout={() => void logout()}
                  language={language}
                />
                <div className="min-w-0 flex-1 px-2">
                  <p className="truncate text-[13px] font-medium text-zinc-100">{user?.name ?? t('app.guest')}</p>
                  <p className="truncate text-[11px] text-zinc-600">{t('app.consoleVersion', { version: appVersion })}</p>
                </div>
                <SidebarHelpMenu
                  language={language}
                  onJoinCommunity={openCommunityDialog}
                  onLogout={() => void logout()}
                />
              </div>
            </div>
          </div>
        ) : (
          <div className={cn(
            "flex min-w-0 flex-1 flex-col items-center bg-transparent px-2",
            isMacNative ? "pb-3" : "py-3",
          )}>
            {isMacNative ? (
              <div data-native-drag-region="deep" className="h-10 w-full" />
            ) : null}
            <div className={cn(
              "flex flex-col items-center gap-2 border-b border-white/[0.07] pb-3",
              isMacNative && "pt-2",
            )}>
              <AppSidebarWorkspaceSwitcher
                collapsed
                compact={isMobile}
                currentWorkspace={currentWorkspace}
                user={user}
                workspaces={collaborationWorkspaces}
                onSelectWorkspace={handleSelectWorkspace}
                onCreateWorkspace={handleCreateWorkspace}
                onOpenSettings={openWorkspaceSettings}
              />
              <SidebarRailActionButton
                icon={ChevronRight}
                label={t('sidebar.expandSidebar')}
                onClick={() => setCollapsed(false)}
              />
            </div>

            <ScrollArea className="w-full flex-1 py-3">
              <div className="flex flex-col items-center gap-2 pb-4">
                <SidebarRailActionButton
                  icon={Plus}
                  label={t('sidebar.newTask')}
                  onClick={openCreateTaskModal}
                />
                <Separator className="my-1 w-6 bg-white/[0.07]" />
                {workItems.map((item) => (
                  <SidebarRailLink
                    key={getSidebarNavigationItemKey(item, 'rail:')}
                    badgeCount={item.badgeCount}
                    currentPath={currentPath}
                    dot={item.dot}
                    icon={item.icon}
                    isAlpha={item.isAlpha}
                    label={item.label}
                    path={item.path}
                    search={item.search}
                    isActiveOverride={item.isActiveOverride}
                    onClick={item.onClick}
                  />
                ))}
                {githubItems.length > 0 ? (
                  <>
                    <Separator className="my-1 w-6 bg-zinc-900" />
                    <SidebarRailLink
                      key="rail-github"
                      currentPath={currentPath}
                      icon={Github}
                      label={t('nav.github')}
                      path="/review"
                      isActiveOverride={isGithubSectionActive}
                      onClick={openGitHubSection}
                    />
                  </>
                ) : null}
                <Separator className="my-1 w-6 bg-zinc-900" />
                {systemItems.map((item) => (
                  <SidebarRailLink
                    key={`rail:${item.path}`}
                    currentPath={currentPath}
                    icon={item.icon}
                    isAlpha={item.isAlpha}
                    label={item.label}
                    path={item.path}
                  />
                ))}
              </div>
            </ScrollArea>

            <div className="flex flex-col items-center gap-1 border-t border-zinc-900 pt-2">
              <SidebarRailActionButton
                icon={Search}
                label={language === 'zh' ? '搜索' : 'Search'}
                onClick={requestGlobalSearchOpen}
              />
              <UserMenuPopover
                user={user ? {
                  id: user.id,
                  name: user.name,
                  avatarUrl: user.avatarUrl,
                  email: user.email,
                  bio: user.bio,
                } : null}
                onLogout={() => void logout()}
                language={language}
              />
              <SidebarHelpMenu
                language={language}
                onJoinCommunity={openCommunityDialog}
                onLogout={() => void logout()}
              />
            </div>
          </div>
        )}
      </div>
      {!collapsed && !isMobile ? (
        <div
          role="separator"
          aria-label={t('sidebar.adjustSidebarWidth')}
          aria-orientation="vertical"
          onPointerDown={handleResizeStart}
          className={cn(
            "absolute inset-y-0 right-0 z-10 w-3 translate-x-1/2 cursor-col-resize bg-transparent"
          )}
        />
      ) : null}
    </aside>
    {createModalOpen ? (
      <Suspense fallback={null}>
        <CreateProjectModal
          open={createModalOpen}
          onOpenChange={setCreateModalOpen}
          mode={createMode}
          defaultWorkspaceId={currentWorkspace?.id}
          workspaces={collaborationWorkspaces}
        />
      </Suspense>
    ) : null}
    {projectEditOpen ? (
      <Suspense fallback={null}>
        <ProjectEditDialog
          open={projectEditOpen}
          onOpenChange={handleProjectEditOpenChange}
          draft={projectDraft}
          onDraftChange={setProjectDraft}
          project={editingProject}
          workspaceRoot={state.config.workspaceRoot}
          executors={executors}
          busy={busy}
          reimportBusy={projectReimportBusy}
          onReimportEnvironmentTemplate={handleReimportProjectEnvironmentTemplate}
          onSubmit={handleSubmitProjectEdit}
          onDelete={handleDeleteProject}
        />
      </Suspense>
    ) : null}
    <CommunityJoinDialog
      language={language}
      open={communityDialogOpen}
      onOpenChange={setCommunityDialogOpen}
    />
    </>
  )
}
