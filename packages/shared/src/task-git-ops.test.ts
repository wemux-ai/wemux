import assert from 'node:assert/strict'
import test from 'node:test'
import { buildTaskGitChangeSummary } from './task-git-ops'

test('buildTaskGitChangeSummary summarizes changed files', () => {
  const summary = buildTaskGitChangeSummary([
    { path: 'apps/web/src/index.tsx', status: 'M', additions: 12, deletions: 3 },
    { path: 'packages/shared/src/task-git-ops.ts', status: 'A', additions: 8, deletions: 0 },
  ], 'diff --git a/apps/web/src/index.tsx b/apps/web/src/index.tsx')

  assert.deepEqual(summary, {
    fileCount: 2,
    additions: 20,
    deletions: 3,
    files: [
      { path: 'apps/web/src/index.tsx', status: 'M', additions: 12, deletions: 3 },
      { path: 'packages/shared/src/task-git-ops.ts', status: 'A', additions: 8, deletions: 0 },
    ],
    patch: 'diff --git a/apps/web/src/index.tsx b/apps/web/src/index.tsx',
  })
})

test('buildTaskGitChangeSummary returns undefined for empty or invalid file paths', () => {
  assert.equal(buildTaskGitChangeSummary([]), undefined)
  assert.equal(buildTaskGitChangeSummary([
    { path: '', status: 'M', additions: 10, deletions: 5 },
    { path: '   ', status: 'A', additions: 1, deletions: 0 },
  ]), undefined)
})

test('buildTaskGitChangeSummary clamps invalid stats to zero', () => {
  const summary = buildTaskGitChangeSummary([
    { path: 'README.md', status: 'M', additions: Number.NaN, deletions: -2 },
  ])

  assert.deepEqual(summary, {
    fileCount: 1,
    additions: 0,
    deletions: 0,
    files: [
      { path: 'README.md', status: 'M', additions: 0, deletions: 0 },
    ],
  })
})
