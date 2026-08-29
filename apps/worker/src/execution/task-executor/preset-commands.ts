// [INPUT]: 命令预设（install/build/test/lint + 后台步骤）
// [OUTPUT]: 解析/执行预设命令
// [POS]: 预设命令解析与执行
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import { spawn } from 'node:child_process'
import type { DistributedTask, ProjectCommandPreset } from '@shared/types'
import type { BackgroundPresetStep, ParsedCommand, PresetCommandStep, PresetStepContext } from './types'

const FORBIDDEN_COMMAND_PATTERNS = ['&&', '||', '|', ';', '>', '<', '$(', '`']

const trimCommandOutput = (value: string, limit = 1600) => {
  const normalized = value.trim()
  if (!normalized) {
    return ''
  }

  return normalized.length > limit
    ? `${normalized.slice(0, limit)}\n...（已截断）`
    : normalized
}

const tokenizeCommand = (value: string) => {
  const tokens: string[] = []
  let current = ''
  let quote: '"' | '\'' | null = null
  let escaping = false

  for (const char of value) {
    if (escaping) {
      current += char
      escaping = false
      continue
    }

    if (char === '\\') {
      escaping = true
      continue
    }

    if (quote) {
      if (char === quote) {
        quote = null
      } else {
        current += char
      }
      continue
    }

    if (char === '"' || char === '\'') {
      quote = char
      continue
    }

    if (/\s/.test(char)) {
      if (current) {
        tokens.push(current)
        current = ''
      }
      continue
    }

    current += char
  }

  if (escaping) {
    current += '\\'
  }

  if (quote) {
    throw new Error('环境模板命令存在未闭合的引号。')
  }

  if (current) {
    tokens.push(current)
  }

  return tokens
}

const parsePresetCommand = (value: string): ParsedCommand => {
  const commandText = value.trim()
  if (!commandText) {
    throw new Error('环境模板命令不能为空。')
  }

  if (FORBIDDEN_COMMAND_PATTERNS.some((pattern) => commandText.includes(pattern))) {
    throw new Error('环境模板命令只支持单条命令，不支持 shell 管道、重定向或串联操作。')
  }

  const tokens = tokenizeCommand(commandText)
  const env: Record<string, string> = {}
  while (tokens.length > 0 && /^[A-Za-z_][A-Za-z0-9_]*=.*/.test(tokens[0])) {
    const token = tokens.shift()!
    const separator = token.indexOf('=')
    env[token.slice(0, separator)] = token.slice(separator + 1)
  }

  const command = tokens.shift()
  if (!command) {
    throw new Error('环境模板命令缺少可执行命令。')
  }

  return { command, args: tokens, env }
}

const getPresetCommand = (preset: ProjectCommandPreset | undefined, step: PresetCommandStep) => {
  if (!preset) {
    return undefined
  }

  if (step === 'install') return preset.installCommand?.trim() || undefined
  if (step === 'build') return preset.buildCommand?.trim() || undefined
  if (step === 'test') return preset.testCommand?.trim() || undefined
  return preset.lintCommand?.trim() || undefined
}

const describeCommandPreset = (preset: ProjectCommandPreset | undefined) => {
  if (!preset) {
    return []
  }

  return [
    preset.installCommand ? `install: ${preset.installCommand}` : null,
    preset.buildCommand ? `build: ${preset.buildCommand}` : null,
    preset.testCommand ? `test: ${preset.testCommand}` : null,
    preset.lintCommand ? `lint: ${preset.lintCommand}` : null,
    preset.branchNamePattern ? `branch: ${preset.branchNamePattern}` : null,
  ].filter((item): item is string => Boolean(item))
}

export const buildAgentTaskPrompt = (task: DistributedTask) => {
  const presetLines = describeCommandPreset(task.commandPreset)
  if (presetLines.length === 0) {
    return task.description
  }

  return [
    task.description,
    '',
    '项目环境模板命令：',
    ...presetLines.map((line) => `- ${line}`),
    '',
    '执行要求：',
    '- 优先遵守上面的项目环境模板命令。',
    '- install 命令会在 worktree 创建后立即后台启动。',
    '- build / test / lint 命令由 worker 在执行后自动校验。',
  ].join('\n')
}

const runPresetCommand = async (params: {
  cwd: string
  label: string
  commandText: string
  signal?: AbortSignal
  env?: NodeJS.ProcessEnv
}) => {
  const parsed = parsePresetCommand(params.commandText)

  return await new Promise<{ output: string }>((resolve, reject) => {
    const child = spawn(parsed.command, parsed.args, {
      cwd: params.cwd,
      env: { ...(params.env ?? process.env), ...parsed.env },
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    let stdout = ''
    let stderr = ''
    let aborted = false
    const onAbort = () => {
      aborted = true
      child.kill('SIGTERM')
    }

    params.signal?.addEventListener('abort', onAbort, { once: true })

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString()
    })

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString()
    })

    child.on('error', (error) => {
      params.signal?.removeEventListener('abort', onAbort)
      reject(new Error(`${params.label} 启动失败：${error.message}`))
    })

    child.on('close', (code, signal) => {
      params.signal?.removeEventListener('abort', onAbort)
      if (aborted) {
        reject(new Error(`${params.label} 已取消。`))
        return
      }

      const output = trimCommandOutput([stdout, stderr].filter(Boolean).join('\n'))
      if (code === 0) {
        resolve({ output })
        return
      }

      const reason = signal ? `信号 ${signal}` : `退出码 ${code ?? 'unknown'}`
      reject(new Error([
        `${params.label} 执行失败（${reason}）。`,
        output,
      ].filter(Boolean).join('\n\n')))
    })
  })
}

export const executePresetStep = async (params: PresetStepContext) => {
  const commandText = getPresetCommand(params.task.commandPreset, params.step)
  if (!commandText) {
    return null
  }

  const label = `项目预设 ${params.step}`
  params.emit('executing', `${label}：${commandText}`)
  const result = await runPresetCommand({
    cwd: params.cwd,
    label,
    commandText,
    signal: params.signal,
    env: params.env,
  })
  params.emit('executing', result.output ? `${label} 已完成。\n${result.output}` : `${label} 已完成。`)
  return `${label}：${commandText}`
}

export const startPresetStepInBackground = (params: PresetStepContext) => {
  const commandText = getPresetCommand(params.task.commandPreset, params.step)
  if (!commandText) {
    return null
  }

  const label = `项目预设 ${params.step}`
  params.emit('executing', `${label} 已在后台启动：${commandText}`)
  return {
    commandText,
    label,
    promise: runPresetCommand({
      cwd: params.cwd,
      label,
      commandText,
      signal: params.signal,
      env: params.env,
    }),
  } satisfies BackgroundPresetStep
}

export const awaitBackgroundPresetStep = async (
  step: BackgroundPresetStep,
  emit: (status: DistributedTask['status'], message: string) => void,
) => {
  const result = await step.promise
  emit('executing', result.output ? `${step.label} 已完成。\n${result.output}` : `${step.label} 已完成。`)
  return `${step.label}：${step.commandText}`
}
