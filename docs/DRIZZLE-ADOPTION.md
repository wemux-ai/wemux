# Drizzle Adoption Progress

Last updated: 2026-07-09

## Goal

Postgres **schema typing**, **query construction**, and **DDL migrations** are owned by Drizzle.

- Server is the only database access layer.
- Web / worker / `packages/shared` must **not** import Drizzle schema or DB helpers.
- Domain types stay in `@shared/*`; Drizzle row types stay inside `apps/server/src/storage/postgres/*`.

## Status: cut over

| Area | Status |
| --- | --- |
| Query layer | Done — stores / git services use `getDrizzleDb` |
| Schema TS | Done — `schema.ts` + `schema-core.ts` (73 tables) |
| DDL migrations | Done — `drizzle/0000_*.sql` + `ensurePostgresReady()` → `migrate()` |
| Legacy startup SQL | **Removed** — `db-schema-statements.ts` / `db-migration-statements.ts` deleted |
| Existing DBs | Auto-baseline when `public.users` exists and journal is empty |

## Runtime

| Piece | Path |
| --- | --- |
| Pool + migrate | `db.ts` → `ensurePostgresReady()` |
| Query helper | `drizzle-db.ts` → `getDrizzleDb()`, `withDrizzleTransaction()` |
| Schema | `schema.ts`, `schema-core.ts` |
| Migrations | `apps/server/src/storage/postgres/drizzle/` |
| Manual baseline | `pnpm db:baseline` (`scripts/db-baseline-drizzle.mjs`) |

### Boot behaviour

1. Connect pool  
2. If `public.users` exists and `drizzle.__drizzle_migrations` is empty → **auto-baseline** current journal entries  
3. `migrate()` applies any **pending** SQL files  
4. App continues  

Empty database → step 2 skipped → `0000` creates full schema.

## Day-to-day schema change

```bash
# 1. edit apps/server/src/storage/postgres/schema.ts or schema-core.ts
pnpm db:generate
# 2. review drizzle/000x_*.sql
pnpm db:migrate   # or just start the server
# 3. commit schema + drizzle/*
```

## Deploy notes (preview / prod)

| Situation | Action |
| --- | --- |
| Empty new DB | Deploy server or `pnpm db:migrate` |
| Existing DB (old hand SQL era) | First boot auto-baselines; no need to re-run 0000 CREATE |
| After baseline | Only new `0001+` files apply on later deploys |

You do **not** need to keep dual-writing hand SQL.

Optional explicit baseline before first Drizzle boot:

```bash
pnpm db:baseline
```

## Commands

| Command | Purpose |
| --- | --- |
| `pnpm db:generate` | Generate migration from schema |
| `pnpm db:migrate` | Apply migrations |
| `pnpm db:baseline` | Mark current migrations applied without SQL |
| `pnpm db:studio` | Browse DB |

## Validation log

| Date | Check | Result |
| --- | --- | --- |
| 2026-07-09 | Query layer + schema 73/73 | OK |
| 2026-07-09 | Empty DB migrate 73 tables | OK |
| 2026-07-09 | Local UI smoke login→project→workspace | OK |
| 2026-07-09 | Cutover: delete hand SQL; ensurePostgresReady=drizzle only; auto-baseline | empty/main/auto-baseline smoke OK |

## Related

- [Wiki: 数据库规范](./wiki/09-database-conventions.md)
