// [INPUT]: 命令输入
// [OUTPUT]: 解析执行
// [POS]: 命令工具
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import { accessSync, constants, existsSync } from 'node:fs'
import { delimiter, dirname, isAbsolute, join } from 'node:path'
import { spawnSync } from 'node:child_process'
import type { InstallExecutionOptions } from './runtime-bootstrap-types'

export type CommandResult = {
  ok: boolean
  stdout: string
  stderr: string
  error?: string
}

export const runCommand = (
  command: string,
  args: string[],
  options?: { cwd?: string; timeout?: number; streamOutput?: boolean; env?: NodeJS.ProcessEnv },
): CommandResult => {
  const spawnOpts = {
    cwd: options?.cwd,
    encoding: 'utf8' as const,
    env: options?.env,
    stdio: (options?.streamOutput ? 'inherit' : 'pipe') as 'inherit' | 'pipe',
    timeout: options?.timeout ?? 120000,
  }

  let result = spawnSync(command, args, spawnOpts)

  // On Windows, .cmd/.bat files cannot be executed directly by CreateProcess.
  // Retry with shell: true if the command was not found (ENOENT) or rejected (EINVAL).
  if (process.platform === 'win32' && result.error) {
    const code = (result.error as NodeJS.ErrnoException).code
    if (code === 'ENOENT' || code === 'EINVAL') {
      result = spawnSync(command, args, { ...spawnOpts, shell: true })
    }
  }

  return {
    ok: result.status === 0,
    stdout: result.stdout?.trim() ?? '',
    stderr: result.stderr?.trim() ?? '',
    error: result.error instanceof Error ? result.error.message : undefined,
  }
}

export const getCommandDetail = (result: CommandResult, fallback: string) => {
  if (!result.ok) {
    return result.stderr || result.error || result.stdout || fallback
  }

  return result.stdout || result.stderr || result.error || fallback
}

export const hasCommand = (command: string, args: string[] = ['--version']) => {
  return runCommand(command, args).ok
}

export const getProcessPathValue = (source: NodeJS.ProcessEnv = process.env) => {
  if (source.PATH !== undefined) {
    return source.PATH
  }

  if (process.platform !== 'win32') {
    return ''
  }

  const pathKey = Object.keys(source).find((key) => key.toLowerCase() === 'path')
  return pathKey ? source[pathKey] ?? '' : ''
}

export const setProcessPathValue = (target: NodeJS.ProcessEnv, value: string) => {
  const existingKey = process.platform === 'win32'
    ? Object.keys(target).find((key) => key.toLowerCase() === 'path')
    : undefined
  target[existingKey || 'PATH'] = value
}

const getEnvValue = (source: NodeJS.ProcessEnv, key: string) => {
  if (source[key] !== undefined) {
    return source[key]
  }

  if (process.platform !== 'win32') {
    return undefined
  }

  const existingKey = Object.keys(source).find((item) => item.toLowerCase() === key.toLowerCase())
  return existingKey ? source[existingKey] : undefined
}

const pushUniquePathEntry = (entries: string[], entry: string | undefined) => {
  const normalized = entry?.trim()
  if (!normalized) {
    return
  }

  const alreadyPresent = process.platform === 'win32'
    ? entries.some((item) => item.toLowerCase() === normalized.toLowerCase())
    : entries.includes(normalized)
  if (!alreadyPresent) {
    entries.push(normalized)
  }
}

const getNpmGlobalBinCandidates = () => {
  const entries: string[] = []
  const npmPrefix = getEnvValue(process.env, 'npm_config_prefix')
  if (process.platform === 'win32') {
    const appData = getEnvValue(process.env, 'APPDATA')
    const userProfile = getEnvValue(process.env, 'USERPROFILE')
    pushUniquePathEntry(entries, npmPrefix)
    pushUniquePathEntry(entries, appData ? join(appData, 'npm') : undefined)
    pushUniquePathEntry(entries, userProfile ? join(userProfile, 'AppData', 'Roaming', 'npm') : undefined)
  } else if (npmPrefix) {
    pushUniquePathEntry(entries, join(npmPrefix, 'bin'))
  }

  const prefix = runCommand('npm', ['prefix', '-g'], { timeout: 10000 })
  if (prefix.ok && prefix.stdout) {
    pushUniquePathEntry(entries, process.platform === 'win32' ? prefix.stdout : join(prefix.stdout, 'bin'))
  }

  return entries
}

export const shouldSpawnWithShellOnWindows = (executable: string, platform = process.platform) => {
  if (platform !== 'win32') {
    return false
  }

  const normalized = executable.trim().toLowerCase()
  return normalized.endsWith('.cmd') || normalized.endsWith('.bat')
}

const prependPathEntry = (entry: string) => {
  const currentPath = getProcessPathValue(process.env)
  const parts = currentPath.split(delimiter).filter(Boolean)
  if (parts.includes(entry)) {
    return
  }

  setProcessPathValue(process.env, currentPath ? `${entry}${delimiter}${currentPath}` : entry)
}

const isExecutableFile = (targetPath: string) => {
  if (!existsSync(targetPath)) {
    return false
  }

  if (process.platform === 'win32') {
    return true
  }

  try {
    accessSync(targetPath, constants.X_OK)
    return true
  } catch {
    return false
  }
}

const resolveWindowsExecutablePath = (targetPath: string) => {
  const extensions = (process.env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD')
    .split(';')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean)

  if (extensions.some((extension) => targetPath.toLowerCase().endsWith(extension))) {
    return isExecutableFile(targetPath) ? targetPath : null
  }

  for (const extension of extensions) {
    const candidate = `${targetPath}${extension}`
    if (isExecutableFile(candidate)) {
      return candidate
    }
  }

  return null
}

const resolveExplicitExecutable = (command: string) => {
  if (process.platform === 'win32') {
    return resolveWindowsExecutablePath(command)
  }

  return isExecutableFile(command) ? command : null
}

export const resolveExecutable = (command: string) => {
  if (command.includes('/') || command.includes('\\') || isAbsolute(command)) {
    return resolveExplicitExecutable(command)
  }

  const pathEntries = getProcessPathValue(process.env).split(delimiter).filter(Boolean)
  for (const entry of pathEntries) {
    const candidate = join(entry, command)
    const resolved = process.platform === 'win32'
      ? resolveWindowsExecutablePath(candidate)
      : resolveExplicitExecutable(candidate)
    if (resolved) {
      prependPathEntry(dirname(resolved))
      return resolved
    }
  }

  for (const entry of getNpmGlobalBinCandidates()) {
    const candidate = join(entry, command)
    const resolved = process.platform === 'win32'
      ? resolveWindowsExecutablePath(candidate)
      : resolveExplicitExecutable(candidate)
    if (resolved) {
      prependPathEntry(dirname(resolved))
      return resolved
    }
  }

  return null
}

const withSudo = (
  command: string,
  args: string[],
  options?: Pick<InstallExecutionOptions, 'interactiveAuth'>,
) => {
  if (typeof process.getuid === 'function' && process.getuid() === 0) {
    return { command, args }
  }

  if (!hasCommand('sudo')) {
    return null
  }

  if (options?.interactiveAuth) {
    return {
      command: 'sudo',
      args: [command, ...args],
    }
  }

  if (!hasCommand('sudo', ['-n', 'true'])) {
    return null
  }

  return {
    command: 'sudo',
    args: ['-n', command, ...args],
  }
}

export const runPrivilegedCommand = (
  command: string,
  args: string[],
  timeout: number,
  options?: InstallExecutionOptions,
) => {
  const resolved = withSudo(command, args, options)
  if (!resolved) {
    return {
      ok: false,
      stdout: '',
      stderr: '',
      error: options?.interactiveAuth
        ? '缺少 sudo 能力，无法自动安装。'
        : '缺少 root 或免密 sudo 权限，无法自动安装。',
    } satisfies CommandResult
  }

  return runCommand(resolved.command, resolved.args, {
    streamOutput: options?.streamOutput,
    timeout,
  })
}
