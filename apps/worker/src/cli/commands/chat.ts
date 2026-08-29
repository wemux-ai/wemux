// [INPUT]: Chat CLI 参数
// [OUTPUT]: 命令执行
// [POS]: 会话与外联渠道 CLI 命令（复用 server conversation.* / channel.* 工具）
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import type { VibemuxClient } from '../client'
import { output, getOutputFormat } from '../output'
import { parseCliArgs } from '../../cli-flags'
import { getCliName, throwCommandUsage, throwUnknownCommand } from '../help'

export const runChatCommand = async (client: VibemuxClient, subcommand: string, args: string[]) => {
  const { flags, positionals } = parseCliArgs(args)
  const format = getOutputFormat(flags)
  const cliName = getCliName()

  switch (subcommand) {
    case 'conversations': {
      const result = await client.callTool('conversation.list', {
        projectId: flags.get('project') || undefined,
        taskId: flags.get('task') || undefined,
      })
      output(result, format)
      return
    }

    case 'get': {
      const conversationId = positionals[0]
      if (!conversationId) {
        throwCommandUsage(cliName, 'chat', 'get')
      }
      output(await client.callTool('conversation.get', { conversationId }), format)
      return
    }

    case 'channel': {
      const channelCommand = positionals[0]
      if (channelCommand === 'list') {
        const result = await client.callTool('channel.list', {
          agentId: flags.get('agent') || undefined,
          agentName: flags.get('agent-name') || undefined,
        })
        output(result, format)
        return
      }
      if (channelCommand === 'send') {
        const agentId = flags.get('agent') || positionals[1]
        const message = positionals.slice(2).join(' ').trim()
        if (!agentId || !message) {
          throwCommandUsage(cliName, 'chat', 'channel send')
        }
        const result = await client.callTool('channel.send', {
          agentId,
          agentName: flags.get('agent-name') || undefined,
          channel: flags.get('channel') || undefined,
          message,
        })
        output(result, format)
        return
      }
      throwUnknownCommand(cliName, 'chat', `channel ${channelCommand || ''}`)
    }

    default:
      throwUnknownCommand(cliName, 'chat', subcommand)
  }
}
