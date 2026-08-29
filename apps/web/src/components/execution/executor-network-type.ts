import type { ExecutorRecord } from '@shared/types'

const tr = (language: string, zh: string, en: string) => language === 'zh' ? zh : en

export type ExecutorNetworkType = 'internal' | 'public'

export const resolveExecutorNetworkType = (
  value: Pick<ExecutorRecord, 'previewExposureMode'> | ExecutorRecord['previewExposureMode'],
): ExecutorNetworkType => {
  const mode = typeof value === 'string'
    ? value
    : (value && typeof value === 'object' ? value.previewExposureMode : undefined)
  return mode === 'public-ingress' ? 'public' : 'internal'
}

export const getExecutorNetworkTypeLabel = (networkType: ExecutorNetworkType, language: string) => (
  networkType === 'public'
    ? tr(language, '公网节点', 'Public Node')
    : tr(language, '内网节点', 'Internal Node')
)

export const getExecutorNetworkTypeDescription = (networkType: ExecutorNetworkType, language: string) => (
  networkType === 'public'
    ? tr(
        language,
        '云服务器或固定公网 IP。',
        'Cloud hosts or stable public IPs.',
      )
    : tr(
        language,
        '本地电脑、家庭或办公室内网。',
        'Local or private-network machines.',
      )
)

export const getExecutorPreviewAccessLabel = (networkType: ExecutorNetworkType, language: string) => (
  networkType === 'public'
    ? tr(language, '公网回源', 'Public Ingress')
    : tr(language, '私有链路', 'Private Tunnel')
)

export const getExecutorPreviewAccessDescription = (networkType: ExecutorNetworkType, language: string) => (
  networkType === 'public'
    ? tr(
        language,
        '浏览器先访问 Wemux 预览域名，再由公网访问入口回源到这台节点的公网入口。',
        'Browser requests land on the Wemux preview domain first, then the public-access entry proxies back to the node public ingress.',
      )
    : tr(
        language,
        '预览继续走 Wemux 私有链路，不依赖节点公网入口。',
        'Preview traffic stays on the Wemux private tunnel path and does not depend on a node public ingress.',
      )
)

export const getExecutorNetworkTypeBadgeClassName = (networkType: ExecutorNetworkType) => (
  networkType === 'public'
    ? 'whitespace-nowrap border-amber-500/25 bg-amber-500/10 text-amber-200'
    : 'whitespace-nowrap border-emerald-500/25 bg-emerald-500/10 text-emerald-200'
)
