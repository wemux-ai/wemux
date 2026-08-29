// 为 Electron 桌面客户端生成静态 web 产物：
//   apps/web/native-static/ ← .output/public 静态资源 + SPA shell index.html + version.json
// 与已退役的 Cloudflare Pages 静态导出脚本 SPA 壳逻辑一致，但不包含营销 SEO/docs（原生壳只需 app shell）。
// 用法：先 pnpm build:client，再 node scripts/export-native-web-static.mjs
import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const repoRoot = process.cwd()
const webPublicDir = path.resolve(repoRoot, 'apps/web/.output/public')
const webRendererFile = path.resolve(repoRoot, 'apps/web/.output/server/_chunks/renderer-template.mjs')
const outputDir = path.resolve(repoRoot, 'apps/web/native-static')

const siteOrigin = 'https://wemux.ai'

const renderShellHtml = async (requestPath) => {
  const rendererTemplate = (await import(pathToFileURL(webRendererFile).href)).default
  const response = await rendererTemplate({
    req: new Request(new URL(requestPath, siteOrigin), { method: 'GET' }),
  })
  if (typeof response?.text === 'function') return await response.text()
  if (typeof response?.body === 'string') return response.body
  return String(response?.body ?? '')
}

const textAssetExtensions = new Set(['.css', '.html', '.js', '.json', '.mjs'])

const rewriteNativeAssetReferences = async (directory) => {
  const entries = await readdir(directory, { withFileTypes: true })
  for (const entry of entries) {
    const filePath = path.join(directory, entry.name)
    if (entry.isDirectory()) {
      await rewriteNativeAssetReferences(filePath)
      continue
    }

    if (!textAssetExtensions.has(path.extname(entry.name))) continue
    const source = await readFile(filePath, 'utf8')
    // Native shells use custom schemes. Root-relative local assets
    // resolve against the host root instead of the bundled frontend directory.
    const rewritten = source.replace(/(["'`(=])\/assets\//g, '$1./assets/')
    if (rewritten !== source) await writeFile(filePath, rewritten, 'utf8')
  }
}

const main = async () => {
  await rm(outputDir, { recursive: true, force: true })
  await mkdir(outputDir, { recursive: true })
  await cp(webPublicDir, outputDir, { recursive: true })

  // SPA 壳：客户端路由（/chat /workspace /meeting-records 等）由 TanStack Router 客户端渲染
  let shellHtml = await renderShellHtml('/dashboard')
  // 原生资产协议相对化：把 /assets/...、/favicon.png 等绝对路径改为 ./ 相对路径，
  // 避免自定义协议下资源加载失败导致黑屏。
  shellHtml = shellHtml.replace(/(src|href)="\//g, '$1="./')
  await writeFile(path.resolve(outputDir, 'index.html'), shellHtml, 'utf8')
  await rewriteNativeAssetReferences(outputDir)

  const unresolvedAssetReferences = []
  const inspectFiles = async (directory) => {
    const entries = await readdir(directory, { withFileTypes: true })
    for (const entry of entries) {
      const filePath = path.join(directory, entry.name)
      if (entry.isDirectory()) {
        await inspectFiles(filePath)
        continue
      }
      if (!textAssetExtensions.has(path.extname(entry.name)) || entry.name === 'sw.js') continue
      const source = await readFile(filePath, 'utf8')
      if (/(^["'`(=]|[^.A-Za-z0-9_-])\/assets\//m.test(source)) {
        unresolvedAssetReferences.push(path.relative(outputDir, filePath))
      }
    }
  }
  await inspectFiles(outputDir)
  if (unresolvedAssetReferences.length > 0) {
    throw new Error(`native-static contains root-relative asset references: ${unresolvedAssetReferences.join(', ')}`)
  }

  const { version } = JSON.parse(await readFile(path.resolve(repoRoot, 'package.json'), 'utf8'))
  await writeFile(path.resolve(outputDir, 'version.json'), JSON.stringify({ version, buildId: version }, null, 2), 'utf8')

  console.log(`[native-static] 输出到 ${outputDir}（index.html + ${shellHtml.length} 字节 SPA 壳）`)
}

await main()
