// [INPUT]: agentId 与 Agent 画像/工作记录 API
// [OUTPUT]: Agent 画像卡片（身份：角色/摘要/专长/沟通风格/工作时段 + 健康度 + 最近工作记录；owner 可编辑）
// [POS]: Agent 画像展示 + 简单编辑组件；identityJson 按技术方案结构解析（role/summary/expertise/communicationStyle/workingHours），编辑仅限 owner
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Bot, CheckCircle2, Loader2, Pencil, X } from 'lucide-react'
import { readCustomAgentConfig } from '@shared/custom-agent'
import type { AgentProfileRecord, AgentRecord, WorkRecord } from '@shared/types'
import { useAuth } from '../../lib/auth-context'
import { api } from '../../lib/api'
import { normalizeBuiltInAgentAvatarUrl } from '../../lib/agent-avatar'
import { Avatar, AvatarFallback, AvatarImage } from '../ui/avatar'
import { Button } from '../ui/button'
import { HealthDots } from './health-dots'

type AgentIdentity = {
  role?: string
  summary?: string
  expertise?: string[]
  communicationStyle?: string
  workingHours?: string
}

const parseIdentity = (raw: unknown): AgentIdentity => {
  if (!raw || typeof raw !== 'object') return {}
  const record = raw as Record<string, unknown>
  const expertise = Array.isArray(record.expertise)
    ? record.expertise.filter((item): item is string => typeof item === 'string')
    : []
  return {
    role: typeof record.role === 'string' ? record.role : undefined,
    summary: typeof record.summary === 'string' ? record.summary : undefined,
    expertise,
    communicationStyle: typeof record.communicationStyle === 'string' ? record.communicationStyle : undefined,
    workingHours: typeof record.workingHours === 'string' ? record.workingHours : undefined,
  }
}

const RECORD_TYPE_LABEL: Record<string, string> = {
  task_completed: '完成任务',
  task_dispatched: '派发任务',
  drive_file_created: '创建文件',
  drive_file_updated: '更新文件',
  conversation: '参与会话',
}

const formatTime = (iso: string) => {
  try {
    const date = new Date(iso)
    const diff = Date.now() - date.getTime()
    if (diff < 60_000) return '刚刚'
    if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`
    if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`
    return date.toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
  } catch {
    return ''
  }
}

const SectionLabel = ({ children }: { children: React.ReactNode }) => (
  <label className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-zinc-500">{children}</label>
)

export function AgentProfileCard({ agentId }: { agentId: string }) {
  const { user: currentUser } = useAuth()
  const [agent, setAgent] = useState<AgentRecord | null>(null)
  const [profile, setProfile] = useState<AgentProfileRecord | null>(null)
  const [workRecords, setWorkRecords] = useState<WorkRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({ role: '', summary: '', expertise: '', communicationStyle: '', workingHours: '' })

  const isOwner = agent != null && agent.ownerUserId != null && agent.ownerUserId === currentUser?.id

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [agentRes, profileRes] = await Promise.all([
        api.getAgent(agentId),
        api.getAgentProfile(agentId),
      ])
      setAgent(agentRes.agent)
      setProfile(profileRes.profile)
      try {
        const records = await api.getAgentWorkRecords(agentId)
        setWorkRecords(records.workRecords)
      } catch {
        setWorkRecords([]) // 无共同组织/非 owner 时不可见，忽略
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '加载 Agent 画像失败。')
    } finally {
      setLoading(false)
    }
  }, [agentId])

  useEffect(() => {
    void load()
  }, [load])

  const startEdit = () => {
    const identity = parseIdentity(profile?.identityJson)
    setForm({
      role: identity.role ?? '',
      summary: identity.summary ?? '',
      expertise: (identity.expertise ?? []).join(', '),
      communicationStyle: identity.communicationStyle ?? '',
      workingHours: identity.workingHours ?? '',
    })
    setEditing(true)
  }

  const save = async () => {
    setSaving(true)
    try {
      const identity: AgentIdentity = {
        role: form.role.trim() || undefined,
        summary: form.summary.trim() || undefined,
        expertise: form.expertise.split(',').map((item) => item.trim()).filter(Boolean) || undefined,
        communicationStyle: form.communicationStyle.trim() || undefined,
        workingHours: form.workingHours.trim() || undefined,
      }
      await api.updateAgentProfile(agentId, { identityJson: identity })
      toast.success('Agent 画像已保存。')
      setEditing(false)
      void load()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '保存失败。')
    } finally {
      setSaving(false)
    }
  }

  const identity = parseIdentity(profile?.identityJson)
  const avatarUrl = agent ? (() => {
    const raw = readCustomAgentConfig(agent.config).avatarUrl.trim()
    return raw ? normalizeBuiltInAgentAvatarUrl(raw) : undefined
  })() : undefined
  const initials = (agent?.name ?? '?').slice(0, 2).toUpperCase()

  return (
    <div className="flex flex-col gap-4 rounded border border-zinc-800 bg-[#09090b] p-4">
      {/* 头部：头像 + 名称 + 健康度 + 编辑 */}
      <div className="flex items-center gap-3">
        <Avatar className="h-10 w-10">
          {avatarUrl && <AvatarImage src={avatarUrl} />}
          <AvatarFallback>{initials}</AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="truncate text-sm font-semibold text-zinc-100">{agent?.name ?? '加载中…'}</span>
            <Bot className="h-3.5 w-3.5 shrink-0 text-zinc-500" />
          </div>
          <div className="flex items-center gap-2 text-[11px] text-zinc-500">
            {profile?.healthScore != null && <HealthDots score={profile.healthScore} />}
            {profile?.lastActiveAt && <span>活跃于 {formatTime(profile.lastActiveAt)}</span>}
          </div>
        </div>
        {isOwner && !editing && (
          <Button variant="outline" size="sm" onClick={startEdit} className="h-7 gap-1.5 rounded-md px-2 text-xs">
            <Pencil className="h-3 w-3" />编辑
          </Button>
        )}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-8 text-zinc-500">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />加载中…
        </div>
      ) : (
        <>
          {/* 角色 / 摘要 */}
          <div>
            <SectionLabel>身份描述</SectionLabel>
            {editing ? (
              <div className="space-y-3">
                <div>
                  <input
                    value={form.role}
                    onChange={(event) => setForm((prev) => ({ ...prev, role: event.target.value }))}
                    placeholder="角色，如 Tech Lead Agent"
                    className="h-9 w-full rounded-lg border border-zinc-800 bg-zinc-950 px-2.5 text-sm text-zinc-200 placeholder:text-zinc-600 focus:border-zinc-700 focus:outline-none"
                  />
                </div>
                <div>
                  <textarea
                    value={form.summary}
                    onChange={(event) => setForm((prev) => ({ ...prev, summary: event.target.value }))}
                    rows={3}
                    placeholder="摘要：职责与边界，也可以写当前 OKR / 目标…"
                    className="w-full rounded-lg border border-zinc-800 bg-zinc-950 p-2 text-sm text-zinc-200 placeholder:text-zinc-600 focus:border-zinc-700 focus:outline-none"
                  />
                </div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div>
                    <SectionLabel>沟通风格</SectionLabel>
                    <input
                      value={form.communicationStyle}
                      onChange={(event) => setForm((prev) => ({ ...prev, communicationStyle: event.target.value }))}
                      placeholder="如 简洁直接"
                      className="h-9 w-full rounded-lg border border-zinc-800 bg-zinc-950 px-2.5 text-sm text-zinc-200 placeholder:text-zinc-600 focus:border-zinc-700 focus:outline-none"
                    />
                  </div>
                  <div>
                    <SectionLabel>工作时段</SectionLabel>
                    <input
                      value={form.workingHours}
                      onChange={(event) => setForm((prev) => ({ ...prev, workingHours: event.target.value }))}
                      placeholder="如 9:00-18:00"
                      className="h-9 w-full rounded-lg border border-zinc-800 bg-zinc-950 px-2.5 text-sm text-zinc-200 placeholder:text-zinc-600 focus:border-zinc-700 focus:outline-none"
                    />
                  </div>
                </div>
              </div>
            ) : (
              <div className="space-y-1">
                {identity.role && <p className="text-sm font-medium text-zinc-200">{identity.role}</p>}
                {identity.summary
                  ? <p className="text-sm leading-relaxed text-zinc-300">{identity.summary}</p>
                  : <p className="text-xs text-zinc-600">暂无身份描述。</p>}
              </div>
            )}
          </div>

          {/* 专长 */}
          <div>
            <SectionLabel>专长</SectionLabel>
            {editing ? (
              <input
                value={form.expertise}
                onChange={(event) => setForm((prev) => ({ ...prev, expertise: event.target.value }))}
                placeholder="逗号分隔，如 React, TypeScript"
                className="h-9 w-full rounded-lg border border-zinc-800 bg-zinc-950 px-2.5 text-sm text-zinc-200 placeholder:text-zinc-600 focus:border-zinc-700 focus:outline-none"
              />
            ) : (identity.expertise?.length ?? 0) > 0 ? (
              <div className="flex flex-wrap gap-1.5">
                {identity.expertise!.map((item) => (
                  <span key={item} className="rounded-md bg-zinc-900 px-2 py-1 text-[11px] font-medium text-zinc-400">{item}</span>
                ))}
              </div>
            ) : (
              <p className="text-xs text-zinc-600">未设置专长标签。</p>
            )}
          </div>

          {/* 编辑操作区 */}
          {editing && (
            <div className="flex items-center justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setEditing(false)} disabled={saving} className="h-7 gap-1.5 rounded-md px-2 text-xs">
                <X className="h-3 w-3" />取消
              </Button>
              <Button size="sm" onClick={() => void save()} disabled={saving} className="h-7 gap-1.5 rounded-md bg-zinc-100 px-2.5 text-xs font-medium text-zinc-950 hover:bg-zinc-200">
                {saving && <Loader2 className="h-3 w-3 animate-spin" />}保存
              </Button>
            </div>
          )}

          {/* 最近工作记录 */}
          <div className="border-t border-zinc-900 pt-3">
            <SectionLabel>最近工作</SectionLabel>
            {workRecords.length > 0 ? (
              <div className="space-y-1.5">
                {workRecords.slice(0, 5).map((record) => (
                  <div key={record.id} className="flex items-center gap-1.5 text-[11px] text-zinc-400">
                    <CheckCircle2 className={`h-3 w-3 shrink-0 ${record.recordType === 'task_completed' ? 'text-emerald-500' : 'text-zinc-600'}`} />
                    <span className="truncate">{(record.title.includes('《') ? record.title : `${RECORD_TYPE_LABEL[record.recordType] ?? record.recordType}「${record.title}」`)}</span>
                    <span className="ml-auto shrink-0 text-zinc-600">{formatTime(record.occurredAt)}</span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex items-center gap-2 rounded-lg border border-dashed border-zinc-800 bg-zinc-950/70 px-3 py-4 text-xs text-zinc-600">
                <Bot className="h-3.5 w-3.5" />
                暂无工作记录。
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
