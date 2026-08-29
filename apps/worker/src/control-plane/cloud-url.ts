// [INPUT]: 云端 URL 输入
// [OUTPUT]: URL 解析
// [POS]: 云端 URL 解析
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

export const trimTrailingSlash = (value: string) => value.replace(/\/+$/, '')

const normalizeHostname = (value: string) => value.trim().toLowerCase()

const isLocalPreviewHostname = (hostname: string) => {
  const normalized = normalizeHostname(hostname)
  return normalized.endsWith('.localtest.me')
}

const isLoopbackHostname = (hostname: string) => {
  const normalized = normalizeHostname(hostname).replace(/^\[|\]$/g, '')
  return normalized === 'localhost' || normalized === '127.0.0.1' || normalized === '::1'
}

const isDockerServiceHostname = (hostname: string) => {
  const normalized = normalizeHostname(hostname)
  return Boolean(normalized && !normalized.includes('.') && !normalized.includes(':'))
}

const shouldPreferWorkerCloudUrl = (params: {
  candidateHostname: string
  fallbackHostname: string
}) => {
  const candidateHostname = normalizeHostname(params.candidateHostname)
  const fallbackHostname = normalizeHostname(params.fallbackHostname)
  if (!candidateHostname || candidateHostname === fallbackHostname) {
    return false
  }

  // In hybrid/docker dev, these names often describe where the server can reach
  // itself, not where the worker can reach the control plane.
  if (isLocalPreviewHostname(candidateHostname) && !isLocalPreviewHostname(fallbackHostname)) {
    return true
  }

  if (isDockerServiceHostname(candidateHostname)) {
    return true
  }

  if (isLoopbackHostname(candidateHostname) && !isLoopbackHostname(fallbackHostname)) {
    return true
  }

  return false
}

export const toExecutorWsUrl = (cloudUrl: string) => {
  const base = trimTrailingSlash(cloudUrl)
  if (base.startsWith('https://')) {
    return `${base.replace('https://', 'wss://')}/api/control-plane/executors/ws`
  }

  if (base.startsWith('http://')) {
    return `${base.replace('http://', 'ws://')}/api/control-plane/executors/ws`
  }

  return `${base}/api/control-plane/executors/ws`
}

export const toPreviewTunnelWsUrl = (cloudUrl: string) => {
  const base = trimTrailingSlash(cloudUrl)
  if (base.startsWith('https://')) {
    return `${base.replace('https://', 'wss://')}/api/preview-tunnels/ws`
  }

  if (base.startsWith('http://')) {
    return `${base.replace('http://', 'ws://')}/api/preview-tunnels/ws`
  }

  return `${base}/api/preview-tunnels/ws`
}

export const resolvePreviewTunnelWsUrl = (params: {
  cloudUrl: string
  tunnelUrl?: string | null
}) => {
  const fallbackUrl = toPreviewTunnelWsUrl(params.cloudUrl)
  const candidateUrl = params.tunnelUrl?.trim()
  if (!candidateUrl) {
    return fallbackUrl
  }

  try {
    const candidate = new URL(candidateUrl)
    const fallback = new URL(fallbackUrl)
    const candidateHost = normalizeHostname(candidate.hostname)
    const fallbackHost = normalizeHostname(fallback.hostname)

    if (shouldPreferWorkerCloudUrl({
      candidateHostname: candidateHost,
      fallbackHostname: fallbackHost,
    })) {
      return fallbackUrl
    }
  } catch {
    return fallbackUrl
  }

  return candidateUrl
}
