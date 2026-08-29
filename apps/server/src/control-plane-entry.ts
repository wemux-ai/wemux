// [INPUT]: 生产控制面环境与可选商业扩展构建产物
// [OUTPUT]: 组合后的 Hono 控制面、WebSocket、静态 Web 与后台服务
// [POS]: 生产 server 入口；启动核心前先通过 loader 装配可选扩展。
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import { serve } from '@hono/node-server'
import { bridgeWemuxEnvToLegacy } from '@shared/env'
import { createApp } from './app'
import { loadCommercialServerExtension } from './commercial-extension-loader'
import { startServerBackgroundServices, stopServerBackgroundServices } from './services/server-background-services'
import { ensureDevLoginAccountsReady, isDevLoginEnabled } from './services/dev-auth-service'
import {
  enterpriseDevSeedInitializers,
  enterpriseLandingEntries,
} from './extension-registry'
import { renderShellPage, servePublicFile } from './web-shell'

await loadCommercialServerExtension()

const HOST = process.env.HOST || '0.0.0.0'
const PORT = Number(process.env.PORT || '8989')

const startControlPlane = async () => {
  bridgeWemuxEnvToLegacy()
  const { app, webSocket } = await createApp()

  // 开发/演示环境种子数据（与 index.ts 入口一致）：仅当 dev login 启用时执行（幂等）
  if (isDevLoginEnabled()) {
    try {
      await ensureDevLoginAccountsReady()
      for (const seed of enterpriseDevSeedInitializers) {
        await seed()
      }
      console.log('[Seed] Dev login accounts ready.')
    } catch (error) {
      console.error('[Seed] Failed to prepare dev login accounts:', error)
    }
  }

  // 商业 landing 域（marketing/docs SSR + SEO 路由）：经 gate 注册，公开版注册表为空则跳过
  for (const landingEntry of enterpriseLandingEntries) {
    await landingEntry.registerRoutes(app)
  }

  app.all('/api/*', (c) => c.json({ message: '接口不存在' }, 404))
  app.all('/uploads/*', (c) => c.json({ message: '资源不存在' }, 404))
  app.on(['GET', 'HEAD'], '*', async (c) => {
    const publicFile = await servePublicFile(c.req.path)
    if (publicFile) {
      return publicFile
    }

    for (const landingEntry of enterpriseLandingEntries) {
      const landingResponse = await landingEntry.handlePageRequest({ req: c.req.raw })
      if (landingResponse) {
        return landingResponse
      }
    }

    return renderShellPage(c.req.raw)
  })

  const server = serve(
    {
      fetch: app.fetch,
      hostname: HOST,
      port: PORT,
    },
    (info) => {
      console.log(`wemux control plane running at http://${HOST}:${info.port}`)
    },
  )

  webSocket.injectWebSocket(server)
  startServerBackgroundServices()

  process.once('SIGINT', async () => {
    await stopServerBackgroundServices()
    process.exit(0)
  })

  process.once('SIGTERM', async () => {
    await stopServerBackgroundServices()
    process.exit(0)
  })
}

await startControlPlane()
