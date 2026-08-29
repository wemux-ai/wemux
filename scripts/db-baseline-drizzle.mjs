#!/usr/bin/env node
/**
 * Mark the current Drizzle migration journal as "already applied" WITHOUT running SQL.
 *
 * Use this only on databases whose live schema already matches the baseline snapshot
 * (i.e. built by legacy ensurePostgresReady / previous greenfield migrate).
 *
 * Usage:
 *   DATABASE_URL=postgres://... node scripts/db-baseline-drizzle.mjs
 *   pnpm db:baseline
 *
 * Safety:
 *   - Refuses if __drizzle_migrations already has rows (unless --force)
 *   - Does not CREATE / ALTER tables
 */

import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import pg from 'pg'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')
const drizzleDir = path.join(root, 'apps/server/src/storage/postgres/drizzle-core')
const journalPath = path.join(drizzleDir, 'meta', '_journal.json')

const force = process.argv.includes('--force')
const connectionString = process.env.DATABASE_URL?.trim() || process.env.POSTGRES_URL?.trim() || ''

if (!connectionString) {
  console.error('DATABASE_URL or POSTGRES_URL is required')
  process.exit(1)
}

if (!fs.existsSync(journalPath)) {
  console.error(`Missing journal: ${journalPath}. Run pnpm db:generate first.`)
  process.exit(1)
}

const journal = JSON.parse(fs.readFileSync(journalPath, 'utf8'))
const entries = Array.isArray(journal.entries) ? journal.entries : []
if (entries.length === 0) {
  console.error('Journal has no entries')
  process.exit(1)
}

const migrations = entries.map((entry) => {
  const sqlPath = path.join(drizzleDir, `${entry.tag}.sql`)
  if (!fs.existsSync(sqlPath)) {
    throw new Error(`Missing migration SQL: ${sqlPath}`)
  }
  const sql = fs.readFileSync(sqlPath, 'utf8')
  const hash = createHash('sha256').update(sql).digest('hex')
  return {
    tag: entry.tag,
    when: entry.when,
    hash,
    sqlPath,
  }
})

const client = new pg.Client({ connectionString })
await client.connect()

try {
  await client.query('CREATE SCHEMA IF NOT EXISTS drizzle')
  await client.query(`
    CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (
      id SERIAL PRIMARY KEY,
      hash text NOT NULL,
      created_at bigint
    )
  `)

  const existing = await client.query('SELECT id, hash, created_at FROM drizzle.__drizzle_migrations ORDER BY id')
  if (existing.rowCount > 0 && !force) {
    console.log('Baseline already present (drizzle.__drizzle_migrations has rows). Use --force to re-write.')
    console.table(existing.rows)
    process.exit(0)
  }

  if (force && existing.rowCount > 0) {
    await client.query('DELETE FROM drizzle.__drizzle_migrations')
    console.log(`Cleared ${existing.rowCount} existing journal row(s) (--force)`)
  }

  for (const migration of migrations) {
    await client.query(
      'INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES ($1, $2)',
      [migration.hash, migration.when],
    )
    console.log(`baselined ${migration.tag} hash=${migration.hash.slice(0, 12)}… when=${migration.when}`)
  }

  console.log(`OK: baselined ${migrations.length} migration(s) on ${new URL(connectionString).pathname}`)
  console.log('Next: pnpm db:migrate should report nothing pending / apply only new files.')
} finally {
  await client.end()
}
