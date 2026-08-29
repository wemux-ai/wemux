// [INPUT]: web 构建产物（renderer template / SSR server bundle / 静态资源目录）
// [OUTPUT]: SSR shell 渲染原语（renderClientShell / renderSsrApp / loadShellHtml / renderShellPage）
//           与静态文件服务（servePublicFile）；loadShellHtml/renderShellPage 支持 injectHead 注入点
// [POS]: 控制面 web shell 基础设施——不含任何 marketing/docs SEO 逻辑；
//        marketing/docs 域经 enterprise/marketing-entry 以 injectHead + fallback 工具复用本模块
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

export const publicDir = path.resolve(process.cwd(), 'apps/web/.output/public')
const ssrServerFile = path.resolve(process.cwd(), 'apps/web/.output/server/_ssr/ssr.mjs')
const rendererTemplateFile = path.resolve(process.cwd(), 'apps/web/.output/server/_chunks/renderer-template.mjs')
const assetsPrefix = `${path.resolve(publicDir, 'assets')}${path.sep}`
const publicDirPrefix = `${publicDir}${path.sep}`
const seoBlockPattern = /<!-- wemux-seo:start -->[\s\S]*?<!-- wemux-seo:end -->/
export const rootMarkupPattern = /<div id="root"><\/div>/
const htmlLangPattern = /<html lang="[^"]+">/

type RenderIndexHTML = (event: { req: Request }) => Response | Promise<Response>
type SsrServerHandler = {
  fetch: (request: Request) => Response | Promise<Response>
}

interface ResponseLike {
  body?: BodyInit | null
  headers: Headers
  status: number
  statusText: string
}

let rendererTemplatePromise: Promise<RenderIndexHTML> | null = null
let ssrServerPromise: Promise<SsrServerHandler> | null = null

const getRendererTemplate = () => {
  if (!rendererTemplatePromise) {
    rendererTemplatePromise = import(pathToFileURL(rendererTemplateFile).href).then(
      (mod) => mod.default as RenderIndexHTML,
    )
  }

  return rendererTemplatePromise
}

const getSsrServer = () => {
  if (!ssrServerPromise) {
    ssrServerPromise = import(pathToFileURL(ssrServerFile).href).then(
      (mod) => mod.default as SsrServerHandler,
    )
  }

  return ssrServerPromise
}

const getContentType = (filePath: string) => {
  switch (path.extname(filePath)) {
    case '.html':
      return 'text/html; charset=utf-8'
    case '.css':
      return 'text/css; charset=utf-8'
    case '.js':
      return 'application/javascript; charset=utf-8'
    case '.json':
    case '.webmanifest':
      return 'application/manifest+json; charset=utf-8'
    case '.png':
      return 'image/png'
    case '.svg':
      return 'image/svg+xml'
    case '.txt':
      return 'text/plain; charset=utf-8'
    case '.xml':
      return 'application/xml; charset=utf-8'
    case '.woff2':
      return 'font/woff2'
    default:
      return 'application/octet-stream'
  }
}

const resolvePublicFile = (requestPath: string) => {
  const basename = path.posix.basename(requestPath)
  if (!basename.includes('.')) {
    return null
  }

  const normalizedPath = requestPath.startsWith('/') ? requestPath.slice(1) : requestPath
  if (!normalizedPath) {
    return null
  }

  const filePath = path.resolve(publicDir, normalizedPath)
  if (filePath === publicDir || !filePath.startsWith(publicDirPrefix)) {
    return null
  }

  return filePath
}

export const servePublicFile = async (requestPath: string) => {
  const filePath = resolvePublicFile(requestPath)
  if (!filePath) {
    return null
  }

  try {
    const body = await readFile(filePath)
    const headers: Record<string, string> = {
      'Content-Type': getContentType(filePath),
    }

    if (filePath.startsWith(assetsPrefix)) {
      headers['Cache-Control'] = 'public, max-age=31536000, immutable'
    }

    return new Response(body, { headers })
  } catch {
    return null
  }
}

export const renderClientShell = async (request: Request) => {
  const renderIndexHTML = await getRendererTemplate()
  const response = (await renderIndexHTML({ req: request })) as ResponseLike
  const body = request.method === 'HEAD' ? null : (response.body ?? null)

  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  })
}

export const renderSsrApp = async (request: Request) => {
  const ssrServer = await getSsrServer()
  return await ssrServer.fetch(request)
}

/**
 * 渲染 shell HTML。`injectHead` 存在时把 SEO block 替换为注入器产物并统一 html lang；
 * 不存在时输出无 SEO 的纯 shell（公开版/应用内路径默认形态）。
 */
export const loadShellHtml = async (
  request: Request,
  injectHead?: (html: string) => string,
) => {
  const shellRequest = request.method === 'HEAD'
    ? new Request(request.url, { headers: request.headers, method: 'GET' })
    : request
  const shellResponse = await renderClientShell(shellRequest)
  let html = await shellResponse.text()

  if (injectHead) {
    html = html
      .replace(seoBlockPattern, injectHead(html))
      .replace(htmlLangPattern, '<html lang="en">')
  }

  return {
    headers: new Headers(shellResponse.headers),
    html,
    status: shellResponse.status,
    statusText: shellResponse.statusText,
  }
}

/** 无 SEO 简化版 shell 页渲染；需要 SEO 时由调用方传 injectHead。 */
export const renderShellPage = async (
  request: Request,
  injectHead?: (html: string) => string,
) => {
  const { headers, html, status, statusText } = await loadShellHtml(request, injectHead)
  headers.set('Content-Type', 'text/html; charset=utf-8')

  return new Response(request.method === 'HEAD' ? null : html, {
    status,
    statusText,
    headers,
  })
}
