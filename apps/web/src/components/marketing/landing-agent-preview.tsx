import type { ReactNode } from 'react'

import {
  Activity,
  BrainCircuit,
  Cable,
  Cpu,
  Layers3,
  MessageSquareText,
  Radio,
  ShieldCheck,
  Waypoints,
} from 'lucide-react'

import { InfoCell, Pill, PreviewFrame, TimelineRow, localize } from './landing-product-preview-ui'
import { type LocalizedText, type PreviewViewId, type Tone } from './landing-product-preview-data'
import { LandingAgentAvatar } from './landing-agent-avatar'
import type { Language } from '../../lib/i18n'

type AgentPreviewProfile = {
  viewId: PreviewViewId
  name: string
  initials: string
  role: LocalizedText
  summary: LocalizedText
  category: LocalizedText
  owner: string
  endpoint: string
  runtime: string
  model: string
  status: LocalizedText
  statusTone: Tone
  tasks: string
  success: string
  skills: string[]
  mcpServers: string[]
  workspaceIds: string[]
  channels: string[]
  tags: string[]
  runs: Array<{ time: string; title: string; value: string; tone: Tone }>
  instructions: LocalizedText
}

const settingsTabs = [
  { id: 'overview', label: 'Overview', icon: Layers3 },
  { id: 'runtime', label: 'Runtime', icon: Cpu },
  { id: 'skills', label: 'Skills', icon: BrainCircuit },
  { id: 'mcp', label: 'MCP', icon: Cable },
  { id: 'channels', label: 'Channels', icon: Radio },
  { id: 'workspace', label: 'Workspace', icon: Waypoints },
  { id: 'chat', label: 'Chat', icon: MessageSquareText },
  { id: 'activity', label: 'Activity', icon: Activity },
]

const agentProfiles: Record<'agent-developer' | 'agent-tester' | 'agent-reviewer', AgentPreviewProfile> = {
  'agent-developer': {
    viewId: 'agent-developer',
    name: 'Developer',
    initials: 'DE',
    role: { zh: '产品代码交付 Agent', en: 'Product coding delivery agent' },
    summary: { zh: '负责需求实现、Bug 修复、重构和 patch 总结。', en: 'Owns feature implementation, bug fixes, refactors, and patch summaries.' },
    category: { zh: '开发', en: 'Development' },
    owner: 'Product Engineering',
    endpoint: 'inherit://worker-runtime',
    runtime: 'Codex',
    model: 'gpt-5.4',
    status: { zh: '启用', en: 'Enabled' },
    statusTone: 'emerald',
    tasks: '4',
    success: '96%',
    skills: ['code', 'debug-pro', 'git-essentials'],
    mcpServers: ['GitHub', 'Browser'],
    workspaceIds: ['wemux-console', 'auth-flow-fix'],
    channels: ['Agent Chat', '@mention'],
    tags: ['frontend', 'backend', 'patch'],
    runs: [
      { time: '09:41', title: 'complete', value: 'auth-flow-fix', tone: 'emerald' },
      { time: '10:02', title: 'executing', value: 'integration-regression', tone: 'amber' },
      { time: '10:12', title: '@mention', value: 'release-note-draft', tone: 'sky' },
    ],
    instructions: { zh: '优先给出最小可验证 patch，修改前说明风险，完成后附验证清单。', en: 'Prefer minimal verifiable patches, call out risk before editing, and finish with validation notes.' },
  },
  'agent-tester': {
    viewId: 'agent-tester',
    name: 'Tester',
    initials: 'TE',
    role: { zh: '测试与浏览器巡检 Agent', en: 'Testing and browser inspection agent' },
    summary: { zh: '负责启动环境、跑测试、浏览器巡检和问题记录。', en: 'Starts environments, runs tests, performs browser checks, and records issues.' },
    category: { zh: '质量', en: 'Quality' },
    owner: 'QA Guild',
    endpoint: 'inherit://browser-worker',
    runtime: 'OpenCode',
    model: 'default',
    status: { zh: '启用', en: 'Enabled' },
    statusTone: 'emerald',
    tasks: '3',
    success: '93%',
    skills: ['test-runner', 'browser-use', 'debug-pro'],
    mcpServers: ['Browser', 'Filesystem'],
    workspaceIds: ['checkout-flow', 'mobile-review'],
    channels: ['Agent Chat', 'Review Notes'],
    tags: ['e2e', 'browser', 'regression'],
    runs: [
      { time: '09:58', title: 'browser', value: 'checkout-flow', tone: 'amber' },
      { time: '10:15', title: 'failed', value: 'payment-modal', tone: 'rose' },
      { time: '10:27', title: 'record', value: 'screenshot-attached', tone: 'sky' },
    ],
    instructions: { zh: '先复现再判断，不静默吞错；每次巡检都要留下步骤、截图和风险等级。', en: 'Reproduce before judging, never hide failures, and keep steps, screenshots, and risk level for each check.' },
  },
  'agent-reviewer': {
    viewId: 'agent-reviewer',
    name: 'Reviewer',
    initials: 'RV',
    role: { zh: '代码审核与风险提示 Agent', en: 'Code review and risk analysis agent' },
    summary: { zh: '负责审查 Diff、提示风险、生成验证清单和上线建议。', en: 'Reviews diffs, flags risk, produces validation checklists, and release guidance.' },
    category: { zh: '审核', en: 'Review' },
    owner: 'Core Team',
    endpoint: 'inherit://review-worker',
    runtime: 'Claude Code',
    model: 'sonnet-review',
    status: { zh: '启用', en: 'Enabled' },
    statusTone: 'emerald',
    tasks: '5',
    success: '98%',
    skills: ['security-auditor', 'code', 'test-runner'],
    mcpServers: ['GitHub', 'Postgres'],
    workspaceIds: ['api-refactor', 'release-review'],
    channels: ['Diff Review', '@mention'],
    tags: ['review', 'risk', 'release'],
    runs: [
      { time: '09:33', title: 'review', value: 'api-refactor-diff', tone: 'violet' },
      { time: '09:49', title: 'risk', value: 'missing-migration-test', tone: 'amber' },
      { time: '10:08', title: 'approve', value: 'worker-guide-update', tone: 'emerald' },
    ],
    instructions: { zh: '只报告可行动风险；把阻塞项、建议项和可接受风险分开写。', en: 'Report actionable risks only; separate blockers, recommendations, and acceptable risk.' },
  },
}

export function LandingAgentPreview({ language, view }: { language: Language; view: PreviewViewId }) {
  const profile = getAgentProfile(view)

  return (
    <PreviewFrame>
      <div className="flex min-h-0 flex-1">
        <AgentDetailPanel language={language} profile={profile} />
      </div>
    </PreviewFrame>
  )
}

function AgentDetailPanel({ language, profile }: { language: Language; profile: AgentPreviewProfile }) {
  return (
    <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950/75">
      <div className="flex flex-wrap gap-1.5 border-b border-zinc-800 bg-[#09090b] p-3">
        {settingsTabs.map(({ id, label, icon: Icon }) => (
          <span
            className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs ${id === 'overview' ? 'bg-zinc-100 text-zinc-950' : 'text-zinc-500'}`}
            key={id}
          >
            <Icon size={14} />
            {label}
          </span>
        ))}
      </div>
      <div className="min-h-0 flex-1 space-y-4 overflow-hidden p-4">
        <AgentIdentityCard language={language} profile={profile} />
        <div className="grid grid-cols-4 gap-3">
          <InfoCell label={localize({ zh: '任务', en: 'Tasks' }, language)} value={profile.tasks} />
          <InfoCell label={localize({ zh: 'Skills', en: 'Skills' }, language)} value={String(profile.skills.length)} />
          <InfoCell label={localize({ zh: 'MCP', en: 'MCP' }, language)} value={String(profile.mcpServers.length)} />
          <InfoCell label={localize({ zh: '成功率', en: 'Success' }, language)} value={profile.success} />
        </div>
        <div className="grid min-h-0 grid-cols-[1.05fr_0.95fr] gap-3">
          <AgentConfigPreview language={language} profile={profile} />
          <AgentActivityPreview language={language} profile={profile} />
        </div>
      </div>
    </section>
  )
}

function AgentIdentityCard({ language, profile }: { language: Language; profile: AgentPreviewProfile }) {
  return (
    <div className="rounded-xl border border-zinc-800 bg-[#09090b] p-4">
      <div className="flex flex-row items-start justify-between gap-4">
        <div className="flex min-w-0 items-start gap-3">
          <span className="relative flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl border border-zinc-800 bg-zinc-900 text-lg font-black text-zinc-950">
            <LandingAgentAvatar avatar={profile.viewId === 'agent-tester' ? 'tester' : profile.viewId === 'agent-reviewer' ? 'reviewer' : 'developer'} className="h-full w-full rounded-2xl" fallback={profile.initials} />
            <span className="absolute bottom-1 right-1 h-3 w-3 rounded-full border-2 border-[#09090b] bg-emerald-400" />
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-xl font-semibold tracking-tight text-zinc-50">{profile.name} Agent</h2>
              <Pill tone={profile.statusTone}>{localize(profile.status, language)}</Pill>
            </div>
            <p className="mt-1 text-sm text-zinc-400">{localize(profile.role, language)}</p>
            <p className="mt-2 max-w-2xl text-xs leading-5 text-zinc-500">{localize(profile.summary, language)}</p>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {profile.tags.map((tag) => (
                <span className="rounded-full border border-zinc-800 bg-zinc-950 px-2 py-1 text-[10px] text-zinc-400" key={tag}>{tag}</span>
              ))}
            </div>
          </div>
        </div>
        <div className="grid min-w-[13rem] gap-2 text-xs">
          <FieldChip label="Runtime" value={profile.runtime} />
          <FieldChip label="Model" value={profile.model} />
        </div>
      </div>
      <div className="mt-4 grid grid-cols-4 gap-3">
        <FormCell label={localize({ zh: '名称', en: 'Name' }, language)} value={profile.name} />
        <FormCell label={localize({ zh: '分类', en: 'Category' }, language)} value={localize(profile.category, language)} />
        <FormCell label="Owner" value={profile.owner} />
        <FormCell label="Endpoint" value={profile.endpoint} />
      </div>
    </div>
  )
}

function AgentConfigPreview({ language, profile }: { language: Language; profile: AgentPreviewProfile }) {
  return (
    <div className="space-y-3">
      <PanelShell title={localize({ zh: '能力配置', en: 'Capability Config' }, language)}>
        <ConfigLine icon={<Cpu className="h-4 w-4" />} label="Runtime" value={`${profile.runtime} · ${profile.model}`} />
        <ConfigLine icon={<BrainCircuit className="h-4 w-4" />} label="Skills" value={profile.skills.join(' · ')} />
        <ConfigLine icon={<Cable className="h-4 w-4" />} label="MCP" value={profile.mcpServers.join(' · ')} />
        <ConfigLine icon={<Waypoints className="h-4 w-4" />} label="Workspace" value={profile.workspaceIds.join(' · ')} />
      </PanelShell>
      <PanelShell title={localize({ zh: '长期指令', en: 'Long-running Instructions' }, language)}>
        <div className="rounded-lg border border-zinc-800 bg-zinc-950/70 p-3 text-xs leading-5 text-zinc-400">
          {localize(profile.instructions, language)}
        </div>
      </PanelShell>
    </div>
  )
}

function AgentActivityPreview({ language, profile }: { language: Language; profile: AgentPreviewProfile }) {
  return (
    <div className="space-y-3">
      <PanelShell title={localize({ zh: '最近 Runs', en: 'Recent Runs' }, language)}>
        {profile.runs.map((run) => (
          <TimelineRow key={`${run.time}-${run.value}`} tone={run.tone} time={run.time} title={run.title} value={run.value} />
        ))}
      </PanelShell>
      <PanelShell title={localize({ zh: '策略开关', en: 'Policy Switches' }, language)}>
        <PolicyRow checked label={localize({ zh: '允许写文件', en: 'Can write files' }, language)} />
        <PolicyRow checked label={localize({ zh: '允许跑命令', en: 'Can run commands' }, language)} />
        <PolicyRow checked={profile.name !== 'Developer'} label={localize({ zh: '输出需审批', en: 'Approval required' }, language)} />
      </PanelShell>
    </div>
  )
}

function PanelShell({ children, title }: { children: ReactNode; title: string }) {
  return (
    <div className="space-y-3 rounded-xl border border-zinc-800 bg-[#09090b] p-4">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500">{title}</p>
      {children}
    </div>
  )
}

function ConfigLine({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-zinc-800 bg-zinc-950/70 px-3 py-2 text-xs">
      <span className="text-zinc-500">{icon}</span>
      <span className="w-20 shrink-0 text-zinc-500">{label}</span>
      <span className="min-w-0 truncate text-zinc-300">{value}</span>
    </div>
  )
}

function FieldChip({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-zinc-800 bg-zinc-950/70 px-3 py-2">
      <span className="text-zinc-500">{label}</span>
      <span className="font-mono text-[11px] text-zinc-200">{value}</span>
    </div>
  )
}

function FormCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-950/70 px-3 py-2">
      <p className="text-[10px] uppercase tracking-[0.16em] text-zinc-600">{label}</p>
      <p className="mt-1 truncate text-xs text-zinc-300">{value}</p>
    </div>
  )
}

function PolicyRow({ checked, label }: { checked: boolean; label: string }) {
  return (
    <div className="flex items-center justify-between rounded-lg border border-zinc-800 bg-zinc-950/70 px-3 py-2 text-xs text-zinc-400">
      <span>{label}</span>
      <span className={`h-5 w-9 rounded-full p-0.5 ${checked ? 'bg-emerald-500/30' : 'bg-zinc-800'}`}>
        <span className={`block h-4 w-4 rounded-full ${checked ? 'ml-4 bg-emerald-300' : 'bg-zinc-500'}`} />
      </span>
    </div>
  )
}

function SmallBadge({ children }: { children: ReactNode }) {
  return <span className="rounded-full border border-zinc-800 bg-zinc-950 px-2 py-0.5 text-[10px] text-zinc-400">{children}</span>
}

function getAgentProfile(view: PreviewViewId) {
  if (view === 'agent-tester' || view === 'agent-reviewer') {
    return agentProfiles[view]
  }

  return agentProfiles['agent-developer']
}
