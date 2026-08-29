import { defineConfig } from 'drizzle-kit'

const connectionString = process.env.DATABASE_URL?.trim() || process.env.POSTGRES_URL?.trim() || ''

// 公开核心链：schema.ts（核心 118 表，不含 enterprise 商业/运维表）
export default defineConfig({
  schema: './apps/server/src/storage/postgres/schema.ts',
  out: './apps/server/src/storage/postgres/drizzle-core',
  dialect: 'postgresql',
  dbCredentials: {
    url: connectionString,
  },
  strict: true,
  verbose: true,
})
