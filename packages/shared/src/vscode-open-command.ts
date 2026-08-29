// [INPUT]: 打开命令输入
// [OUTPUT]: 命令生成
// [POS]: VS Code 打开命令
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import { buildWorkspaceOpenCommandAttempts } from './workspace-open-command'

type VsCodeOpenCommandOptions = {
  platform?: string
}

export const buildVsCodeOpenCommandAttempts = (options?: VsCodeOpenCommandOptions) => {
  return [
    ...buildWorkspaceOpenCommandAttempts({ target: 'vscode', platform: options?.platform }),
    ...buildWorkspaceOpenCommandAttempts({ target: 'vscode-insiders', platform: options?.platform }),
  ]
}
