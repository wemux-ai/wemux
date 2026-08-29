import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import type { AdminApprovalRequestRecord, AdminAuditLogRecord } from '@/lib/api'
import { api } from '@/lib/api'
import { useAuth } from '@/lib/auth-context'
import { AdminAuditPage } from '@/components/admin/admin-audit-page'

export const Route = createFileRoute('/admin/audit')({
  component: AdminAuditRoute,
})

function AdminAuditRoute() {
  const { user } = useAuth()
  const [logs, setLogs] = useState<AdminAuditLogRecord[]>([])
  const [pendingApprovals, setPendingApprovals] = useState<AdminApprovalRequestRecord[]>([])

  useEffect(() => {
    if (!user) return

    let cancelled = false

    const load = async () => {
      try {
        const response = await api.getAdminAudit({ limit: 80 })
        if (!cancelled) {
          setLogs(response.logs)
          setPendingApprovals(response.pendingApprovals)
        }
      } catch (error) {
        console.error('Failed to load audit logs:', error)
      }
    }

    void load()

    return () => {
      cancelled = true
    }
  }, [user])

  return <AdminAuditPage logs={logs} pendingApprovals={pendingApprovals} />
}
