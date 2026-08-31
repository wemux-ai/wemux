// [INPUT]: PAT 输入
// [OUTPUT]: 校验/脱敏
// [POS]: Git PAT 契约
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import type { GitProvider, PatVerificationResult } from './types'

type PatProvider = Extract<GitProvider, 'github' | 'gitlab'>

type CandidateResult = {
  ok: boolean
  account?: string
  scopes?: string
  unauthorized?: boolean
  message: string
}

const REQUEST_TIMEOUT_MS = 8000

export const detectPatProvider = (token: string): PatProvider | null => {
  if (token.startsWith('glpat-')) {
    return 'gitlab'
  }

  if (token.startsWith('ghp_') || token.startsWith('github_pat_') || token.startsWith('gho_') || token.startsWith('ghu_') || token.startsWith('ghs_') || token.startsWith('ghr_')) {
    return 'github'
  }

  return null
}

const createSignal = () => AbortSignal.timeout(REQUEST_TIMEOUT_MS)

export const normalizeGitHost = (host?: string) => {
  const trimmed = host?.trim().toLowerCase() || ''
  if (!trimmed) {
    return ''
  }

  const scpLikeHost = trimmed.includes('://')
    ? undefined
    : /^[^@/]+@([^:/?#]+):/i.exec(trimmed)?.[1]
  if (scpLikeHost) {
    return scpLikeHost
  }

  try {
    const parsed = new URL(/^[a-z][a-z\d+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`)
    return parsed.host
  } catch {
    return trimmed.replace(/^https?:\/\//, '').split(/[/?#]/)[0].replace(/\/+$/, '')
  }
}

const resolveGitHubApiUrl = (host?: string) => {
  const normalizedHost = normalizeGitHost(host)
  if (!normalizedHost || normalizedHost === 'github.com') {
    return 'https://api.github.com/user'
  }

  return `https://${normalizedHost}/api/v3/user`
}

const resolveGitLabApiUrl = (host?: string) => {
  const normalizedHost = normalizeGitHost(host)
  return `https://${normalizedHost || 'gitlab.com'}/api/v4/user`
}

const verifyGitHubPat = async (token: string, host?: string): Promise<CandidateResult> => {
  try {
    const response = await fetch(resolveGitHubApiUrl(host), {
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'User-Agent': 'vibemux-pat-check',
      },
      signal: createSignal(),
    })

    if (response.status === 401) {
      return { ok: false, unauthorized: true, message: 'GitHub 返回 401，token 不可用。' }
    }

    if (!response.ok) {
      return { ok: false, message: `GitHub 校验失败（HTTP ${response.status}）。` }
    }

    const data = await response.json() as { login?: string }
    return {
      ok: true,
      account: data.login || 'unknown',
      scopes: response.headers.get('x-oauth-scopes') || undefined,
      message: 'GitHub PAT 可用。',
    }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : 'GitHub 校验失败。' }
  }
}

const verifyGitLabPat = async (token: string, host?: string): Promise<CandidateResult> => {
  try {
    const response = await fetch(resolveGitLabApiUrl(host), {
      headers: {
        'PRIVATE-TOKEN': token,
        'User-Agent': 'wemux-pat-check',
      },
      signal: createSignal(),
    })

    if (response.status === 401) {
      return { ok: false, unauthorized: true, message: 'GitLab 返回 401，token 不可用。' }
    }

    if (!response.ok) {
      return { ok: false, message: `GitLab 校验失败（HTTP ${response.status}）。` }
    }

    const data = await response.json() as { username?: string; name?: string }
    return {
      ok: true,
      account: data.username || data.name || 'unknown',
      message: 'GitLab PAT 可用。',
    }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : 'GitLab 校验失败。' }
  }
}

export const verifyPatTokenViaApi = async (
  token: string,
  expectedProvider?: PatProvider,
  host?: string,
): Promise<PatVerificationResult> => {
  const trimmedToken = token.trim()
  if (!trimmedToken) {
    return { ok: false, message: 'PAT 不能为空。' }
  }

  const detectedProvider = detectPatProvider(trimmedToken)
  const providers: PatProvider[] = expectedProvider
    ? [expectedProvider]
    : detectedProvider
      ? [detectedProvider]
      : ['github', 'gitlab']

  for (const provider of providers) {
    const result = provider === 'github'
      ? await verifyGitHubPat(trimmedToken, host)
      : await verifyGitLabPat(trimmedToken, host)

    if (result.ok) {
      const scopeText = provider === 'github' && result.scopes ? `，scopes：${result.scopes}` : ''
      const permissionHint = provider === 'github'
        ? '。提示：此处仅验证 token 本身；访问私有仓库还需要该 token 被授予目标仓库读取权限'
        : ''
      return {
        ok: true,
        provider,
        account: result.account,
        message: `${provider === 'github' ? 'GitHub' : 'GitLab'} 校验通过，当前账号 ${result.account}${scopeText}${permissionHint}。`,
      }
    }

    if (!result.unauthorized || detectedProvider) {
      return {
        ok: false,
        provider,
        message: result.message,
      }
    }
  }

  return { ok: false, message: '未识别 PAT 对应平台，或 token 已失效。' }
}

export type { PatProvider }
