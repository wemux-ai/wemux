// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
// [INPUT]: Worker 启动期域名可达性探测结果 + 默认 cloud URL。
// [OUTPUT]: 品牌迁移兼容窗口的默认 cloud URL：`wemux.ai/.xyz` 优先，不可达时回退 `vibemux.com/.xyz`。
// [POS]: Worker 默认连接地址解析；wemux 域名未上线期间保证新装 worker 仍可配对到旧控制面。

import { lookup } from 'node:dns/promises'

export const WEMUX_PRODUCTION_CLOUD_URL = 'https://wemux.ai'
export const LEGACY_PRODUCTION_CLOUD_URL = 'https://vibemux.com'
export const WEMUX_PREVIEW_CLOUD_URL = 'https://wemux.xyz'
export const LEGACY_PREVIEW_CLOUD_URL = 'https://vibemux.xyz'

type ReachabilityProbe = (url: string) => Promise<boolean>

const probeHostResolvable = async (url: string): Promise<boolean> => {
  try {
    await lookup(new URL(url).hostname, { verbatim: true })
    return true
  } catch {
    return false
  }
}

let probeImpl: ReachabilityProbe = probeHostResolvable
let cachedWemuxReachable: boolean | null = null

/** 测试注入：替换可达性探测实现。 */
export const __setReachabilityProbeForTest = (impl: ReachabilityProbe | null) => {
  probeImpl = impl ?? probeHostResolvable
  cachedWemuxReachable = null
}

/**
 * 启动期探测一次 wemux 主域名是否可达，结果缓存。
 * 在 worker main 早期调用；help/version 等快速路径可跳过。
 */
export const warmDefaultCloudUrlFallback = async (): Promise<boolean> => {
  if (cachedWemuxReachable !== null) {
    return cachedWemuxReachable
  }
  cachedWemuxReachable = await probeImpl(WEMUX_PRODUCTION_CLOUD_URL)
  return cachedWemuxReachable
}

/**
 * 对默认 cloud URL 应用回退：仅当探测已执行且 wemux 不可达时，
 * 把 wemux.ai / wemux.xyz 默认值映射回 vibemux.com / vibemux.xyz。
 * 显式 env 覆盖与已保存配对不受影响（它们不经过此函数）。
 */
export const resolveDefaultCloudUrl = (candidate: string): string => {
  if (cachedWemuxReachable === false) {
    if (candidate === WEMUX_PRODUCTION_CLOUD_URL) {
      return LEGACY_PRODUCTION_CLOUD_URL
    }
    if (candidate === WEMUX_PREVIEW_CLOUD_URL) {
      return LEGACY_PREVIEW_CLOUD_URL
    }
  }
  return candidate
}
