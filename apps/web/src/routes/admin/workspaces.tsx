import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import type { Workspace } from '@shared/types'
import { api } from '@/lib/api'
import type { WorkspaceSessionEventsPage, WorkspaceSessionRuntimeSnapshot } from '@shared/workspace-session-history'
import { useAuth } from '@/lib/auth-context'
import { useApp } from '@/lib/app-provider'
import { AdminWorkspacesPage } from '@/components/admin/admin-workspaces-page'

export const Route = createFileRoute('/admin/workspaces')({
  component: AdminWorkspacesRoute,
})

function AdminWorkspacesRoute() {
  const { user } = useAuth()
  const { state, busy, runMutation } = useApp()
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [runtimeSnapshot, setRuntimeSnapshot] = useState<WorkspaceSessionRuntimeSnapshot | null>(null)
  const [eventsPage, setEventsPage] = useState<WorkspaceSessionEventsPage | null>(null)
  const [runtimeLoading, setRuntimeLoading] = useState(false)
  const [eventsLoading, setEventsLoading] = useState(false)

  useEffect(() => {
    if (!user || state.projects.length === 0) return

    let cancelled = false

    const load = async () => {
      try {
        const responses = await Promise.all(
          state.projects.map((project) =>
            api.listProjectWorkspaces(project.id).catch(() => ({ workspaces: [] as Workspace[] })),
          ),
        )

        if (!cancelled) {
          const workspaceMap = new Map<string, Workspace>()
          for (const response of responses) {
            for (const workspace of response.workspaces) {
              workspaceMap.set(workspace.id, workspace)
            }
          }
          setWorkspaces([...workspaceMap.values()])
        }
      } catch (error) {
        console.error('Failed to load workspaces:', error)
      }
    }

    void load()

    return () => {
      cancelled = true
    }
  }, [state.projects, user])

  const refreshSessionDiagnostics = async (workspaceId: string, workspaceSessionId: string) => {
    setRuntimeLoading(true)
    setEventsLoading(true)

    try {
      const [runtime, events] = await Promise.all([
        api.getWorkspaceSessionRuntime(workspaceId, workspaceSessionId),
        api.getWorkspaceSessionEvents(workspaceId, workspaceSessionId, { limit: 30 }),
      ])

      setRuntimeSnapshot(runtime)
      setEventsPage(events)
    } finally {
      setRuntimeLoading(false)
      setEventsLoading(false)
    }
  }

  return (
    <AdminWorkspacesPage
      workspaces={workspaces}
      projects={state.projects}
      tasks={state.tasks}
      bindings={state.taskWorkspaceBindings}
      sessions={state.workspaceSessions}
      canManage={true}
      busy={busy}
      runtimeSnapshot={runtimeSnapshot}
      runtimeLoading={runtimeLoading}
      eventsPage={eventsPage}
      eventsLoading={eventsLoading}
      onRefreshRuntime={refreshSessionDiagnostics}
      onEnsureWorktree={async (taskId, workspaceId, workspaceSessionId) => {
        await runMutation(() => api.ensureTaskWorktree(taskId, workspaceId, workspaceSessionId, false))
        await refreshSessionDiagnostics(workspaceId, workspaceSessionId).catch(() => {})
      }}
      onCleanupTask={async (taskId) => {
        await runMutation(() => api.cleanupTask(taskId))
      }}
    />
  )
}
