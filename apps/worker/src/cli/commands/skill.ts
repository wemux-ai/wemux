// [INPUT]: Skill CLI 参数
// [OUTPUT]: 命令执行
// [POS]: Skill CLI 命令
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import type { VibemuxClient } from '../client'
import { output, getOutputFormat } from '../output'
import { parseCliArgs } from '../../cli-flags'
import { getCliName, throwCommandUsage, throwUnknownCommand } from '../help'
import { confirmDangerousAction } from '../confirm'

export const runSkillCommand = async (client: VibemuxClient, subcommand: string, args: string[]) => {
  const { flags, positionals } = parseCliArgs(args)
  const format = getOutputFormat(flags)

  switch (subcommand) {
    case 'list': {
      const result = await client.callTool('skill.list', {
        projectId: flags.get('project') || undefined,
      })
      output(result, format)
      return
    }

    case 'get': {
      const skillId = positionals[0]
      if (!skillId) {
        throwCommandUsage(getCliName(), 'skill', 'get')
      }
      const result = await client.callTool('skill.get', { skillId })
      output(result, format)
      return
    }

    case 'packages': {
      const result = await client.callTool('skill.runtime_packages', {
        projectId: flags.get('project') || undefined,
        workspaceId: flags.get('workspace') || undefined,
      })
      output(result, format)
      return
    }

    case 'delete': {
      const skillId = positionals[0]
      if (!skillId) {
        throwCommandUsage(getCliName(), 'skill', 'delete')
      }
      await confirmDangerousAction(flags, `Delete skill ${skillId}`)
      const result = await client.callTool('skill.delete', { skillId })
      output(result, format)
      return
    }

    default:
      throwUnknownCommand(getCliName(), 'skill', subcommand)
  }
}
