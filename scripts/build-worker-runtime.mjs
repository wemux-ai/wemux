import { rm } from 'node:fs/promises'
import { build } from 'esbuild'

const args = process.argv.slice(2)
const outdir = 'dist-worker'
const isReleaseBuild = args.includes('--release')

await rm(outdir, { recursive: true, force: true })

await build({
  entryPoints: ['apps/worker/src/index.ts'],
  outdir,
  outbase: '.',
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node22',
  // Keep runtime deps with their own module boundary so Node can load the
  // package's native format instead of an esbuild-shimmed dynamic require.
  external: [
    '@mariozechner/pi-coding-agent',
    '@modelcontextprotocol/sdk',
    '@opencode-ai/sdk',
    'dotenv',
    'dotenv/config',
    'node-pty',
    'simple-git',
    'ws',
  ],
  tsconfig: 'tsconfig.server.json',
  sourcemap: !isReleaseBuild,
  minify: isReleaseBuild,
  keepNames: !isReleaseBuild,
  legalComments: isReleaseBuild ? 'none' : 'inline',
  logLevel: 'info',
})
