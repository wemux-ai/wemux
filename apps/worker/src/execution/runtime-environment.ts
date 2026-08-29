// [INPUT]: runtime 环境定义
// [OUTPUT]: 环境载荷
// [POS]: runtime 环境模型
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import type { RuntimeEnvironmentExecutionPayload } from '@shared/runtime-environment'
import { isValidRuntimeEnvironmentFileName } from '@shared/runtime-environment'

const resolveRuntimeEnvironmentFilePath = (cwd: string, fileName: string) => {
  if (!isValidRuntimeEnvironmentFileName(fileName)) {
    throw new Error(`运行时环境变量文件名不合法：${fileName}`)
  }

  const absolutePath = path.resolve(cwd, fileName)
  const relativePath = path.relative(cwd, absolutePath)
  if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
    throw new Error(`运行时环境变量文件必须位于工作目录内：${fileName}`)
  }

  return absolutePath
}

export const materializeRuntimeEnvironment = (cwd: string, runtimeEnvironment?: RuntimeEnvironmentExecutionPayload) => {
  if (!runtimeEnvironment) {
    return
  }

  if (runtimeEnvironment.mode === 'env-file') {
    const fileName = runtimeEnvironment.fileName?.trim()
    if (!fileName) {
      throw new Error('环境变量文件模式缺少文件名。')
    }

    const absolutePath = resolveRuntimeEnvironmentFilePath(cwd, fileName)
    mkdirSync(path.dirname(absolutePath), { recursive: true })
    writeFileSync(absolutePath, `${runtimeEnvironment.fileContent ?? ''}${runtimeEnvironment.fileContent ? '\n' : ''}`, 'utf8')
  }
}

export const mergeRuntimeEnvironmentIntoProcessEnv = (
  baseEnv: NodeJS.ProcessEnv | undefined,
  runtimeEnvironment?: RuntimeEnvironmentExecutionPayload,
) => {
  if (!runtimeEnvironment || runtimeEnvironment.mode !== 'process-env') {
    return {
      ...(baseEnv ?? process.env),
    }
  }

  return {
    ...(baseEnv ?? process.env),
    ...(runtimeEnvironment.variables ?? {}),
  }
}
