// [INPUT]: userId（缺省 = 当前用户）与画像/工作记录 API
// [OUTPUT]: 用户画像卡片（姓名/职位/技能/简介 + 最近工作记录；本人可编辑）
// [POS]: 画像展示 + 简单编辑组件；编辑仅限本人（title/department/skills 走 /api/my/profile，bio 走 /api/auth/me）
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { CheckCircle2, Loader2, Pencil, User as UserIcon, X } from 'lucide-react'
import type { UserProfileRecord, WorkRecord } from '@shared/types'
import { useAuth } from '../../lib/auth-context'
import { api } from '../../lib/api'
import type { UserProfileBasic } from '../../lib/api/methods/profiles'
import { cn } from '../../lib/utils'
import { Avatar, AvatarFallback, AvatarImage } from '../ui/avatar'
import { Button } from '../ui/button'

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

export function UserProfileCard({ userId }: { userId?: string }) {
  const { user: currentUser, updateUser } = useAuth()
  const isOwn = !userId || userId === currentUser?.id

  const [profile, setProfile] = useState<UserProfileRecord | null>(null)
  const [basic, setBasic] = useState<UserProfileBasic | null>(null)
  const [workRecords, setWorkRecords] = useState<WorkRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({ title: '', department: '', skills: '', bio: '' })

  const load = useCallback(async () => {
    setLoading(true)
    try {
      if (isOwn) {
        const [res] = await Promise.all([api.getMyProfile()])
        setProfile(res.profile)
        setBasic(currentUser
          ? { id: currentUser.id, name: currentUser.name, avatarUrl: currentUser.avatarUrl ?? null, bio: currentUser.bio ?? null }
          : null)
        setWorkRecords(res.workRecords)
      } else if (userId) {
        const res = await api.getUserProfile(userId)
        setProfile(res.profile)
        setBasic(res.user)
        try {
          const records = await api.getUserWorkRecords(userId)
          setWorkRecords(records.workRecords)
        } catch {
          setWorkRecords([]) // 无共同组织时不可见，忽略
        }
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '加载画像失败。')
    } finally {
      setLoading(false)
    }
  }, [isOwn, userId, currentUser])

  useEffect(() => {
    void load()
  }, [load])

  const startEdit = () => {
    setForm({
      title: profile?.title ?? '',
      department: profile?.department ?? '',
      skills: (profile?.skills ?? []).join(', '),
      bio: basic?.bio ?? '',
    })
    setEditing(true)
  }

  const save = async () => {
    setSaving(true)
    try {
      if (isOwn) {
        await Promise.all([
          api.updateMyProfile({
            title: form.title.trim() || null,
            department: form.department.trim() || null,
            skills: form.skills.split(',').map((item) => item.trim()).filter(Boolean).slice(0, 50) || null,
          }),
          currentUser ? api.updateMe({ name: currentUser.name, bio: form.bio.trim() || undefined }) : Promise.resolve(null),
        ])
        if (currentUser) updateUser({ ...currentUser, bio: form.bio.trim() || undefined })
        toast.success('画像已保存。')
        setEditing(false)
        void load()
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '保存失败。')
    } finally {
      setSaving(false)
    }
  }

  const initials = (basic?.name ?? '?').slice(0, 2).toUpperCase()
  const skills = profile?.skills ?? []

  return (
    <div className="flex flex-col gap-4 rounded border border-zinc-800 bg-[#09090b] p-4">
      {/* 头部：头像 + 名称 + 编辑 */}
      <div className="flex items-center gap-3">
        <Avatar className="h-10 w-10">
          {basic?.avatarUrl && <AvatarImage src={basic.avatarUrl} />}
          <AvatarFallback>{initials}</AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="truncate text-sm font-semibold text-zinc-100">{basic?.name ?? '加载中…'}</span>
            {isOwn && <span className="rounded-md bg-zinc-900 px-1.5 py-0.5 text-[10px] text-zinc-400">我</span>}
          </div>
          <div className="truncate text-[11px] text-zinc-500">
            {[profile?.title, profile?.department].filter(Boolean).join(' · ') || '未设置职位信息'}
          </div>
        </div>
        {isOwn && !editing && (
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
          {/* 简介 */}
          <div>
            <SectionLabel>简介 / OKR</SectionLabel>
            {editing ? (
              <textarea
                value={form.bio}
                onChange={(event) => setForm((prev) => ({ ...prev, bio: event.target.value }))}
                rows={3}
                placeholder="一句话介绍自己，也可以写当前 OKR / 目标…"
                className="w-full rounded-lg border border-zinc-800 bg-zinc-950 p-2 text-sm text-zinc-200 placeholder:text-zinc-600 focus:border-zinc-700 focus:outline-none"
              />
            ) : (
              <p className="text-sm leading-relaxed text-zinc-300">{basic?.bio || '还没有简介。'}</p>
            )}
          </div>

          {/* 技能 */}
          <div>
            <SectionLabel>技能</SectionLabel>
            {editing ? (
              <input
                value={form.skills}
                onChange={(event) => setForm((prev) => ({ ...prev, skills: event.target.value }))}
                placeholder="逗号分隔，如 React, TypeScript"
                className="h-9 w-full rounded-lg border border-zinc-800 bg-zinc-950 px-2.5 text-sm text-zinc-200 placeholder:text-zinc-600 focus:border-zinc-700 focus:outline-none"
              />
            ) : skills.length > 0 ? (
              <div className="flex flex-wrap gap-1.5">
                {skills.map((skill) => (
                  <span key={skill} className="rounded-md bg-zinc-900 px-2 py-1 text-[11px] font-medium text-zinc-400">
                    {skill}
                  </span>
                ))}
              </div>
            ) : (
              <p className="text-xs text-zinc-600">未设置技能标签。</p>
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
                    <CheckCircle2 className={cn('h-3 w-3 shrink-0', record.recordType === 'task_completed' ? 'text-emerald-500' : 'text-zinc-600')} />
                    <span className="truncate">{(record.title.includes('《') ? record.title : `${RECORD_TYPE_LABEL[record.recordType] ?? record.recordType}「${record.title}」`)}</span>
                    <span className="ml-auto shrink-0 text-zinc-600">{formatTime(record.occurredAt)}</span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex items-center gap-2 rounded-lg border border-dashed border-zinc-800 bg-zinc-950/70 px-3 py-4 text-xs text-zinc-600">
                <UserIcon className="h-3.5 w-3.5" />
                暂无工作记录。
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
