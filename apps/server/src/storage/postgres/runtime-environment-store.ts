import { eq } from 'drizzle-orm'

import type { RuntimeEnvironmentConfig } from '@shared/runtime-environment'
import { decryptSecret, encryptSecret } from '../../services/secret-crypto'
import { ensurePostgresReady } from './db'
import { getDrizzleDb } from './drizzle-db'
import { projectRuntimeEnvironmentConfigs, workspaceRuntimeEnvironmentConfigs } from './schema'

type RuntimeEnvironmentRow = {
  deliveryMode: RuntimeEnvironmentConfig['mode']
  fileName: string | null
  contentEncrypted: string
}

const mapRowToConfig = (row?: RuntimeEnvironmentRow | null): RuntimeEnvironmentConfig | null => {
  if (!row?.contentEncrypted) {
    return null
  }

  return {
    mode: row.deliveryMode === 'env-file' ? 'env-file' : 'process-env',
    fileName: row.fileName ?? undefined,
    content: decryptSecret(row.contentEncrypted),
  }
}

export const initRuntimeEnvironmentStore = async () => {
  await ensurePostgresReady()
}

export const getProjectRuntimeEnvironmentConfig = async (projectId: string) => {
  await ensurePostgresReady()
  const rows = await getDrizzleDb()
    .select({
      deliveryMode: projectRuntimeEnvironmentConfigs.deliveryMode,
      fileName: projectRuntimeEnvironmentConfigs.fileName,
      contentEncrypted: projectRuntimeEnvironmentConfigs.contentEncrypted,
    })
    .from(projectRuntimeEnvironmentConfigs)
    .where(eq(projectRuntimeEnvironmentConfigs.projectId, projectId))
    .limit(1)

  return mapRowToConfig(rows[0] ?? null)
}

export const setProjectRuntimeEnvironmentConfig = async (projectId: string, config: RuntimeEnvironmentConfig) => {
  await ensurePostgresReady()
  const now = new Date().toISOString()
  await getDrizzleDb()
    .insert(projectRuntimeEnvironmentConfigs)
    .values({
      projectId,
      deliveryMode: config.mode,
      fileName: config.fileName ?? null,
      contentEncrypted: encryptSecret(config.content),
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: projectRuntimeEnvironmentConfigs.projectId,
      set: {
        deliveryMode: config.mode,
        fileName: config.fileName ?? null,
        contentEncrypted: encryptSecret(config.content),
        updatedAt: now,
      },
    })
}

export const deleteProjectRuntimeEnvironmentConfig = async (projectId: string) => {
  await ensurePostgresReady()
  await getDrizzleDb()
    .delete(projectRuntimeEnvironmentConfigs)
    .where(eq(projectRuntimeEnvironmentConfigs.projectId, projectId))
}

export const getWorkspaceRuntimeEnvironmentConfig = async (workspaceId: string) => {
  await ensurePostgresReady()
  const rows = await getDrizzleDb()
    .select({
      deliveryMode: workspaceRuntimeEnvironmentConfigs.deliveryMode,
      fileName: workspaceRuntimeEnvironmentConfigs.fileName,
      contentEncrypted: workspaceRuntimeEnvironmentConfigs.contentEncrypted,
    })
    .from(workspaceRuntimeEnvironmentConfigs)
    .where(eq(workspaceRuntimeEnvironmentConfigs.workspaceId, workspaceId))
    .limit(1)

  return mapRowToConfig(rows[0] ?? null)
}

export const setWorkspaceRuntimeEnvironmentConfig = async (workspaceId: string, config: RuntimeEnvironmentConfig) => {
  await ensurePostgresReady()
  const now = new Date().toISOString()
  await getDrizzleDb()
    .insert(workspaceRuntimeEnvironmentConfigs)
    .values({
      workspaceId,
      deliveryMode: config.mode,
      fileName: config.fileName ?? null,
      contentEncrypted: encryptSecret(config.content),
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: workspaceRuntimeEnvironmentConfigs.workspaceId,
      set: {
        deliveryMode: config.mode,
        fileName: config.fileName ?? null,
        contentEncrypted: encryptSecret(config.content),
        updatedAt: now,
      },
    })
}

export const deleteWorkspaceRuntimeEnvironmentConfig = async (workspaceId: string) => {
  await ensurePostgresReady()
  await getDrizzleDb()
    .delete(workspaceRuntimeEnvironmentConfigs)
    .where(eq(workspaceRuntimeEnvironmentConfigs.workspaceId, workspaceId))
}
