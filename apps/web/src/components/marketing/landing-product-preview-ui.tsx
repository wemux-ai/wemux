import type { ReactNode } from 'react'

import { Plus, Search } from 'lucide-react'

import { toneClassNames, type LocalizedText, type Tone } from './landing-product-preview-data'
import type { Language } from '../../lib/i18n'

export function PreviewFrame({ children }: { children: ReactNode }) {
  return <div className="flex h-full min-h-[calc(42rem-3.5rem)] flex-1 flex-col space-y-4 p-4">{children}</div>
}

export function SplitShell({ left, right }: { left: ReactNode; right: ReactNode }) {
  return (
    <div className="grid h-full min-h-[calc(42rem-3.5rem)] flex-1 grid-cols-[20rem_1fr]">
      <aside className="h-full border-r border-zinc-800 bg-[#09090b] p-4">{left}</aside>
      <section className="h-full min-w-0 bg-zinc-950/30">{right}</section>
    </div>
  )
}

export function HeroPanel({
  action,
  badge,
  description,
  language,
  title,
}: {
  action: LocalizedText
  badge: LocalizedText
  description: LocalizedText
  language: Language
  title: LocalizedText
}) {
  return (
    <section className="rounded-xl border border-zinc-800 bg-[linear-gradient(135deg,rgba(24,24,27,0.98),rgba(9,9,11,0.92))] p-5">
      <div className="flex flex-row items-end justify-between gap-4">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-3 py-1 text-[10px] font-medium uppercase tracking-[0.22em] text-emerald-300">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
            {localize(badge, language)}
          </div>
          <h2 className="mt-4 text-2xl font-semibold tracking-tight text-zinc-50">{localize(title, language)}</h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-400">{localize(description, language)}</p>
        </div>
        <button className="inline-flex w-max items-center gap-2 rounded-full bg-zinc-100 px-4 py-2 text-xs font-semibold text-zinc-950" type="button">
          <Plus className="h-3.5 w-3.5" />
          {localize(action, language)}
        </button>
      </div>
    </section>
  )
}

export function MetricGrid({ language, metrics }: { language: Language; metrics: Array<[string, LocalizedText, Tone]> }) {
  return (
    <div className="grid grid-cols-4 gap-2">
      {metrics.map(([value, label, tone]) => (
        <div key={label.zh} className="rounded-xl border border-zinc-800 bg-zinc-950/65 p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-2xl font-semibold text-zinc-50">{value}</p>
              <p className="mt-1 text-xs text-zinc-400">{localize(label, language)}</p>
            </div>
            <span className={`mt-1 h-2 w-2 rounded-full ${toneClassNames[tone].dot}`} />
          </div>
        </div>
      ))}
    </div>
  )
}

export function MiniPanel({ children, title }: { children: ReactNode; title: string }) {
  return (
    <section className="rounded-xl border border-zinc-800 bg-zinc-950/65 p-4">
      <p className="mb-3 text-[10px] font-semibold uppercase tracking-[0.22em] text-zinc-500">{title}</p>
      <div className="space-y-2">{children}</div>
    </section>
  )
}

export function ChartPanel({ title, tone }: { title: string; tone: Tone }) {
  return (
    <MiniPanel title={title}>
      <div className="flex h-20 items-end gap-1">
        {[20, 46, 32, 72, 58, 84, 40, 68, 54, 76, 50, 88].map((height, index) => (
          <span key={index} className={`flex-1 rounded-sm ${toneClassNames[tone].dot}`} style={{ height: `${height}%`, opacity: 0.35 + index / 24 }} />
        ))}
      </div>
    </MiniPanel>
  )
}

export function StackPanel({ language }: { language: Language }) {
  return (
    <MiniPanel title={localize({ zh: '状态分布', en: 'Status Stack' }, language)}>
      <div className="space-y-2">
        {[
          ['Done', '52%', 'emerald'],
          ['Review', '18%', 'violet'],
          ['Running', '22%', 'amber'],
          ['Todo', '8%', 'sky'],
        ].map(([label, value, tone]) => (
          <div key={label} className="flex items-center gap-2">
            <span className="w-14 text-xs text-zinc-500">{label}</span>
            <span className="h-2 flex-1 overflow-hidden rounded-full bg-zinc-900">
              <span className={`block h-full ${toneClassNames[tone as Tone].dot}`} style={{ width: value }} />
            </span>
          </div>
        ))}
      </div>
    </MiniPanel>
  )
}

export function AgentBars({ language }: { language: Language }) {
  return (
    <MiniPanel title={localize({ zh: 'Agent 活跃', en: 'Agent Activity' }, language)}>
      {['Developer', 'Tester', 'Reviewer', 'Researcher'].map((agent, index) => (
        <div key={agent} className="mb-2 flex items-center gap-2">
          <span className="w-20 truncate text-xs text-zinc-500">{agent}</span>
          <span className="h-2 flex-1 rounded-full bg-zinc-900">
            <span className="block h-full rounded-full bg-white" style={{ width: `${82 - index * 14}%` }} />
          </span>
        </div>
      ))}
    </MiniPanel>
  )
}

export function HealthPanel({ language }: { language: Language }) {
  return (
    <MiniPanel title={localize({ zh: '健康度', en: 'Health' }, language)}>
      <div className="grid gap-2">
        <InfoCell label={localize({ zh: '完成率', en: 'Completion' }, language)} value="74%" />
        <InfoCell label={localize({ zh: '审核负载', en: 'Review Load' }, language)} value="18%" />
      </div>
    </MiniPanel>
  )
}

export function TableCard({ headers, rows }: { headers: string[]; rows: string[][] }) {
  return (
    <div className="overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950/75">
      <div className="grid border-b border-zinc-800 bg-zinc-950/90" style={{ gridTemplateColumns: `repeat(${headers.length}, minmax(0, 1fr))` }}>
        {headers.map((header) => (
          <div key={header} className="px-3 py-3 text-[10px] uppercase tracking-[0.2em] text-zinc-500">{header}</div>
        ))}
      </div>
      {rows.map((row) => (
        <div key={row.join('-')} className="grid border-b border-zinc-900 last:border-b-0" style={{ gridTemplateColumns: `repeat(${headers.length}, minmax(0, 1fr))` }}>
          {row.map((cell) => (
            <div key={cell} className="truncate px-3 py-3 text-xs text-zinc-300">{cell}</div>
          ))}
        </div>
      ))}
    </div>
  )
}

export function FormBlock({ label, tall, value }: { label: string; tall?: boolean; value: string }) {
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-950/70 p-3">
      <p className="text-[10px] uppercase tracking-[0.2em] text-zinc-500">{label}</p>
      <p className={`${tall ? 'min-h-20' : ''} mt-2 text-sm leading-6 text-zinc-300`}>{value}</p>
    </div>
  )
}

export function SelectPreview({ icon, label, tone, value }: { icon: ReactNode; label: string; tone: Tone; value: string }) {
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-950/70 p-3">
      <div className="flex items-center gap-2 text-xs text-zinc-500">{icon}{label}</div>
      <div className="mt-2 flex items-center justify-between gap-2">
        <span className="truncate text-sm text-zinc-200">{value}</span>
        <span className={`h-2 w-2 rounded-full ${toneClassNames[tone].dot}`} />
      </div>
    </div>
  )
}

export function PanelTitle({ icon, title }: { icon: ReactNode; title: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <p className="text-sm font-semibold text-zinc-100">{title}</p>
      <span className="rounded-xl border border-zinc-800 bg-zinc-950 p-2 text-zinc-400">{icon}</span>
    </div>
  )
}

export function ListButton({ active, subtitle, title }: { active?: boolean; subtitle: string; title: string }) {
  return (
    <button className={`block w-full rounded-xl border px-3 py-3 text-left transition ${active ? 'border-zinc-700 bg-zinc-900 text-zinc-50' : 'border-zinc-800 bg-[#09090b] text-zinc-300'}`} type="button">
      <span className="block truncate text-sm font-medium">{title}</span>
      <span className="mt-1 block truncate text-xs text-zinc-500">{subtitle}</span>
    </button>
  )
}

export function SearchBox({ placeholder }: { placeholder: string }) {
  return (
    <div className="relative">
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
      <div className="rounded-lg border border-zinc-800 bg-zinc-950 py-2 pl-9 pr-3 text-xs text-zinc-600">{placeholder}</div>
    </div>
  )
}

export function InfoCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-[#09090b] px-3 py-2">
      <p className="text-[10px] uppercase tracking-[0.16em] text-zinc-600">{label}</p>
      <p className="mt-1 truncate text-xs font-medium text-zinc-200">{value}</p>
    </div>
  )
}

export function ConfigRow({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-zinc-800 bg-[#09090b] px-3 py-2">
      <span className="flex min-w-0 items-center gap-2 text-xs text-zinc-500">{icon}{label}</span>
      <span className="truncate text-right text-xs text-zinc-200">{value}</span>
    </div>
  )
}

export function Pill({ children, tone }: { children: ReactNode; tone: Tone }) {
  const toneClassName = toneClassNames[tone]
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-1 text-[10px] uppercase tracking-wider ${toneClassName.border} ${toneClassName.bg} ${toneClassName.text}`}>
      {children}
    </span>
  )
}

export function TimelineRow({ time, title, tone, value }: { time: string; title: string; tone: Tone; value: string }) {
  return (
    <div className="grid grid-cols-[3rem_5rem_1fr] gap-2 rounded-lg border border-zinc-800 bg-[#09090b] px-3 py-2 text-xs">
      <span className="text-zinc-600">{time}</span>
      <span className={toneClassNames[tone].text}>{title}</span>
      <span className="truncate text-zinc-400">{value}</span>
    </div>
  )
}

export function TaskListRow({ agent, title, tone }: { agent: string; title: string; tone: Tone }) {
  return (
    <div className="mb-2 rounded-lg border border-zinc-800 bg-[#09090b] px-3 py-2">
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-sm text-zinc-200">{title}</span>
        <span className={`h-2 w-2 shrink-0 rounded-full ${toneClassNames[tone].dot}`} />
      </div>
      <p className="mt-1 text-xs text-zinc-500">{agent}</p>
    </div>
  )
}

export function PeopleRow({ name, role, tone }: { name: string; role: string; tone: Tone }) {
  return (
    <div className="mb-2 flex items-center justify-between gap-3 rounded-lg border border-zinc-800 bg-[#09090b] px-3 py-2">
      <div className="flex min-w-0 items-center gap-2">
        <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-zinc-900 text-[10px] font-semibold text-zinc-300">{name.slice(0, 2).toUpperCase()}</span>
        <span className="truncate text-sm text-zinc-200">{name}</span>
      </div>
      <Pill tone={tone}>{role}</Pill>
    </div>
  )
}

export function ChatBubble({ side, text }: { side: 'left' | 'right'; text: string }) {
  return (
    <div className={`flex ${side === 'right' ? 'justify-end' : 'justify-start'}`}>
      <div className={`max-w-[78%] rounded-2xl px-4 py-3 text-sm leading-6 ${side === 'right' ? 'bg-zinc-100 text-zinc-950' : 'border border-zinc-800 bg-[#09090b] text-zinc-300'}`}>
        {text}
      </div>
    </div>
  )
}

export function StatusLine({ text }: { text: string }) {
  return (
    <div className="ml-4 flex items-center gap-2 text-xs text-zinc-500">
      <span className="h-1.5 w-1.5 rounded-full bg-white" />
      {text}
    </div>
  )
}

export function localize(value: LocalizedText, language: Language) {
  return value[language]
}
