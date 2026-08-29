// [INPUT]: 模型请求
// [OUTPUT]: 模型页
// [POS]: 模型页
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import { createFileRoute } from '@tanstack/react-router'
import type { ModelsTabId } from '../components/models/models-page'
import { ModelsPage } from '../components/models/models-page'

const MODELS_TABS: ModelsTabId[] = ['models', 'defaults', 'usage']

export type ModelsRouteSearch = {
  tab?: ModelsTabId
}

const buildModelsRouteSearch = (search: Record<string, unknown>): ModelsRouteSearch => {
  const rawTab = search.tab
  return {
    tab: typeof rawTab === 'string' && (MODELS_TABS as string[]).includes(rawTab)
      ? (rawTab as ModelsTabId)
      : undefined,
  }
}

export const Route = createFileRoute('/models')({
  validateSearch: buildModelsRouteSearch,
  component: ModelsRoute,
})

function ModelsRoute() {
  const search = Route.useSearch()
  const navigate = Route.useNavigate()
  const tab: ModelsTabId = search.tab ?? 'models'

  return (
    <ModelsPage
      tab={tab}
      onTabChange={(nextTab) => {
        void navigate({ search: { ...search, tab: nextTab } })
      }}
    />
  )
}
