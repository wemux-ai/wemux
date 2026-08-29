import { useState } from 'react'
import type { ReactNode } from 'react'

import {
  Bot,
  Cable,
  ChevronDown,
  ChevronRight,
  Cpu,
  FileCode2,
  FileText,
  Folder,
  Import,
  Plus,
  RefreshCcw,
  Save,
  Search,
  ShieldCheck,
  Sparkles,
  Trash2,
  Wrench,
} from 'lucide-react'
import { Switch } from '../ui/switch'

import { InfoCell, Pill, PreviewFrame, localize } from './landing-product-preview-ui'
import type { LocalizedText, Tone } from './landing-product-preview-data'
import type { Language } from '../../lib/i18n'

type SkillItem = {
  name: string
  description: LocalizedText
  slug: string
  source: string
  sourceTone: Tone
  active?: boolean
}

type McpItem = {
  name: string
  target: string
  transport: string
  capability: string
  tone: Tone
  active?: boolean
}

const globalSkills: SkillItem[] = [
  {
    name: 'test-runner',
    description: { zh: '编写并运行单元、集成和端到端测试。', en: 'Write and run unit, integration, and end-to-end tests.' },
    slug: 'test-runner',
    source: 'global',
    sourceTone: 'emerald',
    active: true,
  },
  {
    name: 'browser-use',
    description: { zh: '用浏览器巡检本地页面、截图并记录异常。', en: 'Inspect local pages in browser, capture screenshots, and record issues.' },
    slug: 'browser-use',
    source: 'global',
    sourceTone: 'sky',
  },
]

const projectSkills: SkillItem[] = [
  {
    name: 'copywriting',
    description: { zh: '为落地页、邮件和发布说明生成行动导向文案。', en: 'Create action-oriented copy for landing pages, emails, and release notes.' },
    slug: 'copywriting',
    source: 'project',
    sourceTone: 'violet',
  },
]

const mcpServers: McpItem[] = [
  { name: 'github', target: 'stdio://gh-mcp', transport: 'stdio', capability: 'resources+tools', tone: 'violet', active: true },
  { name: 'filesystem', target: 'http://127.0.0.1:7001/mcp', transport: 'http', capability: 'resources', tone: 'emerald' },
  { name: 'browser', target: 'local browser tools', transport: 'custom', capability: 'resources+tools', tone: 'sky' },
]

export function LandingSkillsPreview({ language }: { language: Language }) {
  const [skillsEnabled, setSkillsEnabled] = useState<Record<string, boolean>>({
    'test-runner': true,
    'browser-use': false,
    'copywriting': false,
  })

  const handleToggleSkill = (name: string, enabled: boolean) => {
    setSkillsEnabled((prev) => ({ ...prev, [name]: enabled }))
  }

  const globalItems = globalSkills.map((s) => ({ ...s, active: skillsEnabled[s.name] ?? s.active }))
  const projectItems = projectSkills.map((s) => ({ ...s, active: skillsEnabled[s.name] ?? s.active }))

  return (
    <PreviewFrame>
      <div className="grid min-h-0 flex-1 grid-cols-[19rem_18rem_minmax(0,1fr)] overflow-hidden rounded-[1.25rem] border border-zinc-800 bg-[radial-gradient(circle_at_top_left,rgba(24,24,27,0.96),rgba(9,9,11,0.98)_60%)]">
        <SkillLibraryColumn language={language} onToggle={handleToggleSkill} globalItems={globalItems} projectItems={projectItems} />
        <SkillSideColumn language={language} />
        <SkillSourceColumn />
      </div>
    </PreviewFrame>
  )
}

export function LandingMcpPreview({ language }: { language: Language }) {
  return (
    <PreviewFrame>
      <div className="grid min-h-0 flex-1 grid-cols-[20rem_minmax(0,1fr)] overflow-hidden rounded-[1.25rem] border border-zinc-800 bg-[radial-gradient(circle_at_top_left,rgba(24,24,27,0.96),rgba(9,9,11,0.98)_60%)]">
        <McpRegistryColumn language={language} />
        <McpDetailColumn language={language} />
      </div>
    </PreviewFrame>
  )
}

function SkillLibraryColumn({ language, onToggle, globalItems, projectItems }: {
  language: Language
  onToggle: (name: string, enabled: boolean) => void
  globalItems: SkillItem[]
  projectItems: SkillItem[]
}) {
  return (
    <aside className="flex min-h-0 flex-col border-r border-zinc-800">
      <div className="border-b border-zinc-800 px-5 py-5">
        <PanelHero
          icon={<Bot size={18} />}
          kicker="Skill Library"
          title={localize({ zh: '组织技能库', en: 'Organization Skill Library' }, language)}
          description={localize({ zh: '全局 Skill 可被所有项目复用；项目 Skill 只在所属项目生效。', en: 'Global skills are reusable across projects; project skills stay scoped.' }, language)}
        />
        <div className="mt-4 grid gap-2">
          <ActionButton icon={<Import size={15} />} label={localize({ zh: '引入 Skill', en: 'Import Skill' }, language)} primary />
          <ActionButton icon={<Plus size={15} />} label={localize({ zh: '新建 Skill', en: 'New Skill' }, language)} />
        </div>
        <SearchPreview label={localize({ zh: '按名称、slug、来源过滤', en: 'Filter by name, slug, or source' }, language)} />
        <div className="mt-4 rounded-2xl border border-zinc-800 bg-zinc-950 px-4 py-3 text-xs leading-5 text-zinc-500">
          {localize({ zh: '3 个 Skill · 2 个全局 · 1 个项目范围', en: '3 skills · 2 global · 1 project-scoped' }, language)}
        </div>
      </div>
      <div className="min-h-0 flex-1 space-y-4 overflow-hidden p-3">
        <SkillSection items={globalItems} language={language} title={localize({ zh: '全局 Skills', en: 'Global Skills' }, language)} onToggle={onToggle} />
        <SkillSection items={projectItems} language={language} title={localize({ zh: '项目 Skills', en: 'Project Skills' }, language)} onToggle={onToggle} />
      </div>
    </aside>
  )
}

function SkillSideColumn({ language }: { language: Language }) {
  return (
    <section className="flex min-h-0 flex-col border-r border-zinc-800 bg-zinc-950/30">
      <div className="border-b border-zinc-800">
        <CompactSkillMeta language={language} />
      </div>
      <CompactFileTree />
    </section>
  )
}

function CompactSkillMeta({ language }: { language: Language }) {
  return (
    <div className="space-y-3 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <Pill tone="emerald">{localize({ zh: '全局 Skill', en: 'Global Skill' }, language)}</Pill>
          <h3 className="mt-3 truncate text-xl font-semibold text-zinc-50">test-runner</h3>
          <p className="mt-1 line-clamp-2 max-w-2xl text-xs leading-5 text-zinc-500">
            {localize({ zh: '编写、运行和修复测试的标准工作流。', en: 'Standard workflow for writing, running, and fixing tests.' }, language)}
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          <IconBox icon={<RefreshCcw size={15} />} />
          <IconBox icon={<Trash2 size={15} />} danger />
        </div>
      </div>
      <div className="grid gap-2">
        <InfoCell label="Key" value="test-runner" />
        <InfoCell label={localize({ zh: '更新时间', en: 'Updated' }, language)} value="09:41" />
        <FormPreview label="slug" value="test-runner" mono />
        <ActionButton icon={<Save size={15} />} label={localize({ zh: '保存', en: 'Save' }, language)} primary />
      </div>
    </div>
  )
}

function CompactFileTree() {
  return (
    <aside className="min-h-0 flex-1 p-4">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold uppercase tracking-[0.22em] text-zinc-500">Files</p>
        <FileCode2 className="h-4 w-4 text-zinc-500" />
      </div>
      <div className="mt-3 space-y-1.5">
        <FileTreeRow active icon={<FileText size={14} />} label="SKILL.md" />
        <FileTreeRow icon={<Folder size={14} />} label="references" />
        <FileTreeRow nested icon={<FileText size={14} />} label="checklist.md" />
        <FileTreeRow icon={<Folder size={14} />} label="scripts" />
        <FileTreeRow nested icon={<FileText size={14} />} label="run-tests.ts" />
      </div>
    </aside>
  )
}

function SkillSourceColumn() {
  return (
    <section className="min-h-0 bg-zinc-950/20 p-4">
      <div className="flex h-full min-h-[34rem] flex-col rounded-xl border border-zinc-800 bg-zinc-950/70">
        <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-3">
          <p className="font-mono text-sm font-semibold text-zinc-200">SKILL.md</p>
          <Pill tone="zinc">markdown</Pill>
        </div>
        <div className="flex-1 overflow-hidden p-6 font-mono text-xs leading-7 text-zinc-400">
          <div className="max-w-3xl whitespace-pre-wrap">
            <p className="text-zinc-100"># test-runner</p>
            <p className="mt-5">Use when adding, running, or debugging tests.</p>
            <p className="mt-5">## Workflow</p>
            <p className="mt-2">- Prefer focused test commands first.</p>
            <p>- Capture failures with exact output.</p>
            <p>- Summarize verification before handoff.</p>
            <p>- Start with the smallest command that exercises the changed surface.</p>
            <p>- If a test fails, preserve the exact command and failure output.</p>
            <p className="mt-5">## Output</p>
            <p className="mt-2">Return the command, result, and next recommended verification step.</p>
          </div>
        </div>
      </div>
    </section>
  )
}

function McpRegistryColumn({ language }: { language: Language }) {
  return (
    <aside className="flex min-h-0 flex-col border-r border-zinc-800">
      <div className="border-b border-zinc-800 px-5 py-5">
        <PanelHero
          icon={<Wrench size={18} />}
          kicker={localize({ zh: 'MCP 注册表', en: 'MCP Registry' }, language)}
          title={localize({ zh: '全局 MCP', en: 'Global MCP' }, language)}
        />
        <div className="mt-4 grid gap-2">
          <ActionButton icon={<Plus size={15} />} label={localize({ zh: '新建 MCP', en: 'New MCP' }, language)} primary />
          <ActionButton icon={<Save size={15} />} label={localize({ zh: '保存全局配置', en: 'Save Global Config' }, language)} />
        </div>
        <SearchPreview label={localize({ zh: '按名称、target、transport 过滤', en: 'Filter by name, target, or transport' }, language)} />
        <div className="mt-4 rounded-2xl border border-zinc-800 bg-zinc-950 px-4 py-3 text-xs leading-5 text-zinc-500">
          {localize({ zh: '3 个 MCP · 2 个启用 · 1 个系统托管', en: '3 MCPs · 2 enabled · 1 system-managed' }, language)}
        </div>
      </div>
      <div className="min-h-0 flex-1 space-y-3 overflow-hidden p-3">
        {mcpServers.map((server) => (
          <McpListItem key={server.name} server={server} />
        ))}
      </div>
    </aside>
  )
}

function McpDetailColumn({ language }: { language: Language }) {
  return (
    <section className="flex min-h-0 flex-col bg-zinc-950/30">
      <div className="border-b border-zinc-800 px-5 py-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <Pill tone="violet">{localize({ zh: '全局 MCP', en: 'Global MCP' }, language)}</Pill>
            <h3 className="mt-4 truncate text-2xl font-semibold text-zinc-50">github</h3>
          </div>
          <EnabledPreview language={language} />
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <Pill tone="violet">stdio</Pill>
          <Pill tone="emerald">resources+tools</Pill>
          <Pill tone="zinc">{localize({ zh: '自定义', en: 'Custom' }, language)}</Pill>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-5 p-5">
        <SectionCard icon={<Cable className="h-4 w-4" />} title={localize({ zh: '连接信息', en: 'Connection' }, language)}>
          <FormPreview label={localize({ zh: '服务名称', en: 'Server name' }, language)} value="github" />
          <FormPreview label="Target" value="stdio://gh-mcp" mono />
        </SectionCard>
        <SectionCard icon={<Cpu className="h-4 w-4" />} title={localize({ zh: '能力策略', en: 'Capability Policy' }, language)}>
          <SelectField label={localize({ zh: '传输方式', en: 'Transport' }, language)} value="stdio" />
          <SelectField label={localize({ zh: '能力模式', en: 'Capability mode' }, language)} value="resources+tools" />
        </SectionCard>
        <SectionCard icon={<Sparkles className="h-4 w-4" />} title={localize({ zh: '能力预览', en: 'Capabilities' }, language)}>
          <CapabilityRow label="resources" value="repos · issues · pull requests" />
          <CapabilityRow label="tools" value="create_issue · comment_pr · search_code" />
        </SectionCard>
        <SectionCard icon={<ShieldCheck className="h-4 w-4" />} title={localize({ zh: '危险操作', en: 'Danger Zone' }, language)}>
          <button className="w-full rounded-xl border border-rose-500/20 bg-rose-500/10 px-4 py-3 text-xs text-rose-200" type="button">
            {localize({ zh: '移除这个 MCP', en: 'Remove this MCP' }, language)}
          </button>
        </SectionCard>
      </div>
    </section>
  )
}

function SkillSection({ items, language, title, onToggle }: { items: SkillItem[]; language: Language; title: string; onToggle?: (name: string, enabled: boolean) => void }) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 px-1 text-[11px] uppercase tracking-[0.22em] text-zinc-500">
        <ChevronDown size={12} />
        {title}
        <span className="text-[10px] tracking-normal text-zinc-600">{items.length}</span>
      </div>
      {items.map((skill) => (
        <SkillListItem key={skill.name} language={language} skill={skill} onToggle={onToggle} />
      ))}
    </div>
  )
}

function SkillListItem({ language, skill, onToggle }: { language: Language; skill: SkillItem; onToggle?: (name: string, enabled: boolean) => void }) {
  return (
    <button
      className={`w-full rounded-[1.25rem] border px-4 py-4 text-left transition-colors ${skill.active ? 'border-zinc-700 bg-zinc-900 text-zinc-100 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.04)]' : 'border-zinc-800 bg-[#09090b] text-zinc-100'}`}
      type="button"
      onClick={() => onToggle?.(skill.name, !skill.active)}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold">{skill.name}</div>
          <div className={`mt-2 line-clamp-2 text-xs leading-5 ${skill.active ? 'text-zinc-300' : 'text-zinc-500'}`}>
            {localize(skill.description, language)}
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <Pill tone={skill.sourceTone}>{skill.source}</Pill>
            <span className={`text-[11px] ${skill.active ? 'text-zinc-300' : 'text-zinc-500'}`}>{skill.slug}</span>
          </div>
        </div>
        <div className="flex items-center" onClick={(e) => e.stopPropagation()}>
          <Switch
            checked={skill.active}
            onCheckedChange={(checked) => onToggle?.(skill.name, checked)}
            className="scale-75"
          />
        </div>
      </div>
    </button>
  )
}

function McpListItem({ server }: { server: McpItem }) {
  return (
    <button
      className={`w-full rounded-[1.25rem] border px-4 py-4 text-left transition-colors ${server.active ? 'border-zinc-700 bg-zinc-900 text-zinc-100 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.04)]' : 'border-zinc-800 bg-[#09090b] text-zinc-100'}`}
      type="button"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold">{server.name}</div>
          <div className={`mt-2 line-clamp-2 text-xs leading-5 ${server.active ? 'text-zinc-300' : 'text-zinc-500'}`}>{server.target}</div>
          <div className="mt-3 flex flex-wrap gap-2">
            <Pill tone={server.tone}>{server.transport}</Pill>
            <Pill tone="emerald">{server.capability}</Pill>
          </div>
        </div>
        <div className="flex flex-col items-end gap-2">
          <Pill tone={server.active ? 'emerald' : 'zinc'}>{server.active ? 'Enabled' : 'Disabled'}</Pill>
          <ChevronRight size={14} className={server.active ? 'text-zinc-300' : 'text-zinc-500'} />
        </div>
      </div>
    </button>
  )
}

function PanelHero({
  description,
  icon,
  kicker,
  title,
}: {
  description?: string
  icon: ReactNode
  kicker: string
  title: string
}) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div>
        <p className="text-xs uppercase tracking-[0.28em] text-zinc-500">{kicker}</p>
        <h2 className="mt-2 text-xl font-semibold text-zinc-50">{title}</h2>
        {description ? <p className="mt-2 text-sm leading-6 text-zinc-500">{description}</p> : null}
      </div>
      <div className="rounded-2xl border border-zinc-700 bg-zinc-900 p-2 text-zinc-100">{icon}</div>
    </div>
  )
}

function ActionButton({ icon, label, primary }: { icon: ReactNode; label: string; primary?: boolean }) {
  return (
    <button
      className={`inline-flex w-full items-center justify-center gap-2 rounded-full border px-4 py-2 text-xs ${primary ? 'border-zinc-700 bg-zinc-900 text-zinc-100' : 'border-zinc-800 bg-zinc-950 text-zinc-200'}`}
      type="button"
    >
      {icon}
      {label}
    </button>
  )
}

function SearchPreview({ label }: { label: string }) {
  return (
    <div className="relative mt-4">
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
      <div className="rounded-lg border border-zinc-800 bg-[#09090b] py-2 pl-9 pr-3 text-xs text-zinc-600">{label}</div>
    </div>
  )
}

function IconBox({ danger, icon }: { danger?: boolean; icon: ReactNode }) {
  return (
    <span className={`rounded-xl border border-zinc-800 bg-zinc-950 p-2 ${danger ? 'text-rose-300' : 'text-zinc-300'}`}>
      {icon}
    </span>
  )
}

function FormPreview({ label, mono, tall, value }: { label: string; mono?: boolean; tall?: boolean; value: string }) {
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2">
      <p className="text-[10px] uppercase tracking-[0.18em] text-zinc-600">{label}</p>
      <p className={`${tall ? 'min-h-16' : ''} mt-2 truncate text-xs leading-5 text-zinc-200 ${mono ? 'font-mono' : ''}`}>{value}</p>
    </div>
  )
}

function FileTreeRow({ active, icon, label, nested }: { active?: boolean; icon: ReactNode; label: string; nested?: boolean }) {
  return (
    <div className={`flex items-center gap-2 rounded-lg px-3 py-2 text-xs ${nested ? 'ml-4' : ''} ${active ? 'bg-zinc-900 text-zinc-100' : 'text-zinc-500'}`}>
      {icon}
      <span className="truncate">{label}</span>
    </div>
  )
}

function SectionCard({ children, icon, title }: { children: ReactNode; icon: ReactNode; title: string }) {
  return (
    <section className="space-y-3 rounded-2xl border border-zinc-800 bg-[#09090b] p-4">
      <div className="flex items-center gap-2 text-sm font-semibold text-zinc-100">
        <span className="text-zinc-500">{icon}</span>
        {title}
      </div>
      {children}
    </section>
  )
}

function EnabledPreview({ language }: { language: Language }) {
  return (
    <div className="flex overflow-hidden rounded-full border border-zinc-800 bg-zinc-950 p-1 text-xs">
      <span className="rounded-full bg-emerald-500/20 px-3 py-1 text-emerald-200">{localize({ zh: '启用', en: 'Enabled' }, language)}</span>
      <span className="px-3 py-1 text-zinc-500">{localize({ zh: '禁用', en: 'Disabled' }, language)}</span>
    </div>
  )
}

function SelectField({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2">
      <p className="text-[10px] uppercase tracking-[0.18em] text-zinc-600">{label}</p>
      <p className="mt-2 flex items-center justify-between text-xs text-zinc-200">
        {value}
        <ChevronDown className="h-3.5 w-3.5 text-zinc-500" />
      </p>
    </div>
  )
}

function CapabilityRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2">
      <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-600">{label}</p>
      <p className="mt-2 truncate text-xs text-zinc-300">{value}</p>
    </div>
  )
}
