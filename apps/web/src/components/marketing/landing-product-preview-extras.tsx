import { GitBranch, MessageSquareText, ShieldCheck } from 'lucide-react'

import { previewNodes, previewProjects, toneClassNames } from './landing-product-preview-data'
import {
  ConfigRow,
  InfoCell,
  MiniPanel,
  Pill,
  localize,
} from './landing-product-preview-ui'
import type { Language } from '../../lib/i18n'

export function ProjectSnapshotStrip({ language }: { language: Language }) {
  return (
    <MiniPanel title={localize({ zh: '项目快照', en: 'Project Snapshots' }, language)}>
      <div className="grid grid-cols-3 gap-2">
        {previewProjects.map((project) => (
          <div key={project.name} className="rounded-lg border border-zinc-800 bg-[#09090b] p-3">
            <div className="flex items-center justify-between gap-3">
              <span className="h-3 w-3 rounded-sm" style={{ backgroundColor: project.color }} />
              <Pill tone={project.viewId === 'project-docs' ? 'amber' : 'emerald'}>{localize(project.runtime, language)}</Pill>
            </div>
            <p className="mt-3 truncate text-sm font-semibold text-zinc-100">{project.name}</p>
            <p className="mt-1 text-xs text-zinc-500">{localize(project.meta, language)} · worker bound</p>
          </div>
        ))}
      </div>
    </MiniPanel>
  )
}

export function NodeTopology({ language }: { language: Language }) {
  return (
    <div className="relative min-h-64 overflow-hidden rounded-xl border border-zinc-800 bg-[#050505] p-4">
      <div className="absolute inset-0 opacity-35 [background-image:radial-gradient(circle_at_center,rgba(139,92,246,0.28),transparent_35%),linear-gradient(rgba(255,255,255,0.06)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.06)_1px,transparent_1px)] [background-size:100%_100%,24px_24px,24px_24px]" />
      <div className="relative flex h-full min-h-56 items-center justify-center">
        <div className="z-10 rounded-2xl border border-white/20 bg-white/10 px-5 py-4 text-center shadow-[0_0_60px_rgba(255,255,255,0.1)]">
          <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-zinc-400">Wemux</p>
          <p className="mt-1 text-sm font-semibold text-zinc-50">{localize({ zh: '任务调度队列', en: 'Dispatch Queue' }, language)}</p>
        </div>
        {previewNodes.map((node, index) => {
          const positions = ['left-5 top-5', 'right-5 top-8', 'bottom-5 left-1/2 -translate-x-1/2']
          return (
            <div key={node.name} className={`absolute ${positions[index]} rounded-xl border border-zinc-800 bg-zinc-950/90 p-3 shadow-[0_18px_50px_rgba(0,0,0,0.35)]`}>
              <div className="flex items-center gap-2">
                <span className={`h-2 w-2 rounded-full ${toneClassNames[node.tone].dot}`} />
                <span className="text-xs font-medium text-zinc-200">{node.name}</span>
              </div>
              <p className="mt-1 font-mono text-[10px] text-zinc-600">{node.ip}</p>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export function SettingsPreview({ language }: { language: Language }) {
  return (
    <div className="min-h-[calc(38rem-3rem)] space-y-4 p-4">
      <section className="rounded-lg border border-zinc-800 bg-[linear-gradient(135deg,rgba(24,24,27,0.98),rgba(9,9,11,0.92))] p-5">
        <div className="inline-flex items-center gap-2 rounded-full border border-zinc-700 bg-zinc-950 px-3 py-1 text-[10px] font-medium uppercase tracking-[0.22em] text-zinc-400">
          Settings
        </div>
        <div className="mt-4 flex flex-row items-end justify-between gap-5">
          <div>
            <h2 className="text-2xl font-semibold tracking-tight text-zinc-50">{localize({ zh: '系统设置', en: 'System Settings' }, language)}</h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-400">{localize({ zh: '运行时、Git 身份、通知通道和清理策略集中配置。', en: 'Runtime, Git identity, notification channels, and cleanup policies are configured here.' }, language)}</p>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <InfoCell label="OpenCode" value="ready" />
            <InfoCell label="Codex" value="gpt-5.4" />
            <InfoCell label="Storage" value="local" />
          </div>
        </div>
      </section>
      <div className="grid grid-cols-[16rem_1fr] gap-4">
        <MiniPanel title={localize({ zh: '菜单', en: 'Menu' }, language)}>
          {['个人资料', 'Agent 运行时', 'Git 身份', 'Telegram', '飞书'].map((item, index) => (
            <button className={`mb-2 block w-full rounded-xl border px-3 py-3 text-left transition ${index === 1 ? 'border-zinc-700 bg-zinc-900 text-zinc-50' : 'border-zinc-800 bg-[#09090b] text-zinc-300'}`} key={item} type="button">
              <span className="block truncate text-sm font-medium">{item}</span>
              <span className="mt-1 block truncate text-xs text-zinc-500">{index === 1 ? 'OpenCode / Codex / Claude' : 'configuration'}</span>
            </button>
          ))}
        </MiniPanel>
        <div className="space-y-3">
          <MiniPanel title={localize({ zh: '执行端默认配置', en: 'Runtime Defaults' }, language)}>
            <div className="mb-4 flex gap-2">
              {['OpenCode', 'Codex', 'Claude Code'].map((runtime, index) => (
                <span key={runtime} className={`rounded-full px-3 py-1.5 text-xs ${index === 1 ? 'bg-zinc-100 text-zinc-950' : 'border border-zinc-800 text-zinc-500'}`}>{runtime}</span>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <InfoCell label="Model" value="gpt-5.4" />
              <InfoCell label="Sandbox" value="workspace-write" />
              <InfoCell label="Approval" value="on-request" />
              <InfoCell label="Reasoning" value="high" />
            </div>
          </MiniPanel>
          <div className="grid grid-cols-2 gap-3">
            <MiniPanel title={localize({ zh: 'Git 身份', en: 'Git Identity' }, language)}>
              <ConfigRow icon={<GitBranch className="h-4 w-4" />} label="Name" value="Project Owner" />
              <ConfigRow icon={<ShieldCheck className="h-4 w-4" />} label="Signing" value="enabled" />
            </MiniPanel>
            <MiniPanel title={localize({ zh: '通知通道', en: 'Channels' }, language)}>
              <ConfigRow icon={<MessageSquareText className="h-4 w-4" />} label="Telegram" value="connected" />
              <ConfigRow icon={<MessageSquareText className="h-4 w-4" />} label="Feishu" value="connected" />
            </MiniPanel>
          </div>
        </div>
      </div>
    </div>
  )
}
