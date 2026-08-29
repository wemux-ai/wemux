import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import type { ExecutionEventLogRecord, ExecutorRecord, Workspace } from '@shared/types'
import { api } from '@/lib/api'
import { useAuth } from '@/lib/auth-context'
import { useApp } from '@/lib/app-provider'
import { AdminExecutorsPage } from '@/components/admin/admin-executors-page'
import { toast } from 'sonner'
import type { WorkerDoctorPayload } from '@/lib/api'

export const Route = createFileRoute('/admin/executors')({
  component: AdminExecutorsRoute,
})

function AdminExecutorsRoute() {
  const { user } = useAuth()
  const { state } = useApp()
  const [executors, setExecutors] = useState<ExecutorRecord[]>([])
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [executionEvents, setExecutionEvents] = useState<ExecutionEventLogRecord[]>([])
  const [refreshingExecutorId, setRefreshingExecutorId] = useState<string | null>(null)
  const [actionExecutorId, setActionExecutorId] = useState<string | null>(null)

  const loadExecutors = async () => {
    try {
      const [executorResponse, eventsResponse, workspaceResponses] = await Promise.all([
        api.listExecutors(),
        api.listExecutionEvents({ failuresOnly: true, limit: 60 }).catch(() => ({ events: [] })),
        Promise.all(
          state.projects.map((project) =>
            api.listProjectWorkspaces(project.id).catch(() => ({ workspaces: [] as Workspace[] })),
          ),
        ),
      ])

      const workspaceMap = new Map<string, Workspace>()
      for (const response of workspaceResponses) {
        for (const workspace of response.workspaces) {
          workspaceMap.set(workspace.id, workspace)
        }
      }

      setExecutors(executorResponse.executors)
      setExecutionEvents(eventsResponse.events)
      setWorkspaces([...workspaceMap.values()])
    } catch (error) {
      console.error('Failed to load executors:', error)
    }
  }

  useEffect(() => {
    if (!user) return
    void loadExecutors()
  }, [state.projects, user])

  return (
    <AdminExecutorsPage
      executors={executors}
      distributedTasks={state.distributedTasks}
      projectBindings={state.projectBindings}
      projects={state.projects}
      workspaces={workspaces}
      executionEvents={executionEvents}
      canManage={true}
      refreshingExecutorId={refreshingExecutorId}
      actionExecutorId={actionExecutorId}
      onRefreshAll={loadExecutors}
      onRefreshExecutor={async (executorId) => {
        setRefreshingExecutorId(executorId)
        try {
          const response = await api.refreshExecutorTelemetry(executorId)
          setExecutors((current) => current.map((item) => (item.executorId === executorId ? response.executor : item)))
        } finally {
          setRefreshingExecutorId(null)
        }
      }}
      onUpdateExecutor={async (executorId, payload) => {
        setActionExecutorId(executorId)
        try {
          const response = await api.updateExecutor(executorId, payload)
          setExecutors((current) => current.map((item) => (item.executorId === executorId ? response.executor : item)))
          toast.success('Executor settings updated.')
        } finally {
          setActionExecutorId(null)
        }
      }}
      onRunDoctor={async (executorId): Promise<WorkerDoctorPayload> => {
        const response = await api.runExecutorDoctor(executorId)
        return response.doctor
      }}
      onShutdownExecutor={async (executorId) => {
        setActionExecutorId(executorId)
        try {
          const response = await api.shutdownExecutor(executorId)
          toast.success(response.message || 'Executor shutdown requested.')
          await loadExecutors()
        } finally {
          setActionExecutorId(null)
        }
      }}
      onDeleteExecutor={async (executorId) => {
        setActionExecutorId(executorId)
        try {
          const response = await api.deleteExecutor(executorId)
          toast.success(response.message || 'Executor deleted.')
          await loadExecutors()
        } finally {
          setActionExecutorId(null)
        }
      }}
    />
  )
}
