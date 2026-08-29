// [INPUT]: Incoming request URL and Host header.
// [OUTPUT]: Canonical wemux URL for legacy vibemux domains, or null.
// [POS]: Control-plane host migration compatibility at the HTTP boundary.
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

const LEGACY_DOMAIN_TARGETS = [
  { source: 'vibemux.xyz', target: 'wemux.xyz' },
  { source: 'vibemux.com', target: 'wemux.ai' },
] as const

const normalizeHost = (host: string) => {
  const trimmedHost = host.trim().toLowerCase().replace(/\.$/, '')
  if (trimmedHost.startsWith('[')) {
    return trimmedHost.slice(1, trimmedHost.indexOf(']'))
  }

  return trimmedHost.split(':')[0] ?? ''
}

/**
 * Builds a canonical HTTPS URL while preserving path, query, and subdomain.
 * The host is matched against an explicit allowlist to avoid open redirects.
 */
export const resolveLegacyDomainRedirect = (requestUrl: string, hostHeader?: string) => {
  const request = new URL(requestUrl)
  const host = normalizeHost(hostHeader || request.hostname)

  for (const { source, target } of LEGACY_DOMAIN_TARGETS) {
    if (host !== source && !host.endsWith(`.${source}`)) {
      continue
    }

    const subdomain = host === source ? '' : host.slice(0, -(source.length + 1))
    request.protocol = 'https:'
    request.hostname = subdomain ? `${subdomain}.${target}` : target
    request.port = ''
    return request.toString()
  }

  return null
}
