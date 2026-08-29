// [INPUT]: 打开命令输入
// [OUTPUT]: 命令生成
// [POS]: 工作区打开命令
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

export const WORKSPACE_OPEN_TARGETS = [
  'vscode',
  'vscode-insiders',
  'cursor',
  'windsurf',
  'zed',
  'intellij',
  'xcode',
  'ghostty',
  'finder',
  'terminal',
  'iterm',
  'warp',
  'custom',
] as const

export type WorkspaceOpenTarget = typeof WORKSPACE_OPEN_TARGETS[number]

export type WorkspaceOpenSettings = {
  defaultTarget: WorkspaceOpenTarget
  customCommand: string
}

export type WorkspaceOpenCommandOptions = {
  target: WorkspaceOpenTarget
  platform?: string
  path?: string
  customCommand?: string
}

type WorkspaceOpenTargetDefinition = {
  label: string
  description: string
  commandBuilders: Array<(path: string) => string>
}

const DEFAULT_PATH = '.'

export const DEFAULT_WORKSPACE_OPEN_SETTINGS: WorkspaceOpenSettings = {
  defaultTarget: 'vscode',
  customCommand: '',
}

const shellQuote = (value: string) => {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

const buildPathLaunchCommand = (executable: string, args: string[] = []) => {
  return (path: string) => `command -v ${executable} >/dev/null 2>&1 && ${executable}${args.length > 0 ? ` ${args.join(' ')}` : ''} ${shellQuote(path)}`
}

const buildAbsolutePathLaunchCommand = (cliPath: string, args: string[] = []) => {
  return (path: string) => `[ -x "${cliPath}" ] && "${cliPath}"${args.length > 0 ? ` ${args.join(' ')}` : ''} ${shellQuote(path)}`
}

const buildMacAppLaunchCommand = (appName: string) => {
  return (path: string) => `command -v open >/dev/null 2>&1 && open -Ra "${appName}" && open -a "${appName}" ${shellQuote(path)}`
}

const buildMacOpenCommand = (appName?: string) => {
  return (path: string) => (
    appName
      ? `command -v open >/dev/null 2>&1 && open -Ra "${appName}" && open -a "${appName}" ${shellQuote(path)}`
      : `command -v open >/dev/null 2>&1 && open ${shellQuote(path)}`
  )
}

const buildGhosttyLaunchCommand = (path: string) => {
  return `command -v ghostty >/dev/null 2>&1 && ghostty --working-directory=${shellQuote(path)}`
}

const buildCustomLaunchCommand = (path: string, customCommand?: string) => {
  const trimmed = customCommand?.trim() || ''
  if (!trimmed) {
    return ''
  }

  if (trimmed.includes('${path}')) {
    return trimmed.split('${path}').join(shellQuote(path))
  }

  return `${trimmed} ${shellQuote(path)}`
}

const isMacPlatform = (platform?: string) => {
  const normalized = platform?.trim().toLowerCase() || ''
  return normalized.includes('darwin') || normalized.includes('mac')
}

const isLinuxPlatform = (platform?: string) => {
  const normalized = platform?.trim().toLowerCase() || ''
  return normalized.includes('linux')
}

const workspaceOpenTargetDefinitions: Record<Exclude<WorkspaceOpenTarget, 'custom'>, WorkspaceOpenTargetDefinition> = {
  vscode: {
    label: 'VS Code',
    description: 'Visual Studio Code',
    commandBuilders: [
      buildPathLaunchCommand('code', ['--reuse-window']),
      ...[
        '/opt/homebrew/bin/code',
        '/usr/local/bin/code',
        '/usr/bin/code',
        '/snap/bin/code',
        '/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code',
        '$HOME/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code',
      ].map((cliPath) => buildAbsolutePathLaunchCommand(cliPath, ['--reuse-window'])),
      buildMacAppLaunchCommand('Visual Studio Code'),
    ],
  },
  'vscode-insiders': {
    label: 'VS Code Insiders',
    description: 'Visual Studio Code - Insiders',
    commandBuilders: [
      buildPathLaunchCommand('code-insiders', ['--reuse-window']),
      ...[
        '/opt/homebrew/bin/code-insiders',
        '/usr/local/bin/code-insiders',
        '/usr/bin/code-insiders',
        '/snap/bin/code-insiders',
        '/Applications/Visual Studio Code - Insiders.app/Contents/Resources/app/bin/code-insiders',
        '$HOME/Applications/Visual Studio Code - Insiders.app/Contents/Resources/app/bin/code-insiders',
      ].map((cliPath) => buildAbsolutePathLaunchCommand(cliPath, ['--reuse-window'])),
      buildMacAppLaunchCommand('Visual Studio Code - Insiders'),
    ],
  },
  cursor: {
    label: 'Cursor',
    description: 'Cursor editor',
    commandBuilders: [
      buildPathLaunchCommand('cursor'),
      buildAbsolutePathLaunchCommand('/Applications/Cursor.app/Contents/Resources/app/bin/cursor'),
      buildAbsolutePathLaunchCommand('$HOME/Applications/Cursor.app/Contents/Resources/app/bin/cursor'),
      buildMacAppLaunchCommand('Cursor'),
    ],
  },
  windsurf: {
    label: 'Windsurf',
    description: 'Windsurf editor',
    commandBuilders: [
      buildPathLaunchCommand('windsurf'),
      buildAbsolutePathLaunchCommand('/Applications/Windsurf.app/Contents/Resources/app/bin/windsurf'),
      buildAbsolutePathLaunchCommand('$HOME/Applications/Windsurf.app/Contents/Resources/app/bin/windsurf'),
      buildMacAppLaunchCommand('Windsurf'),
    ],
  },
  zed: {
    label: 'Zed',
    description: 'Zed editor',
    commandBuilders: [
      buildPathLaunchCommand('zed'),
      buildAbsolutePathLaunchCommand('/Applications/Zed.app/Contents/MacOS/zed'),
      buildAbsolutePathLaunchCommand('$HOME/Applications/Zed.app/Contents/MacOS/zed'),
      buildMacAppLaunchCommand('Zed'),
    ],
  },
  intellij: {
    label: 'IntelliJ IDEA',
    description: 'JetBrains IntelliJ IDEA',
    commandBuilders: [
      buildPathLaunchCommand('idea'),
      buildMacAppLaunchCommand('IntelliJ IDEA'),
      buildMacAppLaunchCommand('IntelliJ IDEA CE'),
    ],
  },
  xcode: {
    label: 'Xcode',
    description: 'Xcode project editor',
    commandBuilders: [
      buildPathLaunchCommand('xed'),
      buildAbsolutePathLaunchCommand('/usr/bin/xed'),
      buildMacAppLaunchCommand('Xcode'),
    ],
  },
  ghostty: {
    label: 'Ghostty',
    description: 'Ghostty terminal',
    commandBuilders: [
      buildGhosttyLaunchCommand,
      buildAbsolutePathLaunchCommand('/Applications/Ghostty.app/Contents/MacOS/ghostty', ['--working-directory']),
      buildAbsolutePathLaunchCommand('$HOME/Applications/Ghostty.app/Contents/MacOS/ghostty', ['--working-directory']),
      buildMacAppLaunchCommand('Ghostty'),
    ],
  },
  finder: {
    label: 'Finder',
    description: 'Open the folder in Finder',
    commandBuilders: [buildMacOpenCommand()],
  },
  terminal: {
    label: 'Terminal',
    description: 'Open the folder in Terminal.app',
    commandBuilders: [buildMacOpenCommand('Terminal')],
  },
  iterm: {
    label: 'iTerm',
    description: 'Open the folder in iTerm',
    commandBuilders: [
      buildMacOpenCommand('iTerm'),
      buildMacOpenCommand('iTerm2'),
    ],
  },
  warp: {
    label: 'Warp',
    description: 'Open the folder in Warp',
    commandBuilders: [buildMacOpenCommand('Warp')],
  },
}

export const isWorkspaceOpenTarget = (value: string): value is WorkspaceOpenTarget => {
  return WORKSPACE_OPEN_TARGETS.includes(value as WorkspaceOpenTarget)
}

export const normalizeWorkspaceOpenSettings = (settings?: Partial<WorkspaceOpenSettings>): WorkspaceOpenSettings => {
  const defaultTarget = settings?.defaultTarget && isWorkspaceOpenTarget(settings.defaultTarget)
    ? settings.defaultTarget
    : DEFAULT_WORKSPACE_OPEN_SETTINGS.defaultTarget

  return {
    defaultTarget,
    customCommand: settings?.customCommand ?? DEFAULT_WORKSPACE_OPEN_SETTINGS.customCommand,
  }
}

export const getWorkspaceOpenTargetLabel = (target: WorkspaceOpenTarget) => {
  if (target === 'custom') {
    return 'Custom'
  }

  return workspaceOpenTargetDefinitions[target].label
}

export const getWorkspaceOpenTargetDescription = (target: WorkspaceOpenTarget) => {
  if (target === 'custom') {
    return 'Run your own command template'
  }

  return workspaceOpenTargetDefinitions[target].description
}

export const listWorkspaceOpenTargets = () => {
  return WORKSPACE_OPEN_TARGETS.map((target) => ({
    value: target,
    label: getWorkspaceOpenTargetLabel(target),
    description: getWorkspaceOpenTargetDescription(target),
  }))
}

export const buildWorkspaceOpenCommandAttempts = (options: WorkspaceOpenCommandOptions) => {
  const path = options.path?.trim() || DEFAULT_PATH
  if (options.target === 'custom') {
    const customCommand = buildCustomLaunchCommand(path, options.customCommand)
    return customCommand ? [customCommand] : []
  }

  const definition = workspaceOpenTargetDefinitions[options.target]
  const commands = definition.commandBuilders.map((builder) => builder(path))

  if (isLinuxPlatform(options.platform)) {
    return commands.filter((command) => !command.includes(' open ') && !command.includes('.app/'))
  }

  if (isMacPlatform(options.platform)) {
    return commands.filter((command) => !command.includes('/snap/bin/'))
  }

  return commands
}
