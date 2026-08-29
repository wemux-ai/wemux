// [INPUT]: Agent CLI 参数
// [OUTPUT]: 命令执行
// [POS]: Agent CLI 命令
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import type { VibemuxClient } from '../client'
import { output, getOutputFormat } from '../output'
import { parseCliArgs } from '../../cli-flags'
import { getCliName, throwUnknownCommand } from '../help'

export const runAgentCommand = async (client: VibemuxClient, subcommand: string, args: string[]) => {
  const { flags } = parseCliArgs(args)
  const format = getOutputFormat(flags)

  switch (subcommand) {
    case 'list': {
      const result = await client.callTool('agent.list', {
        type: flags.get('type') || undefined,
      })
      output(result, format)
      return
    }

    case 'types': {
      const result = await client.callTool('agent.types', {})
      output(result, format)
      return
    }

    default:
      throwUnknownCommand(getCliName(), 'agent', subcommand)
  }
}
