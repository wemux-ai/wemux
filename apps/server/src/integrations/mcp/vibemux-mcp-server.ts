import type { AppState } from '@shared/types'
import { listConversationsByScope } from '../../control-plane/conversation-service'
import { McpServer, ResourceTemplate } from './sdk'
import { registerVibemuxMcpResources } from './vibemux-mcp-resources'
import { registerVibemuxMcpTools } from './vibemux-mcp-tools'

export const createVibemuxMcpServer = (params: { userId: string; runtimeAgentId?: string; getState: () => AppState }) => {
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
    name: 'vibemux-control-plane',
    version: '0.2.2',
  })

  registerVibemuxMcpResources(server, ctx, ResourceTemplate)
  registerVibemuxMcpTools(server, ctx)

  return server
}
