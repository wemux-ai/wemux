// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
// [INPUT]: A migrations folder fixture (meta/_journal.json + NNNN_tag.sql).
// [OUTPUT]: validateMigrationJournalIntegrity throws on non-monotonic "when",
//           non-contiguous idx, or missing SQL; passes on a valid journal.
// [POS]: Drizzle migration journal integrity guard. Fails fast before migrate() so an
//        out-of-order "when" (the 0065 silent-skip class of bug) can never deploy again.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { validateMigrationJournalIntegrity } from './db'

type FixtureEntry = { idx: number; when: number; tag: string }

const writeJournal = (dir: string, entries: FixtureEntry[]) => {
  const meta = path.join(dir, 'meta')
  fs.mkdirSync(meta, { recursive: true })
  fs.writeFileSync(
    path.join(meta, '_journal.json'),
    JSON.stringify({
      version: '7',
      dialect: 'postgresql',
      entries: entries.map((entry) => ({
        idx: entry.idx,
        version: '7',
        when: entry.when,
        tag: entry.tag,
        breakpoints: true,
      })),
    }),
  )
  for (const entry of entries) {
    fs.writeFileSync(path.join(dir, `${entry.tag}.sql`), 'SELECT 1;')
  }
}

const withTempDir = (fn: (dir: string) => void) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'drizzle-journal-test-'))
  try {
    fn(dir)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
}

test('accepts a monotonic, contiguous journal', () => {
  withTempDir((dir) => {
    writeJournal(dir, [
      { idx: 0, when: 100, tag: '0000_a' },
      { idx: 1, when: 200, tag: '0001_b' },
      { idx: 2, when: 300, tag: '0002_c' },
    ])
    assert.doesNotThrow(() => validateMigrationJournalIntegrity(dir))
  })
})

test('rejects a non-monotonic "when" (the 0065 silent-skip class of bug)', () => {
  withTempDir((dir) => {
    writeJournal(dir, [
      { idx: 0, when: 100, tag: '0000_a' },
      { idx: 1, when: 300, tag: '0001_b' },
      { idx: 2, when: 200, tag: '0002_c' },
    ])
    assert.throws(() => validateMigrationJournalIntegrity(dir), /not strictly increasing/)
  })
})

test('rejects equal adjacent "when" timestamps', () => {
  withTempDir((dir) => {
    writeJournal(dir, [
      { idx: 0, when: 100, tag: '0000_a' },
      { idx: 1, when: 100, tag: '0001_b' },
    ])
    assert.throws(() => validateMigrationJournalIntegrity(dir), /not strictly increasing/)
  })
})

test('rejects a non-contiguous idx sequence', () => {
  withTempDir((dir) => {
    writeJournal(dir, [
      { idx: 0, when: 100, tag: '0000_a' },
      { idx: 2, when: 200, tag: '0002_c' },
    ])
    assert.throws(() => validateMigrationJournalIntegrity(dir), /idx mismatch/)
  })
})

test('rejects a missing SQL file', () => {
  withTempDir((dir) => {
    writeJournal(dir, [{ idx: 0, when: 100, tag: '0000_a' }])
    fs.rmSync(path.join(dir, '0000_a.sql'))
    assert.throws(() => validateMigrationJournalIntegrity(dir), /Missing Drizzle migration SQL/)
  })
})

test('rejects a missing journal file', () => {
  withTempDir((dir) => {
    assert.throws(() => validateMigrationJournalIntegrity(dir), /journal not found/)
  })
})
