// [INPUT]: 集成请求
// [OUTPUT]: 集成页
// [POS]: Integrations 页路由
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import { createFileRoute } from '@tanstack/react-router'
import { IntegrationsPage } from '../components/integrations/integrations-page'

export const Route = createFileRoute('/integrations')({
  component: IntegrationsRoute,
})

function IntegrationsRoute() {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <IntegrationsPage />
    </div>
  )
}
