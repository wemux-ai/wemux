// [INPUT]: App 请求（安装/回调/身份）
// [OUTPUT]: App 服务结果
// [POS]: GitHub App 服务
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import { createSign } from 'node:crypto'

const REQUEST_TIMEOUT_MS = 10000

type GitHubAppConfig = {
  appId: string
  appSlug: string
  privateKey: string
  apiBaseUrl: string
  webBaseUrl: string
}

type GitHubInstallationPayload = {
  id: number
  account?: {
    id?: number
    login?: string
    type?: string
  } | null
  repository_selection?: string
  permissions?: Record<string, string>
  suspended_at?: string | null
}

type GitHubInstallationTokenPayload = {
  token?: string
  expires_at?: string
  permissions?: Record<string, string>
  repository_selection?: string
}

type GitHubOAuthTokenPayload = {
  access_token?: string
  token_type?: string
  scope?: string
  expires_in?: number
  refresh_token?: string
  refresh_token_expires_in?: number
}

type GitHubUserInstallationPayload = {
  id?: number
  account?: {
    id?: number
    login?: string
    type?: string
  } | null
  repository_selection?: string
  permissions?: Record<string, string>
  suspended_at?: string | null
}

type GitHubUserInstallationsPayload = {
  total_count?: number
  installations?: GitHubUserInstallationPayload[]
}

type GitHubRepositoryPayload = {
  id?: number
  name?: string
  full_name?: string
  private?: boolean
  archived?: boolean
  disabled?: boolean
  fork?: boolean
  default_branch?: string
  html_url?: string
  clone_url?: string
  ssh_url?: string
  owner?: {
    login?: string
  } | null
}

type GitHubInstallationRepositoriesPayload = {
  repositories?: GitHubRepositoryPayload[]
}

export type GitHubAppRepositorySummary = {
  id: number
  name: string
  fullName: string
  ownerLogin: string
  private: boolean
  archived: boolean
  disabled: boolean
  fork: boolean
  defaultBranch?: string
  htmlUrl?: string
  cloneUrl: string
  sshUrl?: string
}

export type GitHubAppUserRepositorySummary = GitHubAppRepositorySummary & {
  installationId: number
}

type GitHubAppUserInstallation = {
  installationId: number
  accountId?: number
  accountLogin: string
  accountType: 'User' | 'Organization'
  repositorySelection: 'all' | 'selected'
  permissions: Record<string, string>
  suspendedAt?: string
}

const trimTrailingSlash = (value: string) => value.replace(/\/+$/g, '')

const normalizePrivateKey = (value: string) => value.trim().replace(/\\n/g, '\n')

const base64UrlJson = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url')

const resolveGitHubAppConfig = (): GitHubAppConfig | null => {
  const appId = process.env.GITHUB_APP_ID?.trim() || process.env.VIBEMUX_GITHUB_APP_ID?.trim() || ''
  const appSlug = process.env.GITHUB_APP_SLUG?.trim() || process.env.VIBEMUX_GITHUB_APP_SLUG?.trim() || ''
  const privateKey = process.env.GITHUB_APP_PRIVATE_KEY?.trim() || process.env.VIBEMUX_GITHUB_APP_PRIVATE_KEY?.trim() || ''
  if (!appId || !appSlug || !privateKey) {
    return null
  }

  const apiBaseUrl = trimTrailingSlash(
    process.env.GITHUB_APP_API_BASE_URL?.trim()
      || process.env.VIBEMUX_GITHUB_APP_API_BASE_URL?.trim()
      || 'https://api.github.com',
  )
  const webBaseUrl = trimTrailingSlash(
    process.env.GITHUB_APP_WEB_BASE_URL?.trim()
      || process.env.VIBEMUX_GITHUB_APP_WEB_BASE_URL?.trim()
      || 'https://github.com',
  )

  return {
    appId,
    appSlug,
    privateKey: normalizePrivateKey(privateKey),
    apiBaseUrl,
    webBaseUrl,
  }
}

export const getGitHubAppConnectionStatus = () => {
  const config = resolveGitHubAppConfig()
  return {
    configured: Boolean(config),
    appSlug: config?.appSlug,
  }
}

const resolveGitHubAppOAuthConfig = () => {
  const clientId = process.env.GITHUB_APP_CLIENT_ID?.trim() || process.env.VIBEMUX_GITHUB_APP_CLIENT_ID?.trim() || ''
  const clientSecret = process.env.GITHUB_APP_CLIENT_SECRET?.trim() || process.env.VIBEMUX_GITHUB_APP_CLIENT_SECRET?.trim() || ''
  if (!clientId || !clientSecret) {
    return null
  }

  return {
    clientId,
    clientSecret,
    callbackUrl: process.env.GITHUB_APP_CALLBACK_URL?.trim() || process.env.VIBEMUX_GITHUB_APP_CALLBACK_URL?.trim() || '',
    webBaseUrl: resolveGitHubAppConfig()?.webBaseUrl || 'https://github.com',
  }
}

export const getGitHubAppOAuthStatus = () => {
  const config = resolveGitHubAppOAuthConfig()
  return {
    oauthConfigured: Boolean(config),
  }
}

export const buildGitHubAppOAuthAuthorizeUrl = (state: string) => {
  const config = resolveGitHubAppOAuthConfig()
  if (!config) {
    throw new Error('GitHub App OAuth 未配置。请设置 GITHUB_APP_CLIENT_ID 和 GITHUB_APP_CLIENT_SECRET。')
  }

  const url = new URL('/login/oauth/authorize', config.webBaseUrl)
  url.searchParams.set('client_id', config.clientId)
  url.searchParams.set('state', state)
  if (config.callbackUrl) {
    url.searchParams.set('redirect_uri', config.callbackUrl)
  }
  return url.toString()
}

export const exchangeGitHubAppOAuthCode = async (code: string) => {
  const config = resolveGitHubAppOAuthConfig()
  if (!config) {
    throw new Error('GitHub App OAuth 未配置。请设置 GITHUB_APP_CLIENT_ID 和 GITHUB_APP_CLIENT_SECRET。')
  }

  const body = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    code,
  })
  if (config.callbackUrl) {
    body.set('redirect_uri', config.callbackUrl)
  }

  const response = await fetch(`${config.webBaseUrl}/login/oauth/access_token`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': 'vibemux-github-app',
    },
    body,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
  const payload = await response.json().catch(() => ({})) as GitHubOAuthTokenPayload
  const accessToken = payload.access_token?.trim()
  if (!response.ok || !accessToken) {
    const detail = await response.text().catch(() => '')
    throw new Error(`GitHub App OAuth token 换取失败：${response.status}${detail ? ` ${detail.slice(0, 240)}` : ''}`)
  }

  return {
    accessToken,
    refreshToken: payload.refresh_token?.trim() || undefined,
    expiresAt: typeof payload.expires_in === 'number' && payload.expires_in > 0
      ? new Date(Date.now() + payload.expires_in * 1000).toISOString()
      : undefined,
  }
}

type GitHubAppCommitIdentityUser = {
  name?: string
  email?: string
} | null | undefined

export const resolveGitHubAppCommitIdentity = (user?: GitHubAppCommitIdentityUser) => {
  const userName = user?.name?.trim()
  const userEmail = user?.email?.trim()
  if (userName && userEmail) {
    return {
      name: userName,
      email: userEmail,
    }
  }

  const config = resolveGitHubAppConfig()
  if (!config) {
    throw new Error('GitHub App 未配置。请设置 GITHUB_APP_ID、GITHUB_APP_SLUG 和 GITHUB_APP_PRIVATE_KEY。')
  }

  const botLogin = process.env.GITHUB_APP_BOT_LOGIN?.trim()
    || process.env.VIBEMUX_GITHUB_APP_BOT_LOGIN?.trim()
    || `${config.appSlug}[bot]`
  const botEmail = process.env.GITHUB_APP_BOT_EMAIL?.trim()
    || process.env.VIBEMUX_GITHUB_APP_BOT_EMAIL?.trim()
    || `${botLogin}@users.noreply.github.com`
  return {
    name: botLogin,
    email: botEmail,
  }
}

export const resolveGitHubAppAgentCoAuthorIdentity = () => {
  const config = resolveGitHubAppConfig()
  if (!config) {
    return undefined
  }

  const botLogin = process.env.GITHUB_APP_BOT_LOGIN?.trim()
    || process.env.VIBEMUX_GITHUB_APP_BOT_LOGIN?.trim()
    || `${config.appSlug}[bot]`
  const botEmail = process.env.GITHUB_APP_BOT_EMAIL?.trim()
    || process.env.VIBEMUX_GITHUB_APP_BOT_EMAIL?.trim()
  if (!botLogin || !botEmail) {
    return undefined
  }

  return {
    name: botLogin,
    email: botEmail,
  }
}

export const buildGitHubAppInstallUrl = (state: string) => {
  const config = resolveGitHubAppConfig()
  if (!config) {
    throw new Error('GitHub App 未配置。请设置 GITHUB_APP_ID、GITHUB_APP_SLUG 和 GITHUB_APP_PRIVATE_KEY。')
  }

  const url = new URL(`/apps/${config.appSlug}/installations/new`, config.webBaseUrl)
  url.searchParams.set('state', state)
  return url.toString()
}

const createGitHubAppJwt = () => {
  const config = resolveGitHubAppConfig()
  if (!config) {
    throw new Error('GitHub App 未配置。请设置 GITHUB_APP_ID、GITHUB_APP_SLUG 和 GITHUB_APP_PRIVATE_KEY。')
  }

  const nowSeconds = Math.floor(Date.now() / 1000)
  const header = base64UrlJson({ alg: 'RS256', typ: 'JWT' })
  const payload = base64UrlJson({
    iat: nowSeconds - 60,
    exp: nowSeconds + 9 * 60,
    iss: config.appId,
  })
  const unsigned = `${header}.${payload}`
  const signature = createSign('RSA-SHA256').update(unsigned).sign(config.privateKey).toString('base64url')
  return `${unsigned}.${signature}`
}

const createHeaders = (token: string) => ({
  Accept: 'application/vnd.github+json',
  Authorization: `Bearer ${token}`,
  'User-Agent': 'vibemux-github-app',
  'X-GitHub-Api-Version': '2022-11-28',
})

const fetchGitHubAppJson = async <T>(path: string, init?: RequestInit): Promise<T> => {
  const config = resolveGitHubAppConfig()
  if (!config) {
    throw new Error('GitHub App 未配置。请设置 GITHUB_APP_ID、GITHUB_APP_SLUG 和 GITHUB_APP_PRIVATE_KEY。')
  }

  const response = await fetch(`${config.apiBaseUrl}${path}`, {
    ...init,
    headers: {
      ...createHeaders(createGitHubAppJwt()),
      ...init?.headers,
    },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    throw new Error(`GitHub App API 请求失败：${response.status}${detail ? ` ${detail.slice(0, 240)}` : ''}`)
  }
  return await response.json() as T
}

const fetchGitHubInstallationJson = async <T>(path: string, installationToken: string, init?: RequestInit): Promise<T> => {
  const config = resolveGitHubAppConfig()
  if (!config) {
    throw new Error('GitHub App 未配置。请设置 GITHUB_APP_ID、GITHUB_APP_SLUG 和 GITHUB_APP_PRIVATE_KEY。')
  }

  const response = await fetch(`${config.apiBaseUrl}${path}`, {
    ...init,
    headers: {
      ...createHeaders(installationToken),
      ...init?.headers,
    },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    throw new Error(`GitHub installation API 请求失败：${response.status}${detail ? ` ${detail.slice(0, 240)}` : ''}`)
  }
  return await response.json() as T
}

const toRepositorySummary = (repo: GitHubRepositoryPayload): GitHubAppRepositorySummary | null => {
  const id = repo.id
  const fullName = repo.full_name?.trim()
  const name = repo.name?.trim()
  const cloneUrl = repo.clone_url?.trim()
  if (!id || !fullName || !name || !cloneUrl) {
    return null
  }

  return {
    id,
    name,
    fullName,
    ownerLogin: repo.owner?.login?.trim() || fullName.split('/')[0] || '',
    private: Boolean(repo.private),
    archived: Boolean(repo.archived),
    disabled: Boolean(repo.disabled),
    fork: Boolean(repo.fork),
    defaultBranch: repo.default_branch?.trim() || undefined,
    htmlUrl: repo.html_url?.trim() || undefined,
    cloneUrl,
    sshUrl: repo.ssh_url?.trim() || undefined,
  }
}

export const fetchGitHubAppInstallation = async (installationId: number) => {
  const payload = await fetchGitHubAppJson<GitHubInstallationPayload>(`/app/installations/${installationId}`)
  const accountLogin = payload.account?.login?.trim()
  if (!accountLogin) {
    throw new Error('GitHub installation 缺少 account login。')
  }

  return {
    installationId: payload.id,
    accountId: payload.account?.id,
    accountLogin,
    accountType: payload.account?.type === 'User' ? 'User' : 'Organization',
    provider: 'github' as const,
    providerHost: 'github.com',
    repositorySelection: payload.repository_selection === 'all' ? 'all' : 'selected',
    permissions: payload.permissions ?? {},
    suspendedAt: payload.suspended_at ?? undefined,
  }
}

export const fetchGitHubAppInstallationRepositories = async (installationId: number): Promise<GitHubAppRepositorySummary[]> => {
  const accessToken = await createGitHubAppInstallationAccessToken(installationId)
  const repositories: GitHubAppRepositorySummary[] = []
  const perPage = 100
  const maxPages = 10

  for (let page = 1; page <= maxPages; page += 1) {
    const payload = await fetchGitHubInstallationJson<GitHubInstallationRepositoriesPayload>(
      `/installation/repositories?per_page=${perPage}&page=${page}`,
      accessToken.token,
    )
    const pageRepositories = payload.repositories ?? []
    repositories.push(...pageRepositories.map(toRepositorySummary).filter((repo): repo is GitHubAppRepositorySummary => Boolean(repo)))
    if (pageRepositories.length < perPage) {
      break
    }
  }

  return repositories.sort((a, b) => a.fullName.localeCompare(b.fullName))
}

const fetchGitHubAppUserJson = async <T>(path: string, userAccessToken: string): Promise<T> => {
  const config = resolveGitHubAppConfig()
  if (!config) {
    throw new Error('GitHub App 未配置。请设置 GITHUB_APP_ID、GITHUB_APP_SLUG 和 GITHUB_APP_PRIVATE_KEY。')
  }

  const response = await fetch(`${config.apiBaseUrl}${path}`, {
    headers: createHeaders(userAccessToken),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    throw new Error(`GitHub user API 请求失败：${response.status}${detail ? ` ${detail.slice(0, 240)}` : ''}`)
  }
  return await response.json() as T
}

const toUserInstallationSummary = (installation: GitHubUserInstallationPayload): GitHubAppUserInstallation | null => {
  const installationId = installation.id
  const accountLogin = installation.account?.login?.trim()
  if (!installationId || !accountLogin) {
    return null
  }

  return {
    installationId,
    accountId: installation.account?.id,
    accountLogin,
    accountType: installation.account?.type === 'User' ? 'User' : 'Organization',
    repositorySelection: installation.repository_selection === 'all' ? 'all' : 'selected',
    permissions: installation.permissions ?? {},
    suspendedAt: installation.suspended_at ?? undefined,
  }
}

export const fetchGitHubAppUserInstallations = async (userAccessToken: string): Promise<GitHubAppUserInstallation[]> => {
  const installations: GitHubAppUserInstallation[] = []
  const perPage = 100
  const maxPages = 10

  for (let page = 1; page <= maxPages; page += 1) {
    const payload = await fetchGitHubAppUserJson<GitHubUserInstallationsPayload>(
      `/user/installations?per_page=${perPage}&page=${page}`,
      userAccessToken,
    )
    const pageInstallations = payload.installations ?? []
    installations.push(...pageInstallations.map(toUserInstallationSummary).filter((item): item is GitHubAppUserInstallation => Boolean(item)))
    if (pageInstallations.length < perPage) {
      break
    }
  }

  return installations
}

export const fetchGitHubAppUserInstallationRepositories = async (
  userAccessToken: string,
  installationId: number,
): Promise<GitHubAppRepositorySummary[]> => {
  const repositories: GitHubAppRepositorySummary[] = []
  const perPage = 100
  const maxPages = 10

  for (let page = 1; page <= maxPages; page += 1) {
    const payload = await fetchGitHubAppUserJson<GitHubInstallationRepositoriesPayload>(
      `/user/installations/${installationId}/repositories?per_page=${perPage}&page=${page}`,
      userAccessToken,
    )
    const pageRepositories = payload.repositories ?? []
    repositories.push(...pageRepositories.map(toRepositorySummary).filter((repo): repo is GitHubAppRepositorySummary => Boolean(repo)))
    if (pageRepositories.length < perPage) {
      break
    }
  }

  return repositories.sort((a, b) => a.fullName.localeCompare(b.fullName))
}

export const isGitHubAppUserInstallationAccessible = async (userAccessToken: string, installationId: number) => {
  const installations = await fetchGitHubAppUserInstallations(userAccessToken)
  return installations.some((installation) => installation.installationId === installationId)
}

export const fetchGitHubAppUserRepositories = async (userAccessToken: string): Promise<GitHubAppUserRepositorySummary[]> => {
  const installations = await fetchGitHubAppUserInstallations(userAccessToken)
  const seen = new Set<number>()
  const repositories: GitHubAppUserRepositorySummary[] = []

  for (const installation of installations) {
    let installationRepositories: GitHubAppRepositorySummary[]
    try {
      installationRepositories = await fetchGitHubAppUserInstallationRepositories(userAccessToken, installation.installationId)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.warn(`[github-app] skip installation ${installation.installationId} while aggregating user repositories: ${message}`)
      continue
    }
    for (const repository of installationRepositories) {
      if (seen.has(repository.id)) {
        continue
      }
      seen.add(repository.id)
      repositories.push({ ...repository, installationId: installation.installationId })
    }
  }

  return repositories.sort((a, b) => a.fullName.localeCompare(b.fullName))
}

export const createGitHubAppInstallationAccessToken = async (installationId: number) => {
  const payload = await fetchGitHubAppJson<GitHubInstallationTokenPayload>(
    `/app/installations/${installationId}/access_tokens`,
    { method: 'POST' },
  )
  if (!payload.token?.trim()) {
    throw new Error('GitHub installation access token 响应为空。')
  }

  return {
    token: payload.token.trim(),
    expiresAt: payload.expires_at,
    permissions: payload.permissions ?? {},
    repositorySelection: payload.repository_selection === 'all' ? 'all' : 'selected',
  }
}
