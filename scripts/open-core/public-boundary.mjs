#!/usr/bin/env node
// [INPUT]: Git tree-ish or staged index
// [OUTPUT]: public branch boundary assertion
// [POS]: Open Core hard boundary shared by local hooks and the public CI.

import { execFileSync } from 'node:child_process'

const args = process.argv.slice(2)
const staged = args.includes('--staged')
const treeIndex = args.indexOf('--tree')
const tree = treeIndex >= 0 ? args[treeIndex + 1] : 'HEAD'

const commercialRoots = [
  'apps/server/src/enterprise',
  'apps/web/src/enterprise',
  'apps/web/src/routes/enterprise',
  'apps/web/tests/enterprise',
  'packages/shared/src/enterprise',
  'scripts/enterprise',
]

// The public core tracks only these local compatibility links. They point at an
// ignored `apps/enterprise` checkout and contain neither a private remote nor
// commercial source. Any regular file below a commercial root remains blocked.
const commercialExtensionMounts = new Map([
  ['apps/server/src/enterprise', '../../enterprise/server'],
  ['apps/web/src/enterprise', '../../enterprise/web'],
  ['packages/shared/src/enterprise', '../../../apps/enterprise/shared'],
  ['scripts/enterprise', '../apps/enterprise/scripts'],
])

const commercialRouteShells = new Set([
  'apps/web/src/routes/enterprise/$.tsx',
])

// Public documentation is deliberately allowlisted. Internal plans and
// operating material live outside the public tree and must be reviewed
// explicitly before a new public document path is introduced.
const publicDocumentation = [
  'docs/README.md',
  'docs/DEV-TEST-AUTH.md',
  'docs/DOCKER-DEV.md',
  'docs/DRIZZLE-ADOPTION.md',
  'docs/GITHUB-RESOURCE-MODEL.md',
  'docs/HYBRID-DEV.md',
  'docs/ICONOGRAPHY.md',
  'docs/LINEAR-STYLE-UI-GUIDE.md',
  'docs/SELF-HOSTING.md',
  'docs/TELEMETRY.md',
  'docs/TESTING-STRATEGY.md',
  'docs/TESTING-SYSTEM.md',
  'docs/THIRD-PARTY-LICENSES.md',
  'docs/WORKER-AGENT-ARCHITECTURE.md',
  'docs/WORKER-LOCAL-STORAGE.md',
  'docs/CLIENT-ARCHITECTURE.md',
  'docs/COMMUNITY-GOVERNANCE.md',
  'docs/project-workspace-git-mode-matrix.md',
  'docs/test-layer-guide.md',
  'docs/test-library.md',
  'docs/wiki/01-project-overview.md',
  'docs/wiki/02-key-concepts.md',
  'docs/wiki/03-execution-architecture.md',
  'docs/wiki/04-directory-structure.md',
  'docs/wiki/05-naming-conventions.md',
  'docs/wiki/06-types-and-shared.md',
  'docs/wiki/07-local-development.md',
  'docs/wiki/08-api-conventions.md',
  'docs/wiki/09-database-conventions.md',
  'docs/wiki/10-runtime-architecture.md',
  'docs/wiki/11-agent-execution-flow.md',
  'docs/wiki/12-skill-and-mcp.md',
  'docs/wiki/13-page-boundaries.md',
  'docs/wiki/14-session-models.md',
  'docs/wiki/15-infrastructure.md',
  'docs/wiki/16-hybrid-development.md',
  'docs/wiki/18-faq.md',
  'docs/wiki/19-cli-and-control-plane-mcp.md',
  'docs/wiki/README.md',
]

const privateRoots = [
  '.agents',
  '.claude-plugin',
  '.claude',
  '.codegraph',
  '.codex',
  '.opencode/skills',
  '.mcp.json',
  'cloudflare',
  'deploy/cloudflare-open-connector.md',
  'deploy/dokploy-open-connector.md',
  'scripts/public-export',
  'scripts/repair-preview-db-0.3.116.sql',
  'apps/server/src/storage/postgres/drizzle',
  'docs/plans',
  'docs/strategy',
  'docs/launch',
  'docs/deploy',
  'docs/product-wiki',
  'docs/voice-research',
  'docs/devLog',
  'docs/pending',
  'docs/strategy/FDE-TOKEN-DISTRIBUTION-BUSINESS.md',
  'docs/settings-billing-gate-summary.md',
  'docs/strategy',
  'docs/test-reports-2026-08-13',
  'docs/deploy/DOKPLOY-SETUP.md',
  'docs/deploy/ENV.preview.md',
  'docs/deploy/ENV.production.md',
  'docs/deploy/ENV.server.md',
  'docs/deploy/MULTI-NODE-SECRETS-CHECKLIST.md',
  'docs/deploy/OPEN-CONNECTOR-OPS.md',
  'docs/deploy/PREVIEW-DEPLOYMENT-STATUS.md',
  'docs/deploy/MULTI-NODE-CLOUDFLARE-LB-ROLLOUT.md',
  'docs/voice-requirements-pm.md',
  'docs/OPEN-CORE-DEVELOPMENT-WORKFLOW.md',
  'docs/OSS-CONTRIBUTION-BLAME-WORKFLOW.md',
  'drizzle.enterprise.config.ts',
  'packages/shared/src/credits.ts',
  'packages/shared/src/credits.test.ts',
  'packages/shared/src/zpay.ts',
  'packages/shared/src/zpay.test.ts',
]

const canaryPatterns = [
  /zpayRecharge/i,
  /partner_commissions/i,
  /credit_node_prices/i,
  /hosted_model_catalog/i,
  /CREEM_/i,
  /connector\.wemux\.xyz/i,
  /internal\.wemux/i,
  /Partner Portal/i,
]

const runGit = (gitArgs, options = {}) => execFileSync('git', gitArgs, {
  encoding: 'utf8',
  stdio: options.stdio ?? ['ignore', 'pipe', 'pipe'],
})

const matchesRoot = (file, root) => file === root || file.startsWith(`${root}/`)
const isAllowedPublicDocument = (file) => publicDocumentation.some((root) => matchesRoot(file, root))
const isPrivatePath = (file) => (
  [...commercialRoots, ...privateRoots].some((root) => matchesRoot(file, root))
  || (file.startsWith('docs/') && !isAllowedPublicDocument(file))
)

const readFile = (file) => staged ? runGit(['show', `:${file}`]) : runGit(['show', `${tree}:${file}`])

const isCommercialExtensionMount = (file) => {
  const expectedTarget = commercialExtensionMounts.get(file)
  if (!expectedTarget) {
    return false
  }
  try {
    return readFile(file).trim() === expectedTarget
  } catch {
    return false
  }
}

const files = staged
  ? runGit(['diff', '--cached', '--name-only', '--diff-filter=ACMR']).split('\n').filter(Boolean)
  : runGit(['ls-tree', '-r', '--name-only', tree]).split('\n').filter(Boolean)

const pathViolations = files.filter((file) => isPrivatePath(file) && !isCommercialExtensionMount(file) && !commercialRouteShells.has(file))
if (pathViolations.length > 0) {
  console.error('Public boundary violation: private/commercial paths are present:')
  for (const file of pathViolations) console.error(`  - ${file}`)
  process.exit(1)
}

const contentViolations = []
for (const file of files) {
  // The checker contains the canary patterns as data; inspecting its own source
  // would make every valid public tree fail its boundary assertion.
  if (file === 'scripts/open-core/public-boundary.mjs') continue
  let content
  try {
    content = readFile(file)
  } catch {
    continue
  }
  if (canaryPatterns.some((pattern) => pattern.test(content))) contentViolations.push(file)
}

if (contentViolations.length > 0) {
  console.error('Public boundary violation: commercial canary detected in:')
  for (const file of contentViolations) console.error(`  - ${file}`)
  process.exit(1)
}

console.log(`Public boundary OK (${staged ? 'staged index' : tree})`)
