// [INPUT]: 组织概览请求
// [OUTPUT]: 组织概览页（工作记录可见性）
// [POS]: 组织概览页
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import { createFileRoute } from '@tanstack/react-router'
import { WorkspaceOverviewPage } from '../components/overview/workspace-overview-page'

export const Route = createFileRoute('/overview')({
  component: OverviewRoute,
})

function OverviewRoute() {
  return <WorkspaceOverviewPage />
}
