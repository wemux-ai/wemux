// [INPUT]: 任务/工作区 Git 身份模式
// [OUTPUT]: 执行时 Git 身份（TaskRuntimeGitIdentity）
// [POS]: 任务 Git 身份解析
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import { resolveGitRemoteHost } from '@shared/git-auth'
import type {
  TaskGitIdentityMode,
  TaskRuntimeGitIdentity,
  WorkspaceGitAuthPreference,
} from '@shared/types'
import { getGitIdentityConfig, toGitIdentityHealth } from './git-identity-config'
import {
  type GitCredential,
  getGitCredentialById,
  listGitCredentials,
  normalizeGitCredentialHost,
} from '../services/git-credential-store'
import {
  createGitHubAppInstallationAccessToken,
  resolveGitHubAppAgentCoAuthorIdentity,
  resolveGitHubAppCommitIdentity,
} from '../services/github-app-service'
import {
  getGitHubAppCommitIdentityForUserInstallation,
  getGitHubAppInstallationById,
} from '../services/github-app-installation-store'
import type { GitHubAppInstallation } from '../services/github-app-installation-store'
import { getProjectGitCredentialBinding } from '../services/project-git-binding-store'
import type { ProjectGitCredentialBinding } from '../services/project-git-binding-store'
import { getUserById } from '../repositories/auth'

const readTrimmed = (value: string | undefined) => value?.trim() || undefined

const isUsableCredential = (credential: GitCredential) => (
  credential.authMode !== 'ssh'
  || Boolean(credential.activatedAt && credential.sshPrivateKey)
)

export type GitIdentityDiagnosticCode =
  | 'no-binding'
  | 'host-mismatch'
  | 'credential-inactive'
  | 'binding-installation-missing'

export type GitIdentityDiagnostic =
  | { ok: true; identity: TaskRuntimeGitIdentity }
  | { ok: false; code: GitIdentityDiagnosticCode; message: string }

const GIT_IDENTITY_DIAGNOSTIC_GUIDANCE = '请在设置页配置 Git 权限（GitHub App 或 PAT）。'

const GIT_IDENTITY_DIAGNOSTIC_REASON: Record<GitIdentityDiagnosticCode, string> = {
  'no-binding': '项目未绑定 Git 凭据，且当前账号没有可用的 Git 凭据。',
  'host-mismatch': '当前账号的 Git 凭据与仓库 host 不匹配。',
  'credential-inactive': '绑定的 SSH 凭据尚未激活（未添加公钥）。',
  'binding-installation-missing': '项目绑定的 GitHub App 安装记录不存在，请重新授权。',
}

export const buildGitIdentityDiagnosticMessage = (code: GitIdentityDiagnosticCode) => {
  return `${GIT_IDENTITY_DIAGNOSTIC_REASON[code]}${GIT_IDENTITY_DIAGNOSTIC_GUIDANCE}`
}

export const resolveTaskGitIdentity = (mode: TaskGitIdentityMode | undefined): TaskRuntimeGitIdentity | undefined => {
  const config = getGitIdentityConfig()
  return {
    mode: mode ?? 'personal',
    name: readTrimmed(config.personal.name),
    email: readTrimmed(config.personal.email),
    credentialToken: readTrimmed(config.personal.token),
    credentialId: config.personal.token ? 'personal-managed-token' : undefined,
  }
}

const toTaskRuntimeGitIdentity = (
  userId: string,
  mode: TaskGitIdentityMode | undefined,
  credential: GitCredential,
): TaskRuntimeGitIdentity => {
  return {
    mode: mode ?? 'personal',
    authMode: credential.authMode,
    authSourceType: 'user-credential',
    provider: credential.provider,
    host: credential.host,
    userId,
    name: credential.name,
    email: credential.email,
    credentialToken: credential.authMode === 'pat'
      ? credential.patToken
      : credential.activatedAt
        ? credential.sshPrivateKey
        : undefined,
    credentialId: credential.id,
  }
}

const toTaskRuntimeGitHubAppIdentity = async (params: {
  userId: string
  mode: TaskGitIdentityMode | undefined
  installation: NonNullable<Awaited<ReturnType<typeof getGitHubAppInstallationById>>>
  binding: NonNullable<Awaited<ReturnType<typeof getProjectGitCredentialBinding>>>
}): Promise<TaskRuntimeGitIdentity> => {
  const accessToken = await createGitHubAppInstallationAccessToken(params.installation.installationId)
  const savedCommitIdentity = await getGitHubAppCommitIdentityForUserInstallation(
    params.userId,
    params.installation.installationId,
  )
  const commitIdentity = savedCommitIdentity ?? resolveGitHubAppCommitIdentity(getUserById(params.userId))
  const agentCoAuthorIdentity = resolveGitHubAppAgentCoAuthorIdentity()
  return {
    mode: params.mode ?? 'personal',
    authMode: 'github-app',
    authSourceType: 'github-app-installation',
    provider: 'github',
    host: params.installation.providerHost,
    userId: params.userId,
    name: commitIdentity.name,
    email: commitIdentity.email,
    agentCoAuthorName: agentCoAuthorIdentity?.name,
    agentCoAuthorEmail: agentCoAuthorIdentity?.email,
    githubInstallationId: params.installation.installationId,
    githubRepositoryId: params.binding.githubRepositoryId,
    githubRepositoryName: params.binding.githubRepositoryName,
    githubAccountLogin: params.installation.accountLogin,
    githubAccountType: params.installation.accountType,
    credentialToken: accessToken.token,
  }
}

const stripSecret = (identity?: TaskRuntimeGitIdentity): TaskRuntimeGitIdentity | undefined => {
  if (!identity) {
    return undefined
  }

  return {
    ...identity,
    credentialToken: undefined,
  }
}

const findRepoHostCandidates = <T extends { host: string; isDefault: boolean }>(credentials: T[], repoUrl?: string) => {
  const rawRepoHost = resolveGitRemoteHost(repoUrl)
  if (!rawRepoHost) {
    return credentials
  }

  const repoHost = normalizeGitCredentialHost(rawRepoHost)
  return credentials.filter((credential) => normalizeGitCredentialHost(credential.host) === repoHost)
}

const findDefaultCredential = <T extends { isDefault: boolean }>(credentials: T[]) => {
  return credentials.find((credential) => credential.isDefault)
}

const matchesRepoHost = (credential: Pick<GitCredential, 'host'>, repoUrl?: string) => {
  const rawRepoHost = resolveGitRemoteHost(repoUrl)
  if (!rawRepoHost) {
    return true
  }

  return normalizeGitCredentialHost(credential.host) === normalizeGitCredentialHost(rawRepoHost)
}

type SelectedAppInstallationCredential = {
  authSourceType: 'github-app-installation'
  binding: ProjectGitCredentialBinding
  installation: GitHubAppInstallation
}

type SelectedUserCredential = {
  authSourceType: 'user-credential'
  credential: GitCredential
}

type SelectedCredential = SelectedAppInstallationCredential | SelectedUserCredential

export type CredentialSelection =
  | { credential: SelectedCredential }
  | { reason: GitIdentityDiagnosticCode }

/**
 * 纯判定核心：根据已取回的项目绑定 / 安装 / 凭据数据，决定可用身份或未选中原因。
 * 数据由异步调用方注入，便于单测。
 */
export const selectCredentialForProjectCore = (params: {
  binding: ProjectGitCredentialBinding | null
  installation: GitHubAppInstallation | null
  boundCredential: GitCredential | null
  allCredentials: GitCredential[]
  repoUrl?: string
  gitAuthPreference?: WorkspaceGitAuthPreference
}): CredentialSelection => {
  const preferGitHubApp = params.gitAuthPreference === 'github-app'
  const preferCredential = params.gitAuthPreference === 'credential'

  let bindingReason: GitIdentityDiagnosticCode | undefined

  if (params.binding) {
    if (
      params.binding.authSourceType === 'github-app-installation'
      && params.binding.githubInstallationId
      && !preferCredential
    ) {
      if (!params.installation) {
        bindingReason ??= 'binding-installation-missing'
      } else if (matchesRepoHost({ host: params.installation.providerHost }, params.repoUrl)) {
        return {
          credential: {
            authSourceType: 'github-app-installation',
            binding: params.binding,
            installation: params.installation,
          },
        }
      } else {
        bindingReason ??= 'host-mismatch'
      }
    }

    if (params.binding.credentialId && !preferGitHubApp) {
      if (params.boundCredential && !isUsableCredential(params.boundCredential)) {
        bindingReason ??= 'credential-inactive'
      } else if (params.boundCredential && matchesRepoHost(params.boundCredential, params.repoUrl)) {
        return {
          credential: {
            authSourceType: 'user-credential',
            credential: params.boundCredential,
          },
        }
      } else if (params.boundCredential) {
        bindingReason ??= 'host-mismatch'
      }
    }
  }

  const usableCredentials = params.allCredentials.filter(isUsableCredential)
  if (usableCredentials.length === 0 || preferGitHubApp) {
    if (bindingReason) {
      return { reason: bindingReason }
    }
    if (params.allCredentials.some((credential) => credential.authMode === 'ssh' && !credential.activatedAt)) {
      return { reason: 'credential-inactive' }
    }
    return { reason: 'no-binding' }
  }

  if (!resolveGitRemoteHost(params.repoUrl)) {
    const defaultCredentials = usableCredentials.filter((credential) => credential.isDefault)
    if (defaultCredentials.length === 1) {
      return {
        credential: {
          authSourceType: 'user-credential',
          credential: defaultCredentials[0],
        },
      }
    }

    if (usableCredentials.length === 1) {
      return {
        credential: {
          authSourceType: 'user-credential',
          credential: usableCredentials[0],
        },
      }
    }

    return { reason: bindingReason ?? 'no-binding' }
  }

  const hostCandidates = findRepoHostCandidates(usableCredentials, params.repoUrl)
  if (hostCandidates.length === 0) {
    return { reason: bindingReason ?? 'host-mismatch' }
  }

  const credential = findDefaultCredential(hostCandidates)
    ?? (hostCandidates.length === 1 ? hostCandidates[0] : undefined)
  return credential
    ? {
        credential: {
          authSourceType: 'user-credential',
          credential,
        },
      }
    : { reason: bindingReason ?? 'no-binding' }
}

const selectCredentialForProject = async (params: {
  userId: string
  projectId?: string
  repoUrl?: string
  gitAuthPreference?: WorkspaceGitAuthPreference
}): Promise<CredentialSelection> => {
  const preferGitHubApp = params.gitAuthPreference === 'github-app'
  const preferCredential = params.gitAuthPreference === 'credential'

  let binding: ProjectGitCredentialBinding | null = null
  let installation: GitHubAppInstallation | null = null
  let boundCredential: GitCredential | null = null
  if (params.projectId) {
    binding = await getProjectGitCredentialBinding(params.projectId, params.userId)
    if (
      binding?.authSourceType === 'github-app-installation'
      && binding.githubInstallationId
      && !preferCredential
    ) {
      installation = await getGitHubAppInstallationById(binding.githubInstallationId)
    }
    if (binding?.credentialId && !preferGitHubApp) {
      boundCredential = await getGitCredentialById(params.userId, binding.credentialId)
    }
  }

  return selectCredentialForProjectCore({
    binding,
    installation,
    boundCredential,
    allCredentials: await listGitCredentials(params.userId),
    repoUrl: params.repoUrl,
    gitAuthPreference: params.gitAuthPreference,
  })
}

export const resolveUserProjectGitIdentity = async (params: {
  userId: string
  projectId?: string
  mode?: TaskGitIdentityMode
  repoUrl?: string
  gitAuthPreference?: WorkspaceGitAuthPreference
}): Promise<TaskRuntimeGitIdentity | undefined> => {
  const selection = await selectCredentialForProject({
    userId: params.userId,
    projectId: params.projectId,
    repoUrl: params.repoUrl,
    gitAuthPreference: params.gitAuthPreference,
  })
  if (!('credential' in selection)) {
    return undefined
  }

  if (selection.credential.authSourceType === 'github-app-installation') {
    return await toTaskRuntimeGitHubAppIdentity({
      userId: params.userId,
      mode: params.mode,
      installation: selection.credential.installation,
      binding: selection.credential.binding,
    })
  }

  return toTaskRuntimeGitIdentity(params.userId, params.mode, selection.credential.credential)
}

export const resolveUserProjectGitIdentityDiagnostic = async (params: {
  userId: string
  projectId?: string
  mode?: TaskGitIdentityMode
  repoUrl?: string
  gitAuthPreference?: WorkspaceGitAuthPreference
}): Promise<GitIdentityDiagnostic> => {
  const selection = await selectCredentialForProject({
    userId: params.userId,
    projectId: params.projectId,
    repoUrl: params.repoUrl,
    gitAuthPreference: params.gitAuthPreference,
  })
  if (!('credential' in selection)) {
    return {
      ok: false,
      code: selection.reason,
      message: buildGitIdentityDiagnosticMessage(selection.reason),
    }
  }

  if (selection.credential.authSourceType === 'github-app-installation') {
    return {
      ok: true,
      identity: await toTaskRuntimeGitHubAppIdentity({
        userId: params.userId,
        mode: params.mode,
        installation: selection.credential.installation,
        binding: selection.credential.binding,
      }),
    }
  }

  return {
    ok: true,
    identity: toTaskRuntimeGitIdentity(params.userId, params.mode, selection.credential.credential),
  }
}

export const resolveUserTaskGitIdentity = async (
  userId: string,
  mode: TaskGitIdentityMode | undefined,
  repoUrl?: string,
): Promise<TaskRuntimeGitIdentity | undefined> => {
  return resolveUserProjectGitIdentity({
    userId,
    mode,
    repoUrl,
  })
}

export const sanitizeTaskGitIdentity = (identity?: TaskRuntimeGitIdentity) => stripSecret(identity)

export const hydrateTaskGitIdentity = async (params: {
  userId?: string
  projectId?: string
  mode?: TaskGitIdentityMode
  repoUrl?: string
  gitAuthPreference?: WorkspaceGitAuthPreference
  identity?: TaskRuntimeGitIdentity
}): Promise<TaskRuntimeGitIdentity | undefined> => {
  const userId = params.userId ?? params.identity?.userId
  if (!userId) {
    return undefined
  }

  const credentialId = params.identity?.credentialId
  if (credentialId) {
    const credential = await getGitCredentialById(userId, credentialId)
    if (credential && isUsableCredential(credential) && matchesRepoHost(credential, params.repoUrl)) {
      return toTaskRuntimeGitIdentity(userId, params.identity?.mode ?? params.mode, credential)
    }
  }

  const githubInstallationId = params.identity?.githubInstallationId
  if (githubInstallationId) {
    const installation = await getGitHubAppInstallationById(githubInstallationId)
    const binding = params.projectId
      ? await getProjectGitCredentialBinding(params.projectId, userId)
      : null
    if (
      installation
      && binding?.authSourceType === 'github-app-installation'
      && binding.githubInstallationId === githubInstallationId
      && matchesRepoHost({ host: installation.providerHost }, params.repoUrl)
    ) {
      return await toTaskRuntimeGitHubAppIdentity({
        userId,
        mode: params.identity?.mode ?? params.mode,
        installation,
        binding,
      })
    }
  }

  return resolveUserProjectGitIdentity({
    userId,
    projectId: params.projectId,
    mode: params.identity?.mode ?? params.mode,
    repoUrl: params.repoUrl,
    gitAuthPreference: params.gitAuthPreference,
  })
}

export const getTaskGitIdentityHealth = () => toGitIdentityHealth(getGitIdentityConfig())
