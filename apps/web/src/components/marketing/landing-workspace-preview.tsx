import {
  Bot,
  ChevronDown,
  ChevronRight,
  FileCode2,
  FolderGit2,
  FolderTree,
  MoreHorizontal,
  Plus,
  Search,
  TerminalSquare,
  Workflow,
} from 'lucide-react'

import { ChatComposer } from '../chat/chat-composer'
import { Avatar, AvatarFallback } from '../ui/avatar'
import { LandingAgentAvatar } from './landing-agent-avatar'
import { Button } from '../ui/button'
import { cn } from '../../lib/utils'
import { InfoCell, Pill, localize } from './landing-product-preview-ui'
import type { Language } from '../../lib/i18n'

type WorkspacePreviewProject = {
  name: string
  workspaces: Array<{
    name: string
    branch: string
    running?: boolean
    attention?: boolean
    active?: boolean
  }>
}

type WorkspacePreviewSession = {
  title: string
  meta: string
  depth: number
  badge?: string
  active?: boolean
}

type WorkspacePreviewMessage = {
  sender: string
  accent: string
  body: { zh: string; en: string }
  meta: { zh: string; en: string }
  human?: boolean
}

type WorkspacePreviewTerminalCommand = {
  command: string
  result: string[]
}

const workspacePreviewProjects: WorkspacePreviewProject[] = [
  {
    name: 'Wemux Console',
    workspaces: [
      { name: 'auth-flow-fix', branch: 'main -> auth-flow-fix', running: true, attention: true, active: true },
      { name: 'integration-regression', branch: 'main -> qa/integration', running: true },
    ],
  },
  {
    name: 'Wemux Docs',
    workspaces: [
      { name: 'release-notes', branch: 'main -> docs/release-notes' },
    ],
  },
  {
    name: 'Community Operations',
    workspaces: [
      { name: 'feedback-cluster', branch: 'main -> ops/feedback' },
    ],
  },
]

const workspacePreviewSessions: WorkspacePreviewSession[] = [
  { title: 'Developer run', meta: '主会话 · main session', depth: 0, active: true },
  { title: 'Patch review', meta: 'fork · Reviewer', depth: 1, badge: 'fork' },
  { title: 'Browser check', meta: 'subagent · Tester', depth: 1, badge: 'sub' },
  { title: 'Release note', meta: 'subagent · Docs', depth: 2, badge: 'sub' },
]

const workspacePreviewMessages: WorkspacePreviewMessage[] = [
  {
    sender: 'Project Owner',
    accent: 'from-zinc-200 via-zinc-100 to-white',
    body: { zh: '这个工作区继续走主修复，右侧保留文件树，我要边看 patch 边看改动面。', en: 'Keep this workspace on the main patch path. Leave the file tree open on the right so I can track the patch and changed files together.' },
    meta: { zh: '09:41 · 工作区主会话', en: '09:41 · workspace main session' },
    human: true,
  },
  {
    sender: 'Developer',
    accent: 'from-violet-400 via-fuchsia-300 to-sky-400',
    body: { zh: '我已经把登录回调的 state 持久化补丁写进这个 worktree，下一步准备补 Safari redirect 回归。', en: 'I wrote the callback state persistence patch in this worktree. Next I will add the Safari redirect regression.' },
    meta: { zh: '09:43 · patch in worktree', en: '09:43 · patch in worktree' },
  },
  {
    sender: 'Reviewer',
    accent: 'from-amber-300 via-orange-300 to-rose-300',
    body: { zh: '右侧文件树显示改动集中在 auth/callback.ts 和 session-store.ts，风险面比较收敛。', en: 'The file tree on the right shows changes concentrated in auth/callback.ts and session-store.ts, so the risk surface is fairly contained.' },
    meta: { zh: '09:46 · diff review', en: '09:46 · diff review' },
  },
]

const workspacePreviewFiles = [
  { depth: 0, label: 'apps/web/src/routes' },
  { depth: 1, label: 'auth/callback.ts', active: true },
  { depth: 1, label: 'session-store.ts' },
  { depth: 0, label: 'apps/server/src/routes' },
  { depth: 1, label: 'auth-session.ts' },
  { depth: 0, label: 'tests/e2e' },
  { depth: 1, label: 'safari-redirect.spec.ts' },
]

const workspacePreviewTerminalCommands: WorkspacePreviewTerminalCommand[] = [
  {
    command: 'pnpm typecheck',
    result: ['apps/web ... ok', 'apps/server ... ok'],
  },
  {
    command: 'pnpm --filter web test safari-redirect',
    result: ['1 passed', '0 failed'],
  },
]

export function WorkspacesPreview({ language }: { language: Language }) {
  return (
    <div className="flex h-full min-h-[calc(42rem-3.5rem)] flex-1 overflow-hidden rounded-2xl border border-zinc-900 bg-[#09090b]">
      <WorkspacePreviewList language={language} />
      <WorkspacePreviewShell language={language} />
    </div>
  )
}

function WorkspacePreviewList({ language }: { language: Language }) {
  return (
    <aside className="flex h-full min-h-0 w-[16.5rem] shrink-0 flex-col overflow-hidden border-r border-zinc-900 bg-[#080809] text-zinc-100">
      <div className="border-b border-zinc-900 bg-[#070708] px-3 py-2.5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="font-mono text-[9px] uppercase tracking-[0.22em] text-zinc-600">Workspaces</p>
            <h2 className="mt-1 truncate text-sm font-semibold text-zinc-100">{localize({ zh: '工作区', en: 'Workspaces' }, language)}</h2>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-7 w-7 rounded-md border border-zinc-800 bg-zinc-950 text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100"
          >
            <Plus className="h-3.5 w-3.5" />
          </Button>
        </div>
        <div className="mt-2 grid grid-cols-3 gap-1.5">
          <InfoCell label={localize({ zh: '全部', en: 'All' }, language)} value="4" />
          <InfoCell label={localize({ zh: '运行', en: 'Running' }, language)} value="2" />
          <InfoCell label={localize({ zh: '待确认', en: 'Attention' }, language)} value="1" />
        </div>
        <div className="relative mt-2">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-500" />
          <div className="h-8 rounded-lg border border-zinc-800 bg-zinc-950 pl-8 pr-3 text-xs leading-8 text-zinc-500">
            {localize({ zh: '搜索工作区...', en: 'Search workspaces...' }, language)}
          </div>
        </div>
      </div>

      <div className="scrollbar-subtle min-h-0 flex-1 space-y-1.5 overflow-y-auto p-2">
        {workspacePreviewProjects.map((project, index) => (
          <section key={project.name} className="overflow-hidden rounded-lg">
            <div className="flex items-center justify-between gap-3 px-1.5 py-1.5">
              <button type="button" className="flex min-w-0 items-center gap-1.5 text-left">
                {index === 0 ? <ChevronDown className="h-3.5 w-3.5 shrink-0 text-zinc-500" /> : <ChevronRight className="h-3.5 w-3.5 shrink-0 text-zinc-500" />}
                <p className="truncate text-[12px] font-medium text-zinc-200">{project.name}</p>
              </button>
              <button type="button" className="shrink-0 rounded-md p-1 text-zinc-500 hover:bg-zinc-900 hover:text-zinc-100">
                <Plus className="h-3.5 w-3.5" />
              </button>
            </div>
            {index === 0 ? (
              <div className="space-y-1 pb-1 pl-[18px] pr-1">
                {project.workspaces.map((workspace) => (
                  <WorkspacePreviewListItem key={workspace.name} language={language} workspace={workspace} />
                ))}
              </div>
            ) : null}
          </section>
        ))}
      </div>
    </aside>
  )
}

function WorkspacePreviewListItem({
  language,
  workspace,
}: {
  language: Language
  workspace: WorkspacePreviewProject['workspaces'][number]
}) {
  return (
    <button
      type="button"
      className={cn(
        'block w-full overflow-hidden rounded-lg border px-2.5 py-2 text-left transition-all duration-150',
        workspace.active
          ? 'border-zinc-800 bg-zinc-950 shadow-[0_16px_36px_rgba(0,0,0,0.28)]'
          : 'border-transparent bg-transparent hover:border-zinc-900 hover:bg-zinc-950/70',
      )}
    >
      <div className="min-w-0">
        <p className="line-clamp-1 text-[12px] font-medium text-zinc-100">{workspace.name}</p>
        <p className="mt-1 flex items-center gap-1.5 text-[10px] text-zinc-500">
          <FolderGit2 className="h-2.5 w-2.5 shrink-0" />
          <span className="truncate">{workspace.branch}</span>
        </p>
      </div>
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
        {workspace.running ? (
          <span className="rounded-md bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-300">
            {localize({ zh: '1 运行中', en: '1 running' }, language)}
          </span>
        ) : null}
        {workspace.attention ? (
          <span className="rounded-md bg-rose-500/10 px-1.5 py-0.5 text-[10px] font-medium text-rose-300">
            {localize({ zh: '1 待确认', en: '1 attention' }, language)}
          </span>
        ) : null}
      </div>
    </button>
  )
}

function WorkspacePreviewShell({ language }: { language: Language }) {
  return (
    <main className="flex h-full min-h-0 flex-1 flex-col overflow-hidden bg-[#09090b] text-zinc-100">
      <WorkspacePreviewShellHeader language={language} />
      <div className="h-full min-h-0 flex-1 overflow-hidden">
        <div className="grid h-full min-h-0 grid-cols-[14rem_minmax(0,1fr)] grid-rows-[minmax(0,1fr)_10.5rem] overflow-hidden">
          <WorkspacePreviewSessionRail language={language} />
          <div className="min-h-0 overflow-hidden">
            <WorkspacePreviewMainSplit language={language} />
          </div>
          <div className="col-span-2">
            <WorkspacePreviewTerminal language={language} />
          </div>
        </div>
      </div>
    </main>
  )
}

function WorkspacePreviewShellHeader({ language }: { language: Language }) {
  return (
    <div className="border-b border-zinc-900 bg-[linear-gradient(180deg,#070708_0%,#050506_100%)] px-3">
      <div className="flex h-11 items-center gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <h1 className="min-w-0 flex-1 truncate text-base font-semibold tracking-tight text-zinc-50">
              auth-flow-fix
            </h1>
            <Pill tone="emerald">{localize({ zh: '已绑定任务', en: 'Task linked' }, language)}</Pill>
            <Pill tone="zinc">worktree</Pill>
            <Pill tone="zinc">main</Pill>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2 text-zinc-400">
          <Button type="button" variant="ghost" className="h-7 rounded-md border border-zinc-800 bg-zinc-950 px-2 text-xs text-zinc-300 hover:bg-zinc-900 hover:text-zinc-100">
            <Bot className="mr-1 h-3.5 w-3.5" />
            {localize({ zh: '进入聊天', en: 'Chat' }, language)}
          </Button>
          <Button type="button" variant="ghost" size="icon" className="h-7 w-7 rounded-md border border-zinc-800 bg-zinc-950 text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100">
            <MoreHorizontal className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
    </div>
  )
}

function WorkspacePreviewSessionRail({ language }: { language: Language }) {
  return (
    <aside className="flex min-h-0 flex-col overflow-hidden border-r border-zinc-900 bg-[#080809]">
      <div className="flex h-9 items-center border-b border-zinc-900 px-3">
        <div className="flex w-full items-center justify-between gap-3">
          <p className="text-[12px] font-medium text-zinc-400">{localize({ zh: '会话树', en: 'Sessions' }, language)}</p>
          <Button type="button" variant="ghost" className="h-5 w-5 rounded-md p-0 text-zinc-500 hover:bg-zinc-900 hover:text-zinc-100">
            <Plus className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
      <div className="scrollbar-subtle min-h-0 flex-1 space-y-0.5 overflow-y-auto px-1.5 py-1.5">
        {workspacePreviewSessions.map((session) => (
          <div
            key={session.title}
            className={cn(
              'group flex h-9 w-full min-w-0 items-center gap-2 rounded-md px-2.5 transition-colors',
              session.active
                ? 'bg-zinc-900 text-zinc-50 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.04)]'
                : 'text-zinc-500 hover:bg-zinc-950 hover:text-zinc-200',
            )}
            style={session.depth > 0 ? { paddingLeft: `${14 + session.depth * 12}px` } : undefined}
          >
            <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', session.active ? 'bg-zinc-100' : 'bg-zinc-700')} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13px] font-medium">{session.title}</p>
              <p className="truncate text-[10px] text-zinc-600">{session.meta}</p>
            </div>
            {session.badge ? (
              <span className="shrink-0 rounded-full border border-zinc-800 bg-zinc-950 px-1.5 py-0.5 text-[10px] text-zinc-400">
                {session.badge}
              </span>
            ) : null}
          </div>
        ))}
      </div>
    </aside>
  )
}

function WorkspacePreviewMainSplit({ language }: { language: Language }) {
  return (
    <div className="grid min-h-0 grid-cols-[minmax(0,1fr)_17rem] overflow-hidden">
      <WorkspacePreviewChatCanvas language={language} />
      <div className="min-h-0 overflow-hidden border-l border-zinc-800">
        <WorkspacePreviewFilePanel language={language} />
      </div>
    </div>
  )
}

function WorkspacePreviewChatCanvas({ language }: { language: Language }) {
  return (
    <div className="flex min-h-0 flex-col overflow-hidden">
      <div className="border-b border-zinc-800/50 px-4 py-2.5">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-medium text-zinc-200">{localize({ zh: 'AI 对话', en: 'AI Chat' }, language)}</span>
              <span className="text-xs text-zinc-600">{localize({ zh: '修复登录回调 Bug', en: 'Fix auth callback bug' }, language)}</span>
              <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] text-emerald-300">MacBook-Pro · online</span>
            </div>
          </div>
          <Pill tone="amber">68%</Pill>
        </div>
      </div>
      <div className="scrollbar-subtle flex-1 overflow-y-auto bg-[radial-gradient(circle_at_top,rgba(39,39,42,0.28),transparent_40%),linear-gradient(180deg,rgba(9,9,11,0.96),rgba(9,9,11,1))] px-4 py-4">
        <div className="mx-auto flex max-w-3xl flex-col gap-3">
          <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-[11px] uppercase tracking-[0.18em] text-zinc-500">{localize({ zh: '工作区状态', en: 'Workspace Status' }, language)}</p>
                <p className="mt-1 text-sm text-zinc-300">{localize({ zh: '左侧会话树保持主线，右侧文件树同步展示当前 patch 触达面。', en: 'The session tree keeps the main path on the left while the file tree shows the current patch surface on the right.' }, language)}</p>
              </div>
              <Workflow className="h-4 w-4 text-zinc-500" />
            </div>
          </div>
          {workspacePreviewMessages.map((message) => (
            <WorkspacePreviewMessageBubble key={`${message.sender}-${message.meta.zh}`} language={language} message={message} />
          ))}
        </div>
      </div>
      <div className="border-t border-zinc-800/50 bg-zinc-950 p-3">
        <div className="mx-auto max-w-3xl">
          <ChatComposer
            readOnly
            value={localize({ zh: '继续在这个工作区推进 patch，并保持右侧文件树展开。', en: 'Continue the patch in this workspace and keep the file tree expanded on the right.' }, language)}
            className="pr-24"
            shellClassName="pointer-events-auto rounded-2xl border-zinc-800/90 bg-[#08080a] p-2.5 shadow-[0_18px_48px_rgba(0,0,0,0.46),inset_0_1px_0_rgba(255,255,255,0.03)]"
            inputShellClassName="rounded-xl border-zinc-700/70 bg-[#0c0c0f] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.03),0_8px_26px_rgba(0,0,0,0.32)]"
            overlay={(
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-zinc-500 transition-all hover:bg-zinc-800/80 hover:text-zinc-300">
                <Bot className="h-4 w-4" />
              </span>
            )}
            footer={(
              <div className="mt-2.5 flex items-center justify-between rounded-xl border border-zinc-800/80 bg-[#0b0b0e]/95 p-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.035)]">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="rounded-full border border-zinc-800 bg-zinc-950 px-2 py-1 text-[11px] text-zinc-400">@Developer</span>
                  <span className="rounded-full border border-zinc-800 bg-zinc-950 px-2 py-1 text-[11px] text-zinc-400">MacBook-Pro</span>
                  <span className="rounded-full border border-zinc-800 bg-zinc-950 px-2 py-1 text-[11px] text-zinc-400">files split</span>
                </div>
                <Button size="sm" className="h-8 rounded-lg bg-zinc-100 px-3 text-sm font-medium text-zinc-900 hover:bg-white">
                  {localize({ zh: '发送', en: 'Send' }, language)}
                </Button>
              </div>
            )}
          />
        </div>
      </div>
    </div>
  )
}

function WorkspacePreviewMessageBubble({
  language,
  message,
}: {
  language: Language
  message: WorkspacePreviewMessage
}) {
  const isHuman = Boolean(message.human)

  return (
    <div className={cn('flex gap-3', isHuman ? 'justify-end' : 'justify-start')}>
      {!isHuman ? (
        <LandingAgentAvatar
          avatar={message.sender === 'Reviewer' ? 'reviewer' : message.sender === 'Tester' ? 'tester' : 'developer'}
          className="mt-1 size-9 border border-zinc-800 bg-zinc-900"
          fallback="WD"
        />
      ) : null}
      <div className="max-w-[84%]">
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

function WorkspacePreviewFilePanel({ language }: { language: Language }) {
  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-[#09090b]">
      <div className="flex items-center justify-between border-b border-zinc-800/50 px-2.5 py-2.5">
        <div className="inline-flex items-center rounded-md border border-zinc-800/80 bg-[#0f1115]/95 px-2 py-1 text-[10px] uppercase tracking-[0.16em] text-zinc-500">
          {localize({ zh: '文件树', en: 'Files' }, language)}
        </div>
        <FolderTree className="h-4 w-4 text-zinc-500" />
      </div>
      <div className="scrollbar-subtle min-h-0 flex-1 overflow-y-auto p-2.5">
        <div className="space-y-1">
          {workspacePreviewFiles.map((file) => (
            <div
              key={`${file.depth}-${file.label}`}
              className={cn(
                'flex items-center gap-2 rounded-md px-2 py-1.5 text-xs',
                file.active ? 'bg-zinc-900 text-zinc-100' : 'text-zinc-500',
              )}
              style={{ paddingLeft: `${10 + file.depth * 14}px` }}
            >
              {file.depth === 0 ? <ChevronDown className="h-3.5 w-3.5 shrink-0" /> : <FileCode2 className="h-3.5 w-3.5 shrink-0" />}
              <span className="truncate">{file.label}</span>
            </div>
          ))}
        </div>
        <div className="mt-3.5 rounded-xl border border-zinc-800 bg-zinc-950/70 p-2.5">
          <p className="text-[10px] uppercase tracking-[0.18em] text-zinc-500">{localize({ zh: 'Diff 摘要', en: 'Diff Summary' }, language)}</p>
          <div className="mt-3 grid gap-2">
            <InfoCell label="+ Additions" value="18" />
            <InfoCell label="- Deletions" value="6" />
            <InfoCell label={localize({ zh: '文件', en: 'Files' }, language)} value="3" />
          </div>
        </div>
      </div>
    </div>
  )
}

function WorkspacePreviewTerminal({ language }: { language: Language }) {
  return (
    <div className="flex h-full min-h-0 flex-col border-t border-zinc-900 bg-[linear-gradient(180deg,#09090b_0%,#060607_100%)] px-3 py-2.5">
      <div className="flex items-center justify-between gap-3 border-b border-zinc-800/70 pb-2">
        <div className="flex items-center gap-2">
          <div className="flex h-6 w-6 items-center justify-center rounded-lg border border-zinc-800 bg-zinc-950/80">
            <TerminalSquare className="h-3 w-3 text-zinc-400" />
          </div>
          <div>
            <p className="text-[9px] uppercase tracking-[0.2em] text-zinc-500">
              {localize({ zh: '执行快照', en: 'Execution Snapshot' }, language)}
            </p>
            <p className="text-[11px] text-zinc-300">
              {localize({ zh: '终端结果', en: 'Terminal Results' }, language)}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="rounded-full border border-zinc-800 bg-zinc-950/80 px-2 py-0.5 text-[9px] uppercase tracking-[0.14em] text-zinc-500">
            2 cmds
          </span>
          <span className="rounded-full border border-emerald-500/20 bg-emerald-500/8 px-2 py-0.5 text-[8px] uppercase tracking-[0.16em] text-emerald-300">
            {localize({ zh: '已通过', en: 'passed' }, language)}
          </span>
        </div>
      </div>
      <div className="mt-2.5 grid flex-1 grid-cols-2 gap-2">
        {workspacePreviewTerminalCommands.map((entry) => (
          <div
            key={entry.command}
            className="flex h-full min-h-0 flex-col rounded-xl border border-zinc-800/80 bg-[linear-gradient(180deg,rgba(14,14,18,0.98),rgba(8,8,10,0.98))] px-2.5 py-2.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]"
          >
            <div className="flex items-center gap-1.5 font-mono text-[9px] leading-4 text-zinc-300">
              <span className="text-emerald-300">$</span>
              <span className="truncate">{entry.command}</span>
            </div>
            <div className="mt-1.5 flex-1 space-y-1 border-t border-zinc-800/70 pt-1.5">
              {entry.result.map((line) => (
                <div key={line} className="flex items-center gap-1.5 font-mono text-[9px] leading-4 text-zinc-500">
                  <span className="h-1 w-1 shrink-0 rounded-full bg-zinc-700" />
                  <span className="truncate">{line}</span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
