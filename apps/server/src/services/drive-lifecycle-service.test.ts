import assert from 'node:assert/strict'
import test from 'node:test'

import {
  DRIVE_LARGE_FILE_THRESHOLD_BYTES,
  DRIVE_RECYCLE_RETENTION_DAYS,
  planDriveLifecycleActions,
  type DriveLifecycleFileRow,
} from './drive-lifecycle-service'

const iso = (daysAgo: number) => {
  const value = new Date()
  value.setDate(value.getDate() - daysAgo)
  return value.toISOString()
}

const row = (overrides: Partial<DriveLifecycleFileRow> = {}): DriveLifecycleFileRow => ({
  id: 'f-1',
  createdBy: 'u-1',
  sizeBytes: 100,
  s3Key: 'drive/key',
  fileType: 'file',
  deletedAt: null,
  createdAt: iso(100),
  ...overrides,
})

test('未删除且被引用的免费用户文件保留（不软删）', () => {
  const plan = planDriveLifecycleActions([row({})], new Set(['f-1']), new Set())
  assert.deepEqual(plan, { softDeleteIds: [], purgeIds: [] })
})

test('未删除且无引用的免费用户文件软删进回收站', () => {
  const plan = planDriveLifecycleActions([row({})], new Set(), new Set())
  assert.deepEqual(plan, { softDeleteIds: ['f-1'], purgeIds: [] })
})

test('手动软删文件超 30 天物理删除（即使仍被引用）', () => {
  const plan = planDriveLifecycleActions(
    [row({ deletedAt: iso(DRIVE_RECYCLE_RETENTION_DAYS + 1) })],
    new Set(['f-1']),
    new Set(),
  )
  assert.deepEqual(plan, { softDeleteIds: [], purgeIds: ['f-1'] })
})

test('软删文件不足 30 天保留在回收站', () => {
  const plan = planDriveLifecycleActions(
    [row({ deletedAt: iso(DRIVE_RECYCLE_RETENTION_DAYS - 1) })],
    new Set(),
    new Set(),
  )
  assert.deepEqual(plan, { softDeleteIds: [], purgeIds: [] })
})

test('手动软删的文件夹超 30 天也会物理删除', () => {
  const plan = planDriveLifecycleActions(
    [row({ id: 'dir-1', fileType: 'folder', s3Key: null, deletedAt: iso(DRIVE_RECYCLE_RETENTION_DAYS + 1) })],
    new Set(),
    new Set(),
  )
  assert.deepEqual(plan, { softDeleteIds: [], purgeIds: ['dir-1'] })
})

test('未删除的文件夹不参与孤儿软删', () => {
  const plan = planDriveLifecycleActions([row({ id: 'dir-1', fileType: 'folder', s3Key: null })], new Set(), new Set())
  assert.deepEqual(plan, { softDeleteIds: [], purgeIds: [] })
})

test('付费用户软删文件永久保留（不物理删除）', () => {
  const plan = planDriveLifecycleActions(
    [row({ createdBy: 'paid-1', deletedAt: iso(DRIVE_RECYCLE_RETENTION_DAYS + 30) })],
    new Set(),
    new Set(['paid-1']),
  )
  assert.deepEqual(plan, { softDeleteIds: [], purgeIds: [] })
})

test('付费用户孤儿文件也不软删（永久保留）', () => {
  const plan = planDriveLifecycleActions([row({ createdBy: 'paid-1' })], new Set(), new Set(['paid-1']))
  assert.deepEqual(plan, { softDeleteIds: [], purgeIds: [] })
})

test('大文件孤儿无引用满 90 天才软删', () => {
  const recentLarge = row({ sizeBytes: DRIVE_LARGE_FILE_THRESHOLD_BYTES + 1, createdAt: iso(30) })
  const plan = planDriveLifecycleActions([recentLarge], new Set(), new Set())
  assert.deepEqual(plan, { softDeleteIds: [], purgeIds: [] })

  const oldLarge = row({ sizeBytes: DRIVE_LARGE_FILE_THRESHOLD_BYTES + 1, createdAt: iso(91) })
  const plan2 = planDriveLifecycleActions([oldLarge], new Set(), new Set())
  assert.deepEqual(plan2, { softDeleteIds: ['f-1'], purgeIds: [] })
})
