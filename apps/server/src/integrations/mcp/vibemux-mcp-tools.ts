import type { McpServer } from './sdk'
import { registerVibemuxMcpControlTools } from './vibemux-mcp-control-tools'
import { registerVibemuxMcpChatTools } from './vibemux-mcp-chat-tools'
import { registerVibemuxMcpSkillTools } from './vibemux-mcp-skill-tools'
import { registerVibemuxMcpTaskCollabTools } from './vibemux-mcp-task-collab-tools'
import { registerVibemuxMcpTaskTools } from './vibemux-mcp-task-tools'
import { registerVibemuxMcpWorkspaceSessionTools } from './vibemux-mcp-workspace-session-tools'
import { registerVibemuxMcpAgentRuntimeTools } from './vibemux-mcp-agent-runtime-tools'
import { registerVibemuxMcpDriveTools } from './vibemux-mcp-drive-tools'
import { registerVibemuxMcpInboxTools } from './vibemux-mcp-inbox-tools'
import type { VibemuxMcpContext } from './vibemux-mcp-context'
import { enterpriseMcpToolRegistrations } from '../../extension-registry'

export const registerVibemuxMcpTools = (server: McpServer, ctx: VibemuxMcpContext) => {
  registerVibemuxMcpControlTools(server, ctx)
  registerVibemuxMcpChatTools(server, ctx)
  registerVibemuxMcpTaskTools(server, ctx)
  registerVibemuxMcpTaskCollabTools(server, ctx)
  registerVibemuxMcpWorkspaceSessionTools(server, ctx)
  registerVibemuxMcpAgentRuntimeTools(server, ctx)
  registerVibemuxMcpDriveTools(server, ctx)
  registerVibemuxMcpInboxTools(server, ctx)
  registerVibemuxMcpSkillTools(server, ctx)
  for (const registerEnterpriseMcp of enterpriseMcpToolRegistrations) {
    registerEnterpriseMcp(server, ctx)
  }
}
