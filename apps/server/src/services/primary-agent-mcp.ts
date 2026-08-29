// [INPUT]: 主 Agent MCP 请求
// [OUTPUT]: MCP 桥接
// [POS]: 主 Agent MCP 桥
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import { parsePrimaryAgentMcpServers } from '@shared/mcp'
import { isWorkspaceResourceVisible } from '@shared/workspace-scope'
import { getTeamMemberRole } from '../repositories/auth'
import { loadState } from '../storage/app-state-store'

export const isMcpServerVisibleToUser = (
  server: ReturnType<typeof parsePrimaryAgentMcpServers>[number],
  userId?: string,
) => {
  if (!userId?.trim()) {
    return true
  }

  if (server.managedBySystem || !server.ownerUserId) {
    return true
  }

  if (server.ownerUserId === userId) {
    return true
  }

  return (server.visibility === 'workspace' || server.visibility === 'team')
    && Boolean(server.workspaceId)
    && getTeamMemberRole(server.workspaceId!, userId) !== null
}

export const filterVisibleMcpServers = (
  servers: ReturnType<typeof parsePrimaryAgentMcpServers>,
  userId?: string,
) => servers.filter((server) => isMcpServerVisibleToUser(server, userId))

export const getPrimaryAgentMcpServers = (config?: { mcpServers?: unknown }, userId?: string, workspaceId?: string) => {
  const normalizedWorkspaceId = workspaceId?.trim()
  const globalMcpServers = filterVisibleMcpServers(parsePrimaryAgentMcpServers(config ?? loadState().config), userId)
    .filter((server) => !normalizedWorkspaceId || server.visibility === 'team' || isWorkspaceResourceVisible(server, {
      userId: userId?.trim() || '',
      workspaceId: normalizedWorkspaceId,
    }))
  if (globalMcpServers.length > 0) {
    return globalMcpServers
  }

  return []
}
