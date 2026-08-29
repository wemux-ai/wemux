import { createNodeWebSocket } from '@hono/node-ws'
import { assertClusterTokenConfigured } from './cluster/config'
import { createHttpApp } from './routes/http'
import { registerExecutorWsRoute } from './routes/executor-ws-route'
import { registerPreviewGatewayWsRoute } from './routes/preview-gateway-routes'
import { registerPreviewTunnelWsRoute } from './routes/preview-tunnel-ws-route'
import { assertBetterAuthSecretConfigured } from './services/auth-secrets'
import { assertSharedTokenSecretConfigured } from './services/token-secret'
import { registerTaskChatWsRoute } from './routes/task-chat-ws-route'
import { registerWorkspaceSessionHistoryWsRoute } from './routes/workspace-session-history-ws-route'
import { registerMainChatWsRoute } from './routes/main-chat-ws-route'
import { registerConversationWsRoute } from './routes/conversation-ws-route'
import { bootstrapStorage } from './services/storage-bootstrap-service'
import { assertSecretEncryptionKeyConfigured } from './services/secret-crypto'

export const createApp = async () => {
  assertClusterTokenConfigured()
  assertSharedTokenSecretConfigured()
  assertBetterAuthSecretConfigured()
  assertSecretEncryptionKeyConfigured()
  await bootstrapStorage()
  const app = createHttpApp()
  const webSocket = createNodeWebSocket({ app })
  registerExecutorWsRoute(app, webSocket.upgradeWebSocket)
  registerPreviewTunnelWsRoute(app, webSocket.upgradeWebSocket)
  registerTaskChatWsRoute(app, webSocket.upgradeWebSocket)
  registerWorkspaceSessionHistoryWsRoute(app, webSocket.upgradeWebSocket)
  registerMainChatWsRoute(app, webSocket.upgradeWebSocket)
  registerConversationWsRoute(app, webSocket.upgradeWebSocket)
  registerPreviewGatewayWsRoute(app, webSocket.upgradeWebSocket)
  return {
    app,
    webSocket,
  }
}
