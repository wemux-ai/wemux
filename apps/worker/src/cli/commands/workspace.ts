// [INPUT]: Workspace CLI 参数
// [OUTPUT]: 命令执行
// [POS]: Workspace CLI 命令
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import type { VibemuxClient } from '../client'
import { output, getOutputFormat } from '../output'
import { parseCliArgs } from '../../cli-flags'
import { getCliName, throwCommandUsage, throwUnknownCommand } from '../help'
import { confirmDangerousAction } from '../confirm'

export const runWorkspaceCommand = async (client: VibemuxClient, subcommand: string, args: string[]) => {
  const { flags, positionals } = parseCliArgs(args)
  const format = getOutputFormat(flags)
  const cliName = getCliName()

  switch (subcommand) {
    case 'list': {
      const projectId = positionals[0]
      if (!projectId) {
        throwCommandUsage(cliName, 'workspace', 'list')
      }
      const result = await client.callTool('workspace.list', { projectId })
      output(result, format)
      return
    }

    case 'get': {
      const workspaceId = positionals[0]
      if (!workspaceId) {
        throwCommandUsage(cliName, 'workspace', 'get')
      }
      const result = await client.callTool('workspace.get', { workspaceId })
      output(result, format)
      return
    }

    case 'create': {
      const projectId = positionals[0]
      const name = positionals[1]
      const executorNodeId = positionals[2]
      if (!projectId || !name || !executorNodeId) {
        throwCommandUsage(cliName, 'workspace', 'create')
      }
      const result = await client.callTool('workspace.create', {
        projectId,
        name,
        executorNodeId,
      })
      output(result, format)
      return
    }

    case 'delete': {
      const workspaceId = positionals[0]
      if (!workspaceId) {
        throwCommandUsage(cliName, 'workspace', 'delete')
      }
      await confirmDangerousAction(flags, `Delete workspace ${workspaceId}`)
      const result = await client.callTool('workspace.delete', { workspaceId })
      output(result, format)
      return
    }

    // === session subcommands ===
    case 'session': {
      await runSessionCommand(client, positionals[0] || 'list', positionals.slice(1), flags, format)
      return
    }

    default:
      throwUnknownCommand(cliName, 'workspace', subcommand)
  }
}

const runSessionCommand = async (
  client: VibemuxClient,
  subcommand: string,
  args: string[],
  flags: ReturnType<typeof parseCliArgs>['flags'],
  format: ReturnType<typeof getOutputFormat>,
) => {
  switch (subcommand) {
    case 'list': {
      const taskId = args[0]
      if (!taskId) {
        throwCommandUsage(getCliName(), 'workspace', 'session list')
      }
      const result = await client.callTool('workspace.session.list', {
        taskId,
        workspaceId: flags.get('workspace') || undefined,
      })
      output(result, format)
      return
    }

    case 'get': {
      const sessionId = args[0]
      if (!sessionId) {
        throwCommandUsage(getCliName(), 'workspace', 'session get')
      }
      const result = await client.callTool('workspace.session.get', { sessionId })
      output(result, format)
      return
    }

    case 'runtime': {
      const taskId = args[0]
      if (!taskId) {
        throwCommandUsage(getCliName(), 'workspace', 'session runtime')
      }
      const result = await client.callTool('workspace.session.runtime', { taskId })
      output(result, format)
      return
    }

    default:
      throwUnknownCommand(getCliName(), 'workspace session', subcommand)
  }
}
