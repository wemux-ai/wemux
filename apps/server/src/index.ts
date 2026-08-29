import 'dotenv/config'
import { bridgeWemuxEnvToLegacy } from '@shared/env'
import { serve } from '@hono/node-server'
import { createApp } from './app'
import { loadCommercialServerExtension } from './commercial-extension-loader'
import { ensureDevLoginAccountsReady, isDevLoginEnabled } from './services/dev-auth-service'
import { enterpriseDevSeedInitializers } from './extension-registry'
import { startServerBackgroundServices, stopServerBackgroundServices } from './services/server-background-services'

bridgeWemuxEnvToLegacy()
await loadCommercialServerExtension()

// ---- 致命错误处理 ----
// 设计：uncaughtException 后进程状态已不可信（Node 官方文档），继续运行会带内伤服务；
// 正确姿势是记录 → 限时排空 → 非 0 退出，交给容器编排（restart 策略）秒级拉起。
let isShuttingDownAfterFatalError = false

const shutdownAfterFatalError = async (origin: string, detail: unknown) => {
  if (isShuttingDownAfterFatalError) {
    return
  }
  isShuttingDownAfterFatalError = true
  console.error(`[server] fatal ${origin}, draining and exiting(1)`, detail)
  try {
    await Promise.race([
      stopServerBackgroundServices(),
      new Promise((resolve) => setTimeout(resolve, 3_000)),
    ])
  } catch (drainError) {
    console.error('[server] error during fatal-shutdown drain', drainError)
  }
  process.exit(1)
}

process.on('uncaughtException', (error) => {
  console.error('[server] uncaughtException', error)
  void shutdownAfterFatalError('uncaughtException', error)
})

// unhandledRejection 保持进程存活（历史行为，避免潜在良性 rejection 引发重启风暴），
// 但短窗口内高频出现说明系统性故障，同样走致命退出。
const REJECTION_STORM_WINDOW_MS = 60_000
const REJECTION_STORM_THRESHOLD = 50
let recentRejectionTimestamps: number[] = []

process.on('unhandledRejection', (reason) => {
  console.error('[server] unhandledRejection', reason)
  const now = Date.now()
  recentRejectionTimestamps = recentRejectionTimestamps.filter((timestamp) => now - timestamp < REJECTION_STORM_WINDOW_MS)
  recentRejectionTimestamps.push(now)
  if (recentRejectionTimestamps.length > REJECTION_STORM_THRESHOLD) {
    void shutdownAfterFatalError('unhandledRejection storm', reason)
  }
})

const { app, webSocket } = await createApp()

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

startServerBackgroundServices()
const HOST = process.env.HOST || '0.0.0.0'
const PORT = Number(process.env.PORT || '8989')

const server = serve(
  {
    fetch: app.fetch,
    hostname: HOST,
    port: PORT,
  },
  (info) => {
    console.log(`wemux server running at http://${HOST}:${info.port}`)
  },
)

webSocket.injectWebSocket(server)

process.once('SIGINT', async () => {
  await stopServerBackgroundServices()
  process.exit(0)
})

process.once('SIGTERM', async () => {
  await stopServerBackgroundServices()
  process.exit(0)
})
