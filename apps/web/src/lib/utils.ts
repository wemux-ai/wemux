import { DEFAULT_AGENT_TYPE, getRuntimeDescriptor } from '@shared/agent-type'
import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'
import type { ExecutionModelOption } from '@shared/types'
import type { AgentType, RuntimeId, Task, TaskStatus } from '@shared/types'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatDate(date: string | Date): string {
  const d = typeof date === 'string' ? new Date(date) : date
  return d.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

export const statusMeta: Record<TaskStatus, { label: string; color: string; bg: string; soft: string; accent: string }> = {
  backlog: { label: '待办', color: 'text-zinc-500', bg: 'bg-zinc-100', soft: 'bg-zinc-100 text-zinc-700', accent: 'bg-zinc-500 text-white' },
  todo: { label: '计划中', color: 'text-blue-600', bg: 'bg-blue-100', soft: 'bg-blue-100 text-blue-700', accent: 'bg-blue-500 text-white' },
  in_progress: { label: '进行中', color: 'text-amber-600', bg: 'bg-amber-100', soft: 'bg-amber-100 text-amber-700', accent: 'bg-amber-500 text-white' },
  in_review: { label: '审核中', color: 'text-violet-600', bg: 'bg-violet-100', soft: 'bg-violet-100 text-violet-700', accent: 'bg-violet-500 text-white' },
  done: { label: '已完成', color: 'text-emerald-600', bg: 'bg-emerald-100', soft: 'bg-emerald-100 text-emerald-700', accent: 'bg-emerald-500 text-white' },
  blocked: { label: '已阻塞', color: 'text-red-600', bg: 'bg-red-100', soft: 'bg-red-100 text-red-700', accent: 'bg-red-500 text-white' },
  cancelled: { label: '已取消', color: 'text-zinc-500', bg: 'bg-zinc-100', soft: 'bg-zinc-100 text-zinc-700', accent: 'bg-zinc-500 text-white' },
}

export const agentMeta: Record<AgentType, { label: string; soft: string; accent: string }> = {
  OpenCode: { label: 'OpenCode', soft: 'bg-violet-100 text-violet-700', accent: 'bg-violet-500 text-white' },
  Codex: { label: 'Codex', soft: 'bg-sky-100 text-sky-700', accent: 'bg-sky-500 text-white' },
  ClaudeCode: { label: 'Claude Code', soft: 'bg-amber-100 text-amber-800', accent: 'bg-amber-500 text-white' },
  Pi: { label: 'Pi', soft: 'bg-emerald-100 text-emerald-800', accent: 'bg-emerald-500 text-white' },
}

export const getRuntimeLabel = (runtime: RuntimeId | 'inherit') => {
  if (runtime === 'inherit') {
    return agentMeta.Pi.label
  }

  if (runtime in agentMeta) {
    return agentMeta[runtime as AgentType].label
  }

  return getRuntimeDescriptor(runtime).label
}

export function makeSlug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 20)
}

export function formatExecutionModelLabel(model?: string): string {
  if (!model) {
    return '默认模型'
  }

  const [providerId, ...rest] = model.split('/')
  const modelId = rest.join('/')

  if (!providerId || !modelId) {
    return model
  }

  return `${providerId}-${modelId}`
}

export function formatExecutionModelProviderLabel(model: Pick<ExecutionModelOption, 'providerId' | 'source' | 'profileName'>): string {
  if (model.source === 'runtime') {
    return `${model.providerId} · node`
  }
  if (model.source === 'hosted') {
    return '官方模型'
  }
  // 平台模型库条目优先按账号/配置名分组（订阅账号会显示账号邮箱），其次才按提供商
  if (model.profileName?.trim()) {
    return model.profileName.trim()
  }
  return model.providerId
}

export function normalizeTaskDisplayText(text: string, fallback: string): string {
  if (text.includes('does not support image input') || text.includes('Cannot read "clipboard"')) {
    return fallback
  }

  return text
}

export function pickAgent(description: string): AgentType {
  void description
  return DEFAULT_AGENT_TYPE
}
