// [INPUT]: PAT 输入
// [OUTPUT]: 校验结果
// [POS]: Git PAT 校验
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import { normalizeGitHost, verifyPatTokenViaApi, type PatProvider } from '@shared/git-pat'
import type { PatVerificationResult } from '@shared/types'

const DEFAULT_PROVIDER_HOSTS: Record<PatProvider, string> = {
  github: 'github.com',
  gitlab: 'gitlab.com',
}

const stripPort = (host: string) => {
  if (host.startsWith('[')) {
    const end = host.indexOf(']')
    return end > 0 ? host.slice(1, end) : ''
  }

  const colonCount = host.split(':').length - 1
  return colonCount === 1 ? host.split(':')[0] : host
}

const isPrivateIpv4 = (address: string) => {
  const parts = address.split('.').map((part) => Number(part))
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return true
  }

  const [a, b] = parts
  return a === 0
    || a === 10
    || a === 127
    || (a === 100 && b >= 64 && b <= 127)
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168)
    || (a === 198 && (b === 18 || b === 19))
    || a >= 224
}

const isPrivateIpv6 = (address: string) => {
  const normalized = address.toLowerCase()
  return normalized === '::'
    || normalized === '::1'
    || normalized.startsWith('fc')
    || normalized.startsWith('fd')
    || normalized.startsWith('fe80:')
    || normalized.startsWith('ff')
    || normalized.startsWith('::ffff:127.')
    || normalized.startsWith('::ffff:10.')
    || normalized.startsWith('::ffff:192.168.')
    || /^::ffff:172\.(1[6-9]|2\d|3[0-1])\./.test(normalized)
    || normalized.startsWith('::ffff:169.254.')
}

const isUnsafeAddress = (address: string) => {
  const version = isIP(address)
  if (version === 4) {
    return isPrivateIpv4(address)
  }
  if (version === 6) {
    return isPrivateIpv6(address)
  }

  return true
}

export const resolvePatVerificationHost = async (provider: PatProvider, host?: string) => {
  const normalizedHost = normalizeGitHost(host) || DEFAULT_PROVIDER_HOSTS[provider]
  const hostname = stripPort(normalizedHost)
  if (!hostname || hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local')) {
    return { ok: false as const, host: normalizedHost, message: '该 Host 不支持在线校验，请保存后在 Worker 侧实际测试。' }
  }

  if (isIP(hostname)) {
    return isUnsafeAddress(hostname)
      ? { ok: false as const, host: normalizedHost, message: '为防止 SSRF，内网/本机 IP 不支持在线校验，请保存后在 Worker 侧实际测试。' }
      : { ok: true as const, host: normalizedHost }
  }

  try {
    const addresses = await lookup(hostname, { all: true, verbatim: true })
    if (addresses.some((item) => isUnsafeAddress(item.address))) {
      return { ok: false as const, host: normalizedHost, message: '为防止 SSRF，解析到内网/本机地址的 Host 不支持在线校验，请保存后在 Worker 侧实际测试。' }
    }
  } catch {
    return { ok: false as const, host: normalizedHost, message: 'Host 无法解析，暂不能在线校验。' }
  }

  return { ok: true as const, host: normalizedHost }
}

export const verifyPatToken = async (token: string, provider: PatProvider, host?: string): Promise<PatVerificationResult> => {
  return verifyPatTokenViaApi(token, provider, host)
}
