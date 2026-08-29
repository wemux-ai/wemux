import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { resolveRemoteRepoBranchSnapshot, shouldPreferLocalBranchSnapshot } from './local-git-repository'
import { buildLocalSnapshotBranchSources, mergeRemoteSnapshotBranchSources } from './local-git-repository'

test('buildLocalSnapshotBranchSources marks every branch as local-only', () => {
  assert.deepEqual(buildLocalSnapshotBranchSources(['main', 'feature/x']), {
    main: 'local-only',
    'feature/x': 'local-only',
  })
})

test('buildLocalSnapshotBranchSources handles an empty list', () => {
  assert.deepEqual(buildLocalSnapshotBranchSources([]), {})
})

test('mergeRemoteSnapshotBranchSources without a local repo keeps remote branches and marks them remote', () => {
  assert.deepEqual(mergeRemoteSnapshotBranchSources({
    remoteBranches: ['main', 'release/v1'],
  }), {
    branches: ['main', 'release/v1'],
    branchSources: {
      main: 'remote',
      'release/v1': 'remote',
    },
  })
})

test('mergeRemoteSnapshotBranchSources marks local-only branches that exist locally but not remotely', () => {
  const merged = mergeRemoteSnapshotBranchSources({
    remoteBranches: ['main', 'release/v1'],
    localSnapshotBranches: ['main', 'feature/unpushed'],
  })
  assert.deepEqual(merged.branches, ['feature/unpushed', 'main', 'release/v1'])
  assert.deepEqual(merged.branchSources, {
    main: 'remote',
    'release/v1': 'remote',
    'feature/unpushed': 'local-only',
  })
})

test('mergeRemoteSnapshotBranchSources marks branches present in both sides as remote', () => {
  const merged = mergeRemoteSnapshotBranchSources({
    remoteBranches: ['main'],
    localSnapshotBranches: ['main', 'stale-local'],
  })
  assert.equal(merged.branchSources.main, 'remote')
  assert.equal(merged.branchSources['stale-local'], 'local-only')
})

test('mergeRemoteSnapshotBranchSources deduplicates and sorts the merged list', () => {
  const merged = mergeRemoteSnapshotBranchSources({
    remoteBranches: ['main', 'zeta'],
    localSnapshotBranches: ['main', 'alpha'],
  })
  assert.deepEqual(merged.branches, ['alpha', 'main', 'zeta'])
  assert.equal(merged.branches.length, 3)
})

test('mergeRemoteSnapshotBranchSources with empty local and remote lists yields empty results', () => {
  assert.deepEqual(mergeRemoteSnapshotBranchSources({
    remoteBranches: [],
  }), {
    branches: [],
    branchSources: {},
  })
})

test('shouldPreferLocalBranchSnapshot returns false for a missing directory', async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'vibemux-local-git-'))

  try {
    const result = await shouldPreferLocalBranchSnapshot(path.join(root, 'missing-repo'))
    assert.equal(result, false)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('resolveRemoteRepoBranchSnapshot reports a missing local remote target without simple-git baseDir errors', async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'vibemux-local-git-'))

  try {
    await assert.rejects(
      () => resolveRemoteRepoBranchSnapshot(path.join(root, 'missing-repo'), undefined),
      /仓库未配置 origin，且没有可用的远端仓库地址/,
    )
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
