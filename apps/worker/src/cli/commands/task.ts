// [INPUT]: Task CLI 参数
// [OUTPUT]: 命令执行
// [POS]: Task CLI 命令
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import type { WemuxClient } from '../client'
import { output, getOutputFormat } from '../output'
import { parseCliArgs } from '../../cli-flags'
import { getCliName, throwCommandUsage, throwUnknownCommand } from '../help'
import { confirmDangerousAction } from '../confirm'

export const runTaskCommand = async (client: WemuxClient, subcommand: string, args: string[]) => {
  const { flags, positionals } = parseCliArgs(args)
  const format = getOutputFormat(flags)
  const cliName = getCliName()

  switch (subcommand) {
    case 'list': {
      const result = await client.callTool('task.list', {
        projectId: flags.get('project') || undefined,
        status: flags.get('status') || undefined,
      })
      output(result, format)
      return
    }

    case 'get': {
      const taskId = positionals[0]
      if (!taskId) {
        throwCommandUsage(cliName, 'task', 'get')
      }
      const result = await client.callTool('task.get', { taskId })
      output(result, format)
      return
    }

    case 'create': {
      const projectId = positionals[0]
      const description = positionals.slice(1).join(' ')
      if (!projectId || !description) {
        throwCommandUsage(cliName, 'task', 'create')
      }
      const result = await client.callTool('task.create', {
        projectId,
        description,
        title: flags.get('title') || undefined,
      })
      output(result, format)
      return
    }

    case 'run': {
      const taskId = positionals[0]
      const workspaceId = flags.get('workspace')
      if (!taskId || typeof workspaceId !== 'string') {
        throwCommandUsage(cliName, 'task', 'run')
      }
      const result = await client.callTool('task.execute', {
        taskId,
        workspaceId,
        workspaceSessionId: flags.get('session') || undefined,
        createNewSession: flags.has('new-session') || undefined,
        baseBranch: flags.get('branch') || undefined,
        returnMode: flags.get('return') || undefined,
        syncBackStrategy: flags.get('sync') || undefined,
      })
      output(result, format)
      return
    }

    case 'execution': {
      const taskId = positionals[0]
      if (!taskId) {
        throwCommandUsage(cliName, 'task', 'execution')
      }
      output(await client.callTool('task.execution.get', {
        taskId,
        taskRunId: flags.get('run') || undefined,
      }), format)
      return
    }

    case 'subtask': {
      if (positionals[0] !== 'create') {
        throwUnknownCommand(cliName, 'task subtask', positionals[0] || '')
      }
      const parentTaskId = positionals[1]
      const description = positionals.slice(2).join(' ')
      if (!parentTaskId || !description) {
        throwCommandUsage(cliName, 'task', 'subtask create')
      }
      output(await client.callTool('task.create_subtask', {
        parentTaskId,
        description,
        title: flags.get('title') || undefined,
        agentType: flags.get('agent') || undefined,
        executionModel: flags.get('model') || undefined,
      }), format)
      return
    }

    case 'chat': {
      const action = positionals[0]
      const taskId = positionals[1]
      if (!taskId || (action !== 'list' && action !== 'get')) {
        throwCommandUsage(cliName, 'task', action === 'get' ? 'chat get' : 'chat list')
      }
      const tool = action === 'get' ? 'task.chat_session.get' : 'task.chat_session.list'
      output(await client.callTool(tool, {
        taskId,
        workspaceId: flags.get('workspace') || undefined,
        workspaceSessionId: action === 'get' ? flags.get('session') || undefined : undefined,
        recentTurns: action === 'get' && typeof flags.get('turns') === 'string' ? Number(flags.get('turns')) : undefined,
      }), format)
      return
    }

    case 'model': {
      const taskId = positionals[0]
      const executionModel = positionals[1]
      if (!taskId || !executionModel) {
        throwCommandUsage(cliName, 'task', 'model')
      }
      output(await client.callTool('task.model.update', {
        taskId,
        executionModel,
        workspaceId: flags.get('workspace') || undefined,
        workspaceSessionId: flags.get('session') || undefined,
        executorNodeId: flags.get('executor') || undefined,
      }), format)
      return
    }

    case 'agent': {
      const taskId = positionals[0]
      const agentType = positionals[1]
      if (!taskId || !agentType) {
        throwCommandUsage(cliName, 'task', 'agent')
      }
      output(await client.callTool('task.agent.update', {
        taskId,
        agentType,
        workspaceId: flags.get('workspace') || undefined,
        workspaceSessionId: flags.get('session') || undefined,
        executorNodeId: flags.get('executor') || undefined,
      }), format)
      return
    }

    case 'send': {
      const taskId = positionals[0]
      const message = positionals.slice(1).join(' ')
      if (!taskId || !message) {
        throwCommandUsage(cliName, 'task', 'send')
      }
      const result = await client.callTool('task.send', {
        taskId,
        message,
        workspaceId: flags.get('workspace') || undefined,
        workspaceSessionId: flags.get('session') || undefined,
      })
      output(result, format)
      return
    }

    case 'cancel': {
      const taskId = positionals[0]
      if (!taskId) {
        throwCommandUsage(cliName, 'task', 'cancel')
      }
      const result = await client.callTool('task.cancel_execution', {
        taskId,
        taskRunId: flags.get('run') || undefined,
      })
      output(result, format)
      return
    }

    case 'retry': {
      const taskId = positionals[0]
      if (!taskId) {
        throwCommandUsage(cliName, 'task', 'retry')
      }
      const result = await client.callTool('task.retry', { taskId })
      output(result, format)
      return
    }

    case 'runs': {
      const taskId = positionals[0]
      if (!taskId) {
        throwCommandUsage(cliName, 'task', 'runs')
      }
      const result = await client.callTool('task.runs', { taskId })
      output(result, format)
      return
    }

    case 'update': {
      const taskId = positionals[0]
      if (!taskId) {
        throwCommandUsage(cliName, 'task', 'update')
      }
      const updateArgs: Record<string, unknown> = { taskId }
      if (flags.has('title')) updateArgs.title = flags.get('title')
      if (flags.has('status')) updateArgs.status = flags.get('status')
      if (flags.has('description')) updateArgs.description = flags.get('description')
      const result = await client.callTool('task.update', updateArgs)
      output(result, format)
      return
    }

    case 'delete': {
      const taskId = positionals[0]
      if (!taskId) {
        throwCommandUsage(cliName, 'task', 'delete')
      }
      await confirmDangerousAction(flags, `Delete task ${taskId}`)
      const result = await client.callTool('task.delete', { taskId })
      output(result, format)
      return
    }

    default:
      throwUnknownCommand(cliName, 'task', subcommand)
  }
}
