import type { McpServer } from './sdk'
import { registerWemuxMcpControlTools } from './wemux-mcp-control-tools'
import { registerWemuxMcpChatTools } from './wemux-mcp-chat-tools'
import { registerWemuxMcpSkillTools } from './wemux-mcp-skill-tools'
import { registerWemuxMcpTaskCollabTools } from './wemux-mcp-task-collab-tools'
import { registerWemuxMcpTaskTools } from './wemux-mcp-task-tools'
import { registerWemuxMcpWorkspaceSessionTools } from './wemux-mcp-workspace-session-tools'
import { registerWemuxMcpAgentRuntimeTools } from './wemux-mcp-agent-runtime-tools'
import { registerWemuxMcpDriveTools } from './wemux-mcp-drive-tools'
import { registerWemuxMcpInboxTools } from './wemux-mcp-inbox-tools'
import type { WemuxMcpContext } from './wemux-mcp-context'
import { enterpriseMcpToolRegistrations } from '../../extension-registry'

export const registerWemuxMcpTools = (server: McpServer, ctx: WemuxMcpContext) => {
  registerWemuxMcpControlTools(server, ctx)
  registerWemuxMcpChatTools(server, ctx)
  registerWemuxMcpTaskTools(server, ctx)
  registerWemuxMcpTaskCollabTools(server, ctx)
  registerWemuxMcpWorkspaceSessionTools(server, ctx)
  registerWemuxMcpAgentRuntimeTools(server, ctx)
  registerWemuxMcpDriveTools(server, ctx)
  registerWemuxMcpInboxTools(server, ctx)
  registerWemuxMcpSkillTools(server, ctx)
  for (const registerEnterpriseMcp of enterpriseMcpToolRegistrations) {
    registerEnterpriseMcp(server, ctx)
  }
}
