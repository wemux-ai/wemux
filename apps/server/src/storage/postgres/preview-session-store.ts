import { desc } from 'drizzle-orm'

import type { PreviewSessionRecord } from '../../services/preview-session-record'
import { ensurePostgresReady } from './db'
import { getDrizzleDb } from './drizzle-db'
import { cloneJson, schedulePersistence } from './helpers'
import { previewSessions } from './schema'

type PreviewSessionRow = typeof previewSessions.$inferSelect

const cache = new Map<string, PreviewSessionRecord>()

const mapRow = (row: PreviewSessionRow): PreviewSessionRecord => ({
  id: row.id,
  purpose: row.purpose ?? 'app',
  projectId: row.projectId,
  taskId: row.taskId,
  workspaceId: row.workspaceId,
  workspaceSessionId: row.workspaceSessionId,
  executorId: row.executorId,
  ownerUserId: row.ownerUserId,
  executionSurface: row.executionSurface,
  accessMode: row.accessMode ?? 'tunnel',
  status: row.status,
  closeReason: row.closeReason ?? undefined,
  source: ('source' in row.sourceJson ? row.sourceJson.source : row.sourceJson),
  sourceBinding: ('source' in row.sourceJson ? row.sourceJson.sourceBinding : undefined),
  additionalSources: ('source' in row.sourceJson ? (row.sourceJson.additionalSources ?? []) : []),
  additionalSourceBindings: ('source' in row.sourceJson ? (row.sourceJson.additionalSourceBindings ?? []) : []),
  publicHost: row.publicHost,
  publicUrl: row.publicUrl,
  tunnelTokenHash: row.tunnelTokenHash,
  tunnelConnectedAt: row.tunnelConnectedAt ?? undefined,
  tunnelDisconnectedAt: row.tunnelDisconnectedAt ?? undefined,
  tunnelClientStatus: row.tunnelClientStatus ?? undefined,
  tunnelConnectionId: row.tunnelConnectionId ?? undefined,
  tunnelConnectedNodeId: row.tunnelConnectedNodeId ?? undefined,
  shareTokenHash: row.shareTokenHash ?? undefined,
  shareUrl: row.shareUrl ?? undefined,
  shareTokenExpiresAt: row.shareTokenExpiresAt ?? undefined,
  shareRevokedAt: row.shareRevokedAt ?? undefined,
  lastShareIssuedAt: row.lastShareIssuedAt ?? undefined,
  lastError: row.lastError ?? undefined,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
})

const persistPreviewSession = async (session: PreviewSessionRecord) => {
  await ensurePostgresReady()
  await getDrizzleDb()
    .insert(previewSessions)
    .values({
      id: session.id,
      purpose: session.purpose,
      projectId: session.projectId,
      taskId: session.taskId,
      workspaceId: session.workspaceId,
      workspaceSessionId: session.workspaceSessionId,
      executorId: session.executorId,
      ownerUserId: session.ownerUserId,
      executionSurface: session.executionSurface,
      accessMode: session.accessMode,
      status: session.status,
      closeReason: session.closeReason ?? null,
      sourceJson: {
        source: session.source,
        sourceBinding: session.sourceBinding,
        additionalSources: session.additionalSources,
        additionalSourceBindings: session.additionalSourceBindings,
      },
      publicHost: session.publicHost,
      publicUrl: session.publicUrl,
      tunnelTokenHash: session.tunnelTokenHash,
      tunnelConnectedAt: session.tunnelConnectedAt ?? null,
      tunnelDisconnectedAt: session.tunnelDisconnectedAt ?? null,
      tunnelClientStatus: session.tunnelClientStatus ?? null,
      tunnelConnectionId: session.tunnelConnectionId ?? null,
      tunnelConnectedNodeId: session.tunnelConnectedNodeId ?? null,
      shareTokenHash: session.shareTokenHash ?? null,
      shareUrl: session.shareUrl ?? null,
      shareTokenExpiresAt: session.shareTokenExpiresAt ?? null,
      shareRevokedAt: session.shareRevokedAt ?? null,
      lastShareIssuedAt: session.lastShareIssuedAt ?? null,
      lastError: session.lastError ?? null,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
    })
    .onConflictDoUpdate({
      target: previewSessions.id,
      set: {
        purpose: session.purpose,
        projectId: session.projectId,
        taskId: session.taskId,
        workspaceId: session.workspaceId,
        workspaceSessionId: session.workspaceSessionId,
        executorId: session.executorId,
        ownerUserId: session.ownerUserId,
        executionSurface: session.executionSurface,
        accessMode: session.accessMode,
        status: session.status,
        closeReason: session.closeReason ?? null,
        sourceJson: {
          source: session.source,
          sourceBinding: session.sourceBinding,
          additionalSources: session.additionalSources,
          additionalSourceBindings: session.additionalSourceBindings,
        },
        publicHost: session.publicHost,
        publicUrl: session.publicUrl,
        tunnelTokenHash: session.tunnelTokenHash,
        tunnelConnectedAt: session.tunnelConnectedAt ?? null,
        tunnelDisconnectedAt: session.tunnelDisconnectedAt ?? null,
        tunnelClientStatus: session.tunnelClientStatus ?? null,
        tunnelConnectionId: session.tunnelConnectionId ?? null,
        tunnelConnectedNodeId: session.tunnelConnectedNodeId ?? null,
        shareTokenHash: session.shareTokenHash ?? null,
        shareUrl: session.shareUrl ?? null,
        shareTokenExpiresAt: session.shareTokenExpiresAt ?? null,
        shareRevokedAt: session.shareRevokedAt ?? null,
        lastShareIssuedAt: session.lastShareIssuedAt ?? null,
        lastError: session.lastError ?? null,
        updatedAt: session.updatedAt,
      },
    })
}

export const initPreviewSessionStore = async () => {
  await ensurePostgresReady()
  const rows = await getDrizzleDb()
    .select()
    .from(previewSessions)
    .orderBy(desc(previewSessions.updatedAt), desc(previewSessions.createdAt))
  cache.clear()
  for (const row of rows) {
    const session = mapRow(row)
    cache.set(session.id, session)
  }
}

export const listPersistedPreviewSessions = () => {
  return Array.from(cache.values()).map((session) => cloneJson(session))
}

export const savePersistedPreviewSession = (session: PreviewSessionRecord) => {
  cache.set(session.id, cloneJson(session))
  schedulePersistence(`save-preview-session:${session.id}`, persistPreviewSession(session))
}
