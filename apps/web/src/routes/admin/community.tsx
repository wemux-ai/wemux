import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { api } from '@/lib/api'
import { useAuth } from '@/lib/auth-context'
import type { AdminCommunityUsageSummary } from '@shared/types'
import { AdminCommunityUsagePage } from '@/components/admin/admin-community-usage-page'

export const Route = createFileRoute('/admin/community')({
  component: AdminCommunityUsageRoute,
})

function AdminCommunityUsageRoute() {
  const { user } = useAuth()
  const [data, setData] = useState<AdminCommunityUsageSummary | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!user) return
    let cancelled = false

    const load = async () => {
      try {
        const response = await api.getAdminCommunityUsage()
        if (!cancelled) {
          setData(response)
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load community usage')
        }
      }
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [user])

  return <AdminCommunityUsagePage data={data} error={error} />
}
