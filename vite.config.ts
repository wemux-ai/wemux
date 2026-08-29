import path from 'node:path'
import { existsSync, readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import http from 'node:http'
import https from 'node:https'
import net from 'node:net'
import { Readable } from 'node:stream'
import tls from 'node:tls'
import type { IncomingMessage, OutgoingHttpHeaders, ServerResponse } from 'node:http'
import type { Socket } from 'node:net'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { nitro } from 'nitro/vite'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import tsconfigPaths from 'vite-tsconfig-paths'
import { build as esbuild } from 'esbuild'

const packageJson = JSON.parse(readFileSync(path.resolve(__dirname, './package.json'), 'utf-8')) as {
  version?: string
}
const webRoot = path.resolve(__dirname, './apps/web')
const webIndexHtml = path.resolve(webRoot, 'index.html')
const devPort = Number(process.env.PORT || 3000)
const devHost = process.env.HOST || '0.0.0.0'
const normalizeClientHost = (value: string | undefined) => {
  const normalized = value?.trim()
  return normalized && normalized !== '0.0.0.0' ? normalized : undefined
}
const hmrHost = normalizeClientHost(process.env.VITE_HMR_HOST || process.env.HOST)
const serverProxyTarget = process.env.VITE_SERVER_PROXY_TARGET?.trim() || 'http://127.0.0.1:8989'
const appVersion = packageJson.version?.trim() || '0.0.0'
const sanitizeBuildIdPart = (value: string) => value.trim().replace(/[^0-9A-Za-z._-]+/g, '-').replace(/^-+|-+$/g, '')
const resolveCommitSha = () => {
  const envSha = process.env.CF_PAGES_COMMIT_SHA || process.env.VERCEL_GIT_COMMIT_SHA || process.env.GITHUB_SHA
  if (envSha?.trim()) {
    return sanitizeBuildIdPart(envSha).slice(0, 12)
  }

  try {
    return sanitizeBuildIdPart(execFileSync('git', ['rev-parse', '--short=12', 'HEAD'], { cwd: __dirname, encoding: 'utf8' }))
  } catch {
    return ''
  }
}
const appBuildId = [appVersion, resolveCommitSha()].filter(Boolean).join('-')
const appVersionManifestPlugin = {
  name: 'vibemux-app-version-manifest',
  configureServer(server) {
    server.middlewares.use('/version.json', (_req, res) => {
      res.setHeader('content-type', 'application/json; charset=utf-8')
      res.setHeader('cache-control', 'no-store')
      res.end(`${JSON.stringify({
        buildId: appBuildId,
        version: appVersion,
      }, null, 2)}\n`)
    })
  },
  generateBundle() {
    this.emitFile({
      type: 'asset',
      fileName: 'version.json',
      source: `${JSON.stringify({
        buildId: appBuildId,
        version: appVersion,
      }, null, 2)}\n`,
    })
  },
} satisfies Plugin
const commercialWebExtensionEntry = path.resolve(__dirname, './apps/web/src/enterprise/index.ts')
const commercialWebExtensionPlugin = {
  name: 'vibemux-commercial-web-extension',
  resolveId(id) {
    return id === 'virtual:commercial-extension' ? '\0virtual:commercial-extension' : null
  },
  load(id) {
    if (id !== '\0virtual:commercial-extension') {
      return null
    }
    // 显式禁用开关：强制以社区版构建（`pnpm dev:oss` / `pnpm build:oss`）。
    if (process.env.WEMUX_EXTENSION_DISABLED === '1') {
      return 'export {}'
    }
    return existsSync(commercialWebExtensionEntry)
      ? `import ${JSON.stringify(commercialWebExtensionEntry)};`
      : 'export {}'
  },
} satisfies Plugin
const controlPlaneProxyOrigin = new URL(serverProxyTarget)
const HOP_BY_HOP_HEADERS = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
])
const forceClientHtmlInput = {
  name: 'vibemux-force-client-html-input',
  config() {
    return {
      environments: {
        client: {
          build: {
            rollupOptions: {
              input: webIndexHtml,
            },
          },
        },
      },
    }
  },
}

const shouldProxyControlPlaneRequest = (pathname: string) => {
  if (pathname === '/api/rpc' || pathname.startsWith('/api/rpc/')) {
    return false
  }

  return pathname === '/api'
    || pathname.startsWith('/api/')
    || pathname === '/install'
    || pathname.startsWith('/install/')
    || pathname === '/install.ps1'
    || pathname === '/uploads'
    || pathname.startsWith('/uploads/')
    || pathname === '/mcp'
    || pathname.startsWith('/mcp/')
}

const resolveControlPlaneProxyUrl = (requestUrl: string) => new URL(requestUrl, controlPlaneProxyOrigin)

const collectProxyHeaders = (req: IncomingMessage, targetUrl: URL, includeUpgradeHeaders = false) => {
  const headers: OutgoingHttpHeaders = {}
  for (const [name, value] of Object.entries(req.headers)) {
    const normalized = name.toLowerCase()
    if (HOP_BY_HOP_HEADERS.has(normalized) && !(includeUpgradeHeaders && (normalized === 'connection' || normalized === 'upgrade'))) {
      continue
    }
    headers[name] = value
  }
  headers.host = targetUrl.host
  return headers
}

const proxyControlPlaneHttpRequest = (
  req: IncomingMessage,
  res: ServerResponse,
  targetUrl: URL,
  logger: { warn: (message: string) => void },
) => {
  const requestModule = targetUrl.protocol === 'https:' ? https : http
  // agent: false —— 每次请求新建连接，避免复用被 server 关闭的 keep-alive 连接
  // （SSE 长连接超时关闭后留在连接池，复用会读到残留字节 → Parse Error）。
  const upstream = requestModule.request(targetUrl, {
    method: req.method,
    headers: collectProxyHeaders(req, targetUrl),
    agent: false,
  }, (upstreamResponse) => {
    try {
      res.writeHead(upstreamResponse.statusCode ?? 502, upstreamResponse.statusMessage, upstreamResponse.headers)
    } catch (error) {
      // 响应头已不可写（客户端断开）→ 静默丢弃上游，避免未捕获异常。
      logger.warn(`[control-plane-proxy] writeHead failed ${req.url ?? '/'}: ${error instanceof Error ? error.message : String(error)}`)
      upstreamResponse.destroy()
      return
    }

    // SSE 流中途断开：安全收尾（写不进去就不写，绝不向已结束的响应再写）。
    upstreamResponse.on('error', (error) => {
      logger.warn(`[control-plane-proxy] upstream stream error ${req.url ?? '/'}: ${error.message}`)
      if (!res.writableEnded && !res.destroyed) {
        res.end()
      }
    })
    upstreamResponse.pipe(res)
  })

  const safelyCloseResponse = (message?: string) => {
    if (res.writableEnded || res.destroyed) {
      return
    }
    if (!res.headersSent) {
      res.statusCode = 502
      res.setHeader('content-type', 'text/plain; charset=utf-8')
      res.end(message ?? '')
      return
    }
    res.end()
  }

  upstream.on('error', (error) => {
    logger.warn(`[control-plane-proxy] failed to proxy ${req.url ?? '/'} to ${serverProxyTarget}: ${error.message}`)
    safelyCloseResponse(`Control plane dev server is unavailable at ${serverProxyTarget}.\n\n${error.message}`)
  })

  // 响应端错误（write-after-end 等）一律吞掉并记录，避免未捕获异常崩掉整个 dev server。
  res.on('error', (error) => {
    logger.warn(`[control-plane-proxy] response error ${req.url ?? '/'}: ${error.message}`)
  })

  // 客户端断开：停止转发并销毁上游，避免悬挂连接。
  // 注意：req 的 'close' 在请求体读完（而非连接关闭）时就会触发，
  // 用作断开信号会立刻销毁所有上游请求（socket hang up）；
  // 客户端断开会体现为 res 的 'close' 且 writableEnded 为 false。
  res.on('close', () => {
    if (!res.writableEnded && !res.destroyed) {
      upstream.destroy()
    }
  })
  req.on('error', (error) => {
    logger.warn(`[control-plane-proxy] request error ${req.url ?? '/'}: ${error.message}`)
    upstream.destroy()
  })

  req.pipe(upstream)
}

const proxyControlPlaneWebSocket = (
  req: IncomingMessage,
  socket: Socket,
  head: Buffer,
  targetUrl: URL,
) => {
  const port = Number(targetUrl.port || (targetUrl.protocol === 'https:' ? '443' : '80'))
  const connectEvent = targetUrl.protocol === 'https:' ? 'secureConnect' : 'connect'
  const upstream = targetUrl.protocol === 'https:'
    ? tls.connect({ host: targetUrl.hostname, port, servername: targetUrl.hostname })
    : net.connect({ host: targetUrl.hostname, port })

  const close = () => {
    socket.destroy()
    upstream.destroy()
  }

  upstream.once(connectEvent, () => {
    const headers = collectProxyHeaders(req, targetUrl, true)
    const headerLines = Object.entries(headers).flatMap(([key, value]) => {
      if (value === undefined) {
        return []
      }

      return Array.isArray(value)
        ? value.map((item) => `${key}: ${item}`)
        : [`${key}: ${value}`]
    })

    upstream.write(`${req.method ?? 'GET'} ${targetUrl.pathname}${targetUrl.search} HTTP/${req.httpVersion}\r\n${headerLines.join('\r\n')}\r\n\r\n`)
    if (head.length > 0) {
      upstream.write(head)
    }

    upstream.pipe(socket)
    socket.pipe(upstream)
  })
  upstream.on('error', close)
  socket.on('error', close)
}

const controlPlaneDevProxy = {
  name: 'vibemux-control-plane-dev-proxy',
  enforce: 'pre' as const,
  configureServer(server) {
    server.httpServer?.on('upgrade', (req, socket, head) => {
      const requestUrl = req.url
      if (!requestUrl) {
        return
      }

      const url = new URL(requestUrl, 'http://localhost')
      if (!shouldProxyControlPlaneRequest(url.pathname)) {
        return
      }

      proxyControlPlaneWebSocket(req, socket, head, resolveControlPlaneProxyUrl(requestUrl))
    })

    server.middlewares.use((req, res, next) => {
      const requestUrl = req.url
      if (!requestUrl) {
        next()
        return
      }

      const url = new URL(requestUrl, 'http://localhost')
      if (!shouldProxyControlPlaneRequest(url.pathname)) {
        next()
        return
      }

      proxyControlPlaneHttpRequest(req, res, resolveControlPlaneProxyUrl(requestUrl), server.config.logger)
    })
  },
}

const docsAiDevHandler = {
  name: 'vibemux-docs-ai-dev-handler',
  configureServer(server) {
    let aiHandlerPromise: Promise<{ handleAskRequest: (request: Request) => Promise<Response> }> | null = null

    // 文档 AI 端点（dev only）：handler 是 .ts 且依赖 shared 模块，无法在 Vite 8 的非
    // runnable ssr 环境下 ssrLoadModule，也无法被 config 打包器直接解析（@shared 别名）。
    // 方案：启动时用 esbuild 把 handler + shared 打包成自包含 bundle（npm 依赖外置），
    // 写入 node_modules/.vite-docs-ai/ 供 Node 动态 import（可解析 bare specifier）。
    const loadDocsAiHandler = async () => {
      if (aiHandlerPromise) {
        return aiHandlerPromise
      }
      aiHandlerPromise = (async () => {
        const outDir = path.resolve(__dirname, './node_modules/.vite-docs-ai')
        const outFile = path.resolve(outDir, 'docs-ai-handler.mjs')
        await esbuild({
          entryPoints: [path.resolve(__dirname, './apps/web/src/lib/docs/docs-ai-handler.ts')],
          bundle: true,
          platform: 'node',
          format: 'esm',
          target: 'node22',
          packages: 'external',
          alias: {
            '@shared': path.resolve(__dirname, './packages/shared/src'),
          },
          outfile: outFile,
          logLevel: 'silent',
        })
        const { pathToFileURL } = await import('node:url')
        return (await import(pathToFileURL(outFile).href)) as { handleAskRequest: (request: Request) => Promise<Response> }
      })()
      return aiHandlerPromise
    }

    server.middlewares.use(async (req, res, next) => {
      if (req.method !== 'POST') {
        next()
        return
      }

      const url = new URL(req.url ?? '/', 'http://localhost')
      if (url.pathname !== '/docs/api/ask') {
        next()
        return
      }

      try {
        const handler = await loadDocsAiHandler()
        const body = await new Promise<string>((resolve, reject) => {
          const chunks: Buffer[] = []
          req.on('data', (chunk) => chunks.push(chunk))
          req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
          req.on('error', reject)
        })
        const request = new Request(url, {
          method: 'POST',
          body,
          headers: {
            'content-type': req.headers['content-type'] ?? 'application/json',
          },
        })
        const response = await handler.handleAskRequest(request)
        res.statusCode = response.status
        response.headers.forEach((value, key) => res.setHeader(key, value))
        if (response.body) {
          const reader = response.body.getReader()
          for (;;) {
            const { done, value: chunk } = await reader.read()
            if (done) {
              break
            }
            res.write(Buffer.from(chunk))
          }
        }
        res.end()
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        server.config.logger.error(`[docs-ai] failed to handle /docs/api/ask: ${message}`)
        if (!res.headersSent) {
          res.statusCode = 502
          res.setHeader('content-type', 'application/json; charset=utf-8')
          res.end(JSON.stringify({ error: `Docs AI dev handler failed: ${message}` }))
        } else {
          res.end()
        }
      }
    })
  },
}

export default defineConfig({
  root: webRoot,
  envDir: __dirname,
  cacheDir: path.resolve(__dirname, './node_modules/.vite/apps-web'),
  define: {
    __APP_BUILD_ID__: JSON.stringify(appBuildId),
    __APP_VERSION__: JSON.stringify(appVersion),
  },
  optimizeDeps: {
    force: true,
    // react-grep 是 dev-only 工具（main.tsx `import.meta.env.DEV` 下动态引入），
    // 其 bundle 内置 zustand 的 with-selector/shim 块，vite 依赖预优化会产生
    // 过期块（Pre-transform error: .../deps/esm-*.js does not exist），排除后直接按源码服务。
    exclude: ['react-grep'],
  },
  server: {
    allowedHosts: true,
    host: devHost,
    port: devPort,
    hmr: {
      host: hmrHost,
    },
  },
  resolve: {
    dedupe: ['react', 'react-dom'],
    alias: {
      '@': path.resolve(__dirname, './apps/web/src'),
      '@server': path.resolve(__dirname, './apps/server/src'),
      '@shared': path.resolve(__dirname, './packages/shared/src'),
      '@web': path.resolve(__dirname, './apps/web/src'),
    },
  },
  plugins: [controlPlaneDevProxy, docsAiDevHandler, appVersionManifestPlugin, commercialWebExtensionPlugin, tsconfigPaths(), tanstackStart({ srcDirectory: 'src' }), react(), forceClientHtmlInput, nitro()],
})
