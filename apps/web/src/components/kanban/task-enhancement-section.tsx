/**
 * [INPUT]: 任务详情面板中的任务元信息（reactions/attachments）与项目级自定义字段定义。
 * [OUTPUT]: 任务级表情反应、附件展示、自定义字段值展示/编辑、字段管理对话框。
 * [POS]: R8.5 任务增强 UI（表情 + 附件 + 自定义字段[含工时]）；字段模型对接 server task-field-routes。
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Plus, Settings2, Smile, ThumbsUp, X } from 'lucide-react'
import { hasMessageReaction, toggleMessageReaction } from '@shared/message-reactions'
import { toast } from 'sonner'
import { api, type TaskCustomFieldDefinition, type TaskCustomFieldType } from '../../lib/api'
import { Button } from '../ui/button'
import { Dialog, DialogBody, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '../ui/dialog'
import { Input } from '../ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select'
import { EmojiPicker } from '../chat/emoji-picker'
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover'
import { cn } from '../../lib/utils'

type ReactionRow = { emoji: string; userIds: string[] }

const FIELD_TYPE_LABELS: Record<TaskCustomFieldType, string> = {
  text: '文本',
  number: '数字',
  select: '单选',
  multi_select: '多选',
  date: '日期',
  user: '用户',
  duration: '工时',
  checkbox: '勾选',
  url: '链接',
}

function formatFieldValue(field: TaskCustomFieldDefinition, value: unknown): string {
  if (value === undefined || value === null || value === '') {
    return ''
  }
  if (field.type === 'duration' && typeof value === 'object') {
    const numeric = Number((value as { value?: unknown }).value ?? 0)
    return `${numeric} 小时`
  }
  if (field.type === 'multi_select' && Array.isArray(value)) {
    return value.join(', ')
  }
  if (field.type === 'checkbox') {
    return value ? '✓' : '—'
  }
  if (field.type === 'select') {
    const option = field.options.find((item) => item.value === value)
    return option?.label ?? String(value)
  }
  return String(value)
}

/** 按字段类型渲染值输入控件。 */
function FieldValueEditor(props: {
  field: TaskCustomFieldDefinition
  value: unknown
  onChange: (value: unknown) => void
}) {
  const { field, value, onChange } = props

  if (field.type === 'select') {
    return (
      <Select value={typeof value === 'string' ? value : ''} onValueChange={onChange}>
        <SelectTrigger className="h-7 text-xs"><SelectValue placeholder="选择…" /></SelectTrigger>
        <SelectContent>
          {field.options.map((option) => (
            <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    )
  }

  if (field.type === 'checkbox') {
    return (
      <input
        type="checkbox"
        checked={Boolean(value)}
        onChange={(event) => onChange(event.target.checked)}
        className="h-4 w-4 accent-zinc-200"
      />
    )
  }

  if (field.type === 'duration') {
    return (
      <Input
        className="h-7 w-28 text-xs"
        type="number"
        min={0}
        placeholder="小时"
        defaultValue={typeof value === 'object' && value !== null ? String(Number((value as { value?: unknown }).value ?? 0)) : ''}
        onBlur={(event) => {
          const numeric = Number(event.target.value)
          onChange({ value: Number.isFinite(numeric) ? numeric : 0 })
        }}
      />
    )
  }

  if (field.type === 'number') {
    return (
      <Input
        className="h-7 w-28 text-xs"
        type="number"
        defaultValue={typeof value === 'number' ? String(value) : ''}
        onBlur={(event) => {
          const numeric = Number(event.target.value)
          onChange(Number.isFinite(numeric) ? numeric : null)
        }}
      />
    )
  }

  return (
    <Input
      className="h-7 w-48 text-xs"
      type={field.type === 'date' ? 'date' : 'text'}
      defaultValue={typeof value === 'string' ? value : ''}
      onBlur={(event) => onChange(event.target.value)}
    />
  )
}

export function TaskEnhancementSection(props: {
  taskId: string
  projectId: string
  currentUserId?: string
  initialReactions?: ReactionRow[]
  initialAttachments?: Array<{ id: string; url: string; filename: string; contentType?: string }>
}) {
  const { taskId, projectId, currentUserId = '', initialReactions = [], initialAttachments = [] } = props
  const [reactions, setReactions] = useState<ReactionRow[]>(initialReactions)
  const [attachments, setAttachments] = useState(initialAttachments)
  const [fields, setFields] = useState<TaskCustomFieldDefinition[]>([])
  const [values, setValues] = useState<Record<string, unknown>>({})
  const [fieldsLoading, setFieldsLoading] = useState(false)
  const [savingField, setSavingField] = useState<string | null>(null)
  const [managerOpen, setManagerOpen] = useState(false)

  useEffect(() => {
    setReactions(initialReactions)
    setAttachments(initialAttachments)
  }, [initialReactions, initialAttachments])

  const loadFields = useCallback(async () => {
    setFieldsLoading(true)
    try {
      const [definitionResponse, valueResponse] = await Promise.all([
        api.listTaskCustomFieldDefinitions(projectId),
        api.getTaskCustomFieldValues(taskId),
      ])
      setFields(definitionResponse.fields)
      setValues(valueResponse.values)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '自定义字段加载失败')
    } finally {
      setFieldsLoading(false)
    }
  }, [projectId, taskId])

  useEffect(() => {
    void loadFields()
  }, [loadFields])

  const toggleReaction = useCallback(async (emoji: string, active: boolean) => {
    const next = toggleMessageReaction(reactions, emoji, currentUserId, active)
    setReactions(next)
    try {
      const result = await api.updateTaskReaction(taskId, { emoji, active })
      setReactions(result.reactions)
    } catch (error) {
      setReactions(toggleMessageReaction(next, emoji, currentUserId, !active))
      toast.error(error instanceof Error ? error.message : '表情回复失败')
    }
  }, [currentUserId, reactions, taskId])

  const updateFieldValue = useCallback(async (field: TaskCustomFieldDefinition, value: unknown) => {
    setSavingField(field.id)
    const nextValues = { ...values, [field.id]: value }
    setValues(nextValues)
    try {
      const result = await api.updateTaskCustomFieldValues(taskId, { [field.id]: value })
      setValues(result.values)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '字段保存失败')
      await loadFields()
    } finally {
      setSavingField(null)
    }
  }, [loadFields, taskId, values])

  const visibleFields = fields.filter((field) => !field.archivedAt)

  return (
    <div className="flex flex-col gap-2">
      {/* 任务级表情反应 */}
      <div className="flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          onClick={() => void toggleReaction('👍', !hasMessageReaction(reactions, '👍', currentUserId))}
          className={cn(
            'inline-flex h-7 items-center gap-1 rounded-full border px-2 text-[11px] transition-colors',
            hasMessageReaction(reactions, '👍', currentUserId)
              ? 'border-zinc-500 bg-zinc-800 text-zinc-100'
              : 'border-zinc-800 bg-zinc-900/70 text-zinc-400 hover:border-zinc-700 hover:text-zinc-200',
          )}
        >
          <ThumbsUp size={12} />
          点赞
        </button>
        {reactions.map((reaction) => {
          const reacted = reaction.userIds.includes(currentUserId)
          return (
            <button
              key={reaction.emoji}
              type="button"
              onClick={() => void toggleReaction(reaction.emoji, !reacted)}
              className={cn(
                'inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[11px] transition-colors',
                reacted
                  ? 'border-zinc-500 bg-zinc-800 text-zinc-100'
                  : 'border-zinc-800 bg-zinc-900/70 text-zinc-400 hover:border-zinc-700 hover:text-zinc-200',
              )}
              title={reaction.userIds.join(', ')}
            >
              <span>{reaction.emoji}</span>
              <span>{reaction.userIds.length}</span>
            </button>
          )
        })}
        <Popover>
          <PopoverTrigger asChild>
            <button
              type="button"
              className="flex h-7 w-7 items-center justify-center rounded-full border border-zinc-800 bg-zinc-900/70 text-zinc-500 transition-colors hover:border-zinc-700 hover:text-zinc-200"
            >
              <Smile size={12} />
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-64 p-2" align="start">
            <EmojiPicker
              onSelect={(emoji) => {
                void toggleReaction(emoji, !hasMessageReaction(reactions, emoji, currentUserId))
              }}
            />
          </PopoverContent>
        </Popover>
      </div>

      {/* 自定义字段 */}
      <div className="flex flex-col gap-1.5">
        {fieldsLoading ? (
          <p className="text-[11px] text-zinc-600">字段加载中…</p>
        ) : visibleFields.length === 0 ? (
          <p className="text-[11px] text-zinc-600">暂无自定义字段（含工时）。</p>
        ) : (
          visibleFields.map((field) => (
            <div key={field.id} className="flex items-center justify-between gap-2">
              <span className="w-24 shrink-0 truncate text-[11px] text-zinc-500" title={field.name}>
                {field.name}
              </span>
              <span className="min-w-0 flex-1 text-right text-xs text-zinc-200">
                {savingField === field.id
                  ? '保存中…'
                  : formatFieldValue(field, values[field.id]) || (
                    <span className="text-zinc-600">未设置</span>
                  )}
              </span>
              <Popover>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-zinc-600 transition-colors hover:bg-zinc-800 hover:text-zinc-300"
                    title={`编辑 ${field.name}`}
                  >
                    <Settings2 size={11} />
                  </button>
                </PopoverTrigger>
                <PopoverContent className="w-64 p-3" align="end">
                  <p className="mb-2 text-xs font-medium text-zinc-300">{field.name}</p>
                  <FieldValueEditor
                    field={field}
                    value={values[field.id]}
                    onChange={(value) => void updateFieldValue(field, value)}
                  />
                </PopoverContent>
              </Popover>
            </div>
          ))
        )}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setManagerOpen(true)}
            className="inline-flex items-center gap-1 rounded-md border border-zinc-800 bg-zinc-900/70 px-2 py-1 text-[11px] text-zinc-400 transition-colors hover:border-zinc-700 hover:text-zinc-200"
          >
            <Settings2 size={11} />
            管理字段
          </button>
          <span className="text-[10px] text-zinc-600">
            {attachments.length > 0 ? `${attachments.length} 个附件` : ''}
          </span>
        </div>
      </div>

      {/* 任务级附件（Drive 引用） */}
      {attachments.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {attachments.map((attachment) => (
            <a
              key={attachment.id}
              href={attachment.url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex max-w-52 items-center gap-1 truncate rounded-md border border-zinc-800 bg-zinc-900/70 px-2 py-1 text-[11px] text-zinc-400 transition-colors hover:border-zinc-700 hover:text-zinc-200"
              title={attachment.filename}
            >
              <span className="truncate">{attachment.filename}</span>
            </a>
          ))}
        </div>
      ) : null}

      <TaskFieldManagerDialog
        projectId={projectId}
        open={managerOpen}
        onOpenChange={setManagerOpen}
        onChanged={() => void loadFields()}
      />
    </div>
  )
}

/** 项目级字段管理对话框：列表 + 新建/编辑/归档 + 统计。 */
export function TaskFieldManagerDialog(props: {
  projectId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  onChanged?: () => void
}) {
  const { projectId, open, onOpenChange, onChanged } = props
  const [fields, setFields] = useState<TaskCustomFieldDefinition[]>([])
  const [busy, setBusy] = useState(false)
  const [creating, setCreating] = useState(false)
  const [stats, setStats] = useState<{
    totalCount: number
    statusCounts: Record<string, number>
    completedCount: number
    fields: Record<string, { type: string; count: number; sum?: number }>
  } | null>(null)
  const [draft, setDraft] = useState({ name: '', key: '', type: 'text' as TaskCustomFieldType, options: '' })

  const load = useCallback(async () => {
    try {
      const [fieldResponse, statsResponse] = await Promise.all([
        api.listTaskCustomFieldDefinitions(projectId, true),
        api.getTaskFieldStats(projectId),
      ])
      setFields(fieldResponse.fields)
      setStats(statsResponse)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '字段加载失败')
    }
  }, [projectId])

  useEffect(() => {
    if (open) {
      void load()
    }
  }, [load, open])

  const submitCreate = async () => {
    if (!draft.name.trim() || !draft.key.trim()) {
      toast.error('名称与 key 必填。')
      return
    }
    setBusy(true)
    try {
      const options = draft.type === 'select' || draft.type === 'multi_select'
        ? draft.options.split(',').map((item) => item.trim()).filter(Boolean).map((value) => ({ label: value, value }))
        : undefined
      await api.createTaskCustomFieldDefinition(projectId, {
        name: draft.name.trim(),
        key: draft.key.trim(),
        type: draft.type,
        options,
      })
      setCreating(false)
      setDraft({ name: '', key: '', type: 'text', options: '' })
      await load()
      onChanged?.()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '创建字段失败')
    } finally {
      setBusy(false)
    }
  }

  const archive = async (field: TaskCustomFieldDefinition) => {
    setBusy(true)
    try {
      await api.archiveTaskCustomFieldDefinition(projectId, field.id)
      await load()
      onChanged?.()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '归档字段失败')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>项目自定义字段</DialogTitle>
        </DialogHeader>
        <DialogBody className="space-y-3">
        {stats ? (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-[11px] text-zinc-500">
            <span>任务总数 <span className="text-zinc-200">{stats.totalCount}</span></span>
            <span>已完成 <span className="text-zinc-200">{stats.completedCount}</span></span>
            {Object.entries(stats.fields).map(([key, value]) => (
              <span key={key}>
                {key}
                {value.sum !== undefined ? `（合计 ${value.sum}）` : `（${value.count} 已填）`}
              </span>
            ))}
          </div>
        ) : null}
        <div className="flex max-h-80 flex-col gap-1.5 overflow-y-auto">
          {fields.map((field) => (
            <div key={field.id} className="flex items-center justify-between gap-2 rounded-md border border-zinc-800 bg-zinc-950 px-2 py-1.5">
              <div className="min-w-0">
                <p className="truncate text-xs text-zinc-200">{field.name} <span className="text-zinc-600">({field.key})</span></p>
                <p className="text-[10px] text-zinc-600">{FIELD_TYPE_LABELS[field.type]}{field.required ? ' · 必填' : ''}{field.archivedAt ? ' · 已归档' : ''}</p>
              </div>
              {!field.archivedAt ? (
                <button
                  type="button"
                  onClick={() => void archive(field)}
                  className="rounded p-1 text-zinc-600 transition-colors hover:bg-zinc-800 hover:text-zinc-300"
                >
                  <X size={12} />
                </button>
              ) : null}
            </div>
          ))}
        </div>
        {creating ? (
          <div className="flex flex-col gap-2 rounded-md border border-zinc-800 bg-zinc-950 p-3">
            <div className="flex gap-2">
              <Input
                className="h-7 text-xs"
                placeholder="名称（如 预估工时）"
                value={draft.name}
                onChange={(event) => setDraft({ ...draft, name: event.target.value })}
              />
              <Input
                className="h-7 w-32 text-xs"
                placeholder="key（如 est_hours）"
                value={draft.key}
                onChange={(event) => setDraft({ ...draft, key: event.target.value })}
              />
            </div>
            <Select value={draft.type} onValueChange={(type) => setDraft({ ...draft, type: type as TaskCustomFieldType })}>
              <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                {(Object.keys(FIELD_TYPE_LABELS) as TaskCustomFieldType[]).map((type) => (
                  <SelectItem key={type} value={type}>{FIELD_TYPE_LABELS[type]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {(draft.type === 'select' || draft.type === 'multi_select') ? (
              <Input
                className="h-7 text-xs"
                placeholder="选项，逗号分隔（如 低,中,高）"
                value={draft.options}
                onChange={(event) => setDraft({ ...draft, options: event.target.value })}
              />
            ) : null}
            <div className="flex justify-end gap-2">
              <Button size="sm" variant="ghost" onClick={() => setCreating(false)}>取消</Button>
              <Button size="sm" disabled={busy} onClick={() => void submitCreate()}>
                <Plus size={12} /> 创建
              </Button>
            </div>
          </div>
        ) : (
          <Button size="sm" variant="outline" onClick={() => setCreating(true)}>
            <Plus size={12} /> 新建字段
          </Button>
        )}
        </DialogBody>
      </DialogContent>
    </Dialog>
  )
}
