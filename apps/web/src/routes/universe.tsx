// [INPUT]: Agent 宇宙图谱请求
// [OUTPUT]: Agent 宇宙页（Obsidian 式力导向球图谱：全局看所有 Agent 的工作状态/模型/机器与关系）
// [POS]: feature Agent 宇宙视图页（全局导航入口）；可选 ?workspaceId= 筛选子图
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import { Suspense, lazy } from 'react'
import { createFileRoute } from '@tanstack/react-router'

const AgentUniverseView = lazy(() => import('../components/agents/agent-universe-view').then((module) => ({ default: module.AgentUniverseView })))

export const Route = createFileRoute('/universe' as never)({
  validateSearch: (search: Record<string, unknown>) => ({
    workspaceId: typeof search.workspaceId === 'string' && search.workspaceId.trim() ? search.workspaceId.trim() : undefined,
  }),
  component: UniverseRoute,
})

function UniverseRoute() {
  const search = Route.useSearch() as { workspaceId?: string }
  return (
    <Suspense fallback={null}>
      <AgentUniverseView workspaceFilter={search.workspaceId} />
    </Suspense>
  )
}
