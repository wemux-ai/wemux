import path from 'node:path'
import { access, cp, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { build } from 'esbuild'

const outdir = 'dist-server'
const drizzleCoreSourceDir = 'apps/server/src/storage/postgres/drizzle-core'
const drizzleCoreOutDir = path.join(outdir, 'apps/server/src/storage/postgres/drizzle-core')
const drizzleEnterpriseSourceDir = 'apps/server/src/enterprise/storage/drizzle-enterprise'
const drizzleEnterpriseOutDir = path.join(outdir, 'apps/server/src/enterprise/storage/drizzle-enterprise')
const commercialExtensionEntry = 'apps/server/src/enterprise/index.ts'

const entryPoints = [
  'apps/server/src/control-plane-entry.ts',
  'apps/worker/src/index.ts',
]
if (existsSync(commercialExtensionEntry)) {
  entryPoints.push(commercialExtensionEntry)
}

await rm(outdir, { recursive: true, force: true })

await build({
  entryPoints,
  outdir,
  outbase: '.',
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node22',
  packages: 'external',
  tsconfig: 'tsconfig.server.json',
  sourcemap: true,
  logLevel: 'info',
  loader: {
    // Vite's `?raw` imports (e.g. marketing-content.ts loading .md files)
    // are bundled into the server entry; esbuild needs a text loader to match.
    '.md': 'text',
  },
})

await cp(drizzleCoreSourceDir, drizzleCoreOutDir, { recursive: true })
try {
  await access(drizzleEnterpriseSourceDir)
  await cp(drizzleEnterpriseSourceDir, drizzleEnterpriseOutDir, { recursive: true })
} catch (error) {
  if (error && typeof error === 'object' && 'code' in error && error.code !== 'ENOENT') {
    throw error
  }
}
