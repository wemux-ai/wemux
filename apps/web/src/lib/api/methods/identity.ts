import type { AgentConfig } from '@shared/types'
import type {
  AdminAuditResponse,
  PersonalAccessTokenCreateResponse,
  PersonalAccessTokenListResponse,
  ApiResponse,
  AuthUser,
  DevLoginAccountsResponse,
  DevLoginResponse,
  GitCredentialCreatePayload,
  GitCredentialSummary,
  GitCredentialUpdatePayload,
  GitHubAppConnectUrlResponse,
  GitHubAppInstallationsResponse,
  GitHubAppInstallationSummary,
  GitHubAppAuthorizeUrlResponse,
  GitHubAppRepositoriesResponse,
  GitHubAppUserRepositoriesResponse,
  GoogleLoginPrepareResponse,
  GitIdentityConfig,
  GitIdentityHealth,
  GitProvider,
  GoogleBridgeResponse,
  PasswordBridgeResponse,
  ProjectGitCredentialBindingResponse,
  UserGitPatVerification,
} from '../types'
import { authFetch, extractErrorMessage, request, resolveApiUrl } from '../client'
import { resolveBetterAuthUrl } from '../../runtime-config'

type BetterAuthSocialSignInResponse = {
  message?: string
  redirect?: boolean
  url?: string
}

export const identityMethods = {
  saveSettings: (payload: AgentConfig) => request<ApiResponse>('/api/settings', { method: 'PUT', body: JSON.stringify(payload) }),
  getGitIdentityConfig: () => request<{ config: GitIdentityConfig; health: GitIdentityHealth }>('/api/git-identities/config'),
  saveGitIdentityConfig: (payload: { personal: { name: string; email: string; token: string } }) =>
    request<{ ok: boolean; config: GitIdentityConfig; health: GitIdentityHealth; message?: string }>('/api/git-identities/config', { method: 'PUT', body: JSON.stringify(payload) }),
  listUserGitCredentials: () =>
    request<{ credentials: GitCredentialSummary[] }>('/api/user/git-credentials'),
  createUserGitCredential: (payload: GitCredentialCreatePayload) =>
    request<{ ok: boolean; credential: GitCredentialSummary | null; credentials: GitCredentialSummary[]; message: string }>('/api/user/git-credentials', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  updateUserGitCredential: (credentialId: string, payload: GitCredentialUpdatePayload) =>
    request<{ ok: boolean; credential: GitCredentialSummary | null; credentials: GitCredentialSummary[]; message: string }>(`/api/user/git-credentials/${credentialId}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),
  deleteUserGitCredential: (credentialId: string) =>
    request<{ ok: boolean; credentials: GitCredentialSummary[]; message: string }>(`/api/user/git-credentials/${credentialId}`, { method: 'DELETE' }),
  verifyUserGitCredentialPat: (payload: { provider: GitProvider; host: string; patToken: string }) =>
    request<UserGitPatVerification>('/api/user/git-credentials/verify', { method: 'POST', body: JSON.stringify(payload) }),
  generateUserGitCredentialSsh: (payload: { label: string; provider: GitProvider; host: string; name: string; email: string; isDefault?: boolean }) =>
    request<{ ok: boolean; credential: GitCredentialSummary | null; publicKey: string; fingerprint: string; credentials: GitCredentialSummary[]; message: string }>('/api/user/git-credentials/ssh/generate', {
      method: 'POST',
      body: JSON.stringify({ ...payload, authMode: 'ssh' }),
    }),
  verifyUserGitCredentialSsh: (credentialId: string) =>
    request<{ ok: boolean; credentials: GitCredentialSummary[]; message: string }>(`/api/user/git-credentials/${credentialId}/ssh/verify`, { method: 'POST' }),
  setUserGitCredentialDefault: (credentialId: string) =>
    request<{ ok: boolean; credential: GitCredentialSummary | null; credentials: GitCredentialSummary[]; message: string }>(`/api/user/git-credentials/${credentialId}/default`, { method: 'POST' }),
  listUserGitHubAppInstallations: () =>
    request<GitHubAppInstallationsResponse>('/api/user/github-app-installations'),
  listUserGitHubAppInstallationRepositories: (installationId: number) =>
    request<GitHubAppRepositoriesResponse>(`/api/user/github-app-installations/${installationId}/repositories`),
  listUserGitHubAppRepositories: () =>
    request<GitHubAppUserRepositoriesResponse>('/api/user/github-app-installations/repositories'),
  createUserGitHubAppAuthorizeUrl: (returnTo: string) =>
    request<GitHubAppAuthorizeUrlResponse>(`/api/user/github-app-installations/authorize-url?returnTo=${encodeURIComponent(returnTo)}`),
  createUserGitHubAppConnectUrl: (returnTo: string, payload: { commitAuthorName: string; commitAuthorEmail: string }) =>
    request<GitHubAppConnectUrlResponse>(
      `/api/user/github-app-installations/connect-url?returnTo=${encodeURIComponent(returnTo)}&commitAuthorName=${encodeURIComponent(payload.commitAuthorName)}&commitAuthorEmail=${encodeURIComponent(payload.commitAuthorEmail)}`,
    ),
  updateUserGitHubAppCommitIdentity: (installationId: number, payload: { name: string; email: string }) =>
    request<{ ok: boolean; installation: GitHubAppInstallationSummary; installations: GitHubAppInstallationSummary[]; message: string }>(
      `/api/user/github-app-installations/${installationId}/commit-identity`,
      { method: 'PUT', body: JSON.stringify(payload) },
    ),
  deleteUserGitHubAppInstallation: (installationId: number) =>
    request<{ ok: boolean; installations: GitHubAppInstallationSummary[]; message: string }>(`/api/user/github-app-installations/${installationId}`, {
      method: 'DELETE',
    }),
  getProjectGitCredentialBinding: (projectId: string) =>
    request<ProjectGitCredentialBindingResponse>(`/api/projects/${projectId}/git-credential-binding`),
  saveProjectGitCredentialBinding: (
    projectId: string,
    payload: {
      credentialId?: string
      githubInstallationId?: number
      githubRepositoryId?: number
      githubRepositoryName?: string
    },
  ) =>
    request<ProjectGitCredentialBindingResponse & { ok: boolean; message: string }>(`/api/projects/${projectId}/git-credential-binding`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),
  deleteProjectGitCredentialBinding: (projectId: string) =>
    request<ProjectGitCredentialBindingResponse & { ok: boolean; message: string }>(`/api/projects/${projectId}/git-credential-binding`, { method: 'DELETE' }),
  logout: () => request<{ ok: boolean }>('/api/auth/logout', { method: 'POST' }),
  listAuthAccounts: () => request<{ accounts: string[]; email: string; emailVerified: boolean }>('/api/auth/account/accounts'),
  linkEmailAccount: (payload: { password: string; currentPassword?: string }) =>
    request<{ ok: boolean; action: 'bound' | 'updated' }>('/api/auth/account/link-email', { method: 'POST', body: JSON.stringify(payload) }),
  unlinkEmailAccount: () => request<{ ok: boolean }>('/api/auth/account/unlink-email', { method: 'POST' }),
  listDevLoginAccounts: () => request<DevLoginAccountsResponse>('/api/auth/dev/accounts'),
  loginWithDevAccount: (accountId: string) => request<DevLoginResponse>('/api/auth/dev/login', {
    method: 'POST',
    body: JSON.stringify({ accountId }),
  }),
  prepareGoogleLogin: async (turnstileToken: string) => {
    const response = await fetch(resolveApiUrl('/api/auth/google/prepare'), {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ turnstileToken }),
    })

    const contentType = response.headers.get('content-type') ?? ''
    const payload = contentType.includes('application/json')
      ? await response.json() as GoogleLoginPrepareResponse
      : { message: await response.text(), ok: false } satisfies GoogleLoginPrepareResponse

    if (!response.ok) {
      throw new Error(payload.message || `Request failed: ${response.status}`)
    }

    return payload
  },
  bridgeGoogleSession: async () => {
    const response = await fetch(resolveApiUrl('/api/auth/google/bridge'), {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })

    const contentType = response.headers.get('content-type') ?? ''
    const payload = contentType.includes('application/json')
      ? await response.json() as GoogleBridgeResponse
      : { message: await response.text() } satisfies GoogleBridgeResponse

    if (!response.ok) {
      const error = new Error(payload.message || `Request failed: ${response.status}`) as Error & { payload?: GoogleBridgeResponse; status?: number }
      error.payload = payload
      error.status = response.status
      throw error
    }

    return payload
  },
  bridgePasswordSession: async () => {
    const response = await fetch(resolveApiUrl('/api/auth/password/bridge'), {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })

    const contentType = response.headers.get('content-type') ?? ''
    const payload = contentType.includes('application/json')
      ? await response.json() as PasswordBridgeResponse
      : { message: await response.text() } satisfies PasswordBridgeResponse

    if (!response.ok) {
      const error = new Error(payload.message || `Request failed: ${response.status}`) as Error & { payload?: PasswordBridgeResponse; status?: number }
      error.payload = payload
      error.status = response.status
      throw error
    }

    return payload
  },
  signInWithEmailPassword: async (payload: { email: string; password: string; callbackURL?: string }) => {
    // better-auth 1.6.7 端点名为 /sign-in/email（非 /sign-in/email-password）
    const response = await fetch(resolveBetterAuthUrl('/sign-in/email'), {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    if (!response.ok) {
      const contentType = response.headers.get('content-type') ?? ''
      const body = contentType.includes('application/json')
        ? await response.json() as { message?: string; code?: string }
        : { message: await response.text() }
      const error = new Error(body.message || `Request failed: ${response.status}`) as Error & { payload?: { message?: string; code?: string }; status?: number }
      error.payload = body
      error.status = response.status
      throw error
    }
    return response.json() as Promise<Record<string, unknown>>
  },
  signUpWithEmail: async (payload: { email: string; password: string; name?: string; callbackURL?: string }) => {
    const response = await fetch(resolveBetterAuthUrl('/sign-up/email'), {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    if (!response.ok) {
      const contentType = response.headers.get('content-type') ?? ''
      const body = contentType.includes('application/json')
        ? await response.json() as { message?: string; code?: string }
        : { message: await response.text() }
      const error = new Error(body.message || `Request failed: ${response.status}`) as Error & { payload?: { message?: string; code?: string }; status?: number }
      error.payload = body
      error.status = response.status
      throw error
    }
    return response.json() as Promise<Record<string, unknown>>
  },
  requestEmailVerification: async (payload: { email: string; callbackURL?: string }) => {
    // better-auth 1.6.7 端点为 /send-verification-email（非 /request-email-verification）
    const response = await fetch(resolveBetterAuthUrl('/send-verification-email'), {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    if (!response.ok) {
      const contentType = response.headers.get('content-type') ?? ''
      const body = contentType.includes('application/json')
        ? await response.json() as { message?: string }
        : { message: await response.text() }
      throw new Error(body.message || `Request failed: ${response.status}`)
    }
    return response.json() as Promise<Record<string, unknown>>
  },
  forgetPassword: async (payload: { email: string; redirectTo?: string }) => {
    // better-auth 1.6.7 端点为 /request-password-reset（非 /forget-password）
    const response = await fetch(resolveBetterAuthUrl('/request-password-reset'), {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    if (!response.ok) {
      const contentType = response.headers.get('content-type') ?? ''
      const body = contentType.includes('application/json')
        ? await response.json() as { message?: string }
        : { message: await response.text() }
      throw new Error(body.message || `Request failed: ${response.status}`)
    }
    return response.json() as Promise<Record<string, unknown>>
  },
  startGoogleSocialLogin: async (payload: {
    callbackURL: string
    errorCallbackURL: string
  }) => {
    const response = await fetch(resolveBetterAuthUrl('/sign-in/social'), {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        provider: 'google',
        callbackURL: payload.callbackURL,
        errorCallbackURL: payload.errorCallbackURL,
        disableRedirect: true,
      }),
    })

    const contentType = response.headers.get('content-type') ?? ''
    const fallbackMessage = response.status === 404
      ? 'Google 登录入口未部署成功。请确认当前环境已暴露 /api/identity/*，并且 preview 使用 wemux.xyz、production 使用 wemux.ai 的域名配置后重新部署。'
      : `Request failed: ${response.status}`
    const responsePayload = contentType.includes('application/json')
      ? await response.json() as BetterAuthSocialSignInResponse
      : { message: await response.text() } satisfies BetterAuthSocialSignInResponse

    if (!response.ok) {
      throw new Error(responsePayload.message || fallbackMessage)
    }

    const redirectUrl = responsePayload.url?.trim()
    if (!redirectUrl) {
      throw new Error('Google 登录入口返回了空跳转地址，请检查 /api/identity 登录路由配置。')
    }

    return redirectUrl
  },
  getAdminAudit: (payload?: { limit?: number }) => request<AdminAuditResponse>(payload?.limit ? `/api/admin/audit?limit=${encodeURIComponent(String(payload.limit))}` : '/api/admin/audit'),
  listPersonalAccessTokens: () => request<PersonalAccessTokenListResponse>('/api/auth/tokens'),
  createPersonalAccessToken: (payload: { name: string; expiresIn?: string }) => request<PersonalAccessTokenCreateResponse>('/api/auth/tokens', { method: 'POST', body: JSON.stringify(payload) }),
  deletePersonalAccessToken: (tokenId: string) => request<{ ok: boolean }>(`/api/auth/tokens/${tokenId}`, { method: 'DELETE' }),
  revokeAllPersonalAccessTokens: () => request<{ ok: boolean }>('/api/auth/tokens', { method: 'DELETE' }),
  updateMe: (payload: { name: string; bio?: string; username?: string }) => request<{ user: AuthUser }>('/api/auth/me', { method: 'PUT', body: JSON.stringify(payload) }),
  updateMyOnboarding: (payload: {
    onboardingCompletedAt?: string | null
    onboardingDismissedAt?: string | null
    onboardingPath?: 'existing-repo' | 'quickstart' | 'team' | null
  }) => request<{ user: AuthUser }>('/api/auth/me/onboarding', { method: 'PUT', body: JSON.stringify(payload) }),
  getAvatarStorageStatus: () => request<{ storage: { configured: boolean; driver: string; bucket: string; maxFileSizeMb: number; acceptedTypes: string[] } }>('/api/auth/storage/avatar'),
  uploadMyAvatar: async (file: File) => {
    const form = new FormData()
    form.append('file', file)
    const response = await authFetch(resolveApiUrl('/api/auth/me/avatar'), {
      method: 'POST',
      body: form,
    })

    if (!response.ok) {
      const text = await response.text()
      if (text) {
        throw new Error(extractErrorMessage(text))
      }

      throw new Error(`Upload failed: ${response.status}`)
    }

    return response.json() as Promise<{ user: AuthUser; message?: string }>
  },
}
