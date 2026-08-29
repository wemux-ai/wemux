import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { drizzle } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { Pool, type PoolClient, type QueryResult, type QueryResultRow } from 'pg'
import { resetDrizzleDb } from './drizzle-db'

const resolveConnectionString = () => process.env.DATABASE_URL?.trim() || process.env.POSTGRES_URL?.trim() || ''

const hasDrizzleJournal = (dir: string) => fs.existsSync(path.join(dir, 'meta', '_journal.json'))

const resolveMigrationsFolder = () => {
  const fromEnv = process.env.VIBEMUX_DRIZZLE_MIGRATIONS_FOLDER?.trim()
  if (fromEnv) {
    return path.resolve(fromEnv)
  }

  const candidates: string[] = []

  try {
    const moduleDir = path.dirname(fileURLToPath(import.meta.url))
    candidates.push(
      path.join(moduleDir, 'drizzle-core'),
      path.join(moduleDir, 'drizzle'),
      path.join(moduleDir, 'storage', 'postgres', 'drizzle-core'),
      path.join(moduleDir, 'storage', 'postgres', 'drizzle'),
    )
  } catch {
    // Ignore import.meta.url resolution failures and fall back to cwd-based paths below.
  }

  candidates.push(
    path.resolve(process.cwd(), 'apps/server/src/storage/postgres/drizzle-core'),
    path.resolve(process.cwd(), 'apps/server/src/storage/postgres/drizzle'),
    path.resolve(process.cwd(), 'dist-server/apps/server/src/drizzle'),
    path.resolve(process.cwd(), 'dist-server/apps/server/src/storage/postgres/drizzle'),
  )

  return candidates.find(hasDrizzleJournal) ?? candidates[0] ?? path.resolve(process.cwd(), 'apps/server/src/storage/postgres/drizzle-core')
}

/** 企业私有迁移链（随 enterprise/ 目录 deny；开源视图不存在则返回 null）。 */
const resolveEnterpriseMigrationsFolder = () => {
  const candidates = [
    path.resolve(process.cwd(), 'apps/server/src/enterprise/storage/drizzle-enterprise'),
    path.resolve(process.cwd(), 'dist-server/apps/server/src/enterprise/storage/drizzle-enterprise'),
  ]

  return candidates.find(hasDrizzleJournal) ?? null
}

type JournalEntry = {
  idx: number
  version: string
  when: number
  tag: string
  breakpoints: boolean
}

type JournalFile = {
  version: string
  dialect: string
  entries: JournalEntry[]
}

type SnapshotFile = {
  tables: Record<string, {
    name: string
    schema?: string
    columns: Record<string, { name: string }>
  }>
}

type LegacySchemaValidationResult =
  | { ok: true }
  | { ok: false; missingTables: string[]; missingColumns: string[] }

const DRIZZLE_MIGRATION_LOCK_KEY = 'vibemux:postgres:drizzle-migrations'
const POSTGRES_READY_RETRY_ATTEMPTS = 5
const POSTGRES_READY_RETRY_BASE_MS = 3000

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/**
 * 只在 Postgres 临时不可达时重试（Postgres 容器启动中 / DNS 尚未就绪）。
 * 密码错误（28P01）、迁移 SQL 错误等确定性失败不重试，直接快速失败。
 */
const isTransientPostgresConnectionError = (error: unknown) => {
  if (!(error instanceof Error)) return false
  const code = (error as Error & { code?: string }).code
  if (code && ['ENOTFOUND', 'ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', '57P03'].includes(code)) {
    return true
  }
  return /ENOTFOUND|ECONNREFUSED|ECONNRESET|ETIMEDOUT|database system is starting up/i.test(error.message)
}
// Columns that pre-Drizzle legacy DBs legitimately miss at baseline time. They are
// backfilled by the migration chain (0057_repair_legacy_publish_policy.sql), which runs
// right after the baseline is recorded, so the baseline validation tolerates exactly
// these gaps instead of patching them with hand-written startup DDL.
const LEGACY_BASELINE_COMPATIBILITY_COLUMNS = new Set([
  'distributed_tasks.publish_policy',
  'distributed_tasks.git_auth_preference',
  'workspace_sessions.publish_policy',
  'workspace_sessions.git_auth_preference',
])

let pool: Pool | null = null
let ready = false
let readyPromise: Promise<void> | null = null

/** 当前活跃连接串（默认来自 env，可用部署配置覆盖）。 */
let activeConnectionString = resolveConnectionString()

export const getActiveConnectionString = () => activeConnectionString

/** 连接池上限：默认 20（pg 默认 10 在高并发 API 下会排队），可用 VIBEMUX_PG_POOL_MAX 覆盖。 */
const readPoolMax = () => {
  const raw = process.env.VIBEMUX_PG_POOL_MAX?.trim()
  const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 20
}

const createPool = (connectionString = activeConnectionString) => {
  if (!connectionString) {
    throw new Error('Postgres is required. Please set DATABASE_URL or POSTGRES_URL.')
  }

  return new Pool({
    connectionString,
    max: readPoolMax(),
    // 拿连接超时（pg 默认 0 = 无限等待）：10s 内拿不到连接快速失败，避免请求悬挂。
    connectionTimeoutMillis: 10_000,
    // 空闲连接回收：30s 释放空闲连接，避免长期占满 Postgres max_connections。
    idleTimeoutMillis: 30_000,
  })
}

/**
 * 运行中切换数据库连接（不停机换主库的核心）：
 * 测试新连接 → 新建 pool 替换当前 pool → 重置 drizzle 单例（新库需重跑 migrate 校验）→ 优雅 drain 旧 pool。
 * 失败自动回退（不改动当前 pool）。
 */
export const switchDatabaseConnection = async (url: string): Promise<{ ok: true } | { ok: false; message: string }> => {
  const trimmed = url.trim()
  if (!trimmed) {
    return { ok: false, message: '连接串为空' }
  }
  const probe = new Pool({ connectionString: trimmed, connectionTimeoutMillis: 5000 })
  try {
    await probe.query('SELECT 1')
  } catch (error) {
    await probe.end().catch(() => {})
    return { ok: false, message: error instanceof Error ? `新库连接失败：${error.message}` : '新库连接失败' }
  }
  await probe.end().catch(() => {})

  const newPool = createPool(trimmed)
  try {
    await newPool.query('SELECT 1')
  } catch (error) {
    await newPool.end().catch(() => {})
    return { ok: false, message: error instanceof Error ? `新库初始化失败：${error.message}` : '新库初始化失败' }
  }

  const oldPool = pool
  pool = newPool
  activeConnectionString = trimmed
  ready = false
  readyPromise = null
  resetDrizzleDb()
  if (oldPool) {
    void oldPool.end().catch(() => {})
  }
  return { ok: true }
}

export const getPool = () => {
  if (!pool) {
    pool = createPool()
  }

  return pool
}

export const withPostgresLease = async <T>(
  leaseKey: string,
  callback: () => Promise<T>,
): Promise<{ acquired: false } | { acquired: true; value: T }> => {
  await ensurePostgresReady()
  const client = await getPool().connect()
  let acquired = false
  try {
    const result = await client.query<{ acquired: boolean }>(
      'SELECT pg_try_advisory_lock(hashtext($1::text)) AS acquired',
      [leaseKey],
    )
    acquired = result.rows[0]?.acquired === true
    if (!acquired) {
      return { acquired: false }
    }
    return { acquired: true, value: await callback() }
  } finally {
    if (acquired) {
      await client.query('SELECT pg_advisory_unlock(hashtext($1::text))', [leaseKey]).catch(() => undefined)
    }
    client.release()
  }
}

/**
 * 迁移 journal 启动前完整性校验（fail-fast）。
 * drizzle migrate() 通过比较每个 entry 的 `when`（folderMillis）与 __drizzle_migrations
 * 中最新 `created_at` 来判定「待应用」；若某 entry 的 `when` 早于前一个 entry（典型：多分支
 * 各自 generate 撞了相同序号、合并时手工重编号但时间戳没修），migrate() 会**静默跳过**该迁移，
 * 导致「journal 记录了但 ALTER 没执行」的半迁移状态——即 2026-08-14 0065 生产事故的根因。
 * 这里在 migrate() 前直接抛错，避免带病启动。
 */
export const validateMigrationJournalIntegrity = (migrationsFolder: string) => {
  const journalPath = path.join(migrationsFolder, 'meta', '_journal.json')
  if (!fs.existsSync(journalPath)) {
    throw new Error(`Drizzle journal not found: ${journalPath}. Run pnpm db:generate.`)
  }

  const journal = JSON.parse(fs.readFileSync(journalPath, 'utf8')) as JournalFile
  if (!Array.isArray(journal.entries) || journal.entries.length === 0) {
    throw new Error(`Drizzle journal has no entries: ${journalPath}`)
  }

  let previousWhen = -1
  journal.entries.forEach((entry, index) => {
    if (entry.idx !== index) {
      throw new Error(
        `Drizzle journal idx mismatch at ${entry.tag}: expected ${index}, got ${entry.idx}. `
        + 'The journal was renumbered by hand; rebuild it with pnpm db:generate.',
      )
    }
    if (entry.when <= previousWhen) {
      throw new Error(
        `Drizzle journal "when" timestamps are not strictly increasing at ${entry.tag} `
        + `(when=${entry.when}, previous=${previousWhen}). Out-of-order timestamps make migrate() `
        + 'silently skip the migration and leave the schema half-migrated. Fix the journal before deploying.',
      )
    }
    previousWhen = entry.when

    const sqlPath = path.join(migrationsFolder, `${entry.tag}.sql`)
    if (!fs.existsSync(sqlPath)) {
      throw new Error(`Missing Drizzle migration SQL: ${sqlPath}`)
    }
  })
}

const readMigrationJournal = (migrationsFolder: string) => {
  const journalPath = path.join(migrationsFolder, 'meta', '_journal.json')
  if (!fs.existsSync(journalPath)) {
    throw new Error(`Drizzle journal not found: ${journalPath}. Run pnpm db:generate.`)
  }

  const journal = JSON.parse(fs.readFileSync(journalPath, 'utf8')) as JournalFile
  if (!Array.isArray(journal.entries) || journal.entries.length === 0) {
    throw new Error(`Drizzle journal has no entries: ${journalPath}`)
  }

  return journal.entries.map((entry) => {
    const sqlPath = path.join(migrationsFolder, `${entry.tag}.sql`)
    if (!fs.existsSync(sqlPath)) {
      throw new Error(`Missing Drizzle migration SQL: ${sqlPath}`)
    }

    const sql = fs.readFileSync(sqlPath, 'utf8')
    return {
      idx: entry.idx,
      tag: entry.tag,
      when: entry.when,
      hash: createHash('sha256').update(sql).digest('hex'),
    }
  })
}

const readMigrationSnapshot = (migrationsFolder: string, migrationIndex: number) => {
  const snapshotPath = path.join(migrationsFolder, 'meta', `${String(migrationIndex).padStart(4, '0')}_snapshot.json`)
  if (!fs.existsSync(snapshotPath)) {
    throw new Error(`Drizzle snapshot not found: ${snapshotPath}. Run pnpm db:generate.`)
  }

  return JSON.parse(fs.readFileSync(snapshotPath, 'utf8')) as SnapshotFile
}

const validateLegacySchemaMatchesSnapshot = async (
  currentPool: Pool,
  snapshot: SnapshotFile,
): Promise<LegacySchemaValidationResult> => {
  const tableResult = await currentPool.query<{ table_name: string }>(`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
  `)
  const existingTables = new Set(tableResult.rows.map((row) => row.table_name))

  const columnResult = await currentPool.query<{ table_name: string; column_name: string }>(`
    SELECT table_name, column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
  `)
  const existingColumnsByTable = new Map<string, Set<string>>()
  for (const row of columnResult.rows) {
    const columns = existingColumnsByTable.get(row.table_name) ?? new Set<string>()
    columns.add(row.column_name)
    existingColumnsByTable.set(row.table_name, columns)
  }

  const missingTables: string[] = []
  const missingColumns: string[] = []
  for (const table of Object.values(snapshot.tables)) {
    const tableName = table.name
    if (!existingTables.has(tableName)) {
      missingTables.push(tableName)
      continue
    }

    const existingColumns = existingColumnsByTable.get(tableName) ?? new Set<string>()
    for (const column of Object.values(table.columns)) {
      if (!existingColumns.has(column.name)) {
        missingColumns.push(`${tableName}.${column.name}`)
      }
    }
  }

  if (missingTables.length > 0 || missingColumns.length > 0) {
    return { ok: false, missingTables, missingColumns }
  }

  return { ok: true }
}

const ensureDrizzleJournalTable = async (currentPool: Pool) => {
  await currentPool.query('CREATE SCHEMA IF NOT EXISTS drizzle')
  await currentPool.query(`
    CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (
      id SERIAL PRIMARY KEY,
      hash text NOT NULL,
      created_at bigint
    )
  `)
}

export const canTolerateLegacyBaselineCompatibilityColumns = (validation: LegacySchemaValidationResult) => {
  return !validation.ok
    && validation.missingTables.length === 0
    && validation.missingColumns.length > 0
    && validation.missingColumns.every((column) => LEGACY_BASELINE_COMPATIBILITY_COLUMNS.has(column))
}

const withPostgresAdvisoryLock = async <T>(
  currentPool: Pool,
  lockKey: string,
  callback: () => Promise<T>,
): Promise<T> => {
  const client = await currentPool.connect()
  let locked = false
  try {
    await client.query('SELECT pg_advisory_lock(hashtext($1::text))', [lockKey])
    locked = true
    return await callback()
  } finally {
    try {
      if (locked) {
        await client.query('SELECT pg_advisory_unlock(hashtext($1::text))', [lockKey])
      }
    } finally {
      client.release()
    }
  }
}

/**
 * Existing databases that were built by the old startup SQL path have tables but no
 * Drizzle journal. Mark only the bootstrap migration as applied, after verifying
 * the live schema covers that snapshot; future migrations must still run normally.
 */
const baselineIfLegacySchemaPresent = async (currentPool: Pool, migrationsFolder: string) => {
  await ensureDrizzleJournalTable(currentPool)

  const journalCount = await currentPool.query<{ count: string }>(
    'SELECT COUNT(*)::text AS count FROM drizzle.__drizzle_migrations',
  )
  if (Number(journalCount.rows[0]?.count ?? '0') > 0) {
    return { baselined: false, reason: 'journal-already-present' as const }
  }

  const legacyMarker = await currentPool.query<{ exists: boolean }>(`
    SELECT EXISTS (
      SELECT 1
      FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'users'
    ) AS exists
  `)

  if (!legacyMarker.rows[0]?.exists) {
    return { baselined: false, reason: 'empty-database' as const }
  }

  const migrations = readMigrationJournal(migrationsFolder)
  const bootstrapMigration = migrations[0]
  if (!bootstrapMigration) {
    throw new Error(`Drizzle journal has no bootstrap migration: ${migrationsFolder}`)
  }

  const validation = await validateLegacySchemaMatchesSnapshot(
    currentPool,
    readMigrationSnapshot(migrationsFolder, bootstrapMigration.idx),
  )

  if (validation.ok === false) {
    const knownLegacyGaps = canTolerateLegacyBaselineCompatibilityColumns(validation)
    if (knownLegacyGaps) {
      // Known legacy gaps that the migration chain (0057) backfills right after baseline;
      // do not hand-write DDL here — DDL lives in Drizzle migrations only.
      console.info(
        `[postgres] Legacy baseline: tolerating known column gaps backfilled by migrations: ${validation.missingColumns.join(', ')}`,
      )
    } else {
      throw new Error(
        [
          'Refusing to auto-baseline legacy Postgres schema because it does not match the Drizzle bootstrap snapshot.',
          validation.missingTables.length > 0 ? `Missing tables: ${validation.missingTables.slice(0, 20).join(', ')}` : '',
          validation.missingColumns.length > 0 ? `Missing columns: ${validation.missingColumns.slice(0, 40).join(', ')}` : '',
          'Run a reviewed manual migration or restore the expected legacy schema before starting the server.',
        ].filter(Boolean).join(' '),
      )
    }
  }

  await currentPool.query(
    'INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES ($1, $2)',
    [bootstrapMigration.hash, bootstrapMigration.when],
  )

  console.info(
    `[postgres] Auto-baselined Drizzle bootstrap migration ${bootstrapMigration.tag} for verified legacy schema`,
  )
  return { baselined: true, reason: 'legacy-schema' as const, count: 1 }
}

const applyDrizzleMigrations = async (currentPool: Pool) => {
  // 核心链（drizzle-core，公开自托管亦可用；fallback 旧 drizzle/ 兼容存量）
  const migrationsFolder = resolveMigrationsFolder()
  console.info(`[postgres] DDL=drizzle migrationsFolder=${migrationsFolder}`)

  // Fail fast before touching the DB: a broken/out-of-order journal must never reach migrate().
  validateMigrationJournalIntegrity(migrationsFolder)

  await withPostgresAdvisoryLock(currentPool, DRIZZLE_MIGRATION_LOCK_KEY, async () => {
    await baselineIfLegacySchemaPresent(currentPool, migrationsFolder)

    const db = drizzle(currentPool)
    await migrate(db, { migrationsFolder })
  })

  // 企业私有链（drizzle-enterprise）：存在才 migrate；开源视图无此目录则跳过。
  const enterpriseFolder = resolveEnterpriseMigrationsFolder()
  if (enterpriseFolder) {
    console.info(`[postgres] DDL=drizzle-enterprise migrationsFolder=${enterpriseFolder}`)
    validateMigrationJournalIntegrity(enterpriseFolder)

    await withPostgresAdvisoryLock(currentPool, DRIZZLE_MIGRATION_LOCK_KEY, async () => {
      const db = drizzle(currentPool)
      await migrate(db, { migrationsFolder: enterpriseFolder })
    })
  }
}

/**
 * 迁移后 schema 漂移自检（read-only 诊断，最后一道防线）。
 * migrate() 结束后，用最新 snapshot 比对 live DB 的表/列，缺了什么立即报出来——
 * 目标是把「迁移记录在但 DDL 没真正落库」这类 0065 级事故从「运行时才炸」提前到「启动即发现」。
 * 默认只打 ERROR 不阻断（避免对未知历史库的部署硬失败）；设 VIBEMUX_DB_STRICT_SCHEMA_CHECK=1 时改为抛错拒启。
 */
const verifyPostMigrationSchema = async (currentPool: Pool, migrationsFolder: string) => {
  const migrations = readMigrationJournal(migrationsFolder)
  const latest = migrations[migrations.length - 1]
  if (!latest) {
    return
  }

  const validation = await validateLegacySchemaMatchesSnapshot(
    currentPool,
    readMigrationSnapshot(migrationsFolder, latest.idx),
  )
  if (validation.ok) {
    return
  }

  if (canTolerateLegacyBaselineCompatibilityColumns(validation)) {
    console.info(
      `[postgres] schema drift: tolerating known legacy gaps backfilled by migrations: ${validation.missingColumns.join(', ')}`,
    )
    return
  }

  const { missingTables, missingColumns } = validation
  const summary = [
    missingTables.length > 0 ? `missing tables: ${missingTables.slice(0, 20).join(', ')}` : '',
    missingColumns.length > 0 ? `missing columns: ${missingColumns.slice(0, 40).join(', ')}` : '',
  ].filter(Boolean).join('; ')

  const message =
    `[postgres] POST-MIGRATE SCHEMA DRIFT DETECTED — live DB is missing schema that migrations declare (${summary}). `
    + 'This usually means a migration was recorded but not applied, or the DB was edited out-of-band. '
    + 'Fix the schema before serving traffic (see the database migration documentation).'

  if (process.env.VIBEMUX_DB_STRICT_SCHEMA_CHECK === '1') {
    throw new Error(message)
  }
  console.error(message)
}

export const ensurePostgresReady = async () => {
  if (ready) {
    return
  }

  if (!readyPromise) {
    readyPromise = (async () => {
      const currentPool = getPool()
      let lastError: unknown

      for (let attempt = 1; attempt <= POSTGRES_READY_RETRY_ATTEMPTS; attempt += 1) {
        try {
          await applyDrizzleMigrations(currentPool)
          await applyLegacySchemaPatches(currentPool)
          await verifyPostMigrationSchema(currentPool, resolveMigrationsFolder())
          const enterpriseFolder = resolveEnterpriseMigrationsFolder()
          if (enterpriseFolder) {
            await verifyPostMigrationSchema(currentPool, enterpriseFolder)
          }
          ready = true
          return
        } catch (error) {
          lastError = error
          const retryable = isTransientPostgresConnectionError(error)
          if (attempt === POSTGRES_READY_RETRY_ATTEMPTS || !retryable) {
            break
          }
          const waitMs = POSTGRES_READY_RETRY_BASE_MS * 2 ** (attempt - 1)
          console.warn(
            `[postgres] Postgres 暂不可达（第 ${attempt}/${POSTGRES_READY_RETRY_ATTEMPTS} 次），${waitMs}ms 后重试：`
            + `${error instanceof Error ? error.message : String(error)}`,
          )
          await delay(waitMs)
        }
      }

      // 失败后重置，允许下一次调用重新尝试（否则 readyPromise 会永远停留在 rejected）。
      readyPromise = null

      const message = lastError instanceof Error ? lastError.message : String(lastError)
      const code = lastError instanceof Error ? (lastError as Error & { code?: string }).code : undefined
      if (code === '28P01' || /password authentication failed/i.test(message)) {
        throw new Error(
          `Postgres 密码认证失败（DATABASE_URL 密码与 Postgres 实例不一致）：${message}。`
          + '请用 Postgres 服务自身的 DATABASE_URL 为准同步 app 的 DATABASE_URL，或检查镜像切换后密码是否重置。',
        )
      }
      throw new Error(
        `Postgres 未就绪（已重试 ${POSTGRES_READY_RETRY_ATTEMPTS} 次）：${message}。`
        + '请确认 DATABASE_URL 正确且 Postgres 服务已启动。',
      )
    })()
  }

  await readyPromise
}

/**
 * 历史库启动自愈兜底（last-resort recovery net，与 0057_repair / 0061_repair 同思路）。
 * 作用对象：在「journal 序号撞车 / 时间戳乱序」修复前已经部署的历史库，可能缺 users 新列
 * （0056/0059 因迁移记录错乱未应用）或 conversations 群聊四列（0065 因 when 乱序被 migrate 静默跳过）。
 * 全部 ADD COLUMN IF NOT EXISTS，幂等、任意中间态可安全重放；全新库（表不存在）自动跳过。
 * 注意：这只是兑底，不是 DDL 主路径——主路径仍是 Drizzle migration；
 * journal 完整性与单调性由 validateMigrationJournalIntegrity 在 migrate() 前保证，
 * 未来新迁移不应再依赖这里的补列。
 */
const applyLegacySchemaPatches = async (pool: Pool): Promise<void> => {
  try {
    const exists = await pool.query(`SELECT to_regclass('public.users') AS t`)
    if (!(exists.rows[0] as { t: string | null }).t) {
      return
    }
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS "status" text DEFAULT 'active' NOT NULL`)
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS "role" text DEFAULT 'user' NOT NULL`)
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS "email_verified_at" text`)
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS "last_login_at" text`)
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS "last_login_ip" text`)
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS "suspended_until" text`)
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS "banned_reason" text`)
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS "banned_at" text`)
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS "support_note" text`)
    // A historical migration may have been skipped when an older journal was out of order:
    // conversations 缺 description/announcement 系会直接导致主聊天启动查询失败（column does not exist）。
    // 与 users 补列同思路，幂等兜底（与 0065 DDL 保持同构，仅加 IF NOT EXISTS）。
    const conversationsExists = await pool.query(`SELECT to_regclass('public.conversations') AS t`)
    if ((conversationsExists.rows[0] as { t: string | null }).t) {
      await pool.query(`ALTER TABLE conversations ADD COLUMN IF NOT EXISTS "description" text`)
      await pool.query(`ALTER TABLE conversations ADD COLUMN IF NOT EXISTS "announcement" text`)
      await pool.query(`ALTER TABLE conversations ADD COLUMN IF NOT EXISTS "announcement_updated_at" text`)
      await pool.query(`ALTER TABLE conversations ADD COLUMN IF NOT EXISTS "announcement_updated_by" text`)
    }
  } catch (error) {
    console.error('[postgres] legacy schema patch failed', error instanceof Error ? error.message : error)
  }
}

export const query = async <T extends QueryResultRow = Record<string, unknown>>(text: string, values?: unknown[]) => {
  await ensurePostgresReady()
  return getPool().query<T>(text, values)
}

export const withClient = async <T>(callback: (client: PoolClient) => Promise<T>) => {
  await ensurePostgresReady()
  const client = await getPool().connect()
  try {
    await client.query('BEGIN')
    const result = await callback(client)
    await client.query('COMMIT')
    return result
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

export const getPostgresHealth = async () => {
  try {
    const result = await query<{ ok: number }>('SELECT 1 AS ok')
    return { ok: true, connected: result.rowCount === 1, ddl: 'drizzle' as const }
  } catch (error) {
    return {
      ok: false,
      connected: false,
      ddl: 'drizzle' as const,
      message: error instanceof Error ? error.message : 'postgres health failed',
    }
  }
}

export const isPostgresConfigured = () => Boolean(resolveConnectionString())

export const closePostgres = async () => {
  if (!pool) {
    return
  }

  await pool.end()
  pool = null
  ready = false
  readyPromise = null
}

export type PostgresQueryResult<T extends QueryResultRow = Record<string, unknown>> = QueryResult<T>
