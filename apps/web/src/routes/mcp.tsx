// [INPUT]: MCP 请求
// [OUTPUT]: MCP 页
// [POS]: MCP 页
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import { createFileRoute } from '@tanstack/react-router'
import { McpPage } from '../components/mcp/mcp-page'
import { api } from '../lib/api'
import { useApp } from '../lib/app-provider'

export const Route = createFileRoute('/mcp')({
  component: McpRoute,
})

function McpRoute() {
  const { settingsDraft, setSettingsDraft, busy, runMutation } = useApp()

  return (
    <div className="space-y-6">
      <McpPage
        busy={busy}
        servers={settingsDraft.mcpServers}
        onChange={(servers) => setSettingsDraft({ ...settingsDraft, mcpServers: servers })}
        onSave={(servers) => {
          const nextConfig = {
            ...settingsDraft,
            mcpServers: servers ?? settingsDraft.mcpServers,
          }
          void runMutation(() => api.saveSettings(nextConfig))
        }}
      />
    </div>
  )
}
