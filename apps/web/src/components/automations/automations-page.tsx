import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import type {
  AutomationRecord,
  AutomationRunRecord,
  AutomationTriggerRecord,
  Workspace,
} from '@shared/types'
import { getProjectColor } from '@shared/project-color'
import {
  Clock3,
  Globe,
  MoreHorizontal,
  PauseCircle,
  Play,
  Plus,
  RefreshCw,
  Save,
  Search,
  Trash2,
  Zap,
} from 'lucide-react'
import { toast } from 'sonner'
import { Group, Panel, Separator } from 'react-resizable-panels'

import { Badge } from '../ui/badge'
import { Button } from '../ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '../ui/dropdown-menu'
import { Input } from '../ui/input'
import { ScrollArea } from '../ui/scroll-area'
import { SearchableSelect } from '../ui/searchable-select'
import { Textarea } from '../ui/textarea'
import { RuntimeIcon } from '../runtime/runtime-icons'
import { api, type AutomationDetail, type AutomationListItem } from '../../lib/api'
import { useApp } from '../../lib/app-provider'
import { buildTaskAgentOptions } from '../../lib/agent-runtime-options'
import { useTranslation } from '../../lib/i18n/react'
import { cn } from '../../lib/utils'

type AutomationFormState = {
  title: string
  prompt: string
  agentType: AutomationRecord['agentType']
  workspaceId: string
}

type ScheduleFrequency = 'hourly' | 'daily' | 'weekdays' | 'weekly' | 'custom'

type ScheduleFormState = {
  frequency: ScheduleFrequency
  hour: string
  minute: string
  timezone: string
  customCron: string
}

const tr = (language: string, zh: string, en: string) => (language === 'zh' ? zh : en)

const formatTime = (value?: string | null) => {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString()
}

const getNextRunAt = (automation: Pick<AutomationListItem, 'triggers'>) => {
  return automation.triggers
    .filter((trigger) => trigger.kind === 'schedule' && trigger.enabled && trigger.nextRunAt)
    .sort((left, right) => (left.nextRunAt ?? '').localeCompare(right.nextRunAt ?? ''))[0]?.nextRunAt
}

const statusDotClassName = (status: string) => {
  if (status === 'active' || status === 'completed') return 'bg-emerald-400'
  if (status === 'paused' || status === 'coalesced') return 'bg-amber-400'
  if (status === 'failed' || status === 'archived') return 'bg-rose-400'
  if (status === 'task_created' || status === 'received') return 'bg-sky-400'
  return 'bg-zinc-500'
}

const statusBadgeClassName = (status: string) => {
  if (status === 'active' || status === 'completed') return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
  if (status === 'paused' || status === 'coalesced') return 'border-amber-500/30 bg-amber-500/10 text-amber-300'
  if (status === 'failed' || status === 'archived') return 'border-rose-500/30 bg-rose-500/10 text-rose-300'
  if (status === 'task_created' || status === 'received') return 'border-sky-500/30 bg-sky-500/10 text-sky-300'
  if (status === 'skipped') return 'border-zinc-700 bg-zinc-800 text-zinc-300'
  return 'border-zinc-700 bg-zinc-900 text-zinc-300'
}

const frequencyToCron = (frequency: ScheduleFrequency, hour: string, minute: string, customCron: string): string => {
  const h = hour || '9'
  const m = minute || '0'
  switch (frequency) {
    case 'hourly': return `${m} * * * *`
    case 'daily': return `${m} ${h} * * *`
    case 'weekdays': return `${m} ${h} * * 1-5`
    case 'weekly': return `${m} ${h} * * 1`
    case 'custom': return customCron
  }
}

const cronToScheduleState = (cronExpression?: string | null, timezone?: string | null): ScheduleFormState => {
  if (!cronExpression) {
    return { frequency: 'daily', hour: '9', minute: '0', timezone: timezone || 'Asia/Shanghai', customCron: '' }
  }

  const parts = cronExpression.trim().split(/\s+/)
  if (parts.length !== 5) {
    return { frequency: 'custom', hour: '9', minute: '0', timezone: timezone || 'Asia/Shanghai', customCron: cronExpression }
  }

  const [min, hr, dayOfMonth, month, dayOfWeek] = parts
  if (hr === '*' && dayOfMonth === '*' && month === '*' && dayOfWeek === '*') {
    return { frequency: 'hourly', hour: '0', minute: min, timezone: timezone || 'Asia/Shanghai', customCron: '' }
  }
  if (dayOfMonth === '*' && month === '*' && dayOfWeek === '*') {
    return { frequency: 'daily', hour: hr, minute: min, timezone: timezone || 'Asia/Shanghai', customCron: '' }
  }
  if (dayOfMonth === '*' && month === '*' && dayOfWeek === '1-5') {
    return { frequency: 'weekdays', hour: hr, minute: min, timezone: timezone || 'Asia/Shanghai', customCron: '' }
  }
  if (dayOfMonth === '*' && month === '*' && dayOfWeek === '1') {
    return { frequency: 'weekly', hour: hr, minute: min, timezone: timezone || 'Asia/Shanghai', customCron: '' }
  }

  return { frequency: 'custom', hour: '9', minute: '0', timezone: timezone || 'Asia/Shanghai', customCron: cronExpression }
}

const FREQUENCY_OPTIONS: { value: ScheduleFrequency; label: (language: string) => string }[] = [
  { value: 'hourly', label: (l) => tr(l, '每小时', 'Hourly') },
  { value: 'daily', label: (l) => tr(l, '每天', 'Daily') },
  { value: 'weekdays', label: (l) => tr(l, '工作日', 'Weekdays') },
  { value: 'weekly', label: (l) => tr(l, '每周一', 'Weekly') },
  { value: 'custom', label: (l) => tr(l, '自定义', 'Custom') },
]

const TIMEZONE_OPTIONS = [
  { value: 'Asia/Shanghai', label: 'Asia/Shanghai (GMT+8)' },
  { value: 'UTC', label: 'UTC' },
  { value: 'America/Los_Angeles', label: 'America/Los_Angeles (PT)' },
  { value: 'Europe/London', label: 'Europe/London (GMT)' },
]

const createFormFromAutomation = (automation?: AutomationDetail | null, fallbackWorkspaceId = ''): AutomationFormState => ({
  title: automation?.title ?? '',
  prompt: automation?.description ?? '',
  agentType: automation?.agentType ?? 'OpenCode',
  workspaceId: automation?.workspaceId ?? fallbackWorkspaceId,
})

const getScheduleTrigger = (automation?: AutomationDetail | null): AutomationTriggerRecord | null => {
  return automation?.triggers.find((t) => t.kind === 'schedule') ?? null
}

export function AutomationsPage() {
  const { language } = useTranslation()
  const navigate = useNavigate()

  const { state, selectedProjectId, setSelectedProjectId } = useApp()
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [running, setRunning] = useState(false)
  const [automations, setAutomations] = useState<AutomationListItem[]>([])
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [selectedAutomationId, setSelectedAutomationId] = useState('')
  const [selectedAutomation, setSelectedAutomation] = useState<AutomationDetail | null>(null)
  const [isCreating, setIsCreating] = useState(false)
  const [form, setForm] = useState<AutomationFormState>(() => createFormFromAutomation())
  const [schedule, setSchedule] = useState<ScheduleFormState>(() => cronToScheduleState())
  const [runDialogOpen, setRunDialogOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const projectRequestRef = useRef(0)
  const detailRequestRef = useRef(0)

  const currentProject = useMemo(
    () => state.projects.find((p) => p.id === selectedProjectId) ?? state.projects[0] ?? null,
    [selectedProjectId, state.projects],
  )
  const projectOptions = useMemo(
    () => state.projects.map((project) => ({
      value: project.id,
      label: project.name,
      color: getProjectColor(project),
      description: project.defaultBranch ? `${tr(language, '默认分支', 'Default')} ${project.defaultBranch}` : '',
      keywords: [project.name, project.defaultBranch].filter(Boolean) as string[],
    })),
    [language, state.projects],
  )
  const workspaceOptions = useMemo(
    () => workspaces.map((workspace) => ({
      value: workspace.id,
      label: workspace.name,
      description: workspace.defaultBranch
        ? `${tr(language, '默认分支', 'Default')} ${workspace.defaultBranch}`
        : workspace.executorName,
      keywords: [
        workspace.name,
        workspace.defaultBranch,
        workspace.executorName,
      ].filter(Boolean) as string[],
    })),
    [language, workspaces],
  )
  const agentOptions = useMemo(
    () => buildTaskAgentOptions().map((agentType) => ({
      ...agentType,
      icon: <RuntimeIcon runtime={agentType.value} size={15} />,
    })),
    [],
  )

  const filteredAutomations = useMemo(() => {
    if (!searchQuery.trim()) return automations
    const q = searchQuery.toLowerCase()
    return automations.filter((a) => a.title.toLowerCase().includes(q))
  }, [automations, searchQuery])

  const loadProjectData = useCallback(async (projectId: string) => {
    const requestId = ++projectRequestRef.current
    setLoading(true)
    try {
      const [automationResponse, workspaceResponse] = await Promise.all([
        api.listProjectAutomations(projectId),
        api.listProjectWorkspaces(projectId),
      ])
      if (requestId !== projectRequestRef.current) return
      setAutomations(automationResponse.automations)
      setWorkspaces(workspaceResponse.workspaces)
    } catch (error) {
      if (requestId !== projectRequestRef.current) return
      toast.error(error instanceof Error ? error.message : tr(language, '加载自动化失败。', 'Failed to load automations.'))
      setAutomations([])
      setWorkspaces([])
    } finally {
      if (requestId === projectRequestRef.current) setLoading(false)
    }
  }, [language])

  const loadAutomationDetail = useCallback(async (automationId: string) => {
    const requestId = ++detailRequestRef.current
    try {
      const response = await api.getAutomation(automationId)
      if (requestId !== detailRequestRef.current) return
      setSelectedAutomation(response.automation)
      setForm(createFormFromAutomation(response.automation))
      const scheduleTrigger = getScheduleTrigger(response.automation)
      setSchedule(cronToScheduleState(scheduleTrigger?.cronExpression, scheduleTrigger?.timezone))
    } catch (error) {
      if (requestId !== detailRequestRef.current) return
      toast.error(error instanceof Error ? error.message : tr(language, '加载详情失败。', 'Failed to load detail.'))
      setSelectedAutomation(null)
    }
  }, [language])

  useEffect(() => {
    if (!selectedProjectId && currentProject?.id) {
      setSelectedProjectId(currentProject.id)
    }
  }, [currentProject?.id, selectedProjectId, setSelectedProjectId])

  useEffect(() => {
    if (!currentProject?.id) {
      setAutomations([])
      setWorkspaces([])
      setSelectedAutomationId('')
      setSelectedAutomation(null)
      setIsCreating(false)
      setForm(createFormFromAutomation())
      setSchedule(cronToScheduleState())
      return
    }
    setAutomations([])
    setWorkspaces([])
    setSelectedAutomation(null)
    setSelectedAutomationId('')
    setForm(createFormFromAutomation())
    setSchedule(cronToScheduleState())
    void loadProjectData(currentProject.id)
  }, [currentProject?.id, loadProjectData])

  useEffect(() => {
    if (isCreating) {
      setSelectedAutomation(null)
      setSelectedAutomationId('')
      setForm(createFormFromAutomation(undefined, workspaces[0]?.id ?? ''))
      setSchedule(cronToScheduleState())
      return
    }
    if (automations.length === 0) {
      setSelectedAutomationId('')
      setSelectedAutomation(null)
      setForm(createFormFromAutomation(undefined, workspaces[0]?.id ?? ''))
      return
    }
    if (automations.some((item) => item.id === selectedAutomationId)) return
    setSelectedAutomationId(automations[0]?.id ?? '')
  }, [automations, isCreating, selectedAutomationId, workspaces])

  useEffect(() => {
    const nextWorkspaceId = workspaces[0]?.id ?? ''
    if (form.workspaceId && workspaces.some((workspace) => workspace.id === form.workspaceId)) {
      return
    }
    setForm((current) => (
      current.workspaceId === nextWorkspaceId
        ? current
        : { ...current, workspaceId: nextWorkspaceId }
    ))
  }, [form.workspaceId, workspaces])

  useEffect(() => {
    if (!selectedAutomationId || isCreating) return
    void loadAutomationDetail(selectedAutomationId)
  }, [isCreating, loadAutomationDetail, selectedAutomationId])

  const handleRefresh = async () => {
    if (!currentProject?.id) return
    await loadProjectData(currentProject.id)
    if (selectedAutomationId && !isCreating) {
      await loadAutomationDetail(selectedAutomationId)
    }
  }

  const handleCreateMode = () => {
    setIsCreating(true)
    setForm(createFormFromAutomation(undefined, workspaces[0]?.id ?? ''))
    setSchedule(cronToScheduleState())
  }

  const handleSave = async () => {
    if (!currentProject?.id) return
    if (!form.title.trim()) {
      toast.error(tr(language, '请输入自动化名称。', 'Please enter a name.'))
      return
    }
    if (!form.prompt.trim()) {
      toast.error(tr(language, '请输入提示词。', 'Please enter a prompt.'))
      return
    }

    const selectedWorkspaceId = form.workspaceId.trim()
    if (!selectedWorkspaceId) {
      toast.error(tr(language, '当前项目没有可用工作区，请先创建工作区。', 'No workspace available. Create a workspace first.'))
      return
    }

    setSaving(true)
    try {
      const cronExpression = frequencyToCron(schedule.frequency, schedule.hour, schedule.minute, schedule.customCron)

      const payload = {
        title: form.title.trim(),
        description: form.prompt.trim(),
        status: 'active' as const,
        priority: 'medium' as const,
        difficulty: 'medium' as const,
        agentType: form.agentType,
        workspaceId: selectedWorkspaceId,
        returnMode: 'commit' as const,
        syncBackStrategy: 'none' as const,
        gitIdentityMode: 'personal' as const,
        concurrencyPolicy: 'coalesce_if_active' as const,
        catchUpPolicy: 'skip_missed' as const,
        variables: [] as AutomationRecord['variables'],
      }

      if (isCreating) {
        const created = await api.createAutomation(currentProject.id, payload)
        toast.success(tr(language, '自动化已创建。', 'Automation created.'))

        if (cronExpression.trim()) {
          await api.createAutomationTrigger(created.automation.id, {
            kind: 'schedule',
            cronExpression,
            timezone: schedule.timezone,
            enabled: true,
          })
        }

        setIsCreating(false)
        setSelectedAutomationId(created.automation.id)
        await loadProjectData(currentProject.id)
        await loadAutomationDetail(created.automation.id)
        return
      }

      if (!selectedAutomationId) return

      await api.updateAutomation(selectedAutomationId, payload)

      const existingScheduleTrigger = getScheduleTrigger(selectedAutomation)
      if (existingScheduleTrigger) {
        await api.updateAutomationTrigger(existingScheduleTrigger.id, {
          cronExpression,
          timezone: schedule.timezone,
        })
      } else if (cronExpression.trim()) {
        await api.createAutomationTrigger(selectedAutomationId, {
          kind: 'schedule',
          cronExpression,
          timezone: schedule.timezone,
          enabled: true,
        })
      }

      toast.success(tr(language, '自动化已更新。', 'Automation updated.'))
      await loadProjectData(currentProject.id)
      await loadAutomationDetail(selectedAutomationId)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : tr(language, '保存失败。', 'Save failed.'))
    } finally {
      setSaving(false)
    }
  }

  const handleRunNow = async () => {
    if (isCreating || !selectedAutomationId) return
    setRunning(true)
    try {
      const response = await api.runAutomation(selectedAutomationId, {})
      toast.success(
        response.run.status === 'failed'
          ? tr(language, '触发失败。', 'Trigger failed.')
          : tr(language, '已触发运行。', 'Run triggered.'),
      )
      setRunDialogOpen(false)
      if (currentProject?.id) await loadProjectData(currentProject.id)
      await loadAutomationDetail(selectedAutomationId)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : tr(language, '触发失败。', 'Failed to trigger.'))
    } finally {
      setRunning(false)
    }
  }

  const handleTogglePause = async () => {
    if (!selectedAutomation || isCreating) return
    const nextStatus = selectedAutomation.status === 'active' ? 'paused' : 'active'
    try {
      await api.updateAutomation(selectedAutomation.id, { status: nextStatus })
      toast.success(
        nextStatus === 'paused'
          ? tr(language, '自动化已暂停。', 'Automation paused.')
          : tr(language, '自动化已恢复。', 'Automation resumed.'),
      )
      if (currentProject?.id) await loadProjectData(currentProject.id)
      await loadAutomationDetail(selectedAutomation.id)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : tr(language, '操作失败。', 'Operation failed.'))
    }
  }

  const handleArchive = async () => {
    if (!selectedAutomation || isCreating) return
    try {
      await api.updateAutomation(selectedAutomation.id, { status: 'archived' })
      toast.success(tr(language, '自动化已归档。', 'Automation archived.'))
      if (currentProject?.id) await loadProjectData(currentProject.id)
      await loadAutomationDetail(selectedAutomation.id)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : tr(language, '归档失败。', 'Archive failed.'))
    }
  }

  const openLinkedTask = (run: AutomationRunRecord) => {
    if (!run.linkedTaskId || !currentProject?.id) return
    void navigate({
      to: '/kanban',
      search: {
        projectId: currentProject.id,
        taskId: run.linkedTaskId,
        createTask: undefined,
      },
    })
  }

  const scheduleTrigger = getScheduleTrigger(selectedAutomation)

  if (!currentProject) {
    return (
      <div className="flex h-full min-h-[24rem] items-center justify-center text-sm text-zinc-500">
        {tr(language, '当前没有可用项目，请先创建项目。', 'No project available. Create a project first.')}
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <Group orientation="horizontal" className="min-h-0 flex-1">
        {/* ── Sidebar Panel ── */}
        <Panel defaultSize="22%" minSize="18%" maxSize="30%">
          <div className="flex h-full min-h-0 flex-col border-r border-zinc-900 bg-[#060607]">
            {/* Sidebar header */}
            <div className="flex shrink-0 items-center justify-between gap-2 border-b border-zinc-900 px-3 py-2.5">
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-sm font-semibold text-zinc-200 truncate">
                  {tr(language, '自动化', 'Automations')}
                </span>
                <span className="shrink-0 text-[11px] text-zinc-600">{currentProject.name}</span>
              </div>
              <div className="flex items-center gap-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => void handleRefresh()}
                  className="h-7 w-7 rounded-md text-zinc-500 hover:bg-zinc-900 hover:text-zinc-200"
                >
                  <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={handleCreateMode}
                  className="h-7 w-7 rounded-md text-zinc-500 hover:bg-zinc-900 hover:text-zinc-200"
                >
                  <Plus className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>

            {/* Search */}
            <div className="shrink-0 border-b border-zinc-900 px-3 py-2">
              <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-600" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder={tr(language, '搜索…', 'Search…')}
                  className="h-7 w-full rounded-md border border-zinc-800 bg-zinc-950 pl-8 pr-2 text-xs text-zinc-200 placeholder:text-zinc-600 focus:border-zinc-700 focus:outline-none"
                />
              </div>
            </div>

            {/* List */}
            <ScrollArea className="flex-1 min-h-0">
              <div className="px-1.5 py-1.5">
                {filteredAutomations.length === 0 ? (
                  <div className="px-2 py-6 text-center text-xs text-zinc-600">
                    {searchQuery
                      ? tr(language, '没有匹配结果。', 'No matches.')
                      : tr(language, '还没有自动化。', 'No automations yet.')}
                  </div>
                ) : (
                  filteredAutomations.map((automation) => {
                    const selected = !isCreating && automation.id === selectedAutomationId
                    const nextRun = getNextRunAt(automation)
                    return (
                      <button
                        key={automation.id}
                        type="button"
                        onClick={() => {
                          setIsCreating(false)
                          setSelectedAutomationId(automation.id)
                        }}
                        className={cn(
                          'group flex w-full items-start gap-2.5 rounded-md px-2.5 py-2 text-left transition-colors',
                          selected
                            ? 'bg-zinc-900/80 text-zinc-100'
                            : 'text-zinc-400 hover:bg-zinc-900/40 hover:text-zinc-200',
                        )}
                      >
                        <div className="flex min-w-0 flex-1 items-center gap-2">
                          <span className={cn('h-[5px] w-[5px] shrink-0 rounded-full', statusDotClassName(automation.status))} />
                          <span className="min-w-0 truncate text-[13px] font-medium leading-none">{automation.title}</span>
                        </div>
                        {nextRun ? (
                          <span className="shrink-0 self-center text-[11px] text-zinc-600">
                            {formatTime(nextRun)}
                          </span>
                        ) : null}
                      </button>
                    )
                  })
                )}
              </div>
            </ScrollArea>
          </div>
        </Panel>

        <Separator className="w-px bg-zinc-900" />

        {/* ── Detail Panel ── */}
        <Panel defaultSize="78%" minSize="50%">
          {!isCreating && !selectedAutomation && automations.length > 0 ? (
            <div className="flex h-full items-center justify-center text-sm text-zinc-600">
              {tr(language, '选择左侧自动化查看详情', 'Select an automation from the sidebar')}
            </div>
          ) : automations.length === 0 && !isCreating ? (
            <div className="flex h-full flex-col items-center justify-center gap-4 text-center">
              <div className="text-sm text-zinc-500">
                {tr(language, '还没有自动化', 'No automations yet')}
              </div>
              <Button type="button" onClick={handleCreateMode} className="bg-zinc-100 text-zinc-950 hover:bg-zinc-200">
                <Plus className="mr-1.5 h-4 w-4" />
                {tr(language, '新建自动化', 'Create Automation')}
              </Button>
            </div>
          ) : (
            <div className="flex h-full min-h-0 flex-col">
              {/* Detail header bar */}
              <div className="flex shrink-0 items-center justify-between gap-3 border-b border-zinc-900 px-4 py-2.5">
                <div className="min-w-0 flex-1">
                  <h2 className="text-sm font-semibold text-zinc-100 truncate">
                    {isCreating
                      ? tr(language, '新建自动化', 'New Automation')
                      : selectedAutomation?.title || tr(language, '自动化详情', 'Detail')}
                  </h2>
                  <p className="text-[11px] text-zinc-600 mt-0.5">
                    {currentProject.name}
                  </p>
                </div>
                <div className="flex items-center gap-1.5">
                  {!isCreating && selectedAutomation ? (
                    <>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={handleTogglePause}
                        className="h-7 rounded-md border border-zinc-800 bg-zinc-950 px-2 text-xs text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100"
                      >
                        {selectedAutomation.status === 'active'
                          ? <><PauseCircle className="mr-1 h-3.5 w-3.5" />{tr(language, '暂停', 'Pause')}</>
                          : <><Play className="mr-1 h-3.5 w-3.5" />{tr(language, '恢复', 'Resume')}</>}
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => setRunDialogOpen(true)}
                        disabled={running}
                        className="h-7 rounded-md border border-zinc-800 bg-zinc-950 px-2 text-xs text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100"
                      >
                        <Zap className="mr-1 h-3.5 w-3.5" />
                        {tr(language, '运行', 'Run')}
                      </Button>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 rounded-md border border-zinc-800 bg-zinc-950 text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100"
                          >
                            <MoreHorizontal className="h-3.5 w-3.5" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-44">
                          <DropdownMenuItem
                            onSelect={handleArchive}
                            className="text-rose-300 focus:bg-rose-500/10 focus:text-rose-100"
                          >
                            <Trash2 className="h-4 w-4" />
                            {tr(language, '归档', 'Archive')}
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </>
                  ) : null}
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => void handleSave()}
                    disabled={saving || (!isCreating && !selectedAutomationId)}
                    className="h-7 rounded-md bg-zinc-100 px-2.5 text-xs font-medium text-zinc-950 hover:bg-zinc-200"
                  >
                    <Save className="mr-1 h-3.5 w-3.5" />
                    {saving ? tr(language, '保存中…', 'Saving…') : tr(language, '保存', 'Save')}
                  </Button>
                </div>
              </div>

              {/* Body: form + settings sidebar */}
              <div className="flex min-h-0 flex-1 overflow-hidden">
                {/* Main form area */}
                <div className="flex min-h-0 flex-1 flex-col overflow-auto">
                  <div className="mx-auto w-full max-w-3xl space-y-5 px-6 py-5">
                    {/* Name */}
                    <div>
                      <label className="mb-1.5 block text-xs font-medium text-zinc-400">
                        {tr(language, '名称', 'Name')}
                      </label>
                      <Input
                        value={form.title}
                        onChange={(e) => setForm((c) => ({ ...c, title: e.target.value }))}
                        placeholder={tr(language, '例如：每日代码审查', 'e.g. Daily code review')}
                        className="h-9 rounded-lg border-zinc-800 bg-zinc-950 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-zinc-700"
                      />
                    </div>

                    {/* Prompt */}
                    <div className="flex-1 min-h-0">
                      <div className="mb-1.5 flex items-center gap-2">
                        <label className="text-xs font-medium text-zinc-400">
                          {tr(language, '提示词', 'Prompt')}
                        </label>
                        <span className="text-[10px] text-zinc-600">
                          {tr(language, '每次运行时 Agent 会读取', 'Agent reads on every run')}
                        </span>
                      </div>
                      <Textarea
                        rows={18}
                        value={form.prompt}
                        onChange={(e) => setForm((c) => ({ ...c, prompt: e.target.value }))}
                        placeholder={tr(
                          language,
                          '# 目标\n你希望智能体完成什么？\n\n# 上下文\n这是给谁的？有什么约束？\n\n# 步骤\n1. ...\n2. ...',
                          '# Goal\nWhat should the agent accomplish?\n\n# Context\nWho is this for? Any constraints?\n\n# Steps\n1. ...\n2. ...',
                        )}
                        className="min-h-[360px] resize-none rounded-lg border-zinc-800 bg-zinc-950 font-mono text-sm leading-relaxed text-zinc-200 placeholder:text-zinc-600 focus:border-zinc-700"
                      />
                    </div>
                  </div>
                </div>

                <div className="w-px shrink-0 bg-zinc-900" />

                {/* Settings sidebar */}
                <div className="w-[260px] shrink-0 overflow-auto border-l border-zinc-900 bg-[#060607]">
                  <div className="space-y-4 px-4 py-4">
                    {/* Project */}
                    <div>
                      <label className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-zinc-500">
                        {tr(language, '项目', 'Project')}
                      </label>
                      <SearchableSelect
                        value={currentProject?.id ?? ''}
                        onChange={(value) => value && setSelectedProjectId(value)}
                        options={projectOptions}
                        placeholder={tr(language, '选择项目', 'Select project')}
                        emptyText={tr(language, '没有可选项目', 'No project')}
                        searchPlaceholder={tr(language, '搜索', 'Search')}
                        triggerClassName="h-8 rounded-lg px-2.5 text-xs"
                      />
                    </div>

                    {/* Workspace */}
                    <div>
                      <label className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-zinc-500">
                        {tr(language, '工作区', 'Workspace')}
                      </label>
                      <SearchableSelect
                        value={form.workspaceId}
                        onChange={(value) => setForm((current) => ({ ...current, workspaceId: value }))}
                        options={workspaceOptions}
                        placeholder={tr(language, '选择工作区', 'Select workspace')}
                        emptyText={tr(language, '无可用工作区', 'No workspace')}
                        searchPlaceholder={tr(language, '搜索', 'Search')}
                        disabled={workspaceOptions.length === 0}
                        triggerClassName="h-8 rounded-lg px-2.5 text-xs"
                      />
                    </div>

                    {/* Agent */}
                    <div>
                      <label className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-zinc-500">
                        {tr(language, '执行 Agent', 'Agent')}
                      </label>
                      <SearchableSelect
                        value={form.agentType}
                        onChange={(value) => setForm((c) => ({ ...c, agentType: value as AutomationRecord['agentType'] }))}
                        options={agentOptions}
                        placeholder={tr(language, '选择 Agent', 'Select agent')}
                        emptyText={tr(language, '无可用 Agent', 'No agents')}
                        searchPlaceholder={tr(language, '搜索', 'Search')}
                        triggerClassName="h-8 rounded-lg px-2.5 text-xs"
                      />
                    </div>

                    <div className="h-px bg-zinc-900" />

                    {/* Schedule */}
                    <div>
                      <div className="mb-2.5 flex items-center gap-1.5">
                        <Clock3 className="h-3.5 w-3.5 text-zinc-500" />
                        <span className="text-[11px] font-medium uppercase tracking-wide text-zinc-500">
                          {tr(language, '定时运行', 'Schedule')}
                        </span>
                      </div>

                      {/* Frequency chips */}
                      <div className="mb-3 flex flex-wrap gap-1">
                        {FREQUENCY_OPTIONS.map((opt) => (
                          <button
                            key={opt.value}
                            type="button"
                            onClick={() => setSchedule((c) => ({ ...c, frequency: opt.value }))}
                            className={cn(
                              'rounded-md px-2 py-1 text-[11px] font-medium transition-colors',
                              schedule.frequency === opt.value
                                ? 'bg-zinc-100 text-zinc-950'
                                : 'bg-zinc-900 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200',
                            )}
                          >
                            {opt.label(language)}
                          </button>
                        ))}
                      </div>

                      {/* Time */}
                      {schedule.frequency !== 'hourly' && schedule.frequency !== 'custom' ? (
                        <div className="mb-2.5">
                          <label className="mb-1 block text-[11px] text-zinc-600">
                            {tr(language, '时间', 'Time')}
                          </label>
                          <div className="flex items-center gap-1">
                            <Input
                              type="number"
                              min={0}
                              max={23}
                              value={schedule.hour}
                              onChange={(e) => setSchedule((c) => ({ ...c, hour: e.target.value }))}
                              className="h-7 w-14 rounded-lg border-zinc-800 bg-zinc-950 text-center text-xs text-zinc-200 focus:border-zinc-700"
                            />
                            <span className="text-zinc-600">:</span>
                            <Input
                              type="number"
                              min={0}
                              max={59}
                              value={schedule.minute}
                              onChange={(e) => setSchedule((c) => ({ ...c, minute: e.target.value }))}
                              className="h-7 w-14 rounded-lg border-zinc-800 bg-zinc-950 text-center text-xs text-zinc-200 focus:border-zinc-700"
                            />
                          </div>
                        </div>
                      ) : null}

                      {schedule.frequency === 'custom' ? (
                        <div className="mb-2.5">
                          <label className="mb-1 block text-[11px] text-zinc-600">Cron</label>
                          <Input
                            value={schedule.customCron}
                            onChange={(e) => setSchedule((c) => ({ ...c, customCron: e.target.value }))}
                            placeholder="0 9 * * *"
                            className="h-7 rounded-lg border-zinc-800 bg-zinc-950 font-mono text-xs text-zinc-200 focus:border-zinc-700"
                          />
                        </div>
                      ) : null}

                      {schedule.frequency === 'hourly' ? (
                        <div className="mb-2.5">
                          <label className="mb-1 block text-[11px] text-zinc-600">
                            {tr(language, '第几分钟', 'At minute')}
                          </label>
                          <Input
                            type="number"
                            min={0}
                            max={59}
                            value={schedule.minute}
                            onChange={(e) => setSchedule((c) => ({ ...c, minute: e.target.value }))}
                            className="h-7 w-16 rounded-lg border-zinc-800 bg-zinc-950 text-center text-xs text-zinc-200 focus:border-zinc-700"
                          />
                        </div>
                      ) : null}

                      {/* Timezone */}
                      <div className="mb-2.5">
                        <label className="mb-1 flex items-center gap-1 text-[11px] text-zinc-600">
                          <Globe className="h-3 w-3" />
                          {tr(language, '时区', 'Timezone')}
                        </label>
                        <SearchableSelect
                          value={schedule.timezone}
                          onChange={(value) => setSchedule((c) => ({ ...c, timezone: value }))}
                          options={TIMEZONE_OPTIONS.map((tz) => ({
                            value: tz.value,
                            label: tz.label,
                            description: '',
                            keywords: [tz.value, tz.label],
                          }))}
                          placeholder={tr(language, '选择时区', 'Select timezone')}
                          emptyText="-"
                          searchPlaceholder={tr(language, '搜索', 'Search')}
                          triggerClassName="h-8 rounded-lg px-2.5 text-xs"
                        />
                      </div>

                      {/* Next run */}
                      {!isCreating && scheduleTrigger?.nextRunAt ? (
                        <div className="rounded-md bg-zinc-900/60 px-3 py-2">
                          <p className="text-[10px] text-zinc-600">
                            {tr(language, '下次运行', 'Next run')}
                          </p>
                          <p className="text-xs text-zinc-300">{formatTime(scheduleTrigger.nextRunAt)}</p>
                        </div>
                      ) : null}
                    </div>

                    {/* Status & runs for existing */}
                    {!isCreating && selectedAutomation ? (
                      <>
                        <div className="h-px bg-zinc-900" />
                        <div className="space-y-2">
                          <div className="flex items-center justify-between">
                            <span className="text-[11px] text-zinc-600">
                              {tr(language, '状态', 'Status')}
                            </span>
                            <Badge variant="outline" className={cn('text-[10px]', statusBadgeClassName(selectedAutomation.status))}>
                              {selectedAutomation.status}
                            </Badge>
                          </div>
                          <div className="flex items-center justify-between">
                            <span className="text-[11px] text-zinc-600">
                              {tr(language, '运行次数', 'Runs')}
                            </span>
                            <span className="text-xs text-zinc-300">{selectedAutomation.runs.length}</span>
                          </div>
                        </div>
                      </>
                    ) : null}
                  </div>
                </div>
              </div>

              {/* Run History (below form, full width) */}
              {!isCreating && selectedAutomation && selectedAutomation.runs.length > 0 ? (
                <div className="shrink-0 border-t border-zinc-900">
                  <div className="flex items-center gap-2 px-4 py-2">
                    <span className="text-[11px] font-medium uppercase tracking-wide text-zinc-500">
                      {tr(language, '运行记录', 'Run History')}
                    </span>
                    <span className="text-[10px] text-zinc-600">{selectedAutomation.runs.length}</span>
                  </div>
                  <ScrollArea className="max-h-[160px]">
                    <div className="divide-y divide-zinc-900/60">
                      {selectedAutomation.runs.map((run) => (
                        <div key={run.id} className="flex items-center justify-between px-4 py-2">
                          <div className="flex items-center gap-3 min-w-0">
                            <Badge variant="outline" className={cn('shrink-0 text-[10px]', statusBadgeClassName(run.status))}>
                              {run.status}
                            </Badge>
                            <span className="text-xs text-zinc-500 shrink-0">{formatTime(run.triggeredAt)}</span>
                            {run.failureReason ? (
                              <span className="text-xs text-rose-400 truncate">{run.failureReason}</span>
                            ) : null}
                          </div>
                          {run.linkedTaskId ? (
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              onClick={() => openLinkedTask(run)}
                              className="h-6 shrink-0 rounded-md px-2 text-[11px] text-zinc-500 hover:text-zinc-200"
                            >
                              {tr(language, '查看任务', 'View Task')}
                            </Button>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  </ScrollArea>
                </div>
              ) : null}
            </div>
          )}
        </Panel>
      </Group>

      {/* Run Now Dialog */}
      <Dialog open={runDialogOpen} onOpenChange={setRunDialogOpen}>
        <DialogContent className="border-zinc-800 bg-[#09090b] text-zinc-100 sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{tr(language, '立即运行', 'Run Now')}</DialogTitle>
            <DialogDescription className="text-zinc-500">
              {tr(language, '手动触发一次自动化运行。', 'Manually trigger one automation run.')}
            </DialogDescription>
          </DialogHeader>
          <div className="mx-5 my-2 rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-300">
            {selectedAutomation?.title}
          </div>
          <DialogFooter className="gap-2 sm:justify-end">
            <Button
              type="button"
              variant="ghost"
              onClick={() => setRunDialogOpen(false)}
              className="h-8 rounded-md border border-zinc-800 bg-zinc-950 px-3 text-xs text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100"
            >
              {tr(language, '取消', 'Cancel')}
            </Button>
            <Button
              type="button"
              onClick={() => void handleRunNow()}
              disabled={running}
              className="h-8 rounded-md bg-zinc-100 px-3 text-xs font-medium text-zinc-950 hover:bg-zinc-200"
            >
              <Play className="mr-1 h-3.5 w-3.5" />
              {running ? tr(language, '触发中…', 'Triggering…') : tr(language, '立即运行', 'Run Now')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
