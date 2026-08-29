import { and, eq, gt, isNull } from 'drizzle-orm'

import type { ExecutorPairingCodeRecord } from '@shared/types'
import { ensurePostgresReady } from './db'
import { getDrizzleDb } from './drizzle-db'
import { cloneJson } from './helpers'
import { executorPairingCodes } from './schema'

type ExecutorPairingCodeRow = typeof executorPairingCodes.$inferSelect

type ConsumeExecutorPairingCodeResult =
  | { status: 'missing' }
  | { status: 'used'; record: ExecutorPairingCodeRecord }
  | { status: 'expired'; record: ExecutorPairingCodeRecord }
  | { status: 'consumed'; record: ExecutorPairingCodeRecord }

const mapRow = (row: ExecutorPairingCodeRow): ExecutorPairingCodeRecord => ({
  pairingCode: row.pairingCode,
  ownerUserId: row.ownerUserId,
  teamId: row.teamId ?? undefined,
  workspaceIds: Array.isArray(row.workspaceIdsJson)
    ? row.workspaceIdsJson.filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    : (row.teamId ? [row.teamId] : []),
  visibility: row.visibility,
  previewExposureMode: row.previewExposureMode ?? undefined,
  label: row.label ?? undefined,
  createdAt: row.createdAt,
  expiresAt: row.expiresAt,
  usedAt: row.usedAt ?? undefined,
})

export const createPersistedExecutorPairingCode = async (record: ExecutorPairingCodeRecord) => {
  await ensurePostgresReady()
  await getDrizzleDb()
    .insert(executorPairingCodes)
    .values({
      pairingCode: record.pairingCode,
      ownerUserId: record.ownerUserId,
      teamId: record.teamId ?? null,
      workspaceIdsJson: record.workspaceIds ?? (record.teamId ? [record.teamId] : []),
      visibility: record.visibility,
      previewExposureMode: record.previewExposureMode ?? null,
      label: record.label ?? null,
      createdAt: record.createdAt,
      expiresAt: record.expiresAt,
      usedAt: record.usedAt ?? null,
    })
}

export const consumePersistedExecutorPairingCode = async (
  pairingCode: string,
  consumedAt: string,
): Promise<ConsumeExecutorPairingCodeResult> => {
  await ensurePostgresReady()
  return getDrizzleDb().transaction(async (tx) => {
    const existingRows = await tx
      .select()
      .from(executorPairingCodes)
      .where(eq(executorPairingCodes.pairingCode, pairingCode))
      .limit(1)
    const existingRow = existingRows[0]
    if (!existingRow) {
      return { status: 'missing' as const }
    }

    const existingRecord = mapRow(existingRow)
    if (existingRecord.usedAt) {
      return { status: 'used' as const, record: cloneJson(existingRecord) }
    }

    if (new Date(existingRecord.expiresAt).getTime() <= Date.now()) {
      return { status: 'expired' as const, record: cloneJson(existingRecord) }
    }

    const updatedRows = await tx
      .update(executorPairingCodes)
      .set({ usedAt: consumedAt })
      .where(and(
        eq(executorPairingCodes.pairingCode, pairingCode),
        isNull(executorPairingCodes.usedAt),
        gt(executorPairingCodes.expiresAt, consumedAt),
      ))
      .returning()
    const updatedRow = updatedRows[0]
    if (updatedRow) {
      return { status: 'consumed' as const, record: cloneJson(mapRow(updatedRow)) }
    }

    const latestRows = await tx
      .select()
      .from(executorPairingCodes)
      .where(eq(executorPairingCodes.pairingCode, pairingCode))
      .limit(1)
    const latestRow = latestRows[0]
    if (!latestRow) {
      return { status: 'missing' as const }
    }

    const latestRecord = mapRow(latestRow)
    if (latestRecord.usedAt) {
      return { status: 'used' as const, record: cloneJson(latestRecord) }
    }

    return { status: 'expired' as const, record: cloneJson(latestRecord) }
  })
}
