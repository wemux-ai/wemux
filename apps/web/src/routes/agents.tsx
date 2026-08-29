// [INPUT]: Agent 请求
// [OUTPUT]: Agent 页
// [POS]: Agents 页
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import { lazy, Suspense } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import type { SettingsTab } from '../components/agents/custom-agent-detail-panel-shared'

const AgentsPage = lazy(() => import('../components/agents/agents-page').then((module) => ({ default: module.AgentsPage })))

const allowedAgentTabs = new Set<SettingsTab>([
  'overview',
  'model',
  'advanced',
  'runtime',
  'skills',
  'mcp',
  'channels',
  'workdir',
  'files',
  'mind',
  'heartbeat',
  'chat',
  'inbox',
  'activity',
])

export const Route = createFileRoute('/agents' as never)({
  validateSearch: (search: Record<string, unknown>) => ({
    agentId: typeof search.agentId === 'string' && search.agentId.trim() ? search.agentId.trim() : undefined,
    tab: typeof search.tab === 'string' ? search.tab : undefined,
    create: typeof search.create === 'string' && search.create.trim() ? search.create.trim() : undefined,
  }),
  component: AgentsRoute,
})

function AgentsRoute() {
  const search = Route.useSearch() as {
    agentId?: string
    tab?: string
    create?: string
  }
  const requestedTab = search.tab && allowedAgentTabs.has(search.tab as SettingsTab)
    ? search.tab === 'workdir' ? 'chat' : search.tab as SettingsTab
    : undefined

  return (
    <Suspense fallback={null}>
      <AgentsPage requestedAgentId={search.agentId} requestedTab={requestedTab} createToken={search.create} />
    </Suspense>
  )
}
