// [INPUT]: Inbox CLI 参数
// [OUTPUT]: 命令执行
// [POS]: 用户收件箱 CLI 命令（复用 server inbox.* 工具，recipientType='user'）
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import type { VibemuxClient } from '../client'
import { output, getOutputFormat } from '../output'
import { parseCliArgs } from '../../cli-flags'
import { getCliName, throwCommandUsage, throwUnknownCommand } from '../help'

export const runInboxCommand = async (client: VibemuxClient, subcommand: string, args: string[]) => {
  const { flags, positionals } = parseCliArgs(args)
  const format = getOutputFormat(flags)
  const cliName = getCliName()

  switch (subcommand) {
    case 'list': {
      const limit = flags.get('limit')
      const result = await client.callTool('inbox.list', {
        limit: typeof limit === 'string' ? Number(limit) : undefined,
        unreadOnly: flags.has('unread') || undefined,
        workspaceId: flags.get('workspace') || undefined,
      })
      output(result, format)
      return
    }

    case 'groups': {
      const limit = flags.get('limit')
      const result = await client.callTool('inbox.groups', {
        section: flags.get('section') || undefined,
        limit: typeof limit === 'string' ? Number(limit) : undefined,
        workspaceId: flags.get('workspace') || undefined,
      })
      output(result, format)
      return
    }

    case 'get': {
      const itemId = positionals[0]
      if (!itemId) {
        throwCommandUsage(cliName, 'inbox', 'get')
      }
      output(await client.callTool('inbox.get', { itemId }), format)
      return
    }

    case 'read': {
      const itemId = positionals[0]
      if (!itemId) {
        throwCommandUsage(cliName, 'inbox', 'read')
      }
      output(await client.callTool('inbox.read', { itemId }), format)
      return
    }

    case 'read-group': {
      const groupKey = positionals[0]
      if (!groupKey) {
        throwCommandUsage(cliName, 'inbox', 'read-group')
      }
      output(await client.callTool('inbox.read_group', { groupKey }), format)
      return
    }

    case 'reply': {
      const itemId = positionals[0]
      const content = positionals.slice(1).join(' ')
      if (!itemId || !content) {
        throwCommandUsage(cliName, 'inbox', 'reply')
      }
      output(await client.callTool('inbox.reply', { itemId, content }), format)
      return
    }

    default:
      throwUnknownCommand(cliName, 'inbox', subcommand)
  }
}
