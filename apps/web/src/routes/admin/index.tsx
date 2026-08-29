import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import type { DistributedTask, ExecutorRecord, WorkspaceSession } from '@shared/types'
import type { AdminAuditLogRecord } from '@/lib/api'
import { api } from '@/lib/api'
import { useAuth } from '@/lib/auth-context'
import { useApp } from '@/lib/app-provider'
import { AdminDashboard } from '@/components/admin/admin-dashboard'

export const Route = createFileRoute('/admin/')({
  component: AdminOverviewRoute,
})

function AdminOverviewRoute() {
  const { user } = useAuth()
  const { state } = useApp()
  const [executors, setExecutors] = useState<ExecutorRecord[]>([])
  const [auditLogs, setAuditLogs] = useState<AdminAuditLogRecord[]>([])

  useEffect(() => {
    if (!user) return

    let cancelled = false

    const loadData = async () => {
      try {
        const [executorResponse, auditResponse] = await Promise.all([
          api.listExecutors(),
          api.getAdminAudit({ limit: 50 }).catch(() => ({ logs: [] as AdminAuditLogRecord[] })),
        ])

        if (!cancelled) {
          setExecutors(executorResponse.executors)
          setAuditLogs(auditResponse.logs)
        }
      } catch (error) {
        console.error('Failed to load admin data:', error)
      }
    }

    void loadData()

    return () => {
      cancelled = true
    }
  }, [user])

  return (
    <AdminDashboard
      executors={executors}
      distributedTasks={state.distributedTasks as DistributedTask[]}
      workspaceSessions={state.workspaceSessions as WorkspaceSession[]}
      auditLogs={auditLogs}
    />
  )
}
