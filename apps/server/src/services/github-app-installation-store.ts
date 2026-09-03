// [INPUT]: App 安装数据
// [OUTPUT]: 存储结果
// [POS]: GitHub App 安装存储
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import { createHash, randomUUID } from 'node:crypto'
import type { GitProvider } from '@shared/types'
import { and, count, desc, eq, gte, lt, sql } from 'drizzle-orm'

import { ensurePostgresReady } from '../storage/postgres/db'
import { getDrizzleDb } from '../storage/postgres/drizzle-db'
import {
  githubAppConnectionStates,
  githubAppInstallations,
  githubAppUserAuths,
  githubAppUserLinks,
} from '../storage/postgres/schema'
import { isGitHubAppUserInstallationAccessible } from './github-app-service'
import {
  deleteBindingsForGitHubInstallation,
  deleteBindingsForUserGitHubInstallation,
} from './project-git-binding-store'
import { decryptSecret, encryptSecret } from './secret-crypto'

export const isGitHubAppInstallationAccessibleToUser = async (userId: string, installationId: number): Promise<boolean> => {
  const userAuth = await getGitHubAppUserAuth(userId)
  if (!userAuth) {
    return false
  }
  return isGitHubAppUserInstallationAccessible(userAuth.accessToken, installationId)
}

export interface GitHubAppUserAuth {
  userId: string
  accessToken: string
  refreshToken?: string
  expiresAt?: string
  updatedAt: string
}

type GitHubAppUserAuthRow = typeof githubAppUserAuths.$inferSelect

const mapUserAuthRow = (row: GitHubAppUserAuthRow): GitHubAppUserAuth => ({
  userId: row.userId,
  accessToken: decryptSecret(row.accessTokenEncrypted),
  refreshToken: row.refreshTokenEncrypted ? decryptSecret(row.refreshTokenEncrypted) : undefined,
  expiresAt: row.expiresAt ?? undefined,
  updatedAt: row.updatedAt,
})

export const saveGitHubAppUserAuth = async (params: {
  userId: string
  accessToken: string
  refreshToken?: string
  expiresAt?: string
}) => {
  const accessToken = params.accessToken?.trim()
  if (!accessToken) {
    return
  }
  await ensurePostgresReady()
  const now = new Date().toISOString()
  const values = {
    userId: params.userId,
    accessTokenEncrypted: encryptSecret(accessToken),
    refreshTokenEncrypted: params.refreshToken?.trim() ? encryptSecret(params.refreshToken.trim()) : null,
    expiresAt: params.expiresAt?.trim() || null,
    createdAt: now,
    updatedAt: now,
  }
  await getDrizzleDb()
    .insert(githubAppUserAuths)
    .values(values)
    .onConflictDoUpdate({
      target: githubAppUserAuths.userId,
      set: {
        accessTokenEncrypted: values.accessTokenEncrypted,
        refreshTokenEncrypted: values.refreshTokenEncrypted,
        expiresAt: values.expiresAt,
        updatedAt: values.updatedAt,
      },
    })
}

export const getGitHubAppUserAuth = async (userId: string): Promise<GitHubAppUserAuth | null> => {
  await ensurePostgresReady()
  const rows = await getDrizzleDb()
    .select()
    .from(githubAppUserAuths)
    .where(eq(githubAppUserAuths.userId, userId))
    .limit(1)
  const row = rows[0]
  if (!row) {
    return null
  }
  if (row.expiresAt && row.expiresAt <= new Date().toISOString()) {
    return null
  }
  return mapUserAuthRow(row)
}

type GitHubAppInstallationRow = typeof githubAppInstallations.$inferSelect

export interface GitHubAppInstallation {
  installationId: number
  accountId?: number
  accountLogin: string
  accountType: string
  provider: GitProvider
  providerHost: string
  repositorySelection: string
  permissions: Record<string, string>
  accessToken?: string
  accessTokenExpiresAt?: string
  suspendedAt?: string
  createdAt: string
  updatedAt: string
}

export interface GitHubAppInstallationUpsertInput {
  installationId: number
  accountId?: number
  accountLogin: string
  accountType: string
  provider?: Extract<GitProvider, 'github'>
  providerHost?: string
  repositorySelection?: string
  permissions?: Record<string, string>
  accessToken?: string
  accessTokenExpiresAt?: string
  suspendedAt?: string
}

type GitHubAppUserLinkRow = typeof githubAppUserLinks.$inferSelect

export interface GitHubAppInstallationSummary {
  installationId: number
  accountLogin: string
  accountType: string
  provider: GitProvider
  providerHost: string
  repositorySelection: string
  permissions: Record<string, string>
  hasAccessToken: boolean
  accessTokenExpiresAt?: string
  suspendedAt?: string
  commitAuthorName?: string
  commitAuthorEmail?: string
  createdAt: string
  updatedAt: string
}

export interface GitHubAppCommitIdentity {
  name: string
  email: string
}

const hashConnectionState = (state: string) => createHash('sha256').update(state).digest('hex')

const mapRow = (row: GitHubAppInstallationRow): GitHubAppInstallation => ({
  installationId: Number(row.installationId),
  accountId: row.accountId != null ? Number(row.accountId) : undefined,
  accountLogin: row.accountLogin,
  accountType: row.accountType,
  provider: row.provider,
  providerHost: row.providerHost,
  repositorySelection: row.repositorySelection,
  permissions: row.permissionsJson ?? {},
  accessToken: row.accessTokenEncrypted ? decryptSecret(row.accessTokenEncrypted) : undefined,
  accessTokenExpiresAt: row.accessTokenExpiresAt ?? undefined,
  suspendedAt: row.suspendedAt ?? undefined,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
})

const toSummary = (
  installation: GitHubAppInstallation,
  commitIdentity?: Partial<GitHubAppCommitIdentity>,
): GitHubAppInstallationSummary => ({
  installationId: installation.installationId,
  accountLogin: installation.accountLogin,
  accountType: installation.accountType,
  provider: installation.provider,
  providerHost: installation.providerHost,
  repositorySelection: installation.repositorySelection,
  permissions: installation.permissions,
  hasAccessToken: Boolean(installation.accessToken),
  accessTokenExpiresAt: installation.accessTokenExpiresAt,
  suspendedAt: installation.suspendedAt,
  commitAuthorName: commitIdentity?.name?.trim() || undefined,
  commitAuthorEmail: commitIdentity?.email?.trim() || undefined,
  createdAt: installation.createdAt,
  updatedAt: installation.updatedAt,
})

const normalizeCommitIdentity = (identity?: Partial<GitHubAppCommitIdentity>): GitHubAppCommitIdentity | undefined => {
  const name = identity?.name?.trim()
  const email = identity?.email?.trim()
  return name && email ? { name, email } : undefined
}

export const getGitHubAppInstallationById = async (installationId: number): Promise<GitHubAppInstallation | null> => {
  await ensurePostgresReady()
  const rows = await getDrizzleDb()
    .select()
    .from(githubAppInstallations)
    .where(eq(githubAppInstallations.installationId, installationId))
    .limit(1)
  return rows[0] ? mapRow(rows[0]) : null
}

export const listGitHubAppInstallationsForAccountLogin = async (accountLogin: string): Promise<GitHubAppInstallation[]> => {
  await ensurePostgresReady()
  const normalizedLogin = accountLogin.trim().toLowerCase()
  const rows = await getDrizzleDb()
    .select()
    .from(githubAppInstallations)
    .where(sql`LOWER(${githubAppInstallations.accountLogin}) = ${normalizedLogin}`)
    .orderBy(desc(githubAppInstallations.updatedAt), desc(githubAppInstallations.createdAt))
  return rows.map(mapRow)
}

export const listGitHubAppInstallationSummariesForUser = async (userId: string): Promise<GitHubAppInstallationSummary[]> => {
  await ensurePostgresReady()
  const rows = await getDrizzleDb()
    .select({
      installation: githubAppInstallations,
      commitAuthorName: githubAppUserLinks.commitAuthorName,
      commitAuthorEmail: githubAppUserLinks.commitAuthorEmail,
    })
    .from(githubAppUserLinks)
    .innerJoin(githubAppInstallations, eq(githubAppInstallations.installationId, githubAppUserLinks.installationId))
    .where(eq(githubAppUserLinks.userId, userId))
    .orderBy(desc(githubAppInstallations.updatedAt), desc(githubAppInstallations.createdAt))

  return rows.map((row) => toSummary(mapRow(row.installation), {
    name: row.commitAuthorName ?? undefined,
    email: row.commitAuthorEmail ?? undefined,
  }))
}

export const getGitHubAppInstallationForUser = async (
  userId: string,
  installationId: number,
): Promise<GitHubAppInstallation | null> => {
  await ensurePostgresReady()
  const rows = await getDrizzleDb()
    .select({ installation: githubAppInstallations })
    .from(githubAppUserLinks)
    .innerJoin(githubAppInstallations, eq(githubAppInstallations.installationId, githubAppUserLinks.installationId))
    .where(and(
      eq(githubAppUserLinks.userId, userId),
      eq(githubAppInstallations.installationId, installationId),
    ))
    .limit(1)
  return rows[0] ? mapRow(rows[0].installation) : null
}

export const upsertGitHubAppInstallation = async (input: GitHubAppInstallationUpsertInput): Promise<GitHubAppInstallation> => {
  await ensurePostgresReady()
  const now = new Date().toISOString()
  const values = {
    installationId: input.installationId,
    accountId: input.accountId ?? null,
    accountLogin: input.accountLogin.trim(),
    accountType: input.accountType.trim() || 'User',
    provider: (input.provider ?? 'github') as 'github' | 'gitlab' | 'generic',
    providerHost: input.providerHost?.trim() || 'github.com',
    repositorySelection: input.repositorySelection?.trim() || 'selected',
    permissionsJson: input.permissions ?? {},
    accessTokenEncrypted: input.accessToken?.trim() ? encryptSecret(input.accessToken.trim()) : null,
    accessTokenExpiresAt: input.accessTokenExpiresAt?.trim() || null,
    suspendedAt: input.suspendedAt?.trim() || null,
    createdAt: now,
    updatedAt: now,
  }

  await getDrizzleDb()
    .insert(githubAppInstallations)
    .values(values)
    .onConflictDoUpdate({
      target: githubAppInstallations.installationId,
      set: {
        accountId: values.accountId,
        accountLogin: values.accountLogin,
        accountType: values.accountType,
        provider: values.provider,
        providerHost: values.providerHost,
        repositorySelection: values.repositorySelection,
        permissionsJson: values.permissionsJson,
        accessTokenEncrypted: values.accessTokenEncrypted,
        accessTokenExpiresAt: values.accessTokenExpiresAt,
        suspendedAt: values.suspendedAt,
        updatedAt: values.updatedAt,
      },
    })

  const installation = await getGitHubAppInstallationById(input.installationId)
  if (!installation) {
    throw new Error('保存 GitHub App installation 失败。')
  }
  return installation
}

export const deleteGitHubAppInstallation = async (installationId: number) => {
  await ensurePostgresReady()
  const rows = await getDrizzleDb()
    .delete(githubAppInstallations)
    .where(eq(githubAppInstallations.installationId, installationId))
    .returning({ installationId: githubAppInstallations.installationId })
  return rows.length > 0
}

export const deleteGitHubAppInstallationEverywhere = async (installationId: number) => {
  // GitHub 侧 installation 已卸载（webhook installation.deleted）：
  // 清理项目绑定、所有用户绑定，再删除全局 installation 记录。
  await deleteBindingsForGitHubInstallation(installationId)
  await ensurePostgresReady()
  await getDrizzleDb()
    .delete(githubAppUserLinks)
    .where(eq(githubAppUserLinks.installationId, installationId))
  await deleteGitHubAppInstallation(installationId)
}

export const linkGitHubAppInstallationToUser = async (
  userId: string,
  installationId: number,
  commitIdentity?: Partial<GitHubAppCommitIdentity>,
) => {
  await ensurePostgresReady()
  const now = new Date().toISOString()
  const existing = await getDrizzleDb()
    .select()
    .from(githubAppUserLinks)
    .where(and(
      eq(githubAppUserLinks.userId, userId),
      eq(githubAppUserLinks.installationId, installationId),
    ))
    .limit(1)
  const current = existing[0]
  const id = current?.id ?? randomUUID()
  const identity = normalizeCommitIdentity(commitIdentity)
  await getDrizzleDb()
    .insert(githubAppUserLinks)
    .values({
      id,
      userId,
      installationId,
      commitAuthorName: identity?.name ?? null,
      commitAuthorEmail: identity?.email ?? null,
      createdAt: current?.createdAt ?? now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [githubAppUserLinks.userId, githubAppUserLinks.installationId],
      set: {
        commitAuthorName: identity?.name ?? current?.commitAuthorName ?? null,
        commitAuthorEmail: identity?.email ?? current?.commitAuthorEmail ?? null,
        updatedAt: now,
      },
    })
}

export const upsertGitHubAppInstallationForUser = async (params: {
  userId: string
  commitIdentity?: Partial<GitHubAppCommitIdentity>
} & GitHubAppInstallationUpsertInput): Promise<GitHubAppInstallationSummary> => {
  const installation = await upsertGitHubAppInstallation(params)
  await linkGitHubAppInstallationToUser(params.userId, installation.installationId, params.commitIdentity)
  return toSummary(installation, params.commitIdentity)
}

export const getGitHubAppCommitIdentityForUserInstallation = async (
  userId: string,
  installationId: number,
): Promise<GitHubAppCommitIdentity | null> => {
  await ensurePostgresReady()
  const rows = await getDrizzleDb()
    .select({
      commitAuthorName: githubAppUserLinks.commitAuthorName,
      commitAuthorEmail: githubAppUserLinks.commitAuthorEmail,
    })
    .from(githubAppUserLinks)
    .where(and(
      eq(githubAppUserLinks.userId, userId),
      eq(githubAppUserLinks.installationId, installationId),
    ))
    .limit(1)
  const row = rows[0]
  return normalizeCommitIdentity({
    name: row?.commitAuthorName ?? undefined,
    email: row?.commitAuthorEmail ?? undefined,
  }) ?? null
}

export const updateGitHubAppCommitIdentityForUserInstallation = async (
  userId: string,
  installationId: number,
  identity: GitHubAppCommitIdentity,
): Promise<GitHubAppInstallationSummary | null> => {
  const normalized = normalizeCommitIdentity(identity)
  if (!normalized) {
    return null
  }

  await ensurePostgresReady()
  const rows = await getDrizzleDb()
    .update(githubAppUserLinks)
    .set({
      commitAuthorName: normalized.name,
      commitAuthorEmail: normalized.email,
      updatedAt: new Date().toISOString(),
    })
    .where(and(
      eq(githubAppUserLinks.userId, userId),
      eq(githubAppUserLinks.installationId, installationId),
    ))
    .returning({ id: githubAppUserLinks.id })
  if (!rows[0]) {
    return null
  }

  const installation = await getGitHubAppInstallationById(installationId)
  return installation ? toSummary(installation, normalized) : null
}

export const savePendingGitHubAppConnectionIdentity = async (params: {
  state: string
  userId: string
  commitIdentity: GitHubAppCommitIdentity
  expiresAt: number
}) => {
  const identity = normalizeCommitIdentity(params.commitIdentity)
  if (!identity) {
    return
  }
  await ensurePostgresReady()
  const now = new Date().toISOString()
  await getDrizzleDb()
    .delete(githubAppConnectionStates)
    .where(lt(githubAppConnectionStates.expiresAt, now))
  await getDrizzleDb()
    .insert(githubAppConnectionStates)
    .values({
      stateHash: hashConnectionState(params.state),
      userId: params.userId,
      commitAuthorName: identity.name,
      commitAuthorEmail: identity.email,
      expiresAt: new Date(params.expiresAt).toISOString(),
      createdAt: now,
    })
    .onConflictDoUpdate({
      target: githubAppConnectionStates.stateHash,
      set: {
        userId: params.userId,
        commitAuthorName: identity.name,
        commitAuthorEmail: identity.email,
        expiresAt: new Date(params.expiresAt).toISOString(),
      },
    })
}

export const getPendingGitHubAppConnectionIdentity = async (
  state: string,
  userId: string,
): Promise<GitHubAppCommitIdentity | null> => {
  await ensurePostgresReady()
  const now = new Date().toISOString()
  const rows = await getDrizzleDb()
    .select({
      commitAuthorName: githubAppConnectionStates.commitAuthorName,
      commitAuthorEmail: githubAppConnectionStates.commitAuthorEmail,
    })
    .from(githubAppConnectionStates)
    .where(and(
      eq(githubAppConnectionStates.stateHash, hashConnectionState(state)),
      eq(githubAppConnectionStates.userId, userId),
      gte(githubAppConnectionStates.expiresAt, now),
    ))
    .limit(1)
  const row = rows[0]
  return normalizeCommitIdentity({
    name: row?.commitAuthorName,
    email: row?.commitAuthorEmail,
  }) ?? null
}

export const unlinkGitHubAppInstallationFromUser = async (userId: string, installationId: number) => {
  await deleteBindingsForUserGitHubInstallation(userId, installationId)
  await ensurePostgresReady()
  const deleted = await getDrizzleDb()
    .delete(githubAppUserLinks)
    .where(and(
      eq(githubAppUserLinks.userId, userId),
      eq(githubAppUserLinks.installationId, installationId),
    ))
    .returning({ id: githubAppUserLinks.id })

  const remaining = await getDrizzleDb()
    .select({ value: count() })
    .from(githubAppUserLinks)
    .where(eq(githubAppUserLinks.installationId, installationId))
  const linkedCount = Number(remaining[0]?.value ?? 0)
  if (linkedCount < 1) {
    await deleteGitHubAppInstallation(installationId)
  }

  return deleted.length > 0
}
