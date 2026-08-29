// [INPUT]: 终端命令
// [OUTPUT]: 诊断结果
// [POS]: 终端命令诊断
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

const extractCommandName = (command: string) => {
  const trimmed = command.trim()
  if (!trimmed) {
    return ''
  }

  const match = trimmed.match(/^(?:env\s+)?(?:[A-Z_][A-Z0-9_]*=\S+\s+)*([^\s;&|]+)/i)
  return match?.[1]?.replace(/^['"]|['"]$/g, '') ?? ''
}

const isMissingCommandOutput = (output: string) => {
  return /\bcommand not found\b/i.test(output)
    || /\bnot found\b/i.test(output) && /(?:^|\n)\s*(?:\/[^:\n]+:\s*)?(?:line\s+\d+:\s*)?[^\s:]+:/i.test(output)
}

export const buildTerminalCommandDiagnostic = (params: {
  command: string
  exitCode?: number
  output?: string
}) => {
  const commandName = extractCommandName(params.command)
  const output = params.output ?? ''
  const missingCommand = params.exitCode === 127 || isMissingCommandOutput(output)
  if (!missingCommand || !commandName) {
    return ''
  }

  if (commandName === 'pnpm') {
    return '诊断：当前执行节点缺少 pnpm，或 PATH 中找不到 pnpm。请更新并重启该 Worker；Docker Worker 需要使用包含 pnpm 的最新镜像。'
  }

  return `诊断：当前执行节点缺少 ${commandName}，或 PATH 中找不到该命令。请在该节点安装对应工具后重试。`
}

export const appendTerminalCommandDiagnostic = (params: {
  command: string
  exitCode?: number
  output: string
}) => {
  const diagnostic = buildTerminalCommandDiagnostic(params)
  if (!diagnostic) {
    return params.output
  }

  return [params.output.trim(), diagnostic].filter(Boolean).join('\n\n')
}
