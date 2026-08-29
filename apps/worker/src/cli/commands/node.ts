// [INPUT]: Node CLI 参数
// [OUTPUT]: 命令执行
// [POS]: Node CLI 命令
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import { parseCliArgs } from '../../cli-flags'
import type { VibemuxClient } from '../client'
import { getCliName, throwUnknownCommand } from '../help'
import { getOutputFormat, output } from '../output'

export const runNodeCommand = async (client: VibemuxClient, subcommand: string, args: string[]) => {
  const { flags } = parseCliArgs(args)
  if (subcommand !== 'list') {
    throwUnknownCommand(getCliName(), 'node', subcommand)
  }
  output(await client.callTool('executor.list', {}), getOutputFormat(flags))
}
