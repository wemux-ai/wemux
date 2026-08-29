import type { ReactNode } from 'react'

import {
  Bot,
  ChevronDown,
  Cpu,
  FileText,
  FolderGit2,
  HardDrive,
  GitBranch,
  ImagePlus,
  Plus,
  Search,
  Send,
  Server,
  Settings2,
  ShieldCheck,
  Sparkles,
} from 'lucide-react'

import { LandingAgentPreview } from './landing-agent-preview'
import { LandingMcpPreview, LandingSkillsPreview } from './landing-skill-mcp-preview'
import { WorkspacesPreview } from './landing-workspace-preview'
import { previewAgents, previewNodes, previewProjects, toneClassNames, type LocalizedText, type PreviewViewId } from './landing-product-preview-data'
import { NodeTopology, ProjectSnapshotStrip, SettingsPreview } from './landing-product-preview-extras'
import {
  AgentBars,
  ChartPanel,
  FormBlock,
  HealthPanel,
  HeroPanel,
  InfoCell,
  ListButton,
  MetricGrid,
  MiniPanel,
  PeopleRow,
  Pill,
  PreviewFrame,
  SearchBox,
  SelectPreview,
  StackPanel,
  TableCard,
  TaskListRow,
  TimelineRow,
  localize,
} from './landing-product-preview-ui'
import { ChatComposer } from '../chat/chat-composer'
import { Avatar, AvatarFallback } from '../ui/avatar'
import { LandingAgentAvatar } from './landing-agent-avatar'
import { Button } from '../ui/button'
import { cn } from '../../lib/utils'
import type { Language } from '../../lib/i18n'

type ChromeCopy = {
  title: LocalizedText
  subtitle: LocalizedText
}

const previewChrome: Record<PreviewViewId, ChromeCopy> = {
  'new-task': {
    title: { zh: '创建任务', en: 'Create Task' },
    subtitle: { zh: '任务表单、Agent、节点和交付方式', en: 'Task form, agent, worker, and return mode' },
  },
  dashboard: {
    title: { zh: '控制台总览', en: 'Dashboard' },
    subtitle: { zh: '所有项目、Agent 与节点状态', en: 'All projects, agents, and workers' },
  },
  projects: {
    title: { zh: '项目管理', en: 'Projects' },
    subtitle: { zh: '项目卡片、仓库来源、节点绑定和共享状态', en: 'Project cards, repos, worker bindings, and sharing' },
  },
  workspaces: {
    title: { zh: '工作区', en: 'Workspaces' },
    subtitle: { zh: '左侧工作区列表，右侧仓库、任务与终端入口', en: 'Workspace list with repo, task, and terminal details' },
  },
  drive: {
    title: { zh: '云盘', en: 'Drive' },
    subtitle: { zh: '团队文件、共享目录和最近上传', en: 'Team files, shared folders, and recent uploads' },
  },
  docs: {
    title: { zh: '文档', en: 'Docs' },
    subtitle: { zh: '知识库、项目文档和协作记录', en: 'Knowledge base, project docs, and collaboration notes' },
  },
  teams: {
    title: { zh: '团队协作', en: 'Teams' },
    subtitle: { zh: '团队列表、成员、项目、节点和动态', en: 'Teams, members, projects, workers, and activity' },
  },
  chat: {
    title: { zh: 'Agent 对话', en: 'Agent Chat' },
    subtitle: { zh: 'Agent 切换、会话列表、聊天记录和输入区', en: 'Agent switcher, sessions, transcript, and composer' },
  },
  'project-product': {
    title: { zh: 'Wemux Console', en: 'Wemux Console' },
    subtitle: { zh: 'github.com/wemux-ai/wemux · main', en: 'github.com/wemux-ai/wemux · main' },
  },
  'project-docs': {
    title: { zh: 'Wemux Docs', en: 'Wemux Docs' },
    subtitle: { zh: 'docs / release notes · content workflow', en: 'docs / release notes · content workflow' },
  },
  'project-growth': {
    title: { zh: 'Community Operations', en: 'Community Operations' },
    subtitle: { zh: 'experiments / feedback · ops workflow', en: 'experiments / feedback · ops workflow' },
  },
  'agent-developer': {
    title: { zh: 'Developer Agent', en: 'Developer Agent' },
    subtitle: { zh: '代码、Bug、重构和 patch 交付', en: 'Code, bugs, refactors, and patches' },
  },
  'agent-tester': {
    title: { zh: 'Tester Agent', en: 'Tester Agent' },
    subtitle: { zh: '环境启动、测试、浏览器巡检和记录', en: 'Environments, tests, browser checks, and records' },
  },
  'agent-reviewer': {
    title: { zh: 'Reviewer Agent', en: 'Reviewer Agent' },
    subtitle: { zh: 'Diff 审查、风险提示和验证清单', en: 'Diff review, risk notes, and validation checklists' },
  },
  execution: {
    title: { zh: '节点管理', en: 'Executors' },
    subtitle: { zh: '在线节点、任务投递、绑定和日志', en: 'Online workers, dispatch, bindings, and logs' },
  },
  models: {
    title: { zh: '模型目录', en: 'Model Catalog' },
    subtitle: { zh: '模型 profile、provider、token 和可见性', en: 'Model profiles, providers, tokens, and visibility' },
  },
  skills: {
    title: { zh: 'Skill 目录', en: 'Skill Library' },
    subtitle: { zh: '左侧 skill 库，右侧文件树和说明文档', en: 'Skill library with file tree and docs preview' },
  },
  mcp: {
    title: { zh: 'MCP Registry', en: 'MCP Registry' },
    subtitle: { zh: 'MCP 列表、连接信息和能力策略', en: 'MCP list, connection info, and capability policy' },
  },
  settings: {
    title: { zh: '系统设置', en: 'Settings' },
    subtitle: { zh: '资料、运行时、Git 身份和通知通道', en: 'Profile, runtime, Git identity, and channels' },
  },
}

export function getPreviewChrome(view: PreviewViewId, language: Language) {
  const chrome = previewChrome[view]
  return {
    title: localize(chrome.title, language),
    subtitle: localize(chrome.subtitle, language),
  }
}

export function ProductPreviewSurface({
  activeView,
  boardPreview,
  language,
}: {
  activeView: PreviewViewId
  boardPreview: ReactNode
  language: Language
}) {
  if (activeView.startsWith('project-')) {
    return <>{boardPreview}</>
  }

  if (activeView === 'dashboard') {
    return <DashboardPreview language={language} />
  }

  if (activeView === 'new-task') {
    return <NewTaskPreview language={language} />
  }

  if (activeView === 'projects') {
    return <ProjectsPreview language={language} />
  }

  if (activeView === 'workspaces') {
    return <WorkspacesPreview language={language} />
  }

  if (activeView === 'drive') {
    return <DrivePreview language={language} />
  }

  if (activeView === 'docs') {
    return <DocsPreview language={language} />
  }

  if (activeView === 'teams') {
    return <TeamsPreview language={language} />
  }

  if (activeView === 'chat') {
    return <ChatPreview language={language} />
  }

  if (activeView.startsWith('agent-')) {
    return <LandingAgentPreview language={language} view={activeView} />
  }

  if (activeView === 'execution') {
    return <ExecutionPreview language={language} />
  }

  if (activeView === 'models') {
    return <ModelsPreview language={language} />
  }

  if (activeView === 'skills') {
    return <LandingSkillsPreview language={language} />
  }

  if (activeView === 'mcp') {
    return <LandingMcpPreview language={language} />
  }

  return <SettingsPreview language={language} />
}

function DashboardPreview({ language }: { language: Language }) {
  return (
    <PreviewFrame>
      <HeroPanel
        badge={{ zh: 'Dashboard', en: 'Dashboard' }}
        title={{ zh: '今天的 Agent 工作状态', en: 'Today in the agent workspace' }}
        description={{ zh: '项目、任务、Agent、节点和待审核项集中在一页，像真实控制台一样先看全局态势。', en: 'Projects, tasks, agents, workers, and reviews are summarized in one operational view.' }}
        language={language}
        action={{ zh: '打开看板', en: 'Open Kanban' }}
      />
      <div className="grid grid-cols-[1.2fr_0.8fr] gap-3">
        <ProjectSnapshotStrip language={language} />
        <MiniPanel title={localize({ zh: '待处理审核', en: 'Pending Approvals' }, language)}>
          <div className="rounded-lg border border-amber-500/20 bg-amber-500/10 p-3">
            <div className="flex items-start gap-2">
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" />
              <div>
                <p className="text-sm font-medium text-amber-50">{localize({ zh: '2 项等待人类确认', en: '2 items need human confirmation' }, language)}</p>
                <p className="mt-1 text-xs leading-5 text-amber-100/70">{localize({ zh: 'Diff、测试记录和风险清单已经同步。', en: 'Diffs, test records, and risk notes are synced.' }, language)}</p>
              </div>
            </div>
          </div>
        </MiniPanel>
      </div>
      <MetricGrid
        metrics={[
          ['5', { zh: '活跃 Agent', en: 'Active Agents' }, 'violet'],
          ['3', { zh: '执行中', en: 'In Progress' }, 'amber'],
          ['74%', { zh: '完成率', en: 'Completion' }, 'emerald'],
          ['2', { zh: '待审核', en: 'Reviews' }, 'sky'],
        ]}
        language={language}
      />
      <div className="grid grid-cols-4 gap-3">
        <ChartPanel title={localize({ zh: '任务更新', en: 'Task Updates' }, language)} tone="sky" />
        <StackPanel language={language} />
        <AgentBars language={language} />
        <HealthPanel language={language} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <MiniPanel title={localize({ zh: '最近活动', en: 'Recent Activity' }, language)}>
          <TimelineRow tone="emerald" time="09:41" title="Developer" value={localize({ zh: '提交登录回调修复', en: 'Submitted auth callback fix' }, language)} />
          <TimelineRow tone="sky" time="09:52" title="Tester" value={localize({ zh: '完成支付流程巡检', en: 'Completed checkout inspection' }, language)} />
          <TimelineRow tone="amber" time="10:06" title="Reviewer" value={localize({ zh: '等待人类确认 Diff', en: 'Waiting for diff approval' }, language)} />
        </MiniPanel>
        <MiniPanel title={localize({ zh: '最近任务', en: 'Recent Tasks' }, language)}>
          <TaskListRow agent="Developer" title={localize({ zh: '修复登录回调 Bug', en: 'Fix auth callback bug' }, language)} tone="emerald" />
          <TaskListRow agent="Researcher" title={localize({ zh: '调研竞品 onboarding', en: 'Research onboarding' }, language)} tone="violet" />
          <TaskListRow agent="Doc Writer" title={localize({ zh: '整理发布说明', en: 'Prepare release notes' }, language)} tone="sky" />
        </MiniPanel>
      </div>
    </PreviewFrame>
  )
}

function NewTaskPreview({ language }: { language: Language }) {
  return (
    <PreviewFrame>
      <div className="mx-auto max-w-4xl rounded-2xl border border-zinc-800 bg-[#09090b] shadow-[0_24px_80px_rgba(0,0,0,0.42)]">
        <div className="border-b border-zinc-800 px-5 py-4">
          <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-zinc-500">{localize({ zh: 'Create Task Modal', en: 'Create Task Modal' }, language)}</p>
          <h2 className="mt-2 text-xl font-semibold text-zinc-50">{localize({ zh: '把需求投递给 Agent', en: 'Dispatch a task to an Agent' }, language)}</h2>
        </div>
        <div className="grid grid-cols-[1.15fr_0.85fr] gap-4 p-5">
          <div className="space-y-3">
            <FormBlock label={localize({ zh: '任务标题', en: 'Task Title' }, language)} value={localize({ zh: '修复登录回调 Bug', en: 'Fix auth callback bug' }, language)} />
            <FormBlock label={localize({ zh: '任务描述', en: 'Description' }, language)} value={localize({ zh: 'OAuth callback 在 Safari 下偶现丢失 state，需要复现、修复并补充测试。', en: 'OAuth callback intermittently loses state in Safari; reproduce, patch, and add tests.' }, language)} tall />
            <FormBlock label={localize({ zh: '验收标准', en: 'Acceptance Criteria' }, language)} value="login regression · callback path · test record" />
          </div>
          <div className="space-y-3">
            <SelectPreview icon={<Bot className="h-4 w-4" />} label="Agent" value="Developer" tone="violet" />
            <SelectPreview icon={<Server className="h-4 w-4" />} label={localize({ zh: '执行节点', en: 'Worker' }, language)} value="MacBook-Pro · online" tone="emerald" />
            <SelectPreview icon={<GitBranch className="h-4 w-4" />} label={localize({ zh: '工作区', en: 'Workspace' }, language)} value="worktree · main" tone="sky" />
            <MiniPanel title={localize({ zh: '交付方式', en: 'Return Mode' }, language)}>
              <div className="grid grid-cols-2 gap-2">
                <Pill tone="emerald">patch</Pill>
                <Pill tone="zinc">summary</Pill>
                <Pill tone="zinc">branch</Pill>
                <Pill tone="zinc">commit</Pill>
              </div>
            </MiniPanel>
          </div>
        </div>
      </div>
    </PreviewFrame>
  )
}

function ProjectsPreview({ language }: { language: Language }) {
  return (
    <PreviewFrame>
      <section className="overflow-hidden rounded-lg border border-zinc-800 bg-[linear-gradient(135deg,rgba(24,24,27,0.98),rgba(9,9,11,0.92))]">
        <div className="flex flex-row items-end justify-between gap-5 p-5">
          <div>
            <p className="text-[10px] uppercase tracking-[0.28em] text-violet-300">Projects</p>
            <h2 className="mt-2 text-2xl font-semibold tracking-tight text-zinc-50">{localize({ zh: '项目管理', en: 'Project Management' }, language)}</h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-400">{localize({ zh: '管理仓库来源、执行节点绑定、团队共享和项目可见性。', en: 'Manage repo sources, worker bindings, team sharing, and project visibility.' }, language)}</p>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <InfoCell label={localize({ zh: '全部项目', en: 'Projects' }, language)} value="3" />
            <InfoCell label={localize({ zh: '节点绑定', en: 'Bound' }, language)} value="3" />
            <InfoCell label={localize({ zh: '可见项目', en: 'Visible' }, language)} value="3" />
          </div>
        </div>
        <div className="flex flex-row items-center justify-between gap-3 border-t border-zinc-800 bg-zinc-950/40 p-4">
          <div className="flex gap-2">
            <button className="inline-flex items-center gap-2 rounded-full bg-zinc-100 px-4 py-2 text-xs font-semibold text-zinc-950" type="button">
              <Plus className="h-3.5 w-3.5" />
              {localize({ zh: '新建项目', en: 'New Project' }, language)}
            </button>
            <button className="rounded-full border border-zinc-800 px-4 py-2 text-xs text-zinc-300" type="button">{localize({ zh: '克隆仓库', en: 'Clone Repo' }, language)}</button>
          </div>
          <SearchBox placeholder={localize({ zh: '搜索项目、仓库或团队…', en: 'Search projects, repos, or teams…' }, language)} />
        </div>
      </section>
      <div className="grid grid-cols-3 gap-3">
        {previewProjects.map((project) => (
          <div key={project.name} className="rounded-xl border border-zinc-800 bg-zinc-950/75 p-4">
            <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.2em] text-zinc-500">
              <span className="h-2 w-2 rounded-full" style={{ backgroundColor: project.color }} />
              {localize({ zh: '项目', en: 'Project' }, language)}
            </div>
            <h3 className="mt-4 truncate text-xl font-semibold text-zinc-50">{project.name}</h3>
            <div className="mt-3 flex flex-wrap gap-1.5">
              <Pill tone="zinc">Git</Pill>
              <Pill tone="emerald">{localize(project.runtime, language)}</Pill>
              <Pill tone="sky">worker</Pill>
            </div>
            <div className="mt-4 rounded-lg border border-zinc-800 bg-[#09090b] p-3">
              <p className="truncate font-mono text-xs text-zinc-500">github.com/wemux/{project.name.toLowerCase().replace(/\s+/g, '-')}</p>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <InfoCell label="Worker" value={project.viewId === 'project-product' ? 'MacBook' : 'Cloud VM'} />
                <InfoCell label="Branch" value="main" />
              </div>
            </div>
          </div>
        ))}
      </div>
    </PreviewFrame>
  )
}

function DrivePreview({ language }: { language: Language }) {
  const folders = [
    { name: localize({ zh: '产品研发', en: 'Product' }, language), count: '18 items', tone: 'violet' as const },
    { name: localize({ zh: '团队共享', en: 'Team shared' }, language), count: '42 items', tone: 'sky' as const },
    { name: localize({ zh: '发布资料', en: 'Releases' }, language), count: '9 items', tone: 'emerald' as const },
  ]
  const files = [
    ['auth-callback.patch', 'Developer Agent', '2 min ago', '1.8 KB'],
    ['safari-regression.md', 'Tester Agent', '18 min ago', '6.4 KB'],
    ['deployment-checklist.pdf', 'Project Owner', 'Yesterday', '1.2 MB'],
    ['brand-assets.zip', 'Team shared', 'Monday', '24.8 MB'],
  ]

  return (
    <PreviewFrame>
      <section className="rounded-xl border border-zinc-800 bg-[linear-gradient(135deg,rgba(24,24,27,0.98),rgba(9,9,11,0.92))] p-5">
        <div className="flex flex-row items-end justify-between gap-5">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-sky-500/20 bg-sky-500/10 px-3 py-1 text-[10px] font-medium uppercase tracking-[0.22em] text-sky-300">
              <HardDrive className="h-3 w-3" />
              {localize({ zh: '共享云盘', en: 'Shared Drive' }, language)}
            </div>
            <h2 className="mt-4 text-2xl font-semibold tracking-tight text-zinc-50">{localize({ zh: '团队文件中心', en: 'Team file center' }, language)}</h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-400">{localize({ zh: '项目资料、Agent 产物和团队资产集中存放，并保留权限与版本上下文。', en: 'Keep project files, agent outputs, and team assets together with permissions and version context.' }, language)}</p>
          </div>
          <button className="inline-flex w-max items-center gap-2 rounded-full bg-zinc-100 px-4 py-2 text-xs font-semibold text-zinc-950" type="button">
            <Plus className="h-3.5 w-3.5" />
            {localize({ zh: '上传文件', en: 'Upload file' }, language)}
          </button>
        </div>
      </section>
      <div className="grid grid-cols-3 gap-3">
        {folders.map((folder) => (
          <div key={folder.name} className="rounded-xl border border-zinc-800 bg-zinc-950/75 p-4">
            <div className="flex items-center justify-between gap-3">
              <span className={`flex h-9 w-9 items-center justify-center rounded-lg border ${toneClassNames[folder.tone].border} ${toneClassNames[folder.tone].bg}`}>
                <FolderGit2 className={`h-4 w-4 ${toneClassNames[folder.tone].text}`} />
              </span>
              <span className="text-[10px] uppercase tracking-[0.18em] text-zinc-600">{folder.count}</span>
            </div>
            <h3 className="mt-4 text-sm font-semibold text-zinc-100">{folder.name}</h3>
            <p className="mt-1 text-xs text-zinc-500">{localize({ zh: '最近同步 · 全员可见', en: 'Synced recently · team visible' }, language)}</p>
          </div>
        ))}
      </div>
      <section className="overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950/75">
        <div className="flex items-center justify-between gap-3 border-b border-zinc-800 px-4 py-3">
          <div className="flex items-center gap-2">
            <FolderGit2 className="h-4 w-4 text-zinc-500" />
            <span className="text-sm font-medium text-zinc-200">{localize({ zh: '最近文件', en: 'Recent files' }, language)}</span>
          </div>
          <SearchBox placeholder={localize({ zh: '搜索文件...', en: 'Search files...' }, language)} />
        </div>
        <div className="divide-y divide-zinc-900">
          {files.map(([name, owner, updated, size]) => (
            <div key={name} className="grid grid-cols-[1.3fr_1fr_0.7fr_0.5fr] items-center gap-3 px-4 py-3 text-xs">
              <div className="flex min-w-0 items-center gap-2.5">
                <FileText className="h-4 w-4 shrink-0 text-sky-300/80" />
                <span className="truncate font-medium text-zinc-200">{name}</span>
              </div>
              <span className="truncate text-zinc-500">{owner}</span>
              <span className="text-zinc-600">{updated}</span>
              <span className="text-right font-mono text-zinc-600">{size}</span>
            </div>
          ))}
        </div>
      </section>
    </PreviewFrame>
  )
}

function DocsPreview({ language }: { language: Language }) {
  const docs = [
    { title: localize({ zh: '产品发布说明', en: 'Product release notes' }, language), meta: 'Wemux Docs · updated 8 min ago', active: true },
    { title: localize({ zh: 'Agent 协作规范', en: 'Agent collaboration guide' }, language), meta: 'Wemux Core · updated yesterday' },
    { title: localize({ zh: '节点接入手册', en: 'Worker setup guide' }, language), meta: 'Platform · updated Monday' },
    { title: localize({ zh: '品牌视觉方向', en: 'Brand visual direction' }, language), meta: 'Design · updated Monday' },
  ]

  return (
    <PreviewFrame>
      <div className="grid min-h-[calc(42rem-3.5rem)] grid-cols-[18rem_1fr] overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950/75">
        <aside className="border-r border-zinc-800 bg-[#080809] p-3">
          <div className="flex items-center justify-between px-2 py-2">
            <div className="flex items-center gap-2">
              <FileText className="h-4 w-4 text-violet-300" />
              <span className="text-sm font-medium text-zinc-100">{localize({ zh: '文档', en: 'Docs' }, language)}</span>
            </div>
            <button aria-label={localize({ zh: '新建文档', en: 'Create document' }, language)} className="rounded-md p-1.5 text-zinc-500 hover:bg-zinc-900 hover:text-zinc-200" type="button">
              <Plus className="h-3.5 w-3.5" />
            </button>
          </div>
          <div className="mt-3 space-y-1">
            {docs.map((doc) => (
              <button key={doc.title} className={`w-full rounded-lg px-3 py-2.5 text-left transition ${doc.active ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-500 hover:bg-zinc-900 hover:text-zinc-200'}`} type="button">
                <span className="block truncate text-xs font-medium">{doc.title}</span>
                <span className="mt-1 block truncate text-[10px] text-zinc-600">{doc.meta}</span>
              </button>
            ))}
          </div>
        </aside>
        <article className="min-w-0 bg-[radial-gradient(circle_at_top,rgba(39,39,42,0.28),transparent_45%),linear-gradient(180deg,rgba(9,9,11,0.96),rgba(9,9,11,1))]">
          <header className="flex items-center justify-between gap-4 border-b border-zinc-800 px-5 py-4">
            <div className="min-w-0">
              <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-violet-300">Wemux Docs</p>
              <h2 className="mt-2 truncate text-xl font-semibold text-zinc-50">{localize({ zh: '产品发布说明', en: 'Product release notes' }, language)}</h2>
            </div>
            <span className="rounded-full border border-emerald-500/25 bg-emerald-500/10 px-3 py-1 text-[10px] text-emerald-300">{localize({ zh: '已同步', en: 'Synced' }, language)}</span>
          </header>
          <div className="space-y-5 p-5">
            <p className="text-sm leading-7 text-zinc-300">{localize({ zh: '这份文档汇总了本轮功能变更、验证结果和上线前需要人工确认的事项。Agent 可以直接读取、更新并在团队空间里留下完整上下文。', en: 'This document collects the feature changes, validation results, and items that need human confirmation before launch. Agents can read, update, and preserve the full context in the team space.' }, language)}</p>
            <div className="grid grid-cols-3 gap-2">
              <InfoCell label={localize({ zh: '编辑者', en: 'Editors' }, language)} value="3 agents" />
              <InfoCell label={localize({ zh: '版本', en: 'Version' }, language)} value="v0.4.2" />
              <InfoCell label={localize({ zh: '评论', en: 'Comments' }, language)} value="8" />
            </div>
            <div className="space-y-2 rounded-xl border border-zinc-800 bg-zinc-950/60 p-4">
              <p className="text-[10px] uppercase tracking-[0.2em] text-zinc-500">{localize({ zh: '本轮更新', en: 'This update' }, language)}</p>
              {[
                localize({ zh: '新增共享云盘与文档入口', en: 'Added shared drive and docs entry points' }, language),
                localize({ zh: '补充 Safari 回归测试记录', en: 'Added Safari regression records' }, language),
                localize({ zh: '统一 Agent 交付状态与审核提示', en: 'Unified agent delivery states and review prompts' }, language),
              ].map((item) => (
                <div key={item} className="flex items-center gap-2 text-xs text-zinc-300">
                  <span className="h-1.5 w-1.5 rounded-full bg-violet-300" />
                  {item}
                </div>
              ))}
            </div>
          </div>
        </article>
      </div>
    </PreviewFrame>
  )
}

function TeamsPreview({ language }: { language: Language }) {
  return (
    <PreviewFrame>
      <section className="rounded-lg border border-zinc-800 bg-[linear-gradient(135deg,rgba(24,24,27,0.98),rgba(9,9,11,0.92))] p-5">
        <div className="inline-flex items-center gap-2 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-3 py-1 text-[10px] font-medium uppercase tracking-[0.22em] text-emerald-300">
          <span className="h-2 w-2 rounded-full bg-emerald-400" />
          {localize({ zh: 'Team Workspace', en: 'Team Workspace' }, language)}
        </div>
        <div className="mt-4 flex flex-row items-end justify-between gap-5">
          <div>
            <h2 className="text-2xl font-semibold tracking-tight text-zinc-50">{localize({ zh: '团队空间', en: 'Team Space' }, language)}</h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-400">{localize({ zh: '成员、邀请、项目共享和团队节点在同一个空间里协同。', en: 'Members, invitations, shared projects, and team workers live in one space.' }, language)}</p>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <InfoCell label={localize({ zh: '团队', en: 'Teams' }, language)} value="3" />
            <InfoCell label={localize({ zh: '成员', en: 'Members' }, language)} value="8" />
            <InfoCell label={localize({ zh: '邀请', en: 'Invites' }, language)} value="2" />
          </div>
        </div>
      </section>
      <div className="grid flex-1 grid-cols-[15rem_1fr] gap-3">
        <MiniPanel title={localize({ zh: '团队', en: 'Teams' }, language)}>
          {['Wemux Core', 'Wemux Docs', 'Community Operations'].map((team, index) => (
            <ListButton active={index === 0} key={team} title={team} subtitle={index === 0 ? '8 members' : 'shared workspace'} />
          ))}
        </MiniPanel>
        <div className="flex min-h-0 flex-col space-y-3">
          <div className="grid grid-cols-3 gap-3">
            <MiniPanel title={localize({ zh: '成员', en: 'Members' }, language)}>
              <PeopleRow name="Project Owner" role="owner" tone="amber" />
              <PeopleRow name="Mia Wang" role="admin" tone="sky" />
              <PeopleRow name="Developer Bot" role="member" tone="emerald" />
            </MiniPanel>
            <MiniPanel title={localize({ zh: '项目', en: 'Projects' }, language)}>
              <TaskListRow agent="shared" title="Wemux Console" tone="violet" />
              <TaskListRow agent="shared" title="Wemux Docs" tone="sky" />
              <TaskListRow agent="private" title="Community Operations" tone="emerald" />
            </MiniPanel>
            <MiniPanel title={localize({ zh: '节点', en: 'Workers' }, language)}>
              <TaskListRow agent="private" title="MacBook-Pro" tone="violet" />
              <TaskListRow agent="team" title="Cloud VM" tone="emerald" />
              <TaskListRow agent="team" title="Office PC" tone="sky" />
            </MiniPanel>
          </div>
          <div className="flex-1">
            <MiniPanel title={localize({ zh: '团队动态', en: 'Team Activity' }, language)}>
            <TimelineRow tone="emerald" time="09:41" title="invite" value={localize({ zh: 'Mia 加入 Wemux Core', en: 'Mia joined Wemux Core' }, language)} />
            <TimelineRow tone="violet" time="10:06" title="worker" value={localize({ zh: 'Cloud VM 绑定团队节点', en: 'Cloud VM bound as team worker' }, language)} />
            </MiniPanel>
          </div>
        </div>
      </div>
    </PreviewFrame>
  )
}

type ChatPreviewTarget = {
  id: string
  title: LocalizedText
  subtitle: LocalizedText
  meta: string
  active?: boolean
  accent?: string
  avatar: 'developer' | 'tester' | 'reviewer' | 'lead'
}

type ChatPreviewSession = {
  title: LocalizedText
  subtitle: LocalizedText
  active?: boolean
}

type ChatPreviewMessage = {
  id: string
  sender: string
  role: 'human' | 'agent'
  accent: string
  body: LocalizedText
  meta: LocalizedText
}

const chatPreviewTargets: ChatPreviewTarget[] = [
  {
    id: 'developer-agent',
    avatar: 'developer',
    title: { zh: 'Developer', en: 'Developer' },
    subtitle: { zh: '代码、修复、重构', en: 'Code, fixes, refactors' },
    meta: '8',
    active: true,
    accent: 'from-violet-400 via-fuchsia-300 to-sky-400',
  },
  {
    id: 'tester-agent',
    avatar: 'tester',
    title: { zh: 'Tester', en: 'Tester' },
    subtitle: { zh: '浏览器巡检与回归', en: 'Browser checks and regression' },
    meta: '3',
    accent: 'from-emerald-300 via-lime-300 to-sky-300',
  },
  {
    id: 'reviewer-agent',
    avatar: 'reviewer',
    title: { zh: 'Reviewer', en: 'Reviewer' },
    subtitle: { zh: '风险检查与代码审核', en: 'Risk checks and code review' },
    meta: '5',
    accent: 'from-amber-300 via-orange-300 to-rose-300',
  },
  {
    id: 'researcher-agent',
    avatar: 'lead',
    title: { zh: 'Researcher', en: 'Researcher' },
    subtitle: { zh: '调研与方案梳理', en: 'Research and solution mapping' },
    meta: '2',
    accent: 'from-sky-300 via-cyan-300 to-violet-300',
  },
]

const chatPreviewSessions: ChatPreviewSession[] = [
  {
    title: { zh: '登录回调修复', en: 'Auth Callback Fix' },
    subtitle: { zh: '正在执行最小 patch', en: 'Running the minimal patch' },
    active: true,
  },
  {
    title: { zh: 'Safari 状态复核', en: 'Safari State Review' },
    subtitle: { zh: '回归验证已经完成', en: 'Regression validation completed' },
  },
  {
    title: { zh: 'OAuth 回归记录', en: 'OAuth Regression Notes' },
    subtitle: { zh: '保留测试与上线说明', en: 'Tests and release notes retained' },
  },
]

const chatPreviewMessages: ChatPreviewMessage[] = [
  {
    id: 'chat-msg-1',
    sender: 'Project Owner',
    role: 'human',
    accent: 'from-zinc-200 via-zinc-100 to-white',
    body: { zh: '先做登录回调的最小 patch，并补一条 Safari 重定向回归。', en: 'Create the minimal auth callback patch and add one Safari redirect regression.' },
    meta: { zh: '09:41 · 已发送给 Agent', en: '09:41 · Sent to Agent' },
  },
  {
    id: 'chat-msg-2',
    sender: 'Developer',
    role: 'agent',
    accent: 'from-violet-400 via-fuchsia-300 to-sky-400',
    body: { zh: '我会先定位 callback 前的 session 写入点，再用最小改动修复 state 被覆盖的问题，并运行聚焦回归。', en: 'I will locate the pre-callback session write, fix the state overwrite with the smallest change, and run focused regressions.' },
    meta: { zh: '09:42 · 正在执行', en: '09:42 · Running' },
  },
  {
    id: 'chat-msg-3',
    sender: 'Developer',
    role: 'agent',
    accent: 'from-violet-400 via-fuchsia-300 to-sky-400',
    body: { zh: '最小 patch 和 Safari 回归都已完成。Diff、测试结果与上线注意事项已经回传到本轮记录。', en: 'The minimal patch and Safari regression are complete. The diff, test results, and release notes are attached to this run.' },
    meta: { zh: '09:49 · 结果已回传', en: '09:49 · Results delivered' },
  },
]

function ChatPreview({ language }: { language: Language }) {
  return (
    <PreviewFrame>
      <div className="grid min-h-0 flex-1 grid-cols-[16.5rem_15rem_minmax(0,1fr)] overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950">
        <ChatPreviewTargetSidebar language={language} />
        <ChatPreviewSessionSidebar language={language} />
        <ChatPreviewMainPanel language={language} />
      </div>
    </PreviewFrame>
  )
}

function ChatPreviewTargetSidebar({ language }: { language: Language }) {
  return (
    <aside className="min-h-0 border-r border-zinc-800/50">
      <div className="flex h-full flex-col">
        <div className="flex items-center justify-between border-b border-zinc-800/50 px-3 py-2">
          <span className="text-xs font-medium uppercase tracking-[0.2em] text-zinc-500">
            {localize({ zh: '聊天对象', en: 'Targets' }, language)}
          </span>
          <Button type="button" size="icon" variant="ghost" className="size-7 text-zinc-500 hover:text-zinc-200">
            <Plus className="h-4 w-4" />
          </Button>
        </div>
        <div className="border-b border-zinc-800/50 px-3 py-2">
          <ChatPreviewSearchField placeholder={localize({ zh: '搜索 Agent...', en: 'Search agents...' }, language)} />
        </div>
        <div className="scrollbar-subtle flex-1 space-y-1 overflow-y-auto p-2">
          {chatPreviewTargets.map((target) => (
            <button
              key={target.id}
              type="button"
              className={cn(
                'w-full rounded-xl px-3 py-2 text-left transition-colors',
                target.active ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-500 hover:bg-zinc-900 hover:text-zinc-200',
              )}
            >
              <div className="flex items-start gap-3">
                <span className="relative shrink-0">
                  <LandingAgentAvatar avatar={target.avatar} className="size-10 rounded-full border border-zinc-800 bg-zinc-900" fallback={localize(target.title, language).slice(0, 2).toUpperCase()} />
                  <span className="absolute bottom-0 right-0 size-2.5 rounded-full bg-emerald-300 ring-2 ring-zinc-950" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="line-clamp-1 text-sm font-medium">{localize(target.title, language)}</p>
                      <p className="mt-1 line-clamp-2 text-[11px] leading-4 text-zinc-600">{localize(target.subtitle, language)}</p>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1">
                      <span className="rounded-full bg-zinc-900 px-1.5 py-0.5 text-[10px] text-zinc-500">{target.meta}</span>
                    </div>
                  </div>
                </div>
              </div>
            </button>
          ))}
        </div>
      </div>
    </aside>
  )
}

function ChatPreviewSessionSidebar({ language }: { language: Language }) {
  return (
    <aside className="min-h-0 border-r border-zinc-800/50">
      <div className="flex h-full flex-col">
        <div className="flex items-center justify-between border-b border-zinc-800/50 px-3 py-2">
          <span className="min-w-0 text-xs font-medium text-zinc-400">
            {localize({ zh: 'Developer Agent 会话', en: 'Developer Agent Sessions' }, language)}
          </span>
          <div className="flex items-center gap-1">
            <span className="rounded-full border border-zinc-800 bg-zinc-950 px-2 py-0.5 text-[10px] text-zinc-500">
              {chatPreviewSessions.length}
            </span>
            <Button type="button" size="icon" variant="ghost" className="size-6 text-zinc-500 hover:text-zinc-300">
              <Plus className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
        <div className="scrollbar-subtle flex-1 space-y-1 p-1.5">
          {chatPreviewSessions.map((session) => (
            <ChatSessionItem
              key={session.title.zh}
              active={session.active}
              subtitle={localize(session.subtitle, language)}
              title={localize(session.title, language)}
            />
          ))}
        </div>
      </div>
    </aside>
  )
}

function ChatPreviewMainPanel({ language }: { language: Language }) {
  return (
    <section className="flex min-h-0 flex-col">
      <div className="border-b border-zinc-800/50 px-4 py-2.5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-medium text-zinc-200">Wemux Developer Agent</span>
              <span className="text-xs text-zinc-600">{localize({ zh: '主会话', en: 'Main Session' }, language)}</span>
              <span className="rounded-full bg-zinc-800 px-2 py-0.5 text-[10px] text-zinc-500">
                {localize({ zh: '直接对话', en: 'Direct chat' }, language)}
              </span>
              <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] text-emerald-300">
                MacBook-Pro · online
              </span>
            </div>
            <p className="mt-2 text-[11px] text-zinc-500">
              {localize({ zh: '代码、修复、重构与 patch 交付', en: 'Code, fixes, refactors, and patch delivery' }, language)}
            </p>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="rounded-md border border-zinc-800 px-2 py-1 text-[10px] text-zinc-500">gpt-5.4</span>
            <Button type="button" variant="ghost" size="icon" className="size-7 text-zinc-500 hover:text-zinc-300">
              <Settings2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      </div>
      <div className="scrollbar-subtle flex-1 overflow-y-auto bg-[radial-gradient(circle_at_top,rgba(39,39,42,0.28),transparent_40%),linear-gradient(180deg,rgba(9,9,11,0.96),rgba(9,9,11,1))] px-4 py-4">
        <div className="mx-auto flex max-w-3xl flex-col gap-3">
          <div className="rounded-md border border-zinc-800 bg-zinc-900/60 px-2.5 py-2">
            <p className="text-[10px] uppercase tracking-[0.14em] text-zinc-500">
              {localize({ zh: '当前运行', en: 'Current Run' }, language)}
            </p>
            <div className="mt-1.5 grid grid-cols-3 gap-1">
              <span className="rounded-md border border-zinc-800 bg-zinc-950 px-2 py-1 text-[10px] text-zinc-500">{localize({ zh: '状态 · 执行中', en: 'Status · Running' }, language)}</span>
              <span className="rounded-md border border-zinc-800 bg-zinc-950 px-2 py-1 text-[10px] text-zinc-500">{localize({ zh: '节点 · MacBook-Pro', en: 'Worker · MacBook-Pro' }, language)}</span>
              <span className="truncate rounded-md border border-zinc-800 bg-zinc-950 px-2 py-1 text-[10px] text-zinc-500">branch · task/auth-callback</span>
            </div>
          </div>
          {chatPreviewMessages.map((message) => (
            <ChatPreviewMessageBubble key={message.id} language={language} message={message} />
          ))}
          <ChatPreviewResult language={language} />
        </div>
      </div>
      <div className="border-t border-zinc-800/50 bg-zinc-950 px-3 py-2">
        <div className="mx-auto max-w-3xl">
          <ChatPreviewComposer language={language} />
        </div>
      </div>
    </section>
  )
}

function ChatPreviewMessageBubble({ language, message }: { language: Language; message: ChatPreviewMessage }) {
  const isHuman = message.role === 'human'

  return (
    <div className={cn('flex gap-3', isHuman ? 'justify-end' : 'justify-start')}>
      {!isHuman ? (
        <LandingAgentAvatar
          avatar={message.sender === 'Reviewer' ? 'reviewer' : message.sender === 'Tester' ? 'tester' : 'developer'}
          className="mt-1 size-9 border border-zinc-800 bg-zinc-900"
          fallback="WD"
        />
      ) : null}
      <div className={cn('max-w-[84%]', isHuman ? 'items-end' : 'items-start')}>
        <div className={cn(
          'rounded-2xl border px-4 py-3 shadow-[0_16px_36px_rgba(0,0,0,0.18)]',
          isHuman
            ? 'rounded-tr-sm border-zinc-700 bg-zinc-100 text-zinc-950'
            : 'rounded-tl-sm border-zinc-800 bg-zinc-900 text-zinc-100',
        )}>
          <p className={cn('mb-1 text-[10px] font-semibold uppercase tracking-[0.18em]', isHuman ? 'text-zinc-600' : 'text-zinc-500')}>
            {message.sender}
          </p>
          <p className="whitespace-pre-wrap text-sm leading-6">{localize(message.body, language)}</p>
        </div>
        <p className={cn('mt-1 text-[11px] text-zinc-600', isHuman ? 'text-right' : 'text-left')}>
          {localize(message.meta, language)}
        </p>
      </div>
      {isHuman ? (
        <Avatar className="mt-1 size-9 border border-zinc-800 bg-zinc-900">
          <AvatarFallback className="rounded-full bg-gradient-to-br from-zinc-200 via-zinc-100 to-white text-[10px] font-black text-zinc-950">
            AX
          </AvatarFallback>
        </Avatar>
      ) : null}
    </div>
  )
}

function ChatPreviewComposer({ language }: { language: Language }) {
  return (
    <ChatComposer
      readOnly
      minHeight={72}
      value={localize({ zh: '把 patch、测试结果和上线注意事项一起发出来。', en: 'Send the patch, test results, and release notes together.' }, language)}
      className="min-h-[72px] px-3 py-2.5 pr-20 text-[13px]"
      shellClassName="pointer-events-auto rounded-2xl border-zinc-800/90 bg-[#08080a] p-2 shadow-[0_18px_48px_rgba(0,0,0,0.46),inset_0_1px_0_rgba(255,255,255,0.03)]"
      inputShellClassName="rounded-xl border-zinc-700/70 bg-[#0c0c0f] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.03),0_8px_26px_rgba(0,0,0,0.32)] focus-within:border-zinc-500/80"
      overlay={(
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-zinc-500 transition-all hover:bg-zinc-800/80 hover:text-zinc-300">
          <ImagePlus className="h-3.5 w-3.5" />
        </span>
      )}
      footer={<ChatPreviewComposerFooter language={language} />}
    />
  )
}

function ChatPreviewComposerFooter({ language }: { language: Language }) {
  return (
    <div className="mt-1.5 rounded-xl border border-zinc-800/80 bg-[#0b0b0e]/95 p-1.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.035)]">
      <div className="flex flex-row items-center gap-1.5">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1">
          <PreviewToolbarDropdown icon={<Bot className="h-3 w-3 text-violet-400/80" />} label="Developer" />
          <PreviewToolbarDropdown icon={<Cpu className="h-3 w-3 text-sky-500/70" />} label="MacBook-Pro" />
          <PreviewToolbarDropdown icon={<Sparkles className="h-3 w-3 text-amber-500/70" />} label="gpt-5.4" />
          <Button
            type="button"
            variant="outline"
            className="h-7 shrink-0 rounded-lg border-zinc-800 bg-zinc-950 px-2 text-[11px] text-zinc-300 hover:bg-zinc-900 hover:text-zinc-50"
          >
            <Settings2 className="h-3 w-3" />
            <span>{localize({ zh: '设置', en: 'Settings' }, language)}</span>
          </Button>
        </div>
        <div className="ml-auto flex shrink-0 items-center justify-end gap-1.5">
          <Button
            size="sm"
            className="h-7 gap-1 rounded-lg bg-zinc-100 px-2.5 text-[11px] font-medium text-zinc-900 shadow-lg hover:bg-white hover:shadow-xl"
          >
            <Send className="h-3 w-3" />
            {localize({ zh: '发送', en: 'Send' }, language)}
          </Button>
        </div>
      </div>
    </div>
  )
}

function ChatPreviewSearchField({ placeholder }: { placeholder: string }) {
  return (
    <div className="group relative">
      <Search className="pointer-events-none absolute left-3.5 top-1/2 z-10 size-3.5 -translate-y-1/2 text-zinc-600 transition-colors group-focus-within:text-zinc-300" />
      <div className="h-10 rounded-lg border border-zinc-800/80 bg-[linear-gradient(180deg,rgba(24,24,27,0.92),rgba(10,10,12,0.98))] pl-10 pr-3.5 text-[12px] leading-10 text-zinc-500 shadow-[inset_0_1px_0_rgba(255,255,255,0.05),0_10px_24px_rgba(0,0,0,0.22)]">
        {placeholder}
      </div>
    </div>
  )
}

function PreviewToolbarDropdown({ icon, label }: { icon?: ReactNode; label: string }) {
  return (
    <button
      type="button"
      className="flex h-[26px] min-w-0 shrink-0 items-center gap-1 rounded-lg border border-zinc-800/60 bg-zinc-900/50 px-2 text-[11px] text-zinc-400 transition-all hover:border-zinc-700 hover:bg-zinc-800/70 hover:text-zinc-200"
    >
      {icon}
      <span className="max-w-[84px] truncate">{label}</span>
      <ChevronDown className="h-3 w-3 opacity-60" />
    </button>
  )
}

function ChatPreviewResult({ language }: { language: Language }) {
  return (
    <div className="rounded-[1.125rem] border border-amber-500/20 bg-amber-500/10 p-2.5">
      <div className="flex items-start justify-between gap-2.5">
        <div>
          <p className="text-[11px] font-medium text-amber-100">
            {localize({ zh: 'Agent 运行结果已生成', en: 'Agent run result generated' }, language)}
          </p>
          <p className="mt-1 text-[11px] leading-4 text-amber-100/75">
            {localize(
              { zh: 'Developer 已回传最小 patch、Safari 回归结果与上线注意事项。', en: 'Developer returned the minimal patch, Safari regression results, and release notes.' },
              language,
            )}
          </p>
        </div>
        <span className="inline-flex items-center rounded-full border border-amber-500/35 bg-amber-500/10 px-1.5 py-0.5 text-[9px] uppercase tracking-[0.18em] text-amber-300">
          ready
        </span>
      </div>
    </div>
  )
}

function ChatSessionItem({ active, subtitle, title }: { active?: boolean; subtitle: string; title: string }) {
  return (
    <button
      className={`group relative block w-full rounded-md px-2.5 py-2 text-left transition-colors ${active ? 'bg-zinc-800/70 text-zinc-200' : 'text-zinc-500 hover:bg-zinc-800/40 hover:text-zinc-300'}`}
      type="button"
    >
      <span className="line-clamp-1 text-xs font-medium">{title}</span>
      <span className="mt-0.5 block line-clamp-1 text-[11px] text-zinc-600">{subtitle}</span>
    </button>
  )
}

function ExecutionPreview({ language }: { language: Language }) {
  return (
    <PreviewFrame>
      <section className="grid grid-cols-[0.95fr_1.05fr] gap-4">
        <div className="rounded-xl border border-zinc-800 bg-[linear-gradient(135deg,rgba(24,24,27,0.98),rgba(9,9,11,0.92))] p-5">
          <div className="inline-flex items-center gap-2 rounded-full border border-violet-500/20 bg-violet-500/10 px-3 py-1 text-[10px] font-medium uppercase tracking-[0.22em] text-violet-300">
            <span className="h-1.5 w-1.5 rounded-full bg-violet-400" />
            {localize({ zh: 'Executors', en: 'Executors' }, language)}
          </div>
          <h2 className="mt-4 text-2xl font-semibold tracking-tight text-zinc-50">{localize({ zh: '节点管理', en: 'Executor Management' }, language)}</h2>
          <p className="mt-2 text-sm leading-6 text-zinc-400">{localize({ zh: '在线节点、任务投递、项目绑定和执行日志都在这里管理。', en: 'Online workers, task dispatch, project bindings, and execution logs are managed here.' }, language)}</p>
          <div className="mt-5 grid grid-cols-3 gap-2">
            <InfoCell label={localize({ zh: '在线', en: 'Online' }, language)} value="3" />
            <InfoCell label={localize({ zh: '执行中', en: 'Running' }, language)} value="4" />
            <InfoCell label={localize({ zh: '队列', en: 'Queue' }, language)} value="2" />
          </div>
        </div>
        <NodeTopology language={language} />
      </section>
      <div className="flex w-max min-w-full gap-1 rounded-full border border-zinc-800 bg-zinc-950/50 p-1">
        {['overview', 'tasks', 'bindings', 'logs'].map((tab, index) => (
          <span key={tab} className={`rounded-full px-4 py-2 text-xs ${index === 0 ? 'bg-zinc-100 text-zinc-950' : 'text-zinc-500'}`}>{tab}</span>
        ))}
      </div>
      <div className="grid grid-cols-3 gap-3">
        {previewNodes.map((node) => (
          <div key={node.name} className="rounded-xl border border-zinc-800 bg-zinc-950/75 p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-medium text-zinc-100">{node.name}</p>
                <p className="mt-1 font-mono text-xs text-zinc-500">{node.ip}</p>
              </div>
              <Pill tone={node.tone}>{node.status}</Pill>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-2 text-xs">
              <InfoCell label="Memory" value={node.memory} />
              <InfoCell label="CPU" value={node.cpu} />
              <InfoCell label="Running" value="1" />
              <InfoCell label="Queued" value="2" />
            </div>
          </div>
        ))}
      </div>
    </PreviewFrame>
  )
}

function ModelsPreview({ language }: { language: Language }) {
  return (
    <PreviewFrame>
      <section className="rounded-xl border border-zinc-800 bg-zinc-950/70 p-5">
        <div className="flex flex-row items-end justify-between gap-4">
          <div>
            <p className="text-[10px] uppercase tracking-[0.24em] text-zinc-500">Models</p>
            <h2 className="mt-2 text-2xl font-semibold tracking-tight text-zinc-50">{localize({ zh: '模型 Profile', en: 'Model Profiles' }, language)}</h2>
            <p className="mt-2 text-sm leading-6 text-zinc-400">{localize({ zh: '统一管理 Provider、Base URL、Token、可见性和 Agent 绑定。', en: 'Manage providers, base URLs, tokens, visibility, and agent bindings.' }, language)}</p>
          </div>
          <div className="flex gap-2">
            <button className="rounded-full border border-zinc-800 px-4 py-2 text-xs text-zinc-300" type="button">{localize({ zh: '从节点导入', en: 'Import from Worker' }, language)}</button>
            <button className="rounded-full bg-zinc-100 px-4 py-2 text-xs font-semibold text-zinc-950" type="button">{localize({ zh: '新建模型', en: 'New Model' }, language)}</button>
          </div>
        </div>
      </section>
      <div className="grid grid-cols-3 gap-2">
        <InfoCell label={localize({ zh: 'Profiles', en: 'Profiles' }, language)} value="3" />
        <InfoCell label={localize({ zh: '共享', en: 'Shared' }, language)} value="1" />
        <InfoCell label={localize({ zh: '绑定', en: 'Bindings' }, language)} value="7" />
      </div>
      <TableCard
        headers={['Model', 'Provider / Model', 'Base URL', 'Token', 'Visibility', 'Source', 'Updated']}
        rows={[
          ['Coding Default', 'openai · gpt-5.4', 'api.openai.com', 'configured', 'private', 'manual', '09:41'],
          ['Review Model', 'anthropic · sonnet', 'console.anthropic.com', 'configured', 'team', 'worker', 'yesterday'],
          ['Vision Model', 'openai · vision', 'api.example.com', 'missing', 'private', 'manual', 'Monday'],
        ]}
      />
    </PreviewFrame>
  )
}
