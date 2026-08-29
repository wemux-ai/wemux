import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Copy, RefreshCw, Wifi, WifiOff } from 'lucide-react'
import { toast } from 'sonner'
import type { DistributedTask, ExecutionEventCursor, ExecutionEventLayer, ExecutionEventLogRecord, ExecutionEventType, ExecutorRecord, Task } from '@shared/types'
import { api } from '../lib/api'
import { useTranslation } from '../lib/i18n/react'
import { agentMeta, cn, formatDate, formatExecutionModelLabel } from '../lib/utils'
import { isExecutorEffectivelyOnline } from '../lib/managed-cloud-executor'
import { RuntimeLabel } from './runtime/runtime-icons'
import { Badge } from './ui/badge'
import { Button } from './ui/button'
import { Card, CardContent } from './ui/card'
import { ExecutorSelect } from './ui/executor-select'
import { NativeSelect } from './ui/native-select'
import { SearchableSelect } from './ui/searchable-select'

type TimelineView = 'global' | 'task'

export function ExecutionLogCenter({
  tasks,
  distributedTasks,
  executors,
  selectedTaskId,
}: {
  tasks: Task[]
  distributedTasks: DistributedTask[]
  executors: ExecutorRecord[]
  selectedTaskId?: string
}) {
  const { language } = useTranslation()
  const tr = (zh: string, en: string) => language === 'zh' ? zh : en
  const [events, setEvents] = useState<ExecutionEventLogRecord[]>([])
  const [nextCursor, setNextCursor] = useState<ExecutionEventCursor | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [view, setView] = useState<TimelineView>('global')
  const [taskFilterId, setTaskFilterId] = useState('')
  const [executorFilterId, setExecutorFilterId] = useState('all')
  const [eventTypeFilter, setEventTypeFilter] = useState<'all' | ExecutionEventType>('all')
  const [layerFilter, setLayerFilter] = useState<'all' | ExecutionEventLayer>('all')
  const [failuresOnly, setFailuresOnly] = useState(false)
  const eventTypeOptions: Array<{ value: 'all' | ExecutionEventType; label: string }> = [
    { value: 'all', label: tr('全部事件', 'All events') },
    { value: 'task.assign', label: 'task.assign' },
    { value: 'task.ack', label: 'task.ack' },
    { value: 'task.event', label: 'task.event' },
    { value: 'task.result', label: 'task.result' },
    { value: 'heartbeat', label: 'heartbeat' },
    { value: 'reconnect', label: 'reconnect' },
    { value: 'disconnect', label: 'disconnect' },
    { value: 'error', label: 'error' },
  ]
  const layerOptions: Array<{ value: 'all' | ExecutionEventLayer; label: string }> = [
    { value: 'all', label: tr('全部层级', 'All layers') },
    { value: 'pairing', label: tr('配对', 'Pairing') },
    { value: 'connection', label: tr('连接', 'Connection') },
    { value: 'repo_prepare', label: tr('仓库准备', 'Repo Prepare') },
    { value: 'opencode', label: 'Agent Runtime' },
    { value: 'git', label: 'Git' },
    { value: 'sync_back', label: tr('回传', 'Sync Back') },
    { value: 'unknown', label: tr('未分类', 'Uncategorized') },
  ]

  useEffect(() => {
    if (view === 'task' && selectedTaskId) {
      setTaskFilterId(selectedTaskId)
    }
  }, [selectedTaskId, view])

  useEffect(() => {
    if (!taskFilterId || distributedTasks.some((task) => task.id === taskFilterId)) {
      return
    }

    setTaskFilterId(view === 'task' ? (selectedTaskId || distributedTasks[0]?.id || '') : '')
  }, [distributedTasks, selectedTaskId, taskFilterId, view])

  useEffect(() => {
    if (view === 'task' && !taskFilterId) {
      setTaskFilterId(selectedTaskId || distributedTasks[0]?.id || '')
    }
  }, [distributedTasks, selectedTaskId, taskFilterId, view])

  const loadEvents = async (silent = false, cursor?: ExecutionEventCursor) => {
    if (silent) {
      if (cursor) {
        setLoadingMore(true)
      } else {
        setRefreshing(true)
      }
    } else {
      setLoading(true)
    }

    try {
      const response = await api.listExecutionEvents({
        taskId: taskFilterId || undefined,
        executorId: executorFilterId !== 'all' ? executorFilterId : undefined,
        eventType: eventTypeFilter !== 'all' ? eventTypeFilter : undefined,
        layer: layerFilter !== 'all' ? layerFilter : undefined,
        failuresOnly,
        limit: view === 'task' ? 300 : 200,
        cursor,
      })
      setEvents((current) => cursor ? [...current, ...response.events] : response.events)
      setNextCursor(response.nextCursor)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : tr('加载日志失败', 'Failed to load logs'))
    } finally {
      setLoading(false)
      setRefreshing(false)
      setLoadingMore(false)
    }
  }

  useEffect(() => {
    void loadEvents()
    const timer = window.setInterval(() => {
      void loadEvents(true)
    }, 8000)

    return () => window.clearInterval(timer)
  }, [view, taskFilterId, executorFilterId, eventTypeFilter, layerFilter, failuresOnly])

  const tasksById = useMemo(() => new Map(tasks.map((task) => [task.id, task])), [tasks])
  const distributedTasksById = useMemo(() => new Map(distributedTasks.map((task) => [task.id, task])), [distributedTasks])
  const orderedEvents = useMemo(() => (view === 'task' ? [...events].reverse() : events), [events, view])
  const selectedTask = distributedTasks.find((task) => task.id === taskFilterId)
  const stats = useMemo(() => ({
    total: events.length,
    failures: events.filter((event) => event.isFailure).length,
    connection: events.filter((event) => event.severity === 'connection').length,
  }), [events])

  return (
    <div className="grid gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
      <Card className="rounded-none border-zinc-800 bg-zinc-950/75">
        <CardContent className="space-y-4 p-5">
          <div>
            <h3 className="text-lg font-medium text-zinc-50">{tr('日志中心', 'Log Center')}</h3>
            <p className="mt-1 text-sm text-zinc-400">{tr('统一回放节点分配、心跳、结果和异常链路。', 'Replay executor assignment, heartbeats, results, and error flows in one place.')}</p>
          </div>

          <div className="flex gap-2 rounded-xl border border-zinc-800 bg-zinc-900/60 p-1">
            <button type="button" onClick={() => setView('global')} className={cn('flex-1 rounded-lg px-3 py-2 text-sm transition', view === 'global' ? 'bg-zinc-100 text-zinc-950' : 'text-zinc-400 hover:text-zinc-200')}>
              {tr('全局时间线', 'Global Timeline')}
            </button>
            <button type="button" onClick={() => setView('task')} className={cn('flex-1 rounded-lg px-3 py-2 text-sm transition', view === 'task' ? 'bg-zinc-100 text-zinc-950' : 'text-zinc-400 hover:text-zinc-200')}>
              {tr('单任务', 'Single Task')}
            </button>
          </div>

          <label className="block space-y-2 text-sm text-zinc-400">
            <span>{tr('任务过滤', 'Task Filter')}</span>
            <SearchableSelect
              value={taskFilterId}
              options={[
                { value: '', label: tr('全部任务', 'All tasks') },
                ...distributedTasks.map((task) => {
                  const originTask = tasksById.get(task.originTaskId)
                  return {
                    value: task.id,
                    label: originTask?.title || task.description,
                    description: task.id,
                  }
                }),
              ]}
              placeholder={tr('全部任务', 'All tasks')}
              searchPlaceholder={tr('搜索任务', 'Search tasks')}
              emptyText={tr('没有匹配的任务', 'No matching tasks')}
              onChange={setTaskFilterId}
            />
          </label>

          <label className="block space-y-2 text-sm text-zinc-400">
            <span>{tr('节点过滤', 'Executor Filter')}</span>
            <ExecutorSelect
              value={executorFilterId}
              options={[
                { value: 'all', label: tr('全部节点', 'All executors'), statusTone: 'neutral' },
                ...executors.map((executor) => ({
                  value: executor.executorId,
                  label: executor.name,
                  description: executor.machineName,
                  keywords: [executor.machineName],
                  statusTone: isExecutorEffectivelyOnline(executor) ? 'online' : 'offline',
                })),
              ]}
              placeholder={tr('全部节点', 'All executors')}
              searchPlaceholder={tr('搜索节点', 'Search executors')}
              emptyText={tr('没有匹配的节点', 'No matching executors')}
              onChange={setExecutorFilterId}
            />
          </label>

          <label className="block space-y-2 text-sm text-zinc-400">
            <span>{tr('事件类型', 'Event Type')}</span>
            <NativeSelect value={eventTypeFilter} onChange={(event) => setEventTypeFilter(event.target.value as 'all' | ExecutionEventType)}>
              {eventTypeOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </NativeSelect>
          </label>

          <label className="block space-y-2 text-sm text-zinc-400">
            <span>{tr('故障层级', 'Failure Layer')}</span>
            <NativeSelect value={layerFilter} onChange={(event) => setLayerFilter(event.target.value as 'all' | ExecutionEventLayer)}>
              {layerOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </NativeSelect>
          </label>

          <label className="flex items-center justify-between rounded-xl border border-zinc-800 bg-zinc-900/60 px-3 py-3 text-sm text-zinc-300">
            <span>{tr('仅看失败/异常', 'Failures Only')}</span>
            <input type="checkbox" checked={failuresOnly} onChange={(event) => setFailuresOnly(event.target.checked)} className="h-4 w-4 accent-zinc-100" />
          </label>

          <div className="grid grid-cols-3 gap-2">
            <StatChip label={tr('总数', 'Total')} value={stats.total} tone="text-zinc-100" />
            <StatChip label={tr('异常', 'Failures')} value={stats.failures} tone="text-rose-300" />
            <StatChip label={tr('连接', 'Connection')} value={stats.connection} tone="text-sky-300" />
          </div>

          {view === 'task' && selectedTask && (
            <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-3 text-sm text-zinc-400">
              {tasksById.get(selectedTask.originTaskId) ? (
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <Badge className={cn('border-0', agentMeta[tasksById.get(selectedTask.originTaskId)!.agentType].soft)}>
                    <RuntimeLabel runtime={tasksById.get(selectedTask.originTaskId)!.agentType} size={12} labelClassName="text-inherit" />
                  </Badge>
                  {tasksById.get(selectedTask.originTaskId)?.executionModel ? (
                    <Badge variant="outline" className="border-zinc-700 text-zinc-300">
                      {formatExecutionModelLabel(tasksById.get(selectedTask.originTaskId)?.executionModel)}
                    </Badge>
                  ) : null}
                </div>
              ) : null}
              <p className="font-medium text-zinc-100">{tr('当前任务', 'Current Task')}</p>
              <p className="mt-1 text-zinc-300">{tasksById.get(selectedTask.originTaskId)?.title || selectedTask.description}</p>
              <p className="mt-1 text-xs text-zinc-500">{selectedTask.id}</p>
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="rounded-none border-zinc-800 bg-zinc-950/75">
        <CardContent className="p-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h3 className="text-lg font-medium text-zinc-50">{view === 'task' ? tr('单任务时间线', 'Single Task Timeline') : tr('全局时间线', 'Global Timeline')}</h3>
              <p className="mt-1 text-sm text-zinc-400">{view === 'task' ? tr('按时间顺序回放任务生命周期。', 'Replay the task lifecycle in chronological order.') : tr('最近执行事件，适合快速排障。', 'Recent execution events for quick troubleshooting.')}</p>
            </div>
            <Button type="button" variant="outline" size="sm" onClick={() => void loadEvents(true)} className="border-zinc-800 bg-zinc-900 text-zinc-200 hover:bg-zinc-800">
              <RefreshCw className={cn('mr-1.5 h-4 w-4', refreshing && 'animate-spin')} />{tr('刷新', 'Refresh')}
            </Button>
          </div>

          {loading ? (
            <p className="mt-8 text-center text-sm text-zinc-500">{tr('加载中...', 'Loading...')}</p>
          ) : orderedEvents.length === 0 ? (
            <p className="mt-8 text-center text-sm text-zinc-500">{tr('当前筛选条件下暂无日志', 'No logs match the current filters')}</p>
          ) : (
            <div className="mt-5 space-y-3">
              {orderedEvents.map((event) => {
                const distributedTask = event.taskId ? distributedTasksById.get(event.taskId) : undefined
                const originTask = tasksById.get(event.originTaskId || distributedTask?.originTaskId || '')

                return (
                  <div key={event.id} className={cn('rounded-lg border px-4 py-4', toneClassName(event))}>
                    <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
                      <div className="min-w-0 space-y-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <EventIcon event={event} />
                          <Badge variant="outline" className="border-current/20 text-current">{event.eventType}</Badge>
                          {event.layer && event.layer !== 'unknown' && <Badge variant="outline" className="border-zinc-700 text-zinc-300">{event.layer}</Badge>}
                          {originTask ? (
                            <Badge className={cn('border-0', agentMeta[originTask.agentType].soft)}>
                              <RuntimeLabel runtime={originTask.agentType} size={12} labelClassName="text-inherit" />
                            </Badge>
                          ) : null}
                          {originTask?.executionModel ? <Badge variant="outline" className="border-zinc-700 text-zinc-300">{formatExecutionModelLabel(originTask.executionModel)}</Badge> : null}
                          {event.isFailure && <Badge variant="outline" className="border-rose-500/30 text-rose-300">{tr('异常', 'Failure')}</Badge>}
                        </div>
                        <p className="text-sm font-medium text-zinc-100">{event.message}</p>
                        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-400">
                          <span>{formatDate(event.occurredAt)}</span>
                          <span>{tr('节点', 'Executor')}：{event.executorName || event.executorId || '-'}</span>
                          <span>{tr('任务', 'Task')}：{originTask?.title || event.taskId || '-'}</span>
                        </div>
                        {event.payloadSummary && <p className="rounded-xl bg-zinc-950/60 px-3 py-2 text-xs text-zinc-300">{event.payloadSummary}</p>}
                      </div>

                      <Button type="button" variant="outline" size="sm" onClick={() => void copyRawEvent(event, tr('原始事件已复制', 'Raw event copied'), tr('复制失败', 'Copy failed'))} className="border-zinc-800 bg-zinc-900 text-zinc-200 hover:bg-zinc-800">
                        <Copy className="mr-1.5 h-4 w-4" />{tr('复制原始事件', 'Copy Raw Event')}
                      </Button>
                    </div>
                  </div>
                )
              })}

              {nextCursor && (
                <div className="pt-2 text-center">
                  <Button type="button" variant="outline" size="sm" onClick={() => void loadEvents(true, nextCursor)} disabled={loadingMore} className="border-zinc-800 bg-zinc-900 text-zinc-200 hover:bg-zinc-800">
                    <RefreshCw className={cn('mr-1.5 h-4 w-4', loadingMore && 'animate-spin')} />{loadingMore ? tr('加载中...', 'Loading...') : tr('加载更多', 'Load More')}
                  </Button>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function StatChip({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 px-3 py-2">
      <p className={cn('text-lg font-semibold', tone)}>{value}</p>
      <p className="text-xs text-zinc-500">{label}</p>
    </div>
  )
}

function EventIcon({ event }: { event: ExecutionEventLogRecord }) {
  if (event.eventType === 'disconnect') {
    return <WifiOff className="h-4 w-4 text-amber-300" />
  }

  if (event.eventType === 'reconnect' || event.eventType === 'heartbeat') {
    return <Wifi className="h-4 w-4 text-sky-300" />
  }

  if (event.isFailure || event.eventType === 'error') {
    return <AlertTriangle className="h-4 w-4 text-rose-300" />
  }

  return <div className="h-2.5 w-2.5 rounded-full bg-emerald-300" />
}

function toneClassName(event: ExecutionEventLogRecord) {
  if (event.isFailure || event.severity === 'error') {
    return 'border-rose-500/20 bg-rose-500/5'
  }

  if (event.severity === 'connection') {
    return 'border-sky-500/20 bg-sky-500/5'
  }

  if (event.severity === 'state_change') {
    return 'border-amber-500/20 bg-amber-500/5'
  }

  return 'border-zinc-800 bg-zinc-900/40'
}

async function copyRawEvent(event: ExecutionEventLogRecord, successMessage: string, errorMessage: string) {
  try {
    await navigator.clipboard.writeText(JSON.stringify(event, null, 2))
    toast.success(successMessage)
  } catch {
    toast.error(errorMessage)
  }
}
