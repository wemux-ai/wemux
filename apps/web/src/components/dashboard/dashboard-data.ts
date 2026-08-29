import { isTaskRunning } from '../../lib/runtime-status'
import type { AgentType, Task, TaskStatus } from '@shared/types'

export type ActivityTone = 'neutral' | 'live' | 'review' | 'warning'

export type ActivityItem = {
  id: string
  at: string
  projectId: string
  taskId: string
  taskTitle: string
  text: string
  tone: ActivityTone
}

export type DayPoint = {
  key: string
  label: string
}

export type HeatmapDay = {
  key: string
  dayOfWeek: number
  isFuture: boolean
  taskUpdates: number
  logEntries: number
  historyEvents: number
  score: number
  level: number
}

export type StatusDayBucket = Record<TaskStatus, number>

export function sortTasksByUpdatedAt(tasks: Task[]) {
  return [...tasks].sort((left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime())
}

export function getRecentActivity(tasks: Task[]) {
  const items: ActivityItem[] = []

  for (const task of tasks) {
    for (const log of task.logs) {
      items.push({
        id: `log-${log.id}`,
        at: log.createdAt,
        projectId: task.projectId,
        taskId: task.id,
        taskTitle: task.title,
        text: compactText(log.content),
        tone: getLogTone(log.role, task),
      })
    }

    for (const historyItem of task.history) {
      items.push({
        id: `history-${historyItem.id}`,
        at: historyItem.at,
        projectId: task.projectId,
        taskId: task.id,
        taskTitle: task.title,
        text: compactText(historyItem.label),
        tone: getHistoryTone(historyItem.label),
      })
    }
  }

  return items
    .filter((item) => item.text.length > 0)
    .sort((left, right) => new Date(right.at).getTime() - new Date(left.at).getTime())
}

export function getLastDays(days: number) {
  return Array.from({ length: days }, (_, index) => {
    const date = new Date()
    date.setHours(12, 0, 0, 0)
    date.setDate(date.getDate() - (days - index - 1))

    return {
      key: date.toISOString().slice(0, 10),
      label: `${date.getMonth() + 1}/${date.getDate()}`,
    }
  })
}

export function getTaskUpdateSeries(tasks: Task[], days: DayPoint[]) {
  const counts = new Map(days.map((day) => [day.key, 0]))

  for (const task of tasks) {
    const dayKey = new Date(task.updatedAt).toISOString().slice(0, 10)
    if (!counts.has(dayKey)) {
      continue
    }

    counts.set(dayKey, (counts.get(dayKey) ?? 0) + 1)
  }

  return days.map((day) => counts.get(day.key) ?? 0)
}

export function getStatusBuckets(tasks: Task[], days: DayPoint[]) {
  const initialBucket = () => ({
    backlog: 0,
    todo: 0,
    in_progress: 0,
    in_review: 0,
    done: 0,
    blocked: 0,
    cancelled: 0,
  })
  const buckets = new Map(days.map((day) => [day.key, initialBucket()]))

  for (const task of tasks) {
    const dayKey = new Date(task.updatedAt).toISOString().slice(0, 10)
    const bucket = buckets.get(dayKey)
    if (!bucket) {
      continue
    }

    bucket[task.status] += 1
  }

  return days.map((day) => buckets.get(day.key) ?? initialBucket())
}

export function getTaskActivityHeatmap(tasks: Task[], weeks: number) {
  const totalDays = weeks * 7
  const today = toDayAnchor(new Date())
  const start = startOfWeek(today)
  start.setDate(start.getDate() - (weeks - 1) * 7)

  const dayKeys = Array.from({ length: totalDays }, (_, index) => {
    const date = new Date(start)
    date.setDate(start.getDate() + index)
    return toDayKey(date)
  })
  const counts = new Map(dayKeys.map((key) => [key, createHeatmapCounter()]))

  for (const task of tasks) {
    incrementHeatmapCount(counts, task.updatedAt, 'taskUpdates')

    for (const log of task.logs) {
      incrementHeatmapCount(counts, log.createdAt, 'logEntries')
    }

    for (const historyItem of task.history) {
      incrementHeatmapCount(counts, historyItem.at, 'historyEvents')
    }
  }

  const rawDays = dayKeys.map((key, index) => {
    const date = new Date(start)
    date.setDate(start.getDate() + index)
    const counter = counts.get(key) ?? createHeatmapCounter()
    const score = counter.taskUpdates * 3 + counter.historyEvents * 2 + counter.logEntries

    return {
      key,
      dayOfWeek: date.getDay(),
      isFuture: date.getTime() > today.getTime(),
      taskUpdates: counter.taskUpdates,
      logEntries: counter.logEntries,
      historyEvents: counter.historyEvents,
      score,
    }
  })
  const maxScore = Math.max(...rawDays.map((day) => day.score), 0)

  return rawDays.map((day) => ({
    ...day,
    level: getHeatmapLevel(day.score, maxScore, day.isFuture),
  }))
}

export function getAgentBreakdown(tasks: Task[]) {
  const counts = new Map<AgentType, number>()

  for (const task of tasks) {
    counts.set(task.agentType, (counts.get(task.agentType) ?? 0) + 1)
  }

  const total = Array.from(counts.values()).reduce((sum, count) => sum + count, 0)

  return Array.from(counts.entries())
    .map(([agentType, count]) => ({
      agentType,
      count,
      percent: total > 0 ? Math.round((count / total) * 100) : 0,
    }))
    .sort((left, right) => right.count - left.count)
}

export function formatRelativeTime(date: string) {
  const deltaMs = Date.now() - new Date(date).getTime()
  const minute = 60 * 1000
  const hour = 60 * minute
  const day = 24 * hour

  if (deltaMs < minute) {
    return '刚刚'
  }

  if (deltaMs < hour) {
    return `${Math.max(1, Math.floor(deltaMs / minute))} 分钟前`
  }

  if (deltaMs < day) {
    return `${Math.max(1, Math.floor(deltaMs / hour))} 小时前`
  }

  return `${Math.max(1, Math.floor(deltaMs / day))} 天前`
}

function getLogTone(role: Task['logs'][number]['role'], task: Task): ActivityTone {
  if (role === 'review') {
    return 'review'
  }

  if (role === 'agent' && isTaskRunning(task)) {
    return 'live'
  }

  if (role === 'system') {
    return 'neutral'
  }

  return 'warning'
}

function getHistoryTone(label: string): ActivityTone {
  if (label.includes('完成')) {
    return 'review'
  }

  if (label.includes('审核')) {
    return 'warning'
  }

  if (label.includes('开发')) {
    return 'live'
  }

  return 'neutral'
}

function compactText(text: string) {
  return text.replace(/\s+/g, ' ').trim().slice(0, 96)
}

function createHeatmapCounter() {
  return {
    taskUpdates: 0,
    logEntries: 0,
    historyEvents: 0,
  }
}

function incrementHeatmapCount(
  counts: Map<string, ReturnType<typeof createHeatmapCounter>>,
  date: string,
  field: keyof ReturnType<typeof createHeatmapCounter>,
) {
  const dayKey = toDayKey(new Date(date))
  const counter = counts.get(dayKey)
  if (!counter) {
    return
  }

  counter[field] += 1
}

function getHeatmapLevel(score: number, maxScore: number, isFuture: boolean) {
  if (isFuture || score <= 0) {
    return 0
  }

  if (maxScore <= 4) {
    return Math.min(4, score)
  }

  return Math.max(1, Math.ceil((score / maxScore) * 4))
}

function startOfWeek(date: Date) {
  const next = toDayAnchor(date)
  next.setDate(next.getDate() - next.getDay())
  return next
}

function toDayAnchor(date: Date) {
  const next = new Date(date)
  next.setHours(12, 0, 0, 0)
  return next
}

function toDayKey(date: Date) {
  return toDayAnchor(date).toISOString().slice(0, 10)
}
