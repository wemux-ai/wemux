// [INPUT]: device-tokens-routes 的注册/注销调用点
// [OUTPUT]: device_tokens 表的读写
// [POS]: Postgres repository for 推送设备 token（feature 离线推送网关的端侧注册表）
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
import { and, eq } from 'drizzle-orm'
import { ensurePostgresReady } from './db'
import { getDrizzleDb } from './drizzle-db'
import { deviceTokens } from './schema'

type DeviceTokenRow = typeof deviceTokens.$inferSelect

export type DeviceTokenInput = {
  userId: string
  platform: 'android' | 'ios'
  token: string
}

export const upsertDeviceToken = async (input: DeviceTokenInput): Promise<DeviceTokenRow> => {
  await ensurePostgresReady()
  const now = new Date().toISOString()
  const id = `dt:${crypto.randomUUID()}`
  const row: DeviceTokenRow = {
    id,
    userId: input.userId,
    platform: input.platform,
    token: input.token,
    createdAt: now,
    updatedAt: now,
  }
  const [inserted] = await getDrizzleDb()
    .insert(deviceTokens)
    .values(row)
    .onConflictDoUpdate({
      target: [deviceTokens.userId, deviceTokens.token],
      set: { platform: row.platform, updatedAt: now },
    })
    .returning()
  return inserted
}

export const deleteDeviceToken = async (userId: string, id: string): Promise<boolean> => {
  await ensurePostgresReady()
  const deleted = await getDrizzleDb()
    .delete(deviceTokens)
    .where(and(eq(deviceTokens.id, id), eq(deviceTokens.userId, userId)))
    .returning({ id: deviceTokens.id })
  return deleted.length > 0
}

export const listDeviceTokens = async (userId: string): Promise<DeviceTokenRow[]> => {
  await ensurePostgresReady()
  return getDrizzleDb()
    .select()
    .from(deviceTokens)
    .where(eq(deviceTokens.userId, userId))
}
