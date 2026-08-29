import { VISIBLE_AGENT_TYPES } from '@shared/agent-type'
import type { TaskStatus } from '@shared/types'

export const taskCategories = [
  { id: 'feature', label: '功能开发', emoji: '✨', color: 'bg-violet-100 text-violet-700 border-violet-200' },
  { id: 'bugfix', label: 'Bug 修复', emoji: '🐛', color: 'bg-rose-100 text-rose-700 border-rose-200' },
  { id: 'refactor', label: '代码重构', emoji: '🔧', color: 'bg-amber-100 text-amber-700 border-amber-200' },
  { id: 'docs', label: '文档更新', emoji: '📝', color: 'bg-sky-100 text-sky-700 border-sky-200' },
  { id: 'test', label: '测试相关', emoji: '🧪', color: 'bg-emerald-100 text-emerald-700 border-emerald-200' },
  { id: 'other', label: '其他', emoji: '📦', color: 'bg-slate-100 text-slate-700 border-slate-200' },
]

export const priorityConfig = [
  { id: 'none', label: '无', desc: '暂不设置优先级', color: 'border-zinc-700 bg-zinc-800/80 text-zinc-500', icon: '---' },
  { id: 'urgent', label: '紧急', desc: '立即处理', color: 'border-rose-500/35 bg-rose-500/15 text-rose-300', icon: '!' },
  { id: 'high', label: '高', desc: '尽快处理', color: 'border-amber-500/35 bg-amber-500/15 text-amber-300', icon: '▮▮▮' },
  { id: 'medium', label: '中', desc: '常规优先级', color: 'border-sky-500/35 bg-sky-500/15 text-sky-300', icon: '▮▮' },
  { id: 'low', label: '低', desc: '不紧急，可以排队', color: 'border-emerald-500/35 bg-emerald-500/15 text-emerald-300', icon: '▮' },
]

export const quickInputs = [
  '添加用户登录功能',
  '修复首页加载慢的问题',
  '优化数据库查询性能',
  '更新 API 文档',
  '编写单元测试',
]

export const columnConfig: Array<{ key: TaskStatus; title: string; color: string; bg: string; soft: string }> = [
  { key: 'backlog', title: '待规划', color: 'text-zinc-400', bg: 'bg-zinc-950', soft: 'bg-zinc-900' },
  { key: 'todo', title: '待办', color: 'text-zinc-300', bg: 'bg-zinc-950', soft: 'bg-zinc-900' },
  { key: 'in_progress', title: '进行中', color: 'text-amber-300', bg: 'bg-amber-950', soft: 'bg-amber-900' },
  { key: 'in_review', title: '审核中', color: 'text-emerald-300', bg: 'bg-emerald-950', soft: 'bg-emerald-900' },
  { key: 'done', title: '已完成', color: 'text-sky-300', bg: 'bg-sky-950', soft: 'bg-sky-900' },
  { key: 'blocked', title: '已阻塞', color: 'text-rose-300', bg: 'bg-rose-950', soft: 'bg-rose-900' },
]

export const difficultyOptions = ['easy', 'medium', 'hard'] as const
export const agentOptions = VISIBLE_AGENT_TYPES
export const agentManagedOptions = ['none', 'ai'] as const
export const categoryIds = taskCategories.map(c => c.id)
export const priorityIds = priorityConfig.map(p => p.id)
