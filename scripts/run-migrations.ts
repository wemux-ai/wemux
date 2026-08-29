// 应用 Drizzle migrations（CI / 独立环境前置）。
// server 启动时（ensurePostgresReady）也会自动 migrate；本脚本用于需要先于启动建表的场景（如 CI 测试）。
// 与 apps/server/src/storage/postgres/db.ts 使用相同的 drizzle migrate() 路径，保证行为一致。
import { existsSync } from 'node:fs'
import { drizzle } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { Pool } from 'pg'

const databaseUrl = process.env.DATABASE_URL?.trim() || process.env.POSTGRES_URL?.trim()
if (!databaseUrl) {
  console.error('DATABASE_URL 未设置，无法执行迁移。')
  process.exit(1)
}

const pool = new Pool({ connectionString: databaseUrl })
const db = drizzle(pool)
const migrationFolders = ['apps/server/src/storage/postgres/drizzle-core']
const enterpriseMigrationFolder = 'apps/server/src/enterprise/storage/drizzle-enterprise'
if (existsSync(enterpriseMigrationFolder)) {
  migrationFolders.push(enterpriseMigrationFolder)
}
for (const migrationsFolder of migrationFolders) {
  await migrate(db, { migrationsFolder })
}
await pool.end()
console.log('Drizzle migrations applied.')
