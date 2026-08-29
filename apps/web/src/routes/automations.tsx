// [INPUT]: 自动化请求
// [OUTPUT]: 自动化页
// [POS]: 自动化页
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import { createFileRoute } from '@tanstack/react-router'
import { NotFound } from '../components/not-found'
import { AutomationsPage } from '../components/automations/automations-page'
import { isDevEnvironment } from '../lib/runtime-config'

export const Route = createFileRoute('/automations')({
  component: AutomationsRoute,
})

function AutomationsRoute() {
  if (!isDevEnvironment()) {
    return <NotFound />
  }

  return <AutomationsPage />
}
