// [INPUT]: EasyTier 端口输入
// [OUTPUT]: 端口规划
// [POS]: EasyTier 端口契约
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

export type EasyTierPortProfile = 'development' | 'preview' | 'production'

export type EasyTierPortDefaults = {
  publicTcpPort: number
  publicUdpPort: number
  publicWsPort: number
  publicWssPort: number
  rpcPortal: string
}

const DEFAULT_MESH_PROXY_PORT = 39080
const LOCAL_SERVER_PORT_MESH_PROXY_OFFSET = 9000
const MESH_PROXY_PORT_RANGE = 1000

const PORT_DEFAULTS: Record<EasyTierPortProfile, EasyTierPortDefaults> = {
  development: {
    publicTcpPort: 11030,
    publicUdpPort: 11030,
    publicWsPort: 11031,
    publicWssPort: 11032,
    rpcPortal: '127.0.0.1:15890',
  },
  preview: {
    publicTcpPort: 11010,
    publicUdpPort: 11010,
    publicWsPort: 11011,
    publicWssPort: 11012,
    rpcPortal: '127.0.0.1:15888',
  },
  production: {
    publicTcpPort: 11020,
    publicUdpPort: 11020,
    publicWsPort: 11021,
    publicWssPort: 11022,
    rpcPortal: '127.0.0.1:15889',
  },
}

const normalizeProfile = (value?: string): EasyTierPortProfile | undefined => {
  const normalized = value?.trim().toLowerCase()
  if (normalized === 'dev' || normalized === 'development' || normalized === 'local') {
    return 'development'
  }
  if (normalized === 'preview' || normalized === 'staging') {
    return 'preview'
  }
  if (normalized === 'prod' || normalized === 'production') {
    return 'production'
  }
  return undefined
}

export const resolveEasyTierPortProfile = (params: {
  explicitProfile?: string
  nodeEnv?: string
  releaseChannel?: string
  publicBaseUrl?: string
  cloudUrl?: string
} = {}): EasyTierPortProfile => {
  const explicit = normalizeProfile(params.explicitProfile)
  if (explicit) {
    return explicit
  }

  const releaseChannel = params.releaseChannel?.trim().toLowerCase()
  if (releaseChannel === 'preview') {
    return 'preview'
  }
  if (releaseChannel === 'production' || releaseChannel === 'latest') {
    return 'production'
  }

  const url = `${params.publicBaseUrl ?? ''} ${params.cloudUrl ?? ''}`.toLowerCase()
  // 兼容窗口：新旧域名都识别，后续可移除 vibemux 分支
  if (url.includes('vibemux.xyz') || url.includes('wemux.xyz')) {
    return 'preview'
  }
  if (url.includes('vibemux.com') || url.includes('wemux.ai')) {
    return 'production'
  }

  if (params.nodeEnv?.trim().toLowerCase() === 'development') {
    return 'development'
  }

  return 'production'
}

export const getEasyTierPortDefaults = (profile: EasyTierPortProfile): EasyTierPortDefaults => ({
  ...PORT_DEFAULTS[profile],
})

export const buildEasyTierListenUrls = (profile: EasyTierPortProfile) => {
  const ports = getEasyTierPortDefaults(profile)
  return [
    `tcp://0.0.0.0:${ports.publicTcpPort}`,
    `udp://0.0.0.0:${ports.publicUdpPort}`,
    `ws://0.0.0.0:${ports.publicWsPort}`,
    `wss://0.0.0.0:${ports.publicWssPort}`,
  ]
}

export const getEasyTierRpcPortal = (profile: EasyTierPortProfile) => {
  return getEasyTierPortDefaults(profile).rpcPortal
}

export const deriveMeshProxyPortFromLocalServerPort = (localServerPort?: number) => {
  if (typeof localServerPort === 'number' && Number.isInteger(localServerPort) && localServerPort > LOCAL_SERVER_PORT_MESH_PROXY_OFFSET && localServerPort <= 65535) {
    const derivedPort = localServerPort - LOCAL_SERVER_PORT_MESH_PROXY_OFFSET
    if (derivedPort > 0 && derivedPort <= 65535) {
      return derivedPort
    }
  }

  return DEFAULT_MESH_PROXY_PORT
}

export const deriveMeshProxyPortFromStableId = (stableId?: string) => {
  const normalized = stableId?.trim()
  if (!normalized) {
    return DEFAULT_MESH_PROXY_PORT
  }

  let hash = 0
  for (const character of normalized) {
    hash = ((hash * 31) + character.charCodeAt(0)) >>> 0
  }

  return DEFAULT_MESH_PROXY_PORT + (hash % MESH_PROXY_PORT_RANGE)
}
