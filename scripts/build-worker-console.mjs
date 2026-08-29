import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import autoprefixer from 'autoprefixer'
import { build } from 'esbuild'
import postcss from 'postcss'
import tailwindcss from 'tailwindcss'

const args = process.argv.slice(2)
const isReleaseBuild = args.includes('--release')
const rootDir = process.cwd()
const outDir = path.join(rootDir, 'dist-worker', 'apps', 'worker', 'web')
const assetsDir = path.join(outDir, 'assets')

await rm(outDir, { recursive: true, force: true })
await mkdir(assetsDir, { recursive: true })

await build({
  entryPoints: [path.join(rootDir, 'apps', 'worker', 'src', 'web', 'main.tsx')],
  outfile: path.join(assetsDir, 'app.js'),
  bundle: true,
  format: 'esm',
  jsx: 'automatic',
  platform: 'browser',
  target: 'es2020',
  sourcemap: !isReleaseBuild,
  minify: isReleaseBuild,
  logLevel: 'info',
  define: {
    'process.env.NODE_ENV': JSON.stringify(isReleaseBuild ? 'production' : 'development'),
  },
})

const cssInput = await readFile(path.join(rootDir, 'apps', 'worker', 'src', 'web', 'index.css'), 'utf8')
const cssOutput = await postcss([
  tailwindcss(path.join(rootDir, 'tailwind.config.ts')),
  autoprefixer(),
]).process(cssInput, {
  from: path.join(rootDir, 'apps', 'worker', 'src', 'web', 'index.css'),
  to: path.join(assetsDir, 'app.css'),
  map: isReleaseBuild ? false : { inline: false },
})

await writeFile(path.join(assetsDir, 'app.css'), cssOutput.css, 'utf8')
if (cssOutput.map) {
  await writeFile(path.join(assetsDir, 'app.css.map'), cssOutput.map.toString(), 'utf8')
}
await writeFile(path.join(outDir, 'index.html'), `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>wemux Worker</title>
    <link rel="stylesheet" href="/assets/app.css" />
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/assets/app.js"></script>
  </body>
</html>
`, 'utf8')
