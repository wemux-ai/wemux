// [INPUT]: Project CLI 参数
// [OUTPUT]: 命令执行
// [POS]: Project CLI 命令
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import type { WemuxClient } from '../client'
import { output, getOutputFormat } from '../output'
import { parseCliArgs } from '../../cli-flags'
import { getCliName, throwCommandUsage, throwUnknownCommand } from '../help'
import { confirmDangerousAction } from '../confirm'

export const runProjectCommand = async (client: WemuxClient, subcommand: string, args: string[]) => {
  const { flags, positionals } = parseCliArgs(args)
  const format = getOutputFormat(flags)
  const cliName = getCliName()

  switch (subcommand) {
    case 'list': {
      const result = await client.callTool('project.list', {})
      output(result, format)
      return
    }

    case 'get': {
      const projectId = positionals[0]
      if (!projectId) {
        throwCommandUsage(cliName, 'project', 'get')
      }
      const result = await client.callTool('project.get', { projectId })
      output(result, format)
      return
    }

    case 'create': {
      const name = positionals[0]
      if (!name) {
        throwCommandUsage(cliName, 'project', 'create')
      }
      const result = await client.callTool('project.create', {
        name,
        gitUrl: flags.get('git-url') || undefined,
        defaultBranch: flags.get('branch') || undefined,
      })
      output(result, format)
      return
    }

    case 'select': {
      const projectId = positionals[0]
      if (!projectId) {
        throwCommandUsage(cliName, 'project', 'select')
      }
      const result = await client.callTool('project.select', { projectId })
      output(result, format)
      return
    }

    case 'update': {
      const projectId = positionals[0]
      if (!projectId) {
        throwCommandUsage(cliName, 'project', 'update')
      }
      const result = await client.callTool('project.update', {
        projectId,
        name: flags.get('name') || undefined,
        gitUrl: flags.get('git-url') || undefined,
        defaultBranch: flags.get('branch') || undefined,
        rootPath: flags.get('root') || undefined,
        preferredExecutorId: flags.get('executor') || undefined,
      })
      output(result, format)
      return
    }

    case 'delete': {
      const projectId = positionals[0]
      if (!projectId) {
        throwCommandUsage(cliName, 'project', 'delete')
      }
      await confirmDangerousAction(flags, `Delete project ${projectId}`)
      const result = await client.callTool('project.delete', { projectId })
      output(result, format)
      return
    }

    default:
      throwUnknownCommand(cliName, 'project', subcommand)
  }
}
