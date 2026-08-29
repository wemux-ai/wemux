// [INPUT]: bootstrap 类型输入
// [OUTPUT]: 类型定义
// [POS]: runtime bootstrap 类型
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

export type RuntimeRequirementId =
  | 'git'
  | 'unzip'
  | 'opencode'
  | 'pi-runtime'
  | 'codex-cli'
  | 'codex-auth'
  | 'claude-cli'
  | 'claude-auth'

export type InstallExecutionOptions = {
  interactiveAuth?: boolean
  streamOutput?: boolean
}

export type RuntimeCheck = {
  id: RuntimeRequirementId
  label: string
  ok: boolean
  detail: string
  autoInstallable: boolean
  installer?: string
  installCommand?: string
  hint?: string
}

export type InstallAttempt = {
  id: RuntimeRequirementId
  label: string
  ok: boolean
  changed: boolean
  detail: string
  installer?: string
  commandSummary?: string
  skipped?: boolean
}

export type InstallStrategy = {
  installer: string
  commandSummary: string
  manualHint: string
  run: (options?: InstallExecutionOptions) => InstallAttempt
}
