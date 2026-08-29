/**
 * 桌面端真实外壳预览
 *
 * 桌面客户端（Electron）＝ 同一个网页控制台套一层原生玻璃壳：
 * 透明窗口 + macOS acrylic 侧边栏 vibrancy + 红绿灯 overlay，加载的就是 /chat。
 *
 * 这里把真实外壳的 DOM 结构与毛玻璃参数原样搬进落地页预览，并尽量复用真实组件：
 * - 外壳：wemux-desktop-shell / wemux-desktop-frame / wemux-shell-sidebar /
 *   wemux-shell-header / wemux-app-content + --wemux-glass-* 变量
 * - 顶栏标签：真实 PageTabsBar（预览模式：不导航、不写 store，由父组件提供标签）
 * - 侧栏导航：每个按钮可点击，打开对应页面预览（动态开标签，像真实桌面端一样）
 * - 页面内容：复用已有的静态页面视图（ProductPreviewSurface）+ 真实三栏聊天
 *   （react-resizable-panels）+ 真实设置页（MenuPanel / GlassRangeSetting）
 * - 侧栏本体：复用真实 i18n 文案与 lucide 图标，按真实 AppSidebar 的结构静态复刻
 *   （真实 AppSidebar 依赖登录态 + 15+ 个数据 hook，匿名落地页无法安全挂载）
 */

import { useEffect, useState } from 'react'
import type { CSSProperties } from 'react'
import {
  BarChart3,
  Bot,
  ChevronLeft,
  ChevronRight,
  ChevronsUpDown,
  Cloud,
  Clock3,
  Cpu,
  Github,
  Inbox,
  LayoutDashboard,
  LayoutGrid,
  MessageCircle,
  PieChart,
  Plug,
  Plus,
  Radio,
  Search,
  Wrench,
  Workflow,
} from 'lucide-react'
import { Group, Panel, Separator } from 'react-resizable-panels'
import type { Language } from '../../lib/i18n'
import { useTranslation } from '../../lib/i18n/react'
import { PageTabsBar } from '../page-tabs-bar'
import type { PageTab } from '../../lib/page-tabs-store'
import { ChatComposer } from '../chat/chat-composer'
import { Avatar, AvatarFallback, AvatarImage } from '../ui/avatar'
import { Button } from '../ui/button'
import { LandingAgentAvatar, LANDING_AGENT_AVATARS } from './landing-agent-avatar'
import { RealSettingsAppearancePreview } from './landing-real-product-preview'
import { ProductPreviewSurface } from './landing-product-preview-views'
import type { PreviewViewId } from './landing-product-preview-data'

/** 桌面端默认毛玻璃参数（与 theme-provider 的默认用户设置一致）。 */
const glassVars = {
  '--wemux-glass-opacity': '20%',
  '--wemux-glass-blur': '28px',
  '--wemux-glass-saturation': '109%',
  '--wemux-glass-border-opacity': '14%',
} as CSSProperties

/** 模拟团队成员的人像头像（3D Q 版潮玩风独立生成，透明底，与 Agent 像素资产区分）。 */
const MEMBER_AVATARS = {
  owner: '/agents/avatars/human-owner.png',
  lead: '/agents/avatars/human-lead.png',
  designer: '/agents/avatars/human-designer.png',
} as const

function SectionLabel({ label }: { label: string }) {
  return <p className="px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-zinc-600">{label}</p>
}

function MemberAvatar({ name, src, size = 'size-6' }: { name: string; src: string; size?: string }) {
  return (
    <Avatar className={`${size} rounded-full border border-zinc-800 bg-zinc-900`}>
      <AvatarImage alt="" src={src} />
      <AvatarFallback className="rounded-full bg-zinc-700 text-[9px] font-bold text-zinc-100">{name.slice(0, 2).toUpperCase()}</AvatarFallback>
    </Avatar>
  )
}

/** 预览可打开的视图：真实页面视图 + 暂无内容的占位视图。 */
export type ShellViewId = PreviewViewId | 'agents' | 'comments' | 'automations' | 'inbox' | 'usage' | 'integrations'

const PLACEHOLDER_VIEWS = new Set<ShellViewId>(['comments', 'automations', 'inbox', 'usage', 'integrations'])

type ViewSpec = { pathname: string; zh: string; en: string }

const viewSpecs: Record<ShellViewId, ViewSpec> = {
  chat: { pathname: '/chat', zh: '会话', en: 'Chat' },
  comments: { pathname: '/comments', zh: 'Comments', en: 'Comments' },
  agents: { pathname: '/agents', zh: 'Agents', en: 'Agents' },
  settings: { pathname: '/settings', zh: '设置', en: 'Settings' },
  dashboard: { pathname: '/dashboard', zh: '仪表盘', en: 'Dashboard' },
  'new-task': { pathname: '/tasks/new', zh: '新建任务', en: 'New Task' },
  projects: { pathname: '/kanban', zh: '项目看板', en: 'Kanban' },
  workspaces: { pathname: '/workspaces', zh: '工作区', en: 'Workspaces' },
  drive: { pathname: '/drive', zh: '云盘 Drive', en: 'Drive' },
  docs: { pathname: '/docs', zh: '文档', en: 'Docs' },
  teams: { pathname: '/overview', zh: '组织概览', en: 'Overview' },
  execution: { pathname: '/execution', zh: '节点管理', en: 'Executors' },
  models: { pathname: '/models', zh: '模型库', en: 'Models' },
  skills: { pathname: '/skills', zh: 'Skills', en: 'Skills' },
  mcp: { pathname: '/mcp', zh: 'MCP', en: 'MCP' },
  automations: { pathname: '/automations', zh: '自动化', en: 'Automation' },
  inbox: { pathname: '/inbox', zh: '收件箱', en: 'Inbox' },
  usage: { pathname: '/usage', zh: '用量统计', en: 'Usage' },
  integrations: { pathname: '/integrations', zh: '集成', en: 'Integrations' },
  'project-product': { pathname: '/kanban?projectId=wemux-console', zh: 'Wemux Console', en: 'Wemux Console' },
  'project-docs': { pathname: '/kanban?projectId=docs', zh: 'Wemux Docs', en: 'Wemux Docs' },
  'project-growth': { pathname: '/kanban?projectId=growth', zh: 'Community Operations', en: 'Community Operations' },
  'agent-developer': { pathname: '/agents', zh: 'Developer Agent', en: 'Developer Agent' },
  'agent-tester': { pathname: '/agents', zh: 'Tester Agent', en: 'Tester Agent' },
  'agent-reviewer': { pathname: '/agents', zh: 'Reviewer Agent', en: 'Reviewer Agent' },
}

/** 初始打开的标签（像桌面端已经打开过的页面）。 */
const initialTabIds: ShellViewId[] = ['chat', 'comments', 'agents', 'dashboard']

const buildInitialTabs = (language: Language): PageTab[] => {
  const now = Date.now()
  return initialTabIds.map((id, index) => {
    const spec = viewSpecs[id]
    return {
      id,
      scope: 'main',
      pathname: spec.pathname,
      href: spec.pathname,
      title: language === 'zh' ? spec.zh : spec.en,
      openedAt: now - index,
      lastActiveAt: now - index,
    }
  })
}

/**
 * 真实产品预览外壳：结构与桌面端 __root.tsx + SidebarProvider 一致。
 *
 * `previewView` / `onPreviewViewChange` 是可选的双向联动：
 * - 父级（落地页 hero tab）传入 `previewView` 控制当前视图；
 * - 外壳内部导航（侧栏 / 顶栏标签）通过 `onPreviewViewChange` 回传给父级。
 * 不传时保持原样，仅由外壳内部状态驱动。
 */
export function RealProductShell({
  language,
  onPreviewViewChange,
  previewView,
}: {
  language: Language
  onPreviewViewChange?: (view: ShellViewId) => void
  previewView?: ShellViewId
}) {
  const { t } = useTranslation()
  const [tabs, setTabs] = useState<PageTab[]>(() => buildInitialTabs(language))
  const [localView, setLocalView] = useState<ShellViewId>('chat')

  /** 外壳只有一份 Agents 页面视图：agent-developer 与 agents 渲染同一内容，归一避免重复开标签。 */
  const normalizeShellView = (view: ShellViewId): ShellViewId => (view === 'agent-developer' ? 'agents' : view)
  const activeView = previewView ? normalizeShellView(previewView) : localView

  /** 设置当前视图：更新本地状态，并把变更同步给父级（落地页 hero tab）。 */
  const setActiveView = (view: ShellViewId) => {
    setLocalView(view)
    onPreviewViewChange?.(view)
  }

  /** 外部（hero tab）切换视图时，像真实桌面端一样在顶栏打开对应页面标签。 */
  useEffect(() => {
    if (!previewView) {
      return
    }
    const view = normalizeShellView(previewView)
    setTabs((current) => {
      if (current.some((tab) => tab.id === view)) {
        return current
      }
      const spec = viewSpecs[view]
      if (!spec) {
        return current
      }
      const now = Date.now()
      return [...current, {
        id: view,
        scope: 'main',
        pathname: spec.pathname,
        href: spec.pathname,
        title: language === 'zh' ? spec.zh : spec.en,
        openedAt: now,
        lastActiveAt: now,
      }]
    })
  }, [language, previewView])

  /** 侧栏导航点击：像真实桌面端一样打开/激活对应页面标签。 */
  const navigateTo = (view: ShellViewId) => {
    setTabs((current) => {
      if (current.some((tab) => tab.id === view)) {
        return current
      }
      const spec = viewSpecs[view]
      if (!spec) {
        return current
      }
      const now = Date.now()
      return [...current, {
        id: view,
        scope: 'main',
        pathname: spec.pathname,
        href: spec.pathname,
        title: language === 'zh' ? spec.zh : spec.en,
        openedAt: now,
        lastActiveAt: now,
      }]
    })
    setActiveView(view)
  }

  const handlePreviewCloseTab = (tab: PageTab) => {
    const remaining = tabs.filter((item) => item.id !== tab.id)
    setTabs(remaining)
    if (activeView === tab.id) {
      setActiveView((remaining[0]?.id ?? activeView) as ShellViewId)
    }
  }

  return (
    <div
      className="wemux-desktop-shell wemux-shell-web relative flex h-full min-h-[700px] w-full flex-col text-zinc-100"
      style={{ ...glassVars, backgroundColor: 'transparent' }}
    >
      {/* macOS 红绿灯：随外壳一起缩放（对齐 Electron main.mjs 的 trafficLightPosition x=16 y=20） */}
      <div className="absolute left-4 top-[13.5px] z-50 flex items-center gap-[9px]">
        <div className="h-[13px] w-[13px] rounded-full bg-[#ff5f57] shadow-[0_0.5px_1px_rgba(0,0,0,0.3),inset_0_0.5px_0_rgba(255,255,255,0.2)]" />
        <div className="h-[13px] w-[13px] rounded-full bg-[#febc2e] shadow-[0_0.5px_1px_rgba(0,0,0,0.3),inset_0_0.5px_0_rgba(255,255,255,0.2)]" />
        <div className="h-[13px] w-[13px] rounded-full bg-[#28c840] shadow-[0_0.5px_1px_rgba(0,0,0,0.3),inset_0_0.5px_0_rgba(255,255,255,0.2)]" />
      </div>

      <div className="wemux-desktop-frame flex min-h-0 min-w-0 flex-1 overflow-hidden">
        {/* 左侧主侧栏（真实 AppSidebar 结构的静态复刻） */}
        <DesktopSidebar activeView={activeView} onNavigate={navigateTo} />

        {/* 右侧应用框架 */}
        <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
          <div className="wemux-app-frame flex h-full min-h-0 w-full flex-col text-zinc-100">
            {/* 顶栏：真实 SiteHeader（wemux-shell-header）+ 真实 PageTabsBar（px-2 与真实头部一致，避免首个标签贴住侧栏） */}
            <header className="wemux-shell-header sticky top-0 z-20 border-b border-transparent bg-transparent">
              <div className="flex h-10 items-center gap-2 px-2">
                <PageTabsBar
                  title=""
                  previewMode
                  previewTabs={tabs}
                  previewActiveTabId={activeView}
                  onPreviewSelectTab={(tab) => setActiveView(tab.id as ShellViewId)}
                  onPreviewCloseTab={handlePreviewCloseTab}
                />
              </div>
            </header>

            {/* 内容容器：与真实 wemux-app-content 一致 */}
            <div className="wemux-app-content flex flex-1 min-h-0 flex-col overflow-hidden">
              <div className="flex flex-1 min-h-0 flex-col overflow-auto">
                {renderActiveView(activeView, language)}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

/** 按当前视图渲染对应页面内容。 */
function renderActiveView(view: ShellViewId, language: Language) {
  // 聊天：真实 react-resizable-panels 三栏布局
  if (view === 'chat') {
    return <DesktopChatPreview language={language} />
  }
  // 设置：真实 MenuPanel / GlassRangeSetting 组件
  if (view === 'settings') {
    return <RealSettingsAppearancePreview language={language} />
  }
  // Agents 标签 → Developer Agent 档案页
  if (view === 'agents') {
    return <ProductPreviewSurface activeView="agent-developer" boardPreview={null} language={language} />
  }
  // 暂无内容的页面：占位
  if (PLACEHOLDER_VIEWS.has(view)) {
    return (
      <div className="flex flex-1 items-center justify-center p-8 text-sm text-zinc-500">
        {language === 'zh'
          ? '该页面暂未在预览中展示，后续会继续补齐。'
          : 'This page is not part of the preview yet.'}
      </div>
    )
  }
  // 其余页面：复用现有静态页面视图
  return <ProductPreviewSurface activeView={view as PreviewViewId} boardPreview={null} language={language} />
}

/**
 * 左侧主侧栏：按真实 AppSidebar 的结构静态复刻，导航按钮可点击并打开对应页面。
 */
function DesktopSidebar({
  activeView,
  onNavigate,
}: {
  activeView: ShellViewId
  onNavigate: (view: ShellViewId) => void
}) {
  const { t, language } = useTranslation()
  const localize = (zh: string, en: string) => (language === 'zh' ? zh : en)
  const isActive = (view: ShellViewId) =>
    activeView === view ||
    (view === 'agent-developer' && activeView === 'agents') ||
    (view === 'agents' && activeView === 'agent-developer')

  const workItems: Array<{ view: ShellViewId; icon: typeof LayoutDashboard; label: string }> = [
    { view: 'dashboard', icon: LayoutDashboard, label: t('nav.dashboard') },
    { view: 'workspaces', icon: LayoutGrid, label: t('nav.workspaces') },
    { view: 'drive', icon: Cloud, label: t('nav.drive') },
    { view: 'automations', icon: Clock3, label: t('nav.automations') },
    { view: 'chat', icon: MessageCircle, label: t('nav.projectManagerAgent') },
    { view: 'inbox', icon: Inbox, label: t('nav.inbox') },
  ]

  const systemItems: Array<{ view: ShellViewId; icon: typeof LayoutDashboard; label: string; meta?: string; isAlpha?: boolean }> = [
    { view: 'execution', icon: Workflow, label: t('nav.workstationManagement'), meta: localize('1 在线 · 2 节点', '1 online · 2 workers') },
    { view: 'teams', icon: BarChart3, label: t('nav.overview') },
    { view: 'usage', icon: PieChart, label: t('nav.usage') },
    { view: 'models', icon: Cpu, label: t('nav.models') },
    { view: 'skills', icon: Bot, label: t('nav.skills'), isAlpha: true },
    { view: 'integrations', icon: Plug, label: t('nav.integrations') },
    { view: 'mcp', icon: Wrench, label: t('nav.mcp'), isAlpha: true },
  ]

  return (
    <aside className="wemux-shell-sidebar flex w-[260px] shrink-0 flex-col border-r border-white/[0.08]">
      {/* 第一行：macOS 红绿灯区（pl-[72px]，与真实 isMacNative 头部一致）+ 折叠按钮 */}
      <div className="flex h-10 items-center bg-transparent pl-[72px] pr-2">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          title={t('sidebar.collapseSidebar')}
          className="ml-auto h-8 w-8 shrink-0 rounded-md text-zinc-500 hover:bg-white/[0.08] hover:text-zinc-100"
        >
          <ChevronLeft size={16} />
        </Button>
      </div>

      {/* 第二行：工作区切换器 + 搜索，与真实 isMacNative 的第二行一致 */}
      <div className="flex items-center gap-1.5 px-2 pb-1 pt-1">
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2 rounded-lg px-1.5 py-1 transition-colors duration-150 hover:bg-white/[0.04]">
            <img src="/logo.svg" alt="" className="h-7 w-7 shrink-0" />
            <div className="min-w-0">
              <p className="truncate text-[13px] font-medium text-zinc-100">Wemux Labs</p>
            </div>
            <ChevronsUpDown className="ml-auto h-3.5 w-3.5 shrink-0 text-zinc-600" />
          </div>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          title={localize('搜索全部内容', 'Search everything')}
          className="h-8 w-8 shrink-0 rounded-md text-zinc-500 hover:bg-white/[0.08] hover:text-zinc-100"
        >
          <Search size={16} />
        </Button>
      </div>

      <div className="scrollbar-subtle flex-1 space-y-5 overflow-y-auto pb-4 pl-3 pr-2 pt-2">
        {/* 工作区导航 */}
        <section className="space-y-1.5">
          <Button
            type="button"
            variant="ghost"
            onClick={() => onNavigate('new-task')}
            className="h-auto w-full justify-start rounded-lg px-3 py-2 text-left text-zinc-300 transition-colors duration-150 hover:bg-white/[0.06] hover:text-zinc-100"
          >
            <Plus size={16} className="mt-0.5" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium">{t('sidebar.newTask')}</span>
            </span>
          </Button>
          {workItems.map((item) => (
            <SidebarPanelLink
              key={item.view}
              icon={item.icon}
              label={item.label}
              active={isActive(item.view)}
              onClick={() => onNavigate(item.view)}
            />
          ))}
          <div className="mt-2.5 space-y-0.5 border-t border-zinc-900 pt-2.5">
            <button
              type="button"
              className="group flex w-full items-center gap-3 rounded-lg px-3 py-1.5 text-left text-zinc-400 transition-colors duration-150 hover:bg-white/[0.06] hover:text-zinc-100"
            >
              <Github size={16} className="mt-0.5" />
              <span className="flex-1 truncate text-sm font-medium">{t('nav.github')}</span>
              <ChevronRight size={14} className="shrink-0 text-zinc-600" />
            </button>
          </div>
        </section>

        {/* 项目 */}
        <section className="space-y-1.5">
          <div className="flex items-center justify-between px-3">
            <span className="text-[10px] font-semibold uppercase tracking-[0.24em] text-zinc-500">
              {t('sidebar.projects')}
            </span>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              title={t('sidebar.addProject')}
              onClick={() => onNavigate('projects')}
              className="h-6 w-6 rounded-md text-zinc-500 hover:bg-zinc-900 hover:text-zinc-100"
            >
              <Plus size={13} />
            </Button>
          </div>
          <div className="space-y-0.5">
            <div className="space-y-1">
              <div className="px-3">
                <span className="text-[10px] font-medium tracking-[0.08em] text-zinc-600">
                  {t('sidebar.projects.scope.workspace', { defaultValue: localize('协作区', 'Workspace') })}
                </span>
              </div>
              <div className="space-y-0.5">
                <ProjectRow name="Wemux Console" color="#34d399" onClick={() => onNavigate('projects')} />
              </div>
            </div>
          </div>
        </section>

        {/* Agents */}
        <section className="space-y-1.5">
          <div className="flex items-center justify-between px-3">
            <div className="flex min-w-0 items-center gap-2">
              <span className="text-[10px] font-semibold uppercase tracking-[0.24em] text-zinc-500">
                {t('nav.agents')}
              </span>
              <span className="shrink-0 rounded border border-amber-400/25 bg-amber-400/10 px-1.5 py-0 text-[9px] font-semibold uppercase leading-4 tracking-[0.18em] text-amber-200">
                {t('sidebar.alphaBadge')}
              </span>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => onNavigate('agent-developer')}
              className="h-6 w-6 rounded-md text-zinc-500 hover:bg-zinc-900 hover:text-zinc-100"
            >
              <Plus size={13} />
            </Button>
          </div>
          <div className="space-y-0.5">
            <div className="space-y-1">
              <div className="px-3">
                <span className="text-[10px] font-medium tracking-[0.08em] text-zinc-600">
                  {t('sidebar.projects.scope.workspace', { defaultValue: localize('协作区', 'Workspace') })}
                </span>
              </div>
              <div className="space-y-0.5">
                <AgentRow avatar="lead" name="Wemux Lead Agent" onClick={() => onNavigate('agent-developer')} />
              </div>
            </div>
          </div>
        </section>

        {/* 系统 */}
        <section className="space-y-0.5 px-3">
          <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-zinc-500">
            {t('sidebar.system')}
          </p>
          {systemItems.map((item) => (
            <SidebarPanelLink
              key={item.view}
              icon={item.icon}
              label={item.label}
              meta={item.meta}
              reserveMetaSpace={Boolean(item.meta)}
              isAlpha={item.isAlpha}
              active={isActive(item.view)}
              onClick={() => onNavigate(item.view)}
            />
          ))}
        </section>
      </div>

      {/* 底部用户信息 */}
      <div className="shrink-0 px-3 pb-3">
        <div className="border-t border-white/[0.07]" />
        <div className="flex items-center justify-between gap-2 pt-3">
          <Avatar className="h-8 w-8 shrink-0 rounded-full border border-zinc-800 bg-zinc-900">
            <AvatarImage alt="" src={MEMBER_AVATARS.owner} />
            <AvatarFallback className="rounded-full bg-gradient-to-br from-blue-500 to-purple-500 text-xs font-bold text-white">
              DE
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0 flex-1 px-2">
            <p className="truncate text-[13px] font-medium text-zinc-100">Project Owner</p>
            <p className="truncate text-[11px] text-zinc-600">v0.3.127</p>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-8 w-8 shrink-0 rounded-lg text-zinc-500 hover:bg-white/[0.08] hover:text-zinc-100"
          >
            <CircleHelpIcon />
          </Button>
        </div>
      </div>
    </aside>
  )
}

/** 与真实 AppSidebar 的 SidebarPanelLink 同构的静态导航行。 */
function SidebarPanelLink({
  icon: Icon,
  label,
  meta,
  reserveMetaSpace = false,
  isAlpha = false,
  active = false,
  onClick,
}: {
  icon: typeof LayoutDashboard
  label: string
  meta?: string
  reserveMetaSpace?: boolean
  isAlpha?: boolean
  active?: boolean
  onClick?: () => void
}) {
  const { t } = useTranslation()
  const shouldRenderMeta = reserveMetaSpace || Boolean(meta)
  return (
    <Button
      type="button"
      variant="ghost"
      onClick={onClick}
      className={`h-auto w-full justify-start rounded-lg px-3 py-2 text-left text-zinc-400 transition-colors duration-150 hover:bg-white/[0.06] hover:text-zinc-100 ${
        active
          ? 'bg-white/[0.1] text-zinc-50 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] hover:bg-white/[0.12]'
          : ''
      }`}
      title={isAlpha ? `${label} · ${t('sidebar.alphaBadge')}` : label}
    >
      <Icon size={16} className="mt-0.5" />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="block truncate text-sm font-medium">{label}</span>
          {isAlpha ? (
            <span className="shrink-0 rounded border border-amber-400/25 bg-amber-400/10 px-1.5 py-0 text-[9px] font-semibold uppercase leading-4 tracking-[0.18em] text-amber-200">
              {t('sidebar.alphaBadge')}
            </span>
          ) : null}
        </span>
        {shouldRenderMeta ? (
          <span className="block min-h-[16px] truncate text-xs text-zinc-500">{meta ?? ''}</span>
        ) : null}
      </span>
    </Button>
  )
}

/** 与真实 ProjectSidebarButton 同构的项目行。 */
function ProjectRow({ name, color, onClick }: { name: string; color: string; onClick: () => void }) {
  return (
    <Button
      type="button"
      variant="ghost"
      onClick={onClick}
      className="h-auto w-full justify-start rounded-lg px-3 py-1.5 text-left text-zinc-400 transition-colors duration-150 hover:bg-white/[0.06] hover:text-zinc-100"
    >
      <span className="mt-0.5 h-3.5 w-3.5 shrink-0 rounded-sm" style={{ backgroundColor: color }} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-medium">{name}</span>
      </span>
    </Button>
  )
}

/** 与真实 SidebarAgentButton 同构的 Agent 行。 */
function AgentRow({ avatar, name, onClick }: { avatar: 'developer' | 'tester' | 'reviewer' | 'lead'; name: string; onClick: () => void }) {
  return (
    <Button
      type="button"
      variant="ghost"
      onClick={onClick}
      className="h-auto w-full justify-start rounded-lg px-3 py-1.5 text-left text-zinc-400 transition-colors duration-150 hover:bg-white/[0.06] hover:text-zinc-100"
    >
      <span className="shrink-0">
        <LandingAgentAvatar avatar={avatar} className="h-8 w-8 rounded-full border border-zinc-800 bg-zinc-900" fallback="WL" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-medium">{name}</span>
        <span className="mt-0.5 flex items-center gap-1.5 text-xs text-zinc-500">
          <Radio className="h-3 w-3 shrink-0 text-emerald-400" />
          <span className="truncate">Wemux 云节点</span>
        </span>
      </span>
    </Button>
  )
}

/**
 * 桌面端主视图：与真实 /chat 相同的 react-resizable-panels 三栏布局
 * （聊天对象 20% / 会话 20% / 主面板 60%），内容为静态复刻。
 */
function DesktopChatPreview({ language }: { language: Language }) {
  return (
    <Group id="preview-chat-columns" orientation="horizontal" className="min-h-0 flex-1">
      <Panel id="previewChatTargets" defaultSize="20%" minSize="220px" maxSize="320px">
        <ChatTargetsColumn language={language} />
      </Panel>
      <PanelSeparator />
      <Panel id="previewChatSessions" defaultSize="20%" minSize="220px" maxSize="340px">
        <ChatSessionsColumn language={language} />
      </Panel>
      <PanelSeparator />
      <Panel id="previewChatDetail" defaultSize="60%" minSize="440px">
        <ChatMainPanel language={language} />
      </Panel>
    </Group>
  )
}

function PanelSeparator() {
  return (
    <Separator className="group relative flex w-1 items-center justify-center px-0 outline-none focus:outline-none focus-visible:outline-none focus-visible:ring-0">
      <div className="h-full w-px bg-zinc-900 transition-colors group-hover:bg-zinc-700 group-focus:bg-zinc-700 group-focus-visible:bg-zinc-700" />
    </Separator>
  )
}

function ChatTargetsColumn({ language }: { language: Language }) {
  return (
    <aside className="min-h-0 border-r border-zinc-800/50">
      <div className="flex h-full flex-col">
        <div className="flex items-center justify-between border-b border-zinc-800/50 px-3 py-2">
          <span className="text-xs font-medium uppercase tracking-[0.2em] text-zinc-500">
            {language === 'zh' ? '聊天对象' : 'Targets'}
          </span>
          <button
            type="button"
            className="flex size-7 items-center justify-center rounded-md text-zinc-500 transition hover:bg-white/[0.04] hover:text-zinc-200"
          >
            <Plus className="h-4 w-4" />
          </button>
        </div>
        <div className="border-b border-zinc-800/50 px-3 py-2">
          <input
            placeholder={language === 'zh' ? '搜索 Agent...' : 'Search agents...'}
            className="w-full rounded-md border border-zinc-800 bg-transparent px-2.5 py-1.5 text-xs text-zinc-300 placeholder:text-zinc-600 focus:border-zinc-600 focus:outline-none"
          />
        </div>
        <div className="scrollbar-subtle flex-1 space-y-1 overflow-y-auto p-2">
          <SectionLabel label={language === 'zh' ? 'Agent' : 'Agents'} />
          <ChatTargetItem
            avatar="developer"
            name="Developer Agent"
            subtitle={language === 'zh' ? '代码、修复、重构与 patch 交付' : 'Code, fixes, refactors, and patch delivery'}
            accent="from-violet-400 via-fuchsia-300 to-sky-400"
          />
          <ChatTargetItem
            avatar="tester"
            name="Tester Agent"
            subtitle={language === 'zh' ? '环境启动、测试与浏览器巡检' : 'Environments, tests, and browser checks'}
            accent="from-emerald-400 via-teal-300 to-cyan-400"
          />
          <ChatTargetItem
            avatar="reviewer"
            name="Reviewer Agent"
            subtitle={language === 'zh' ? 'Diff 审查、风险提示与验证清单' : 'Diff review, risk notes, and checklists'}
            accent="from-amber-400 via-orange-300 to-rose-400"
          />
          <ChatTargetItem
            avatar="lead"
            name="Wemux Lead Agent"
            subtitle={language === 'zh' ? '全局统筹、决策与优先级' : 'Orchestration, decisions, and priorities'}
            accent="from-blue-500 via-indigo-400 to-purple-400"
          />
          <SectionLabel label={language === 'zh' ? '成员' : 'Members'} />
          <ChatTargetItem
            avatarSrc={MEMBER_AVATARS.owner}
            name="Project Owner"
            subtitle={language === 'zh' ? '我 · 创始人与交付' : 'Me · Founder & delivery'}
            accent="from-zinc-200 via-zinc-100 to-white"
          />
          <ChatTargetItem
            avatarSrc={MEMBER_AVATARS.lead}
            name="Tech Lead"
            subtitle={language === 'zh' ? '产品与技术' : 'Product & technology'}
            accent="from-sky-400 via-cyan-300 to-emerald-400"
          />
          <ChatTargetItem
            avatarSrc={MEMBER_AVATARS.designer}
            name="Product Designer"
            subtitle={language === 'zh' ? '产品设计师' : 'Product designer'}
            accent="from-rose-400 via-pink-300 to-fuchsia-400"
          />
          <SectionLabel label={language === 'zh' ? '群聊' : 'Groups'} />
          <ChatTargetItem
            group
            name="Wemux 交付群"
            subtitle={language === 'zh' ? '5 人 · 3 个 Agent 在线' : '5 members · 3 agents online'}
            accent="from-emerald-400 via-teal-300 to-cyan-400"
            active
          />
        </div>
      </div>
    </aside>
  )
}

function ChatTargetItem({
  avatar,
  avatarSrc,
  group = false,
  name,
  subtitle,
  accent,
  active = false,
}: {
  avatar?: 'developer' | 'tester' | 'reviewer' | 'lead'
  avatarSrc?: string
  group?: boolean
  name: string
  subtitle: string
  accent: string
  active?: boolean
}) {
  return (
    <button
      type="button"
      className={`w-full rounded-xl px-3 py-2 text-left transition-colors ${
        active ? 'bg-white/[0.08] text-zinc-100' : 'text-zinc-500 hover:bg-white/[0.04] hover:text-zinc-200'
      }`}
    >
      <div className="flex items-start gap-3">
        <span className="relative shrink-0">
          {group ? (
            <span className="flex -space-x-2">
              <MemberAvatar name="Owner" src={MEMBER_AVATARS.owner} />
              <MemberAvatar name="Lead" src={MEMBER_AVATARS.lead} />
              <MemberAvatar name="Developer" src={LANDING_AGENT_AVATARS.developer} />
            </span>
          ) : avatarSrc ? (
            <Avatar className="size-10 rounded-full border border-zinc-800 bg-zinc-900">
              <AvatarImage alt="" src={avatarSrc} />
              <AvatarFallback className="rounded-full bg-gradient-to-br from-zinc-200 via-zinc-100 to-white text-[10px] font-black text-zinc-950">
                {name.slice(0, 2).toUpperCase()}
              </AvatarFallback>
            </Avatar>
          ) : (
            <LandingAgentAvatar avatar={avatar ?? 'developer'} className="size-10 rounded-full border border-zinc-800 bg-zinc-900" fallback={name.slice(0, 2).toUpperCase()} />
          )}
          <span className="absolute bottom-0 right-0 size-2.5 rounded-full bg-emerald-300 ring-2 ring-zinc-950" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{name}</p>
          <p className="mt-1 line-clamp-2 text-[11px] leading-4 text-zinc-600">{subtitle}</p>
        </div>
      </div>
    </button>
  )
}

function ChatSessionsColumn({ language }: { language: Language }) {
  return (
    <aside className="min-h-0 border-r border-zinc-800/50">
      <div className="flex h-full flex-col">
        <div className="flex items-center justify-between border-b border-zinc-800/50 px-3 py-2">
          <span className="min-w-0 truncate text-xs font-medium text-zinc-400">
            {language === 'zh' ? '会话' : 'Sessions'}
          </span>
          <span className="ml-2 flex shrink-0 items-center gap-1">
            <span className="rounded-full border border-zinc-800 bg-zinc-950 px-2 py-0.5 text-[10px] text-zinc-500">5</span>
            <button
              type="button"
              className="flex size-6 items-center justify-center rounded-md text-zinc-500 transition hover:bg-white/[0.04] hover:text-zinc-300"
            >
              <Plus className="h-3.5 w-3.5" />
            </button>
          </span>
        </div>
        <div className="scrollbar-subtle flex-1 space-y-1 p-1.5">
          <ChatSessionItem
            active
            title={language === 'zh' ? 'Wemux 交付群' : 'Wemux Delivery Group'}
            subtitle={language === 'zh' ? '群聊 · 5 人' : 'Group · 5 members'}
          />
          <ChatSessionItem
            title={language === 'zh' ? '支付退款链路梳理' : 'Payment refund pipeline review'}
            subtitle={language === 'zh' ? '主会话' : 'Main session'}
          />
          <ChatSessionItem
            title={language === 'zh' ? '云盘断点续传调查' : 'Drive resumable upload investigation'}
            subtitle={language === 'zh' ? '昨天' : 'Yesterday'}
          />
          <ChatSessionItem
            title={language === 'zh' ? '移动端毛玻璃适配' : 'Mobile liquid glass adaptation'}
            subtitle={language === 'zh' ? '09:41' : '09:41'}
          />
          <ChatSessionItem
            title={language === 'zh' ? 'Agent 在线状态回归' : 'Agent online status regression'}
            subtitle={language === 'zh' ? '周一' : 'Monday'}
          />
        </div>
      </div>
    </aside>
  )
}

function ChatSessionItem({
  active,
  subtitle,
  title,
}: {
  active?: boolean
  subtitle: string
  title: string
}) {
  return (
    <button
      type="button"
      className={`w-full rounded-lg px-3 py-2 text-left transition-colors ${
        active ? 'bg-white/[0.08] text-zinc-100' : 'text-zinc-500 hover:bg-white/[0.04] hover:text-zinc-200'
      }`}
    >
      <p className="line-clamp-1 text-[13px] font-medium">{title}</p>
      <p className="mt-0.5 text-[11px] text-zinc-600">{subtitle}</p>
    </button>
  )
}

function ChatMainPanel({ language }: { language: Language }) {
  return (
    <section className="flex min-h-0 flex-col">
      {/* 会话头 */}
      <div className="border-b border-zinc-800/50 px-4 py-2.5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="flex -space-x-1.5">
                <MemberAvatar name="Owner" src={MEMBER_AVATARS.owner} />
                <MemberAvatar name="Lead" src={MEMBER_AVATARS.lead} />
                <MemberAvatar name="Developer" src={LANDING_AGENT_AVATARS.developer} />
                <span className="flex size-6 items-center justify-center rounded-full border border-zinc-800 bg-zinc-900 text-[9px] font-semibold text-zinc-400">
                  +2
                </span>
              </span>
              <span className="text-sm font-medium text-zinc-200">{language === 'zh' ? 'Wemux 交付群' : 'Wemux Delivery Group'}</span>
              <span className="rounded-full bg-white/[0.06] px-2 py-0.5 text-[10px] text-zinc-500">
                {language === 'zh' ? '群聊 · 5 人' : 'Group · 5 members'}
              </span>
              <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] text-emerald-300">
                {language === 'zh' ? '3 个 Agent 在线' : '3 agents online'}
              </span>
            </div>
            <p className="mt-2 text-[11px] text-zinc-500">
              {language === 'zh' ? '支付退款链路 · 云盘断点续传 · 发布检查' : 'Payment refund pipeline · Drive resumable upload · Release checks'}
            </p>
          </div>
          <span className="rounded-md border border-zinc-800 px-2 py-1 text-[10px] text-zinc-500">gpt-5.4</span>
        </div>
      </div>

      {/* 消息列表 */}
      <div className="scrollbar-subtle flex-1 overflow-y-auto bg-[radial-gradient(circle_at_top,rgba(39,39,42,0.28),transparent_40%),linear-gradient(180deg,rgba(9,9,11,0.96),rgba(9,9,11,1))] px-4 py-4">
        <div className="mx-auto flex max-w-3xl flex-col gap-3">
          <MessageBubble
            language={language}
            role="me"
            sender="Project Owner"
            accent="from-zinc-200 via-zinc-100 to-white"
            body={language === 'zh'
              ? '把支付退款链路的根因整理成报告，加上最小复现步骤和修复建议，@Developer Agent 今天发出来。'
              : 'Summarize the payment refund pipeline root cause into a report with minimal repro steps and fix suggestions, @Developer Agent deliver today.'}
            meta="09:41"
          />
          <MessageBubble
            language={language}
            role="human"
            sender="Tech Lead"
            avatarSrc={MEMBER_AVATARS.lead}
            accent="from-sky-400 via-cyan-300 to-emerald-400"
            body={language === 'zh'
              ? '同意。另外云盘断点续传的问题也一起排一下，发布前要收敛，别带着已知 bug 上线。'
              : 'Agreed. Also add the drive resumable upload issue to the queue — it needs to be closed before release, no known bugs shipping.'}
            meta="09:42"
          />
          <MessageBubble
            language={language}
            role="agent"
            avatar="developer"
            sender="Wemux Developer Agent"
            accent="from-violet-400 via-fuchsia-300 to-sky-400"
            body={language === 'zh'
              ? '已完成根因梳理：竞态条件 + 缺少幂等键导致回调重复入账。正在补最小复现用例并跑回归。'
              : 'Root cause identified: a race condition plus a missing idempotency key double-posts callbacks. Adding a minimal repro and running regressions.'}
            meta={language === 'zh' ? '09:44 · 正在执行' : '09:44 · Running'}
          />
          <MessageBubble
            language={language}
            role="human"
            sender="Product Designer"
            avatarSrc={MEMBER_AVATARS.designer}
            accent="from-rose-400 via-pink-300 to-fuchsia-400"
            body={language === 'zh'
              ? '用户侧会先看到“退款成功但未到账”，建议在状态页加 pending 提示，文案我这边出。'
              : 'Users will first see “refund succeeded but not arrived” — let‘s add a pending state on the status page, I‘ll draft the copy.'}
            meta="09:45"
          />
          <MessageBubble
            language={language}
            role="agent"
            avatar="reviewer"
            sender="Wemux Reviewer Agent"
            accent="from-amber-300 via-orange-300 to-rose-300"
            body={language === 'zh'
              ? 'Diff 已审查通过，风险集中在回调幂等性；我已经补上发布前的验证清单。'
              : 'The diff is approved. Risk is contained around callback idempotency, and I added the pre-release validation checklist.'}
            meta={language === 'zh' ? '09:52 · 结果已回传' : '09:52 · Results delivered'}
          />
          <MessageBubble
            language={language}
            role="me"
            sender="Project Owner"
            accent="from-zinc-200 via-zinc-100 to-white"
            body={language === 'zh'
              ? '好，我确认后直接发版。@Product Designer 文案随这次一起上，云盘问题留给下一轮。'
              : 'OK, I‘ll confirm and ship. @Product Designer your copy goes out with this release, drive issue stays for the next round.'}
            meta="09:53"
          />
        </div>
      </div>

      {/* 输入区：真实 ChatComposer */}
      <div className="border-t border-zinc-800/50 bg-zinc-950 px-3 py-2">
        <div className="mx-auto max-w-3xl">
          <ChatComposer
            readOnly
            minHeight={72}
            value={language === 'zh'
              ? '好，我确认后直接发版。@Product Designer 文案随这次一起上。'
              : 'OK, I‘ll confirm and ship. @Product Designer your copy goes out with this release.'}
            className="min-h-[72px] px-3 py-2.5 pr-20 text-[13px]"
            shellClassName="pointer-events-auto rounded-2xl border-zinc-800/90 bg-[#08080a] p-2 shadow-[0_18px_48px_rgba(0,0,0,0.46),inset_0_1px_0_rgba(255,255,255,0.03)]"
            inputShellClassName="rounded-xl border-zinc-700/70 bg-[#0c0c0f] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.03),0_8px_26px_rgba(0,0,0,0.32)] focus-within:border-zinc-500/80"
          />
        </div>
      </div>
    </section>
  )
}

function MessageBubble({
  avatar = 'developer',
  language,
  sender,
  accent,
  body,
  meta,
  role,
  avatarSrc,
}: {
  avatar?: 'developer' | 'tester' | 'reviewer' | 'lead'
  language: Language
  sender: string
  accent: string
  body: string
  meta: string
  role: 'me' | 'human' | 'agent'
  avatarSrc?: string
}) {
  const isMe = role === 'me'
  return (
    <div className={`flex gap-3 ${isMe ? 'justify-end' : 'justify-start'}`}>
      {role === 'agent' && (
        <LandingAgentAvatar avatar={avatar} className="mt-1 size-9 border border-zinc-800 bg-zinc-900" fallback="WD" />
      )}
      {role === 'human' && (
        <Avatar className="mt-1 size-9 border border-zinc-800 bg-zinc-900">
          <AvatarImage alt="" src={avatarSrc} />
          <AvatarFallback className="rounded-full bg-gradient-to-br from-zinc-200 via-zinc-100 to-white text-[10px] font-black text-zinc-950">
            {sender.slice(0, 2).toUpperCase()}
          </AvatarFallback>
        </Avatar>
      )}
      <div className={`max-w-[84%] ${isMe ? 'items-end' : 'items-start'}`}>
        <div
          className={`rounded-2xl border px-4 py-3 shadow-[0_16px_36px_rgba(0,0,0,0.18)] ${
            isMe
              ? 'rounded-tr-sm border-zinc-700 bg-zinc-100 text-zinc-950'
              : 'rounded-tl-sm border-zinc-800 bg-zinc-900 text-zinc-100'
          }`}
        >
          {role !== 'me' && (
            <p className={`mb-1 text-[10px] font-semibold uppercase tracking-[0.18em] ${isMe ? 'text-zinc-600' : 'text-zinc-500'}`}>
              {sender}
            </p>
          )}
          <p className="whitespace-pre-wrap text-sm leading-6">{body}</p>
        </div>
        <p className={`mt-1 text-[11px] text-zinc-600 ${isMe ? 'text-right' : 'text-left'}`}>{meta}</p>
      </div>
    </div>
  )
}

function CircleHelpIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
      <circle cx="12" cy="12" r="10" />
      <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
      <path d="M12 17h.01" />
    </svg>
  )
}
