import type { AppState } from '@shared/types'
import { listConversationsByScope } from '../../control-plane/conversation-service'
import { McpServer, ResourceTemplate } from './sdk'
import { registerWemuxMcpResources } from './wemux-mcp-resources'
import { registerWemuxMcpTools } from './wemux-mcp-tools'

export const createWemuxMcpServer = (params: { userId: string; runtimeAgentId?: string; getState: () => AppState }) => {
  const ctx = {
    userId: params.userId,
    runtimeAgentId: params.runtimeAgentId?.trim() || undefined,
    getState: () => params.getState(),
    getConversations: () => {
      const state = params.getState()
      return listConversationsByScope({
        projectIds: state.projects.map((project) => project.id),
        taskIds: state.tasks.map((task) => task.id),
      })
    },
  }

  const server = new McpServer({
    name: 'wemux-control-plane',
    version: '0.2.2',
  })

  registerWemuxMcpResources(server, ctx, ResourceTemplate)
  registerWemuxMcpTools(server, ctx)

  return server
}
