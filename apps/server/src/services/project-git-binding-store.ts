// [INPUT]: Git 绑定数据
// [OUTPUT]: 存取
// [POS]: 项目 Git 绑定 store
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import { randomUUID } from 'node:crypto'
import { and, desc, eq } from 'drizzle-orm'

import type { GitAuthSourceType } from '@shared/types'
import { ensurePostgresReady } from '../storage/postgres/db'
import { getDrizzleDb } from '../storage/postgres/drizzle-db'
import { projectGitCredentialBindings } from '../storage/postgres/schema'

export interface ProjectGitCredentialBinding {
  id: string
  projectId: string
  userId: string
  authSourceType: GitAuthSourceType
  credentialId?: string
  githubInstallationId?: number
  githubRepositoryId?: number
  githubAccountLogin?: string
  githubAccountType?: string
  githubRepositoryName?: string
  providerHost?: string
  createdAt: string
  updatedAt: string
}

type ProjectGitCredentialBindingRow = typeof projectGitCredentialBindings.$inferSelect

const mapBindingRow = (row: ProjectGitCredentialBindingRow): ProjectGitCredentialBinding => ({
  id: row.id,
  projectId: row.projectId,
  userId: row.userId,
  authSourceType: row.authSourceType as GitAuthSourceType,
  credentialId: row.credentialId ?? undefined,
  githubInstallationId: row.githubInstallationId ?? undefined,
  githubRepositoryId: row.githubRepositoryId ?? undefined,
  githubAccountLogin: row.githubAccountLogin ?? undefined,
  githubAccountType: row.githubAccountType ?? undefined,
  githubRepositoryName: row.githubRepositoryName ?? undefined,
  providerHost: row.providerHost ?? undefined,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
})

export const getProjectGitCredentialBinding = async (projectId: string, userId: string): Promise<ProjectGitCredentialBinding | null> => {
  await ensurePostgresReady()
  const rows = await getDrizzleDb()
    .select()
    .from(projectGitCredentialBindings)
    .where(and(
      eq(projectGitCredentialBindings.projectId, projectId),
      eq(projectGitCredentialBindings.userId, userId),
    ))
    .limit(1)

  return rows[0] ? mapBindingRow(rows[0]) : null
}

export const listProjectGitCredentialBindings = async (projectId: string): Promise<ProjectGitCredentialBinding[]> => {
  await ensurePostgresReady()
  const rows = await getDrizzleDb()
    .select()
    .from(projectGitCredentialBindings)
    .where(eq(projectGitCredentialBindings.projectId, projectId))
    .orderBy(desc(projectGitCredentialBindings.updatedAt), desc(projectGitCredentialBindings.createdAt))

  return rows.map(mapBindingRow)
}

export const saveProjectGitCredentialBinding = async (params: {
  projectId: string
  userId: string
  credentialId: string
}): Promise<ProjectGitCredentialBinding> => {
  return saveProjectGitAuthBinding({
    projectId: params.projectId,
    userId: params.userId,
    authSourceType: 'user-credential',
    credentialId: params.credentialId,
  })
}

export const saveProjectGitHubAppInstallationBinding = async (params: {
  projectId: string
  userId: string
  githubInstallationId: number
  githubRepositoryId?: number
  githubRepositoryName?: string
  githubAccountLogin?: string
  githubAccountType?: string
  providerHost?: string
}): Promise<ProjectGitCredentialBinding> => {
  return saveProjectGitAuthBinding({
    projectId: params.projectId,
    userId: params.userId,
    authSourceType: 'github-app-installation',
    githubInstallationId: params.githubInstallationId,
    githubRepositoryId: params.githubRepositoryId,
    githubRepositoryName: params.githubRepositoryName,
    githubAccountLogin: params.githubAccountLogin,
    githubAccountType: params.githubAccountType,
    providerHost: params.providerHost,
  })
}

export const saveProjectGitAuthBinding = async (params: {
  projectId: string
  userId: string
  authSourceType: GitAuthSourceType
  credentialId?: string
  githubInstallationId?: number
  githubRepositoryId?: number
  githubRepositoryName?: string
  githubAccountLogin?: string
  githubAccountType?: string
  providerHost?: string
}): Promise<ProjectGitCredentialBinding> => {
  await ensurePostgresReady()
  const now = new Date().toISOString()
  const current = await getProjectGitCredentialBinding(params.projectId, params.userId)
  const id = current?.id ?? randomUUID()
  const values = {
    id,
    projectId: params.projectId,
    userId: params.userId,
    authSourceType: params.authSourceType,
    credentialId: params.authSourceType === 'user-credential' ? params.credentialId ?? null : null,
    githubInstallationId: params.authSourceType === 'github-app-installation' ? params.githubInstallationId ?? null : null,
    githubRepositoryId: params.authSourceType === 'github-app-installation' ? params.githubRepositoryId ?? null : null,
    githubAccountLogin: params.authSourceType === 'github-app-installation' ? params.githubAccountLogin?.trim() || null : null,
    githubAccountType: params.authSourceType === 'github-app-installation' ? params.githubAccountType?.trim() || null : null,
    githubRepositoryName: params.authSourceType === 'github-app-installation' ? params.githubRepositoryName?.trim() || null : null,
    providerHost: params.providerHost?.trim() || null,
    createdAt: current?.createdAt ?? now,
    updatedAt: now,
  }

  await getDrizzleDb()
    .insert(projectGitCredentialBindings)
    .values(values)
    .onConflictDoUpdate({
      target: [projectGitCredentialBindings.projectId, projectGitCredentialBindings.userId],
      set: {
        authSourceType: values.authSourceType,
        credentialId: values.credentialId,
        githubInstallationId: values.githubInstallationId,
        githubRepositoryId: values.githubRepositoryId,
        githubAccountLogin: values.githubAccountLogin,
        githubAccountType: values.githubAccountType,
        githubRepositoryName: values.githubRepositoryName,
        providerHost: values.providerHost,
        updatedAt: values.updatedAt,
      },
    })

  const binding = await getProjectGitCredentialBinding(params.projectId, params.userId)
  if (!binding) {
    throw new Error('保存项目 Git 身份绑定失败。')
  }

  return binding
}

export const deleteProjectGitCredentialBinding = async (projectId: string, userId: string) => {
  await ensurePostgresReady()
  const rows = await getDrizzleDb()
    .delete(projectGitCredentialBindings)
    .where(and(
      eq(projectGitCredentialBindings.projectId, projectId),
      eq(projectGitCredentialBindings.userId, userId),
    ))
    .returning({ id: projectGitCredentialBindings.id })
  return rows.length > 0
}

export const deleteBindingsForCredential = async (userId: string, credentialId: string) => {
  await ensurePostgresReady()
  await getDrizzleDb()
    .delete(projectGitCredentialBindings)
    .where(and(
      eq(projectGitCredentialBindings.userId, userId),
      eq(projectGitCredentialBindings.credentialId, credentialId),
    ))
}

export const deleteBindingsForGitHubInstallation = async (githubInstallationId: number) => {
  await ensurePostgresReady()
  await getDrizzleDb()
    .delete(projectGitCredentialBindings)
    .where(eq(projectGitCredentialBindings.githubInstallationId, githubInstallationId))
}

export const deleteBindingsForUserGitHubInstallation = async (userId: string, githubInstallationId: number) => {
  await ensurePostgresReady()
  await getDrizzleDb()
    .delete(projectGitCredentialBindings)
    .where(and(
      eq(projectGitCredentialBindings.userId, userId),
      eq(projectGitCredentialBindings.githubInstallationId, githubInstallationId),
    ))
}
