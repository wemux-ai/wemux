import { drizzle } from 'drizzle-orm/node-postgres'

import { ensurePostgresReady, getPool } from './db'
import * as schema from './schema'

const createDrizzleDb = () => drizzle(getPool(), { schema })

let db: ReturnType<typeof createDrizzleDb> | null = null

export const getDrizzleDb = () => {
  if (!db) {
    db = createDrizzleDb()
  }

  return db
}

/** 数据库连接切换后重置单例（让 getDrizzleDb 基于新 pool 重建）。 */
export const resetDrizzleDb = () => {
  db = null
}

export type DrizzleDb = ReturnType<typeof getDrizzleDb>

/**
 * Run work in a Drizzle transaction on the shared pool.
 * Prefer this over withClient() for multi-statement CRUD that already uses the query builder.
 * Keep withClient() for stores still on raw pg, or for client.query-specific needs.
 */
export const withDrizzleTransaction = async <T>(
  callback: (tx: Parameters<Parameters<DrizzleDb['transaction']>[0]>[0]) => Promise<T>,
): Promise<T> => {
  await ensurePostgresReady()
  return getDrizzleDb().transaction(callback)
}
