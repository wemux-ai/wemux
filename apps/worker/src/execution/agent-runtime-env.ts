// [INPUT]: runtime 环境变量配置
// [OUTPUT]: 执行 env 组装
// [POS]: agent runtime 环境变量组装
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import { existsSync } from 'node:fs'
import path from 'node:path'
import { getWorkerAppRoot, getWorkerEntryPath, getWorkerLauncherPath } from '../core/app-root'
import { resolveExecutable } from '../core/command-utils'

const resolveWorkerCommandPaths = () => {
  const launcherPath = getWorkerLauncherPath()
  const entryPath = getWorkerEntryPath()
  if (existsSync(entryPath)) {
    return {
      launcherPath: existsSync(launcherPath) ? launcherPath : undefined,
      runnerPath: process.execPath,
      entryPath,
    }
  }

  const tsxPath = resolveExecutable('tsx')
  const sourceEntryPath = path.join(getWorkerAppRoot(), 'apps', 'worker', 'src', 'index.ts')
  if (tsxPath && existsSync(sourceEntryPath)) {
    return {
      launcherPath: existsSync(launcherPath) ? launcherPath : undefined,
      runnerPath: tsxPath,
      entryPath: sourceEntryPath,
    }
  }

  return {
    launcherPath: existsSync(launcherPath) ? launcherPath : undefined,
    runnerPath: undefined,
    entryPath: undefined,
  }
}

export const buildAgentRuntimeWorkerCommandEnvironment = () => {
  const commandPaths = resolveWorkerCommandPaths()
  return {
    ...(commandPaths.launcherPath ? { WEMUX_WORKER_LAUNCHER: commandPaths.launcherPath } : {}),
    ...(commandPaths.runnerPath ? { WEMUX_WORKER_RUNNER: commandPaths.runnerPath } : {}),
    ...(commandPaths.entryPath ? { WEMUX_WORKER_ENTRY: commandPaths.entryPath } : {}),
  } satisfies Record<string, string>
}

export const buildAgentRuntimeEnvironment = () => {
  return {
    ...process.env,
    ...buildAgentRuntimeWorkerCommandEnvironment(),
  } satisfies NodeJS.ProcessEnv
}
