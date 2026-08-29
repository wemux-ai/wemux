// [INPUT]: 当前部署目录中可选的商业扩展编译产物或 TypeScript 源入口
// [OUTPUT]: 已加载商业扩展时注册其路由/gate，公开版缺失扩展时保持空注册表
// [POS]: 核心启动与可选扩展的唯一运行时装配点。
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import { existsSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import path from 'node:path'

const builtExtensionEntry = path.resolve(process.cwd(), 'dist-server/apps/server/src/enterprise/index.js')
const sourceExtensionEntry = path.resolve(process.cwd(), 'apps/server/src/enterprise/index.ts')
const commercialExtensionCandidates = process.env.NODE_ENV === 'production'
  ? [builtExtensionEntry, sourceExtensionEntry]
  : [sourceExtensionEntry, builtExtensionEntry]

export const findCommercialServerExtensionEntry = (
  candidates = commercialExtensionCandidates,
  fileExists: (entry: string) => boolean = existsSync,
) => candidates.find(fileExists) ?? null

/** 加载可选商业扩展；公开核心没有私有目录时返回 false。 */
export const loadCommercialServerExtension = async (): Promise<boolean> => {
  // 显式禁用开关：不依赖文件系统状态即可强制以社区版启动（`pnpm dev:oss`）。
  if (process.env.WEMUX_EXTENSION_DISABLED === '1') {
    return false
  }
  const entry = findCommercialServerExtensionEntry()
  if (!entry) {
    return false
  }

  await import(pathToFileURL(entry).href)
  return true
}
