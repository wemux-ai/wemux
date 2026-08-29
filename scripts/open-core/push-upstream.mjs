#!/usr/bin/env node
// [INPUT]: local main/cloud branch and matching upstream remote
// [OUTPUT]: guarded normal push (never export, copy, reset, or force-push)
// [POS]: The only supported local command for publishing either upstream.

import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const mode = process.argv.includes('--public')
  ? 'public'
  : null
if (!mode) {
  console.error('Usage: node scripts/open-core/push-upstream.mjs --public')
  process.exit(1)
}

const run = (args, options = {}) => execFileSync('git', args, {
  encoding: 'utf8',
  stdio: options.stdio ?? ['ignore', 'pipe', 'pipe'],
})

const branch = run(['branch', '--show-current']).trim()
const targets = {
  public: { branch: 'main', remote: 'public', remoteBranch: 'main', url: 'wemux-ai/wemux' },
}
const target = targets[mode]
const expectedBranch = target.branch
const remote = target.remote
const remoteBranch = target.remoteBranch
const expectedUrl = target.url
const url = run(['remote', 'get-url', remote]).trim()

if (branch !== expectedBranch) {
  console.error(`Refusing ${mode} push from branch '${branch || '(detached)'}'; switch to '${expectedBranch}'.`)
  process.exit(1)
}
if (!url.toLowerCase().includes(expectedUrl.toLowerCase())) {
  console.error(`Refusing ${mode} push: remote '${remote}' does not point to ${expectedUrl}.`)
  process.exit(1)
}
if (run(['status', '--porcelain']).trim()) {
  console.error('Refusing push with a dirty worktree. Commit first so the boundary checks cover the exact tree.')
  process.exit(1)
}

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
if (mode === 'public') {
  const checker = path.join(repoRoot, 'scripts/open-core/public-boundary.mjs')
  execFileSync(process.execPath, [checker, '--tree', 'HEAD'], { stdio: 'inherit' })
} else {
  try {
    run(['cat-file', '-e', 'HEAD:apps/server/src/enterprise/index.ts'])
  } catch {
    console.error('Refusing cloud push: cloud branch does not contain the enterprise runtime entry.')
    process.exit(1)
  }
}

try {
  const remoteSha = run(['ls-remote', remote, `refs/heads/${remoteBranch}`]).trim().split(/\s+/)[0]
  if (remoteSha && !/^0+$/.test(remoteSha)) {
    run(['merge-base', '--is-ancestor', remoteSha, 'HEAD'])
  }
} catch {
  console.error('Refusing non-fast-forward push. Reconcile the upstream main first; force-push is intentionally disabled.')
  process.exit(1)
}

console.log(`Pushing ${branch} -> ${remote}/${remoteBranch} (normal non-force push)`)
execFileSync('git', ['push', remote, `${branch}:${remoteBranch}`], { stdio: 'inherit' })
