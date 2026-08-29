// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
// [INPUT]: Node process environment + home directory 文件系统状态（仅 server / worker 使用；web 不得 import 本模块）。
// [OUTPUT]: worker / agent 主数据目录（home）的解析：新目录 `~/.wemux*` 优先，存量 `~/.vibemux*` 沿用。
// [POS]: 品牌迁移兼容层（Phase 3）。保证 worker 配置目录与 agent workdir 使用同一解析结果，避免两侧分叉。

import { existsSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export type WemuxHomeProfile = 'development' | 'preview' | 'production'

const HOME_SUFFIXES: Record<WemuxHomeProfile, string> = {
  development: '-dev',
  preview: '-preview',
  production: '',
}

const buildHomeCandidates = (profile: WemuxHomeProfile) => {
  const suffix = HOME_SUFFIXES[profile]
  return {
    wemuxHome: path.join(os.homedir(), `.wemux${suffix}`),
    legacyHome: path.join(os.homedir(), `.vibemux${suffix}`),
  }
}

/**
 * 兼容窗口：新目录 `~/.wemux*` 优先；存量 `~/.vibemux*` 目录沿用（避免丢失配对与配置）；
 * 两者都不存在时使用新目录（新装默认 wemux 品牌）。
 */
export const resolveWemuxHomeDir = (profile: WemuxHomeProfile = 'production'): string => {
  const { wemuxHome, legacyHome } = buildHomeCandidates(profile)
  if (existsSync(wemuxHome)) {
    return wemuxHome
  }
  if (existsSync(legacyHome)) {
    return legacyHome
  }
  return wemuxHome
}

export const isWemuxHomePath = (value?: string): boolean => {
  const normalized = path.resolve(value?.trim() || '')
  return Object.values(HOME_SUFFIXES).some((suffix) => {
    const wemuxHome = path.join(os.homedir(), `.wemux${suffix}`)
    const legacyHome = path.join(os.homedir(), `.vibemux${suffix}`)
    return normalized === wemuxHome || normalized === legacyHome
  })
}
