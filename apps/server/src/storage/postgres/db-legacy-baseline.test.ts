// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
// [INPUT]: Legacy schema validation result against the Drizzle bootstrap snapshot.
// [OUTPUT]: Whether the missing columns are exactly the known gaps the migration
//           chain (0057_repair_legacy_publish_policy) backfills after baseline.
// [POS]: Drizzle legacy baseline policy; DDL must live in migrations, not startup code.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { canTolerateLegacyBaselineCompatibilityColumns } from './db'

test('tolerates exactly the known legacy publish_policy / git_auth_preference gaps', () => {
  const result = canTolerateLegacyBaselineCompatibilityColumns({
    ok: false,
    missingTables: [],
    missingColumns: [
      'distributed_tasks.publish_policy',
      'distributed_tasks.git_auth_preference',
      'workspace_sessions.publish_policy',
      'workspace_sessions.git_auth_preference',
    ],
  })
  assert.equal(result, true)
})

test('tolerates a single known gap', () => {
  const result = canTolerateLegacyBaselineCompatibilityColumns({
    ok: false,
    missingTables: [],
    missingColumns: ['distributed_tasks.publish_policy'],
  })
  assert.equal(result, true)
})

test('rejects unknown missing columns (schema drift must fail startup)', () => {
  const result = canTolerateLegacyBaselineCompatibilityColumns({
    ok: false,
    missingTables: [],
    missingColumns: ['workspaces.code_base_branch'],
  })
  assert.equal(result, false)
})

test('rejects missing tables', () => {
  const result = canTolerateLegacyBaselineCompatibilityColumns({
    ok: false,
    missingTables: ['project_issues'],
    missingColumns: ['distributed_tasks.publish_policy'],
  })
  assert.equal(result, false)
})

test('rejects a matching validation result', () => {
  const result = canTolerateLegacyBaselineCompatibilityColumns({ ok: true })
  assert.equal(result, false)
})
