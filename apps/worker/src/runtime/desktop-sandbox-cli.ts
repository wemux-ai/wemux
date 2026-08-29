// [INPUT]: desktop-sandbox CLI 参数
// [OUTPUT]: CLI 执行入口
// [POS]: 桌面沙箱 CLI
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import type { WorkspaceDesktopSandboxAction, WorkspaceDesktopSandboxRequest } from '@shared/types'
import { getStringFlag, parseCliFlags } from '../cli-flags'
import { desktopSandboxProvider, resolveDesktopSandboxProvider } from './desktop-sandbox-provider'

const readRequiredOption = (flags: ReturnType<typeof parseCliFlags>, name: string) => {
  const value = getStringFlag(flags, name)
  if (!value) {
    throw new Error(`缺少必填参数 --${name}。`)
  }
  return value
}

const printUsage = () => {
  console.log([
    'Usage:',
    '  wemux-worker desktop-sandbox status',
    '  wemux-worker desktop-sandbox start --display-profile auto|1080p|720p|480p',
    '  wemux-worker desktop-sandbox stop',
    '  wemux-worker desktop-sandbox command --command "pwd"',
    '  wemux-worker desktop-sandbox read-file --path /tmp/file.txt',
    '  wemux-worker desktop-sandbox write-file --path /tmp/file.txt --content "hello"',
    '  wemux-worker desktop-sandbox action --action terminal',
    '  wemux-worker desktop-sandbox cli-start',
    '  wemux-worker desktop-sandbox cli-stop',
    '  wemux-worker desktop-sandbox cli-command --command "node -v"',
  ].join('\n'))
}

const buildRequest = (subcommand: string, args: string[]): WorkspaceDesktopSandboxRequest | null => {
  const flags = parseCliFlags(args)
  if (subcommand === 'status') return { operation: 'status' }
  if (subcommand === 'start') {
    return {
      operation: 'start',
      displayProfile: getStringFlag(flags, 'display-profile') as WorkspaceDesktopSandboxRequest['displayProfile'],
      cwd: getStringFlag(flags, 'cwd'),
    }
  }
  if (subcommand === 'stop') return { operation: 'stop' }
  if (subcommand === 'command') return { operation: 'command', command: readRequiredOption(flags, 'command') }
  if (subcommand === 'read-file') return { operation: 'file.read', path: readRequiredOption(flags, 'path') }
  if (subcommand === 'write-file') {
    return {
      operation: 'file.write',
      path: readRequiredOption(flags, 'path'),
      content: getStringFlag(flags, 'content'),
    }
  }
  if (subcommand === 'action') {
    return {
      operation: 'desktop.action',
      action: readRequiredOption(flags, 'action') as WorkspaceDesktopSandboxAction,
    }
  }
  if (subcommand === 'cli-start') return { operation: 'cli.start' }
  if (subcommand === 'cli-stop') return { operation: 'cli.stop' }
  if (subcommand === 'cli-command') return { operation: 'cli.command', command: readRequiredOption(flags, 'command') }
  return null
}

export const runDesktopSandboxCli = async (args: string[]) => {
  const subcommand = args[0]?.trim()
  if (!subcommand || subcommand === 'help' || subcommand === '--help') {
    printUsage()
    return
  }

  const request = buildRequest(subcommand, args.slice(1))
  if (!request) {
    throw new Error(`Unknown desktop-sandbox command: ${subcommand}`)
  }

  const result = await desktopSandboxProvider.execute(request)
  result.provider = result.provider || resolveDesktopSandboxProvider()
  console.log(JSON.stringify(result, null, 2))
  if (!result.ok) {
    process.exitCode = 1
  }
}
