// [INPUT]: task-executor 类型输入
// [OUTPUT]: 类型定义
// [POS]: task-executor 类型
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import { simpleGit } from 'simple-git'
import type { DistributedTask, ProjectCommandPreset } from '@shared/types'

export type GitClient = ReturnType<typeof simpleGit>
export type PresetCommandStep = 'install' | 'build' | 'test' | 'lint'
export type WorkingDirectoryMode = 'worktree' | 'original-dir'

export type ParsedCommand = {
  command: string
  args: string[]
  env: Record<string, string>
}

export type BackgroundPresetStep = {
  commandText: string
  label: string
  promise: Promise<{ output: string }>
}

export type PresetStepContext = {
  step: PresetCommandStep
  task: DistributedTask
  cwd: string
  signal?: AbortSignal
  env?: NodeJS.ProcessEnv
  emit: (status: DistributedTask['status'], message: string) => void
}

export type PresetCommandResolver = (preset: ProjectCommandPreset | undefined, step: PresetCommandStep) => string | undefined
