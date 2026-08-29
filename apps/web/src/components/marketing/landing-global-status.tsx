import type { ReactNode } from 'react'

import type { Language } from '../../lib/i18n'

type BilingualText = {
  zh: string
  en: string
}

type ActiveTask = {
  label: BilingualText
  progress: number
}

type WorkerSignal = {
  status: 'online' | 'busy' | 'warning' | 'paused'
}

type BranchRow = {
  name: string
  state: BilingualText
  tone: 'active' | 'merged'
}

type StatusCopy = {
  eyebrow: string
  title: string
  description: string
  activeTasks: string
  running: string
  taskPrefix: string
  workerStatus: string
  branchIsolation: string
  humanApproval: string
  pendingDiff: string
  mainBranch: string
  diffHeader: string
  diffReasoning: string
  rejectChange: string
  approveCommit: string
}

const statusCopy: Record<Language, StatusCopy> = {
  zh: {
    eyebrow: '01 / 控制面状态',
    title: '全域工作状态',
    description: '把看板任务、Agent 会话、Worker 节点、分支隔离和人工审核放在同一个控制面里。人类看得见过程，也拿得住最终判断。',
    activeTasks: '执行中的任务',
    running: '12 个任务运行中',
    taskPrefix: '任务',
    workerStatus: 'Worker 节点状态',
    branchIsolation: '分支隔离',
    humanApproval: '等待人工审核',
    pendingDiff: '待审核 Diff',
    mainBranch: 'main',
    diffHeader: '// Agent 建议调整 worker 执行配置',
    diffReasoning: '// 依据：长任务派到云端，私有仓库改动保留人工确认。',
    rejectChange: '要求重试',
    approveCommit: '确认并合并',
  },
  en: {
    eyebrow: '01 / Control Plane Status',
    title: 'Global Work Status',
    description: 'Keep kanban tasks, agent sessions, worker nodes, branch isolation, and human approvals in one control plane. Humans see the process and keep final judgment.',
    activeTasks: 'Tasks in Flight',
    running: '12 Tasks Running',
    taskPrefix: 'Task',
    workerStatus: 'Worker Node Status',
    branchIsolation: 'Branch Isolation',
    humanApproval: 'Awaiting Human Review',
    pendingDiff: 'Pending Diff',
    mainBranch: 'main',
    diffHeader: '// Agent proposes worker execution config changes',
    diffReasoning: '// Reasoning: route long-running work to cloud capacity while keeping private repo changes under human approval.',
    rejectChange: 'Request Retry',
    approveCommit: 'Approve & Commit',
  },
}

const activeTasks: ActiveTask[] = [
  { label: { zh: '登录回调修复', en: 'AUTH_CALLBACK_FIX' }, progress: 78 },
  { label: { zh: '浏览器回归巡检', en: 'BROWSER_REGRESSION' }, progress: 42 },
  { label: { zh: '发布清单整理', en: 'RELEASE_CHECKLIST' }, progress: 12 },
]

const workerSignals: WorkerSignal[] = [
  { status: 'online' },
  { status: 'busy' },
  { status: 'warning' },
  { status: 'online' },
  { status: 'paused' },
  { status: 'online' },
  { status: 'online' },
  { status: 'busy' },
  { status: 'online' },
  { status: 'online' },
  { status: 'warning' },
  { status: 'online' },
]

const branchRows: BranchRow[] = [
  { name: 'feature/task-chat-session', state: { zh: '隔离中', en: 'Isolated' }, tone: 'active' },
  { name: 'patch/worker-runtime', state: { zh: '已合并', en: 'Merged' }, tone: 'merged' },
  { name: 'docs/release-notes', state: { zh: '隔离中', en: 'Isolated' }, tone: 'active' },
]

const workerSignalClassNames: Record<WorkerSignal['status'], string> = {
  online: 'bg-emerald-500 shadow-[0_0_22px_rgba(16,185,129,0.5)]',
  busy: 'bg-emerald-700 shadow-[0_0_18px_rgba(5,150,105,0.35)]',
  warning: 'bg-amber-500 shadow-[0_0_22px_rgba(245,158,11,0.4)]',
  paused: 'bg-rose-300 shadow-[0_0_22px_rgba(252,165,165,0.35)]',
}

export function LandingGlobalStatus({ language }: { language: Language }) {
  const copy = statusCopy[language]

  return (
    <section
      className="relative border-y border-white/[0.06] bg-[linear-gradient(180deg,rgba(0,0,0,0.14),rgba(8,8,10,0.64)_46%,rgba(0,0,0,0.12))] px-4 py-24 sm:px-6 lg:py-28"
      id="status"
    >
      <div className="pointer-events-none absolute inset-0 opacity-[0.045] [background-image:linear-gradient(rgba(255,255,255,0.82)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.82)_1px,transparent_1px)] [background-size:44px_44px]" />
      <div className="relative mx-auto max-w-[1440px]">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.32em] text-zinc-500">{copy.eyebrow}</p>
          <h2 className="mt-4 text-balance text-5xl font-light tracking-[-0.07em] text-zinc-100 sm:text-6xl">
            {copy.title}
          </h2>
          <p className="mt-3 max-w-4xl text-sm leading-7 text-zinc-500 sm:text-base">{copy.description}</p>
        </div>

        <div className="mt-16 grid gap-5 xl:grid-cols-[minmax(0,2fr)_minmax(22rem,0.98fr)]">
          <StatusPanel className="min-h-[22rem] p-6 sm:p-8">
            <ActiveTasksPanel copy={copy} language={language} />
          </StatusPanel>
          <StatusPanel className="min-h-[22rem] p-6 sm:p-8">
            <WorkerStatusPanel title={copy.workerStatus} />
          </StatusPanel>
        </div>

        <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <StatusPanel className="min-h-[27rem] p-6 sm:p-8">
            <BranchIsolationPanel copy={copy} language={language} />
          </StatusPanel>
          <StatusPanel className="min-h-[27rem] p-6 sm:p-8">
            <ApprovalPanel copy={copy} />
          </StatusPanel>
        </div>
      </div>
    </section>
  )
}

function ActiveTasksPanel({ copy, language }: { copy: StatusCopy; language: Language }) {
  return (
    <div className="flex h-full flex-col">
      <PanelHeader action={copy.running} title={copy.activeTasks} />
      <div className="mt-11 space-y-9">
        {activeTasks.map((task) => (
          <div key={task.label.en}>
            <div className="flex items-center justify-between gap-4 font-mono text-[11px] font-bold uppercase tracking-[0.08em]">
              <span className="text-zinc-300">
                {copy.taskPrefix}: {localize(task.label, language)}
              </span>
              <span className="text-zinc-600">{task.progress}%</span>
            </div>
            <div className="mt-3 h-1 overflow-hidden rounded-full bg-white/[0.08]">
              <div
                className="h-full rounded-full bg-white"
                style={{ width: `${task.progress}%` }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function WorkerStatusPanel({ title }: { title: string }) {
  return (
    <div>
      <PanelHeader title={title} />
      <div className="mt-9 grid grid-cols-3 gap-4 sm:grid-cols-4">
        {workerSignals.map((signal, index) => (
          <div
            className="flex aspect-square min-h-20 items-center justify-center border border-white/[0.06] bg-white/[0.012]"
            key={`${signal.status}-${index}`}
          >
            <span className={`h-3.5 w-3.5 rounded-full ${workerSignalClassNames[signal.status]}`} />
          </div>
        ))}
      </div>
    </div>
  )
}

function BranchIsolationPanel({ copy, language }: { copy: StatusCopy; language: Language }) {
  return (
    <div>
      <PanelHeader title={copy.branchIsolation} />
      <div className="relative mt-12 min-h-[17rem] overflow-hidden">
        <div className="absolute left-6 top-0 h-full w-px bg-white/[0.06]" />
        <div className="absolute left-0 top-1 flex items-center gap-5">
          <span className="relative h-3 w-3 rounded-full border-2 border-zinc-600 bg-[#101012]">
            <span className="absolute left-1/2 top-1/2 h-px w-6 -translate-x-1/2 -translate-y-1/2 bg-zinc-600" />
          </span>
          <span className="h-px w-[72%] bg-white/[0.06]" />
          <span className="rounded bg-white/[0.06] px-3 py-2 font-mono text-[11px] font-bold text-zinc-400">
            {copy.mainBranch}
          </span>
        </div>
        <div className="space-y-5 pt-16 sm:pl-10">
          {branchRows.map((branch) => (
            <BranchCard branch={branch} key={branch.name} language={language} />
          ))}
        </div>
      </div>
    </div>
  )
}

function BranchCard({ branch, language }: { branch: BranchRow; language: Language }) {
  const active = branch.tone === 'active'

  return (
    <div className="relative grid gap-4 pl-11 sm:grid-cols-[1fr_auto] sm:items-center">
      <GitBranchMark active={active} />
      <div
        className={`flex items-center justify-between gap-4 border px-5 py-4 font-mono text-[11px] font-bold uppercase tracking-[0.08em] ${
          active
            ? 'border-white/30 bg-white/[0.11] text-zinc-100 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]'
            : 'border-white/[0.06] bg-white/[0.04] text-zinc-500'
        }`}
      >
        <span className="truncate">{branch.name}</span>
        <span className={active ? 'text-zinc-500' : 'text-zinc-600'}>{localize(branch.state, language)}</span>
      </div>
    </div>
  )
}

function ApprovalPanel({ copy }: { copy: StatusCopy }) {
  return (
    <div className="flex h-full flex-col">
      <PanelHeader action={copy.pendingDiff} actionTone="warning" title={copy.humanApproval} />
      <div className="mt-10 flex-1 border border-white/[0.06] bg-black/25 p-6 font-mono text-[11px] leading-7 text-zinc-600 sm:p-7">
        <p>{copy.diffHeader}</p>
        <div className="mt-5 space-y-1">
          <p>
            <span className="text-rose-300">-</span> <span className="text-zinc-400">worker: macbook-local</span>
          </p>
          <p>
            <span className="text-emerald-400">+</span> <span className="text-emerald-500">worker: cloud-vm</span>
          </p>
          <p>
            <span className="text-rose-300">-</span> <span className="text-zinc-400">review_required: false</span>
          </p>
          <p>
            <span className="text-emerald-400">+</span> <span className="text-emerald-500">review_required: true</span>
          </p>
        </div>
        <p className="mt-7">{copy.diffReasoning}</p>
      </div>
      <div className="mt-7 grid gap-4 sm:grid-cols-2">
        <button className="rounded-lg bg-zinc-900/50 px-5 py-3.5 text-xs font-bold uppercase tracking-[0.06em] text-zinc-400 transition hover:bg-zinc-800/50 hover:text-zinc-200">
          {copy.rejectChange}
        </button>
        <button className="rounded-lg bg-white px-5 py-3.5 text-xs font-bold uppercase tracking-[0.06em] text-black transition hover:bg-zinc-100">
          {copy.approveCommit}
        </button>
      </div>
    </div>
  )
}

function PanelHeader({
  action,
  actionTone = 'accent',
  title,
}: {
  action?: string
  actionTone?: 'accent' | 'warning'
  title: string
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <h3 className="font-mono text-[12px] font-black uppercase tracking-[0.28em] text-zinc-500">{title}</h3>
      {action ? (
        <span
          className={`font-mono text-[11px] font-black uppercase tracking-[0.08em] ${
            actionTone === 'warning'
              ? 'border border-amber-500/45 px-3 py-2 text-amber-500'
              : 'text-zinc-400'
          }`}
        >
          {action}
        </span>
      ) : null}
    </div>
  )
}

function GitBranchMark({ active }: { active: boolean }) {
  return (
    <span className="absolute left-1 top-1/2 flex -translate-y-1/2 items-center gap-0.5">
      <span className={`h-2.5 w-2.5 ${active ? 'bg-white' : 'bg-zinc-700'}`} />
      <span className={`h-2.5 w-2.5 ${active ? 'bg-white' : 'bg-zinc-700/70'}`} />
      <span className="grid gap-0.5">
        <span className={`h-2.5 w-2.5 ${active ? 'bg-white' : 'bg-zinc-700/70'}`} />
        <span className={`h-2.5 w-2.5 ${active ? 'bg-white' : 'bg-zinc-700/70'}`} />
      </span>
    </span>
  )
}

function StatusPanel({ children, className }: { children: ReactNode; className: string }) {
  return (
    <article className={`rounded-2xl border border-white/[0.14] bg-[#0a0a0a]/92 shadow-[inset_0_1px_0_rgba(255,255,255,0.05),0_32px_96px_rgba(0,0,0,0.45),0_0_0_1px_rgba(255,255,255,0.03)] ${className}`}>
      {children}
    </article>
  )
}

function localize(value: BilingualText, language: Language) {
  return value[language]
}
