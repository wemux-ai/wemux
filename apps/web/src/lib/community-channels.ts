// [INPUT]: 公开接口 /api/site/community-channels + 环境变量社区渠道默认值
// [OUTPUT]: useCommunityChannels() hook / loadCommunityChannels()
// [POS]: 社区渠道（Telegram / 飞书 / 微信群二维码）前端读取；admin 保存后需 clearCommunityChannelsCache()
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import { useEffect, useState } from 'react'
import { getCommunityChannels, resolveApiUrl } from './runtime-config'

export type CommunityChannels = ReturnType<typeof getCommunityChannels>
export type RemoteCommunityChannels = Partial<CommunityChannels>

/**
 * 合并远端（admin 配置）与本地环境变量默认值：
 * - 远端显式返回的字段（即使是空串 = 管理员已清空/隐藏）优先；
 * - 远端未返回的字段回退到 env 默认值（本地开发无 DB 配置时仍可展示）。
 */
const mergeCommunityChannels = (remote: RemoteCommunityChannels | null): CommunityChannels => {
  const env = getCommunityChannels()
  const pick = (key: keyof CommunityChannels) => (
    remote && key in remote ? (remote[key] ?? '') : env[key]
  )
  return {
    feishuUrl: pick('feishuUrl'),
    telegramUrl: pick('telegramUrl'),
    wechatQrUrl: pick('wechatQrUrl'),
  }
}

let cachedChannels: CommunityChannels | null = null
let inflightPromise: Promise<CommunityChannels> | null = null

export const loadCommunityChannels = (): Promise<CommunityChannels> => {
  if (cachedChannels) {
    return Promise.resolve(cachedChannels)
  }
  inflightPromise ??= fetch(resolveApiUrl('/api/site/community-channels'), {
    headers: { Accept: 'application/json' },
  })
    .then((response) => {
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`)
      }
      return response.json() as Promise<{ channels?: RemoteCommunityChannels }>
    })
    .then((payload) => {
      cachedChannels = mergeCommunityChannels(payload?.channels ?? null)
      return cachedChannels
    })
    .catch(() => {
      cachedChannels = mergeCommunityChannels(null)
      return cachedChannels
    })

  return inflightPromise
}

/** admin 保存配置后调用，让下次读取立即拿到新值（本标签页内）。 */
export const clearCommunityChannelsCache = () => {
  cachedChannels = null
  inflightPromise = null
}

/** 组件内读取社区渠道：首帧用 env 默认值，随后被 server 配置覆盖。 */
export const useCommunityChannels = (): CommunityChannels => {
  const [channels, setChannels] = useState<CommunityChannels>(() => mergeCommunityChannels(null))

  useEffect(() => {
    let mounted = true
    void loadCommunityChannels().then((next) => {
      if (mounted) {
        setChannels(next)
      }
    })
    return () => {
      mounted = false
    }
  }, [])

  return channels
}
