// [INPUT]: 团队请求
// [OUTPUT]: 团队页
// [POS]: 团队页
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import { createFileRoute, Navigate } from '@tanstack/react-router'

export const Route = createFileRoute('/teams' as never)({
  component: TeamsRedirectRoute,
})

function TeamsRedirectRoute() {
  return (
    <Navigate
      to="/settings"
      search={{ section: 'workspace', workspaceId: undefined }}
      replace
    />
  )
}
