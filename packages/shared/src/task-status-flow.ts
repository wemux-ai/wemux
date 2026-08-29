// [INPUT]: 状态流转输入
// [OUTPUT]: 合法流转判定
// [POS]: 任务状态流转
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import type { Task, TaskStatus } from './types'

const taskStatusHistoryLabels: Record<TaskStatus, string> = {
  backlog: 'Backlog',
  todo: '待处理',
  in_progress: '开发中',
  in_review: '审核中',
  done: '已完成',
  blocked: '已阻塞',
  cancelled: '已取消',
}

const applyTaskStatusTransition = (
  task: Task,
  nextStatus: TaskStatus,
  updatedAt: string,
): Task => {
  if (task.status === nextStatus) {
    return {
      ...task,
      updatedAt,
    }
  }

  // R8.5：完成时间戳 —— done 时落首次完成时间；离开 done 清空。
  const nextCompletedAt = nextStatus === 'done' ? (task.completedAt ?? updatedAt) : undefined

  return {
    ...task,
    status: nextStatus,
    completedAt: nextCompletedAt,
    updatedAt,
    history: [
      ...task.history,
      {
        id: crypto.randomUUID(),
        label: taskStatusHistoryLabels[nextStatus],
        at: updatedAt,
      },
    ],
  }
}

export const touchTaskStatus = (
  task: Task,
  updatedAt: string,
): Task => {
  return {
    ...task,
    updatedAt,
  }
}

export const syncTaskStatusFromWorkspaceBound = (
  task: Task,
  updatedAt: string,
): Task => {
  if (task.status !== 'backlog' && task.status !== 'todo') {
    return touchTaskStatus(task, updatedAt)
  }

  return applyTaskStatusTransition(task, 'in_progress', updatedAt)
}

export const syncTaskStatusFromReviewReady = (
  task: Task,
  updatedAt: string,
): Task => {
  if (task.status === 'done' || task.status === 'cancelled') {
    return touchTaskStatus(task, updatedAt)
  }

  return applyTaskStatusTransition(task, 'in_review', updatedAt)
}

export const syncTaskStatusFromWorkMerged = (
  task: Task,
  updatedAt: string,
): Task => applyTaskStatusTransition(task, 'done', updatedAt)

export const markTaskExecutionStarted = (
  task: Task,
  updatedAt: string,
): Task => applyTaskStatusTransition(task, 'in_progress', updatedAt)

export const markTaskExecutionFinished = (
  task: Task,
  ok: boolean,
  updatedAt: string,
): Task => {
  const nextStatus: TaskStatus = ok
    ? 'in_review'
    : task.status === 'done'
      ? 'done'
      : 'todo'

  return applyTaskStatusTransition(task, nextStatus, updatedAt)
}
