// [INPUT]: 工作区目录请求
// [OUTPUT]: 工作区列表页
// [POS]: 工作区目录页
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import { lazy, Suspense } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { buildWorkspacesRouteSearch } from './-workspace-route-shared'

const WorkspacesPage = lazy(() => import('../components/workspaces/workspaces-page').then((module) => ({ default: module.WorkspacesPage })))

export const Route = createFileRoute('/workspaces')({
  validateSearch: (search: Record<string, unknown>) => buildWorkspacesRouteSearch(search),
  component: WorkspacesRoute,
})

function WorkspacesRoute() {
  return (
    <Suspense fallback={null}>
      <WorkspacesPage />
    </Suspense>
  )
}
