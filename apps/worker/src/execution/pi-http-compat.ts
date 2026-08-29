// [INPUT]: Pi SDK HTTP 请求头
// [OUTPUT]: 过滤后的兼容请求
// [POS]: Pi SDK HTTP 兼容层
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

const BLOCKED_OPENAI_SDK_HEADER_PREFIXES = ['x-stainless-']
const BLOCKED_OPENAI_SDK_HEADERS = new Set([
  'user-agent',
])
const DEFAULT_COMPAT_USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/125 Safari/537.36'

let installedFetch: typeof fetch | undefined
let originalFetch: typeof fetch | undefined
let installDepth = 0

const isBlockedOpenAiSdkHeader = (name: string) => {
  const normalizedName = name.toLowerCase()
  return BLOCKED_OPENAI_SDK_HEADERS.has(normalizedName)
    || BLOCKED_OPENAI_SDK_HEADER_PREFIXES.some((prefix) => normalizedName.startsWith(prefix))
}

export const sanitizePiOpenAiCompatibleHeaders = (headers: HeadersInit | undefined) => {
  const sanitized = new Headers(headers)
  const headerNames: string[] = []
  sanitized.forEach((_value, key) => {
    headerNames.push(key)
  })
  for (const key of headerNames) {
    if (isBlockedOpenAiSdkHeader(key)) {
      sanitized.delete(key)
    }
  }
  sanitized.set('User-Agent', DEFAULT_COMPAT_USER_AGENT)
  return sanitized
}

const isBlackAiUrl = (input: RequestInfo | URL) => {
  try {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input.toString() : input.url)
    return url.hostname.toLowerCase() === 'blackaicoding.com'
  } catch {
    return false
  }
}

const shouldSanitizeBlackAiRequest = (input: RequestInfo | URL, init?: RequestInit) => {
  if (isBlackAiUrl(input)) {
    return true
  }

  return input instanceof Request && isBlackAiUrl(input.url) && !init
}

const cloneRequestWithSanitizedHeaders = (input: Request) => {
  return new Request(input, {
    headers: sanitizePiOpenAiCompatibleHeaders(input.headers),
  })
}

const cloneInitWithSanitizedHeaders = (input: RequestInfo | URL, init?: RequestInit): RequestInit => {
  return {
    ...(init ?? {}),
    headers: sanitizePiOpenAiCompatibleHeaders(init?.headers ?? (input instanceof Request ? input.headers : undefined)),
  }
}

export const createPiFetchWithOpenAiCompatibleHeaderSanitizer = (baseFetch: typeof fetch = globalThis.fetch): typeof fetch => {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    if (!shouldSanitizeBlackAiRequest(input, init)) {
      return baseFetch(input, init)
    }

    if (input instanceof Request && !init) {
      return baseFetch(cloneRequestWithSanitizedHeaders(input))
    }

    return baseFetch(input, cloneInitWithSanitizedHeaders(input, init))
  }) as typeof fetch
}

export const installPiOpenAiCompatibleFetchPatch = () => {
  if (typeof globalThis.fetch !== 'function') {
    return () => undefined
  }

  if (installDepth === 0) {
    originalFetch = globalThis.fetch
    installedFetch = createPiFetchWithOpenAiCompatibleHeaderSanitizer(originalFetch)
    globalThis.fetch = installedFetch
  }
  installDepth += 1

  return () => {
    installDepth = Math.max(0, installDepth - 1)
    if (installDepth > 0) {
      return
    }

    if (installedFetch && originalFetch && globalThis.fetch === installedFetch) {
      globalThis.fetch = originalFetch
    }
    installedFetch = undefined
    originalFetch = undefined
  }
}
