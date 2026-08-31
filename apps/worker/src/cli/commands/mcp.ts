// [INPUT]: MCP CLI 参数
// [OUTPUT]: 命令执行
// [POS]: MCP CLI 命令
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import { parseCliArgs } from '../../cli-flags'
import type { WemuxClient } from '../client'
import { loadWorkerConfig } from '../../core/config'
import { getCliName, throwUnknownCommand } from '../help'
import { getOutputFormat, output } from '../output'

export const runMcpCommand = async (client: WemuxClient, subcommand: string, args: string[]) => {
  const { flags } = parseCliArgs(args)
  if (subcommand === 'list') {
    output(await client.callTool('mcp.list', {}), getOutputFormat(flags))
    return
  }
  if (subcommand === 'info') {
    // 本地 MCP 桥接配置摘要（排查 wemux 内置 MCP / drive 工具不可用）
    const config = loadWorkerConfig()
    output({
      cloudUrl: config.cloudUrl,
      executorId: config.executorId,
      executorTokenConfigured: Boolean(config.executorToken?.trim()),
      mcpServers: config.mcpServers,
    }, getOutputFormat(flags))
    return
  }
  throwUnknownCommand(getCliName(), 'mcp', subcommand)
}
