#!/usr/bin/env node

/**
 * [INPUT]: Worker CLI argv and local worker package metadata.
 * [OUTPUT]: Help/version output or dispatch to a platform resource command.
 * [POS]: Public CLI router; worker lifecycle execution remains in ../index.ts.
 * [PROTOCOL]: Update this header when responsibilities change, then check AGENTS.md.
 */

import { getWorkerVersion } from '../core/app-root'
import { VibemuxClient } from './client'
import { runAgentCommand } from './commands/agent'
import { runChatCommand } from './commands/chat'
import { runDriveCommand } from './commands/drive'
import { runInboxCommand } from './commands/inbox'
import { runProjectCommand } from './commands/project'
import { runSkillCommand } from './commands/skill'
import { runMcpCommand } from './commands/mcp'
import { runNodeCommand } from './commands/node'
import { runStatusCommand } from './commands/status'
import { runTaskCommand } from './commands/task'
import { runWorkspaceCommand } from './commands/workspace'
import {
  getCliName,
  hasHelpFlag,
  hasVersionFlag,
  isHelpFlag,
  renderRootHelp,
  renderTopicHelp,
} from './help'

export const runCli = async (args = process.argv.slice(2), client?: VibemuxClient) => {
  const cliName = getCliName()
  const version = getWorkerVersion()
  const [first, second] = args

  if (!first || (isHelpFlag(first) && !second) || (first === 'help' && (!second || isHelpFlag(second)))) {
    console.log(renderRootHelp(cliName, version))
    return
  }
  if (hasVersionFlag(args)) {
    console.log(`${cliName} ${version}`)
    return
  }

  const topic = first === 'help' ? second : first
  const commandName = first === 'help'
    ? args.slice(2).join(' ')
    : args.slice(1).filter((item) => !isHelpFlag(item)).join(' ')
  if (first === 'help' || hasHelpFlag(args)) {
    if (!topic) {
      console.log(renderRootHelp(cliName, version))
      return
    }
    const help = renderTopicHelp(cliName, topic, commandName || undefined)
    if (!help) {
      throw new Error(`Unknown help topic "${topic}". Run "${cliName} --help" for usage.`)
    }
    console.log(help)
    return
  }

  const subcommand = second || 'list'
  const rest = args.slice(2)
  const api = client || new VibemuxClient()

  switch (first) {
    case 'project':
      await runProjectCommand(api, subcommand, rest)
      return
    case 'task':
      await runTaskCommand(api, subcommand, rest)
      return
    case 'workspace':
      await runWorkspaceCommand(api, subcommand, rest)
      return
    case 'agent':
      await runAgentCommand(api, subcommand, rest)
      return
    case 'inbox':
      await runInboxCommand(api, subcommand, rest)
      return
    case 'drive':
      await runDriveCommand(api, subcommand, rest)
      return
    case 'chat':
      await runChatCommand(api, subcommand, rest)
      return
    case 'skill':
      await runSkillCommand(api, subcommand, rest)
      return
    case 'node':
      await runNodeCommand(api, subcommand, rest)
      return
    case 'mcp':
      await runMcpCommand(api, subcommand, rest)
      return
    case 'status':
      await runStatusCommand(args.slice(1))
      return
    default:
      throw new Error(`Unknown command "${first}". Run "${cliName} --help" for usage.`)
  }
}

// Do not auto-invoke runCli(): this module is bundled into the worker entrypoint.
