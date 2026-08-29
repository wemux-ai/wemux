import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import type { ExecutorRecord } from '@shared/types'
import { api } from '@/lib/api'
import { useAuth } from '@/lib/auth-context'
import { useApp } from '@/lib/app-provider'
import { AdminTasksPage } from '@/components/admin/admin-tasks-page'

export const Route = createFileRoute('/admin/tasks')({
  component: AdminTasksRoute,
})

function AdminTasksRoute() {
  const { user } = useAuth()
  const { state, busy, runMutation } = useApp()
  const [executors, setExecutors] = useState<ExecutorRecord[]>([])

  useEffect(() => {
    if (!user) return

    let cancelled = false

    const load = async () => {
      try {
        const response = await api.listExecutors()
        if (!cancelled) {
          setExecutors(response.executors)
        }
      } catch (error) {
        console.error('Failed to load executors:', error)
      }
    }

    void load()

    return () => {
      cancelled = true
    }
  }, [user])

  return (
    <AdminTasksPage
      tasks={state.distributedTasks}
      projects={state.projects}
      originTasks={state.tasks}
      executors={executors}
      canManage={true}
      busy={busy}
      onCancelTask={async (taskId) => {
        await runMutation(() => api.cancelDistributedTask(taskId))
      }}
      onRetryTask={async (taskId) => {
        await runMutation(() => api.retryDistributedTask(taskId))
      }}
      onAssignTask={async (taskId, executorNodeId) => {
        await runMutation(() => api.assignDistributedTask(taskId, executorNodeId))
      }}
      onTakeoverTask={async (taskId, executorNodeId) => {
        await runMutation(() => api.takeoverDistributedTask(taskId, executorNodeId))
      }}
    />
  )
}
