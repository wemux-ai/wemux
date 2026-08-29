/**
 * [INPUT]: drive_files / drive_file_references 表与 billing plan 快照。
 * [OUTPUT]: 免费用户回收站（孤儿软删 + 手动软删统一入口）到期物理删除；付费用户文件永久保留。
 * [POS]: Drive 回收站生命周期服务（R8.3 v4 定稿：免费 = 消息半年 + 附件/手动删除 30 天回收站；付费 = 永久）。
 *        纯决策逻辑抽到 planDriveLifecycleActions，便于单测；DB 读写与 R2 删除在 applyDriveOrphanCleanup 落地。
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */

import { getDrizzleDb } from '../storage/postgres/drizzle-db'
import { driveFileReferences, driveFiles } from '../storage/postgres/schema-core'
import { deleteDriveFileRecord, softDeleteDriveFile } from '../repositories/drive-store'
import { deleteDriveObject } from './drive-storage'
import { getCommercialGate } from './gate/commercial-gate'

/** 回收站保留期：软删后 30 天物理删除（v4 定稿）。 */
export const DRIVE_RECYCLE_RETENTION_DAYS = 30

/** 大文件阈值：超过该大小的孤儿附件走更保守流程（无引用 90 天后再进回收站）。 */
export const DRIVE_LARGE_FILE_THRESHOLD_BYTES = 50 * 1024 * 1024
const DRIVE_LARGE_FILE_ORPHAN_GRACE_DAYS = 90

/** 调度间隔：每日一次。 */
const DRIVE_LIFECYCLE_SWEEP_INTERVAL_MS = 24 * 60 * 60 * 1000

export type DriveLifecycleReport = {
  softDeletedCount: number
  purgedCount: number
}

/** 生命周期决策所需的最小文件行（含文件夹，用于覆盖手动软删文件夹的 30 天物理删除）。 */
export type DriveLifecycleFileRow = {
  id: string
  createdBy: string
  sizeBytes: number | null
  s3Key: string | null
  fileType: 'folder' | 'file'
  deletedAt: string | null
  createdAt: string
}

export type DriveLifecyclePlan = {
  softDeleteIds: string[]
  purgeIds: string[]
}

const daysAgoIso = (now: Date, days: number) => {
  const value = new Date(now)
  value.setDate(value.getDate() - days)
  return value.toISOString()
}

/**
 * 纯决策：给定文件行、被引用文件集合与付费 owner 集合，输出本轮应软删 / 物理删除的文件 id。
 * - 孤儿软删只针对文件（文件夹不按孤儿处理）：未删除、无引用 → 软删进回收站（大文件需无引用满 90 天）
 * - 物理删除覆盖所有软删记录（文件 + 文件夹，含手动软删与孤儿软删），超 30 天即物理删除
 * - 付费 owner 的文件全程跳过（永久保存：不孤儿清理、不物理删除）
 */
export const planDriveLifecycleActions = (
  rows: DriveLifecycleFileRow[],
  referencedFileIds: Set<string>,
  paidOwnerIds: Set<string>,
  now = new Date(),
): DriveLifecyclePlan => {
  const softDeleteIds: string[] = []
  const purgeIds: string[] = []

  for (const row of rows) {
    if (paidOwnerIds.has(row.createdBy)) continue

    // 回收站内超期：物理删除（手动软删与孤儿软删统一走这里）。
    if (row.deletedAt !== null) {
      if (row.deletedAt <= daysAgoIso(now, DRIVE_RECYCLE_RETENTION_DAYS)) {
        purgeIds.push(row.id)
      }
      continue
    }

    // 未删除的文件夹不参与孤儿清理（文件夹无引用语义，不能当作孤儿）。
    if (row.fileType !== 'file') continue

    if (referencedFileIds.has(row.id)) continue
    const largeFile = (row.sizeBytes ?? 0) > DRIVE_LARGE_FILE_THRESHOLD_BYTES
    if (largeFile && row.createdAt > daysAgoIso(now, DRIVE_LARGE_FILE_ORPHAN_GRACE_DAYS)) continue
    softDeleteIds.push(row.id)
  }

  return { softDeleteIds, purgeIds }
}

/**
 * 回收站清理（免费用户）：
 * 1) 未删除且无引用的孤儿文件 → 软删进回收站（>50MB 需无引用满 90 天，避免大文件误删）
 * 2) 回收站内超 30 天的文件/文件夹 → 物理删除（R2 对象 + 记录）
 * 付费用户（drive_files.createdBy 的 plan !== 'free'）全程跳过，永久保留。
 */
export const applyDriveOrphanCleanup = async (now = new Date()): Promise<DriveLifecycleReport> => {
  const db = getDrizzleDb()

  const rows: DriveLifecycleFileRow[] = await db
    .select({
      id: driveFiles.id,
      createdBy: driveFiles.createdBy,
      sizeBytes: driveFiles.sizeBytes,
      s3Key: driveFiles.s3Key,
      fileType: driveFiles.fileType,
      deletedAt: driveFiles.deletedAt,
      createdAt: driveFiles.createdAt,
    })
    .from(driveFiles)

  const ownerIds = [...new Set(rows.map((row) => row.createdBy).filter(Boolean))]
  const paidOwnerIds = new Set<string>()
  for (const ownerId of ownerIds) {
    const snapshot = await getCommercialGate().resolveBillingPolicySnapshot(ownerId).catch(() => null)
    if (snapshot && snapshot.plan !== 'free') {
      paidOwnerIds.add(ownerId)
    }
  }

  const referencedRows = await db
    .selectDistinct({ fileId: driveFileReferences.fileId })
    .from(driveFileReferences)
  const referencedFileIds = new Set(referencedRows.map((row) => row.fileId))

  const plan = planDriveLifecycleActions(rows, referencedFileIds, paidOwnerIds, now)
  const rowsById = new Map(rows.map((row) => [row.id, row]))

  for (const id of plan.softDeleteIds) {
    await softDeleteDriveFile(id)
  }

  let purgedCount = 0
  for (const id of plan.purgeIds) {
    const row = rowsById.get(id)
    if (row?.fileType === 'file' && row.s3Key) {
      await deleteDriveObject(row.s3Key).catch((error) => {
        console.error(`[drive-lifecycle] failed to delete object ${row.s3Key}`, error)
      })
    }
    await deleteDriveFileRecord(id)
    purgedCount += 1
  }

  return { softDeletedCount: plan.softDeleteIds.length, purgedCount }
}

let lifecycleTimer: ReturnType<typeof setInterval> | null = null

export const startDriveLifecycleSchedule = () => {
  if (lifecycleTimer !== null) {
    return
  }

  lifecycleTimer = setInterval(() => {
    void applyDriveOrphanCleanup()
      .then((report) => {
        if (report.softDeletedCount > 0 || report.purgedCount > 0) {
          console.log(`[drive-lifecycle] recycled ${report.softDeletedCount} orphan files, purged ${report.purgedCount} trashed files`)
        }
      })
      .catch((error) => {
        console.error('[drive-lifecycle] sweep failed', error)
      })
  }, DRIVE_LIFECYCLE_SWEEP_INTERVAL_MS)
  lifecycleTimer.unref?.()
}

export const stopDriveLifecycleSchedule = () => {
  if (lifecycleTimer !== null) {
    clearInterval(lifecycleTimer)
    lifecycleTimer = null
  }
}
