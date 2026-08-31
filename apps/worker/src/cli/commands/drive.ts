// [INPUT]: Drive CLI 参数
// [OUTPUT]: 命令执行
// [POS]: 云盘 CLI 命令（复用 server drive.* 工具，支持个人与组织双 scope）
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import type { WemuxClient } from '../client'
import { output, getOutputFormat } from '../output'
import { parseCliArgs } from '../../cli-flags'
import { getCliName, throwCommandUsage, throwUnknownCommand } from '../help'

const resolveDriveScope = (flags: Map<string, string | true>) => {
  const workspaceId = flags.get('workspace')
  if (workspaceId) {
    return { personal: false, workspaceId, parentId: flags.get('parent') || undefined }
  }
  return { personal: true, parentId: flags.get('parent') || undefined }
}

export const runDriveCommand = async (client: WemuxClient, subcommand: string, args: string[]) => {
  const { flags, positionals } = parseCliArgs(args)
  const format = getOutputFormat(flags)
  const cliName = getCliName()

  switch (subcommand) {
    case 'list': {
      const result = await client.callTool('drive.list_files', resolveDriveScope(flags))
      output(result, format)
      return
    }

    case 'get': {
      const fileId = positionals[0]
      if (!fileId) {
        throwCommandUsage(cliName, 'drive', 'get')
      }
      output(await client.callTool('drive.read_file', { fileId }), format)
      return
    }

    case 'info': {
      const fileId = positionals[0]
      if (!fileId) {
        throwCommandUsage(cliName, 'drive', 'info')
      }
      output(await client.callTool('drive.file_info', { fileId }), format)
      return
    }

    case 'write': {
      const name = positionals[0]
      const content = positionals.slice(1).join(' ')
      if (!name || !content) {
        throwCommandUsage(cliName, 'drive', 'write')
      }
      const scope = resolveDriveScope(flags)
      const result = await client.callTool('drive.write_file', {
        ...scope,
        name,
        content,
        fileId: flags.get('file-id') || undefined,
      })
      output(result, format)
      return
    }

    default:
      throwUnknownCommand(cliName, 'drive', subcommand)
  }
}
