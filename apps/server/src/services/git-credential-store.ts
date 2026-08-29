/**
 * [INPUT]: Authenticated user-scoped Git credential mutations and encrypted database rows.
 * [OUTPUT]: Normalized credentials, redacted summaries, defaults, and project-binding cleanup.
 * [POS]: Server persistence and encryption boundary for user Git identities.
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */
import { randomUUID } from 'node:crypto'
import type { GitAuthMode, GitProvider } from '@shared/types'
import { and, desc, eq, ne } from 'drizzle-orm'

import { ensurePostgresReady } from '../storage/postgres/db'
import { getDrizzleDb } from '../storage/postgres/drizzle-db'
import { userGitCredentials } from '../storage/postgres/schema'
import { decryptSecret, encryptSecret } from './secret-crypto'
import { deleteBindingsForCredential } from './project-git-binding-store'
const DEFAULT_HOST = 'github.com'

export const GIT_PROVIDERS = ['github', 'gitlab', 'generic'] as const satisfies readonly GitProvider[]

type GitCredentialRow = typeof userGitCredentials.$inferSelect

export const encrypt = encryptSecret
export const decrypt = decryptSecret

export interface GitCredential {
  id: string
  userId: string
  label: string
  provider: GitProvider
  host: string
  authMode: GitAuthMode
  name: string
  email: string
  patToken?: string
  sshPublicKey?: string
  sshPrivateKey?: string
  sshKeyFingerprint?: string
  activatedAt?: string
  isDefault: boolean
  createdAt: string
  updatedAt: string
}

export interface GitCredentialSummary {
  id: string
  label: string
  provider: GitProvider
  host: string
  authMode: GitAuthMode
  name: string
  email: string
  hasPatToken: boolean
  hasSshPrivateKey: boolean
  sshPublicKey?: string
  sshKeyFingerprint?: string
  activated: boolean
  isDefault: boolean
  createdAt: string
  updatedAt: string
}

export interface GitCredentialMutationInput {
  userId: string
  label: string
  provider: GitProvider
  host?: string
  authMode: GitAuthMode
  name: string
  email: string
  patToken?: string
  sshPublicKey?: string
  sshPrivateKey?: string
  sshKeyFingerprint?: string
  activatedAt?: string
  isDefault?: boolean
}

export type GitCredentialStatusEntry = {
  configured: boolean
  authMode: GitAuthMode | null
  name?: string
  email?: string
  activated: boolean
  sshPublicKey?: string
  sshKeyFingerprint?: string
}

export const normalizeGitCredentialHost = (host?: string) => {
  const trimmed = host?.trim().toLowerCase() || DEFAULT_HOST
  const scpLikeHost = trimmed.includes('://')
    ? undefined
    : /^[^@/]+@([^:/?#]+):/i.exec(trimmed)?.[1]
  if (scpLikeHost) {
    return scpLikeHost
  }

  try {
    const parsed = new URL(/^[a-z][a-z\d+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`)
    return parsed.host || DEFAULT_HOST
  } catch {
    return trimmed.replace(/^https?:\/\//, '').split(/[/?#]/)[0].replace(/\/+$/, '') || DEFAULT_HOST
  }
}

const normalizeLabel = (label: string, provider: GitProvider) => {
  const trimmed = label.trim()
  if (trimmed) {
    return trimmed
  }

  if (provider === 'github') return 'GitHub 身份'
  if (provider === 'gitlab') return 'GitLab 身份'
  return 'Git 身份'
}

const mapCredentialRow = (row: GitCredentialRow): GitCredential => ({
  id: row.id,
  userId: row.userId,
  label: row.label,
  provider: row.provider,
  host: row.host,
  authMode: row.authMode,
  name: row.name,
  email: row.email,
  patToken: row.patTokenEncrypted ? decrypt(row.patTokenEncrypted) : undefined,
  sshPublicKey: row.sshPublicKey ?? undefined,
  sshPrivateKey: row.sshPrivateKeyEncrypted ? decrypt(row.sshPrivateKeyEncrypted) : undefined,
  sshKeyFingerprint: row.sshKeyFingerprint ?? undefined,
  activatedAt: row.activatedAt ?? undefined,
  isDefault: row.isDefault,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
})

const toSummary = (credential: GitCredential): GitCredentialSummary => ({
  id: credential.id,
  label: credential.label,
  provider: credential.provider,
  host: credential.host,
  authMode: credential.authMode,
  name: credential.name,
  email: credential.email,
  hasPatToken: Boolean(credential.patToken),
  hasSshPrivateKey: Boolean(credential.sshPrivateKey),
  sshPublicKey: credential.sshPublicKey,
  sshKeyFingerprint: credential.sshKeyFingerprint,
  activated: Boolean(credential.activatedAt),
  isDefault: credential.isDefault,
  createdAt: credential.createdAt,
  updatedAt: credential.updatedAt,
})

const findCredentialRows = async (userId: string) => {
  await ensurePostgresReady()
  return getDrizzleDb()
    .select()
    .from(userGitCredentials)
    .where(eq(userGitCredentials.userId, userId))
    .orderBy(desc(userGitCredentials.isDefault), desc(userGitCredentials.updatedAt), desc(userGitCredentials.createdAt))
}

export const listGitCredentials = async (userId: string): Promise<GitCredential[]> => {
  return (await findCredentialRows(userId)).map(mapCredentialRow)
}

export const listGitCredentialSummaries = async (userId: string): Promise<GitCredentialSummary[]> => {
  return (await listGitCredentials(userId)).map(toSummary)
}

export const getGitCredentialById = async (userId: string, credentialId: string): Promise<GitCredential | null> => {
  await ensurePostgresReady()
  const rows = await getDrizzleDb()
    .select()
    .from(userGitCredentials)
    .where(and(eq(userGitCredentials.userId, userId), eq(userGitCredentials.id, credentialId)))
    .limit(1)
  return rows[0] ? mapCredentialRow(rows[0]) : null
}

export const loadGitCredential = async (userId: string, providerOrCredentialId?: GitProvider | string): Promise<GitCredential | null> => {
  if (providerOrCredentialId && !GIT_PROVIDERS.includes(providerOrCredentialId as GitProvider)) {
    return getGitCredentialById(userId, providerOrCredentialId)
  }

  const credentials = await listGitCredentials(userId)
  if (providerOrCredentialId) {
    return credentials.find((item) => item.provider === providerOrCredentialId) ?? null
  }

  return credentials[0] ?? null
}

const ensureSingleDefaultForHost = async (userId: string, host: string, credentialId: string) => {
  await ensurePostgresReady()
  await getDrizzleDb()
    .update(userGitCredentials)
    .set({ isDefault: false })
    .where(and(
      eq(userGitCredentials.userId, userId),
      eq(userGitCredentials.host, host),
      ne(userGitCredentials.id, credentialId),
    ))
}

export const createGitCredential = async (input: GitCredentialMutationInput): Promise<GitCredential> => {
  const now = new Date().toISOString()
  const id = randomUUID()
  const host = normalizeGitCredentialHost(input.host)
  const label = normalizeLabel(input.label, input.provider)
  await ensurePostgresReady()
  await getDrizzleDb()
    .insert(userGitCredentials)
    .values({
      id,
      userId: input.userId,
      label,
      provider: input.provider,
      host,
      authMode: input.authMode,
      name: input.name,
      email: input.email,
      patTokenEncrypted: input.patToken ? encrypt(input.patToken) : null,
      sshPublicKey: input.sshPublicKey ?? null,
      sshPrivateKeyEncrypted: input.sshPrivateKey ? encrypt(input.sshPrivateKey) : null,
      sshKeyFingerprint: input.sshKeyFingerprint ?? null,
      activatedAt: input.activatedAt ?? null,
      isDefault: Boolean(input.isDefault),
      createdAt: now,
      updatedAt: now,
    })

  if (input.isDefault) {
    await ensureSingleDefaultForHost(input.userId, host, id)
  }

  const credential = await getGitCredentialById(input.userId, id)
  if (!credential) {
    throw new Error('Git 凭证创建失败。')
  }

  return credential
}

export const updateGitCredential = async (
  userId: string,
  credentialId: string,
  input: Partial<Omit<GitCredentialMutationInput, 'userId'>>,
): Promise<GitCredential | null> => {
  const current = await getGitCredentialById(userId, credentialId)
  if (!current) {
    return null
  }

  const host = normalizeGitCredentialHost(input.host ?? current.host)
  const hostChanged = host !== normalizeGitCredentialHost(current.host)
  const provider = input.provider ?? current.provider
  const label = normalizeLabel(input.label ?? current.label, provider)
  const authMode = current.authMode
  const patToken = input.patToken !== undefined ? input.patToken : current.patToken
  const sshPrivateKey = input.sshPrivateKey !== undefined ? input.sshPrivateKey : current.sshPrivateKey
  const now = new Date().toISOString()
  const activatedAt = authMode === 'ssh' && hostChanged
    ? null
    : input.activatedAt ?? current.activatedAt ?? null
  const isDefault = authMode === 'ssh' && hostChanged
    ? false
    : input.isDefault ?? current.isDefault

  await ensurePostgresReady()
  await getDrizzleDb()
    .update(userGitCredentials)
    .set({
      label,
      provider,
      host,
      authMode,
      name: input.name ?? current.name,
      email: input.email ?? current.email,
      patTokenEncrypted: patToken ? encrypt(patToken) : null,
      sshPublicKey: input.sshPublicKey ?? current.sshPublicKey ?? null,
      sshPrivateKeyEncrypted: sshPrivateKey ? encrypt(sshPrivateKey) : null,
      sshKeyFingerprint: input.sshKeyFingerprint ?? current.sshKeyFingerprint ?? null,
      activatedAt,
      isDefault,
      updatedAt: now,
    })
    .where(and(eq(userGitCredentials.userId, userId), eq(userGitCredentials.id, credentialId)))

  if (isDefault) {
    await ensureSingleDefaultForHost(userId, host, credentialId)
  }

  if (hostChanged) {
    await deleteBindingsForCredential(userId, credentialId)
  }

  return getGitCredentialById(userId, credentialId)
}

export const activateSshCredentialAfterVerification = async (params: {
  userId: string
  credentialId: string
  expectedUpdatedAt: string
}) => {
  await ensurePostgresReady()
  const now = new Date().toISOString()
  const rows = await getDrizzleDb()
    .update(userGitCredentials)
    .set({ activatedAt: now, updatedAt: now })
    .where(and(
      eq(userGitCredentials.userId, params.userId),
      eq(userGitCredentials.id, params.credentialId),
      eq(userGitCredentials.authMode, 'ssh'),
      eq(userGitCredentials.updatedAt, params.expectedUpdatedAt),
    ))
    .returning({ id: userGitCredentials.id })

  return rows.length > 0
    ? getGitCredentialById(params.userId, params.credentialId)
    : null
}

export const deleteGitCredential = async (userId: string, credentialId: string) => {
  await deleteBindingsForCredential(userId, credentialId)
  await ensurePostgresReady()
  const rows = await getDrizzleDb()
    .delete(userGitCredentials)
    .where(and(eq(userGitCredentials.userId, userId), eq(userGitCredentials.id, credentialId)))
    .returning({ id: userGitCredentials.id })
  return rows.length > 0
}

export const setDefaultGitCredential = async (userId: string, credentialId: string) => {
  const credential = await getGitCredentialById(userId, credentialId)
  if (!credential) {
    return null
  }
  if (credential.authMode === 'ssh' && !credential.activatedAt) {
    throw new Error('请先验证 SSH 身份，再将它设为默认。')
  }

  await ensurePostgresReady()
  await getDrizzleDb()
    .update(userGitCredentials)
    .set({ isDefault: true, updatedAt: new Date().toISOString() })
    .where(and(eq(userGitCredentials.userId, userId), eq(userGitCredentials.id, credentialId)))
  await ensureSingleDefaultForHost(userId, credential.host, credentialId)
  return getGitCredentialById(userId, credentialId)
}

export const saveGitCredential = async (input: GitCredentialMutationInput & { id?: string }) => {
  if (input.id) {
    const updated = await updateGitCredential(input.userId, input.id, input)
    if (updated) {
      return updated
    }
  }

  return createGitCredential(input)
}

export const getGitCredentialStatus = async (userId: string, provider?: GitProvider): Promise<GitCredentialStatusEntry> => {
  const credentials = await listGitCredentials(userId)
  const credential = provider
    ? credentials.find((item) => item.provider === provider)
    : credentials[0]

  if (!credential) {
    return { configured: false, authMode: null, activated: false }
  }

  return {
    configured: true,
    authMode: credential.authMode,
    name: credential.name,
    email: credential.email,
    activated: Boolean(credential.activatedAt),
    sshPublicKey: credential.sshPublicKey,
    sshKeyFingerprint: credential.sshKeyFingerprint,
  }
}
