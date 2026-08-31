/**
 * [INPUT]: CLI topic.
 * [OUTPUT]: Consistent root/resource/command help and usage errors.
 * [POS]: Single source of truth for the public worker CLI command tree.
 * [PROTOCOL]: Update this header when responsibilities change, then check AGENTS.md.
 */

import { getEnv } from '@shared/env'

type CommandSpec = {
  name: string
  usage: string
  description: string
}

type ResourceSpec = {
  description: string
  commands: CommandSpec[]
}

const WORKER_COMMANDS: CommandSpec[] = [
  { name: 'connect', usage: 'connect --pairing-code <code> [--server-url <url>] [--name <name>] [--no-start]', description: 'Pair this worker and start it' },
  { name: 'daemon', usage: 'daemon', description: 'Run the worker in the foreground' },
  { name: 'open', usage: 'open', description: 'Open the local worker console' },
  { name: 'status', usage: 'status [--json]', description: 'Show worker and connection status' },
  { name: 'doctor', usage: 'doctor', description: 'Run worker diagnostics' },
  { name: 'update', usage: 'update [--check]', description: 'Check for or install worker updates' },
  { name: 'service', usage: 'service <install|uninstall|start|stop|restart|status|logs>', description: 'Manage the background worker service' },
  { name: 'bootstrap', usage: 'bootstrap [--target <base|all|agent>] [--json]', description: 'Install and verify agent runtimes' },
  { name: 'unpair', usage: 'unpair', description: 'Remove the saved worker pairing' },
]

const ADVANCED_COMMANDS: CommandSpec[] = [
  { name: 'mesh', usage: 'mesh <status|install-service|uninstall-service|service-status>', description: 'Inspect or manage the worker mesh' },
  { name: 'desktop-sandbox', usage: 'desktop-sandbox <command> [options]', description: 'Operate the local desktop sandbox' },
  { name: 'runtime-smoke', usage: 'runtime-smoke --agent <type> --cwd <path> --prompt <text> [--json]', description: 'Smoke-test an agent runtime' },
  { name: 'mcp-stdio', usage: 'mcp-stdio', description: 'Expose the executor MCP bridge over stdio' },
  { name: 'mcp-connector-stdio', usage: 'mcp-connector-stdio', description: 'Expose the official connector MCP proxy over stdio' },
  { name: 'reset', usage: 'reset', description: 'Clear all local worker configuration' },
]

const RESOURCE_SPECS: Record<string, ResourceSpec> = {
  worker: {
    description: 'Manage the local worker',
    commands: [...WORKER_COMMANDS, ...ADVANCED_COMMANDS].map((command) => ({
      ...command,
      usage: `worker ${command.usage}`,
    })),
  },
  project: {
    description: 'Manage projects',
    commands: [
      { name: 'list', usage: 'project list [--json]', description: 'List projects' },
      { name: 'get', usage: 'project get <project-id> [--json]', description: 'Show a project' },
      { name: 'create', usage: 'project create <name> [--git-url <url>] [--branch <branch>] [--json]', description: 'Create a project' },
      { name: 'update', usage: 'project update <project-id> [--name <name>] [--git-url <url>] [--branch <branch>] [--executor <id>] [--json]', description: 'Update a project' },
      { name: 'select', usage: 'project select <project-id> [--json]', description: 'Select the current project' },
      { name: 'delete', usage: 'project delete <project-id> [--json]', description: 'Delete a project' },
    ],
  },
  task: {
    description: 'Manage tasks and task conversations',
    commands: [
      { name: 'list', usage: 'task list [--project <project-id>] [--status <status>] [--json]', description: 'List tasks' },
      { name: 'get', usage: 'task get <task-id> [--json]', description: 'Show a task' },
      { name: 'create', usage: 'task create <project-id> <description> [--title <title>] [--json]', description: 'Create a task' },
      { name: 'run', usage: 'task run <task-id> --workspace <workspace-id> [--session <session-id>] [--new-session] [--branch <branch>] [--json]', description: 'Run a task in a workspace' },
      { name: 'execution', usage: 'task execution <task-id> [--run <run-id>] [--json]', description: 'Show task execution details' },
      { name: 'send', usage: 'task send <task-id> <message...> [--workspace <workspace-id>] [--session <session-id>] [--json]', description: 'Send a message to a task' },
      { name: 'subtask create', usage: 'task subtask create <parent-task-id> <description...> [--title <title>] [--agent <type>] [--model <model>] [--json]', description: 'Create a subtask' },
      { name: 'chat list', usage: 'task chat list <task-id> [--workspace <workspace-id>] [--json]', description: 'List task chat sessions' },
      { name: 'chat get', usage: 'task chat get <task-id> [--workspace <workspace-id>] [--session <session-id>] [--turns <count>] [--json]', description: 'Show a task chat session' },
      { name: 'model', usage: 'task model <task-id> <model> [--workspace <workspace-id>] [--session <session-id>] [--executor <id>] [--json]', description: 'Set the task execution model' },
      { name: 'agent', usage: 'task agent <task-id> <type> [--workspace <workspace-id>] [--session <session-id>] [--executor <id>] [--json]', description: 'Set the task agent runtime' },
      { name: 'cancel', usage: 'task cancel <task-id> [--run <run-id>] [--json]', description: 'Cancel task execution' },
      { name: 'retry', usage: 'task retry <task-id> [--json]', description: 'Retry task execution' },
      { name: 'runs', usage: 'task runs <task-id> [--json]', description: 'List task runs' },
      { name: 'update', usage: 'task update <task-id> [--title <title>] [--description <text>] [--status <status>] [--json]', description: 'Update a task' },
      { name: 'delete', usage: 'task delete <task-id> [--json]', description: 'Delete a task' },
    ],
  },
  workspace: {
    description: 'Manage workspaces and workspace sessions',
    commands: [
      { name: 'list', usage: 'workspace list <project-id> [--json]', description: 'List project workspaces' },
      { name: 'get', usage: 'workspace get <workspace-id> [--json]', description: 'Show a workspace' },
      { name: 'create', usage: 'workspace create <project-id> <name> <executor-node-id> [--json]', description: 'Create a workspace' },
      { name: 'delete', usage: 'workspace delete <workspace-id> [--json]', description: 'Delete a workspace' },
      { name: 'session list', usage: 'workspace session list <task-id> [--workspace <workspace-id>] [--json]', description: 'List workspace sessions' },
      { name: 'session get', usage: 'workspace session get <session-id> [--json]', description: 'Show a workspace session' },
      { name: 'session runtime', usage: 'workspace session runtime <task-id> [--json]', description: 'Show task runtime state' },
    ],
  },
  agent: {
    description: 'Inspect available agents',
    commands: [
      { name: 'list', usage: 'agent list [--type <type>] [--json]', description: 'List registered agents' },
      { name: 'types', usage: 'agent types [--json]', description: 'List supported agent types' },
    ],
  },
  skill: {
    description: 'Manage agent skills',
    commands: [
      { name: 'list', usage: 'skill list [--project <project-id>] [--json]', description: 'List skills' },
      { name: 'get', usage: 'skill get <skill-id> [--json]', description: 'Show a skill' },
      { name: 'packages', usage: 'skill packages [--project <project-id>] [--workspace <workspace-id>] [--json]', description: 'List runtime skill packages' },
      { name: 'delete', usage: 'skill delete <skill-id> [--json]', description: 'Delete a skill' },
    ],
  },
  node: {
    description: 'Inspect executor nodes',
    commands: [
      { name: 'list', usage: 'node list [--json]', description: 'List visible executor nodes' },
    ],
  },
  mcp: {
    description: 'Inspect MCP configuration',
    commands: [
      { name: 'list', usage: 'mcp list [--json]', description: 'List configured MCP servers' },
    ],
  },
  inbox: {
    description: 'Manage your user inbox',
    commands: [
      { name: 'list', usage: 'inbox list [--limit <n>] [--unread] [--workspace <id>] [--json]', description: 'List inbox items' },
      { name: 'groups', usage: 'inbox groups [--section <action|following|snoozed|archived|all>] [--limit <n>] [--json]', description: 'List inbox grouped by section' },
      { name: 'get', usage: 'inbox get <item-id> [--json]', description: 'Show an inbox item' },
      { name: 'read', usage: 'inbox read <item-id> [--json]', description: 'Mark an inbox item read' },
      { name: 'read-group', usage: 'inbox read-group <group-key> [--json]', description: 'Mark an inbox group read' },
      { name: 'reply', usage: 'inbox reply <item-id> <message...> [--json]', description: 'Reply to an inbox item' },
    ],
  },
  drive: {
    description: 'Manage cloud drive files',
    commands: [
      { name: 'list', usage: 'drive list [--workspace <id> | --personal] [--parent <id>] [--json]', description: 'List drive files' },
      { name: 'get', usage: 'drive get <file-id>', description: 'Read a text file' },
      { name: 'info', usage: 'drive info <file-id> [--json]', description: 'Show file metadata' },
      { name: 'write', usage: 'drive write <name> <content...> [--workspace <id> | --personal] [--parent <id>] [--file-id <id>] [--json]', description: 'Create or overwrite a text file' },
    ],
  },
  chat: {
    description: 'Inspect conversations and external channels',
    commands: [
      { name: 'conversations', usage: 'chat conversations [--project <id>] [--task <id>] [--json]', description: 'List conversations' },
      { name: 'get', usage: 'chat get <conversation-id> [--json]', description: 'Show a conversation' },
      { name: 'channel list', usage: 'chat channel list [--agent <id>] [--agent-name <name>] [--json]', description: 'List agent external channels' },
      { name: 'channel send', usage: 'chat channel send <agent-id> <message...> [--channel <auto|telegram|feishu>] [--agent-name <name>] [--json]', description: 'Send a message through an agent channel' },
    ],
  },
}

const padCommands = (commands: Array<{ usage: string; description: string }>) => {
  const width = Math.min(48, Math.max(...commands.map((command) => command.usage.length)))
  return commands.map((command) => {
    if (command.usage.length > width) {
      return `  ${command.usage}\n    ${command.description}`
    }
    return `  ${command.usage.padEnd(width)}  ${command.description}`
  }).join('\n')
}

export const getCliName = (invokedName = getEnv('WEMUX_CLI_NAME')?.trim()) => {
  // 品牌迁移：wemux 是当前规范命令名；vbx / vibemux 仅作为旧别名保留（存量脚本兼容）。
  if (invokedName === 'vbx' || invokedName === 'vibemux') {
    return invokedName
  }
  return 'wemux'
}

export const isCanonicalCliName = (invokedName?: string) => {
  // 规范 CLI：wemux / vbx / vibemux。npm daemon 包 bin（wemux-worker 等）按旧入口处理。
  return invokedName === 'wemux' || invokedName === 'vbx' || invokedName === 'vibemux'
}

export const isHelpFlag = (value?: string) => value === 'help' || value === '--help' || value === '-h'

export const isVersionFlag = (value?: string) => value === '--version' || value === '-V'

export const hasHelpFlag = (args: string[]) => args.some(isHelpFlag)

export const hasVersionFlag = (args: string[]) => args.some(isVersionFlag)

export const renderRootHelp = (cliName: string, version: string) => {
  const resources = Object.entries(RESOURCE_SPECS).map(([name, spec]) => ({
    usage: name,
    description: spec.description,
  }))

  return [
    `wemux CLI ${version}`,
    '',
    'Usage:',
    `  ${cliName} <command> [options]`,
    `  ${cliName} <resource> <command> [options]`,
    '',
    'Resources:',
    padCommands(resources),
    '',
    'Global options:',
    '  -h, --help     Show help',
    '  -V, --version  Show version',
    '  -y, --yes      Skip destructive action confirmation',
    '      --json     Output machine-readable JSON where supported',
    '',
    `Run "${cliName} help <resource>" for resource commands.`,
    'Authentication: set WEMUX_TOKEN, or pair the local worker.',
  ].join('\n')
}

export const renderTopicHelp = (cliName: string, topic: string, commandName?: string) => {
  const resource = RESOURCE_SPECS[topic]
  if (resource) {
    const command = commandName ? resource.commands.find((item) => item.name === commandName) : undefined
    if (command) {
      return [`Usage:`, `  ${cliName} ${command.usage}`, '', command.description].join('\n')
    }
    return [
      `${topic} - ${resource.description}`,
      '',
      'Usage:',
      `  ${cliName} ${topic} <command> [options]`,
      '',
      'Commands:',
      padCommands(resource.commands),
      '',
      `Run "${cliName} ${topic} <command> --help" for command usage.`,
    ].join('\n')
  }

  return null
}

export const throwCommandUsage = (cliName: string, resource: string, commandName: string): never => {
  const command = RESOURCE_SPECS[resource]?.commands.find((item) => item.name === commandName)
  const usage = command?.usage || `${resource} ${commandName}`
  throw new Error(`Missing required argument.\nUsage: ${cliName} ${usage}`)
}

export const throwUnknownCommand = (cliName: string, resource: string, commandName: string): never => {
  throw new Error(`Unknown command "${resource} ${commandName}". Run "${cliName} ${resource} --help" for usage.`)
}
