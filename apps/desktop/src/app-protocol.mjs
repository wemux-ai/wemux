// [INPUT]: Packaged web root and wemux-app protocol requests.
// [OUTPUT]: Response objects for static assets and SPA navigation fallbacks.
// [POS]: Filesystem-backed protocol adapter used by the packaged Electron renderer.
// [PROTOCOL]: Update this header when protocol response or path-security contracts change, then check AGENTS.md.

import { existsSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'

const CONTENT_TYPES = new Map([
  ['.css', 'text/css; charset=utf-8'],
  ['.html', 'text/html; charset=utf-8'],
  ['.ico', 'image/x-icon'],
  ['.jpeg', 'image/jpeg'],
  ['.jpg', 'image/jpeg'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.png', 'image/png'],
  ['.svg', 'image/svg+xml'],
  ['.webp', 'image/webp'],
  ['.woff', 'font/woff'],
  ['.woff2', 'font/woff2'],
])

const contentTypeForPath = (filePath) => CONTENT_TYPES.get(path.extname(filePath).toLowerCase())
  ?? 'application/octet-stream'

export const createAppProtocolResponse = (webRoot, request) => {
  let pathname
  try {
    pathname = decodeURIComponent(new URL(request.url).pathname)
  } catch {
    return new Response('Bad Request', { status: 400 })
  }

  const requestedPath = path.resolve(webRoot, `.${pathname}`)
  if (requestedPath !== webRoot && !requestedPath.startsWith(`${webRoot}${path.sep}`)) {
    return new Response('Forbidden', { status: 403 })
  }

  const hasFile = existsSync(requestedPath) && statSync(requestedPath).isFile()
  const filePath = hasFile ? requestedPath : path.join(webRoot, 'index.html')
  if (!existsSync(filePath)) return new Response('Not Found', { status: 404 })

  const body = request.method === 'HEAD' ? null : readFileSync(filePath)
  return new Response(body, {
    headers: { 'content-type': contentTypeForPath(filePath) },
  })
}
