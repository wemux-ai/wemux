import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import type { AdminAnalyticsResponse } from '@/lib/api'
import { api } from '@/lib/api'
import { useAuth } from '@/lib/auth-context'
import { AdminAnalyticsPage } from '@/components/admin/admin-analytics-page'

export const Route = createFileRoute('/admin/analytics')({
  component: AdminAnalyticsRoute,
})

const DAY_OPTIONS = [7, 14, 30, 90] as const

function AdminAnalyticsRoute() {
  const { user } = useAuth()
  const [data, setData] = useState<AdminAnalyticsResponse | null>(null)
  const [days, setDays] = useState<number>(14)

  useEffect(() => {
    if (!user) return
    let cancelled = false

    const load = async () => {
      try {
        const response = await api.getAdminAnalytics(days)
        if (!cancelled) {
          setData(response)
        }
      } catch (error) {
        console.error('Failed to load analytics:', error)
      }
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [user, days])

  return <AdminAnalyticsPage data={data} days={days} onDaysChange={setDays} />
}

export { DAY_OPTIONS }
