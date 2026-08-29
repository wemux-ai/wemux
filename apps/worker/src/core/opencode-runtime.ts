// [INPUT]: OpenCode 运行时输入
// [OUTPUT]: 就绪检测
// [POS]: OpenCode 运行时
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import path from 'node:path'
import { getWorkerAppRoot, getWorkerNpmInstallPrefix } from './app-root'
import { resolveExecutable } from './command-utils'

const getOpencodeBinaryName = () => {
  return process.platform === 'win32' ? 'opencode.exe' : 'opencode'
}

const pushUnique = (items: string[], item: string) => {
  if (!items.includes(item)) {
    items.push(item)
  }
}

const addNodeModuleCandidates = (candidates: string[], root: string) => {
  if (!root) {
    return
  }

  pushUnique(candidates, path.join(root, 'node_modules', '.bin', 'opencode'))
  pushUnique(candidates, path.join(root, 'node_modules', 'opencode-ai', 'bin', getOpencodeBinaryName()))
}

export const buildPackagedOpencodeCandidates = (workspaceRoot: string) => {
  const candidates: string[] = []
  const workerAppRoot = getWorkerAppRoot()
  const workerNpmPrefix = getWorkerNpmInstallPrefix()

  addNodeModuleCandidates(candidates, workspaceRoot)
  addNodeModuleCandidates(candidates, workerAppRoot)
  addNodeModuleCandidates(candidates, workerNpmPrefix)

  return candidates
}

export const resolvePackagedOpencodeExecutable = (workspaceRoot: string) => {
  return buildPackagedOpencodeCandidates(workspaceRoot)
    .map((candidate) => resolveExecutable(candidate))
    .find(Boolean) || null
}

export const resolveOpencodeExecutable = (workspaceRoot = process.cwd()) => {
  return resolveExecutable('opencode') || resolvePackagedOpencodeExecutable(workspaceRoot)
}
