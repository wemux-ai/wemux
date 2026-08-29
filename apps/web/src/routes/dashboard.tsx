// [INPUT]: 仪表盘请求
// [OUTPUT]: 仪表盘页
// [POS]: 仪表盘页
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import { lazy, Suspense, useEffect, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useApp } from '../lib/app-provider'
import { COLLABORATION_WORKSPACE_CHANGE_EVENT, getStoredCollaborationWorkspaceId } from '../lib/collaboration-workspace'
import { getDashboardMetrics } from '../lib/app-helpers'

const DashboardPage = lazy(() => import('../components/dashboard/dashboard-page').then((module) => ({ default: module.DashboardPage })))

export const Route = createFileRoute('/dashboard')({
  component: DashboardRoute,
})

function DashboardRoute() {
  const { state } = useApp()
  const [workspaceId, setWorkspaceId] = useState(() => getStoredCollaborationWorkspaceId())

  useEffect(() => {
    const handleWorkspaceChange = (event: Event) => {
      const detail = (event as CustomEvent<{ workspaceId?: string }>).detail
      setWorkspaceId(detail?.workspaceId?.trim() || '')
    }
    window.addEventListener(COLLABORATION_WORKSPACE_CHANGE_EVENT, handleWorkspaceChange)
    return () => window.removeEventListener(COLLABORATION_WORKSPACE_CHANGE_EVENT, handleWorkspaceChange)
  }, [])

  return (
    <Suspense fallback={null}>
      <DashboardPage metrics={getDashboardMetrics(state, workspaceId)} workspaceId={workspaceId} />
    </Suspense>
  )
}
