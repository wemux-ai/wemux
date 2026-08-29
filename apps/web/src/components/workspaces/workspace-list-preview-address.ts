import type { WorkspacePreviewSourceSummary, WorkspacePreviewSummary } from '@shared/types'

// 列表场景算"实际访问地址"。与详情页不同,列表页不跑 transport probe,因此:
//   - 默认显示 preview session 的远端地址(隧道域名/公网预览域名),因为它由 accessMode
//     持久化、确定可达,且与"当前预览方式"一致。
//   - 不擅自降级为 local-direct/public-direct:那两者是浏览器侧优化,详情页 probe 确认可达
//     后才采用;列表页没 probe,不能把"未验证的本地直连"当成确定结果显示 127.0.0.1。
// 这样:隧道域名预览 → 地址栏显示隧道域名;公网预览域名 → 显示公网预览域名。

export type ListPreviewTransport = 'gateway' | 'tunnel'

export type ResolvedListPreviewAddress = {
  // 实际访问地址(像浏览器地址栏):隧道域名或公网预览域名
  url: string
  appUrl: string
  // 显示用 host(去 scheme)
  host: string
  port?: number
  note?: string
  transport: ListPreviewTransport
  transportLabel: string
}

const TRANSPORT_LABELS: Record<ListPreviewTransport, string> = {
  'gateway': '公网预览域名',
  'tunnel': '隧道预览域名',
}

const hostnameFromUrl = (url: string) => {
  try {
    return new URL(url).hostname
  } catch {
    return url
  }
}

export const resolveListPreviewAddress = (params: {
  source: WorkspacePreviewSourceSummary
  remoteTransport: WorkspacePreviewSummary['remoteTransport']
}): ResolvedListPreviewAddress => {
  const { source, remoteTransport } = params

  // 远端地址:隧道域名(tunnel)或公网预览域名(gateway),该端口独立的 publicUrl。
  return {
    url: source.publicUrl,
    appUrl: source.appUrl,
    host: hostnameFromUrl(source.publicUrl),
    port: source.port,
    note: source.note,
    transport: remoteTransport,
    transportLabel: TRANSPORT_LABELS[remoteTransport],
  }
}


