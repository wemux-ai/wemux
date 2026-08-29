// [INPUT]: 公网 IP 探测输入
// [OUTPUT]: IP 输出
// [POS]: 公网 IP 探测
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

const PUBLIC_IP_ENDPOINTS = [
  'https://api.ipify.org?format=json',
  'https://checkip.amazonaws.com/',
]

let cachedPublicIp = ''
let cachedAt = 0
const CACHE_TTL_MS = 5 * 60_000

const normalizeIp = (value: string) => value.trim().replace(/\s+/g, '')

const isLikelyIp = (value: string) => /^[0-9a-fA-F:.]+$/.test(value)

export const detectPublicIp = async () => {
  if (cachedPublicIp && (Date.now() - cachedAt) < CACHE_TTL_MS) {
    return cachedPublicIp
  }

  for (const endpoint of PUBLIC_IP_ENDPOINTS) {
    try {
      const response = await fetch(endpoint, { method: 'GET' })
      if (!response.ok) {
        continue
      }
      const contentType = response.headers.get('content-type') || ''
      const raw = contentType.includes('application/json')
        ? String((await response.json() as { ip?: string }).ip || '')
        : await response.text()
      const normalized = normalizeIp(raw)
      if (!normalized || !isLikelyIp(normalized)) {
        continue
      }
      cachedPublicIp = normalized
      cachedAt = Date.now()
      return cachedPublicIp
    } catch {
      // Try the next endpoint.
    }
  }

  return ''
}
